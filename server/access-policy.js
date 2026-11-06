// Internal business APIs are accessible only to explicitly supported internal roles.
function mayAccessInternalApi(role,method,path){
 if(role==='admin')return true;
 if(role!=='viewer')return false;
 return ['GET','HEAD'].includes(method)||path==='/api/account/password';
}
function apiAccessHook(auth,sessionToken){
 return async(req,reply)=>{
  const pathname=req.raw.url.split('?')[0];
  if(!pathname.startsWith('/api/')||pathname==='/api/health'||pathname.startsWith('/api/auth/'))return;
  if(req.routeOptions.config.publicCatalog===true&&['GET','HEAD'].includes(req.method))return;
  if(!auth)return reply.code(503).send({error:'账号服务不可用'});
  const user=await auth.user(sessionToken(req));
  if(!user)return reply.code(401).send({error:'请先登录'});
  if(!mayAccessInternalApi(user.role,req.method,pathname))return reply.code(403).send({error:'没有访问权限'});
  req.user=user;
 };
}
module.exports={mayAccessInternalApi,apiAccessHook};
