const test = require('node:test');
const assert = require('node:assert');
const O = require('../opac-util.js');
const d = { cfg:{ nombreIE:'IE Prueba' }, cats:[{ id:'c1', nombre:'Cuentos', color:'#C77D2E' }, { id:'c2', nombre:'Ciencia', color:'#3E6B4F' }],
  libros:[{ id:'a', cod:'CUE-001', titulo:'Cuentos andinos', autor:'Ana Rojas', catId:'c1', cant:2, ubi:3 }, { id:'b', cod:'CIE-001', titulo:'Átomos', catId:'c2', cant:1 }, { id:'x', titulo:'Dado de baja', catId:'c2', baja:'2026-01-01' }],
  prest:[{ libroId:'b', lector:'JUAN PEREZ', lectorId:'l1', vence:'2026-10-20' }, { libroId:'a', devuelto:'2026-10-01', vence:'2026-09-30' }] };
test('OPAC: disponibilidad, devolución y sin datos de lectores', () => {
  const r = O.construir(d); assert.strictEqual(r.libros.length, 2);
  assert.strictEqual(r.libros[0].disp, 2); assert.strictEqual(r.libros[1].disp, 0); assert.strictEqual(r.libros[1].devolucion, '2026-10-20');
  assert.ok(!/JUAN|l1|lector/i.test(JSON.stringify(r)));
});
test('OPAC: filtros por texto sin tildes, categoría y disponibles', () => {
  const L = O.construir(d).libros;
  assert.strictEqual(O.filtrar(L, { q:'atomos' }).length, 1); assert.strictEqual(O.filtrar(L, { cat:'c1' }).length, 1);
  assert.strictEqual(O.filtrar(L, { soloDisp:true }).length, 1);
});
test('OPAC: fecha de ingreso desde el id, ISBN válido, más leídos y últimos agregados', () => {
  const id = n => 'lib_' + new Date('2026-' + n + 'T12:00:00Z').getTime().toString(36) + 'abcde';
  const r = O.construir({ cats:[{ id:'c', nombre:'X' }], libros:[{ id:id('03-01'), titulo:'Viejo', catId:'c', isbn:'978-612-4' }, { id:id('10-01'), titulo:'Nuevo', catId:'c', isbn:'978-0-14-312779-6' }, { id:'otro', titulo:'SinFecha', catId:'c' }],
    prest:[{ libroId:id('03-01') }, { libroId:id('03-01') }, { libroId:id('10-01') }] });
  assert.strictEqual(r.libros[0].ingreso, '2026-03-01'); assert.strictEqual(r.libros[2].ingreso, '');
  assert.strictEqual(r.libros[0].isbn, ''); assert.strictEqual(r.libros[1].isbn, '9780143127796');
  assert.deepStrictEqual(O.novedades(r.libros).map(l => l.titulo), ['Nuevo', 'Viejo']);
  assert.deepStrictEqual(O.masLeidos(r.libros).map(l => [l.titulo, l.veces]), [['Viejo', 2], ['Nuevo', 1]]);
});
const reservaD = (extra) => ({ bcfg:{ opacReservas:true }, libros:[{ id:'b', cod:'CIE-001', titulo:'Átomos', cant:1 }, { id:'a', cod:'CUE-001', titulo:'Cuentos', cant:2 }],
  lect:[{ id:'l1', cod:'LEC-0001', nombre:'PEREZ, JUAN', dni:'12345678', grado:'Primaria · 3° A' }, { id:'l2', cod:'LEC-0002', nombre:'SIN DNI', dni:'' }, { id:'l3', cod:'LEC-0003', nombre:'BAJA', dni:'11112222', baja:'2026-01-01' }, { id:'l4', cod:'LEC-0004', nombre:'OTRO', dni:'99995678' }],
  prest:[{ libroId:'b', lectorId:'l4' }], res:[], ...extra });
const pr = (d, p) => O.reservar(d, p, '2026-10-16', x => x + '_1');
test('Reserva OPAC: ok con código + 4 últimos del DNI; queda en espera y sin datos personales en la respuesta', () => {
  const r = pr(reservaD(), { libroId:'b', cod:' lec-0001 ', clave:'5678' });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.puesto, 1);
  assert.deepStrictEqual([r.reserva.estado, r.reserva.origen, r.reserva.lectorId], ['Espera', 'OPAC', 'l1']);
  const d2 = reservaD({ res:[r.reserva] }); d2.lect.push({ id:'l5', cod:'LEC-0005', nombre:'Z', dni:'55556789' });
  assert.strictEqual(pr(d2, { libroId:'b', cod:'LEC-0005', clave:'6789' }).puesto, 2);
});
test('Reserva OPAC: credenciales malas dan el mismo mensaje (código inexistente, clave mala, sin DNI, de baja)', () => {
  const m = new Set([pr(reservaD(), { libroId:'b', cod:'LEC-9999', clave:'5678' }), pr(reservaD(), { libroId:'b', cod:'LEC-0001', clave:'0000' }), pr(reservaD(), { libroId:'b', cod:'LEC-0002', clave:'' }), pr(reservaD(), { libroId:'b', cod:'LEC-0003', clave:'2222' })].map(r => r.codigo + r.error));
  assert.strictEqual(m.size, 1); assert.ok([...m][0].startsWith('CREDENCIALES'));
});
test('Reserva OPAC: apagada, libro libre, repetida, ya en mano y máximo por lector', () => {
  assert.strictEqual(pr(reservaD({ bcfg:{} }), { libroId:'b', cod:'LEC-0001', clave:'5678' }).codigo, 'APAGADO');
  assert.strictEqual(pr(reservaD(), { libroId:'a', cod:'LEC-0001', clave:'5678' }).codigo, 'LIBRE');
  assert.strictEqual(pr(reservaD({ res:[{ libroId:'b', lectorId:'l1', estado:'Espera' }] }), { libroId:'b', cod:'LEC-0001', clave:'5678' }).codigo, 'DUPLICADA');
  assert.strictEqual(pr(reservaD(), { libroId:'b', cod:'LEC-0004', clave:'5678' }).codigo, 'EN_MANO');
  const d = reservaD({ res:[{ libroId:'x', lectorId:'l1', estado:'Espera' }, { libroId:'y', lectorId:'l1', estado:'Disponible' }] });
  assert.strictEqual(pr(d, { libroId:'b', cod:'LEC-0001', clave:'5678' }).codigo, 'MAXIMO');
  assert.strictEqual(pr(reservaD({ res:[{ libroId:'b', lectorId:'l9', estado:'Cancelada' }] }), { libroId:'b', cod:'LEC-0001', clave:'5678' }).ok, true);
});
test('Limitador: bloquea el código tras 5 fallos y la IP tras 12; se libera con el tiempo', () => {
  let t = 0; const lim = O.crearLimitador({}, () => t);
  for(let i = 0; i < 4; i++) lim.fallo('ip1', 'LEC-0001'); assert.strictEqual(lim.segundos('ip1', 'LEC-0001'), 0);
  lim.fallo('ip1', 'LEC-0001'); assert.ok(lim.segundos('ip2', 'LEC-0001') > 0); assert.strictEqual(lim.segundos('ip2', 'LEC-0002'), 0);
  for(let i = 0; i < 12; i++) lim.fallo('ip3', 'LEC-' + i); assert.ok(lim.segundos('ip3', 'LEC-X') > 0);
  t += 15 * 60 * 1000 + 1; assert.strictEqual(lim.segundos('ip1', 'LEC-0001'), 0); assert.strictEqual(lim.segundos('ip3', 'LEC-X'), 0);
});
test('OPAC: informa si las reservas están activas y cuántos esperan, sin nombres', () => {
  const r = O.construir({ ...reservaD({ res:[{ libroId:'b', lectorId:'l1', lector:'PEREZ, JUAN', estado:'Espera' }, { libroId:'b', estado:'Cancelada' }] }), cats:[] });
  assert.strictEqual(r.reservas, true); assert.strictEqual(r.libros.find(l => l.id==='b').espera, 1); assert.ok(!/PEREZ|l1|12345678/.test(JSON.stringify(r)));
});
