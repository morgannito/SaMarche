// Banc du verrou « un scan à la fois » : un script python qui ne rend jamais
// la main ne bloque pas les scans suivants (délai réduit à 200 ms ici).
// Usage : npm run test:e2e  (code de sortie 0 = vert)
process.env.NODE_ENV = 'production';
process.env.SCAN_TIMEOUT_MS = '200';
const path = require('path');
const childProcess = require('child_process');
const electron = require('electron');
const { creerBilan, poll, executerEtapes, faussePython } = require('./e2e-outils');

const { app } = electron;
const { check, codeSortie } = creerBilan();
const enfants = [];

childProcess.spawn = (cmd, args) => {
  const enfant = faussePython(cmd, args);
  enfants.push(enfant);
  return enfant;
};
// Barrière d'ordre : le main traite send et invoke dans l'ordre d'arrivée.
electron.dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
const barriere = (ev) => ev('window.api.chooseImage()');

async function verifierDelai(ev) {
  await ev('window.api.scanWifi(), window.api.scanWifi(), true');
  await barriere(ev);
  check('pendant le scan, aucun 2e script', enfants.length === 1, enfants.length);
  const tue = await poll(() => enfants[0].tue, 2000);
  check('script bloqué tué au bout du délai', tue === true, tue);
  await ev('window.api.scanWifi(), true');
  check('verrou rendu après le délai', !!(await poll(() => enfants[1], 2000)), enfants.length);
}

// 'exit' sans 'close' (stdout gardé ouvert par un sous-processus) : verrou rendu
// tout de suite, sans attendre le délai.
async function verifierExitSeul(ev) {
  enfants[1].emit('exit', 0);
  await ev('window.api.scanWifi(), true');
  await barriere(ev);
  check('verrou rendu sur exit seul', enfants.length === 3, enfants.length);
}

app.once('browser-window-created', (_e, win) => {
  win.hide();
  const ev = (js) => win.webContents.executeJavaScript(js, true);
  win.webContents.once('did-finish-load', () =>
    executerEtapes([() => verifierDelai(ev), () => verifierExitSeul(ev)], check)
      .finally(() => app.exit(codeSortie())));
});
setTimeout(() => { console.log('FAIL délai dépassé'); app.exit(2); }, 30000).unref();
require(path.join(__dirname, '..', 'main.js'));
