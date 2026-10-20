// Prueba la capa de datos del NAVEGADOR (core.js: DB.load / DB.save / DB.sincronizar) contra el servidor real.
// Cada "navegador" es un contexto de JavaScript aislado, con su propia cookie y su propia caché.
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
let puerto = 4400 + Math.floor(Math.random() * 400);

async function iniciarServidor() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigie-cli-'));
  const p = puerto++;
  const hijo = spawn(process.execPath, [path.join(RAIZ, 'server.js')], { env: { ...process.env, PORT: String(p), SIGIE_DATA_DIR: dir }, stdio: 'ignore' });
  const url = 'http://127.0.0.1:' + p;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(url + '/api/health')).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 100)); }
  return { url, parar: () => { hijo.kill(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

function crearNavegador(base) {
  const toasts = [];
  const jar = { cookie: '' };
  const elemento = () => ({ style: {}, className: '', textContent: '', appendChild(e) { toasts.push(e.textContent); }, remove() {}, setAttribute() {}, addEventListener() {} });
  const ctx = {
    console, URL, TextEncoder, Promise, JSON, Date, Math, Object, Array, Set, Map, Error, Number, String, parseInt, parseFloat,
    setTimeout: (f, ms) => { const t = setTimeout(f, ms); t.unref && t.unref(); return t; }, clearTimeout,
    setInterval: () => 0, crypto: require('node:crypto').webcrypto,
    navigator: {}, location: { protocol: 'http:', pathname: '/index.html', href: '' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 },
    document: { getElementById: () => elemento(), createElement: () => elemento(), querySelector: () => null, activeElement: null, hidden: false, addEventListener() {} },
    fetch: async (u, opts = {}) => {
      const r = await fetch(base + u, { ...opts, headers: { ...(opts.headers || {}), ...(jar.cookie ? { Cookie: jar.cookie } : {}) } });
      const sc = r.headers.get('set-cookie'); if (sc) { const par = sc.split(';')[0]; jar.cookie = par.endsWith('=') ? '' : par; }
      return r;
    }
  };
  ctx.window = ctx; ctx.window.addEventListener = () => {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'core.js'), 'utf8'), ctx, { filename: 'core.js' });
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'merge.js'), 'utf8'), ctx, { filename: 'merge.js' });
  return {
    ctx, toasts, jar,
    ev: codigo => { const v = vm.runInContext(codigo, ctx); return (v && typeof v === 'object' && typeof v.then !== 'function') ? JSON.parse(JSON.stringify(v)) : v; },
    async login(usuario, password) {
      const r = await ctx.fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario, password }) });
      return r.json();
    },
    async iniciar(claves) {
      await vm.runInContext('detectarAlmacenamiento()', ctx);
      for (const [k, f] of claves) await vm.runInContext(`DB.load(${JSON.stringify(k)}, ${JSON.stringify(f)})`, ctx);
    }
  };
}

async function prepararAdmin(url) {
  const a = crearNavegador(url);
  const r = await a.login('admin', 'admin123');
  assert.strictEqual(r.debeCambiarPass, true);
  await a.ctx.fetch('/api/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nueva: 'ClaveSegura#2026' }) });
  return a;
}
function clonarSesion(origen, destino) { destino.jar.cookie = origen.jar.cookie; }
const K = 'sigie:bib_prestamos';

test('el navegador detecta el servidor y trabaja con versiones', async () => {
  const s = await iniciarServidor();
  try {
    const a = await prepararAdmin(s.url);
    await a.iniciar([[K, []]]);
    assert.strictEqual(a.ev('STORAGE_MODE'), 'servidor');
    assert.strictEqual(a.ev(`DB.versions['${K}']`), 0);
    await a.ev(`DB.save('${K}', [{id:'p1'}])`);
    assert.strictEqual(a.ev(`DB.versions['${K}']`), 1);
  } finally { s.parar(); }
});

test('dos navegadores prestan "a la vez": DB.save fusiona y no se pierde ninguno', async () => {
  const s = await iniciarServidor();
  try {
    const A = await prepararAdmin(s.url), B = crearNavegador(s.url); clonarSesion(A, B);
    await A.iniciar([[K, []]]); await B.iniciar([[K, []]]);
    // cada uno presta un libro distinto con su copia local (ninguno ve lo del otro)
    await A.ev(`DB.save('${K}', [...DB.get('${K}'), {id:'pA', libro:'Quijote'}])`);
    await B.ev(`DB.save('${K}', [...DB.get('${K}'), {id:'pB', libro:'Martín Fierro'}])`); // llega con versión vieja → 409 → fusiona
    const enB = B.ev(`DB.get('${K}')`).map(x => x.id).sort();
    assert.deepStrictEqual(enB, ['pA', 'pB'], 'B terminó viendo ambos');
    // A todavía no lo sabe…
    assert.deepStrictEqual(A.ev(`DB.get('${K}')`).map(x => x.id), ['pA']);
    // …hasta que sincroniza (esto corre solo cada 10 s) y la pantalla se redibuja
    let redibujado = 0; A.ctx.__r = () => redibujado++; A.ev(`DB.alActualizar = () => __r()`);
    assert.strictEqual(await A.ev('DB.sincronizar()'), true);
    assert.deepStrictEqual(A.ev(`DB.get('${K}')`).map(x => x.id).sort(), ['pA', 'pB']);
    assert.strictEqual(redibujado, 1);
    // y ahora el guardado de A ya parte de la versión correcta (sin conflicto)
    await A.ev(`DB.save('${K}', [...DB.get('${K}'), {id:'pA2'}])`);
    assert.deepStrictEqual(B.ev(`DB.get('${K}')`).length, 2);
    assert.strictEqual(await B.ev('DB.sincronizar()'), true);
    assert.deepStrictEqual(B.ev(`DB.get('${K}')`).map(x => x.id).sort(), ['pA', 'pA2', 'pB']);
  } finally { s.parar(); }
});

test('guardados seguidos sin esperar (como un doble clic) quedan todos', async () => {
  const s = await iniciarServidor();
  try {
    const A = await prepararAdmin(s.url);
    await A.iniciar([[K, []]]);
    await A.ev(`Promise.all([1,2,3,4,5].map(i => DB.save('${K}', [...DB.get('${K}'), {id:'q'+i}])))`);
    const B = crearNavegador(s.url); clonarSesion(A, B); await B.iniciar([[K, []]]);
    assert.deepStrictEqual(B.ev(`DB.get('${K}')`).map(x => x.id).sort(), ['q1', 'q2', 'q3', 'q4', 'q5']);
  } finally { s.parar(); }
});

test('"reemplazar" (restaurar respaldo) escribe tal cual, sin fusionar', async () => {
  const s = await iniciarServidor();
  try {
    const A = await prepararAdmin(s.url), B = crearNavegador(s.url); clonarSesion(A, B);
    await A.iniciar([[K, []]]); await B.iniciar([[K, []]]);
    await A.ev(`DB.save('${K}', [{id:'viejo'}])`);
    await B.ev(`DB.save('${K}', [{id:'respaldo'}], { reemplazar:true })`);
    const C = crearNavegador(s.url); clonarSesion(A, C); await C.iniciar([[K, []]]);
    assert.deepStrictEqual(C.ev(`DB.get('${K}')`), [{ id: 'respaldo' }]);
  } finally { s.parar(); }
});

test('usuarios: la clave viaja al servidor pero no queda en la memoria del navegador', async () => {
  const s = await iniciarServidor();
  try {
    const A = await prepararAdmin(s.url);
    await A.iniciar([['sigie:usuarios', []]]);
    const lista = A.ev("DB.get('sigie:usuarios')");
    assert.ok(lista.length >= 4);
    assert.ok(lista.every(u => !('hash' in u) && !('salt' in u)), 'el navegador nunca recibe hashes');
    await A.ev(`DB.save('sigie:usuarios', [...DB.get('sigie:usuarios'), {id:'u_n', usuario:'profe9', nombre:'Profe', rol:'DOCENTE', aulaIds:[], nuevaClave:'ProfeNueva#9', debeCambiarPass:false}])`);
    const tras = A.ev("DB.get('sigie:usuarios')");
    assert.ok(tras.some(u => u.usuario === 'profe9'));
    assert.ok(tras.every(u => !('nuevaClave' in u) && !('hash' in u)), 'ni la clave en texto ni el hash quedan en caché');
    const P = crearNavegador(s.url);
    assert.strictEqual((await P.login('profe9', 'ProfeNueva#9')).ok, true);
  } finally { s.parar(); }
});

test('si el servidor rechaza un guardado (sin permiso) se avisa y la caché vuelve a lo real', async () => {
  const s = await iniciarServidor();
  try {
    const A = await prepararAdmin(s.url);
    await A.iniciar([['sigie:usuarios', []]]);
    await A.ev(`DB.save('sigie:usuarios', [...DB.get('sigie:usuarios'), {id:'u_c', usuario:'solo', nombre:'Solo', rol:'CONSULTA', aulaIds:[], nuevaClave:'SoloConsulta#1', debeCambiarPass:false}])`);
    const C = crearNavegador(s.url); await C.login('solo', 'SoloConsulta#1');
    await C.iniciar([[K, []]]);
    await C.ev(`DB.save('${K}', [{id:'intruso'}])`);
    assert.ok(C.toasts.some(t => /No se pudo guardar/.test(t) && /solo consulta/i.test(t)), 'avisa con el motivo: ' + JSON.stringify(C.toasts));
    assert.deepStrictEqual(C.ev(`DB.get('${K}')`), [], 'la caché no se queda con datos que el servidor no aceptó');
    assert.strictEqual(Object.keys(C.ev('DB.pending')).length, 0, 'un rechazo por permisos no se reintenta eternamente');
  } finally { s.parar(); }
});

test('sin sesión (cookie vencida o servidor reiniciado) el navegador vuelve al login', async () => {
  const s = await iniciarServidor();
  try {
    const A = await prepararAdmin(s.url);
    await A.iniciar([[K, []]]);
    await A.ctx.fetch('/api/logout', { method: 'POST' });
    await A.ev(`DB.save('${K}', [{id:'x'}])`);
    assert.match(A.ctx.location.href, /login\.html/);
    assert.strictEqual(Object.keys(A.ev('DB.pending')).length, 0);
  } finally { s.parar(); }
});

test('cargarSesionServidor entrega los datos de sesión desde el servidor (no desde localStorage)', async () => {
  const s = await iniciarServidor();
  try {
    const A = await prepararAdmin(s.url);
    await A.iniciar([]);
    const ses = await A.ev('cargarSesionServidor()');
    assert.strictEqual(ses.usuario, 'admin'); assert.strictEqual(ses.rol, 'ADMIN');
    const intruso = crearNavegador(s.url); await intruso.iniciar([]);
    intruso.ctx.localStorage.getItem = () => JSON.stringify({ id: ses.id }); // el viejo truco del id en localStorage
    assert.strictEqual(await intruso.ev('cargarSesionServidor()'), null);
  } finally { s.parar(); }
});
