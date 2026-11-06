const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

function createObjectStorage(env=process.env) {
  const endpoint=env.OBJECT_STORAGE_ENDPOINT;
  const bucket=env.OBJECT_STORAGE_BUCKET;
  if (!endpoint || !bucket || !env.OBJECT_STORAGE_ACCESS_KEY || !env.OBJECT_STORAGE_SECRET_KEY) return null;
  const origin=new URL(endpoint);
  if(origin.protocol!=='https:' || origin.pathname!=='/' || origin.search || origin.hash) throw new Error('Object storage endpoint must be an HTTPS origin');
  const client=new S3Client({region:env.OBJECT_STORAGE_REGION||'auto',endpoint:origin.toString(),credentials:{accessKeyId:env.OBJECT_STORAGE_ACCESS_KEY,secretAccessKey:env.OBJECT_STORAGE_SECRET_KEY}});
  return {
    async put({key,contentType,body}) { validateKey(key); await client.send(new PutObjectCommand({Bucket:bucket,Key:key,ContentType:contentType,Body:body})); },
    async get(key) { validateKey(key); return client.send(new GetObjectCommand({Bucket:bucket,Key:key})); },
    async remove(key) { validateKey(key); await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key})); },
    async signUpload({key,contentType}) { validateKey(key); if(!/^image\/(jpeg|png|webp|avif|svg\+xml)$/.test(contentType||''))throw new Error('Unsupported image content type'); const command=new PutObjectCommand({Bucket:bucket,Key:key,ContentType:contentType});return{url:await getSignedUrl(client,command,{expiresIn:300}),key,expiresIn:300}; },
    async signRead(key) { validateKey(key); const command=new GetObjectCommand({Bucket:bucket,Key:key});return getSignedUrl(client,command,{expiresIn:300}); },
    async head(key) { validateKey(key); try { const r=await client.send(new HeadObjectCommand({Bucket:bucket,Key:key}));return{key,size:r.ContentLength,contentType:r.ContentType}; } catch(e) { if(e.name==='NotFound'||e.$metadata?.httpStatusCode===404)return null;throw e; } },
  };
}
function validateKey(key){if(typeof key!=='string'||key.length>512||key.startsWith('/')||key.split('/').some(x=>!x||x==='.'||x==='..'))throw new Error('Invalid object key');}
module.exports={createObjectStorage};
