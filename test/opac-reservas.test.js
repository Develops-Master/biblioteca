// Integración: reservas desde el catálogo público contra el servidor real (HTTP, datos temporales).
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const T = v => JSON.stringify(v);
async function arrancar() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigie-opac-')), puerto = 4400 + Math.floor(Math.random() * 400);
  const hijo = spawn(process.execPath, [path.join(RAIZ, 'server.js')], { env: { ...process.env, PORT: String(puerto), SIGIE_DATA_DIR: dir }, stdio: 'ignore' });
  const url = 'http://127.0.0.1:' + puerto;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(url + '/api/health')).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 100)); }
  return { url, parar: () => { hijo.kill(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const post = async (url, ruta, cuerpo, cab) => { const r = await fetch(url + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cab || {}) }, body: JSON.stringify(cuerpo) }); let d = null; try { d = await r.json(); } catch (e) {} return { status: r.status, datos: d }; };

test('OPAC reservas: apagadas por defecto, activadas por la bibliotecaria, y solo escriben una reserva en espera', async () => {
  const s = await arrancar();
  try {
    // Sesión de administrador para sembrar datos (el público no puede escribir nada más).
    const l = await post(s.url, '/api/login', { usuario: 'admin', password: 'admin123' });
    let cookie = ''; { const r = await fetch(s.url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'admin', password: 'admin123' }) }); cookie = (r.headers.get('set-cookie') || '').split(';')[0]; }
    assert.strictEqual(l.status, 200);
    const cab = { Cookie: cookie };
    assert.strictEqual((await post(s.url, '/api/password', { nueva: 'ClaveSegura#2026' }, cab)).status, 200);
    const put = (key, v) => fetch(s.url + '/api/db/item', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...cab }, body: JSON.stringify({ key, value: T(v) }) }).then(r => r.status);
    assert.strictEqual(await put('sigie:bib_libros', [{ id: 'b', cod: 'CIE-001', titulo: 'Átomos', cant: 1 }]), 200);
    await put('sigie:bib_lectores', [{ id: 'l1', cod: 'LEC-0001', nombre: 'PEREZ, JUAN', dni: '12345678', grado: 'Primaria · 3° A' }, { id: 'l4', cod: 'LEC-0004', nombre: 'OTRO', dni: '99995678' }]);
    await put('sigie:bib_prestamos', [{ id: 'p', libroId: 'b', lectorId: 'l4', fecha: '2026-10-10', vence: '2026-10-20', devuelto: '' }]);

    const cuerpo = { libroId: 'b', cod: 'LEC-0001', clave: '5678' };
    let r = await post(s.url, '/api/opac/reservar', cuerpo); assert.strictEqual(r.datos.codigo, 'APAGADO');
    assert.strictEqual((await (await fetch(s.url + '/api/opac')).json()).reservas, false);

    await put('sigie:bib_config', { opacReservas: true });
    assert.strictEqual((await (await fetch(s.url + '/api/opac')).json()).reservas, true);
    r = await post(s.url, '/api/opac/reservar', cuerpo); assert.strictEqual(r.status, 200); assert.strictEqual(r.datos.puesto, 1);
    assert.ok(!/PEREZ|12345678|LEC-0001/.test(JSON.stringify(r.datos)));
    r = await post(s.url, '/api/opac/reservar', cuerpo); assert.strictEqual(r.datos.codigo, 'DUPLICADA');

    // La reserva quedó guardada (la bibliotecaria la ve en Reservas) y el catálogo muestra 1 en espera, sin nombres.
    const g = await (await fetch(s.url + '/api/db/item?key=' + encodeURIComponent('sigie:bib_reservas'), { headers: cab })).json();
    const guardadas = JSON.parse(g.value); assert.strictEqual(guardadas.length, 1); assert.strictEqual(guardadas[0].origen, 'OPAC'); assert.strictEqual(guardadas[0].estado, 'Espera');
    const pub = await (await fetch(s.url + '/api/opac')).text(); assert.strictEqual(JSON.parse(pub).libros[0].espera, 1); assert.ok(!/PEREZ|12345678/.test(pub));

    // Sin sesión no se puede leer ni tocar la base directamente.
    assert.strictEqual((await fetch(s.url + '/api/db/item?key=sigie:bib_reservas')).status, 401);

    // Fuerza bruta de la clave: tras 5 fallos el código queda bloqueado (aunque luego se use la clave buena).
    for (let i = 0; i < 5; i++) assert.strictEqual((await post(s.url, '/api/opac/reservar', { libroId: 'b', cod: 'LEC-0004', clave: '000' + i })).status, 401);
    r = await post(s.url, '/api/opac/reservar', { libroId: 'b', cod: 'LEC-0004', clave: '5678' }); assert.strictEqual(r.status, 429);
  } finally { s.parar(); }
});
