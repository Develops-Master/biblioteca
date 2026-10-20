// Evita que vuelvan a desincronizarse las versiones (antes: manifest 7.0.0, package 10.0.0, zip v11).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const leer = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('manifest.json y package.json tienen la misma versión', () => {
  assert.strictEqual(JSON.parse(leer('manifest.json')).version, JSON.parse(leer('package.json')).version);
});
test('el service worker precachea todos los scripts que carga index.html (y verificar.html)', () => {
  const sw = leer('sw.js'), idx = leer('index.html');
  const scripts = [...idx.matchAll(/<script src="([^"]+\.js)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s));
  for (const s of scripts) assert.ok(sw.includes("'./" + s + "'"), s + ' falta en sw.js');
  assert.ok(sw.includes("'./verificar.html'"));
});
test('build.js minifica los mismos scripts y copia verificar.html', () => {
  const b = leer('build.js'), idx = leer('index.html');
  for (const m of idx.matchAll(/<script src="([^"]+\.js)"/g)) if (!/^https?:/.test(m[1])) assert.ok(b.includes("'" + m[1] + "'"), m[1] + ' falta en build.js');
  assert.ok(b.includes("'verificar.html'"));
});
