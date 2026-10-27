'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const version=process.argv[2]||require('../package.json').nacreVersion||require('../package.json').version;
if(!/^[0-9]+(?:\.[0-9]+){2,3}$/.test(version))throw Error('Invalid display version');
const folder=path.resolve(__dirname,'../dist');
for(const line of fs.readFileSync(path.join(folder,'SHA256SUMS-'+version+'.txt'),'utf8').trim().split(/\r?\n/)){
 const match=/^([a-f0-9]{64})  (.+)$/.exec(line);if(!match||path.basename(match[2])!==match[2])throw Error('Invalid entry');
 const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(folder,match[2]))).digest('hex');if(actual!==match[1])throw Error('Checksum mismatch');console.log('SHA256 PASS '+match[2]);
}
