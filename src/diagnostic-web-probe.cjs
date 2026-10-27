'use strict';
// Fixed diagnostic code only. No renderer-provided scripts or URLs are executed.
async function probeWebDocument() {
  function sample(realm) {
    const canvas = realm.document.createElement('canvas'); canvas.width = canvas.height = 8;
    const ctx = canvas.getContext('2d'); let red = null;
    if (ctx) { ctx.fillStyle = 'rgb(64,127,189)'; ctx.fillRect(0, 0, 8, 8); red = ctx.getImageData(0, 0, 1, 1).data[0]; }
    return { node: typeof realm.require, process: typeof realm.process, javascript: true,
      webgl: Boolean(realm.document.createElement('canvas').getContext('webgl')), webgl2: Boolean(realm.document.createElement('canvas').getContext('webgl2')),
      canvasRed: red, languages: Array.from(realm.navigator.languages), cores: realm.navigator.hardwareConcurrency,
      memory: realm.navigator.deviceMemory, timeZone: new realm.Intl.DateTimeFormat().resolvedOptions().timeZone,
      webRTC: typeof realm.RTCPeerConnection };
  }
  const report = { page: sample(window) };
  try {
    const frame = document.createElement('iframe'); frame.hidden = true;
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Frame unavailable')), 2000); frame.onload = () => { clearTimeout(timer); resolve(); }; frame.src = 'about:blank'; document.body.append(frame); });
    try { report.iframe = sample(frame.contentWindow); } finally { frame.remove(); }
  } catch { report.iframe = { unavailable: true }; }
  try {
    const workerFunction = () => {
      const canvas = new OffscreenCanvas(8,8), ctx = canvas.getContext('2d'); ctx.fillStyle = 'rgb(64,127,189)'; ctx.fillRect(0,0,8,8);
      postMessage({ node: typeof require, process: typeof process, javascript: true, languages: Array.from(navigator.languages), cores: navigator.hardwareConcurrency,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, webgl: Boolean(new OffscreenCanvas(8,8).getContext('webgl')), webgl2: Boolean(new OffscreenCanvas(8,8).getContext('webgl2')), canvasRed: ctx.getImageData(0,0,1,1).data[0] });
    };
    const url = URL.createObjectURL(new Blob(['(' + workerFunction.toString() + ')()'], { type: 'text/javascript' }));
    try {
      report.worker = await new Promise((resolve, reject) => {
        const worker = new Worker(url); const finish = (value, error) => { clearTimeout(timer); worker.terminate(); error ? reject(error) : resolve(value); };
        const timer = setTimeout(() => finish(null, Error('Worker timeout')), 3000);
        worker.onmessage = event => finish(event.data); worker.onerror = () => finish(null, Error('Worker blocked'));
      });
    } finally { URL.revokeObjectURL(url); }
  } catch { report.worker = { unavailable: true }; }
  try { report.network = JSON.parse((document.querySelector('pre')?.textContent || document.body.innerText).slice(0,32768)); } catch { report.network = null; }
  return report;
}
module.exports = { webProbeSource: '(' + probeWebDocument.toString() + ')()' };
