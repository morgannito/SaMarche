// Dimensions lues dans l'en-tête de l'image source, AVANT tout décodage
// (PNG, GIF, JPEG : les formats de la boîte de dialogue). null si inconnu.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Marqueurs SOF des JPEG (baseline, progressif, sans perte, arithmétique) ; hors C4, C8, CC.
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
// 400 Mo pour le seul tampon RGBA décodé dans le processus principal.
const MAX_SOURCE_PIXELS = 100000000;

function pngSize(b) {
  if (b.length < 24 || !b.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function gifSize(b) {
  if (b.length < 10 || !/^GIF8[79]a$/.test(b.toString('latin1', 0, 6))) return null;
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

// Parcourt les segments jusqu'au premier SOF (hauteur à +5, largeur à +7).
function jpegSize(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) { i += 1; continue; } // octet de remplissage
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; } // sans longueur
    if (marker === 0xd9 || marker === 0xda) return null; // fin ou données avant tout SOF
    if (JPEG_SOF.has(marker)) {
      return i + 8 < b.length ? { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) } : null;
    }
    const length = b.readUInt16BE(i + 2);
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
}

function readImageSize(buffer) {
  const size = pngSize(buffer) || gifSize(buffer) || jpegSize(buffer);
  return size && size.width > 0 && size.height > 0 ? size : null;
}

// null si la source peut être décodée, sinon la raison du refus.
function sourceProblem(buffer) {
  const size = readImageSize(buffer);
  if (!size) return 'unsupported';
  return size.width * size.height > MAX_SOURCE_PIXELS ? 'too-large' : null;
}

module.exports = { MAX_SOURCE_PIXELS, readImageSize, sourceProblem };
