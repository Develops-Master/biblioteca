// Pantalla Préstamos (v26): tarjetas, filtro por tarjeta, atraso en días, recordatorio por WhatsApp con constancia y CSV.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./ui-helper.js');
const omitir = !H.jsdom && 'jsdom no está instalado (npm install); se omiten las pruebas de pantalla';

test('v26: Préstamos prioriza lo urgente, recuerda por WhatsApp con el celular de la ficha y exporta CSV', { skip: omitir }, async () => {
  const s = await H.iniciarServidor(); let A;
  try {
    const jar = new H.jsdom.CookieJar(); await H.entrar(s.url, jar);
    A = await H.abrir(s.url, 'index.html', jar);
    await H.hasta(() => A.w.eval('typeof STATE!=="undefined" && STATE.loaded') && A.d.getElementById('content').innerHTML.length > 200, 30000);
    const guardar = async (clave, v) => { A.w.__v = v; await A.w.eval(`DB.save(${clave}, window.__v)`); };
    const d = n => A.w.eval(`bibEnDias(${n})`), hoy = A.w.eval('today()');
    await guardar('BKEYS.libros', [{ id: 'a', cod: 'CUE-001', titulo: 'Cuentos andinos', cant: 3 }]);
    await guardar('BKEYS.lect', [{ id: 'l1', cod: 'LEC-0001', nombre: 'PEREZ, JUAN', grado: 'Primaria · 3° A', tipo: 'Alumno', tel: '987654321' }, { id: 'l2', cod: 'LEC-0002', nombre: 'RAMOS, ANA', grado: 'Primaria · 2° B', tipo: 'Alumno', tel: '' }, { id: 'l3', cod: 'LEC-0003', nombre: 'DIAZ, LUIS', tipo: 'Alumno', tel: '911222333' }]);
    await guardar('BKEYS.prest', [
      { id: 'p1', libroId: 'a', lectorId: 'l1', lector: 'PEREZ, JUAN', grado: 'Primaria · 3° A', fecha: d(-12), vence: d(-5), renov: 1 },
      { id: 'p2', libroId: 'a', lectorId: 'l2', lector: 'RAMOS, ANA', grado: 'Primaria · 2° B', fecha: d(-6), vence: hoy },
      { id: 'p3', libroId: 'a', lectorId: 'l3', lector: 'DIAZ, LUIS', fecha: d(-1), vence: d(6) },
      { id: 'p4', libroId: 'a', lectorId: 'l3', lector: 'DIAZ, LUIS', fecha: d(-9), vence: d(-2), devuelto: hoy }]);
    A.w.eval('STATE.view="bibPrest"; render();'); await new Promise(r => setTimeout(r, 250));
    const txt = () => A.d.getElementById('content').textContent, filas = () => [...A.d.querySelectorAll('#content tbody tr')].map(t => t.textContent);
    assert.ok(/Vencidos/.test(txt()) && /Por vencer/.test(txt()) && /Prestados ahora/.test(txt()) && /Devueltos hoy/.test(txt()));
    const f = filas(); assert.ok(/PEREZ/.test(f[0]) && /hace 5 días/.test(f[0]) && /renovado 1×/.test(f[0]), 'el más atrasado va primero con sus días');
    assert.ok(/RAMOS/.test(f[1]) && /vence hoy/.test(f[1]) && /DIAZ/.test(f[2]) && /Devuelto/.test(f[3]));

    // Una tarjeta filtra; pulsarla otra vez quita el filtro.
    A.d.querySelector('[data-pmf="Vencido"]').click(); await new Promise(r => setTimeout(r, 150)); assert.strictEqual(filas().length, 1);
    A.d.querySelector('[data-pmf="Vencido"]').click(); await new Promise(r => setTimeout(r, 150)); assert.strictEqual(filas().length, 4);

    // Recordar a PEREZ: usa el celular de la ficha (sin teclearlo), abre WhatsApp y deja constancia.
    A.d.querySelector('[data-pmrec="p1"]').click();
    await H.hasta(() => A.ventanas.length === 1 && JSON.parse(A.w.eval('JSON.stringify(bibPrest())')).find(p => p.id === 'p1').avisado === hoy, 5000);
    assert.ok(A.ventanas[0].url.startsWith('https://wa.me/51987654321?text=') && /5%20d%C3%ADas%20de%20atraso/.test(A.ventanas[0].url));
    await new Promise(r => setTimeout(r, 250)); assert.ok(/avisado/.test(filas()[0]));

    // RAMOS no tiene celular: lo pide, lo guarda en la ficha y recién entonces abre WhatsApp.
    A.d.querySelector('[data-pmrec="p2"]').click(); await new Promise(r => setTimeout(r, 150)); assert.strictEqual(A.ventanas.length, 1);
    A.d.getElementById('rv_tel').value = '912345678'; A.d.getElementById('bmS').click();
    await H.hasta(() => A.ventanas.length === 2 && JSON.parse(A.w.eval('JSON.stringify(bibPrest())')).find(p => p.id === 'p2').avisado === hoy, 5000);
    assert.ok(A.ventanas[1].url.startsWith('https://wa.me/51912345678?text=')); assert.ok(!A.d.querySelector('[data-pmrec="p3"]'), 'el que vence en 6 días no tiene Recordar');

    // CSV con lo que se ve.
    A.w.eval('window.__csv=null; bibDescargar=function(n,t){ window.__csv=[n,t]; }'); A.d.getElementById('pmCsv').click();
    const csv = A.w.eval('window.__csv'); assert.ok(csv && /^prestamos_/.test(csv[0]) && csv[1].split('\r\n').length === 5 && /Vencido,5/.test(csv[1]));
  } finally { if (A) await A.cerrar(); s.parar(); }
});
