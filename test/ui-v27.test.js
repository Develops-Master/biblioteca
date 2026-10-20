// Pantalla Mostrador (v27): DNI, ficha con avisos, resultado grande, ubicación del libro devuelto, deshacer e inactividad. jsdom + servidor real.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./ui-helper.js');
const omitir = !H.jsdom && 'jsdom no está instalado (npm install); se omiten las pruebas de pantalla';

test('v27: Mostrador reconoce el DNI, avisa el máximo, dice dónde guardar, deshace y cierra el lector por inactividad', { skip: omitir }, async () => {
  const s = await H.iniciarServidor(); let A;
  try {
    const jar = new H.jsdom.CookieJar(); await H.entrar(s.url, jar);
    A = await H.abrir(s.url, 'index.html', jar);
    await H.hasta(() => A.w.eval('typeof STATE!=="undefined" && STATE.loaded') && A.d.getElementById('content').innerHTML.length > 200, 30000);
    const guardar = async (clave, v) => { A.w.__v = v; await A.w.eval(`DB.save(${clave}, window.__v)`); };
    await guardar('BKEYS.libros', [{ id: 'a', cod: 'CUE-001', titulo: 'Cuentos andinos', cant: 1, ubi: 'B2' }, { id: 'b', cod: 'CIE-001', titulo: 'Átomos', cant: 1 }, { id: 'c', cod: 'MAT-001', titulo: 'Números', cant: 1 }]);
    await guardar('BKEYS.lect', [{ id: 'l1', cod: 'LEC-0001', nombre: 'PEREZ, JUAN', dni: '12345678', grado: 'Primaria · 3° A', tipo: 'Alumno' }]);
    await guardar('BKEYS.prest', []);
    A.w.__c = { ...A.w.eval('bibCfg()'), pedirResena: false, Alumno: { max: 2, dias: 7 }, bloquear: false }; await A.w.eval('DB.save(B2.cfg, window.__c)');
    A.w.eval('bibM.lec = null; bibM.log = []; STATE.view = "bibMost"; render();'); await new Promise(r => setTimeout(r, 250));
    const txt = () => A.d.getElementById('content').textContent, prest = () => JSON.parse(A.w.eval('JSON.stringify(bibPrest())'));
    const esc = async c => { await A.w.eval(`bibMostScan(${JSON.stringify(c)})`); await new Promise(r => setTimeout(r, 120)); };

    await esc('12345678'); // DNI escrito a mano
    assert.ok(/Lector: PEREZ, JUAN/.test(txt()) && /0 libro\(s\) en su poder/.test(txt()) && /puede llevar 2 más/.test(txt()));
    await esc('cue-001'); assert.strictEqual(prest().length, 1); assert.ok(/Prestado: CUE-001/.test(txt()) && /Deshacer/.test(txt()) && /Vence/.test(txt()) && /1 libro\(s\) en su poder/.test(txt()));
    A.d.getElementById('bmUndo').click(); await H.hasta(() => prest().length === 0, 5000); await new Promise(r => setTimeout(r, 200));
    assert.ok(/Deshecho: Prestado/.test(txt()) && !A.d.getElementById('bmUndo'));

    await esc('CUE-001'); await esc('CIE-001'); // ya tiene el máximo
    assert.ok(/Ya tiene el máximo de libros \(2\)/.test(txt()) && /no puede llevar más ahora/.test(txt()));
    await esc('MAT-001'); assert.strictEqual(prest().length, 2); assert.ok(/máximo/.test(A.d.querySelector('[role=status]').textContent) && /✖/.test(A.d.querySelector('[role=status]').textContent));

    // Devolver escaneando: dice dónde guardar el libro.
    await esc('CUE-001'); assert.ok(prest().find(p => p.libroId === 'a').devuelto); assert.ok(/Colócalo en el estante: B2/.test(A.d.querySelector('[role=status]').textContent));
    // Devolver desde la ficha (botón).
    A.d.querySelector('[data-mdev]').click(); await H.hasta(() => prest().every(p => p.devuelto), 5000); await new Promise(r => setTimeout(r, 200));
    assert.ok(/Devuelto: CIE-001/.test(txt()) && /0 libro\(s\) en su poder/.test(txt()));
    // Deshacer también sirve para una devolución hecha desde la ficha.
    A.d.getElementById('bmUndo').click(); await H.hasta(() => prest().some(p => !p.devuelto), 5000); // deshace la devolución de la ficha
    await H.hasta(() => /Deshecho: Devuelto: CIE-001/.test(txt()), 5000); assert.strictEqual(prest().filter(p => !p.devuelto).length, 1);

    // Inactividad: el lector se cierra solo.
    assert.strictEqual(A.w.eval('SigieMostrador.revisarInactividad(Date.now() + 10000)'), false);
    assert.strictEqual(A.w.eval('SigieMostrador.revisarInactividad(Date.now() + 200000)'), true); await new Promise(r => setTimeout(r, 150));
    assert.ok(/Lector cerrado por inactividad/.test(txt()) && /Sin lector seleccionado/.test(txt()));
    await esc('99999999'); assert.ok(/No registrado|no registrado/.test(A.d.querySelector('[role=status]').textContent));
  } finally { if (A) await A.cerrar(); s.parar(); }
});
