const PREFIX='alsvid.pendingReceipt.';
const definite=new Set(['签收编号或数量无效','发运记录不存在','只有在途发运记录可以签收','该发运记录已全部签收入库','本次签收后仍有未到数量，必须填写差异说明','签收数量超过本批剩余发运数量','签收编号已用于其他记录']);
export function readPending(storage,id){const raw=storage.getItem(PREFIX+id);if(!raw)return null;const value=JSON.parse(raw);if(!value||typeof value.receiptId!=='string'||!Number.isSafeInteger(value.receivedQuantity)||value.receivedQuantity<1||typeof value.receiptNote!=='string')throw Error('待确认签收记录无法读取');return value;}
export function prepareReceipt(storage,id,payload){const old=readPending(storage,id);if(old)return old;storage.setItem(PREFIX+id,JSON.stringify(payload));return payload;}
export function clearPending(storage,id,receiptId){const old=readPending(storage,id);if(old&&old.receiptId===receiptId)storage.removeItem(PREFIX+id);}
export function isDefiniteRejection(error){return error.status===400&&definite.has(error.message);}
