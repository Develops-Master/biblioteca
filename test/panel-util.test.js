// Panel «Mi lectura» y gráficos del tablero: lógica pura (sin navegador ni servidor).
const test = require('node:test');
const assert = require('node:assert');
const P = require('../panel-util.js');

const HOY = '2026-10-15';

test('serieDias: devuelve N días terminando hoy, suma por día y filtra por lector', () => {
  const bit = [
    { lectorId: 'a', fecha: '2026-10-15', paginas: 10, minutos: 20 },
    { lectorId: 'a', fecha: '2026-10-15', paginas: 5, minutos: 10 },
    { lectorId: 'b', fecha: '2026-10-14', paginas: 7, minutos: 15 },
    { lectorId: 'a', fecha: '2026-09-01', paginas: 99, minutos: 99 }   // fuera de la ventana
  ];
  const s = P.serieDias({ bitacora: bit, lectorId: 'a', hoy: HOY, dias: 14 });
  assert.strictEqual(s.length, 14);
  assert.strictEqual(s[13].fecha, HOY);
  assert.strictEqual(s[0].fecha, '2026-10-02');
  assert.deepStrictEqual([s[13].lecturas, s[13].paginas, s[13].minutos], [2, 15, 30]);
  assert.strictEqual(s[12].minutos, 0, 'el lector b no cuenta');
  const todos = P.serieDias({ bitacora: bit, lectorId: '', hoy: HOY, dias: 14 });
  assert.strictEqual(todos[12].minutos, 15, 'sin lector = todos');
  assert.strictEqual(P.serieDias({ bitacora: [], hoy: HOY, dias: 0 }).length, 14, 'días inválidos → 14');
});

test('serieDias: ignora valores negativos o no numéricos y cruza el cambio de mes', () => {
  const s = P.serieDias({ bitacora: [{ lectorId: 'a', fecha: '2026-10-01', paginas: 'x', minutos: -5 }], lectorId: 'a', hoy: '2026-10-02', dias: 3 });
  assert.deepStrictEqual(s.map(x => x.fecha), ['2026-09-30', '2026-10-01', '2026-10-02']);
  assert.deepStrictEqual([s[1].lecturas, s[1].paginas, s[1].minutos], [1, 0, 0]);
});

test('tendencia: compara la última semana con la anterior', () => {
  const mk = (prev, act) => [...Array(7).fill(0).map((_, i) => ({ minutos: i === 0 ? prev : 0, lecturas: i === 0 && prev ? 1 : 0 })), ...Array(7).fill(0).map((_, i) => ({ minutos: i === 6 ? act : 0, lecturas: i === 6 && act ? 1 : 0 }))];
  assert.strictEqual(P.tendencia(mk(60, 90)).estado, 'sube');
  assert.strictEqual(P.tendencia(mk(60, 90)).cambioPct, 50);
  assert.strictEqual(P.tendencia(mk(100, 40)).estado, 'baja');
  assert.strictEqual(P.tendencia(mk(100, 102)).estado, 'igual');
  assert.strictEqual(P.tendencia(mk(0, 30)).estado, 'sube');
  assert.strictEqual(P.tendencia(mk(0, 30)).cambioPct, null, 'sin semana previa no hay porcentaje');
  assert.strictEqual(P.tendencia(mk(0, 0)).estado, 'sin_datos');
  assert.strictEqual(P.tendencia([]).estado, 'sin_datos');
});

test('metaMes: avance, días que quedan y ritmo', () => {
  const a = P.metaMes({ leidos: 2, meta: 4, hoy: '2026-10-15' });
  assert.deepStrictEqual([a.pct, a.faltan, a.quedan, a.ritmo], [50, 2, 16, 'al_dia']);
  assert.strictEqual(P.metaMes({ leidos: 0, meta: 4, hoy: '2026-10-25' }).ritmo, 'atrasado');
  assert.strictEqual(P.metaMes({ leidos: 5, meta: 4, hoy: '2026-10-10' }).ritmo, 'cumplida');
  assert.strictEqual(P.metaMes({ leidos: 5, meta: 4, hoy: '2026-10-10' }).pct, 100, 'el porcentaje no pasa de 100');
  const sin = P.metaMes({ leidos: 1, meta: 0, hoy: '2026-02-10' });
  assert.deepStrictEqual([sin.pct, sin.ritmo, sin.quedan], [null, 'sin_meta', 18], 'febrero 2026 tiene 28 días');
});

const libros = [
  { id: 'l1', titulo: 'El zorro y la luna', autor: 'Ana Pérez', catId: 'c1', cod: 'B1' },
  { id: 'l2', titulo: 'Dragones del norte', autor: 'Ana Pérez', catId: 'c1', cod: 'B2' },
  { id: 'l3', titulo: 'Cuentos de selva', autor: 'Luis Ruiz', catId: 'c1', cod: 'B3' },
  { id: 'l4', titulo: 'Atlas del cuerpo', autor: 'Eva Gil', catId: 'c2', cod: 'B4' },
  { id: 'l5', titulo: 'Libro agotado', autor: 'Eva Gil', catId: 'c1', cod: 'B5' },
  { id: 'l6', titulo: 'Libro dado de baja', autor: 'Eva Gil', catId: 'c1', cod: 'B6', baja: true }
];
const cats = [{ id: 'c1', nombre: 'Cuentos' }, { id: 'c2', nombre: 'Ciencia' }];
const libres = l => (l.id === 'l5' ? 0 : 1);

test('recomendar: no repite lo ya leído, ni lo agotado, ni lo dado de baja; prioriza el mismo autor', () => {
  const lector = { id: 'a' };
  const r = P.recomendar({ lector, libros, categorias: cats, libres,
    prestamos: [{ lectorId: 'a', libroId: 'l1', devuelto: '2026-10-01' }],
    bitacora: [{ lectorId: 'a', libroId: 'l1', autoevaluacion: 5 }], resenas: [], max: 5 });
  const ids = r.map(x => x.libro.id);
  assert.ok(!ids.includes('l1'), 'ya lo leyó');
  assert.ok(!ids.includes('l5'), 'sin ejemplares libres');
  assert.ok(!ids.includes('l6'), 'dado de baja');
  assert.strictEqual(ids[0], 'l2', 'mismo autor primero');
  assert.match(r[0].motivo, /mismo autor/);
  assert.strictEqual(r.find(x => x.libro.id === 'l3').motivo, 'Le gusta la categoría Cuentos');
});

test('recomendar: lector sin historial recibe los más pedidos / mejor valorados; el título escrito a mano también cuenta como leído', () => {
  const prest = [...Array(4)].map(() => ({ lectorId: 'otro', libroId: 'l4' }));
  const res = [{ lectorId: 'x', libroId: 'l4', estrellas: 5 }, { lectorId: 'y', libroId: 'l4', estrellas: 4 }];
  const r = P.recomendar({ lector: { id: 'nuevo' }, libros, categorias: cats, libres, prestamos: prest, bitacora: [], resenas: res, max: 3 });
  assert.strictEqual(r[0].libro.id, 'l4');
  assert.strictEqual(r[0].prom, 4.5);
  const r2 = P.recomendar({ lector: { id: 'a' }, libros, categorias: cats, libres, prestamos: [], resenas: [], max: 12,
    bitacora: [{ lectorId: 'a', libroId: '', libroTitulo: 'atlas del cuerpo', autoevaluacion: 3 }] });
  assert.ok(!r2.some(x => x.libro.id === 'l4'), 'título escrito sin id, normalizado');
});

test('recomendar: es determinista y respeta el máximo; no expone datos de otros lectores', () => {
  const args = { lector: { id: 'a' }, libros, categorias: cats, libres, prestamos: [], bitacora: [], resenas: [], max: 2 };
  const r1 = P.recomendar(args), r2 = P.recomendar(args);
  assert.deepStrictEqual(r1.map(x => x.libro.id), r2.map(x => x.libro.id));
  assert.strictEqual(r1.length, 2);
  assert.deepStrictEqual(Object.keys(r1[0]).sort(), ['libro', 'motivo', 'prom', 'score']);
});

test('serieMeses: últimos N meses (cruza el año) y cuenta préstamos por mes', () => {
  const s = P.serieMeses({ hoy: '2026-02-10', meses: 4, prestamos: [{ fecha: '2025-11-03' }, { fecha: '2025-11-30' }, { fecha: '2026-02-01' }, { fecha: '2025-10-31' }, {}] });
  assert.deepStrictEqual(s.map(x => x.mes), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepStrictEqual(s.map(x => x.prestamos), [2, 0, 0, 1]);
  assert.strictEqual(s[0].etiqueta, 'nov');
});

test('distribucionNiveles: cuenta AD/A/B/C del año y descarta niveles raros', () => {
  const c = [{ nivel: 'AD', fecha: '2026-03-01' }, { nivel: 'A', fecha: '2026-04-01' }, { nivel: 'A', fecha: '2025-04-01' }, { nivel: 'Z', fecha: '2026-05-01' }, { nivel: 'C', fecha: '2026-06-01' }];
  assert.deepStrictEqual(P.distribucionNiveles(c, 2026), { AD: 1, A: 1, B: 0, C: 1 });
  assert.deepStrictEqual(P.distribucionNiveles(c), { AD: 1, A: 2, B: 0, C: 1 });
});

test('gráficos SVG: bien formados, con título accesible y texto escapado', () => {
  const sucio = '<img src=x onerror=alert(1)> & "comillas"';
  const v = P.svgBarras({ titulo: sucio, items: [{ etiqueta: sucio, valor: 3 }, { etiqueta: 'b', valor: 0 }] });
  const h = P.svgBarrasH({ titulo: sucio, sufijo: ' pts', items: [{ etiqueta: sucio + ' nombre muy largo que se corta', valor: 7 }, { etiqueta: 'B', valor: 0 }] });
  for (const svg of [v, h]) {
    assert.ok(svg.startsWith('<svg ') && svg.endsWith('</svg>'));
    assert.ok(!svg.includes('<img'), 'sin HTML inyectado');
    assert.ok(svg.includes('role="img"') && svg.includes('<title>'));
    assert.ok(!/NaN|undefined|Infinity/.test(svg), 'sin NaN');
  }
  assert.ok(v.includes('&lt;img'));
  assert.ok(h.includes(' pts'));
  assert.ok(P.svgBarras({ items: [] }).includes('<svg'), 'sin datos no falla');
  assert.ok(!/NaN/.test(P.svgBarras({ items: [{ etiqueta: 'a', valor: 'x' }] })));
});
