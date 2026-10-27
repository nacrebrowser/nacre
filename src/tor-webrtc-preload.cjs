const { contextBridge } = require('electron');

// Registered only while a Tor route is connecting or active. The preload runs
// for each frame before page scripts, then applies the API removal to Chromium's
// main world; editing this isolated preload world alone would not affect sites.
contextBridge.executeInMainWorld({
  func: () => {
    const hiddenGlobals = [
      'RTCPeerConnection',
      'webkitRTCPeerConnection',
      'RTCSessionDescription',
      'RTCIceCandidate',
      'getUserMedia',
      'webkitGetUserMedia',
      'mozGetUserMedia'
    ];
    for (const name of hiddenGlobals) {
      try {
        Object.defineProperty(globalThis, name, {
          configurable: false,
          enumerable: false,
          value: undefined,
          writable: false
        });
      } catch {}
    }
    try {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: false,
        enumerable: false,
        value: undefined,
        writable: false
      });
    } catch {}
  }
});
