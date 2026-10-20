// Pruebas de PANTALLA de la v9 (reseñas con estrellas, lectores sin actividad, certificados) con jsdom + servidor real.
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
const texto = A => A.d.getElementById('content').textContent;
const guardar = async (A, clave, valor) => { A.w.__v = valor; await A.w.eval(`DB.save(${clave}, window.__v)`); };
const resenas = A => JSON.parse(A.w.eval('JSON.stringify(bibResenas())'));

async function cargarEjemplo(A) {
  const D = JSON.parse(A.w.eval(`JSON.stringify(window.construirDatosEjemplo({ hoy: today(), anio: new Date().getFullYear(), uid, bibCats: BIB_SEED,
    categoriasDeprec: SEED_CATEGORIAS_DEPREC, lookupCategoria: lookupCategoriaDeprec, usuariosPrevios: [], totalesSIGIE: () => ({ porCategoria: [] }),
    snapshotItems: i => i.map(x => ({ id: x.id })) }).bib)`));
  await guardar(A, 'BKEYS.cats', D.cats); await guardar(A, 'BKEYS.libros', D.libros); await guardar(A, 'BKEYS.lect', D.lectores);
  await guardar(A, 'BKEYS.prest', D.prest); await guardar(A, 'B2.res', D.res); await guardar(A, 'B2.baj', D.baj); await guardar(A, 'B5.res', D.resenas);
  return D;
}

test('v9: el ejemplo trae reseñas y todas las vistas nuevas se dibujan sin errores', { skip: omitir }, async () => {
  const s = await H.iniciarServidor();
  try {
    const A = await abrirSistema(s);
    const D = await cargarEjemplo(A);
    assert.ok(D.resenas.length >= 5, 'el ejemplo genera reseñas');
    for (const v of ['bibResenas', 'bibInact', 'bibCert', 'bibLibros', 'bibInicio', 'bibPrest']) { ir(A, v); assert.ok(A.d.getElementById('content').innerHTML.length > 50, v); }
    ir(A, 'bibResenas');
    assert.ok(texto(A).includes('Más leídos y mejor valorados') && D.resenas.some(r => texto(A).includes(r.lector)), 'se ven las reseñas del ejemplo');
    ir(A, 'bibLibros');
    assert.ok(texto(A).includes('★'), 'el catálogo muestra el promedio de estrellas');
    assert.ok(A.d.querySelector('#nav, nav, .sidebar').textContent.includes('Reseñas y más leídos'), 'aparece en el menú');
    assert.deepStrictEqual(A.errores, [], A.errores.join('\n'));
    await A.cerrar();
  } finally { s.parar(); }
});

test('v9: al devolver en Préstamos se pide la reseña; guardar la registra, omitir no, y no se vuelve a pedir', { skip: omitir }, async () => {
  const s = await H.iniciarServidor();
  try {
    const A = await abrirSistema(s);
    const D = await cargarEjemplo(A);
    const activos = D.prest.filter(p => !p.devuelto);
    const antes = resenas(A).length;
    // 1) omitir: devuelve pero no guarda reseña
    ir(A, 'bibPrest'); click(A, `[data-bibdev="${activos[0].id}"]`);
    await H.hasta(() => modal(A) && A.d.querySelector('[data-rsest="3"]'));
    click(A, '#bmC'); await H.esperar(150);
    assert.strictEqual(resenas(A).length, antes, 'omitir no guarda');
    // 2) guardar sin estrellas: avisa y no cierra
    ir(A, 'bibPrest'); click(A, `[data-bibdev="${activos[1].id}"]`);
    await H.hasta(() => modal(A) && A.d.querySelector('[data-rsest="3"]'));
    click(A, '#bmS'); await H.esperar(150);
    assert.ok(modal(A), 'sin estrellas el modal sigue abierto');
    // 3) 4 estrellas + comentario
    click(A, '[data-rsest="4"]'); A.d.getElementById('rsCom').value = 'Muy bonito';
    click(A, '#bmS');
    await H.hasta(() => resenas(A).length === antes + 1);
    const r = resenas(A).find(x => x.prestId === activos[1].id);
    assert.ok(r && r.estrellas === 4 && r.comentario === 'Muy bonito' && r.libroId === activos[1].libroId);
    // 4) reseñar de nuevo el mismo préstamo desde la lista "sin reseña" no está permitido
    A.w.eval(`bibResenaPedir(${JSON.stringify(activos[1].id)}, true)`); await H.esperar(100);
    assert.ok(!modal(A), 'un préstamo no se reseña dos veces');
    // 5) la devolución omitida aparece en "Devoluciones recientes sin reseña" y se puede reseñar desde ahí
    ir(A, 'bibResenas');
    const b = A.d.querySelector(`[data-rsnew="${activos[0].id}"]`); assert.ok(b, 'la devolución omitida se ofrece para reseñar'); b.click();
    await H.hasta(() => modal(A) && A.d.querySelector('[data-rsest="5"]'));
    click(A, '[data-rsest="5"]'); click(A, '#bmS');
    await H.hasta(() => resenas(A).length === antes + 2);
    // 6) eliminar una reseña
    ir(A, 'bibResenas'); click(A, `[data-rsdel="${r.id}"]`);
    await H.hasta(() => resenas(A).length === antes + 1);
    assert.deepStrictEqual(A.errores, [], A.errores.join('\n'));
    await A.cerrar();
  } finally { s.parar(); }
});

test('v9: en el Mostrador, devolver escaneando pide la reseña; apagada en Reglas, no la pide', { skip: omitir }, async () => {
  const s = await H.iniciarServidor();
  try {
    const A = await abrirSistema(s);
    const D = await cargarEjemplo(A);
    const act = D.prest.filter(p => !p.devuelto && p.lectorId);
    const probar = async p => {
      const l = D.libros.find(x => x.id === p.libroId);
      ir(A, 'bibMost');
      A.w.eval(`bibM.lec = bibLect().find(x=>x.id===${JSON.stringify(p.lectorId)})`);
      await A.w.eval(`bibMostScan(${JSON.stringify(l.cod)})`);
    };
    await probar(act[0]);
    await H.hasta(() => modal(A) && A.d.querySelector('[data-rsest="2"]'));
    A.d.querySelector('.modal-bg').dispatchEvent(new A.w.KeyboardEvent('keydown', { key: '5', bubbles: true }));
    click(A, '#bmS');
    await H.hasta(() => resenas(A).some(r => r.prestId === act[0].id && r.estrellas === 5));
    await guardar(A, 'B2.cfg', { pedirResena: false });
    await probar(act[1]); await H.esperar(250);
    assert.ok(!modal(A), 'con la opción apagada no se pide');
    assert.strictEqual(A.w.eval('bibCfg().pedirResena'), false);
    assert.deepStrictEqual(A.errores, [], A.errores.join('\n'));
    await A.cerrar();
  } finally { s.parar(); }
});

test('v9: lectores sin actividad por aula, aviso en Inicio y plazo configurable', { skip: omitir }, async () => {
  const s = await H.iniciarServidor();
  try {
    const A = await abrirSistema(s);
    const D = await cargarEjemplo(A);
    const dia = n => A.w.eval(`bibEnDias(${n})`), lib = D.libros[0].id;
    const lect = [
      { id: 'lx1', cod: 'LEC-9001', nombre: 'AAA DORMIDO', grado: '3° A PRIMARIA', tipo: 'Alumno' },
      { id: 'lx2', cod: 'LEC-9002', nombre: 'BBB ACTIVO', grado: '3° A PRIMARIA', tipo: 'Alumno' },
      { id: 'lx3', cod: 'LEC-9003', nombre: 'CCC NUNCA', grado: '4° B PRIMARIA', tipo: 'Alumno' },
      { id: 'lx4', cod: 'LEC-9004', nombre: 'DDD PROFE', grado: 'DOCENTE', tipo: 'Docente' }
    ];
    const prest = [
      { id: 'px1', libroId: lib, lectorId: 'lx1', lector: 'AAA DORMIDO', grado: '3° A PRIMARIA', fecha: dia(-70), vence: dia(-63), devuelto: dia(-65) },
      { id: 'px2', libroId: lib, lectorId: 'lx2', lector: 'BBB ACTIVO', grado: '3° A PRIMARIA', fecha: dia(-40), vence: dia(10), devuelto: '' } // lo tiene hace 40 días pero aún no vence
    ];
    await guardar(A, 'BKEYS.lect', lect); await guardar(A, 'BKEYS.prest', prest);
    ir(A, 'bibInact');
    const t = texto(A);
    assert.ok(t.includes('AAA DORMIDO') && t.includes('CCC NUNCA'), 'salen el dormido y el que nunca leyó');
    assert.ok(!t.includes('BBB ACTIVO') && !t.includes('DDD PROFE'), 'no salen el que está leyendo ni los docentes');
    assert.ok(t.includes('Nunca sacó un libro'));
    // filtrar por aula
    A.d.getElementById('inGrupo').value = '3° A PRIMARIA'; A.d.getElementById('inGrupo').dispatchEvent(new A.w.Event('change', { bubbles: true }));
    await H.hasta(() => !texto(A).includes('CCC NUNCA') || false);
    assert.ok(texto(A).includes('AAA DORMIDO'));
    // plazo: con 90 días el dormido (65) ya no aparece
    A.d.getElementById('inDias').value = '90'; A.d.getElementById('inDias').dispatchEvent(new A.w.Event('change', { bubbles: true }));
    await H.hasta(() => !texto(A).includes('AAA DORMIDO'));
    // Inicio avisa con el plazo guardado en las reglas (30 por defecto)
    ir(A, 'bibInicio');
    assert.ok(texto(A).includes('alumno(s) sin leer hace más de 30 días'), 'aviso en Inicio');
    assert.ok(A.d.querySelector('#nav, nav, .sidebar').textContent.includes('Lectores sin actividad'));
    assert.deepStrictEqual(A.errores, [], A.errores.join('\n'));
    await A.cerrar();
  } finally { s.parar(); }
});

test('v9: certificados de lector: candidatos por libros devueltos, se puede desmarcar y se imprime un certificado por hoja', { skip: omitir }, async () => {
  const s = await H.iniciarServidor();
  try {
    const A = await abrirSistema(s);
    const D = await cargarEjemplo(A);
    const anio = A.w.eval('new Date().getFullYear()'), lib = D.libros[0].id;
    const lect = [1, 2, 3].map(i => ({ id: 'lc' + i, cod: 'LEC-900' + i, nombre: 'LECTOR ' + i, grado: '5° A PRIMARIA', tipo: 'Alumno' }));
    const prest = [];
    [['lc1', 6], ['lc2', 3], ['lc3', 2]].forEach(([id, n]) => { for (let i = 0; i < n; i++) prest.push({ id: 'pc' + id + i, libroId: lib, lectorId: id, lector: id.toUpperCase(), grado: '5° A PRIMARIA', fecha: anio + '-03-0' + (i + 1), vence: anio + '-03-1' + i, devuelto: anio + '-03-0' + (i + 1) }); });
    await guardar(A, 'BKEYS.lect', lect); await guardar(A, 'BKEYS.prest', prest);
    ir(A, 'bibCert');
    assert.ok(texto(A).includes('LECTOR 1') && texto(A).includes('LECTOR 2') && !texto(A).includes('LECTOR 3'), 'con mínimo 3 entran 2 de 3');
    assert.ok(texto(A).includes('Lector experto') === false && texto(A).includes('Lector constante'), 'insignia según libros (6 = constante)');
    click(A, '#ctImp');
    await H.hasta(() => A.ventanas.length === 1);
    let html = A.ventanas[0].doc.html;
    assert.strictEqual((html.match(/class="cert"/g) || []).length, 2);
    assert.ok(html.includes('LECTOR 1') && html.includes('CERTIFICADO DE LECTOR') && html.includes(String(anio)));
    // desmarcar a uno
    click(A, '[data-ctid="lc2"]'); await H.hasta(() => A.d.querySelector('#ctImp').textContent.includes('1 certificado'));
    click(A, '#ctImp'); await H.hasta(() => A.ventanas.length === 2);
    html = A.ventanas[1].doc.html;
    assert.strictEqual((html.match(/class="cert"/g) || []).length, 1);
    assert.ok(!html.includes('LECTOR 2') && html.includes('LECTOR 1'));
    // bajando el mínimo a 2 entra el tercero
    A.d.getElementById('ctMin').value = '2'; A.d.getElementById('ctMin').dispatchEvent(new A.w.Event('change', { bubbles: true }));
    await H.hasta(() => texto(A).includes('LECTOR 3'));
    assert.deepStrictEqual(A.errores, [], A.errores.join('\n'));
    await A.cerrar();
  } finally { s.parar(); }
});

test('v9: el respaldo de la biblioteca incluye las reseñas', { skip: omitir }, async () => {
  const s = await H.iniciarServidor();
  try {
    const A = await abrirSistema(s);
    assert.ok(A.w.eval('bibKeysTodas().includes("sigie:bib_resenas")'));
    await A.cerrar();
  } finally { s.parar(); }
});
