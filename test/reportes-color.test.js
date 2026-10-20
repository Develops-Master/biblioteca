const test = require('node:test');
const assert = require('node:assert');
const R = require('../reportes-color-util.js');
const cats = [{ id:'c1', nombre:'Cuentos', color:'#C77D2E' }, { id:'c2', nombre:'Ciencia', color:'#3E6B4F' }, { id:'c3', nombre:'Vacía', color:'#000' }];
const libros = [{ id:'a', catId:'c1', titulo:'Uno', cant:3 }, { id:'b', catId:'c2', titulo:'Dos', cant:1 }, { id:'x', catId:'c2', titulo:'Baja', cant:5, baja:'2026-01-01' }];
const lect = [{ id:'l1', tipo:'Alumno', grado:'Primaria · 2° B' }, { id:'l2', tipo:'Docente' }];
const nivelDe = (l, p) => !l ? 'Sin nivel' : l.tipo !== 'Alumno' ? 'Personal' : 'Primaria';
const prest = [{ libroId:'a', lectorId:'l1', fecha:'2026-10-01', vence:'2026-10-08', lector:'Ana' }, { libroId:'a', lectorId:'l2', fecha:'2026-10-02', vence:'2026-10-30', lector:'Prof' },
  { libroId:'b', lectorId:'zz', fecha:'2026-01-01', vence:'2026-01-08', devuelto:'2026-01-05', lector:'Viejo' }];
test('matriz nivel × categoría: cuenta, filtra por periodo y ordena', () => {
  const m = R.matrizNivelCategoria({ libros, cats, prest, lect, desde:'2026-09-01', nivelDe });
  assert.deepStrictEqual(m.niveles, ['Primaria', 'Personal']); assert.strictEqual(m.filas.length, 1); assert.deepStrictEqual(m.filas[0].valores, [1, 1]); assert.strictEqual(m.total, 2);
  assert.strictEqual(R.matrizNivelCategoria({ libros, cats, prest, lect, desde:'', nivelDe }).filas.length, 2);
});
test('vencidos por aula con semáforo', () => {
  const v = R.vencidosPorAula({ libros, prest, hoy:'2026-10-16', aulaDe:p => p.lectorId==='l1' ? '2° B PRIMARIA' : '' });
  assert.strictEqual(v.length, 1); assert.strictEqual(v[0].items[0].dias, 8); assert.strictEqual(v[0].items[0].color, '#e8913a');
  assert.strictEqual(R.semaforo(3).color, '#e0b324'); assert.strictEqual(R.semaforo(40).color, '#c0392b');
});
test('colección: ignora bajas y categorías vacías; calor y CSV', () => {
  const c = R.coleccionPorCategoria({ libros, cats }); assert.deepStrictEqual(c.filas.map(f => [f.cat, f.ejemplares]), [['Cuentos', 3], ['Ciencia', 1]]);
  assert.strictEqual(R.calor(0, 5, '#f00'), 'transparent'); assert.ok(R.calor(5, 5, '#f00').includes('100%'));
  assert.strictEqual(R.csv([['a"b', 1]]), '"a""b";"1"');
});
test('resumen de un aula: participación, categorías, top y sin lectura', () => {
  const lect2 = [{ id:'l1', nombre:'ANA', aula:'A' }, { id:'l2', nombre:'BETO', aula:'A' }, { id:'l3', nombre:'CARLA', aula:'A' }, { id:'l4', nombre:'OTRA AULA', aula:'B' }, { id:'l5', nombre:'EGRESADO', aula:'A', baja:'2026-01-01' }];
  const pr = [{ libroId:'a', lectorId:'l1', fecha:'2026-10-01', vence:'2026-10-08' }, { libroId:'a', lectorId:'l1', fecha:'2026-10-03', vence:'2026-10-20', devuelto:'2026-10-05' },
    { libroId:'b', lectorId:'l2', fecha:'2026-10-04', vence:'2026-10-30' }, { libroId:'a', lectorId:'l4', fecha:'2026-10-04', vence:'2026-10-30' }, { libroId:'a', lectorId:'l3', fecha:'2026-01-01', vence:'2026-01-08', devuelto:'2026-01-02' }];
  const r = R.resumenAula({ libros, cats, prest:pr, lect:lect2, hoy:'2026-10-16', desde:'2026-09-01', aulaLector:x => x.aula }, 'A');
  assert.strictEqual(r.lectores, 3); assert.strictEqual(r.prestamos, 3); assert.strictEqual(r.vencidos, 1); assert.strictEqual(r.lectoresActivos, 2); assert.strictEqual(r.participacion, 67);
  assert.deepStrictEqual(r.topLectores.map(t => [t.nombre, t.n]), [['ANA', 2], ['BETO', 1]]); assert.deepStrictEqual(r.categorias.map(k => [k.cat, k.n]), [['Cuentos', 2], ['Ciencia', 1]]);
  assert.deepStrictEqual(r.sinLectura, ['CARLA']);
});
