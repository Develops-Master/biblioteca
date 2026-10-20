// Carga los scripts REALES del navegador (con un DOM mínimo simulado) y comprueba las pantallas nuevas
// del Lectómetro, los diplomas y el tablero con datos: que dibujen, escapen HTML y calculen bien.
// No necesita jsdom ni servidor.
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const RAIZ = path.join(__dirname, '..');

function cargar(conApp) {
  const el = () => ({ style: {}, className: '', classList: { add() {}, contains: () => false }, appendChild() {}, remove() {}, setAttribute() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], insertAdjacentHTML() {}, set innerHTML(v) {}, get innerHTML() { return ''; } });
  const mem = {};
  const ctx = {
    console, URL, TextEncoder, Promise, JSON, Date, Math, Object, Array, Set, Map, Error, Number, String, parseInt, parseFloat, RegExp, Intl, setTimeout, clearTimeout, setInterval: () => 0,
    crypto: require('node:crypto').webcrypto, navigator: {}, location: { protocol: 'file:', pathname: '/', href: 'file:///', origin: 'http://localhost:3000' },
    localStorage: { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } },
    document: { getElementById: () => el(), createElement: () => el(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: el() },
    qrcode: undefined, alert() {}, confirm: () => true, prompt: () => 'x', fetch: () => Promise.reject(new Error('sin red')), MutationObserver: class { observe() {} }
  };
  ctx.window = ctx; ctx.addEventListener = () => {}; ctx.open = () => null;
  vm.createContext(ctx);
  for (const f of ['core.js', 'merge.js', 'bib-util.js', 'biblioteca.js', 'lectometro-util.js', 'diplomas-util.js', 'lectometro.js', 'diplomas.js'].concat(conApp ? ['app.js'] : []))
    // app.js termina con initApp() (arranque asíncrono con red): en la prueba se carga SOLO su código, sin arrancar.
    vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/^initApp\(\);\s*$/m, ''), ctx, { filename: f });
  return ctx;
}
const ev = (ctx, code) => vm.runInContext(code, ctx);

// Sesión de administrador + datos de ejemplo pequeños escritos directo en el caché de DB.
function conDatos(conApp) {
  const ctx = cargar(conApp);
  ev(ctx, `
    STATE.session = { rol:'ADMIN', usuario:'admin', nombre:'Admin' }; STATE.view = 'bibLectom';
    const hoy = today(), ayer = bibEnDias(-1), anteayer = bibEnDias(-2);
    DB.cache[KEYS.config] = { nombreIE:'IE <b>Prueba</b>' };
    DB.cache[BKEYS.libros] = [{ id:'lb1', titulo:'El zorro y la luna', catId:'c1', ejemplares:1 }];
    DB.cache[BKEYS.lect] = [{ id:'L1', cod:'LEC-0001', nombre:'<img src=x onerror=alert(1)> ANA', grado:'3° A Primaria', tipo:'Alumno' }, { id:'L2', cod:'LEC-0002', nombre:'LUIS SOTO', grado:'3° A Primaria', tipo:'Alumno' }, { id:'D1', cod:'DOC-0001', nombre:'PROFE', tipo:'Docente' }];
    DB.cache[BKEYS.prest] = []; DB.cache[B6.cmp] = []; DB.cache[B6.lec] = []; DB.cache[B5.res] = [];
    DB.cache[L7.bit] = [hoy, ayer, anteayer].map((f,i)=>({ id:'b'+i, lectorId:'L1', libroId:'lb1', fecha:f, paginas:30, minutos:40, autoevaluacion:5, comentario:'<script>1</script>', puntos:80 })).concat([{ id:'bx', lectorId:'L2', libroId:'', libroTitulo:'Otro', fecha:hoy, paginas:5, minutos:5, autoevaluacion:3, puntos:12 }]);
    DB.cache[L7.quiz] = [{ id:'q1', libroId:'lb1', titulo:'Evaluación <i>zorro</i>', preguntas:[{ texto:'¿Quién?', opciones:['A','B','',''], correcta:1 }] }]; DB.cache[L7.qres] = [];
    DB.cache[L7.prem] = [{ id:'p1', nombre:'Stickers', descripcion:'', costoPuntos:100, stock:3, activo:true }]; DB.cache[L7.canj] = [];
    DB.cache[L7.act] = [{ id:'a1', titulo:'Feria <b>del libro</b>', fecha:bibEnDias(3), tipo:'Feria del libro', hecha:false }, { id:'a2', titulo:'Pasada', fecha:bibEnDias(-5), tipo:'Otro', hecha:false }];
    DB.cache[D7.dip] = []; DB.cache[D7.cfg] = {};
    // Guardar sin servidor: solo al caché.
    DB.save = async function(k, v){ this.cache[k] = v; return v; };
    toast = () => {}; registrarBitacora = async () => {};
    1`);
  return ctx;
}

test('Lectómetro: sin lector elegido muestra KPIs y los mejores; con lector muestra puntos, racha, insignias y escapa HTML', () => {
  const ctx = conDatos();
  const inicio = ev(ctx, 'renderBibLectom()');
  assert.ok(inicio.includes('Los 5 mejores lectores') && !inicio.includes('<img src=x'));
  const l = ev(ctx, `lm.lectorId='L1'; renderBibLectom()`);
  assert.ok(l.includes('240'), 'puntos 3×80');
  assert.ok(l.includes('🔥 3'), 'racha de 3 días');
  assert.ok(l.includes('Aventurero Literario'), '240 pts = Aventurero');
  assert.ok(l.includes('Primer Libro'));
  assert.ok(!l.includes('<img src=x') && !l.includes('<script>1'), 'nada de HTML sin escapar');
  assert.ok(l.includes('&lt;img'));
});

test('Lectómetro: buscar lector por código, por nombre y por texto del datalist', () => {
  const ctx = conDatos();
  assert.strictEqual(ev(ctx, `lmBuscarLector('lec-0002').id`), 'L2');
  assert.strictEqual(ev(ctx, `lmBuscarLector('LEC-0002 — LUIS SOTO').id`), 'L2');
  assert.strictEqual(ev(ctx, `lmBuscarLector('luis soto').id`), 'L2');
  assert.strictEqual(ev(ctx, `lmBuscarLector('luis').id`), 'L2');
  assert.strictEqual(ev(ctx, `lmBuscarLector('zzz')`), null);
  assert.strictEqual(ev(ctx, `lmBuscarLector('')`), null);
});

test('evaluaciones, ranking, premios, actividades, diplomas y tablero dibujan sin errores', () => {
  const ctx = conDatos();
  for (const v of ['bibEval', 'bibRank', 'bibPremios', 'bibActiv', 'bibDipl', 'bibDir']) {
    const html = ev(ctx, `BIB_RENDER['${v}']()`);
    assert.ok(typeof html === 'string' && html.length > 50, v);
    assert.ok(!/<img src=x|<script>1|<i>zorro|<b>del libro/.test(html), v + ' no escapa HTML del usuario');
  }
  assert.ok(ev(ctx, `renderBibRank()`).includes('<td class="num">240</td>'));
  assert.ok(ev(ctx, `renderBibActiv()`).includes('Vencida'));
  assert.ok(ev(ctx, `renderBibPremios()`).includes('Stickers'));
  const dir = ev(ctx, `renderBibDir()`);
  assert.ok(dir.includes('no configurada') === false, 'sin datos del servidor no afirma nada de la copia externa');
  assert.ok(dir.includes('Disponible con el servidor local'));
});

test('menú: el grupo Lectómetro y diplomas lista las 7 vistas y todas tienen render y título', () => {
  const ctx = conDatos();
  const ids = JSON.parse(ev(ctx, `JSON.stringify(bibNavLectometro().items.map(i=>i.id))`));
  assert.deepStrictEqual(ids, ['bibLectom', 'bibEval', 'bibRank', 'bibPremios', 'bibActiv', 'bibDipl', 'bibDir']);
  for (const id of ids) {
    assert.ok(ev(ctx, `typeof BIB_RENDER['${id}']==='function'`), id + ' render');
    assert.ok(ev(ctx, `BIB_VIEWS.includes('${id}')`), id + ' en BIB_VIEWS');
    assert.ok(ev(ctx, `!!(BIB_TITULOS7['${id}']||BIB_TITULOS8['${id}'])`), id + ' título');
  }
});

test('diplomas: candidatos por nivel de lector, emisión con folio y código únicos, y no se repite el mismo diploma', async () => {
  const ctx = conDatos();
  ev(ctx, `dp.tipo='lectometro'; dp.nivelMin=1; dp.anio=String(new Date().getFullYear());`);
  assert.strictEqual(ev(ctx, `dipCandidatos().length`), 1, 'solo ANA (240 pts) llega a Aventurero; LUIS tiene 12');
  const nuevos = await ev(ctx, `dipEmitir(dipCandidatos())`);
  assert.strictEqual(nuevos.length, 1);
  assert.match(nuevos[0].codigo, /^D-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.strictEqual(nuevos[0].folio, 1);
  assert.strictEqual(ev(ctx, `dipCandidatos()[0].duplicado!==null`), true, 'ya emitido');
  assert.strictEqual((await ev(ctx, `dipEmitir(dipCandidatos())`)).length, 0, 'no se repite');
  // diplomas de otros tipos siguen la numeración del año
  ev(ctx, `dp.tipo='lector'; dp.minLibros=1;`);
  const otros = await ev(ctx, `dipEmitir(dipCandidatos())`);
  assert.deepStrictEqual(Array.from(otros.map(d => d.folio)).sort(), [2, 3], 'ANA y LUIS leyeron ≥1 libro: reciben los folios 2 y 3 (el 1 ya está usado)');
  const todos = JSON.parse(ev(ctx, `JSON.stringify(bibDiplomas())`));
  assert.strictEqual(new Set(todos.map(d => d.codigo)).size, todos.length);
  assert.strictEqual(new Set(todos.map(d => d.folio)).size, todos.length, 'folios distintos dentro del año');
  // el registro y la verificación local los muestran
  assert.ok(ev(ctx, `dp.ver='registro'; renderBibDipl()`).includes(nuevos[0].codigo));
});

test('diplomas: la advertencia de dirección localhost aparece en Configuración', () => {
  const ctx = conDatos();
  assert.ok(ev(ctx, `dp.ver='config'; renderBibDipl()`).includes('apunta a localhost'));
  ev(ctx, `DB.cache[D7.cfg] = { urlBase:'http://192.168.1.20:3000' }`);
  assert.ok(!ev(ctx, `renderBibDipl()`).includes('apunta a localhost'));
});

test('campanita: avisa actividades próximas/vencidas y premios por entregar', async () => {
  const ctx = conDatos();
  ev(ctx, `DB.cache[L7.canj] = [{ id:'c1', lectorId:'L1', premioId:'p1', costo:100, estado:'pendiente', fecha:today() }]`);
  const textos = JSON.parse(ev(ctx, `JSON.stringify(bibNotificaciones().map(n=>n.texto))`)).join(' | ');
  assert.match(textos, /actividad\(es\) del plan lector en los próximos 7 días/);
  assert.match(textos, /ya pasaron/);
  assert.match(textos, /premio\(s\) canjeado/);
});

test('copia de seguridad: las claves nuevas entran en el respaldo de la biblioteca', () => {
  const ctx = conDatos();
  const claves = JSON.parse(ev(ctx, `JSON.stringify(bibKeysTodas())`));
  for (const k of ['sigie:bib_bitacora', 'sigie:bib_evaluaciones', 'sigie:bib_evalresultados', 'sigie:bib_premios', 'sigie:bib_canjes', 'sigie:bib_actividades', 'sigie:bib_diplomas', 'sigie:bib_diplomas_cfg'])
    assert.ok(claves.includes(k), k);
});

test('MENÚ REAL (buildNav de app.js): el grupo «Lectómetro y diplomas» se ve completo para administrador y para docente', () => {
  const ctx = conDatos(true);
  ev(ctx, `for (const k of Object.values(KEYS)) if (!DB.cache[k]) DB.cache[k] = []; DB.cache[KEYS.config] = { nombreIE:'IE' };`);
  for (const rol of ['ADMIN', 'DOCENTE', 'CONSULTA']) {
    const grupos = JSON.parse(ev(ctx, `STATE.session = { rol:'${rol}', usuario:'u' }; JSON.stringify(buildNav().map(g => ({ grp:g.grp, ids:g.items.map(i => i.id) })))`));
    const g = grupos.find(x => x.grp === 'Lectómetro y diplomas');
    assert.ok(g, rol + ': el grupo no aparece en el menú');
    assert.deepStrictEqual(Array.from(g.ids), ['bibLectom', 'bibEval', 'bibRank', 'bibPremios', 'bibActiv', 'bibDipl', 'bibDir'], rol);
    const nombres = grupos.map(x => x.grp); assert.strictEqual(nombres.indexOf('Lectómetro y diplomas'), nombres.indexOf('Biblioteca') + 1, 'va justo debajo de Biblioteca');
  }
});

test('MENÚ REAL: cada entrada del grupo se puede abrir desde renderContent (la vista existe y no se redirige al inicio)', () => {
  const ctx = conDatos(true);
  ev(ctx, `for (const k of Object.values(KEYS)) if (!DB.cache[k]) DB.cache[k] = []; DB.cache[KEYS.config] = { nombreIE:'IE' };
    window.__html = ''; document.getElementById = id => id === 'content' ? { set innerHTML(v) { window.__html = v; }, get innerHTML() { return window.__html; } } : null; wireContentEvents = () => {};`);
  for (const v of ['bibLectom', 'bibEval', 'bibRank', 'bibPremios', 'bibActiv', 'bibDipl', 'bibDir']) {
    ev(ctx, `STATE.view = '${v}'; STATE.loaded = true; renderContent();`);
    assert.strictEqual(ev(ctx, 'STATE.view'), v, v + ': no debe redirigir a otra vista');
    assert.ok(ev(ctx, 'window.__html').length > 50, v + ': contenido vacío');
  }
});
