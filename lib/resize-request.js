// Validation d'une demande de redimensionnement venue de la page (non fiable).
const MAX_DIMENSION = 10000;
// Surface maximale de sortie : 160 Mo pour le seul tampon RGBA décodé dans le
// processus principal (pic réel plus haut, non mesuré).
const MAX_PIXELS = 40000000;

// Entier décimal de 1 à MAX_DIMENSION, sinon null ('1e3', '10.5', '0x10' refusés).
function parseDimension(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= MAX_DIMENSION ? n : null;
}

// Ne garde que width et height ; tout autre champ (imgPath, dest…) est ignoré.
function parseResizeRequest(request) {
  if (!request || typeof request !== 'object') return null;
  const width = parseDimension(request.width);
  const height = parseDimension(request.height);
  if (!width || !height || width * height > MAX_PIXELS) return null;
  return { width, height };
}

module.exports = { MAX_DIMENSION, MAX_PIXELS, parseDimension, parseResizeRequest };
