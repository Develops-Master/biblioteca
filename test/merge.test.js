// Pruebas de la fusión de cambios simultáneos (merge.js).
const test = require('node:test');
const assert = require('node:assert');
const { fusionar } = require('../merge.js');

const P = (id, extra) => ({ id, libroId: 'L' + id, lector: 'A', devuelto: '', ...extra });

test('dos PC prestan a la vez: se conservan los dos préstamos', () => {
  const base = [P('1')];
  const mioA = [...base, P('A')];           // PC A presta
  const servidor = [...base, P('B')];       // PC B ya guardó el suyo
  const r = fusionar(base, mioA, servidor);
  assert.deepStrictEqual(r.map(x => x.id).sort(), ['1', 'A', 'B']);
});

test('uno devuelve un libro y otro presta otro: se conservan ambos cambios', () => {
  const base = [P('1'), P('2')];
  const mio = base.map(p => p.id === '1' ? { ...p, devuelto: '2026-10-13' } : p);
  const servidor = [...base, P('3')];
  const r = fusionar(base, mio, servidor);
  assert.strictEqual(r.length, 3);
  assert.strictEqual(r.find(p => p.id === '1').devuelto, '2026-10-13');
  assert.ok(r.find(p => p.id === '3'));
});

test('dos PC editan campos distintos del mismo registro: se combinan', () => {
  const base = [P('1', { vence: '2026-10-20', nota: '' })];
  const mio = [{ ...base[0], vence: '2026-10-27' }];        // renovación
  const servidor = [{ ...base[0], nota: 'avisado' }];       // otra PC anota
  const r = fusionar(base, mio, servidor)[0];
  assert.strictEqual(r.vence, '2026-10-27');
  assert.strictEqual(r.nota, 'avisado');
});

test('mismo campo en conflicto: gana el que guarda (mío)', () => {
  const base = [P('1', { vence: 'x' })];
  const r = fusionar(base, [{ ...base[0], vence: 'mio' }], [{ ...base[0], vence: 'otro' }]);
  assert.strictEqual(r[0].vence, 'mio');
});

test('borrar algo que el otro no tocó lo borra; borrar algo que el otro editó lo conserva', () => {
  const base = [P('1'), P('2')];
  const mio = [P('2')];                                                     // borré el 1
  const servidor = [P('1'), { ...P('2'), nota: 'editado por otro' }];       // otro editó el 2
  const r = fusionar(base, mio, servidor);
  assert.deepStrictEqual(r.map(x => x.id), ['2']);
  assert.strictEqual(r[0].nota, 'editado por otro');
  const r2 = fusionar(base, [P('2')], [{ ...P('1'), nota: 'otro editó el 1' }, P('2')]);
  assert.ok(r2.find(x => x.id === '1'), 'editado por otro: no se pierde');
});

test('contadores: en conflicto se toma el mayor', () => {
  assert.strictEqual(fusionar(10, 12, 11), 12);
  assert.deepStrictEqual(fusionar({ a: 1 }, { a: 3 }, { a: 2 }), { a: 3 });
});

test('objeto de configuración: cambios en claves distintas se combinan', () => {
  const r = fusionar({ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 5 });
  assert.deepStrictEqual(r, { x: 2, y: 5 });
});

test('sin cambios del servidor devuelve lo mío; sin cambios míos devuelve el servidor', () => {
  const base = [P('1')];
  const mio = [P('1'), P('2')];
  assert.deepStrictEqual(fusionar(base, mio, base), mio);
  assert.deepStrictEqual(fusionar(base, base, mio), mio);
});

test('arreglos sin id no se fusionan: gana lo mío', () => {
  assert.deepStrictEqual(fusionar(['a'], ['a', 'b'], ['a', 'c']), ['a', 'b']);
});
