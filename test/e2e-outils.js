// Outils communs aux bancs Electron (test/*.e2e.js).
const { EventEmitter } = require('events');

function creerBilan() {
  const resultats = [];
  function check(nom, ok, detail) {
    resultats.push(ok);
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${nom}${ok ? '' : ` → ${JSON.stringify(detail)}`}`);
  }
  function codeSortie() {
    const echecs = resultats.filter((ok) => !ok).length;
    console.log(`${resultats.length - echecs}/${resultats.length} OK`);
    return echecs ? 1 : 0;
  }
  return { check, codeSortie };
}

// Relit un état réel jusqu'à ce qu'il soit vrai, borné à `ms`.
async function poll(lire, ms = 5000) {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await lire();
    if (v || Date.now() > fin) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function executerEtapes(etapes, check) {
  for (const etape of etapes) {
    try { await etape(); } catch (e) { check(`étape ${etape}`.slice(0, 60), false, String(e)); }
  }
}

// Faux processus python : kill() noté, événements émis par le test.
function faussePython(cmd, args) {
  const enfant = new EventEmitter();
  Object.assign(enfant, { cmd, args, tue: false, stdout: new EventEmitter() });
  enfant.kill = () => { enfant.tue = true; return true; };
  return enfant;
}

module.exports = { creerBilan, poll, executerEtapes, faussePython };
