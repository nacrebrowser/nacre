'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {SUPPORTED_LANGUAGES,getMessages}=require('../src/i18n.cjs');
const {localizeText}=require('../src/message-localizer.cjs');
const root=path.resolve(__dirname,'..'),en=require('../src/locales/en.json');
test('all advertised languages have complete catalogues without generation artifacts',()=>{
 assert.equal(SUPPORTED_LANGUAGES.length,20);
 for(const code of SUPPORTED_LANGUAGES){
  const raw=require('../src/locales/'+code+'.json');
  assert.notEqual(raw._status,'not-reviewed',code);
  for(const[key,value]of Object.entries(getMessages(code))){
   assert.ok(!/(?:ZXID|ZACID|ZXQ|DXQ)\d|QXZ|DIXZ|\uFFFD/i.test(value),code+':'+key+' artifact');
   if(key.startsWith('languages.'))continue;
   if(en[key]==='SOCKS5')assert.equal(value,'SOCKS5',code+' SOCKS5 is a protocol identifier');
  }
 }
});
test('every language is selectable and every page starts with English fallback',()=>{
 const settings=fs.readFileSync(path.join(root,'src/settings.html'),'utf8');
 const options=/id="language"[^>]*>([\s\S]*?)<\/select>/.exec(settings)[1];
 const codes=[...options.matchAll(/value="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(codes,SUPPORTED_LANGUAGES);
 for(const file of fs.readdirSync(path.join(root,'src')).filter(f=>f.endsWith('.html'))){
  const text=fs.readFileSync(path.join(root,'src',file),'utf8');
  assert.match(text,/<html lang="en">/,file+' English starts before IPC');
 }
});

test('all interface version labels show the packaged version in every locale',()=>{
 const version=require('../package.json').nacreVersion || require('../package.json').version;
 for(const code of SUPPORTED_LANGUAGES)for(const key of ['settings.aboutEyebrow','app.version','about.version','home.footerVersion'])assert.ok(getMessages(code)[key].includes(version),code+' '+key);
});

test('Arabic settings contain translated prose instead of English source fragments',()=>{
 const ar=require('../src/locales/ar.json');
 for(const key of ['settings.startIntro','settings.fontSizeNote','settings.bookmarksLocal','settings.manageBookmarks']){
  assert.notEqual(ar[key],en[key],key);
  assert.match(ar[key],/[\u0600-\u06ff]/,key);
  assert.doesNotMatch(ar[key],/By default|Nacre opens|Manage bookmarks|Font size/i,key);
 }
});
test('diagnostics translate known text while preserving untrusted template arguments as text',()=>{
 assert.equal(localizeText('Les nouveaux ponts seront utilisés à la prochaine connexion Tor.','en'),en['toast.bridgesNextTor']);
 const key='diagnostic.maincjs.text60b62f67d6';
 const source=require('../src/locales/fr.json')[key];
 const untrusted='<img src=x onerror=alert(1)>';
 assert.equal(localizeText(source.replace('{value0}',untrusted).replace('{value1}','15'),'en'),en[key].replace('{value0}',untrusted).replace('{value1}','15'));
 assert.equal(localizeText('Error invoking remote method \'nacre:test\': Error: Les nouveaux ponts seront utilisés à la prochaine connexion Tor.','en'),en['toast.bridgesNextTor']);
 assert.equal(localizeText('https://user.test/Les nouveaux ponts','ja'),'https://user.test/Les nouveaux ponts');
 assert.equal(localizeText('x'.repeat(8193),'en'),'x'.repeat(8193));
});

test('unknown errors do not match generic user-interface templates',()=>{
 for(const code of SUPPORTED_LANGUAGES)for(const value of ['alpha of beta','Connection failed ou timed out','alpha sur beta'])assert.equal(localizeText(value,code),value,code);
});

test('bridge failure compositions use translated causes in every catalogue',()=>{
 const {explainTorFailure}=require('../src/tor-diagnostics.cjs');
 for(const code of SUPPORTED_LANGUAGES){
  const messages=getMessages(code);
  for(const [source,key]of [['timeout','diagnostic.tordiagnosticscjs.text8c69efbb42'],['lyrebird missing','diagnostic.torTransportMissing'],['connection refused','diagnostic.tordiagnosticscjs.text00d3f4d459']]){
   const result=localizeText(explainTorFailure(source,'','snowflake'),code);
   assert.equal(result,messages['diagnostic.torBridgeFailure'].replace('{bridge}','Snowflake '+messages['diagnostic.tordiagnosticscjs.text3f8c0e1af6']).replace('{cause}',messages[key]),code+' '+source);
  }
  assert.equal(localizeText('GitHub a répondu avec le statut HTTP 503.',code),messages['diagnostic.githubStatus'].replace('{status}','503'),code);
 }
});
test('UI locales and RTL layout do not modify the web fingerprint locale policy',()=>{
 const preload=fs.readFileSync(path.join(root,'src/preload.cjs'),'utf8');
 assert.match(preload,/document\.documentElement\.dir\s*=/);
 assert.doesNotMatch(preload,/navigator\s*\.\s*(?:language|languages)\s*=/);
 const main=fs.readFileSync(path.join(root,'src/main.cjs'),'utf8');
 assert.match(main,/settings\.verticalTabs && isRightToLeft\(settings\.language\)/);
 assert.match(main,/promptHttpAuth\(\{[^\n]+language: settings\.language/);
});

test('French messages written in source code can be localized through the French catalogue',()=>{
 const french=Object.values(require('../src/locales/fr.json')),missing=[];
 for(const file of fs.readdirSync(path.join(root,'src')).filter(f=>/\.(?:cjs|js)$/.test(f))){
  fs.readFileSync(path.join(root,'src',file),'utf8').split('\n').forEach((line,index)=>{
   if(/^\s*\/\//.test(line))return;
   for(const match of line.matchAll(/'([^'\n]*)'|`([^`\n]*)`|"([^"\n]*)"/g)){
    const text=match[1]??match[2]??match[3];
    if(!/[éèàêçôûîœÉÀ]/.test(text)||!/\s/.test(text))continue;
    const parts=text.split(/\$\{[^}]*\}/).map(part=>part.trim()).filter(part=>part.length>3);
    if(!parts.every(part=>french.some(value=>value.includes(part))))missing.push(file+':'+(index+1));
   }
  });
 }
 assert.deepEqual(missing,[]);
});
