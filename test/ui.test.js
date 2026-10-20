// Pruebas de PANTALLA con jsdom contra el servidor real: login, cambio de clave y navegación de la biblioteca.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./ui-helper.js');

const omitir = !H.jsdom && 'jsdom no está instalado (npm install); se omiten las pruebas de pantalla';

test('login en pantalla: clave provisional → cambio obligatorio → entra al sistema', { skip: omitir }, async () => {
  const s = await H.iniciarServidor();
  try {
    const jar = new H.jsdom.CookieJar();
    const L = await H.abrir(s.url, 'login.html', jar);
    await H.hasta(() => L.d.getElementById('btnLogin'));
    assert.match(L.d.body.textContent, /Base de datos local/, 'detecta el servidor');
    // contraseña incorrecta: mensaje genérico
    L.d.getElementById('lg_user').value = 'admin'; L.d.getElementById('lg_pass').value = 'mal';
    L.d.getElementById('btnLogin').click();
    await H.hasta(() => /incorrectos/.test(L.d.getElementById('loginMsg').textContent));
    // clave de fábrica: pide cambiarla
    L.d.getElementById('lg_pass').value = 'admin123'; L.d.getElementById('btnLogin').click();
    await H.hasta(() => L.d.getElementById('cp_pass1'));
    L.d.getElementById('cp_pass1').value = 'admin123'; L.d.getElementById('cp_pass2').value = 'admin123';
    L.d.getElementById('btnCambiar').click();
    await H.hasta(() => /común|8 caracteres/.test(L.d.getElementById('cpMsg').textContent));
    L.d.getElementById('cp_pass1').value = 'ClaveSegura#2026'; L.d.getElementById('cp_pass2').value = 'ClaveSegura#2026';
    L.d.getElementById('btnCambiar').click();
    await H.hasta(async () => (await (await L.w.fetch('/api/session')).json()).ok);
    assert.deepStrictEqual(L.errores, [], L.errores.join('\n'));
    await L.cerrar();
  } finally { s.parar(); }
});

test('el sistema abre con sesión, muestra la biblioteca y recorre todas sus vistas sin errores', { skip: omitir }, async () => {
  const s = await H.iniciarServidor();
  try {
    const jar = new H.jsdom.CookieJar();
    await H.entrar(s.url, jar);
    const A = await H.abrir(s.url, 'index.html', jar);
    await H.hasta(() => A.w.eval('typeof STATE!=="undefined" && STATE.loaded') && A.d.getElementById('content') && A.d.getElementById('content').innerHTML.length > 200, 30000);
    assert.strictEqual(A.w.eval('STATE.session.usuario'), 'admin');
    assert.strictEqual(A.w.eval('STORAGE_MODE'), 'servidor');
    assert.match(A.d.body.textContent, /Biblioteca/);
    const vistas = A.w.eval('BIB_VIEWS').concat(['usuarios', 'config', 'reportes', 'bitacora', 'papelera', 'custodios']);
    assert.ok(vistas.length >= 11);
    for (const v of vistas) {
      A.w.eval('STATE.view = ' + JSON.stringify(v) + '; render();');
      assert.ok(A.d.getElementById('content').innerHTML.length > 20, 'la vista ' + v + ' se dibuja');
    }
    // el usuario ve la lista SIN hashes
    const us = A.w.eval('DB.get(KEYS.usuarios)');
    assert.ok(us.length >= 4 && us.every(u => !u.hash && !u.salt));
    assert.deepStrictEqual(A.errores, [], A.errores.join('\n'));
    await A.cerrar();
  } finally { s.parar(); }
});

test('sin sesión, el sistema manda al login y no pide datos', { skip: omitir }, async () => {
  const s = await H.iniciarServidor();
  try {
    const A = await H.abrir(s.url, 'index.html', new H.jsdom.CookieJar());
    await H.esperar(1200);
    assert.ok(!A.w.eval('typeof STATE!=="undefined" && STATE.loaded'), 'no llegó a cargar el sistema');
    assert.ok(!A.w.eval('DB.get(KEYS.usuarios)'), 'no leyó usuarios');
    await A.cerrar();
  } finally { s.parar(); }
});
