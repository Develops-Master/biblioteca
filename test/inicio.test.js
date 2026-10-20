const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const I = require('../inicio-util.js');
const leer = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const HOY = '2026-10-15';
const cats = [{ id:'c1', nombre:'Cuentos', color:'#C77D2E' }, { id:'c2', nombre:'Ciencia', color:'#3E6B4F' }];
const libros = [
  { id:'a', titulo:'Cuentos andinos', catId:'c1', cant:3, estado:'Bueno' }, { id:'b', titulo:'Átomos <b>', catId:'c2', cant:1, estado:'Malo' },
  { id:'c', titulo:'Nunca prestado', catId:'c2', cant:2, estado:'Regular' }
];
const prest = [
  { id:'1', libroId:'a', lector:'Ana', grado:'3A', fecha:'2026-10-10', vence:'2026-10-17' },
  { id:'2', libroId:'a', lector:'Luis', grado:'3A', fecha:'2026-09-20', vence:'2026-09-27' },
  { id:'3', libroId:'b', lector:'Ana', grado:'3A', fecha:'2026-10-01', vence:'2026-10-08', devuelto:'2026-10-07' },
  { id:'4', libroId:'b', lector:'Rosa', grado:'4B', fecha:'2026-10-02', vence:'2026-10-09', devuelto:'2026-10-14' },
  { id:'5', libroId:'a', lector:'Rosa', grado:'4B', fecha:HOY, vence:'2026-10-22', devuelto:HOY }
];
const res = [{ estado:'Espera' }, { estado:'Disponible' }, { estado:'Atendida' }];
const lect = [{ id:'l1', tipo:'Alumno' }, { id:'l2', tipo:'Docente' }, { id:'l3', baja:true }];
const base = { hoy:HOY, prest, res, lect, libros, cats, estantes:[{ toma:{}, diasToma:10 }, { toma:null, diasToma:null }] };

test('calcular: totales, estados y conteos', () => {
  const D = I.calcular(base);
  assert.strictEqual(D.activos, 2); assert.strictEqual(D.vencidos, 1); assert.strictEqual(D.porVencer, 1);
  assert.deepStrictEqual(D.estadoPrest.map(e => e.valor), [0, 1, 1]);
  assert.strictEqual(D.totalEj, 6); assert.strictEqual(D.disponibles, 4);
  assert.strictEqual(D.prestHoy, 1); assert.strictEqual(D.devHoy, 1);
  assert.strictEqual(D.nuncaPrestados, 1); assert.strictEqual(D.malos, 1);
  assert.strictEqual(D.lectoresActivos, 2); assert.strictEqual(D.listas, 1); assert.strictEqual(D.enEspera, 1);
  assert.strictEqual(D.estantes.pct, 50);
  assert.strictEqual(D.meses.length, 6); assert.strictEqual(D.meses[5].k, '2026-10'); assert.strictEqual(D.meses[5].prestados, 4);
  assert.strictEqual(D.dia30.fechas.length, 30); assert.strictEqual(D.dia30.fechas[29], HOY);
  assert.strictEqual(D.semana.reduce((a, b) => a + b, 0), 5);
  assert.strictEqual(D.cumplimiento.devueltos, 3); assert.strictEqual(D.cumplimiento.pct, 67);
});

test('calcular: sin datos no falla ni produce NaN', () => {
  const D = I.calcular({ hoy:HOY });
  assert.strictEqual(D.activos, 0); assert.strictEqual(D.estantes.pct, 0); assert.strictEqual(D.cumplimiento.pct, 0);
  assert.ok(!/NaN|undefined/.test(JSON.stringify(D)));
});

test('gráficos: dibujan SVG, escapan HTML y avisan cuando no hay datos', () => {
  const D = I.calcular(base);
  const todo = [I.donut(D.estadoPrest, '2', 'en préstamo'), I.barrasH([{ label:'<img onerror=x>', valor:3 }], { rank:true }),
    I.columnas(['a', 'b'], [{ nombre:'x', color:'#000', valores:[1, 5] }]), I.linea(D.dia30.fechas, [{ nombre:'x', color:'#000', valores:D.dia30.prestados }]),
    I.medidor(67, '#000', 't', 's'), I.spark([1, 2, 3], '#000')].join('');
  assert.match(todo, /<svg/); assert.ok(!todo.includes('<img onerror') && !/NaN|undefined/.test(todo));
  assert.match(I.barrasH([]), /hm-vacio/); assert.match(I.columnas([], []), /hm-vacio/); assert.match(I.linea(['a'], [{ nombre:'x', color:'#000', valores:[0] }]), /hm-vacio/);
  assert.match(I.donut([{ label:'a', valor:0, color:'#000' }], '0'), /<svg/);
});

function montar(d) {
  const sb = { console, BIB_RENDER:{ bibInicio:() => 'ANTERIOR' }, KEYS:{ config:'cfg' }, DB:{ get:() => ({ nombreIE:'IE <Prueba>' }) }, esc:I.esc, today:() => HOY,
    SigieBib:{ claveGrado:g => String(g) }, bibStats:() => ({ libros:d.libros, cats:d.cats, porUbi:d.estantes || [], vencidos:d.vencidos || [], malos:d.libros.filter(l => l.estado === 'Malo'), totalEj:6 }),
    bibPrest:() => d.prest, bibRes:() => d.res, bibLect:() => d.lect, bibDiasDesdeRespaldo:() => null, bibCfg:() => ({}), isAdmin:() => false };
  sb.window = sb; vm.createContext(sb);
  vm.runInContext(leer('inicio-util.js'), sb, { filename:'inicio-util.js' });
  vm.runInContext(leer('inicio.js'), sb, { filename:'inicio.js' });
  return sb;
}

test('pantalla: 6 indicadores, tarjetas de 3 columnas y gráficos; HTML escapado', () => {
  const h = montar({ ...base }).BIB_RENDER.bibInicio();
  assert.strictEqual((h.match(/class="card hm-kpi"/g) || []).length, 6);
  assert.ok((h.match(/class="card hm-card/g) || []).length >= 15, 'al menos 15 tarjetas');
  assert.ok((h.match(/<svg /g) || []).length >= 8);
  for (const t of ['Requiere atención', 'Movimiento de los últimos 6 meses', 'Actividad diaria', 'Devoluciones a tiempo', 'Libros por categoría', 'Disponibilidad', 'Rotación por categoría', 'Estantes verificados', 'Pulso de la colección']) assert.ok(h.includes(t), t);
  assert.ok(h.includes('IE &lt;Prueba&gt;') && !h.includes('IE <Prueba>'));
  assert.ok(!/NaN|undefined/.test(h));
});

test('pantalla: con la biblioteca vacía no falla; si el dibujo falla, vuelve la pantalla anterior', () => {
  const vacio = montar({ prest:[], res:[], lect:[], libros:[], cats:[] });
  const h = vacio.BIB_RENDER.bibInicio();
  assert.ok(h.includes('hm-grid') && !/NaN|undefined/.test(h));
  const roto = montar({ ...base }); roto.bibStats = () => { throw new Error('x'); };
  assert.strictEqual(roto.BIB_RENDER.bibInicio(), 'ANTERIOR');
});
