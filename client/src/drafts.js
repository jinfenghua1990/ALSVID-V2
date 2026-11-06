const DB='alsvid-local-drafts', STORE='drafts';
function open(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>req.result.createObjectStore(STORE);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function op(mode,key,value){const db=await open();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode);const store=tx.objectStore(STORE);const req=mode==='readonly'?store.get(key):value===undefined?store.delete(key):store.put(value,key);let result;req.onsuccess=()=>{result=req.result};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}finally{db.close()}}
export const loadDraft=key=>op('readonly',key);
export const saveDraft=(key,value)=>op('readwrite',key,value);
export const deleteDraft=key=>op('readwrite',key);
