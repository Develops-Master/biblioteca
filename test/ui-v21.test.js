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


test('v21: opac.html real muestra libros, «Últimos agregados», «Más leídos» y portada por ISBN', { skip: omitir }, async () => {
  const s = await H.iniciarServidor(); let A, P;
  try {
    A = await abrirSistema(s); const D = await cargarEjemplo(A);
    const lib = D.libros.slice(0, 3).map((l, i) => ({ ...l, id: 'lib_' + Date.now().toString(36) + 'abc0' + i, isbn: i === 0 ? '9780143127796' : l.isbn }));
    await guardar(A, 'BKEYS.libros', lib); await guardar(A, 'BKEYS.prest', [{ id: 'p1', libroId: lib[0].id, lector: 'SECRETO PEREZ', lectorId: 'x', fecha: '2026-10-01', vence: '2026-10-08' }]);
    const jar = new H.jsdom.CookieJar(); P = await H.abrir(s.url, 'opac.html', jar);
    await H.hasta(() => P.d.querySelectorAll('.libro').length === 3, 8000);
    assert.ok(P.d.querySelector('.lomo img[src*="9780143127796"]'), 'portada por ISBN');
    P.d.querySelector('[data-v="nuevos"]').click(); assert.strictEqual(P.d.querySelectorAll('.libro').length, 3);
    P.d.querySelector('[data-v="top"]').click(); assert.strictEqual(P.d.querySelectorAll('.libro').length, 1);
    assert.ok(/prestado 1 vez/.test(P.d.body.textContent) && !/SECRETO/.test(P.d.documentElement.outerHTML), 'sin nombres de lectores');
  } finally { if (P) await P.cerrar(); if (A) await A.cerrar(); s.parar(); }
});
