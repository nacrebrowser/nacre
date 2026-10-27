'use strict';
// Deterministic local vector rasterization for the Windows app icon.
const fs=require('node:fs'),path=require('node:path');
if(!process.versions.electron){
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const result=require('node:child_process').spawnSync(require('electron'),[__filename],{env,windowsHide:true,encoding:'utf8',timeout:30000});
 process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');if(result.error)console.error(result.error);
 process.exitCode=result.status??1;
}else{
 const {app,BrowserWindow}=require('electron'),os=require('node:os');
 const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'na-brand-'));
 app.setPath('userData',temp);app.setPath('sessionData',path.join(temp,'session'));
 app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:512,height:512,useContentSize:true,frame:false,show:false,transparent:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  const svg=fs.readFileSync(path.join(root,'src/logo.svg'),'utf8');
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<style>html,body{margin:0;width:512px;height:512px;background:transparent}svg{width:512px;height:512px;display:block}</style>'+svg));
  win.showInactive();await new Promise(r=>setTimeout(r,200));
  const captured=await win.webContents.capturePage();
  fs.writeFileSync(path.join(root,'src/icon.png'),captured.toPNG());
  const sizes=[16,32,48,64,128,256],images=sizes.map(size=>captured.resize({width:size,height:size,quality:'best'}).toPNG());
  const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
  let offset=header.length;images.forEach((png,i)=>{const p=6+i*16;header[p]=sizes[i]===256?0:sizes[i];header[p+1]=header[p];header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(png.length,p+8);header.writeUInt32LE(offset,p+12);offset+=png.length;});
  fs.writeFileSync(path.join(root,'src/icon.ico'),Buffer.concat([header,...images]));
  console.log('BRAND_RENDER PASS: original SVG, 512px PNG and six-size ICO');win.destroy();app.quit();
 }).catch(error=>{console.error(error);app.exit(1);});
 app.on('will-quit',()=>{if(path.dirname(path.resolve(temp))!==path.resolve(os.tmpdir()))throw Error('Unsafe cleanup');try{fs.rmSync(temp,{recursive:true,force:true});}catch{}});
}
