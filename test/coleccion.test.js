// Uso de la colección: lógica pura + pantalla dibujada con los scripts reales en un sandbox de Node (sin jsdom).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../coleccion-util.js');
const leer = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const libros = [
  { id: 'a', cod: 'A1', titulo: 'El zorro', autor: 'Ana', catId: 'c1', cant: 1 },
  { id: 'b', cod: 'B1', titulo: 'Mar <b>azul</b>', autor: 'Luis', catId: 'c1', cant: 4 },
  { id: 'c', cod: 'C1', titulo: 'Atlas', autor: 'Eva', catId: 'c2', cant: 1 },
  { id: 'd', cod: 'D1', titulo: 'Dado de baja', catId: 'c2', cant: 1, baja: true },
  { id: 'e', cod: 'E1', titulo: 'Sin <b>categoría</b>', catId: '', cant: 0 }
];
const cats = [{ id: 'c1', nombre: 'Cuentos' }, { id: 'c2', nombre: 'Ciencia' }];
const prest = [
  { libroId: 'a', fecha: '2026-03-01' }, { libroId: 'a', fecha: '2026-05-01' }, { libroId: 'a', fecha: '2026-06-01' }, { libroId: 'a', fecha: '2025-01-01' },
  { libroId: 'b', fecha: '2026-04-01' }, { libroId: 'c', fecha: '2025-06-01' }, { libroId: 'd', fecha: '2026-04-01' }, { libroId: 'zzz', fecha: '2026-04-01' }
];

test('analizar: cuenta por periodo, excluye bajas y préstamos de libros que ya no existen', () => {
  const a = C.analizar({ libros, prestamos: prest, reservas: [], categorias: cats, desde: '2026-01-01' });
  assert.strictEqual(a.kpi.titulos, 4, 'sin el libro dado de baja');
  const fa = a.filas.find(f => f.libro.id === 'a'), fc = a.filas.find(f => f.libro.id === 'c');
  assert.deepStrictEqual([fa.prestamosPeriodo, fa.prestamosTotal, fa.rotacion, fa.ultimo], [3, 4, 3, '2026-06-01']);
  assert.deepStrictEqual([fc.prestamosPeriodo, fc.prestamosTotal], [0, 1], 'salió el año pasado: fuera del periodo, no es «nunca»');
  assert.strictEqual(a.kpi.nuncaPrestados, 1, 'solo «Sin categoría» no tiene ningún préstamo');
  assert.strictEqual(a.filas.find(f => f.libro.id === 'e').ejemplares, 1, 'cantidad 0 se toma como 1');
  const todo = C.analizar({ libros, prestamos: prest, reservas: [], categorias: cats, desde: '' });
  assert.strictEqual(todo.filas.find(f => f.libro.id === 'c').prestamosPeriodo, 1, 'sin periodo = todo el historial');
});

test('analizar: rotación por categoría, alta demanda por rotación o lista de espera, y orden de sin movimiento', () => {
  const a = C.analizar({ libros, prestamos: prest, reservas: [{ libroId: 'c', estado: 'Espera' }, { libroId: 'c', estado: 'Atendida' }], categorias: cats, desde: '2026-01-01' });
  const cu = a.porCat.find(c => c.nombre === 'Cuentos');
  assert.deepStrictEqual([cu.titulos, cu.ejemplares, cu.prestamos, cu.rotacion, cu.pctUso], [2, 5, 4, 0.8, 100]);
  assert.strictEqual(a.porCat.find(c => c.nombre === 'Sin categoría').titulos, 1);
  assert.deepStrictEqual(a.demanda.map(f => f.libro.id), ['c', 'a'], 'primero el que tiene lectores esperando; luego el de rotación 3');
  assert.strictEqual(a.demanda[0].enEspera, 1, 'solo cuenta las reservas en Espera');
  assert.deepStrictEqual(a.sinMovimiento.map(f => f.libro.id), ['e', 'c'], 'primero el que nunca salió');
  assert.ok(a.umbral >= 2);
});

test('analizar: sin datos no falla', () => {
  const a = C.analizar({ libros: [], prestamos: [], reservas: [], categorias: [], desde: '' });
  assert.deepStrictEqual([a.kpi.titulos, a.kpi.pctUso, a.kpi.rotacionMedia, a.demanda.length, a.sinMovimiento.length], [0, 0, 0, 0, 0]);
  assert.strictEqual(C.analizar({}).filas.length, 0);
});

function montar(d) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sb = { console, BIB_TITULOS7: {}, BIB_RENDER: {}, BIB_VIEWS: [], esc, toast() {}, render() {}, document: { getElementById: () => null },
    bibNav: () => ({ items: [{ id: 'bibLibros' }, { id: 'bibReporte' }, { id: 'bibSalud' }] }), bibWire5() {}, today: () => '2026-10-15',
    bibLibros: () => d.libros, bibPrest: () => d.prest, bibRes: () => d.res, bibCats: () => d.cats, bibInicioAnio: () => '2026-01-01', bibEnDias: n => '2025-10-15', bibFechaCorta: f => f, bibXlsx() {} };
  sb.window = sb; vm.createContext(sb);
  for (const f of ['panel-util.js', 'coleccion-util.js', 'coleccion.js']) vm.runInContext(leer(f), sb, { filename: f });
  return sb;
}

test('pantalla: se registra en el menú tras «Reporte general», dibuja KPIs, gráfico y tablas y escapa HTML', () => {
  const sb = montar({ libros, prest, res: [], cats });
  assert.ok(sb.BIB_VIEWS.includes('bibColec'));
  assert.deepStrictEqual(sb.bibNav().items.map(i => i.id), ['bibLibros', 'bibReporte', 'bibColec', 'bibSalud']);
  const h = sb.BIB_RENDER.bibColec();
  assert.match(h, /Rotación por categoría/); assert.match(h, /Alta demanda/); assert.match(h, /Sin movimiento/); assert.match(h, /<svg /);
  assert.ok(h.includes('Sin &lt;b&gt;categoría') && !h.includes('<b>categoría'), 'título escapado');
  assert.ok(!/NaN|undefined/.test(h));
});

test('pantalla: con colección vacía muestra avisos y no falla', () => {
  const h = montar({ libros: [], prest: [], res: [], cats: [] }).BIB_RENDER.bibColec();
  assert.match(h, /Aún no hay préstamos/); assert.match(h, /Ningún libro destaca/); assert.ok(!/NaN|undefined/.test(h));
});
