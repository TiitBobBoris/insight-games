const {test}=require('node:test');
const assert=require('node:assert/strict');
const handler=require('../api/texts');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(data){this.data=data;return this}}}
test('publishing requires a strong owner key and never contacts storage for unauthorized requests',async t=>{
 t.mock.method(global,'fetch',()=>{throw Error('must not fetch')});
 t.mock.property(process,'env',{...process.env,TEXTS_GITHUB_TOKEN:'test-token',TEXTS_PUBLISH_KEY:'x'.repeat(32)});
 const res=response();await handler({method:'POST',headers:{},body:{}},res);assert.equal(res.code,401);
 assert.equal(handler.authorized('Bearer '+ 'x'.repeat(32),'x'.repeat(32)),true);
 assert.equal(handler.authorized('Bearer short','short'),false);
});
test('publish merges copy, uses revision protection, and a second client reads the published result',async t=>{
 t.mock.property(process,'env',{...process.env,TEXTS_GITHUB_TOKEN:'test-token',TEXTS_PUBLISH_KEY:'x'.repeat(32)});
 let file={schemaVersion:1,edits:{'dashboard|abc':'Vana tekst'}},sha='old',writes=0;
 t.mock.method(global,'fetch',async(url,options)=>{
  if(options.method==='PUT'){writes++;const body=JSON.parse(options.body);assert.equal(body.sha,sha);file=JSON.parse(Buffer.from(body.content,'base64'));sha='new';return {ok:true,json:async()=>({content:{sha}})}}
  return {ok:true,status:200,json:async()=>({sha,content:Buffer.from(JSON.stringify(file)).toString('base64')})};
 });
 const request={method:'POST',headers:{authorization:'Bearer '+'x'.repeat(32)},body:{schemaVersion:1,revision:'old',edits:{'dashboard|def':'<img src=x onerror=alert(1)>'}}};
 let res=response();await handler(request,res);assert.equal(res.code,200);assert.equal(file.edits['dashboard|abc'],'Vana tekst');
 res=response();await handler({method:'GET',headers:{}},res);assert.equal(res.data.edits['dashboard|def'],'<img src=x onerror=alert(1)>');
 res=response();await handler(request,res);assert.equal(res.code,409);assert.equal(writes,1);
});
test('invalid requests and corrupt stored content never get overwritten',async t=>{
 t.mock.property(process,'env',{...process.env,TEXTS_GITHUB_TOKEN:'test-token',TEXTS_PUBLISH_KEY:'x'.repeat(32)});
 let writes=0;t.mock.method(global,'fetch',async(url,options)=>{if(options.method==='PUT')writes++;return {ok:true,json:async()=>({sha:'old',content:Buffer.from('{bad').toString('base64')})}});
 const req={method:'POST',headers:{authorization:'Bearer '+'x'.repeat(32)},body:{schemaVersion:1,revision:'old',edits:{'dashboard|abc':'Tekst'}}};
 let res=response();await handler(req,res);assert.equal(res.code,502);assert.equal(writes,0);
 req.body.edits={'__proto__':null,invalid:'oops'};res=response();await handler(req,res);assert.equal(res.code,400);assert.equal(writes,0);
});
test('published copy is rendered as text and private game storage is never sent',async t=>{
 const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8').replace('})();','window.copyAPI={loadPublishedTexts,publishTexts,pendingTexts};})();');
 const calls=[];let publicEdits={};
 const dom=new JSDOM(html,{url:'https://qa.example/',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};w.CSS={escape:s=>s};w.fetch=async(url,options={})=>{calls.push(options);return {ok:true,json:async()=>({schemaVersion:1,revision:'one',edits:publicEdits})}}}});
 t.after(()=>dom.window.close());const w=dom.window,d=w.document;
 await w.copyAPI.loadPublishedTexts();
 const title=d.querySelector('#dashboard h1'),key=title.dataset.editLegacyKey;
 publicEdits={[key]:'<img src=x onerror=alert(1)>'};await w.copyAPI.loadPublishedTexts();assert.equal(title.querySelector('img'),null);assert.equal(title.textContent,publicEdits[key]);
 d.querySelector('#editToggle').click();title.textContent='Uus avalik tekst';title.dispatchEvent(new w.Event('input',{bubbles:true}));
 w.localStorage.setItem('insightGamesV1','private-game-answer');
 d.querySelector('#publishKey').value='x'.repeat(32);d.querySelector('#publishDialog').close=()=>{};
 await w.copyAPI.publishTexts({preventDefault(){}});
 const sent=JSON.parse(calls.find(c=>c.method==='POST').body);assert.deepEqual(sent.edits,{[key]:'Uus avalik tekst'});assert.equal(JSON.stringify(sent).includes('private-game-answer'),false);
 assert.equal(d.querySelector('#publishKey').value,'');assert.equal(w.localStorage.getItem('insightGamesV1'),'private-game-answer');
});
