// Read V2 runtime configuration from Google Secret Manager without logging secrets.
const { execFileSync, spawn } = require('node:child_process');
const path=require('node:path');

function run(file,args){
  return execFileSync(file,args,{encoding:'utf8',stdio:['ignore','pipe','ignore'],windowsHide:true}).trim();
}
function loadRuntimeEnvironment(){
  const command="& 'C:\\CloudSDK\\google-cloud-sdk\\bin\\gcloud.cmd' secrets versions access latest --secret=alsvid-v2-runtime --project=alsvid-prod";
  const encoded=Buffer.from(command,'utf16le').toString('base64');
  let config;
  try { config=JSON.parse(run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded])); }
  catch (_) { throw new Error('Cannot read ALSVID V2 runtime configuration from Google Secret Manager'); }
  for(const key of ['DATABASE_URL','OBJECT_STORAGE_ENDPOINT','OBJECT_STORAGE_BUCKET','OBJECT_STORAGE_ACCESS_KEY','OBJECT_STORAGE_SECRET_KEY']) if(!config[key]) throw new Error('Missing '+key+' in ALSVID V2 secret');
  return {...process.env,...config};
}
if(require.main===module){
  try{const env=loadRuntimeEnvironment();const child=spawn(process.execPath,['init-postgres.js'],{cwd:__dirname,env,stdio:'inherit',windowsHide:true});child.on('exit',code=>{if(code!==0){process.exitCode=code??1;return;}const server=spawn(process.execPath,['index.js'],{cwd:__dirname,env,stdio:'inherit',windowsHide:true});server.on('exit',serverCode=>{process.exitCode=serverCode??1;});});}
  catch(e){console.error(`Could not load ALSVID cloud configuration (${e.message}); secret values were not logged.`);process.exitCode=1;}
}
module.exports={loadRuntimeEnvironment};
