// Banc de la frontière IPC (issue #5) : lance le vrai main.js dans Electron,
// puis vérifie depuis la page ce que le renderer peut écouter et envoyer.
// Usage : npm run test:e2e  (code de sortie 0 = vert)
process.env.NODE_ENV = 'production'; // pas de DevTools
const path = require('path');
const { app, ipcMain } = require('electron');
const { creerBilan, poll, executerEtapes } = require('./e2e-outils');

const API_ATTENDUE = ['chooseImage', 'onImageDone', 'onImageError', 'resizeImage', 'scanWifi'];
const FAIT = { width: 1, height: 1 }; // contrat : image:done porte les dimensions produites
const SECRET = 'JETON-SECRET';
const { check, codeSortie } = creerBilan();
const erreursPage = [];

// Barrière d'ordre : les messages IPC vers une même page sont livrés dans
// l'ordre. Un image:done envoyé APRÈS les messages testés fait apparaître
// un toast de renderer.js ; une fois ce toast visible, les messages
// précédents ont forcément été traités.
async function barriere(wc, ev) {
  const avant = await ev('document.querySelectorAll(".toastify").length');
  wc.send('image:done', FAIT);
  const vu = await poll(() => ev(`document.querySelectorAll(".toastify").length > ${avant}`));
  if (!vu) throw new Error('barrière : aucun toast de renderer.js');
}

async function verifierSurface(ev) {
  const s = await ev(`({ req: typeof window.require, ipc: typeof window.ipcRenderer,
    api: window.api ? Object.keys(window.api).sort() : null })`);
  check('page sans require Node', s.req === 'undefined', s.req);
  check('ipcRenderer brut non exposé', s.ipc === 'undefined', s.ipc);
  check('API métier exacte', JSON.stringify(s.api) === JSON.stringify(API_ATTENDUE), s.api);
}

// Cas INTERDIT : la page essaie de s'abonner à un canal de son choix avec
// toute fonction exposée de type on*, puis le main émet un secret.
async function verifierCanalEtranger(wc, ev) {
  await ev(`(() => { window.__espion = [];
    const espion = (...a) => window.__espion.push(a);
    for (const o of [window.ipcRenderer, window.api].filter(Boolean))
      for (const [k, f] of Object.entries(o))
        if (typeof f === 'function' && /^on/i.test(k)) {
          for (const args of [[espion], ['secret:jeton', espion]]) {
            try { f(...args); } catch (e) {} } }
    return true; })()`);
  wc.send('secret:jeton', SECRET);
  wc.send('scan:wifi', SECRET);
  await barriere(wc, ev);
  const espion = await ev('JSON.stringify(window.__espion)');
  check('aucune donnée d’un canal non prévu', !espion.includes(SECRET), espion);
  check('témoin : la sonde est bien abonnée (reçoit la barrière)', espion !== '[]', espion);
}

async function verifierToastRenderer(ev) {
  const texte = await ev('[...document.querySelectorAll(".toastify")].map(t => t.textContent).join("|")');
  check('renderer.js reçoit image:done (toast)', texte.includes('Image resized'), texte);
}

async function verifierDesabonnement(wc, ev) {
  const off = await ev(`(() => { window.__recus = [];
    window.__off = window.api.onImageDone((...a) => window.__recus.push(a));
    return typeof window.__off; })()`);
  check('onImageDone rend une fonction de retrait', off === 'function', off);
  await barriere(wc, ev);
  const recus = await ev('JSON.stringify(window.__recus)');
  check('callback : données seules, sans objet event', recus === JSON.stringify([[FAIT]]), recus);
  await ev('window.__off(), true');
  await barriere(wc, ev);
  const apres = await ev('window.__recus.length');
  check('plus rien reçu après retrait', apres === 1, apres);
}

async function verifierEnvoiRedimension(ev) {
  // En tête de file : le handler de main.js ajoute lui-même opts.dest.
  let recu = null;
  ipcMain.prependOnceListener('image:resize', (_e, opts) => { recu = { ...opts }; });
  await ev(`window.api.resizeImage({ imgPath: '/nonexistent/x.png', width: '10',
    height: '20', dest: '/tmp/pwn' }), true`);
  await poll(() => recu);
  const cles = recu ? Object.keys(recu).sort() : null;
  check('resizeImage ne transmet que width/height', JSON.stringify(cles) === '["height","width"]', cles);
}

async function executer(win) {
  const wc = win.webContents;
  const ev = (js) => wc.executeJavaScript(js, true);
  await executerEtapes([() => verifierSurface(ev), () => verifierCanalEtranger(wc, ev),
    () => verifierToastRenderer(ev), () => verifierDesabonnement(wc, ev),
    () => verifierEnvoiRedimension(ev)], check);
  check('aucune erreur console/preload', erreursPage.length === 0, erreursPage);
}

function surveiller(win) {
  const wc = win.webContents;
  wc.on('console-message', (_e, niveau, msg) => { if (niveau >= 3) erreursPage.push(msg); });
  wc.on('preload-error', (_e, p, err) => erreursPage.push(`preload ${p}: ${err}`));
  wc.once('did-finish-load', () => executer(win).finally(() => app.exit(codeSortie())));
}

setTimeout(() => { console.log('FAIL délai dépassé'); app.exit(2); }, 30000).unref();
app.once('browser-window-created', (_e, win) => { win.hide(); surveiller(win); });
require(path.join(__dirname, '..', 'main.js'));
