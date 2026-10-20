// Pantalla Bajas y pérdidas (v28): actas numeradas sin repetir bajas, reposición pendiente y reversión. jsdom + servidor real.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./ui-helper.js');
const omitir = !H.jsdom && 'jsdom no está instalado (npm install); se omiten las pruebas de pantalla';

test('v28: actas numeradas que no repiten bajas, y revertir una baja devuelve el libro al catálogo', { skip: omitir }, async () => {
  const s = await H.iniciarServidor(); let A;
  try {
    const jar = new H.jsdom.CookieJar(); await H.entrar(s.url, jar);
    A = await H.abrir(s.url, 'index.html', jar);
    await H.hasta(() => A.w.eval('typeof STATE!=="undefined" && STATE.loaded') && A.d.getElementById('content').innerHTML.length > 200, 30000);
    const guardar = async (clave, v) => { A.w.__v = v; await A.w.eval(`DB.save(${clave}, window.__v)`); };
    const y = A.w.eval('today().slice(0,4)'), hoy = A.w.eval('today()');
    await guardar('BKEYS.libros', [{ id: 'a', cod: 'CUE-001', titulo: 'Cuentos andinos', cant: 3, ubi: 'B2' }]);
    await guardar('BKEYS.prest', [{ id: 'p1', libroId: 'z', lectorId: 'l1', lector: 'PEREZ, JUAN', fecha: hoy, vence: hoy, devuelto: hoy, perdido: true }]);
    await guardar('B2.baj', [
      { id: 'j1', fecha: hoy, libroId: 'a', cod: 'CUE-001', titulo: 'Cuentos andinos', cant: 1, motivo: 'Perdido', lector: 'PEREZ, JUAN', prestId: 'p1' },
      { id: 'j2', fecha: hoy, libroId: 'q', cod: 'CIE-009', titulo: 'Átomos', cant: 2, motivo: 'Desgaste', libro: { id: 'q', cod: 'CIE-009', titulo: 'Átomos', isbn: '9781234567897', ubi: 'C1', cant: 2 } },
      { id: 'j3', fecha: hoy, libroId: 'r', cod: 'HIS-003', titulo: 'Historia', cant: 1, motivo: 'Dañado', lector: 'RAMOS, ANA' }]);
    A.w.eval('STATE.view="bibBajas"; render();'); await new Promise(r => setTimeout(r, 250));
    const txt = () => A.d.getElementById('content').textContent, baj = () => JSON.parse(A.w.eval('JSON.stringify(bibBaj())')), libs = () => JSON.parse(A.w.eval('JSON.stringify(bibLibros())'));
    const filas = () => [...A.d.querySelectorAll('#content tbody tr')].length;
    assert.ok(/Ejemplares dados de baja/.test(txt()) && /Aún sin acta/.test(txt()) && /Reposición pendiente/.test(txt()) && filas() === 3);
    assert.ok(A.d.querySelectorAll('.badge-warn').length >= 2, 'etiquetas «reponer»');

    // Acta 1: solo la baja marcada (j2).
    A.d.querySelector('[data-bxsel="j2"]').checked = true; A.d.querySelector('[data-bxsel="j2"]').dispatchEvent(new A.w.Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 150));
    assert.ok(/Acta de baja \(1\)/.test(A.d.getElementById('bxActa').textContent)); A.d.getElementById('bxActa').click(); await new Promise(r => setTimeout(r, 150));
    assert.strictEqual(A.d.getElementById('bx_nro').value, '001-' + y); A.d.getElementById('bmS').click();
    await H.hasta(() => baj().find(b => b.id === 'j2').acta === '001-' + y && A.ventanas.length === 1, 5000);
    assert.ok(/N° 001-/.test(A.ventanas[0].doc.html) && /Átomos/.test(A.ventanas[0].doc.html) && !/Cuentos andinos/.test(A.ventanas[0].doc.html), 'el acta solo lleva lo marcado');
    await new Promise(r => setTimeout(r, 200));
    // Acta 2: todo lo que queda sin acta; no se puede repetir el número y j2 no entra otra vez.
    A.d.getElementById('bxActa').click(); await new Promise(r => setTimeout(r, 150));
    assert.strictEqual(A.d.getElementById('bx_nro').value, '002-' + y); A.d.getElementById('bx_nro').value = '001-' + y; A.d.getElementById('bmS').click(); await new Promise(r => setTimeout(r, 200));
    assert.ok(A.d.getElementById('bx_nro'), 'sigue abierto: número repetido'); assert.strictEqual(A.ventanas.length, 1);
    A.d.getElementById('bx_nro').value = '002-' + y; A.d.getElementById('bmS').click();
    await H.hasta(() => baj().filter(b => b.acta === '002-' + y).length === 2 && A.ventanas.length === 2, 5000);
    assert.ok(!/Átomos/.test(A.ventanas[1].doc.html) && /Cuentos andinos/.test(A.ventanas[1].doc.html) && /Historia/.test(A.ventanas[1].doc.html));

    // Revertir j1 (perdido por un alumno): vuelve el ejemplar y el préstamo deja de figurar como perdido.
    await new Promise(r => setTimeout(r, 200)); A.d.querySelector('[data-bxrev="j1"]').click(); await new Promise(r => setTimeout(r, 150));
    assert.ok(/ya figura en el acta N° 002-/.test(A.d.querySelector('.modal').textContent)); A.d.getElementById('bx_why').value = 'El lector repuso el libro'; A.d.getElementById('bmS').click();
    await H.hasta(() => baj().find(b => b.id === 'j1').revertida, 5000); await new Promise(r => setTimeout(r, 250));
    assert.strictEqual(libs().find(l => l.id === 'a').cant, 4); assert.strictEqual(JSON.parse(A.w.eval('JSON.stringify(bibPrest())'))[0].perdido, false);
    // Revertir j2 (el libro ya no estaba en el catálogo): se recrea completo, con ISBN y ubicación.
    A.d.querySelector('[data-bxrev="j2"]').click(); await new Promise(r => setTimeout(r, 150)); assert.ok(/todos sus datos/.test(A.d.querySelector('.modal').textContent)); A.d.getElementById('bmS').click();
    await H.hasta(() => libs().some(l => l.cod === 'CIE-009'), 5000); const q = libs().find(l => l.cod === 'CIE-009'); assert.deepStrictEqual([q.cant, q.isbn, q.ubi], [2, '9781234567897', 'C1']);
    // Revertir j3 (baja antigua sin copia completa): avisa y recrea lo básico.
    await new Promise(r => setTimeout(r, 250)); A.d.querySelector('[data-bxrev="j3"]').click(); await new Promise(r => setTimeout(r, 150)); assert.ok(/antigua/.test(A.d.querySelector('.modal').textContent)); A.d.getElementById('bmS').click();
    await H.hasta(() => libs().some(l => l.cod === 'HIS-003'), 5000); await new Promise(r => setTimeout(r, 250));

    // Todo revertido: nada cuenta como baja vigente, y el historial lo muestra.
    assert.ok(/Sin bajas registradas|Nada coincide/.test(txt()) || filas() === 1);
    assert.strictEqual(A.w.eval('bibBajVig().length'), 0);
    A.d.querySelector('[data-bxe="revertidas"]').click(); await new Promise(r => setTimeout(r, 150)); assert.strictEqual(filas(), 3); assert.ok(/Revertida/.test(txt()) && /Apareció|repuso|error/.test(txt()));
  } finally { if (A) await A.cerrar(); s.parar(); }
});
