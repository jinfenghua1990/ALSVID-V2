const {test}=require('node:test');
const assert=require('node:assert/strict');
const poolPath=require.resolve('../db-pool'),servicePath=require.resolve('../postgres-service');
function setup(active){
  const queries=[];
  const client={release(){},async query(sql){
    queries.push(sql);
    if(sql.startsWith('SELECT id,planned_quantity'))return {rows:[{id:'o1',plannedQuantity:5,status:'已完成'}]};
    if(sql.startsWith('SELECT id FROM warehouses'))return {rows:active?[{id:'w1'}]:[]};
    if(sql.startsWith('SELECT COALESCE(sum(planned_quantity)'))return {rows:[{n:0}]};
    if(sql.startsWith('INSERT INTO production_deliveries'))return {rows:[{id:'d1'}]};
    return {rows:[],rowCount:1};
  }};
  require.cache[poolPath]={id:poolPath,filename:poolPath,loaded:true,exports:{createPool:()=>({connect:async()=>client,end:async()=>{}})}};
  delete require.cache[servicePath];
  return {service:require('../postgres-service').createServiceStore('unused'),queries};
}
test('new delivery requires an active destination warehouse',async()=>{
  const body={shipmentNo:'S1',warehouseId:'w1',plannedQuantity:1};
  let x=setup(false);
  await assert.rejects(x.service.createDelivery('o1',body),/请选择已启用的国内仓或海外仓/);
  assert.equal(x.queries.some(q=>q.startsWith('INSERT INTO production_deliveries')),false);
  assert.match(x.queries.find(q=>q.startsWith('SELECT id FROM warehouses')),/status='启用' FOR SHARE/);
  x=setup(true);
  assert.equal((await x.service.createDelivery('o1',body)).id,'d1');
});
