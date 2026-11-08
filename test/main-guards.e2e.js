// Banc des gardes du processus principal (issues #3 et #1) : lance le vrai
// main.js avec boîte de dialogue, shell, spawn et HOME remplacés par des doublures.
// Usage : npm run test:e2e  (code de sortie 0 = vert)
process.env.NODE_ENV = 'production';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const childProcess = require('child_process');
const electron = require('electron');

const { app, ipcMain, nativeImage, BrowserWindow } = electron;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'samarche-'));
process.env.HOME = TMP; // os.homedir() → sortie dans TMP/imageresizer
const CHOISIE = path.join(TMP, 'choisie', 'choisie.png');
const SECRET = path.join(TMP, 'secret', 'secret.png');
const SORTIE = path.join(TMP, 'imageresizer');
const resultats = [];
const exceptions = [];
const lus = [];
const enfants = [];
const doublures = { dialogue: 0, ouvertures: 0 };

function check(nom, ok, detail) {
  resultats.push(ok);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nom}${ok ? '' : ` → ${JSON.stringify(detail)}`}`);
}

async function poll(lire, ms = 5000) {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await lire();
    if (v || Date.now() > fin) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
}

function faussePython() {
  const enfant = new EventEmitter();
  enfant.stdout = new EventEmitter();
  enfant.tue = false;
  enfant.kill = () => { enfant.tue = true; return true; };
  return enfant;
}

function installerDoublures() {
  const lire = fs.readFileSync;
  fs.readFileSync = (p, ...r) => { lus.push(String(p)); return lire(p, ...r); };
  electron.dialog.showOpenDialog = async () => {
    doublures.dialogue += 1;
    return { canceled: false, filePaths: [CHOISIE] };
  };
  electron.shell.openPath = async () => { doublures.ouvertures += 1; return ''; };
  childProcess.spawn = (cmd, args) => {
    const enfant = Object.assign(faussePython(), { cmd, args });
    enfants.push(enfant);
    return enfant;
  };
}

function ecrireImages() {
  const png = nativeImage.createFromBitmap(Buffer.alloc(4 * 4 * 4, 255), { width: 4, height: 4 }).toPNG();
  for (const f of [CHOISIE, SECRET]) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, png);
  }
}

// Cas INTERDIT (#3) : un chemin fourni par la page n'est jamais lu, même
// envoyé directement sur le canal (preload contourné).
function verifierCheminForge(wc) {
  lus.length = 0;
  try {
    ipcMain.emit('image:resize', { sender: wc }, { imgPath: SECRET, width: '2', height: '2' });
  } catch (e) { exceptions.push(String(e)); }
  check('chemin forgé jamais lu (avant tout choix)', !lus.includes(SECRET), lus);
}

async function verifierChoix(ev) {
  const choix = await ev('window.api.chooseImage()');
  check('choix par la boîte de dialogue du main', doublures.dialogue === 1, doublures);
  check('la page ne reçoit que le nom du fichier', JSON.stringify(choix) === '{"name":"choisie.png"}', choix);
}

function verifierDimensionsInvalides(wc) {
  lus.length = 0;
  for (const mauvaise of ['0', '-1', 'abc', '1e3', '10001']) {
    try {
      ipcMain.emit('image:resize', { sender: wc }, { width: mauvaise, height: '2' });
    } catch (e) { exceptions.push(String(e)); }
  }
  check('dimensions invalides : aucun fichier lu', lus.length === 0, lus);
}

function dimensionsPng(fichier) {
  const b = fs.readFileSync(fichier);
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

// Une autre page (fenêtre réelle) ne réutilise pas le choix de la première.
function verifierAutrePage() {
  const autre = new BrowserWindow({ show: false });
  lus.length = 0;
  try {
    ipcMain.emit('image:resize', { sender: autre.webContents }, { width: '2', height: '2' });
  } catch (e) { exceptions.push(String(e)); }
  autre.destroy();
  check('une autre page ne réutilise pas le choix', lus.length === 0, lus);
}

// Chemin RÉEL depuis la page (invoke pour le choix, puis send) : prouve que
// e.sender est le même WebContents dans handle() et dans on().
async function verifierRedimensionLegitime(ev) {
  await ev(`window.api.resizeImage({ width: '2', height: '3', imgPath: ${JSON.stringify(SECRET)} }), true`);
  const sortie = path.join(SORTIE, 'choisie.png');
  const ecrit = await poll(() => fs.existsSync(sortie));
  check('image choisie redimensionnée en 2x3 (chemin réel)', ecrit && dimensionsPng(sortie) === '2x3', ecrit);
  const toast = await poll(() => ev('document.querySelectorAll(".toastify").length > 0'));
  check('image:done reçu par la page (toast)', toast, toast);
  check('dossier de sortie ouvert une fois', doublures.ouvertures === 1, doublures);
}

function verifierCheminForgeApresChoix(wc) {
  lus.length = 0;
  try {
    ipcMain.emit('image:resize', { sender: wc }, { imgPath: SECRET, width: '2', height: '2' });
  } catch (e) { exceptions.push(String(e)); }
  check('chemin forgé ignoré même après le choix', !lus.includes(SECRET), lus);
}

async function verifierErreurSpawn(wc, ev) {
  const base = wc.listenerCount('destroyed');
  await ev('window.api.scanWifi(), true');
  const enfant = await poll(() => enfants[0]);
  check('scan:wifi lance toujours le même script', enfant && enfant.cmd === 'python'
    && JSON.stringify(enfant.args) === '["./renderer/python/scanWifi.py"]', enfant && enfant.args);
  check('écouteur destroyed posé sur la page qui scanne', wc.listenerCount('destroyed') === base + 1, base);
  let leve = null;
  try { enfant.emit('error', new Error('spawn python ENOENT')); enfant.emit('close', -2); } catch (e) { leve = String(e); }
  check('python absent : pas d’exception dans le main', leve === null, leve);
  check('écouteur destroyed retiré à la fin du script', wc.listenerCount('destroyed') === base, wc.listenerCount('destroyed'));
}

// #1 : la page disparaît pendant que le script tourne encore.
async function verifierFenetreFermee(win, ev) {
  await ev('window.api.scanWifi(), true');
  const enfant = await poll(() => enfants[1]);
  win.destroy();
  await poll(() => win.isDestroyed());
  let leve = null;
  try { enfant.stdout.emit('data', Buffer.from('ssid')); } catch (e) { leve = String(e); }
  check('sortie python après fermeture : pas d’exception', leve === null, leve);
  const tue = await poll(() => enfant.tue, 2000); // 'destroyed' suit isDestroyed()
  check('script python tué à la fermeture', tue === true, tue);
}

async function executer(win) {
  const wc = win.webContents;
  const ev = (js) => wc.executeJavaScript(js, true);
  const etapes = [() => verifierCheminForge(wc), () => verifierChoix(ev),
    () => verifierAutrePage(), () => verifierDimensionsInvalides(wc),
    () => verifierRedimensionLegitime(ev), () => verifierCheminForgeApresChoix(wc),
    () => verifierErreurSpawn(wc, ev), () => verifierFenetreFermee(win, ev)];
  for (const etape of etapes) {
    try { await etape(); } catch (e) { check(`étape ${etape}`.slice(0, 60), false, String(e)); }
  }
  check('aucune exception non capturée', exceptions.length === 0, exceptions);
}

function terminer() {
  fs.rmSync(TMP, { recursive: true, force: true });
  const echecs = resultats.filter((ok) => !ok).length;
  console.log(`${resultats.length - echecs}/${resultats.length} OK`);
  app.exit(echecs ? 1 : 0);
}

process.on('uncaughtException', (e) => exceptions.push(String(e)));
setTimeout(() => { console.log('FAIL délai dépassé'); app.exit(2); }, 30000).unref();
installerDoublures();
app.once('browser-window-created', (_e, win) => {
  win.hide();
  ecrireImages();
  win.webContents.once('did-finish-load', () => executer(win).finally(terminer));
});
require(path.join(__dirname, '..', 'main.js'));
