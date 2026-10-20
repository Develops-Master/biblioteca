// Comprueba que los datos de ejemplo de la biblioteca incluyen reservas y bajas, y que son coherentes entre sí.
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const RAIZ = path.join(__dirname, '..');

function cargar() {
  const el = () => ({ style: {}, className: '', appendChild() {}, remove() {}, setAttribute() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });
  const ctx = {
    console, URL, TextEncoder, Promise, JSON, Date, Math, Object, Array, Set, Map, Error, Number, String, parseInt, parseFloat, RegExp, Intl,
    setTimeout, clearTimeout, setInterval: () => 0, crypto: require('node:crypto').webcrypto, navigator: {}, location: { protocol: 'file:', pathname: '/', href: '' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { getElementById: () => el(), createElement: () => el(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: el(), head: el() }
  };
  ctx.window = ctx; ctx.addEventListener = () => {};
  vm.createContext(ctx);
  for (const f of ['core.js', 'merge.js', 'bib-util.js', 'biblioteca.js', 'ejemplo.js'])
    vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx, { filename: f });
  return ctx;
}

test('datos de ejemplo: la biblioteca trae reservas y bajas coherentes', () => {
  const ctx = cargar();
  const D = JSON.parse(vm.runInContext(`JSON.stringify(window.construirDatosEjemplo({
    hoy: today(), anio: new Date().getFullYear(), uid: uid, bibCats: BIB_SEED,
    categoriasDeprec: SEED_CATEGORIAS_DEPREC, lookupCategoria: lookupCategoriaDeprec, usuariosPrevios: [],
    totalesSIGIE: () => ({ porCategoria: [] }), snapshotItems: items => items.map(i => ({ id: i.id }))
  }).bib)`, ctx));

  const { libros, prest, res, baj } = D;
  assert.ok(res.length >= 5, 'hay reservas');
  assert.ok(baj.length >= 3, 'hay bajas');
  for (const estado of ['Espera', 'Atendida', 'Cancelada']) assert.ok(res.some(r => r.estado === estado), 'reserva ' + estado);
  assert.ok(new Set(baj.map(b => b.motivo)).size >= 3, 'motivos variados');

  const idsLibros = new Set(libros.map(l => l.id));
  const idsLectores = new Set(D.lectores.map(l => l.id));
  for (const r of res) {
    assert.ok(idsLectores.has(r.lectorId), 'la reserva apunta a un lector real');
    if (r.estado === 'Espera') {
      assert.ok(idsLibros.has(r.libroId), 'reserva en espera sobre un libro que sigue en el catálogo');
      const l = libros.find(x => x.id === r.libroId);
      const prestados = prest.filter(p => p.libroId === l.id && !p.devuelto).length;
      assert.ok(prestados >= (l.cant || 1), 'solo se reserva lo que está todo prestado: ' + l.cod);
      assert.ok(!prest.some(p => p.libroId === l.id && !p.devuelto && p.lectorId === r.lectorId), 'nadie reserva el libro que ya tiene');
    }
  }
  for (const b of baj) {
    assert.ok(!idsLibros.has(b.libroId), 'un libro dado de baja ya no está en el catálogo: ' + b.cod);
    assert.ok(!prest.some(p => p.libroId === b.libroId), 'no se da de baja un libro con préstamos');
    assert.ok(b.cod && b.titulo && b.motivo && b.fecha && b.responsable, 'la baja tiene la misma forma que la que crea la pantalla');
  }
  for (const p of prest) assert.ok(idsLibros.has(p.libroId), 'ningún préstamo apunta a un libro que ya no existe');
});

test('datos de ejemplo: el Lectómetro trae bitácora, evaluación, premios y actividades coherentes con los lectores y libros', () => {
  const ctx = cargar();
  const D = JSON.parse(vm.runInContext(`JSON.stringify(window.construirDatosEjemplo({
    hoy: today(), anio: new Date().getFullYear(), uid: uid, bibCats: BIB_SEED,
    categoriasDeprec: SEED_CATEGORIAS_DEPREC, lookupCategoria: lookupCategoriaDeprec, usuariosPrevios: [],
    totalesSIGIE: () => ({ porCategoria: [] }), snapshotItems: items => items.map(i => ({ id: i.id }))
  }).bib)`, ctx));
  const L = D.lectometro;
  assert.ok(L.bit.length > 20 && L.quiz.length === 1 && L.qres.length > 0 && L.prem.length >= 3 && L.act.length >= 3);
  const lectores = new Set(D.lectores.map(l => l.id)), libros = new Set(D.libros.map(l => l.id));
  for (const b of L.bit) { assert.ok(lectores.has(b.lectorId) && libros.has(b.libroId), 'bitácora enlazada'); assert.ok(b.puntos > 0); }
  for (const r of L.qres) { assert.ok(lectores.has(r.lectorId)); assert.strictEqual(r.nivel, r.puntaje >= 91 ? 'AD' : r.puntaje >= 71 ? 'A' : r.puntaje >= 51 ? 'B' : 'C'); }
  const premios = new Set(L.prem.map(p => p.id));
  for (const c of L.canj) assert.ok(premios.has(c.premioId) && lectores.has(c.lectorId));
  assert.ok(new Set(L.bit.map(b => b.id)).size === L.bit.length, 'ids únicos');
});
