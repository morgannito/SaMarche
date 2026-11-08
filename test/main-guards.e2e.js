// Banc des gardes du processus principal (issues #3, #1 et durcissement) :
// lance le vrai main.js avec boîte de dialogue, shell, spawn et HOME remplacés
// par des doublures.
// Usage : npm run test:e2e  (code de sortie 0 = vert)
process.env.NODE_ENV = 'production';
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const electron = require('electron');
const { creerBilan, poll, executerEtapes, faussePython } = require('./e2e-outils');

const { app, ipcMain, nativeImage, BrowserWindow } = electron;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'samarche-'));
process.env.HOME = TMP; // os.homedir() → sortie dans TMP/imageresizer
const CHOISIE = path.join(TMP, 'choisie', 'choisie.png');
const SECRET = path.join(TMP, 'secret', 'secret.png');
const SORTIE = path.join(TMP, 'imageresizer');
const { check, codeSortie } = creerBilan();
const exceptions = [];
const erreursPage = [];
const lus = [];
const enfants = [];
const doublures = { dialogue: 0, ouvertures: 0, echec: false };

function installerDoublures() {
  const lire = fs.readFileSync;
  fs.readFileSync = (p, ...r) => { lus.push(String(p)); return lire(p, ...r); };
  // Réponse différée : laisse le temps d'un double clic, boîte encore ouverte.
  electron.dialog.showOpenDialog = async () => {
    doublures.dialogue += 1;
    await new Promise((r) => setTimeout(r, 100));
    if (doublures.echec) throw new Error('boîte de dialogue indisponible');
    return { canceled: false, filePaths: [CHOISIE] };
  };
  electron.shell.openPath = async () => { doublures.ouvertures += 1; return ''; };
  childProcess.spawn = (cmd, args) => {
    const enfant = faussePython(cmd, args);
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

function emettreResize(sender, request) {
  try { ipcMain.emit('image:resize', { sender }, request); } catch (e) { exceptions.push(String(e)); }
}

// Cas INTERDIT (#3) : un chemin fourni par la page n'est jamais lu, même
// envoyé directement sur le canal (preload contourné).
function verifierCheminForge(wc) {
  lus.length = 0;
  emettreResize(wc, { imgPath: SECRET, width: '2', height: '2' });
  check('chemin forgé jamais lu (avant tout choix)', !lus.includes(SECRET), lus);
}

// Parcours réel de l'interface : bouton → boîte de dialogue du main → formulaire.
async function verifierChoixParBouton(ev) {
  await ev(`(() => { const b = document.querySelector('#chooseImage');
    b.click(); b.click(); return true; })()`);
  const visible = await poll(() => ev(`getComputedStyle(document.querySelector('#img-form')).display !== 'none'`));
  check('double clic → une seule boîte de dialogue du main', doublures.dialogue === 1, doublures);
  const nom = await ev(`document.querySelector('#filename').textContent`);
  check('formulaire affiché avec le nom du fichier', visible && nom === 'choisie.png', { visible, nom });
}

// Une autre page (fenêtre réelle) ne réutilise pas le choix de la première.
function verifierAutrePage() {
  const autre = new BrowserWindow({ show: false });
  lus.length = 0;
  emettreResize(autre.webContents, { width: '2', height: '2' });
  autre.destroy();
  check('une autre page ne réutilise pas le choix', lus.length === 0, lus);
}

function verifierDimensionsInvalides(wc) {
  lus.length = 0;
  for (const mauvaise of ['0', '-1', 'abc', '1e3', '10001']) {
    emettreResize(wc, { width: mauvaise, height: '2' });
  }
  check('dimensions invalides : aucun fichier lu', lus.length === 0, lus);
}

function dimensionsPng(fichier) {
  const b = fs.readFileSync(fichier);
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

const toastAffiche = (ev, texte) => poll(() => ev(`[...document.querySelectorAll('.toastify')]
  .some((t) => t.textContent.includes(${JSON.stringify(texte)}))`));

// Chemin RÉEL depuis le formulaire (invoke pour le choix, puis send) : prouve
// que e.sender est le même WebContents dans handle() et dans on().
async function verifierRedimensionLegitime(ev) {
  await ev(`(() => { document.querySelector('#width').value = '2';
    document.querySelector('#height').value = '3';
    document.querySelector('#img-form').requestSubmit(); return true; })()`);
  const sortie = path.join(SORTIE, 'choisie.png');
  const ecrit = await poll(() => fs.existsSync(sortie));
  check('image choisie redimensionnée en 2x3 (formulaire)', ecrit && dimensionsPng(sortie) === '2x3', ecrit);
  const toast = await toastAffiche(ev, 'Image resized to 3 x 2');
  check('image:done reçu par la page (toast)', toast, toast);
  check('dossier de sortie ouvert une fois', doublures.ouvertures === 1, doublures);
}

function verifierCheminForgeApresChoix(wc) {
  lus.length = 0;
  emettreResize(wc, { imgPath: SECRET, width: '2', height: '2' });
  check('chemin forgé ignoré même après le choix', !lus.includes(SECRET), lus);
}

// Échec de la boîte de dialogue : message affiché, pas de promesse non gérée
// (contrôlé par « aucune erreur console » en fin de banc).
async function verifierChoixEchoue(ev) {
  doublures.echec = true;
  await ev(`document.querySelector('#chooseImage').click(), true`);
  const vu = await toastAffiche(ev, 'Image selection failed');
  doublures.echec = false;
  check('échec du choix : message affiché', vu, vu);
}

async function verifierErreurSpawn(wc, ev) {
  const base = wc.listenerCount('destroyed');
  await ev('window.api.scanWifi(), true');
  const enfant = await poll(() => enfants[0]);
  check('scan:wifi lance toujours le même script', enfant && enfant.cmd === 'python'
    && JSON.stringify(enfant.args) === '["./renderer/python/scanWifi.py"]', enfant && enfant.args);
  check('écouteur destroyed posé sur la page qui scanne', wc.listenerCount('destroyed') === base + 1, base);
  let leve = null;
  // 'error' seul (sans 'close') : le verrou de scan doit quand même être rendu.
  try { enfant.emit('error', new Error('spawn python ENOENT')); } catch (e) { leve = String(e); }
  check('python absent : pas d’exception dans le main', leve === null, leve);
  check('écouteur destroyed retiré à la fin du script', wc.listenerCount('destroyed') === base, wc.listenerCount('destroyed'));
}

// Un seul scan à la fois par page ; le main traite les messages dans l'ordre,
// donc la réponse de chooseImage() garantit que les deux scans ont été vus.
async function verifierScanUnique(ev) {
  await ev('window.api.scanWifi(), window.api.scanWifi(), true');
  const choix = await ev('window.api.chooseImage()');
  check('la page ne reçoit que le nom du fichier', JSON.stringify(choix) === '{"name":"choisie.png"}', choix);
  check('après une erreur, un nouveau scan est permis', !!enfants[1], enfants.length);
  check('un seul scan à la fois par page', enfants.length === 2, enfants.length);
}

// Cas INTERDIT : la page quitte l'appli (navigation, nouvelle fenêtre).
async function verifierNavigation(wc, ev) {
  const fichier = path.join(TMP, 'ailleurs.html');
  fs.writeFileSync(fichier, '<p>ailleurs</p>');
  const ailleurs = JSON.stringify(`file://${fichier}`);
  const vu = { tentative: false, navigue: false };
  wc.once('will-navigate', () => { vu.tentative = true; });
  wc.once('did-navigate', () => { vu.navigue = true; });
  const fenetres = BrowserWindow.getAllWindows().length;
  await ev(`location.href = ${ailleurs}, true`);
  await poll(() => vu.tentative);
  await poll(() => vu.navigue, 1000); // absence attendue : borne de 1 s
  const url = await ev('location.href');
  check('navigation refusée (page intacte)', vu.tentative && !vu.navigue
    && url.endsWith('/renderer/index.html'), { ...vu, url });
  const ouverte = await ev(`String(window.open(${ailleurs}))`);
  check('window.open refusé', ouverte === 'null' && BrowserWindow.getAllWindows().length === fenetres, ouverte);
}

// #1 : la page disparaît pendant que le script tourne encore.
async function verifierFenetreFermee(win) {
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
  await executerEtapes([() => verifierCheminForge(wc), () => verifierChoixParBouton(ev),
    () => verifierAutrePage(), () => verifierDimensionsInvalides(wc),
    () => verifierRedimensionLegitime(ev), () => verifierCheminForgeApresChoix(wc),
    () => verifierChoixEchoue(ev), () => verifierErreurSpawn(wc, ev),
    () => verifierScanUnique(ev), () => verifierNavigation(wc, ev),
    () => verifierFenetreFermee(win)], check);
  check('aucune exception non capturée', exceptions.length === 0, exceptions);
  check('aucune erreur console dans la page', erreursPage.length === 0, erreursPage);
}

function terminer() {
  fs.rmSync(TMP, { recursive: true, force: true });
  app.exit(codeSortie());
}

process.on('uncaughtException', (e) => exceptions.push(String(e)));
setTimeout(() => { console.log('FAIL délai dépassé'); app.exit(2); }, 30000).unref();
installerDoublures();
app.once('browser-window-created', (_e, win) => {
  win.hide();
  ecrireImages();
  win.webContents.on('console-message', (_e2, niveau, msg) => { if (niveau >= 3) erreursPage.push(msg); });
  win.webContents.once('did-finish-load', () => executer(win).finally(terminer));
});
require(path.join(__dirname, '..', 'main.js'));
