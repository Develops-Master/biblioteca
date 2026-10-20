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


test('v20: Lectores (colores, plantillas), OPAC y Reportes en color se dibujan con datos de ejemplo', { skip: omitir }, async () => {
  const s = await H.iniciarServidor(); let A;
  try {
    A = await abrirSistema(s); await cargarEjemplo(A);
    ir(A, 'bibLect'); let h = A.d.getElementById('content').innerHTML;
    assert.ok(h.includes('data-lxplant="alumnos"') && h.includes('data-lxplant="personal"'), 'botones de plantilla');
    assert.ok(/border-left:12px solid #/.test(h), 'carnés con color de nivel');
    ir(A, 'bibOpac'); assert.ok(texto(A).includes('¿Qué quieres leer hoy?') && A.d.querySelector('#content img'), 'pantalla OPAC con QR');
    ir(A, 'bibRepColor'); assert.ok(A.d.querySelector('.rc'), 'mapa de calor');
    for (const k of ['venc', 'coleccion', 'aula', 'mapa']) { click(A, '[data-rcrep="' + k + '"]'); assert.ok(A.d.querySelector('.rc, .empty'), 'reporte ' + k); assert.ok(!/undefined|NaN/.test(texto(A)), 'sin undefined/NaN en ' + k); }
    click(A, '[data-rcrep="aula"]'); assert.ok(A.d.querySelector('#rcAula') && A.d.querySelectorAll('#rcAula option').length > 1, 'selector de aula');
    A.d.querySelector('#rcAula').value = A.d.querySelectorAll('#rcAula option')[1].value; A.d.querySelector('#rcAula').dispatchEvent(new A.w.Event('change', { bubbles: true }));
    assert.ok(/participación/.test(texto(A)) && !/undefined|NaN/.test(texto(A)), 'cambia de aula sin errores');
    click(A, '[data-rcrep="coleccion"]'); assert.ok(A.d.querySelectorAll('.sw').length > 0, 'categorías con color');
  } finally { if (A) await A.cerrar(); s.parar(); }
});
