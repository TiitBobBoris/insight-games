const {timingSafeEqual,createHash}=require('node:crypto');
const EMPTY={schemaVersion:1,edits:{}};
function validate(data){
  if(!data||data.schemaVersion!==1||!data.edits||typeof data.edits!=='object'||Array.isArray(data.edits))throw Error('Vigane tekstifail.');
  const entries=Object.entries(data.edits);
  if(entries.length>1000)throw Error('Liiga palju muudatusi.');
  for(const [key,value] of entries)if(!/^[a-z]+\|[a-z0-9]{1,16}$/.test(key)||typeof value!=='string'||value.length>10000)throw Error('Vigane tekstimuudatus.');
  if(Buffer.byteLength(JSON.stringify(data))>500000)throw Error('Tekstifail on liiga suur.');
  return {schemaVersion:1,edits:Object.fromEntries(entries)};
}
function authorized(given,secret){
  if(!secret||secret.length<32||typeof given!=='string')return false;
  const digest=s=>createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(given),digest('Bearer '+secret));
}
async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  const send=(status,data)=>res.status(status).json(data);
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return send(405,{error:'Meetod pole lubatud.'})}
  const token=process.env.TEXTS_GITHUB_TOKEN,secret=process.env.TEXTS_PUBLISH_KEY;
  if(!token||!secret||secret.length<32)return send(503,{error:'Avaldamine vajab serveri seadistamist. Muudatused jäävad sinu brauserisse.'});
  if(req.method==='POST'&&!authorized(req.headers.authorization,secret))return send(401,{error:'Avaldamisvõti ei sobi.'});
  const url='https://api.github.com/repos/TiitBobBoris/insight-games/contents/published-texts.json';
  const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'};
  try{
    let incoming;
    if(req.method==='POST'){
      try{incoming=typeof req.body==='string'?JSON.parse(req.body):req.body;validate(incoming)}catch{return send(400,{error:'Vigane tekstimuudatus. Midagi ei avaldatud.'})}
    }
    const read=await fetch(url+'?ref=main',{headers,signal:AbortSignal.timeout(10000)});
    let current=EMPTY,sha=null;
    if(read.status!==404){if(!read.ok)throw Error('read');const file=await read.json();sha=file.sha;current=validate(JSON.parse(Buffer.from(file.content,'base64').toString('utf8')))}
    if(req.method==='GET')return send(200,{...current,revision:sha});
    if(incoming.revision!==sha)return send(409,{error:'Tekstid on vahepeal muutunud. Ava leht uuesti ja võrdle oma muudatusi enne avaldamist.'});
    const next=validate({schemaVersion:1,edits:{...current.edits,...incoming.edits}});
    const saved=await fetch(url,{method:'PUT',headers,signal:AbortSignal.timeout(15000),body:JSON.stringify({message:'Publish website copy',branch:'main',...(sha?{sha}:{}),content:Buffer.from(JSON.stringify(next,null,2)+'\n').toString('base64')})});
    if(saved.status===409||saved.status===422)return send(409,{error:'Avaldamiskonflikt. Muudatused jäid brauserisse; laadi leht uuesti.'});
    if(!saved.ok)throw Error('write');
    const result=await saved.json();
    return send(200,{...next,revision:result.content.sha});
  }catch{return send(502,{error:'Avaldamist ei saanud kinnitada. Muudatused jäid brauserisse. Laadi leht uuesti ja kontrolli enne kordamist.'})}
}
module.exports=handler;
module.exports.validate=validate;
module.exports.authorized=authorized;
