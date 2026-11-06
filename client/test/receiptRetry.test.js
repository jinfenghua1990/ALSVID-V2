import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readPending,prepareReceipt,clearPending,isDefiniteRejection} from '../src/receiptRetry.js';
function storage(){const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}}
test('uncertain receipt retries retain the original id and payload across reload',()=>{const s=storage(),first={receiptId:'id-1',receivedQuantity:2,receiptNote:'short'};assert.deepEqual(prepareReceipt(s,'delivery',first),first);assert.deepEqual(readPending(s,'delivery'),first);assert.deepEqual(prepareReceipt(s,'delivery',{receiptId:'id-2',receivedQuantity:3,receiptNote:''}),first);clearPending(s,'delivery','id-2');assert.deepEqual(readPending(s,'delivery'),first);clearPending(s,'delivery','id-1');assert.equal(readPending(s,'delivery'),null)});
test('only explicit receipt validation errors allow clearing a pending request',()=>{assert.equal(isDefiniteRejection({status:400,message:'签收数量超过本批剩余发运数量'}),true);assert.equal(isDefiniteRejection({status:400,message:'签收入库失败'}),false);assert.equal(isDefiniteRejection({status:500,message:'签收数量超过本批剩余发运数量'}),false)});
