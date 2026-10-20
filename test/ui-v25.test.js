// Pantalla Reservas (v25): tarjetas, aviso por WhatsApp con constancia, liberar vencidas e historial. jsdom + servidor real.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./ui-helper.js');
const omitir = !H.jsdom && 'jsdom no está instalado (npm install); se omiten las pruebas de pantalla';

test('v25: Reservas: avisa por WhatsApp, marca el aviso, pide el celular que falta y muestra al relevo de la fila', { skip: omitir }, async () => {
  const s = await H.iniciarServidor(); let A;
  try {
    const jar = new H.jsdom.CookieJar(); await H.entrar(s.url, jar);
    A = await H.abrir(s.url, 'index.html', jar);
    await H.hasta(() => A.w.eval('typeof STATE!=="undefined" && STATE.loaded') && A.d.getElementById('content').innerHTML.length > 200, 30000);
    const guardar = async (clave, v) => { A.w.__v = v; await A.w.eval(`DB.save(${clave}, window.__v)`); };
    const hoy = A.w.eval('today()'), ayer = A.w.eval('bibEnDias(-3)'), futuro = A.w.eval('bibEnDias(2)');
    await guardar('BKEYS.libros', [{ id: 'a', cod: 'CUE-001', titulo: 'Cuentos andinos', cant: 1 }, { id: 'b', cod: 'CIE-001', titulo: 'Átomos', cant: 1 }]);
    await guardar('BKEYS.lect', [{ id: 'l1', cod: 'LEC-0001', nombre: 'PEREZ, JUAN', grado: 'Primaria · 3° A', tipo: 'Alumno', tel: '987654321' }, { id: 'l2', cod: 'LEC-0002', nombre: 'RAMOS, ANA', grado: 'Primaria · 2° B', tipo: 'Alumno', tel: '' }, { id: 'l3', cod: 'LEC-0003', nombre: 'DIAZ, LUIS', tipo: 'Alumno', tel: '911222333' }]);
    await guardar('BKEYS.prest', []);
    await guardar('B2.res', [
      { id: 'r1', libroId: 'a', lectorId: 'l1', lector: 'PEREZ, JUAN', grado: 'Primaria · 3° A', fecha: ayer, estado: 'Disponible', hasta: futuro },
      { id: 'r2', libroId: 'b', lectorId: 'l3', lector: 'DIAZ, LUIS', fecha: ayer, estado: 'Disponible', hasta: ayer, avisado: ayer },
      { id: 'r3', libroId: 'b', lectorId: 'l2', lector: 'RAMOS, ANA', fecha: hoy, estado: 'Espera', origen: 'OPAC' },
      { id: 'r4', libroId: 'a', lectorId: 'l3', lector: 'DIAZ, LUIS', fecha: ayer, estado: 'Cancelada' }]);
    A.w.eval('STATE.view="bibRes"; render();'); await new Promise(r => setTimeout(r, 250));
    const txt = () => A.d.getElementById('content').textContent, res = () => JSON.parse(A.w.eval('JSON.stringify(bibRes())'));
    // El sistema ya libera solo las vencidas al abrir Reservas: DIAZ queda «Vencida» y el libro pasa a RAMOS, que queda por avisar.
    await H.hasta(() => res().find(x => x.id === 'r2').estado === 'Vencida' && res().find(x => x.id === 'r3').estado === 'Disponible', 6000);
    await new Promise(r => setTimeout(r, 300));
    assert.ok(/Listos para recoger/.test(txt()) && /Por avisar/.test(txt()) && !/Vencidos sin recoger/.test(txt()));
    assert.ok(/Avisar a los 2 que ya pueden recoger/.test(A.d.getElementById('rvTodos').textContent), 'PEREZ y RAMOS por avisar');
    assert.ok(/OPAC/.test(txt()) && /Listo · hasta/.test(txt()));
    assert.ok(!/Historial reciente/.test(txt())); A.d.getElementById('rvHist').checked = true; A.d.getElementById('rvHist').dispatchEvent(new A.w.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 150)); assert.ok(/Historial reciente/.test(txt()) && /Cancelada/.test(txt()) && /Venció sin recoger/.test(txt()));

    // Avisar a PEREZ: abre WhatsApp con su número y el texto, y queda marcado.
    A.d.querySelector('[data-rvav="r1"]').click();
    await H.hasta(() => A.ventanas.length === 1 && res().find(r => r.id === 'r1').avisado === hoy, 5000);
    assert.ok(A.ventanas[0].url.startsWith('https://wa.me/51987654321?text=') && /familia%20de%20PEREZ/.test(A.ventanas[0].url));
    await new Promise(r => setTimeout(r, 250)); assert.ok(/Avisar a los 1 que ya pueden recoger/.test(A.d.getElementById('rvTodos').textContent));

    // RAMOS no tiene celular: pide uno, lo guarda en la ficha y recién ahí abre WhatsApp.
    A.d.querySelector('[data-rvav="r3"]').click(); await new Promise(r => setTimeout(r, 150));
    assert.strictEqual(A.ventanas.length, 1, 'sin celular no se abre WhatsApp');
    A.d.getElementById('rv_tel').value = '12345'; A.d.getElementById('bmS').click(); await new Promise(r => setTimeout(r, 150));
    assert.strictEqual(A.ventanas.length, 1, 'un celular inválido se rechaza'); assert.ok(A.d.getElementById('rv_tel'), 'el modal sigue abierto');
    A.d.getElementById('rv_tel').value = '912 345 678'; A.d.getElementById('bmS').click();
    await H.hasta(() => A.ventanas.length === 2 && res().find(r => r.id === 'r3').avisado === hoy, 5000);
    assert.ok(A.ventanas[1].url.startsWith('https://wa.me/51912345678?text='));
    assert.strictEqual(JSON.parse(A.w.eval('JSON.stringify(bibLect())')).find(l => l.id === 'l2').tel, '912345678');
    await new Promise(r => setTimeout(r, 250)); assert.ok(!A.d.getElementById('rvTodos'), 'ya no queda nadie por avisar');
  } finally { if (A) await A.cerrar(); s.parar(); }
});
