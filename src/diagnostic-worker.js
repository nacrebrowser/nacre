'use strict';
const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(16,16):null;
postMessage({javascript:true,node:typeof require,process:typeof process,offscreen:!!canvas,webgl:canvas?!!canvas.getContext('webgl'):null,language:navigator.language,languages:[...navigator.languages],cores:navigator.hardwareConcurrency,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
