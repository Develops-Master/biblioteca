const test = require('node:test');
const assert = require('node:assert');
const P = require('../prestamos-util.js');
const B = require('../bib-util.js');
const hoy = '2026-10-16';
const ps = () => [
  { id:'p1', libroId:'a', lectorId:'l1', lector:'PEREZ, JUAN', fecha:'2026-10-01', vence:'2026-10-08' },                    // 8 días de atraso
  { id:'p2', libroId:'a', lectorId:'l2', lector:'RAMOS, ANA', fecha:'2026-10-10', vence:'2026-10-16' },                     // vence hoy
  { id:'p3', libroId:'b', lectorId:'l3', lector:'DIAZ, LUIS', fecha:'2026-10-12', vence:'2026-10-19' },                     // en 3 días
  { id:'p4', libroId:'b', lectorId:'l4', lector:'LUNA, EVA', fecha:'2026-10-14', vence:'2026-10-18' },                      // en 2 días
  { id:'p5', libroId:'a', lectorId:'l5', lector:'SOTO, IVO', fecha:'2026-09-01', vence:'2026-09-08' },                      // 38 días de atraso
  { id:'p6', libroId:'b', lectorId:'l6', lector:'VEGA, UMA', fecha:'2026-10-01', vence:'2026-10-08', devuelto:'2026-10-16' },
  { id:'p7', libroId:'b', lectorId:'l7', lector:'CRUZ, OMAR', fecha:'2026-10-01', vence:'2026-10-08', devuelto:'2026-10-09', perdido:true },
  { id:'p8', libroId:'a', lectorId:'l8', lector:'ROJAS, EVA', fecha:'2026-10-01', vence:'2026-10-08', devuelto:'2026-10-05' }];
test('situación: vencido con días de atraso, por vencer (hoy, mañana, 2 días), prestado, devuelto y perdido', () => {
  const s = Object.fromEntries(ps().map(p => [p.id, P.situacion(p, hoy)]));
  assert.deepStrictEqual([s.p1.estado, s.p1.dias], ['Vencido', 8]); assert.deepStrictEqual([s.p2.estado, s.p2.dias], ['Por vencer', 0]);
  assert.strictEqual(s.p3.estado, 'Prestado'); assert.deepStrictEqual([s.p4.estado, s.p4.dias], ['Por vencer', 2]);
  assert.strictEqual(s.p6.estado, 'Devuelto'); assert.strictEqual(s.p7.estado, 'Perdido'); // perdido tiene fecha de «devuelto» pero no es devolución
  assert.deepStrictEqual([P.textoVence(s.p1), P.textoVence(s.p2), P.textoVence(s.p4), P.textoVence(s.p3)], ['hace 8 días', 'vence hoy', 'en 2 días', 'en 3 días']);
});
test('resumen y filtros: «Prestado» sigue incluyendo lo por vencer; «Por vencer» es un subconjunto', () => {
  assert.deepStrictEqual(P.resumen(ps(), hoy), { activos:5, porVencer:2, vencidos:2, devueltosHoy:1 });
  const n = f => ps().filter(p => P.coincide(P.situacion(p, hoy), f)).length;
  assert.deepStrictEqual([n(''), n('Prestado'), n('Por vencer'), n('Vencido'), n('Devuelto'), n('Perdido')], [8, 3, 2, 2, 2, 1]);
});
test('orden: el más atrasado primero, luego lo que vence antes, y al final lo cerrado (lo más reciente arriba)', () => {
  assert.deepStrictEqual(P.ordenar(ps(), hoy).map(x => x.p.id), ['p5', 'p1', 'p2', 'p4', 'p3', 'p6', 'p7', 'p8']);
});
test('recordatorio: usa el celular de la ficha, habla a la familia del alumno, menciona el atraso; sin celular no hay enlace', () => {
  const libro = { cod:'CUE-001', titulo:'Cuentos andinos' };
  const r = P.recordatorio(ps()[0], libro, { tipo:'Alumno', tel:'987654321' }, 'IE Prueba', hoy, B.normalizarTelefono);
  assert.ok(r.url.startsWith('https://wa.me/51987654321?text=')); assert.ok(/familia de PEREZ, JUAN/.test(r.mensaje) && /8 días de atraso/.test(r.mensaje) && /08\/10\/2026/.test(r.mensaje) && /IE Prueba/.test(r.mensaje));
  const d = P.recordatorio(ps()[0], libro, { tipo:'Docente', tel:'123' }, '', hoy, B.normalizarTelefono);
  assert.strictEqual(d.url, ''); assert.ok(d.problema); assert.ok(/^Hola PEREZ, JUAN, desde la biblioteca te recordamos/.test(d.mensaje));
  assert.strictEqual(P.recordatorio(ps()[0], libro, {}, '', hoy, B.normalizarTelefono).problema, '');
});
test('CSV: encabezado, comillas y días de atraso solo en vencidos', () => {
  const filas = P.ordenar(ps().slice(0, 2), hoy), t = P.csv(filas, [{ id:'a', cod:'CUE-001', titulo:'Cuentos, "andinos"' }], hoy).split('\r\n');
  assert.strictEqual(t.length, 3); assert.ok(t[0].startsWith('Código libro,Título,Lector')); assert.ok(t[1].includes('"Cuentos, ""andinos"""') && t[1].includes(',Vencido,8,'));
});
