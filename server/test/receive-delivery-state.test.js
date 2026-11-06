const {test}=require('node:test');
const assert=require('node:assert/strict');
const poolPath=require.resolve('../db-pool');
const servicePath=require.resolve('../postgres-service');
const receiptId='12345678-1234-1234-1234-123456789abc';

function serviceFor(status,prior=null){
  const queries=[];
  const client={release(){},async query(sql){
    queries.push(sql);
    if(sql.startsWith('SELECT d.*'))return {rows:[{id:'d1',status,planned_quantity:2,received_quantity:0,warehouse_id:'w1',sku:'s1'}]};
    if(sql.startsWith('SELECT id,delivery_id'))return {rows:prior?[prior]:[]};
    if(sql.startsWith('UPDATE production_deliveries'))return {rows:[{id:'d1',receivedQuantity:1,status:'在途'}]};
    return {rows:[],rowCount:1};
  }};
  const pool={connect:async()=>client,end:async()=>{}};
  require.cache[poolPath]={id:poolPath,filename:poolPath,loaded:true,exports:{createPool:()=>pool}};
  delete require.cache[servicePath];
  return {service:require('../postgres-service').createServiceStore('unused'),queries};
}

test('receipt requires dispatch while retries remain idempotent',async()=>{
  let x=serviceFor('待发运');
  await assert.rejects(x.service.receiveDelivery('d1',{receiptId,receivedQuantity:1,receiptNote:'short'}),/只有在途发运记录可以签收/);
  assert.equal(x.queries.some(q=>q.startsWith('UPDATE warehouse_stock')),false);
  x=serviceFor('已入库',{id:receiptId,deliveryId:'d1',receivedQuantity:1});
  const retry=await x.service.receiveDelivery('d1',{receiptId,receivedQuantity:1});
  assert.equal(retry.id,receiptId);
  assert.equal(x.queries.some(q=>q.startsWith('UPDATE warehouse_stock')),false);
  x=serviceFor('在途');
  const result=await x.service.receiveDelivery('d1',{receiptId,receivedQuantity:1,receiptNote:'short'});
  assert.equal(result.receivedQuantity,1);
  assert.equal(x.queries.filter(q=>q.startsWith('UPDATE warehouse_stock')).length,1);
});
