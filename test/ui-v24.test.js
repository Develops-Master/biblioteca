// Pantalla: reservar desde opac.html (jsdom + servidor real) y el interruptor en el panel del bibliotecario.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./ui-helper.js');
const omitir = !H.jsdom && 'jsdom no está instalado (npm install); se omiten las pruebas de pantalla';

test('v24: reservar un libro prestado desde opac.html; el interruptor del panel lo activa', { skip: omitir }, async () => {
  const s = await H.iniciarServidor(); let A, P;
  try {
    const jar = new H.jsdom.CookieJar(); await H.entrar(s.url, jar);
    A = await H.abrir(s.url, 'index.html', jar);
    await H.hasta(() => A.w.eval('typeof STATE!=="undefined" && STATE.loaded') && A.d.getElementById('content').innerHTML.length > 200, 30000);
    const guardar = async (clave, v) => { A.w.__v = v; await A.w.eval(`DB.save(${clave}, window.__v)`); };
    await guardar('BKEYS.cats', [{ id: 'c1', nombre: 'Cuentos', color: '#C77D2E' }]);
    await guardar('BKEYS.libros', [{ id: 'lib_x1', cod: 'CUE-001', titulo: 'Cuentos andinos', catId: 'c1', cant: 1 }]);
    await guardar('BKEYS.lect', [{ id: 'l1', cod: 'LEC-0001', nombre: 'PEREZ, JUAN', dni: '12345678', grado: 'Primaria · 3° A', tipo: 'Alumno' }, { id: 'l2', cod: 'LEC-0002', nombre: 'OTRA', dni: '87654321', tipo: 'Alumno' }]);
    await guardar('BKEYS.prest', [{ id: 'p1', libroId: 'lib_x1', lectorId: 'l2', lector: 'OTRA', fecha: '2026-10-10', vence: '2026-10-20', devuelto: '' }]);

    // Panel del bibliotecario: el interruptor existe, está apagado y se puede encender.
    A.w.eval('STATE.view="bibOpac"; render();'); await new Promise(r => setTimeout(r, 200));
    const sw = A.d.getElementById('opRes'); assert.ok(sw, 'interruptor de reservas'); assert.strictEqual(sw.checked, false);
    sw.checked = true; sw.dispatchEvent(new A.w.Event('change', { bubbles: true }));
    await H.hasta(() => A.w.eval('!!bibCfg().opacReservas'), 4000);
    await new Promise(r => setTimeout(r, 300));

    // Catálogo público: aparece «Reservar» solo en el libro prestado; con la clave correcta se reserva.
    P = await H.abrir(s.url, 'opac.html', new H.jsdom.CookieJar());
    await H.hasta(() => P.d.querySelectorAll('.libro').length === 1, 8000);
    const b = P.d.querySelector('[data-res]'); assert.ok(b, 'botón Reservar'); b.click();
    P.d.getElementById('rCod').value = 'lec-0001'; P.d.getElementById('rCla').value = '0000'; P.d.getElementById('rSi').click();
    await H.hasta(() => /incorrectos/.test(P.d.getElementById('rMsg').textContent), 5000);
    P.d.getElementById('rCla').value = '5678'; P.d.getElementById('rSi').click();
    await H.hasta(() => /puesto 1/.test(P.d.getElementById('rMsg').textContent), 5000);
    assert.ok(/1 en espera/.test(P.d.getElementById('grid').textContent), 'el catálogo cuenta la reserva');
    assert.ok(!/PEREZ|12345678/.test(P.d.documentElement.outerHTML), 'sin datos personales');

    // La bibliotecaria la ve en Reservas con la etiqueta OPAC.
    await new Promise(r => setTimeout(r, 300)); await A.w.eval('DB.load ? DB.load() : null');
    const rs = JSON.parse(await (await fetch(s.url + '/api/db/item?key=' + encodeURIComponent('sigie:bib_reservas'), { headers: { Cookie: (await jar.getCookieString(s.url)) } })).text().then(t => JSON.parse(t).value));
    assert.strictEqual(rs[0].origen, 'OPAC');
  } finally { if (P) await P.cerrar(); if (A) await A.cerrar(); s.parar(); }
});
