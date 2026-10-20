// Protege la "Ficha de Levantamiento de Información" (formato UGEL, 20 bienes por hoja) del inventario patrimonial.
// Este reporte alimenta lo que se entrega a la UGEL: si se toca app.js/core.js y la ficha cambia de forma, estas pruebas fallan.
// Usa los datos de ejemplo patrimoniales reales (construirDatosEjemplo) sobre la app cargada en jsdom, sin escribir nada en el servidor.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./ui-helper.js');

const omitir = !H.jsdom && 'jsdom no está instalado (npm install); se omiten las pruebas de pantalla';

const ENCABEZADOS = ['N°', 'Cód. Patrimonial', 'Código Anterior', 'Denominación', 'Marca', 'Modelo', 'Serie/Dim.', 'Color', 'Estado', 'Observaciones'];

// Abre la app y deja en DB.cache los datos de ejemplo (bienes, aulas, config). Devuelve la ventana y los datos.
async function appConEjemplo(s) {
  const jar = new H.jsdom.CookieJar();
  await H.entrar(s.url, jar);
  // La ventana de impresión simulada del helper no trae lo que abrirVentanaImpresion espera de un documento real
  // (images, querySelectorAll para ajustar celdas); se completa aquí sin tocar el helper compartido.
  const A = await H.abrir(s.url, 'index.html', jar, { antes: w => {
    const abrirOriginal = w.open;
    w.open = u => { const v = abrirOriginal(u); v.document.images = []; v.document.querySelectorAll = () => []; return v; };
  } });
  await H.hasta(() => A.w.eval('typeof STATE!=="undefined" && STATE.loaded') && A.d.getElementById('content') && A.d.getElementById('content').innerHTML.length > 200, 30000);
  A.w.eval(`(function(){
    const D = construirDatosEjemplo({ hoy: today(), anio: new Date().getFullYear(), uid: uid, bibCats: BIB_SEED,
      categoriasDeprec: SEED_CATEGORIAS_DEPREC, lookupCategoria: lookupCategoriaDeprec, usuariosPrevios: [],
      totalesSIGIE: () => ({ porCategoria: [] }), snapshotItems: items => items.map(i => ({ id: i.id })) });
    DB.cache[KEYS.config] = Object.assign({}, DEFAULT_CONFIG, D.cfg);
    DB.cache[KEYS.aulas] = D.aulas;
    DB.cache[KEYS.items] = D.items;
    window.__D = D;
  })()`);
  return A;
}

// Levanta servidor + app con datos de ejemplo y los cierra siempre, aunque falle una aserción (si no, la corrida se cuelga).
async function conSistema(fn) {
  const s = await H.iniciarServidor();
  let A = null;
  try { A = await appConEjemplo(s); await fn(A); }
  finally { if (A) await A.cerrar(); s.parar(); }
}

// Convierte el HTML de las fichas en un documento para poder consultarlo como lo vería la impresora.
function fichasDe(A, html) {
  const cont = A.d.createElement('div');
  cont.innerHTML = html;
  return [...cont.querySelectorAll('.ficha')].map(f => {
    const meta = {};
    f.querySelectorAll('.meta-table td').forEach(td => {
      const m = td.textContent.match(/^\s*([^:]+):\s*(.*)$/);
      if (m) meta[m[1].trim()] = m[2].trim();
    });
    const filas = [...f.querySelectorAll('.bienes-table tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
    return { el: f, meta, filas, encabezados: [...f.querySelectorAll('.bienes-table thead th')].map(th => th.textContent.trim()) };
  });
}

test('ficha UGEL de todo el colegio: formato oficial, 20 filas por hoja y numeración correlativa', { skip: omitir }, async () => conSistema(async (A) => {
    const r = A.w.eval('construirInventarioCompletoFichasHTML()');
    const total = A.w.eval('__D.items.length');
    assert.strictEqual(r.totalBienes, total);
    const fichas = fichasDe(A, r.html);
    assert.strictEqual(fichas.length, r.totalFichas, 'una ficha por cada bloque de 20 bienes');

    fichas.forEach((f, i) => {
      const n = 'ficha ' + (i + 1);
      assert.match(f.el.textContent, /Ficha de Levantamiento de Información/, n);
      assert.match(f.el.textContent, /Inventario Patrimonial \d{4}/, n);
      assert.deepStrictEqual(f.encabezados, ENCABEZADOS, n + ': columnas del formato oficial, en orden');
      assert.strictEqual(f.filas.length, 20, n + ': siempre 20 filas (las sobrantes en blanco)');
      assert.strictEqual(f.meta['Planilla N°'], String(i + 1).padStart(4, '0'), n + ': planilla correlativa');
      assert.ok(f.meta['Ubicación / Área'], n + ': trae la ubicación');
      assert.match(f.el.textContent, /Firma Usuario Responsable/, n);
      assert.match(f.el.textContent, /Firma Personal Inventariador/, n);
      assert.match(f.el.textContent, /Muy Bueno \(MB\), Bueno \(B\), Regular \(R\), Malo \(M\)/, n);
      // el N° de fila va de 1 a 20 y las filas en blanco están al final, sin huecos
      f.filas.forEach((fila, k) => assert.strictEqual(fila[0], String(k + 1), n + ': N° de fila'));
      const llenas = f.filas.filter(fila => fila[1] !== '').length;
      assert.ok(f.filas.slice(0, llenas).every(fila => fila[1] !== '') && f.filas.slice(llenas).every(fila => fila.slice(1).every(c => c === '')), n + ': las filas vacías van al final');
      // solo la última hoja no fuerza salto de página
      assert.strictEqual(f.el.classList.contains('doc-page'), i < fichas.length - 1, n + ': salto de página');
    });
}));

test('ficha UGEL: cada bien sale una sola vez, con su código patrimonial, y no se mezclan aulas', { skip: omitir }, async () => conSistema(async (A) => {
    const r = A.w.eval('construirInventarioCompletoFichasHTML()');
    const fichas = fichasDe(A, r.html);
    const items = JSON.parse(A.w.eval('JSON.stringify(__D.items)'));
    const aulas = JSON.parse(A.w.eval('JSON.stringify(__D.aulas)'));
    const etiqueta = id => { const a = aulas.find(x => x.id === id); return a ? (a.aulaLabel || a.nombre) : ''; };

    const vistos = new Map();
    fichas.forEach(f => f.filas.forEach(fila => { if (fila[1]) vistos.set(fila[1], (vistos.get(fila[1]) || 0) + 1); }));
    assert.strictEqual(vistos.size, items.length, 'sale todo el inventario');
    assert.ok([...vistos.values()].every(n => n === 1), 'ningún bien repetido');
    items.forEach(it => assert.ok(vistos.has(it.codigoInterno), 'falta el código patrimonial ' + it.codigoInterno));
    assert.ok([...vistos.keys()].every(c => /^\d{12}$/.test(c)), 'código patrimonial = 8 dígitos SBN + 4 correlativo');

    // cada hoja contiene solo bienes de la ubicación que declara en su encabezado
    const ubicacionDe = new Map(items.map(it => [it.codigoInterno, etiqueta(it.aulaId)]));
    fichas.forEach((f, i) => f.filas.filter(fila => fila[1]).forEach(fila =>
      assert.strictEqual(ubicacionDe.get(fila[1]), f.meta['Ubicación / Área'], 'ficha ' + (i + 1) + ': ' + fila[1] + ' está en otra aula')));

    // los datos de la fila son los del bien
    const it = items.find(x => x.marca && x.numeroSerie) || items[0];
    const fila = fichas.flatMap(f => f.filas).find(x => x[1] === it.codigoInterno);
    assert.strictEqual(fila[3], it.denominacion);
    assert.strictEqual(fila[4], it.marca || '');
    assert.strictEqual(fila[6], it.numeroSerie || '');
    assert.strictEqual(fila[8], { 'Muy Bueno': 'MB', 'Bueno': 'B', 'Regular': 'R', 'Malo': 'M' }[it.estadoConservacion]);
    assert.strictEqual(fila[2], it.codigoAnioAnterior || 'S/C', 'sin código anterior se imprime S/C');
}));

test('ficha UGEL: aula con 20 y con 21 bienes, bienes sin aula y texto con HTML', { skip: omitir }, async () => conSistema(async (A) => {
    const res = JSON.parse(A.w.eval(`(function(){
      const aulas = [{ id:'T20', nombre:'AULA 20', aulaLabel:'AULA 20', responsable:'Resp. Veinte' }, { id:'T21', nombre:'AULA 21', aulaLabel:'AULA 21', responsable:'' }];
      const mk = (aulaId, n, extra) => Object.assign({ id:'it'+aulaId+n, codigoInterno:'9999'+aulaId.slice(1)+String(1000+n), denominacion:'BIEN '+n, marca:'', modelo:'', numeroSerie:'', color:'', estadoConservacion:'Bueno', aulaId }, extra||{});
      const items = [];
      for(let i=0;i<20;i++) items.push(mk('T20', i));
      for(let i=0;i<21;i++) items.push(mk('T21', i));
      items.push(mk('', 1, { id:'huerfano', codigoInterno:'888800000001', denominacion:'<img src=x onerror=alert(1)> & "comillas"' }));
      items.push(mk('AULA_BORRADA', 2, { id:'huerfano2', codigoInterno:'888800000002' }));
      DB.cache[KEYS.aulas] = aulas; DB.cache[KEYS.items] = items;
      const r = construirInventarioCompletoFichasHTML();
      const un = construirFichasHTML('T21');
      return JSON.stringify({ totalFichas:r.totalFichas, totalAmbientes:r.totalAmbientes, totalBienes:r.totalBienes, html:r.html, unaAula:{ total:un.total, numPlanillas:un.numPlanillas, html:un.html } });
    })()`));
    assert.strictEqual(res.totalBienes, 43);
    assert.strictEqual(res.totalAmbientes, 3, 'AULA 20, AULA 21 y SIN AULA (un solo bloque para los dos huérfanos)');
    assert.strictEqual(res.totalFichas, 1 + 2 + 1, '20 → 1 hoja; 21 → 2 hojas; 2 huérfanos → 1 hoja');
    const fichas = fichasDe(A, res.html);
    assert.deepStrictEqual(fichas.map(f => f.meta['Ubicación / Área']), ['AULA 20', 'AULA 21', 'AULA 21', 'SIN AULA / AMBIENTE ASIGNADO']);
    assert.deepStrictEqual(fichas.map(f => f.filas.filter(x => x[1]).length), [20, 20, 1, 2]);
    assert.strictEqual(fichas[0].meta['Usuario responsable'], 'Resp. Veinte');
    assert.strictEqual(fichas[1].meta['Usuario responsable'], '_____________________', 'sin responsable queda la línea para firmar');
    // el texto no se interpreta como HTML
    assert.ok(!res.html.includes('<img src=x'), 'la denominación va escapada');
    assert.ok(fichas[3].filas.some(f => f[3] === '<img src=x onerror=alert(1)> & "comillas"'), 'el texto se ve tal cual');
    // planilla de un aula suelta: misma ficha, mismo formato
    assert.strictEqual(res.unaAula.total, 21);
    assert.strictEqual(res.unaAula.numPlanillas, 2);
    const fa = fichasDe(A, res.unaAula.html);
    assert.deepStrictEqual(fa.map(f => f.meta['Planilla N°']), ['0001', '0002']);
    assert.ok(fa.every(f => f.filas.length === 20 && JSON.stringify(f.encabezados) === JSON.stringify(ENCABEZADOS)));
}));

test('ficha UGEL: el botón "PDF oficial UGEL" abre la ventana de impresión horizontal, y la planilla por aula se genera desde su pantalla', { skip: omitir }, async () => conSistema(async (A) => {
    A.w.eval('STATE.view = "reportes"; render();');
    const boton = A.d.getElementById('expInventarioPDF');
    assert.ok(boton, 'el botón sigue en Reportes');
    boton.click();
    const v = A.ventanas[A.ventanas.length - 1];
    assert.ok(v, 'se abrió la ventana de impresión');
    assert.match(v.doc.html, /@page\{ size:landscape/, 'orientación horizontal');
    assert.match(v.doc.html, /Ficha de Levantamiento de Información/);
    assert.strictEqual((v.doc.html.match(/class="ficha(?: doc-page)?"/g) || []).length, A.w.eval('construirInventarioCompletoFichasHTML().totalFichas'));

    // pantalla "Planillas de verificación": elegir un aula y generar
    A.w.eval('STATE.view = "planillas"; render();');
    const sel = A.d.getElementById('pl_aula');
    assert.ok(sel && sel.options.length > 1, 'el selector lista las aulas');
    sel.value = sel.options[1].value;
    A.d.getElementById('pl_generar').click();
    await H.hasta(() => /Ficha de Levantamiento de Información/.test(A.d.getElementById('pl_preview').textContent));
    assert.strictEqual(A.d.querySelectorAll('#pl_preview .ficha').length >= 1, true);
    assert.deepStrictEqual(A.errores, [], A.errores.join('\n'));
}));

test('ficha UGEL: un rol de solo consulta (director/UGEL) puede ver y exportar la ficha', { skip: omitir }, async () => conSistema(async (A) => {
    A.w.eval('STATE.session = Object.assign({}, STATE.session, { rol: "CONSULTA" }); STATE.view = "reportes"; render();');
    const boton = A.d.getElementById('expInventarioPDF');
    assert.ok(boton, 'CONSULTA ve el botón');
    boton.click();
    assert.ok(A.ventanas.length >= 1, 'CONSULTA puede generar el PDF');
}));
