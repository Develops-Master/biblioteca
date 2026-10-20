// Panel «Mi lectura» y gráficos del tablero: dibuja con los scripts REALES (panel-util, lectometro-util, bib-util)
// dentro de un sandbox de Node con datos de prueba. No necesita jsdom ni servidor, así corre siempre.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

const HOY = '2026-10-15';
function montar(datos, tableroPrevio) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sb = {
    console, document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
    BIB_TITULOS7: {}, BIB_RENDER: {}, BIB_VIEWS: [], esc, today: () => HOY, canEdit: () => true, guardEdit: () => true, toast() {}, render() {},
    bibBar: p => `<bar ${p}>`, bibEscanearUno() {}, bibPrestar: async () => '',
    bibNavLectometro: () => ({ items: [{ id: 'bibLectom' }, { id: 'bibDir' }] }), bibWire5() {},
    bibBitacora: () => datos.bitacora, bibPrest: () => datos.prestamos, bibCompr: () => datos.compr, bibResenas: () => datos.resenas,
    bibCanjes: () => [], bibPremios: () => [], bibMetas: () => datos.metas, bibLibros: () => datos.libros, bibCats: () => datos.cats,
    bibEjemplares: l => l.cant || 1, bibPrestados: id => datos.prestamos.filter(p => p.libroId === id && !p.devuelto).length,
    lmLector: id => datos.lectores.find(x => x.id === id), lmGrupo: l => l.grado, lmDatalist: () => '<datalist></datalist>', lmEstrellas: n => '★'.repeat(Math.round(n)),
    lmAlumnos: () => datos.lectores, lmRanking: () => datos.lectores.map(l => ({ grupo: l.grado, puntos: 50 })), lmBuscarLector: t => datos.lectores.find(x => x.cod === t) || null
  };
  sb.window = sb; vm.createContext(sb);
  for (const f of ['bib-util.js', 'lectometro-util.js', 'panel-util.js']) vm.runInContext(leer(f), sb, { filename: f });
  sb.BIB_RENDER.bibDir = () => tableroPrevio == null ? '' : tableroPrevio;   // lo que dibuja diplomas.js antes de cargar este módulo
  vm.runInContext(leer('lectura-panel.js') + '\n;globalThis.__pl = pl; globalThis.__rec = plRecomendaciones;', sb, { filename: 'lectura-panel.js' });
  return sb;
}
const datos = () => ({
  lectores: [{ id: 'a', cod: 'LEC-0001', nombre: 'Rosa <b>Quispe</b>', grado: '3° A PRIMARIA' }, { id: 'b', cod: 'LEC-0002', nombre: 'Luis Ramos', grado: '3° A PRIMARIA' }],
  cats: [{ id: 'c1', nombre: 'Cuentos' }],
  libros: [{ id: 'l1', cod: 'B1', titulo: 'El zorro', autor: 'Ana', catId: 'c1', cant: 2 }, { id: 'l2', cod: 'B2', titulo: 'Dragones <script>', autor: 'Ana', catId: 'c1', cant: 1 }],
  prestamos: [{ id: 'p1', lectorId: 'a', libroId: 'l1', fecha: '2026-10-02', devuelto: '2026-10-09' }],
  bitacora: [{ id: 'b1', lectorId: 'a', libroId: 'l1', fecha: '2026-10-14', paginas: 12, minutos: 25, puntos: 37, autoevaluacion: 5 }, { id: 'b2', lectorId: 'b', libroId: 'l1', fecha: '2026-10-10', paginas: 5, minutos: 10, puntos: 15, autoevaluacion: 3 }],
  resenas: [], compr: [{ lectorId: 'a', nivel: 'AD', fecha: '2026-05-01' }], metas: [{ id: 'mt_3° A PRIMARIA', aula: '3° A PRIMARIA', libros: 2 }]
});

test('Mi lectura: se registra en el menú junto al Lectómetro y con su título', () => {
  const sb = montar(datos());
  assert.ok(sb.BIB_VIEWS.includes('bibMiLec') && typeof sb.BIB_RENDER.bibMiLec === 'function');
  assert.strictEqual(sb.BIB_TITULOS7.bibMiLec[0], 'Mi lectura');
  assert.deepStrictEqual(sb.bibNavLectometro().items.map(i => i.id), ['bibLectom', 'bibMiLec', 'bibDir']);
});

test('Mi lectura: sin lector elegido pide elegir uno; con lector muestra meta del aula, tendencia y recomendados', () => {
  const sb = montar(datos());
  assert.match(sb.BIB_RENDER.bibMiLec(), /Elige un lector/);
  sb.__pl.lectorId = 'a';
  const h = sb.BIB_RENDER.bibMiLec();
  assert.match(h, /Meta del mes/);
  assert.match(h, /1<\/span>|>1 </, 'un libro leído este mes');
  assert.match(h, /de 2 libro/, 'usa la meta del aula (2)');
  assert.match(h, /meta es la de su aula/);
  assert.match(h, /Últimos 14 días/);
  assert.match(h, /<svg /, 'dibuja el gráfico de tendencia');
  assert.match(h, /Para leer a continuación/);
  assert.match(h, /Prestar a/, 'el personal puede prestar desde la recomendación');
  assert.ok(!/NaN|undefined/.test(h), 'sin NaN ni undefined');
});

test('Mi lectura: sin meta de aula usa la meta personal y lo dice; todo el texto del lector va escapado', () => {
  const d = datos(); d.metas = [];
  const sb = montar(d); sb.__pl.lectorId = 'a';
  const h = sb.BIB_RENDER.bibMiLec();
  assert.match(h, /Meta personal/);
  assert.ok(h.includes('Rosa &lt;b&gt;Quispe&lt;/b&gt;') && !h.includes('<b>Quispe'), 'nombre escapado');
  assert.ok(!h.includes('<script>'), 'título de libro escapado');
});

test('Mi lectura: el lector no ve recomendaciones de lo que ya leyó ni de lo que no tiene ejemplares libres', () => {
  const d = datos(); d.libros[1].cant = 1; d.prestamos.push({ id: 'p2', lectorId: 'b', libroId: 'l2', fecha: '2026-10-12', devuelto: '' });
  const sb = montar(d);
  const r = sb.__rec(d.lectores[0], 5);
  assert.deepStrictEqual(Array.from(r, x => x.libro.id), [], 'l1 ya lo leyó y l2 está prestado');
  sb.__pl.lectorId = 'a';
  assert.match(sb.BIB_RENDER.bibMiLec(), /No hay libros disponibles/);
});

test('Tablero: se le añaden los 4 gráficos sin romper el contenido anterior', () => {
  const previo = '<div id="tablero-previo">KPIs</div>';
  const sb = montar(datos(), previo);
  const h = sb.BIB_RENDER.bibDir();
  assert.ok(h.startsWith(previo), 'conserva el tablero original');
  assert.strictEqual((h.match(/<svg /g) || []).length, 4, 'cuatro gráficos');
  assert.match(h, /Lecturas registradas por día/);
  assert.match(h, /Préstamos por mes/);
  assert.match(h, /Comprensión lectora 2026/);
  assert.match(h, /Aulas que más leen/);
  assert.ok(!/NaN|undefined/.test(h));
});

test('Tablero: sin datos muestra avisos en vez de gráficos vacíos', () => {
  const d = datos(); d.bitacora = []; d.prestamos = []; d.compr = []; d.lectores = [];
  const sb = montar(d);
  const h = sb.BIB_RENDER.bibDir();
  assert.strictEqual((h.match(/<svg /g) || []).length, 0);
  assert.strictEqual((h.match(/class="hint"/g) || []).length, 4);
});
