'use strict';
const {getCurrentFuseWire}=require('./electron-fuse-policy.cjs').loadFuseApi();
const path=require('node:path');
(async()=>{for(const name of ['node_modules/electron/dist/electron.exe','dist/win-unpacked/Nacre.exe']) console.log(name,await getCurrentFuseWire(path.resolve(__dirname,'..',name)));})().catch(error=>{console.error(error);process.exitCode=1;});
