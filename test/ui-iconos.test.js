const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../ui-iconos.js');
const RAIZ = path.join(__dirname, '..');

test('iconoNav devuelve un SVG para ítems conocidos y el símbolo original para los desconocidos', () => {
  assert.ok(U.iconoNav('items', '▤').startsWith('<svg'));
  assert.strictEqual(U.iconoNav('noExiste', '◆'), '◆');
});

test('todos los ítems del menú tienen ícono de línea (no quedan emojis sueltos)', () => {
  const ids = new Set();
  for (const f of fs.readdirSync(RAIZ).filter(x => /\.js$/.test(x) && x !== 'ui-iconos.js')) {
    const src = fs.readFileSync(path.join(RAIZ, f), 'utf8');
    for (const m of src.matchAll(/\{\s*id:'([A-Za-z]+)',\s*ic:'/g)) ids.add(m[1]);
  }
  assert.ok(ids.size > 40);
  const sinIcono = [...ids].filter(id => !U.iconoNav(id, '').startsWith('<svg'));
  assert.deepStrictEqual(sinIcono, []);
});
