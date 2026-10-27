'use strict';
// Build-time utility only. Sends public interface strings, never profile data.
// No translation service is contacted by the browser at runtime.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'src/locales'),cache=path.join(root,'.cache/locale-translation');fs.mkdirSync(cache,{recursive:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function protectedText(text){const tokens=[];return {tokens,text:text.replace(/\{[A-Za-z0-9_]+\}|(?:https?:\/\/|nacre:\/\/)[^\s<>"']+|\b(?:navigator|window|document|Intl)\.[A-Za-z.]+|\b(?:tor\.exe|en-US|en-US\/en|UTC|HMAC-SHA256|SAFECOOKIE|Set-Cookie|OffscreenCanvas|RTCPeerConnection|SharedWorker|ServiceWorker|WebGL|WebRTC|Canvas|JavaScript|User-Agent|Google Chrome|Nacre|Electron|Tor)\b/g,match=>{const token='ZXQ'+String(tokens.length).padStart(4,'0')+'QXZ';tokens.push(match);return token;})};}
let active=0;
async function request(text,target,source){
 while(active>=1)await wait(100);active++;
 try{
  for(let attempt=0;attempt<5;attempt++){
   try{
    const url='https://translate.googleapis.com/translate_a/single?client=gtx&sl='+source+'&tl='+target+'&dt=t&q='+encodeURIComponent(text);
    await wait(500);
    const response=await fetch(url,{signal:AbortSignal.timeout(45000)});
    if(!response.ok)throw Error('HTTP '+response.status);
    const data=await response.json();if(!Array.isArray(data[0]))throw Error('Invalid translation response');
    return {text:data[0].map(part=>part[0]||'').join(''),parts:data[0]};
   }catch(error){if(attempt===4)throw error;await wait(1500*2**attempt);}
  }
 }finally{active--;}
}
async function translateValues(input,target,source='en',limit=3300){
 const file=path.join(cache,target+'-'+source+'.json');let memo={};try{memo=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
 const results={},pending=[];
 for(const [key,value]of Object.entries(input)){
  const id=crypto.createHash('sha256').update(value).digest('hex');
  if(memo[id])results[key]=memo[id];else pending.push({key,value,id});
 }
 const batches=[];let batch=[],size=0;
 for(const item of pending){if(batch.length&&size+item.value.length>limit){batches.push(batch);batch=[];size=0;}batch.push(item);size+=item.value.length+12;}if(batch.length)batches.push(batch);
 for(let index=0;index<batches.length;index++){
  batch=batches[index];const tokens=[];
  const sourceText=batch.map((item,i)=>{const p=protectedText(item.value);tokens.push(p.tokens);return 'ZXID'+String(i).padStart(4,'0')+'DIXZ '+p.text;}).join('\n');
  try {
  const reply=await request(sourceText,target,source),translated=reply.text;
  const grouped=Array.from({length:batch.length},()=>''),seen=new Set();let current=-1;
  // Some language variants return the entire request as one source segment.
  // Preserve per-line identifiers even if word order moves one inside a label.
  for(const line of translated.split('\n')){
   const ids=[...line.matchAll(/ZXID\s*(\d{4})\s*DIXZ/gi)];
   if(ids.length>1){seen.clear();break;}
   if(ids.length){current=Number(ids[0][1]);seen.add(current);}
   if(current>=0&&current<batch.length)grouped[current]+=(grouped[current]?'\n':'')+line.replace(/ZXID\s*\d{4}\s*DIXZ/gi,'').trim();
  }
  if(seen.size!==batch.length){
  grouped.fill('');seen.clear();current=-1;
  for(const part of reply.parts){
   const ids=[...(part[1]||'').matchAll(/ZXID\s*(\d{4})\s*DIXZ/gi)];
   if(ids.length>1)throw Error('Translation source segment crossed entries '+target);
   if(ids.length){current=Number(ids[0][1]);seen.add(current);}
   if(current>=0&&current<batch.length)grouped[current]+=(part[0]||'').replace(/ZXID\s*\d{4}\s*DIXZ?/gi,'');
  }
  }
  if(seen.size!==batch.length){fs.writeFileSync(path.join(cache,'failed-'+target+'.txt'),sourceText+'\n\n--- RESPONSE ---\n'+JSON.stringify(reply,null,2));throw Error(target+': translation lost source markers in batch '+index);}
  for(let i=0;i<batch.length;i++){
   let value=grouped[i].trim();
   for(let j=0;j<tokens[i].length;j++){
    const token=new RegExp('ZXQ\\s*'+String(j).padStart(4,'0')+'\\s*QXZ','gi');
    if(!token.test(value))throw Error(target+': translation lost protected token '+batch[i].key);
    value=value.replace(token,tokens[i][j]);
   }
   if(!value||/ZXQ\s*\d+/i.test(value))throw Error('Invalid translated value');
   const placeholders=x=>(x.match(/\{[A-Za-z0-9_]+\}/g)||[]).sort().join(',');
   if(placeholders(value)!==placeholders(batch[i].value))throw Error('Placeholder mismatch '+target+':'+batch[i].key);
   results[batch[i].key]=memo[batch[i].id]=value;
  }
  } catch(error) {
    if (/HTTP|fetch failed|timed? out|aborted/i.test(error.message)) throw error;
    console.log('RETRY '+target+' '+batch.length+' entries: '+error.message);
    if(batch.length>1){
      const mid=Math.ceil(batch.length/2);
      for(const half of [batch.slice(0,mid),batch.slice(mid)])Object.assign(results,await translateValues(Object.fromEntries(half.map(item=>[item.key,item.value])),target,source,Math.max(150,Math.floor(limit/2))));
      Object.assign(memo,JSON.parse(fs.readFileSync(file,'utf8')));
    }else{
      const item=batch[0],protectedValue=protectedText(item.value);
      const urlMasked=protectedValue.text.replace(/ZXQ(\d{4})QXZ/g,(_token,index)=>'https://nacre.invalid/keep'+index);
      let value=(await request(urlMasked,target,source)).text;
      for(let j=0;j<protectedValue.tokens.length;j++){
        const token=new RegExp('https?://nacre\\.invalid/keep'+String(j).padStart(4,'0'),'gi');
        if(!token.test(value))throw Error(target+': isolated translation lost token '+item.key);
        value=value.replace(token,protectedValue.tokens[j]);
      }
      if(!value.trim()||/ZXID|ZXQ\d/i.test(value))throw error;
      results[item.key]=memo[item.id]=value.trim();
    }
  }
  fs.writeFileSync(file,JSON.stringify(memo,null,2)+'\n');
  if(index%5===0)console.log(target+' '+(index+1)+'/'+batches.length);
  await wait(120);
 }
 return results;
}
async function main(){
 const en=JSON.parse(fs.readFileSync(path.join(dir,'en.json'),'utf8'));
 const pending=JSON.parse(fs.readFileSync(path.join(root,'.cache/i18n-pending-source.json'),'utf8'));
 Object.assign(en,await translateValues(Object.fromEntries(Object.entries(pending).filter(([k,v])=>en[k]===v)),'en','fr'));
 fs.writeFileSync(path.join(dir,'en.json'),JSON.stringify(en,null,2)+'\n');
 if(process.argv.includes('--english-only'))return;
 const fr=JSON.parse(fs.readFileSync(path.join(dir,'fr.json'),'utf8'));
 Object.assign(fr,await translateValues(Object.fromEntries(Object.entries(en).filter(([k,v])=>!k.startsWith('_')&&!k.startsWith('languages.')&&(!fr[k]||fr[k]===v))),'fr'));
 fs.writeFileSync(path.join(dir,'fr.json'),JSON.stringify(fr,null,2)+'\n');
 const only=process.argv.find(arg=>arg.startsWith('--only='))?.slice(7).split(',');
 const languages=require('../src/i18n.cjs').SUPPORTED_LANGUAGES.filter(code=>!only||only.includes(code));
 const entries=Object.fromEntries(Object.entries(en).filter(([key])=>!key.startsWith('_')&&!key.startsWith('languages.')));
 const failures=[];let cursor=0;
 async function worker(){while(cursor<languages.length){const code=languages[cursor++];
  if(['en','fr','en-GB','fr-CA','es-419','zh-HK'].includes(code))continue;
  try{
   const current=JSON.parse(fs.readFileSync(path.join(dir,code+'.json'),'utf8'));
   const preserve=['de','es'].includes(code)?Object.fromEntries(Object.entries(current).filter(([k])=>k in entries)):{};
   const missing=Object.fromEntries(Object.entries(entries).filter(([k])=>!(k in preserve)));
   const values=await translateValues(missing,code==='fil'?'tl':code);
   const output={_status:'machine-translated',...en,...preserve,...values};output._status='machine-translated';
   fs.writeFileSync(path.join(dir,code+'.json'),JSON.stringify(output,null,2)+'\n');console.log('COMPLETE '+code+' '+Object.keys(values).length);
  }catch(error){failures.push({code,error:error.message});console.log('FAILED '+code+' '+error.message);}
 }}
 await Promise.all([worker(),worker(),worker()]);
 for(const[code,base]of Object.entries({'en-GB':'en','fr-CA':'fr','es-419':'es','zh-HK':'zh-TW'})){
  const data=JSON.parse(fs.readFileSync(path.join(dir,base+'.json'),'utf8'));data._status='regional-base';fs.writeFileSync(path.join(dir,code+'.json'),JSON.stringify(data,null,2)+'\n');
 }
 fs.writeFileSync(path.join(cache,'result.json'),JSON.stringify({failures},null,2));if(failures.length)process.exitCode=1;
}
main().catch(error=>{console.error(error.stack);process.exitCode=1});
