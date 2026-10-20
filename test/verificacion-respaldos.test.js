// Servidor real: verificación pública de diplomas y copia de respaldo a una carpeta externa.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
let puerto = 4700 + Math.floor(Math.random() * 400);
const T = v => JSON.stringify(v);

async function iniciar(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigie-ver-'));
  const p = puerto++;
  const hijo = spawn(process.execPath, [path.join(RAIZ, 'server.js')], { env: { ...process.env, PORT: String(p), SIGIE_DATA_DIR: dir, ...(env || {}) }, stdio: 'ignore' });
  const url = 'http://127.0.0.1:' + p;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(url + '/api/health')).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 100)); }
  return { url, dir, parar: () => { hijo.kill(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
class Cliente {
  constructor(url) { this.url = url; this.cookie = ''; }
  async pedir(metodo, ruta, cuerpo) {
    const r = await fetch(this.url + ruta, { method: metodo, headers: { ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}) }, body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) { const par = sc.split(';')[0]; this.cookie = par.endsWith('=') ? '' : par; }
    let datos = null, texto = ''; try { texto = await r.text(); datos = JSON.parse(texto); } catch (e) {}
    return { status: r.status, datos, texto, cabeceras: r.headers };
  }
}
async function admin(url) {
  const c = new Cliente(url);
  await c.pedir('POST', '/api/login', { usuario: 'admin', password: 'admin123' });
  assert.strictEqual((await c.pedir('POST', '/api/password', { nueva: 'ClaveSegura#2026' })).status, 200);
  return c;
}
const DIPLOMAS = [
  { id: 'd1', codigo: 'D-ABCD-2345', nombre: 'ROSAS DE LA CRUZ DAPHNE', grado: '3° A Primaria', dni: '12345678', tel: '999111222', titulo: 'Nivel Sabio Lector', fecha: '2026-10-15', folio: 3, anio: 2026, emitidoPor: 'Bibliotecaria', recibidoPor: 'La mamá' },
  { id: 'd2', codigo: 'D-WXYZ-6789', nombre: 'LUIS SOTO', titulo: 'Lector del año', folio: 4, anio: 2026, anulado: true }
];

test('verificar: SIN sesión confirma un diploma auténtico, pero solo con el nombre enmascarado y sin datos personales', async () => {
  const s = await iniciar();
  try {
    const a = await admin(s.url);
    assert.strictEqual((await a.pedir('PUT', '/api/db/item', { key: 'sigie:bib_diplomas', value: T(DIPLOMAS) })).status, 200);
    assert.strictEqual((await a.pedir('PUT', '/api/db/item', { key: 'sigie:config', value: T({ nombreIE: 'IE 20150 Mariscal Benavides' }) })).status, 200);
    const anon = new Cliente(s.url);
    const ok = await anon.pedir('GET', '/api/verificar?c=' + encodeURIComponent('d-abcd-2345'));
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.datos.valido, true);
    assert.strictEqual(ok.datos.institucion, 'IE 20150 Mariscal Benavides');
    assert.strictEqual(ok.datos.folio, 'N.° 0003-2026');
    assert.strictEqual(ok.cabeceras.get('cache-control'), 'no-store');
    for (const secreto of ['ROSAS', 'DAPHNE', '12345678', '999111222', '3° A', 'Bibliotecaria', 'La mamá']) assert.ok(!ok.texto.includes(secreto), 'no debe filtrar ' + secreto);
    // la URL completa del QR también sirve
    assert.strictEqual((await anon.pedir('GET', '/api/verificar?c=' + encodeURIComponent('http://x/verificar.html?c=D-ABCD-2345'))).datos.valido, true);
    const anulado = await anon.pedir('GET', '/api/verificar?c=D-WXYZ-6789');
    assert.deepStrictEqual([anulado.datos.valido, anulado.datos.motivo], [false, 'anulado']);
    assert.ok(!anulado.texto.includes('LUIS'), 'un diploma anulado tampoco muestra el nombre');
    assert.strictEqual((await anon.pedir('GET', '/api/verificar?c=D-ZZZZ-2222')).datos.motivo, 'no_encontrado');
    assert.strictEqual((await anon.pedir('GET', '/api/verificar?c=hola')).datos.motivo, 'formato');
    assert.strictEqual((await anon.pedir('GET', '/api/verificar')).datos.motivo, 'formato');
  } finally { s.parar(); }
});

test('verificar: sigue sin dar acceso a nada más y limita los intentos (no se pueden probar códigos al azar)', async () => {
  const s = await iniciar();
  try {
    const anon = new Cliente(s.url);
    assert.strictEqual((await anon.pedir('GET', '/api/db/item?key=' + encodeURIComponent('sigie:bib_diplomas'))).status, 401, 'la base sigue protegida');
    assert.strictEqual((await anon.pedir('GET', '/api/respaldos')).status, 401);
    const estados = [];
    for (let i = 0; i < 35; i++) estados.push((await anon.pedir('GET', '/api/verificar?c=D-AAAA-' + String(2222 + i))).status);
    assert.ok(estados.slice(0, 30).every(e => e === 200), 'los primeros 30 intentos pasan');
    assert.ok(estados.slice(30).every(e => e === 429), 'desde el 31 se bloquea');
  } finally { s.parar(); }
});

test('verificar.html se abre sin iniciar sesión', async () => {
  const s = await iniciar();
  try {
    const r = await new Cliente(s.url).pedir('GET', '/verificar.html');
    assert.strictEqual(r.status, 200);
    assert.ok(r.texto.includes('Verificar diploma') && r.texto.includes('/api/verificar'));
    for (const f of ['lectometro.js', 'diplomas.js', 'lectometro-util.js', 'diplomas-util.js']) assert.strictEqual((await new Cliente(s.url).pedir('GET', '/' + f)).status, 200, f);
  } finally { s.parar(); }
});

test('respaldos: sin carpeta externa el estado lo dice y no se puede copiar; los no administradores no ven nada', async () => {
  const s = await iniciar();
  try {
    const a = await admin(s.url);
    const r = await a.pedir('GET', '/api/respaldos');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.datos.externo.configurado, false);
    assert.ok(Array.isArray(r.datos.locales));
    assert.strictEqual((await a.pedir('POST', '/api/respaldos/copiar', {})).status, 400);
  } finally { s.parar(); }
});

test('respaldos: con SIGIE_BACKUP_DIR el respaldo diario también se copia afuera y "Copiar ahora" funciona', async () => {
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'sigie-ext-'));
  const s = await iniciar({ SIGIE_BACKUP_DIR: path.join(ext, 'otra', 'carpeta') });
  try {
    const a = await admin(s.url);
    const copiar = await a.pedir('POST', '/api/respaldos/copiar', {});
    assert.strictEqual(copiar.status, 200, JSON.stringify(copiar.datos));
    assert.strictEqual(copiar.datos.ok, true);
    const hoy = new Date().toISOString().slice(0, 10);
    const archivo = path.join(ext, 'otra', 'carpeta', 'sigie-' + hoy + '.db');
    assert.ok(fs.existsSync(archivo), 'la copia existe en la carpeta externa (creada si no existía)');
    assert.ok(fs.statSync(archivo).size > 1000, 'no está vacía');
    const estado = (await a.pedir('GET', '/api/respaldos')).datos;
    assert.deepStrictEqual([estado.externo.configurado, estado.externo.ok], [true, true]);
  } finally { s.parar(); fs.rmSync(ext, { recursive: true, force: true }); }
});

test('respaldos: si la carpeta externa no se puede usar, lo avisa en vez de callar', async () => {
  const archivoQueEsArchivo = path.join(os.tmpdir(), 'sigie-no-carpeta-' + Date.now());
  fs.writeFileSync(archivoQueEsArchivo, 'x');
  const s = await iniciar({ SIGIE_BACKUP_DIR: path.join(archivoQueEsArchivo, 'dentro') });
  try {
    const a = await admin(s.url);
    const r = await a.pedir('POST', '/api/respaldos/copiar', {});
    assert.strictEqual(r.status, 500);
    assert.strictEqual(r.datos.ok, false);
    assert.ok(r.datos.externo.error.length > 0);
    assert.strictEqual((await a.pedir('GET', '/api/respaldos')).datos.externo.ok, false);
  } finally { s.parar(); fs.rmSync(archivoQueEsArchivo, { force: true }); }
});
