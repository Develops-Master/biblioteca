const test = require('node:test');
const assert = require('node:assert');
const B = require('../bajas-util.js');
const bajas = () => [
  { id:'j1', fecha:'2026-03-02', libroId:'a', cod:'CUE-001', titulo:'Cuentos', cant:1, motivo:'Perdido', lector:'PEREZ, JUAN', prestId:'p1', acta:'001-2026', actaFecha:'2026-03-10' },
  { id:'j2', fecha:'2026-05-02', libroId:'b', cod:'CIE-001', titulo:'Átomos', cant:3, motivo:'Desgaste' },
  { id:'j3', fecha:'2026-06-02', libroId:'c', cod:'MAT-001', titulo:'Números', cant:1, motivo:'Dañado', lector:'RAMOS, ANA' },
  { id:'j4', fecha:'2025-11-02', libroId:'d', cod:'HIS-001', titulo:'Historia', cant:2, motivo:'Robo', revertida:{ fecha:'2025-12-01', motivo:'Apareció el libro' } }];
test('resumen: las revertidas no cuentan; sin acta y reposición pendiente', () => {
  assert.deepStrictEqual(B.resumen(bajas(), ''), { ejemplares:5, sinActa:4, reposicion:2, revertidas:1 });
  assert.deepStrictEqual(B.resumen(bajas(), '2026'), { ejemplares:5, sinActa:4, reposicion:2, revertidas:0 });
});
test('filtrar: por año, motivo, estado y texto', () => {
  const ids = f => B.filtrar(bajas(), f).map(b => b.id).join();
  assert.strictEqual(ids({}), 'j1,j2,j3'); assert.strictEqual(ids({ estado:'sinActa' }), 'j2,j3'); assert.strictEqual(ids({ estado:'conActa' }), 'j1');
  assert.strictEqual(ids({ estado:'revertidas' }), 'j4'); assert.strictEqual(ids({ estado:'reposicion' }), 'j1,j3'); assert.strictEqual(ids({ motivo:'Desgaste' }), 'j2');
  assert.strictEqual(ids({ q:'ramos' }), 'j3'); assert.strictEqual(ids({ anio:'2025' }), ''); assert.strictEqual(ids({ q:'001-2026' }), 'j1');
});
test('actas: siguiente número del año, y sellar no pisa las que ya figuran en otra acta ni las revertidas', () => {
  assert.strictEqual(B.siguienteActa(bajas(), 2026), '002-2026'); assert.strictEqual(B.siguienteActa(bajas(), 2027), '001-2027'); assert.strictEqual(B.siguienteActa([{ acta:'ACTA ESPECIAL' }], 2026), '001-2026');
  const s = B.sellar(bajas(), ['j1', 'j2', 'j4'], '002-2026', '2026-10-16'), por = Object.fromEntries(s.map(b => [b.id, b]));
  assert.strictEqual(por.j1.acta, '001-2026'); assert.strictEqual(por.j2.acta, '002-2026'); assert.strictEqual(por.j2.actaFecha, '2026-10-16'); assert.strictEqual(por.j4.acta, undefined);
});
test('reingreso: suma al libro existente (por id o por código) o lo recrea; avisa si no hay copia completa', () => {
  assert.deepStrictEqual(B.reingreso(bajas()[1], [{ id:'b', cod:'CIE-001', cant:2 }]), { accion:'sumar', libro:{ id:'b', cod:'CIE-001', cant:5 }, completo:true });
  assert.strictEqual(B.reingreso(bajas()[1], [{ id:'zz', cod:'cie-001', cant:1 }]).libro.cant, 4);
  const c = B.reingreso({ ...bajas()[0], libro:{ id:'a', cod:'CUE-001', titulo:'Cuentos', isbn:'978', ubi:'B2', cant:5 } }, []);
  assert.deepStrictEqual([c.accion, c.completo, c.libro.cant, c.libro.isbn, c.libro.ubi], ['crear', true, 1, '978', 'B2']);
  const p = B.reingreso(bajas()[0], []); assert.deepStrictEqual([p.accion, p.completo, p.libro.titulo, p.libro.cant], ['crear', false, 'Cuentos', 1]);
  assert.deepStrictEqual(B.revertir(bajas()[1], 'Baja registrada por error', '2026-10-16', 'ana').revertida, { fecha:'2026-10-16', motivo:'Baja registrada por error', por:'ana' });
});
test('acta HTML: número, fecha dd/mm/aaaa, total de ejemplares y texto escapado', () => {
  const h = B.actaHtml([bajas()[0], { ...bajas()[1], titulo:'<b>Átomos</b>' }], { nro:'002-2026', fecha:'2026-10-16', ie:'IE "Prueba"' });
  assert.ok(/N° 002-2026/.test(h) && /16\/10\/2026/.test(h) && /\(4 ejemplar\(es\)\)/.test(h) && /&lt;b&gt;Átomos/.test(h) && /&quot;Prueba&quot;/.test(h));
});
