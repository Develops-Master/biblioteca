const test = require('node:test');
const assert = require('node:assert');
const M = require('../mostrador-util.js');
const hoy = '2026-10-16';
const lectores = [{ id:'l1', cod:'LEC-0001', nombre:'PEREZ, JUAN', tipo:'Alumno', dni:'12345678' }, { id:'l2', cod:'LEC-0002', nombre:'RAMOS, ANA', tipo:'Alumno', dni:'20260101234567' }, { id:'l3', cod:'LEC-0003', nombre:'BAJA', tipo:'Alumno', baja:'2026-01-01' }];
const libros = [{ id:'a', cod:'CUE-001', titulo:'Cuentos andinos', isbn:'978-612-4300-12-3' }, { id:'b', cod:'CIE-001', titulo:'Átomos' }];
test('resolver: carné, libro por código, por ISBN, lector por DNI o por el código largo; el resto no se reconoce', () => {
  const r = x => M.resolver(x, { lectores, libros });
  assert.strictEqual(r(' lec-0001 ').lector.id, 'l1'); assert.strictEqual(r('LEC-9999').tipo, 'lector-no');
  assert.strictEqual(r('cue-001').libro.id, 'a'); assert.strictEqual(r('9786124300123').libro.id, 'a');
  assert.deepStrictEqual([r('12345678').tipo, r('12345678').porDni, r('20260101234567').lector.id], ['lector', true, 'l2']);
  assert.strictEqual(r('PEREZ').tipo, 'nada'); assert.strictEqual(r('').tipo, 'nada'); assert.strictEqual(r('99999999').tipo, 'nada');
});
const base = (extra) => ({ prestamos:[{ id:'p1', libroId:'a', lectorId:'l1', vence:'2026-10-10' }, { id:'p2', libroId:'b', lectorId:'l1', vence:'2026-10-17' }, { id:'p3', libroId:'b', lectorId:'l2', vence:'2026-10-30', devuelto:'2026-10-01' }],
  reservas:[{ lectorId:'l1', libroId:'b', estado:'Disponible', hasta:'2026-10-20' }, { lectorId:'l1', libroId:'a', estado:'Disponible', hasta:'2026-10-01' }], libros, sanciones:[], cfg:{ Alumno:{ max:3, dias:7 }, bloquear:false }, hoy, ...extra });
test('ficha: lo que tiene en mano con atraso, avisos y reservas lista (solo las vigentes)', () => {
  const f = M.ficha(lectores[0], base());
  assert.deepStrictEqual(f.enMano.map(x => [x.cod, x.estado, x.dias]), [['CUE-001', 'Vencido', 6], ['CIE-001', 'Por vencer', 1]]);
  assert.strictEqual(f.quedan, 1); assert.strictEqual(f.puede, true); assert.deepStrictEqual(f.listas, ['Átomos']);
  assert.ok(f.avisos.some(a => a.nivel==='mal' && /1 libro\(s\) vencido/.test(a.t)) && f.avisos.some(a => a.nivel==='info' && /Átomos/.test(a.t)));
});
test('ficha: bloquea por vencidos (si la regla lo pide), por máximo, por sanción y por baja', () => {
  assert.strictEqual(M.ficha(lectores[0], base({ cfg:{ Alumno:{ max:3 }, bloquear:true } })).puede, false);
  assert.strictEqual(M.ficha(lectores[0], base({ cfg:{ Alumno:{ max:2 } } })).puede, false);
  const s = M.ficha(lectores[1], base({ sanciones:[{ lectorId:'l2', hasta:'2026-10-25' }, { lectorId:'l2', hasta:'2026-10-30', levantada:true }] }));
  assert.strictEqual(s.puede, false); assert.strictEqual(s.sancionHasta, '2026-10-25'); assert.ok(/25\/10\/2026/.test(s.avisos[0].t));
  assert.strictEqual(M.ficha(lectores[2], base()).puede, false);
  assert.strictEqual(M.ficha(lectores[1], base()).puede, true);
});
test('deshacer: se detectan los cambios y solo se revierte si nada más cambió después', () => {
  const p0 = [{ id:'p1', libroId:'a' }], r0 = [{ id:'r1', estado:'Disponible' }];
  const antes = M.foto(p0, r0), despues = M.foto([...p0, { id:'p2', libroId:'b' }], [{ id:'r1', estado:'Atendida' }]);
  assert.strictEqual(M.hayCambio(antes, despues), true); assert.strictEqual(M.hayCambio(antes, M.foto(p0, r0)), false);
  assert.deepStrictEqual(M.cambios(antes, despues).prestados.map(p => p.id), ['p2']);
  assert.deepStrictEqual(M.cambios(despues, M.foto([p0[0], { id:'p2', libroId:'b', devuelto:'2026-10-16' }], [])).devueltos.map(p => p.id), ['p2']);
  const accion = { antes, despues };
  assert.strictEqual(M.puedeDeshacer(accion, despues), true);
  assert.strictEqual(M.puedeDeshacer(accion, M.foto([...p0, { id:'p2', libroId:'b' }, { id:'p9' }], [{ id:'r1', estado:'Atendida' }])), false);
  assert.strictEqual(M.puedeDeshacer(null, despues), false);
});
