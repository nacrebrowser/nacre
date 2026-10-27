'use strict';
const canvas=document.createElement('canvas');
parent.postMessage({javascript:true,node:typeof require,process:typeof process,webgl:!!canvas.getContext('webgl'),webgl2:!!document.createElement('canvas').getContext('webgl2'),language:navigator.language,languages:[...navigator.languages],timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone},'*');
