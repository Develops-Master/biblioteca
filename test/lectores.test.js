const test = require('node:test');
const assert = require('node:assert');
const L = require('../lectores-util.js');
const json = { personas:[
  { p:'ALU', d:'91049413', n:'ABAD COSSIO, DIEGO', x:'Primaria · 2° B' },
  { p:'DOC', d:'15377467', n:'Aburto Matos, Florentina', x:'Primaria' },
  { p:'VIG', d:'11111111', n:'Vigilante Uno', x:'Vigilante' },
  { p:'ALU', d:'91049413', n:'REPETIDO', x:'Primaria · 1° A' },
  { p:'ALU', d:'19025196700018', n:'LARGO CODIGO', x:'Secundaria · 3° B' },
  { p:'ALU', d:'22222222', n:'', x:'Primaria · 1° A' } ] };
test('JSON: tipos, mayúsculas, errores y avisos', () => {
  const e = L.desdeJSON(json); assert.strictEqual(e[1].nombre, 'ABURTO MATOS, FLORENTINA');
  assert.deepStrictEqual(e.map(r => r.tipo), ['Alumno','Docente','Otro','Alumno','Alumno','Alumno']);
  const p = L.planificar([], e);
  assert.strictEqual(p.nuevos.length, 4); assert.strictEqual(p.errores.length, 2); assert.strictEqual(p.avisos.length, 1);
});
test('Reimportar no duplica; empareja por nombre si faltaba DNI; actualiza grado', () => {
  const ex = [{ id:'a', cod:'LEC-0007', nombre:'ABAD COSSIO, DIEGO', grado:'2B', tipo:'Alumno' }];
  const p = L.planificar(ex, L.desdeJSON(json).slice(0,1));
  assert.strictEqual(p.nuevos.length, 0); assert.strictEqual(p.actualizar[0].cambios.dni, '91049413');
  const lista = L.aplicar(ex, L.planificar(ex, L.desdeJSON(json).slice(0,2)), p => p + 'x');
  assert.strictEqual(lista.length, 2); assert.strictEqual(lista[1].cod, 'LEC-0008'); assert.strictEqual(lista[0].grado, 'Primaria · 2° B');
  assert.strictEqual(L.planificar(lista, L.desdeJSON(json).slice(0,2)).iguales, 2);
});
test('Excel: encabezados flexibles y plantillas', () => {
  const r = L.desdeFilas([{ 'Apellidos y Nombres':'x y', DNI:12345678, Tipo:'docente', 'Celular':'987 654 321' }]);
  assert.deepStrictEqual([r[0].dni, r[0].tipo, r[0].tel], ['12345678','Docente','987654321']);
  assert.strictEqual(L.plantilla('alumnos').hojas[0].filas[0][3], 'Grado'); assert.strictEqual(L.plantilla('personal').hojas.length, 2);
});
test('Color por nivel: primaria, secundaria, personal y sin nivel', () => {
  const S = require('../bib-util.js'), p = g => S.parsearGrado(g);
  assert.strictEqual(L.colorNivel({ tipo:'Alumno', grado:'Primaria · 2° B' }, p).nivel, 'Primaria');
  assert.strictEqual(L.colorNivel({ tipo:'Alumno', grado:'Secundaria · 3° A' }, p).color, '#2c5a8c');
  assert.strictEqual(L.colorNivel({ tipo:'Docente', grado:'Secundaria' }, p).nivel, 'Personal');
  assert.strictEqual(L.colorNivel({ tipo:'Alumno', grado:'3A' }, p).nivel, 'Sin nivel');
});
test('Archivo solo de celulares: basta el DNI, no cambia el tipo y avisa de celulares raros', () => {
  const ex = [{ id:'a', cod:'LEC-0001', dni:'11111111', nombre:'AGUILAR, ANA', tipo:'Docente', grado:'Primaria', tel:'' },
              { id:'b', cod:'LEC-0002', dni:'22222222', nombre:'BRAVO, LUIS', tipo:'Alumno', grado:'Primaria · 1° A', tel:'' }];
  const ent = L.desdeFilas([{ DNI:'11111111', Celular:'987654321' }, { DNI:'22222222', Celular:'12345' }, { DNI:'99999999', Celular:'987654321' }]);
  const p = L.planificar(ex, ent);
  assert.strictEqual(p.actualizar.length, 2); assert.strictEqual(p.actualizar[0].cambios.tipo, undefined);
  assert.deepStrictEqual(Object.keys(p.actualizar[0].cambios), ['tel']);
  assert.strictEqual(p.errores.length, 1); assert.strictEqual(p.avisos.length, 1);
  assert.strictEqual(L.aplicar(ex, p, x => x)[0].tipo, 'Docente');
});
test('Lista para celulares: trae a los activos, alumnos primero; y calidad de datos', () => {
  const ex = [{ id:'a', dni:'1', nombre:'ZETA', tipo:'Docente', cargo:'Inglés', tel:'' }, { id:'b', dni:'2', nombre:'ALFA', tipo:'Alumno', grado:'Primaria · 1° A', tel:'987654321' }, { id:'c', nombre:'BAJA', tipo:'Alumno', baja:'2026-01-01' }];
  const f = L.plantilla('celulares', ex).hojas[0].filas;
  assert.strictEqual(f.length, 3); assert.strictEqual(f[1][1], 'ALFA'); assert.strictEqual(f[2][3], 'Inglés');
  const S = require('../bib-util.js'), k = L.calidad(ex, g => S.parsearGrado(g));
  assert.deepStrictEqual([k.total, k.sinDni, k.sinCelular, k.dniRaro], [2, 0, 1, 2]);
  assert.strictEqual(L.telValido('+51 987 654 321'), true); assert.strictEqual(L.telValido('12345'), false);
});
