// Pruebas de PANTALLA de las funciones nuevas de la biblioteca (jsdom + servidor real).
const test = require('node:test');
const assert = require('node:assert');
const H = require('./ui-helper.js');
const omitir = !H.jsdom && 'jsdom no está instalado (npm install); se omiten las pruebas de pantalla';

async function abrirSistema(s) {
  const jar = new H.jsdom.CookieJar();
  await H.entrar(s.url, jar);
  const A = await H.abrir(s.url, 'index.html', jar);
  await H.hasta(() => A.w.eval('typeof STATE!=="undefined" && STATE.loaded') && A.d.getElementById('content').innerHTML.length > 200, 30000);
  return A;
}
const click = (A, sel) => { const e = A.d.querySelector(sel); assert.ok(e, 'no existe ' + sel); e.click(); };
const modal = A => A.d.querySelector('.modal-bg');
const ir = (A, vista) => A.w.eval('STATE.view=' + JSON.stringify(vista) + '; render();');
const guardar = async (A, clave, valor) => { A.w.__v = valor; await A.w.eval(`DB.save(${clave}, window.__v)`); };

// Datos de ejemplo reales (los del botón "Generar datos de ejemplo") cargados en el sistema.
async function cargarEjemplo(A) {
  const bib = A.w.eval(`JSON.stringify(window.construirDatosEjemplo({ hoy: today(), anio: new Date().getFullYear(), uid, bibCats: BIB_SEED,
    categoriasDeprec: SEED_CATEGORIAS_DEPREC, lookupCategoria: lookupCategoriaDeprec, usuariosPrevios: [], totalesSIGIE: () => ({ porCategoria: [] }),
    snapshotItems: i => i.map(x => ({ id: x.id })) }).bib)`);
  const D = JSON.parse(bib);
  // a la mitad de los lectores les ponemos celular, algunos mal escritos
  D.lectores.forEach((l, i) => { if (i % 2 === 0) l.tel = i % 6 === 0 ? '12345' : '9' + String(10000000 + i * 37).slice(0, 8); });
  await guardar(A, 'BKEYS.cats', D.cats); await guardar(A, 'BKEYS.libros', D.libros); await guardar(A, 'BKEYS.lect', D.lectores);
  await guardar(A, 'BKEYS.prest', D.prest); await guardar(A, 'B2.res', D.res); await guardar(A, 'B2.baj', D.baj);
  return D;
}

test('con datos de ejemplo (incluye reservas y bajas) todas las vistas de la biblioteca se dibujan sin errores', { skip: omitir }, async () => {
  const s = await H.iniciarServidor();
  try {
    const A = await abrirSistema(s);
    const D = await cargarEjemplo(A);
    for (const v of A.w.eval('BIB_VIEWS').concat(['bibMost', 'bibRes', 'bibBajas', 'bibRetos'])) {
      ir(A, v);
      assert.ok(A.d.getElementById('content').innerHTML.length > 50, v);
    }
    ir(A, 'bibRes'); assert.ok(A.d.getElementById('content').textContent.includes(D.res.find(r => r.estado === 'Espera').lector), 'se ven las reservas del ejemplo');
    ir(A, 'bibBajas'); assert.ok(A.d.getElementById('content').textContent.includes(D.baj[0].titulo), 'se ven las bajas del ejemplo');
    assert.deepStrictEqual(A.errores, [], A.errores.join('\n'));
    await A.cerrar();
  } finally { s.parar(); }
});

test('avisos por WhatsApp: un chat por familia, marca el aviso y permite completar celulares', { skip: omitir }, async () => {
  const s = await H.iniciarServidor();
  try {
    const A = await abrirSistema(s);
    const D = await cargarEjemplo(A);
    ir(A, 'bibPrest');
    click(A, '#bibMorosos');
    await H.hasta(() => modal(A) && A.d.querySelector('#bmWa'));
    click(A, '#bmWa');
    await H.hasta(() => A.d.querySelector('[data-bwfila]'));
    const filas = [...A.d.querySelectorAll('[data-bwfila]')];
    const conWa = [...A.d.querySelectorAll('[data-bwabrir]')], sinTel = [...A.d.querySelectorAll('[data-bwgtel]')];
    assert.ok(filas.length >= 2, 'hay morosos'); assert.strictEqual(filas.length, conWa.length + sinTel.length);
    assert.ok(conWa.length >= 1 && sinTel.length >= 1, 'hay familias con y sin celular');
    // abrir WhatsApp de una familia
    const idxAbrir = +conWa[0].dataset.bwabrir;
    const antes = A.w.eval('bibPrest().filter(p=>p.avisado).length');
    conWa[0].click();
    await H.hasta(() => A.ventanas.length === 1);
    assert.match(A.ventanas[0].url, /^https:\/\/wa\.me\/519\d{8}\?text=/);
    assert.match(decodeURIComponent(A.ventanas[0].url), /pendiente/);
    await H.hasta(() => A.w.eval('bibPrest().filter(p=>p.avisado).length') > antes);
    await H.hasta(() => /hace 0 d/.test(A.d.querySelector('[data-bwfila="' + idxAbrir + '"]')?.textContent || '') || A.d.querySelectorAll('[data-bwfila]').length > 0);
    // completar un celular faltante
    const inp = A.d.querySelector('[data-bwtel]'); const i = inp.dataset.bwtel;
    inp.value = '987 654 321'; A.d.querySelector('[data-bwgtel="' + i + '"]').click();
    await H.hasta(() => A.w.eval('bibLect().filter(l=>l.tel==="987 654 321").length') === 1);
    // un celular inválido se rechaza
    const inp2 = A.d.querySelector('[data-bwtel]');
    if (inp2) { inp2.value = '123'; A.d.querySelector('[data-bwgtel="' + inp2.dataset.bwtel + '"]').click(); await H.esperar(150); assert.strictEqual(A.w.eval('bibLect().filter(l=>l.tel==="123").length'), 0); }
    assert.deepStrictEqual(A.errores, [], A.errores.join('\n'));
    await A.cerrar();
  } finally { s.parar(); }
});

test('morosos: "3A" y "3° A PRIMARIA" salen en el mismo grupo', { skip: omitir }, async () => {
  const s = await H.iniciarServidor();
  try {
    const A = await abrirSistema(s);
    const hoy = A.w.eval('today()'), ayer = A.w.eval('fechaLocalISO(new Date(Date.now()-5*864e5))');
    await guardar(A, 'BKEYS.cats', [{ id: 'c1', nombre: 'Cuentos', prefijo: 'CUE' }]);
    await guardar(A, 'BKEYS.libros', [{ id: 'l1', cod: 'CUE-001', titulo: 'A', autor: 'X', catId: 'c1', cant: 1 }, { id: 'l2', cod: 'CUE-002', titulo: 'B', autor: 'X', catId: 'c1', cant: 1 }]);
    await guardar(A, 'BKEYS.lect', [{ id: 'a1', cod: 'LEC-0001', nombre: 'ANA', grado: '3° A PRIMARIA', tipo: 'Alumno' }, { id: 'a2', cod: 'LEC-0002', nombre: 'LUIS', grado: '3A primaria', tipo: 'Alumno' }]);
    await guardar(A, 'BKEYS.prest', [{ id: 'p1', libroId: 'l1', lectorId: 'a1', lector: 'ANA', grado: '3° A PRIMARIA', fecha: ayer, vence: ayer, devuelto: '' }, { id: 'p2', libroId: 'l2', lectorId: 'a2', lector: 'LUIS', grado: '3A primaria', fecha: ayer, vence: ayer, devuelto: '' }]);
    ir(A, 'bibPrest'); click(A, '#bibMorosos');
    await H.hasta(() => A.d.querySelector('[data-bmaviso]'));
    assert.strictEqual(A.d.querySelectorAll('[data-bmaviso]').length, 1, 'un solo grupo');
    assert.match(modal(A).textContent, /3° A PRIMARIA/);
    await A.cerrar();
  } finally { s.parar(); }
});

test('estadísticas por grado y sección: se abre desde el Reporte general y cambia de agrupación', { skip: omitir }, async () => {
  const s = await H.iniciarServidor();
  try {
    const A = await abrirSistema(s);
    await cargarEjemplo(A);
    ir(A, 'bibReporte'); click(A, '#bibGrupos');
    await H.hasta(() => A.d.querySelector('#bgCuanto'));
    const filasSeccion = A.d.querySelectorAll('.modal tbody tr').length;
    assert.ok(filasSeccion >= 3, 'hay filas por sección');
    const sel = A.d.querySelector('#bgCuanto'); sel.value = 'nivel'; sel.dispatchEvent(new A.w.Event('change'));
    await H.hasta(() => A.d.querySelectorAll('.modal tbody tr').length < filasSeccion);
    assert.match(A.d.querySelector('.modal tbody').textContent, /PRIMARIA|SECUNDARIA|INICIAL/);
    assert.deepStrictEqual(A.errores, [], A.errores.join('\n'));
    await A.cerrar();
  } finally { s.parar(); }
});

test('carnés en hojas: filtra por aula, imprime solo esa aula en hojas de 8', { skip: omitir }, async () => {
  const s = await H.iniciarServidor();
  try {
    const A = await abrirSistema(s);
    const lect = Array.from({ length: 11 }, (_, i) => ({ id: 'a' + i, cod: 'LEC-' + String(i + 1).padStart(4, '0'), nombre: 'ALUMNO ' + i, grado: i < 9 ? (i % 2 ? '4° B PRIMARIA' : '4B primaria') : '5° A PRIMARIA', tipo: 'Alumno' }));
    await guardar(A, 'BKEYS.lect', lect);
    ir(A, 'bibLect');
    const sel = A.d.querySelector('#blGrupo');
    assert.ok([...sel.options].some(o => o.value === '4° B PRIMARIA' && /\(9\)/.test(o.textContent)), '"4B" y "4° B" se juntan: 9 alumnos');
    sel.value = '4° B PRIMARIA'; sel.dispatchEvent(new A.w.Event('change'));
    await H.hasta(() => A.d.querySelector('#blGrupo').value === '4° B PRIMARIA');
    click(A, '#blCarnes');
    await H.hasta(() => A.ventanas.length === 1);
    const html = A.ventanas[0].doc.html;
    assert.strictEqual((html.match(/class="carne"/g) || []).length, 9);
    assert.strictEqual((html.match(/class="pagina"/g) || []).length, 2, '9 carnés = 2 hojas');
    assert.ok(!html.includes('5° A PRIMARIA'), 'solo el aula elegida');
    await A.cerrar();
  } finally { s.parar(); }
});

test('lector con celular: se guarda desde el formulario', { skip: omitir }, async () => {
  const s = await H.iniciarServidor();
  try {
    const A = await abrirSistema(s);
    ir(A, 'bibLect'); A.w.eval('bibLectModal()');
    await H.hasta(() => A.d.querySelector('#bn_nom'));
    A.d.querySelector('#bn_nom').value = 'rosa quispe'; A.d.querySelector('#bn_gra').value = '2° C PRIMARIA'; A.d.querySelector('#bn_tel').value = '987654321';
    A.d.querySelector('#bmS').click();
    await H.hasta(() => A.w.eval('bibLect().length') === 1);
    const l = A.w.eval('bibLect()[0]');
    assert.strictEqual(l.nombre, 'ROSA QUISPE'); assert.strictEqual(l.tel, '987654321');
    await H.hasta(() => /987654321/.test(A.d.getElementById('content').textContent));
    await A.cerrar();
  } finally { s.parar(); }
});

test('préstamo por aula: reparte un título entre el aula, y la devolución por aula cierra el lote', { skip: omitir }, async () => {
  const s = await H.iniciarServidor();
  try {
    const A = await abrirSistema(s);
    // 5 ejemplares del mismo título y un aula de 6 alumnos (uno ya tiene un libro vencido → bloqueado)
    await guardar(A, 'BKEYS.cats', [{ id: 'c1', nombre: 'Plan lector', prefijo: 'PLA' }]);
    await guardar(A, 'BKEYS.libros', Array.from({ length: 5 }, (_, i) => ({ id: 'l' + i, cod: 'PLA-00' + (i + 1), titulo: 'Rimas y Leyendas', autor: 'Bécquer', catId: 'c1', cant: 1 })).concat([{ id: 'x', cod: 'PLA-099', titulo: 'Otro libro', autor: 'Z', catId: 'c1', cant: 1 }]));
    const nombres = ['ANA', 'BETO', 'CARLA', 'DANI', 'ELENA', 'FELIPE'];
    await guardar(A, 'BKEYS.lect', nombres.map((n, i) => ({ id: 'a' + i, cod: 'LEC-000' + (i + 1), nombre: n, grado: i % 2 ? '4° B PRIMARIA' : '4B primaria', tipo: 'Alumno' })));
    const viejo = A.w.eval('fechaLocalISO(new Date(Date.now()-20*864e5))');
    await guardar(A, 'BKEYS.prest', [{ id: 'pv', libroId: 'x', lectorId: 'a1', lector: 'BETO', grado: '4° B PRIMARIA', fecha: viejo, vence: viejo, devuelto: '' }]);
    ir(A, 'bibPrest'); click(A, '#bibAula');
    await H.hasta(() => A.d.querySelector('#baPrev [data-baidx]'));
    // el título elegido por defecto puede variar: nos aseguramos de elegir "Rimas y Leyendas"
    const tit = A.d.querySelector('#baTit'); tit.value = [...tit.options].find(o => /Rimas/.test(o.textContent)).value; tit.dispatchEvent(new A.w.Event('change'));
    await H.hasta(() => /5 alumno\(s\) recibirán/.test(A.d.querySelector('#baPrev').textContent));
    assert.match(A.d.querySelector('#baPrev').textContent, /BETO.*vencidos/, 'BETO queda bloqueado por su libro vencido');
    assert.strictEqual(A.d.querySelectorAll('[data-baidx]').length, 5, 'los 5 alumnos sin bloqueo reciben su ejemplar');
    A.d.querySelector('[data-baidx="4"]').checked = false;                     // el profesor desmarca a uno
    A.d.querySelector('#bmS').click();
    await H.hasta(() => A.w.eval('bibPrest().filter(p=>p.lote).length') === 4, 8000);
    const lote = A.w.eval('bibPrest().filter(p=>p.lote)');
    assert.ok(lote.every(p => p.lote === lote[0].lote && /4° B PRIMARIA · Rimas y Leyendas/.test(p.loteNombre) && p.vence > p.fecha));
    assert.strictEqual(new Set(lote.map(p => p.libroId)).size, 4, 'cada alumno, un ejemplar distinto');
    assert.ok(!lote.some(p => p.lector === 'BETO'), 'el bloqueado no recibió nada');

    await H.hasta(() => !A.d.querySelector('.modal-bg'), 8000); // el modal del préstamo por aula debe haberse cerrado: si no, '#bmS' sería el botón del modal viejo
    // devolución por aula: devuelve 3 de los 4
    ir(A, 'bibPrest'); click(A, '#bibAulaDev');
    await H.hasta(() => A.d.querySelector('[data-bdid]'));
    assert.strictEqual(A.d.querySelectorAll('[data-bdid]').length, 4);
    A.d.querySelectorAll('[data-bdid]')[3].checked = false;
    A.d.querySelector('#bmS').click();
    await H.hasta(() => A.w.eval('bibPrest().filter(p=>p.lote && p.devuelto).length') === 3, 8000);
    assert.strictEqual(A.w.eval('bibPrest().filter(p=>p.lote && !p.devuelto).length'), 1);
    assert.strictEqual(A.w.eval('bibPrest().find(p=>p.id==="pv").devuelto'), '', 'no tocó otros préstamos');
    assert.deepStrictEqual(A.errores, [], A.errores.join('\n'));
    await A.cerrar();
  } finally { s.parar(); }
});
