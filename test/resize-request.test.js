// Validation des dimensions reçues de la page (issue #7).
// Usage : npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDimension, parseResizeRequest, MAX_DIMENSION } = require('../lib/resize-request');

test('dimensions acceptées : entiers de 1 à MAX_DIMENSION', () => {
  for (const [entree, attendu] of [['1', 1], ['10', 10], [' 20 ', 20], [42, 42],
    [String(MAX_DIMENSION), MAX_DIMENSION]]) {
    assert.equal(parseDimension(entree), attendu, JSON.stringify(entree));
  }
});

test('dimensions refusées : zéro, négatif, décimal, notation exp., trop grand, vide', () => {
  for (const entree of ['0', '-1', '10.5', '1e3', 'abc', '', ' ', '0x10',
    String(MAX_DIMENSION + 1), '99999999999999999999', undefined, null, {}, [], NaN]) {
    assert.equal(parseDimension(entree), null, JSON.stringify(entree));
  }
});

test('requête complète : les deux dimensions valides, rien d’autre conservé', () => {
  assert.deepEqual(parseResizeRequest({ width: '10', height: '20', imgPath: '/etc/x' }),
    { width: 10, height: 20 });
});

test('requête refusée si une dimension manque ou est invalide', () => {
  for (const req of [null, undefined, 'x', {}, { width: '10' }, { height: '10' },
    { width: '0', height: '10' }, { width: '10', height: '-5' }]) {
    assert.equal(parseResizeRequest(req), null, JSON.stringify(req));
  }
});
