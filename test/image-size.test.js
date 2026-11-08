// Dimensions lues dans l'en-tête de l'image source, avant décodage.
// Usage : npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { readImageSize, sourceProblem, MAX_SOURCE_PIXELS } = require('../lib/image-size');

function png(width, height) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function gif(width, height, version = 'GIF89a') {
  const b = Buffer.alloc(13);
  b.write(version, 0, 'latin1');
  b.writeUInt16LE(width, 6);
  b.writeUInt16LE(height, 8);
  return b;
}

// SOI, APP0 (18 octets), puis SOF (19 octets), éventuellement précédé d'octets de remplissage.
function jpeg(width, height, sof = 0xc0, remplissage = 0) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.alloc(14)]);
  const seg = Buffer.alloc(19);
  seg[0] = 0xff; seg[1] = sof; seg.writeUInt16BE(17, 2); seg[4] = 8;
  seg.writeUInt16BE(height, 5);
  seg.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, Buffer.alloc(remplissage, 0xff), seg]);
}

test('PNG, GIF87a/89a, JPEG baseline et progressif : dimensions de l’en-tête', () => {
  assert.deepEqual(readImageSize(png(4000, 3000)), { width: 4000, height: 3000 });
  assert.deepEqual(readImageSize(gif(320, 200)), { width: 320, height: 200 });
  assert.deepEqual(readImageSize(gif(16, 9, 'GIF87a')), { width: 16, height: 9 });
  assert.deepEqual(readImageSize(jpeg(6000, 4000)), { width: 6000, height: 4000 });
  assert.deepEqual(readImageSize(jpeg(640, 480, 0xc2)), { width: 640, height: 480 });
  assert.deepEqual(readImageSize(jpeg(10, 20, 0xc0, 3)), { width: 10, height: 20 });
});

test('format inconnu, tronqué ou dimensions nulles : null', () => {
  const tronque = jpeg(10, 10).subarray(0, 25);
  const sansSof = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]);
  const pngSansIhdr = Buffer.from(png(4, 4));
  pngSansIhdr.write('IDAT', 12, 'latin1');
  for (const b of [Buffer.alloc(0), Buffer.from('pas une image'), png(4, 4).subarray(0, 20),
    pngSansIhdr, gif(4, 4, 'GIF90a'), tronque, sansSof, png(0, 10), gif(10, 0), jpeg(0, 0)]) {
    assert.equal(readImageSize(b), null, b.toString('hex').slice(0, 40));
  }
});

test('source refusée au-delà de MAX_SOURCE_PIXELS ou si le format est inconnu', () => {
  assert.equal(MAX_SOURCE_PIXELS, 100000000);
  assert.equal(sourceProblem(png(10000, 10000)), null);
  assert.equal(sourceProblem(png(10000, 10001)), 'too-large');
  assert.equal(sourceProblem(png(65535, 65535)), 'too-large');
  assert.equal(sourceProblem(Buffer.from('texte')), 'unsupported');
});
