const os = require('os');
const path = require('path');
const { contextBridge, ipcRenderer } = require('electron');
const Toastify = require('toastify-js');

contextBridge.exposeInMainWorld('os', {
  homedir: () => os.homedir(),
});

contextBridge.exposeInMainWorld('path', {
  join: (...args) => path.join(...args),
});

// Les canaux sont fixés ici : la page n'en choisit jamais un et ne reçoit
// jamais l'objet event (event.sender = accès à tout ipcRenderer).
function subscribe(channel, callback) {
  if (typeof callback !== 'function') {
    throw new TypeError(`${channel} : une fonction est attendue`);
  }
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('api', {
  // Le chemin est choisi dans une boîte de dialogue du main, jamais par la page.
  chooseImage: () => ipcRenderer.invoke('image:choose'),
  resizeImage: ({ width, height }) =>
    ipcRenderer.send('image:resize', { width, height }),
  scanWifi: () => ipcRenderer.send('scan:wifi'),
  onImageDone: (callback) => subscribe('image:done', callback),
  onImageError: (callback) => subscribe('image:error', callback),
});

contextBridge.exposeInMainWorld('Toastify', {
  toast: (options) => Toastify(options).showToast(),
});
