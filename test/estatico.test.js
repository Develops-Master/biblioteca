// Coherencia entre archivos: evita olvidos al agregar un .js nuevo y que vuelvan las librerías innecesarias.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

const scriptsDe = html => [...leer(html).matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
const locales = html => scriptsDe(html).filter(s => !/^https?:/.test(s));

test('cada .js local que cargan los HTML existe y está en el servidor, el service worker y el build', () => {
  const sw = leer('sw.js'), server = leer('server.js'), build = leer('build.js');
  for (const html of ['index.html', 'login.html', 'modo-rapido.html']) {
    for (const js of locales(html)) {
      assert.ok(fs.existsSync(path.join(RAIZ, js)), `${html} carga ${js} que no existe`);
      assert.ok(sw.includes(`'./${js}'`), `${js} falta en APP_SHELL de sw.js`);
      assert.ok(server.includes(`'${js}'`), `${js} falta en ARCHIVOS_PUBLICOS de server.js`);
      assert.ok(build.includes(`'${js}'`), `${js} falta en ARCHIVOS_JS de build.js`);
    }
  }
});

test('index.html no carga al abrir las librerías que la biblioteca no usa', () => {
  const externos = scriptsDe('index.html').filter(s => /^https?:/.test(s)).join('\n');
  for (const lib of ['Chart.js', 'JsBarcode', 'tesseract']) assert.ok(!externos.includes(lib), `${lib} no debe cargarse al abrir`);
  for (const lib of ['qrcode-generator', 'xlsx', 'qr-scanner']) assert.ok(externos.includes(lib), `${lib} sí la usa la biblioteca`);
  // y siguen disponibles bajo demanda
  const core = leer('core.js');
  for (const lib of ['Chart.js', 'JsBarcode', 'tesseract']) assert.ok(core.includes(lib), `${lib} debe poder cargarse bajo demanda`);
});

test('la versión del service worker cambió respecto a la anterior (los navegadores deben bajar lo nuevo)', () => {
  const v = Number(/sigie-v(\d+)/.exec(leer('sw.js'))[1]);
  assert.ok(v >= 26);
});

test('las bibliotecas que la biblioteca sí usa siguen cargadas donde hacen falta', () => {
  const usa = (archivo, global) => new RegExp('\\b' + global + '\\b').test(leer(archivo));
  assert.ok(usa('biblioteca.js', 'QRCode') || usa('biblioteca.js', 'qrcode'));
  assert.ok(usa('biblioteca.js', 'XLSX'));
});
