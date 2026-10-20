// v12: las pantallas nuevas (OPAC, sugerencias, reportes del Lectómetro) dibujan, filtran y escapan HTML.
const test = require('node:test'), assert = require('node:assert'), fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, 'lectometro-pantallas.test.js'), 'utf8');
const base = src.slice(src.indexOf("const vm = require"), src.indexOf("test('Lectómetro: sin lector")).replace("'diplomas.js'", "'diplomas.js', 'mejoras.js'");
const { cargarTodo } = new Function('require', '__dirname', base.replace("const RAIZ = path.join(__dirname, '..');", "const RAIZ = path.join(__dirname, '..');") + '; return { cargarTodo: conDatos };')(require, __dirname);
const ev = (c, code) => require('node:vm').runInContext(code, c);

test('OPAC: busca, filtra por disponibilidad y escapa HTML; sugerencias y reportes dibujan', () => {
  const c = cargarTodo();
  ev(c, `DB.cache[BKEYS.libros] = [{ id:'a', cod:'CUE-001', titulo:'El zorro <b>y</b> la luna', autor:'Ana', catId:'c1', cant:1 }, { id:'b', cod:'CUE-002', titulo:'Mar azul', autor:'Luis', catId:'c1', cant:1 }];
    DB.cache[BKEYS.prest] = [{ id:'p', libroId:'b', lectorId:'L1', fecha:today(), vence:bibEnDias(5), devuelto:'' }];
    DB.cache[M12.sug] = [{ id:'s1', titulo:'Harry <i>Potter</i>', solicitante:'Ana', fecha:today(), estado:'pendiente' }];`);
  const html = n => ev(c, `BIB_RENDER.${n}()`);
  assert.ok(html('bibOpac').includes('Novedades'), 'sin búsqueda muestra novedades');
  ev(c, `mj.q = 'zorro'`); let h = html('bibOpac');
  assert.ok(h.includes('1 resultado') && h.includes('Disponible') && !h.includes('<b>y</b>'), 'busca y escapa');
  ev(c, `mj.q = ''; mj.soloDisp = true`); h = html('bibOpac');
  assert.ok(h.includes('zorro') && !h.includes('Mar azul'), 'solo disponibles oculta el prestado');
  assert.ok(html('bibSug').includes('Harry') && !html('bibSug').includes('<i>Potter</i>'), 'sugerencias escapadas');
  h = html('bibRepLec'); assert.ok(h.includes('Registros de lectura') && h.includes('LUIS SOTO'), 'reporte con lectores');
  ev(c, `mj.aula = lmGrupo(bibLect()[0]); mj.desde = bibEnDias(-1)`); assert.ok(html('bibRepLec').includes('ANA'));
  const ids = ev(c, `[bibNav(), bibNavLectometro()].flatMap(g=>g.items.map(i=>i.id)).join(',')`);
  ['bibOpac', 'bibSug', 'bibRepLec'].forEach(v => assert.ok(ids.includes(v), v + ' está en el menú'));
});
