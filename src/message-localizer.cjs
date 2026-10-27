'use strict';
const {getMessages}=require('./i18n.cjs');
const french=require('./locales/fr.json'),english=require('./locales/en.json');
const exact=new Map();
for(const catalogue of [english,french])for(const[key,value]of Object.entries(catalogue))if(!key.startsWith('_'))exact.set(value,key);
const templates=[];
const prefixes=[];
for(const [source,key]of exact){
 if(key==='diagnostic.torBridgeFailure'||!/^(?:diagnostic\.|toast\.|tor\.)/.test(key))continue;
 if(source.length>=16&&/:\s*$/.test(source))prefixes.push({source,key});
 if(!/\{[A-Za-z0-9_]+\}/.test(source)||source.length>2500)continue;
 const slots=[],parts=[];let offset=0;
 for(const match of source.matchAll(/\{([A-Za-z0-9_]+)\}/g)){
  parts.push(source.slice(offset,match.index));slots.push(match[1]);offset=match.index+match[0].length;
 }
 parts.push(source.slice(offset));
 if(slots.length<=4&&parts[0].length>=4&&parts.slice(1,-1).every(Boolean))templates.push({key,slots,parts});
}
function localizeText(value,language){
 if(typeof value!=='string'||value.length>8192)return value;
 value=value.replace(/^Error invoking remote method '[a-z0-9:-]+': Error: /i,'');
 const messages=getMessages(language),key=exact.get(value);if(key)return messages[key]||value;
 const bridge=/^Pont ([^·\n]{1,120}) · ([^\n]{1,200})\. Cette cause reste indicative\.$/.exec(value);
 if(bridge&&exact.has(bridge[2])){
  const label=bridge[1].replace('pont personnalisé',messages['diagnostic.tordiagnosticscjs.textd54e11136e']).replace(/ sélectionné$/, ' '+messages['diagnostic.tordiagnosticscjs.text3f8c0e1af6']);
  return messages['diagnostic.torBridgeFailure'].replace('{bridge}',label).replace('{cause}',messages[exact.get(bridge[2])]);
 }
 for(const template of templates){
  if(!value.startsWith(template.parts[0]))continue;
  let offset=template.parts[0].length;const values=[];
  for(let i=1;i<template.parts.length;i++){
   const part=template.parts[i],last=i===template.parts.length-1;
   const end=last?value.length-part.length:value.indexOf(part,offset);
   if(end<offset||end-offset>2048||value.slice(end,end+part.length)!==part)break;
   values.push(value.slice(offset,end));offset=end+part.length;
  }
  if(values.length!==template.slots.length||offset!==value.length)continue;
  return (messages[template.key]||value).replace(/\{([A-Za-z0-9_]+)\}/g,(token,name)=>{const index=template.slots.indexOf(name);return index<0?token:values[index];});
 }
 for(const prefix of prefixes)if(value.startsWith(prefix.source))return (messages[prefix.key]||prefix.source).trimEnd()+' '+value.slice(prefix.source.length);
 return value;
}
module.exports={localizeText};
