const test = require('node:test');
const assert = require('node:assert');
const R = require('../reservas-util.js');
const B = require('../bib-util.js');
const hoy = '2026-10-16';
const libros = [{ id:'a', cod:'CUE-001', titulo:'Cuentos andinos', cant:1 }, { id:'b', cod:'CIE-001', titulo:'Átomos', cant:2 }];
const rs = () => [
  { id:'r1', libroId:'a', lectorId:'l1', lector:'PEREZ, JUAN', grado:'Primaria · 3° A', fecha:'2026-10-01', estado:'Disponible', hasta:'2026-10-20' },
  { id:'r2', libroId:'a', lectorId:'l2', lector:'RAMOS, ANA', fecha:'2026-10-02', estado:'Espera' },
  { id:'r3', libroId:'b', lectorId:'l3', lector:'DIAZ, LUIS', fecha:'2026-10-03', estado:'Atendida', hasta:'2026-10-10', avisado:'2026-10-04' },
  { id:'r4', libroId:'b', lectorId:'l2', lector:'RAMOS, ANA', fecha:'2026-10-05', estado:'Espera' },
  { id:'r5', libroId:'a', lectorId:'l4', lector:'LUNA, EVA', fecha:'2026-10-06', estado:'Espera' },
  { id:'r6', libroId:'a', lectorId:'l5', lector:'OLD', fecha:'2026-09-01', estado:'Cancelada' }];
test('resumen y puesto: listos, por avisar, vencidas y fila', () => {
  assert.deepStrictEqual(R.resumen(rs(), hoy), { listos:1, porAvisar:1, espera:3 });
  assert.strictEqual(R.puesto(rs(), rs()[1]), 1); assert.strictEqual(R.puesto(rs(), rs()[4]), 2); assert.strictEqual(R.puesto(rs(), rs()[0]), 0);
});
test('orden: primero las que ya se pueden recoger (vence antes, arriba), luego la fila; sin historial', () => {
  assert.deepStrictEqual(R.ordenar(rs(), hoy).map(r => r.id), ['r1', 'r2', 'r5', 'r4']);
});
test('avisos: solo las listas vigentes, con enlace de WhatsApp, familia para alumnos y sin enlace si falta celular', () => {
  const lectores = [{ id:'l1', tipo:'Alumno', tel:'987654321' }, { id:'l3', tipo:'Docente', tel:'12345' }];
  const a = R.avisos({ reservas:rs(), libros, lectores, nombreIE:'IE Prueba', hoy, normalizar:B.normalizarTelefono });
  assert.strictEqual(a.length, 1); assert.strictEqual(a[0].id, 'r1');
  assert.ok(a[0].url.startsWith('https://wa.me/51987654321?text=')); assert.ok(/familia de PEREZ, JUAN/.test(a[0].mensaje) && /20\/10\/2026/.test(a[0].mensaje) && /IE Prueba/.test(a[0].mensaje));
  const b = R.avisos({ reservas:[{ ...rs()[2], estado:'Disponible', hasta:'2026-10-30' }], libros, lectores, hoy, normalizar:B.normalizarTelefono })[0];
  assert.strictEqual(b.url, ''); assert.ok(b.problema); assert.ok(/^Hola DIAZ, LUIS, el libro/.test(b.mensaje)); assert.strictEqual(b.avisado, '2026-10-04');
});
