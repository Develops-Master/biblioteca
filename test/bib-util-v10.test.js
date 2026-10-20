// Lógica pura de la v10: lecturas asignadas por aula, comprensión AD/A/B/C, meta mensual y sanción proporcional.
const test = require('node:test');
const assert = require('node:assert');
const B = require('../bib-util.js');

/* ---------- lecturas asignadas ---------- */
const alumnos = ['ZOE', 'ANA', 'BETO', 'CARLA', 'DANI'].map((n, i) => ({ id: 'l' + (i + 1), nombre: n }));   // ANA=l2, BETO=l3, CARLA=l4, DANI=l5, ZOE=l1
const lectura = { id: 'lc1', fecha: '2026-10-01', limite: '2026-10-15' };
const ids = new Set(['b1', 'b2']);   // dos ejemplares del mismo título

test('lectura asignada: recibieron, devolvieron y atrasados (pasada la fecha límite)', () => {
  const pres = [
    { id: 'p1', libroId: 'b1', lectorId: 'l2', fecha: '2026-10-01', devuelto: '2026-10-10', lecturaId: 'lc1' },   // ANA devolvió a tiempo
    { id: 'p2', libroId: 'b2', lectorId: 'l3', fecha: '2026-10-01', devuelto: '', lecturaId: 'lc1' },             // BETO sigue con el libro y ya venció el plazo
    { id: 'p3', libroId: 'b1', lectorId: 'l4', fecha: '2026-10-03', devuelto: '2026-10-17' },                    // CARLA lo sacó por su cuenta y lo devolvió tarde
    { id: 'p4', libroId: 'b9', lectorId: 'l5', fecha: '2026-10-02', devuelto: '' }                              // DANI llevó OTRO libro: no cuenta
  ];
  const r = B.avanceLectura({ lectura, alumnos, prestamos: pres, libroIds: ids, hoy: '2026-10-20', comprension: [{ prestId: 'p1', nivel: 'a' }] });
  assert.strictEqual(r.total, 5);
  assert.strictEqual(r.recibieron, 3, 'ANA, BETO y CARLA');
  assert.strictEqual(r.devolvieron, 2, 'ANA y CARLA');
  assert.strictEqual(r.devueltosTarde, 1, 'CARLA devolvió después del límite');
  assert.strictEqual(r.sinRecibir, 2, 'ZOE y DANI');
  assert.strictEqual(r.atrasados, 3, 'BETO (lo tiene) + ZOE y DANI (nunca lo recibieron) con el plazo vencido');
  assert.strictEqual(r.pct, 40);
  assert.strictEqual(r.vencida, true);
  assert.strictEqual(r.completa, false);
  assert.deepStrictEqual(r.filas.map(f => f.lector.nombre), ['ANA', 'BETO', 'CARLA', 'DANI', 'ZOE'], 'orden alfabético');
  assert.strictEqual(r.filas[0].nivel, 'A', 'el nivel de comprensión se muestra en mayúscula');
  assert.strictEqual(r.filas[3].estado, 'sin-recibir');
});

test('lectura asignada: antes del límite nadie está atrasado; sin límite nunca; un préstamo anterior a la asignación no cuenta', () => {
  const pres = [{ id: 'p1', libroId: 'b1', lectorId: 'l2', fecha: '2026-10-05', devuelto: '' }, { id: 'p0', libroId: 'b1', lectorId: 'l3', fecha: '2026-09-20', devuelto: '2026-09-28' }];
  const r = B.avanceLectura({ lectura, alumnos, prestamos: pres, libroIds: ids, hoy: '2026-10-12' });
  assert.strictEqual(r.atrasados, 0);
  assert.strictEqual(r.leyendo, 1);
  assert.strictEqual(r.recibieron, 1, 'BETO leyó el libro en septiembre, antes de que se asignara: no cuenta');
  assert.strictEqual(B.avanceLectura({ lectura: { ...lectura, limite: '' }, alumnos, prestamos: pres, libroIds: ids, hoy: '2030-01-01' }).atrasados, 0);
});

test('lectura asignada: completa cuando todos devolvieron; un libro perdido no cuenta como devuelto ni como atraso', () => {
  const todos = alumnos.map((a, i) => ({ id: 'q' + i, libroId: 'b1', lectorId: a.id, fecha: '2026-10-02', devuelto: '2026-10-09', lecturaId: 'lc1' }));
  const r = B.avanceLectura({ lectura, alumnos, prestamos: todos, libroIds: ids, hoy: '2026-10-30' });
  assert.strictEqual(r.completa, true); assert.strictEqual(r.atrasados, 0); assert.strictEqual(r.pct, 100);
  todos[0] = { ...todos[0], devuelto: '', perdido: true };
  const r2 = B.avanceLectura({ lectura, alumnos, prestamos: todos, libroIds: ids, hoy: '2026-10-30' });
  assert.strictEqual(r2.perdidos, 1); assert.strictEqual(r2.devolvieron, 4); assert.strictEqual(r2.atrasados, 0); assert.strictEqual(r2.completa, false);
  assert.strictEqual(B.avanceLectura({ lectura, alumnos: [], prestamos: [], libroIds: ids, hoy: '2026-10-30' }).completa, false, 'aula vacía no está "completa"');
});

test('lectura asignada: si hay varios préstamos del alumno gana el hecho para la lectura', () => {
  const pres = [
    { id: 'a', libroId: 'b1', lectorId: 'l2', fecha: '2026-10-04', devuelto: '2026-10-05' },
    { id: 'b', libroId: 'b2', lectorId: 'l2', fecha: '2026-10-02', devuelto: '', lecturaId: 'lc1' }
  ];
  const f = B.avanceLectura({ lectura, alumnos, prestamos: pres, libroIds: ids, hoy: '2026-10-10' }).filas.find(x => x.lector.id === 'l2');
  assert.strictEqual(f.prestamo.id, 'b'); assert.strictEqual(f.estado, 'leyendo');
});

/* ---------- comprensión ---------- */
test('niveles de logro: solo AD, A, B y C; minúsculas y espacios se aceptan', () => {
  assert.deepStrictEqual(B.NIVELES_LOGRO.map(n => n.cod), ['AD', 'A', 'B', 'C']);
  assert.strictEqual(B.nivelLogroValido(' ad '), 'AD');
  assert.strictEqual(B.nivelLogroValido('b'), 'B');
  for (const x of ['D', 'AA', '', null, undefined, 3]) assert.strictEqual(B.nivelLogroValido(x), '', String(x));
});

test('comprensión: resumen por aula y por grado con % de logro esperado o destacado', () => {
  const reg = [
    { nivel: 'AD', grado: '3° A PRIMARIA', fecha: '2026-05-01' }, { nivel: 'A', grado: '3A primaria', fecha: '2026-05-02' },
    { nivel: 'B', grado: '3° A PRIMARIA', fecha: '2026-05-03' }, { nivel: 'C', grado: '3° B PRIMARIA', fecha: '2026-05-04' },
    { nivel: 'A', grado: '3° B PRIMARIA', fecha: '2026-05-04' }, { nivel: 'A', grado: '1° SEC A', fecha: '2026-05-04' },
    { nivel: 'X', grado: '3° A PRIMARIA', fecha: '2026-05-04' },       // inválido: se ignora
    { nivel: 'AD', grado: '3° A PRIMARIA', fecha: '2025-12-30' }       // de otro año
  ];
  const sec = B.resumenComprension(reg, { desde: '2026-01-01' });
  assert.deepStrictEqual(sec.filas.map(f => [f.grupo, f.AD, f.A, f.B, f.C, f.total, f.logro]),
    [['3° A PRIMARIA', 1, 1, 1, 0, 3, 67], ['3° B PRIMARIA', 0, 1, 0, 1, 2, 50], ['1° A SECUNDARIA', 0, 1, 0, 0, 1, 100]]);
  assert.deepStrictEqual([sec.totales.total, sec.totales.AD, sec.totales.logro], [6, 1, 67]);
  const gr = B.resumenComprension(reg, { desde: '2026-01-01', cuanto: 'grado' });
  assert.deepStrictEqual(gr.filas.map(f => [f.grupo, f.total]), [['3° PRIMARIA', 5], ['1° SECUNDARIA', 1]], 'las secciones se juntan en el grado');
  assert.strictEqual(B.resumenComprension(reg, { desde: '2026-01-01', cuanto: 'nivel' }).filas.length, 2);
  assert.strictEqual(B.resumenComprension([], {}).totales.logro, 0, 'sin datos no divide entre cero');
  assert.strictEqual(B.resumenComprension(reg, {}).totales.total, 7, 'sin periodo cuenta todo lo válido');
});

test('comprensión: devoluciones sin evaluar (sin perdidos ni las ya evaluadas)', () => {
  const pres = [{ id: 'a', devuelto: '2026-10-10' }, { id: 'b', devuelto: '2026-10-11' }, { id: 'c', devuelto: '2026-08-01' }, { id: 'd', devuelto: '' }, { id: 'e', devuelto: '2026-10-12', perdido: true }];
  assert.deepStrictEqual(B.devolucionesSinComprension(pres, [{ prestId: 'a' }], '2026-09-01').map(p => p.id), ['b']);
  assert.deepStrictEqual(B.devolucionesSinComprension(pres, [], '').map(p => p.id), ['b', 'a', 'c']);
});

/* ---------- meta mensual ---------- */
test('meta mensual: libros devueltos en el mes contra la meta de cada aula', () => {
  const al = [{ id: '1', grado: '3° A PRIMARIA' }, { id: '2', grado: '3A primaria' }, { id: '3', grado: '3° B PRIMARIA' }, { id: '4', grado: '3° B PRIMARIA', baja: true }];
  const pres = [
    { grado: '3° A PRIMARIA', fecha: '2026-10-01', devuelto: '2026-10-08' }, { grado: '3° A PRIMARIA', fecha: '2026-09-20', devuelto: '2026-10-02' },
    { grado: '3° A PRIMARIA', fecha: '2026-09-20', devuelto: '2026-09-30' },                                  // devuelto el mes pasado: no cuenta
    { grado: '3° A PRIMARIA', fecha: '2026-10-05', devuelto: '' },                                           // en curso
    { grado: '3° A PRIMARIA', fecha: '2026-10-05', devuelto: '2026-10-06', perdido: true },                  // perdido: no es "leído"
    { grado: '3° B PRIMARIA', fecha: '2026-10-02', devuelto: '2026-10-09' }
  ];
  const r = B.metaMensual({ prestamos: pres, alumnos: al, metas: [{ aula: '3° A PRIMARIA', libros: 2 }, { aula: '3° B PRIMARIA', libros: 5 }, { aula: '5° A PRIMARIA', libros: 4 }], mes: '2026-10' });
  const a = r.filas.find(f => f.aula === '3° A PRIMARIA'), b = r.filas.find(f => f.aula === '3° B PRIMARIA');
  assert.deepStrictEqual([a.alumnos, a.meta, a.leidos, a.enCurso, a.pct, a.cumplida], [2, 2, 2, 1, 100, true]);
  assert.deepStrictEqual([b.alumnos, b.meta, b.leidos, b.pct, b.cumplida], [1, 5, 1, 20, false], 'el alumno dado de baja no cuenta');
  assert.ok(r.filas.some(f => f.aula === '5° A PRIMARIA' && f.meta === 4 && f.leidos === 0), 'un aula con meta pero sin movimiento también aparece');
  assert.deepStrictEqual([r.totales.meta, r.totales.leidos, r.totales.cumplidas, r.totales.conMeta], [11, 3, 1, 3]);
  const sinMeta = B.metaMensual({ prestamos: pres, alumnos: al, metas: [], mes: '2026-10' }).filas[0];
  assert.strictEqual(sinMeta.pct, null, 'sin meta no hay porcentaje'); assert.strictEqual(sinMeta.cumplida, false);
});

/* ---------- sanción proporcional ---------- */
test('sanción: días proporcionales al atraso, con tope; apagada o a tiempo no sanciona', () => {
  const p = { vence: '2026-10-10' }, cfg = { activa: true, factor: 1, maxDias: 30 };
  assert.deepStrictEqual(B.calcularSancion(p, '2026-10-15', cfg), { atraso: 5, dias: 5, hasta: '2026-10-20' });
  assert.deepStrictEqual(B.calcularSancion(p, '2026-10-15', { ...cfg, factor: 2 }), { atraso: 5, dias: 10, hasta: '2026-10-25' });
  assert.strictEqual(B.calcularSancion(p, '2026-10-12', { ...cfg, factor: 0.5 }).dias, 1, '2 días × 0,5 = 1');
  assert.strictEqual(B.calcularSancion(p, '2026-10-13', { ...cfg, factor: 0.5 }).dias, 2, '3 días × 0,5 = 1,5 → se redondea hacia arriba');
  assert.strictEqual(B.calcularSancion({ vence: '2026-01-01' }, '2026-10-15', { ...cfg, maxDias: 20 }).dias, 20, 'tope máximo');
  assert.strictEqual(B.calcularSancion(p, '2026-10-15', { ...cfg, activa: false }), null, 'apagada por defecto');
  assert.strictEqual(B.calcularSancion(p, '2026-10-15', undefined), null);
  assert.strictEqual(B.calcularSancion(p, '2026-10-10', cfg), null, 'devuelto el último día: a tiempo');
  assert.strictEqual(B.calcularSancion(p, '2026-10-09', cfg), null);
  assert.strictEqual(B.calcularSancion({ vence: '2026-10-01', perdido: true }, '2026-10-15', cfg), null, 'lo perdido va por Bajas, no por sanción');
  assert.strictEqual(B.calcularSancion({ vence: '' }, '2026-10-15', cfg), null);
  assert.strictEqual(B.calcularSancion(p, '2026-10-15', { activa: true }).dias, 5, 'sin factor ni tope usa 1 día por día y 30 de tope');
  assert.strictEqual(B.calcularSancion({ vence: '2026-12-28' }, '2027-01-03', cfg).hasta, '2027-01-09', 'cruza de año');
});

test('sanción vigente: por lector, hasta la fecha, y las levantadas no cuentan', () => {
  const s = [
    { id: '1', lectorId: 'l1', hasta: '2026-10-20' }, { id: '2', lectorId: 'l1', hasta: '2026-10-25' },
    { id: '3', lectorId: 'l2', hasta: '2026-10-30', levantada: true }, { id: '4', lectorId: '', lector: 'PEDRO', hasta: '2026-10-18' }
  ];
  assert.strictEqual(B.sancionVigente(s, { id: 'l1', nombre: 'ANA' }, '2026-10-15').id, '2', 'la que termina más tarde');
  assert.strictEqual(B.sancionVigente(s, { id: 'l1' }, '2026-10-25'), null, 'el día de `hasta` ya puede llevar libros');
  assert.strictEqual(B.sancionVigente(s, { id: 'l2' }, '2026-10-15'), null, 'levantada');
  assert.strictEqual(B.sancionVigente(s, { nombre: 'PEDRO' }, '2026-10-15').id, '4', 'lector sin ficha: por nombre');
  assert.strictEqual(B.sancionVigente(s, { id: 'l9', nombre: 'PEDRO' }, '2026-10-15'), null, 'con ficha se busca por id, no por nombre');
  assert.strictEqual(B.sancionVigente([], { id: 'l1' }, '2026-10-15'), null);
});

test('docentes y personal no entran en la comprensión ni en la meta de las aulas', () => {
  const doc = 'DOCENTE — PRIMARIA';
  assert.deepStrictEqual(B.resumenComprension([{ nivel: 'A', grado: doc, fecha: '2026-05-01' }, { nivel: 'A', grado: '3° A PRIMARIA', fecha: '2026-05-01' }], {}).filas.map(f => f.grupo), ['3° A PRIMARIA']);
  assert.deepStrictEqual(B.devolucionesSinComprension([{ id: 'a', devuelto: '2026-10-10', grado: doc }, { id: 'b', devuelto: '2026-10-10', grado: '3° A PRIMARIA' }, { id: 'c', devuelto: '2026-10-10', grado: '' }], [], '').map(p => p.id), ['b', 'c'],
    'un préstamo manual sin grado sí se puede evaluar');
  const r = B.metaMensual({ prestamos: [{ grado: doc, fecha: '2026-10-01', devuelto: '2026-10-05' }], alumnos: [], metas: [], mes: '2026-10' });
  assert.strictEqual(r.filas.length, 0, 'el préstamo de un docente no crea un aula');
});
