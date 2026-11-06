const {AsyncLocalStorage}=require('node:async_hooks');
const actors=new AsyncLocalStorage();
function runAsActor(actor,fn){return actors.run(actor,fn)}
function currentActor(){return actors.getStore()||'system'}
module.exports={runAsActor,currentActor};
