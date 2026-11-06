// Internal business APIs are accessible only to explicitly supported internal roles.
function mayAccessInternalApi(role,method,path){
 if(role==='admin')return true;
 if(role!=='viewer')return false;
 return ['GET','HEAD'].includes(method)||path==='/api/account/password';
}
module.exports={mayAccessInternalApi};
