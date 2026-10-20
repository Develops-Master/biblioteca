// Pruebas de integración: arrancan server.js de verdad (con una carpeta de datos temporal) y le hablan por HTTP.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { fusionar } = require('../merge.js');

const RAIZ = path.join(__dirname, '..');
let puertoSiguiente = 3950 + Math.floor(Math.random() * 400);

async function iniciarServidor(prepararDatos) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigie-test-'));
  if (prepararDatos) prepararDatos(dir);
  const puerto = puertoSiguiente++;
  const hijo = spawn(process.execPath, [path.join(RAIZ, 'server.js')], {
    env: { ...process.env, PORT: String(puerto), SIGIE_DATA_DIR: dir }, stdio: 'ignore'
  });
  const url = 'http://127.0.0.1:' + puerto;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(url + '/api/health'); if (r.ok) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }
  return { url, dir, parar: () => { hijo.kill(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

// Navegador de mentira con su propia "jarra de cookies".
class Cliente {
  constructor(url) { this.url = url; this.cookie = ''; this.ultimoSetCookie = ''; }
  async pedir(metodo, ruta, cuerpo, cabeceras) {
    const r = await fetch(this.url + ruta, {
      method: metodo,
      headers: { ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...(cabeceras || {}) },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined
    });
    const sc = r.headers.get('set-cookie');
    if (sc) { this.ultimoSetCookie = sc; const par = sc.split(';')[0]; this.cookie = par.endsWith('=') ? '' : par; }
    let datos = null; try { datos = await r.json(); } catch (e) {}
    return { status: r.status, datos };
  }
  login(usuario, password) { return this.pedir('POST', '/api/login', { usuario, password }); }
  get(key) { return this.pedir('GET', '/api/db/item?key=' + encodeURIComponent(key)); }
  put(key, value, baseVersion) { return this.pedir('PUT', '/api/db/item', baseVersion === undefined ? { key, value } : { key, value, baseVersion }); }
}
// El navegador guarda cada clave como TEXTO JSON.
const T = v => JSON.stringify(v);

async function entrarComoAdmin(url) {
  const c = new Cliente(url);
  assert.strictEqual((await c.login('admin', 'admin123')).datos.debeCambiarPass, true);
  assert.strictEqual((await c.pedir('POST', '/api/password', { nueva: 'ClaveSegura#2026' })).status, 200);
  return c;
}

test('sin sesión no se puede leer, escribir, borrar ni listar nada', async () => {
  const s = await iniciarServidor();
  try {
    const c = new Cliente(s.url);
    for (const [m, r, b] of [
      ['GET', '/api/db/item?key=sigie:usuarios'], ['GET', '/api/db/list'], ['GET', '/api/db/versions'],
      ['PUT', '/api/db/item', { key: 'sigie:x', value: '1' }], ['DELETE', '/api/db/item?key=sigie:usuarios'], ['GET', '/api/session']
    ]) assert.strictEqual((await c.pedir(m, r, b)).status, 401, m + ' ' + r);
  } finally { s.parar(); }
});

test('/api/health no revela la ruta del archivo ni cuántos registros hay', async () => {
  const s = await iniciarServidor();
  try {
    const { status, datos } = await new Cliente(s.url).pedir('GET', '/api/health');
    assert.strictEqual(status, 200);
    assert.deepStrictEqual(Object.keys(datos).sort(), ['auth', 'modo', 'motor', 'ok']);
  } finally { s.parar(); }
});

test('login: mensaje genérico, cookie HttpOnly/SameSite, y cambio obligatorio de la clave de fábrica', async () => {
  const s = await iniciarServidor();
  try {
    const c = new Cliente(s.url);
    const mal = await c.login('admin', 'incorrecta');
    const noExiste = await c.login('fantasma', 'incorrecta');
    assert.strictEqual(mal.status, 401); assert.strictEqual(noExiste.status, 401);
    assert.strictEqual(mal.datos.error, noExiste.datos.error, 'no debe delatar qué usuarios existen');

    const ok = await c.login('admin', 'admin123');
    assert.strictEqual(ok.status, 200);
    assert.match(c.ultimoSetCookie, /HttpOnly/); assert.match(c.ultimoSetCookie, /SameSite=Strict/);
    // con la clave provisional solo se puede cambiar la clave
    const bloqueado = await c.get('sigie:config');
    assert.strictEqual(bloqueado.status, 403); assert.strictEqual(bloqueado.datos.codigo, 'CAMBIO_CLAVE');
    assert.strictEqual((await c.pedir('POST', '/api/password', { nueva: 'admin123' })).status, 400);
    assert.strictEqual((await c.pedir('POST', '/api/password', { nueva: 'corta' })).status, 400);
    assert.strictEqual((await c.pedir('POST', '/api/password', { nueva: 'ClaveSegura#2026' })).status, 200);
    assert.strictEqual((await c.put('sigie:config', T({ a: 1 }))).status, 200);
    // la clave vieja ya no entra, la nueva sí
    const otro = new Cliente(s.url);
    assert.strictEqual((await otro.login('admin', 'admin123')).status, 401);
    assert.strictEqual((await otro.login('admin', 'ClaveSegura#2026')).status, 200);
  } finally { s.parar(); }
});

test('el hash y la sal de las contraseñas nunca salen del servidor', async () => {
  const s = await iniciarServidor();
  try {
    const c = await entrarComoAdmin(s.url);
    const r = await c.get('sigie:usuarios');
    assert.strictEqual(r.status, 200);
    const texto = JSON.stringify(r.datos);
    assert.ok(!/hash|salt|algo|pbkdf2/i.test(texto), 'la respuesta no debe incluir credenciales');
    const lista = JSON.parse(r.datos.value);
    assert.ok(lista.some(u => u.usuario === 'admin') && lista.some(u => u.usuario === 'biblioteca'));
  } finally { s.parar(); }
});

test('una cookie inventada o el viejo "id en localStorage" no dan acceso', async () => {
  const s = await iniciarServidor();
  try {
    const c = new Cliente(s.url);
    c.cookie = 'sigie_sid=' + crypto.randomBytes(32).toString('hex');
    assert.strictEqual((await c.get('sigie:usuarios')).status, 401);
    c.cookie = 'sigie_sid=usr_123';
    assert.strictEqual((await c.get('sigie:usuarios')).status, 401);
  } finally { s.parar(); }
});

test('bloqueo temporal tras 5 intentos fallidos (lo aplica el servidor)', async () => {
  const s = await iniciarServidor();
  try {
    const c = new Cliente(s.url);
    for (let i = 0; i < 5; i++) assert.strictEqual((await c.login('biblioteca', 'mal' + i)).status, 401);
    const r = await c.login('biblioteca', 'Biblio2026'); // ni la clave correcta entra durante el bloqueo
    assert.strictEqual(r.status, 429); assert.ok(r.datos.segundos > 0);
  } finally { s.parar(); }
});

test('cerrar sesión invalida la cookie', async () => {
  const s = await iniciarServidor();
  try {
    const c = await entrarComoAdmin(s.url);
    const cookie = c.cookie;
    assert.strictEqual((await c.pedir('POST', '/api/logout')).status, 200);
    const robada = new Cliente(s.url); robada.cookie = cookie;
    assert.strictEqual((await robada.get('sigie:config')).status, 401);
  } finally { s.parar(); }
});

test('una página de otro sitio (Origin distinto) es rechazada', async () => {
  const s = await iniciarServidor();
  try {
    const c = await entrarComoAdmin(s.url);
    assert.strictEqual((await c.pedir('GET', '/api/db/list', undefined, { Origin: 'http://sitio-malo.example' })).status, 403);
    assert.strictEqual((await c.pedir('GET', '/api/db/list', undefined, { Origin: s.url })).status, 200);
  } finally { s.parar(); }
});

test('versiones: el guardado sobre una versión vieja da 409 con los datos actuales', async () => {
  const s = await iniciarServidor();
  try {
    const c = await entrarComoAdmin(s.url);
    const k = 'sigie:bib_prestamos';
    assert.strictEqual((await c.get(k)).status, 404);
    const p1 = await c.put(k, T([{ id: 'a' }]), 0);           // la clave no existe: versión 0
    assert.strictEqual(p1.status, 200);
    const v1 = p1.datos.version;
    const p2 = await c.put(k, T([{ id: 'a' }, { id: 'b' }]), v1);
    assert.strictEqual(p2.datos.version, v1 + 1);
    const viejo = await c.put(k, T([{ id: 'a' }, { id: 'c' }]), v1);   // quien leyó v1 y llega tarde
    assert.strictEqual(viejo.status, 409);
    assert.strictEqual(viejo.datos.version, v1 + 1);
    assert.deepStrictEqual(JSON.parse(viejo.datos.value).map(x => x.id), ['a', 'b']);
    assert.deepStrictEqual(JSON.parse((await c.get(k)).datos.value).map(x => x.id), ['a', 'b'], '409 no escribe nada');
    // sin baseVersion = escritura incondicional (restaurar respaldo)
    assert.strictEqual((await c.put(k, T([{ id: 'z' }]))).status, 200);
    const vs = await c.pedir('GET', '/api/db/versions');
    assert.ok(vs.datos.versions[k] > v1 + 1);
  } finally { s.parar(); }
});

test('dos computadoras prestan a la vez y NO se pierde ningún préstamo', async () => {
  const s = await iniciarServidor();
  try {
    const admin = await entrarComoAdmin(s.url);
    const k = 'sigie:bib_prestamos';
    await admin.put(k, T([{ id: 'p0', devuelto: '' }]));
    // dos PC abren el sistema y leen el mismo estado
    const pcA = new Cliente(s.url), pcB = new Cliente(s.url); pcA.cookie = pcB.cookie = admin.cookie;
    const leer = async c => { const r = await c.get(k); return { v: r.datos.version, texto: r.datos.value }; };
    const a = await leer(pcA), b = await leer(pcB);

    // B presta primero y guarda sin problema
    const mioB = [...JSON.parse(b.texto), { id: 'pB', devuelto: '' }];
    assert.strictEqual((await pcB.put(k, T(mioB), b.v)).status, 200);

    // A presta otro libro, con su copia vieja: antes esto pisaba el préstamo de B
    let texto = T([...JSON.parse(a.texto), { id: 'pA', devuelto: '' }]), base = a.texto, ver = a.v;
    let intento = await pcA.put(k, texto, ver);
    assert.strictEqual(intento.status, 409);
    // el navegador fusiona y reintenta (es lo que hace DB.save en core.js)
    texto = T(fusionar(JSON.parse(base), JSON.parse(texto), JSON.parse(intento.datos.value)));
    intento = await pcA.put(k, texto, intento.datos.version);
    assert.strictEqual(intento.status, 200);

    const final = JSON.parse((await admin.get(k)).datos.value).map(x => x.id).sort();
    assert.deepStrictEqual(final, ['p0', 'pA', 'pB']);
  } finally { s.parar(); }
});

test('guardados simultáneos reales (20 en paralelo): el servidor los serializa sin corromper', async () => {
  const s = await iniciarServidor();
  try {
    const admin = await entrarComoAdmin(s.url);
    const k = 'sigie:bib_prestamos';
    await admin.put(k, T([]));
    const clientes = Array.from({ length: 20 }, () => { const c = new Cliente(s.url); c.cookie = admin.cookie; return c; });
    // todos leen el mismo estado y guardan a la vez, cada uno con su préstamo
    const lecturas = await Promise.all(clientes.map(c => c.get(k)));
    const resultados = await Promise.all(clientes.map((c, i) => {
      const l = lecturas[i].datos;
      return c.put(k, T([...JSON.parse(l.value), { id: 'p' + i }]), l.version);
    }));
    assert.strictEqual(resultados.filter(r => r.status === 200).length, 1, 'solo uno gana la carrera; el resto recibe 409');
    assert.strictEqual(resultados.filter(r => r.status === 409).length, 19);
    // los 19 perdedores fusionan y reintentan hasta lograrlo
    for (let i = 0; i < clientes.length; i++) {
      if (resultados[i].status !== 409) continue;
      let base = lecturas[i].datos.value, texto = T([...JSON.parse(base), { id: 'p' + i }]), srv = resultados[i].datos;
      for (let n = 0; n < 40; n++) {
        texto = T(fusionar(JSON.parse(base), JSON.parse(texto), JSON.parse(srv.value))); base = srv.value;
        const r = await clientes[i].put(k, texto, srv.version);
        if (r.status === 200) break;
        srv = r.datos;
      }
    }
    const ids = JSON.parse((await admin.get(k)).datos.value).map(x => x.id).sort();
    assert.deepStrictEqual(ids, Array.from({ length: 20 }, (_, i) => 'p' + i).sort());
  } finally { s.parar(); }
});

test('roles: CONSULTA no escribe, DOCENTE no borra datos ni toca usuarios, ADMIN2 no gestiona usuarios', async () => {
  const s = await iniciarServidor();
  try {
    const admin = await entrarComoAdmin(s.url);
    const lista = JSON.parse((await admin.get('sigie:usuarios')).datos.value);
    const nuevos = [
      { id: 'u_c', usuario: 'lector1', nombre: 'Solo consulta', rol: 'CONSULTA', aulaIds: [], nuevaClave: 'ConsultaTest#1' },
      { id: 'u_d', usuario: 'profe1', nombre: 'Docente', rol: 'DOCENTE', aulaIds: [], nuevaClave: 'DocenteTest#1' },
      { id: 'u_a', usuario: 'secre1', nombre: 'Secretaría', rol: 'ADMIN2', aulaIds: [], nuevaClave: 'SecreTest#1' }
    ];
    const g = await admin.put('sigie:usuarios', T([...lista, ...nuevos]));
    assert.strictEqual(g.status, 200, JSON.stringify(g.datos));

    const consulta = new Cliente(s.url), docente = new Cliente(s.url), secre = new Cliente(s.url);
    await consulta.login('lector1', 'ConsultaTest#1'); await docente.login('profe1', 'DocenteTest#1'); await secre.login('secre1', 'SecreTest#1');
    assert.strictEqual((await consulta.get('sigie:usuarios')).status, 200, 'consulta sí puede leer');
    assert.strictEqual((await consulta.put('sigie:bib_libros', T([]))).status, 403);
    assert.strictEqual((await consulta.pedir('DELETE', '/api/db/item?key=sigie:bib_libros')).status, 403);

    assert.strictEqual((await docente.put('sigie:bib_prestamos', T([{ id: 'x' }]))).status, 200, 'docente sí registra préstamos');
    assert.strictEqual((await docente.pedir('DELETE', '/api/db/item?key=sigie:bib_libros')).status, 403);
    assert.strictEqual((await docente.pedir('DELETE', '/api/db/item?key=sigie:imagenes:img1')).status, 200, 'docente puede quitar fotos');
    // escalada de privilegios: un docente intenta hacerse ADMIN
    const mia = JSON.parse((await docente.get('sigie:usuarios')).datos.value).map(u => u.id === 'u_d' ? { ...u, rol: 'ADMIN' } : u);
    assert.strictEqual((await docente.put('sigie:usuarios', T(mia))).status, 403);
    assert.strictEqual((await secre.put('sigie:usuarios', T(mia))).status, 403);
    assert.strictEqual((await secre.pedir('DELETE', '/api/db/item?key=sigie:usuarios')).status, 403);
    assert.strictEqual((await secre.put('sigie:bib_libros', T([]))).status, 200, 'ADMIN2 sí administra la biblioteca');
  } finally { s.parar(); }
});

test('gestión de usuarios: validaciones y cierre de sesión de cuentas eliminadas', async () => {
  const s = await iniciarServidor();
  try {
    const admin = await entrarComoAdmin(s.url);
    const lista = JSON.parse((await admin.get('sigie:usuarios')).datos.value);
    const yo = lista.find(u => u.usuario === 'admin');
    const base = { id: 'u_n', usuario: 'nuevo1', nombre: 'N', rol: 'DOCENTE', aulaIds: [] };
    assert.strictEqual((await admin.put('sigie:usuarios', T([...lista, { ...base, nuevaClave: 'corta' }]))).status, 400, 'clave débil');
    assert.strictEqual((await admin.put('sigie:usuarios', T([...lista, base]))).status, 400, 'usuario nuevo sin clave');
    assert.strictEqual((await admin.put('sigie:usuarios', T([...lista, { ...base, rol: 'SUPERMAN', nuevaClave: 'Valida#2026x' }]))).status, 400, 'rol inválido');
    assert.strictEqual((await admin.put('sigie:usuarios', T([...lista, { ...base, usuario: 'ADMIN', nuevaClave: 'Valida#2026x' }]))).status, 400, 'usuario repetido');
    assert.strictEqual((await admin.put('sigie:usuarios', T(lista.filter(u => u.id !== yo.id)))).status, 400, 'no puede borrarse a sí mismo');
    assert.strictEqual((await admin.put('sigie:usuarios', T([{ ...yo, rol: 'DOCENTE' }]))).status, 400, 'debe quedar un ADMIN');

    assert.strictEqual((await admin.put('sigie:usuarios', T([...lista, { ...base, nuevaClave: 'Valida#2026x', debeCambiarPass: false }]))).status, 200);
    const nuevo = new Cliente(s.url);
    assert.strictEqual((await nuevo.login('nuevo1', 'Valida#2026x')).status, 200);
    assert.strictEqual((await nuevo.get('sigie:config')).status, 404, 'sesión válida');
    // el admin elimina la cuenta: su sesión muere en el acto
    assert.strictEqual((await admin.put('sigie:usuarios', T(lista))).status, 200);
    assert.strictEqual((await nuevo.get('sigie:config')).status, 401);
    // editar un usuario SIN enviar clave conserva la clave anterior
    const act = JSON.parse((await admin.get('sigie:usuarios')).datos.value).map(u => u.usuario === 'biblioteca' ? { ...u, nombre: 'Renombrada', debeCambiarPass: false } : u);
    assert.strictEqual((await admin.put('sigie:usuarios', T(act))).status, 200);
    assert.strictEqual((await new Cliente(s.url).login('biblioteca', 'Biblio2026')).status, 200);
  } finally { s.parar(); }
});

test('la bitácora registra inicios de sesión e intentos fallidos desde el servidor', async () => {
  const s = await iniciarServidor();
  try {
    await new Cliente(s.url).login('admin', 'mal');
    const admin = await entrarComoAdmin(s.url);
    const log = JSON.parse((await admin.get('sigie:bitacora')).datos.value);
    const acciones = log.map(l => l.accion);
    assert.ok(acciones.includes('Intento de acceso fallido')); assert.ok(acciones.includes('Inicio de sesión')); assert.ok(acciones.includes('Cambio de contraseña'));
  } finally { s.parar(); }
});

test('actualización: una base de la versión anterior (sin columna "version", hash SHA-256) sigue funcionando', async () => {
  const s = await iniciarServidor(dir => {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(dir, 'sigie.db'));
    db.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, actualizado TEXT NOT NULL) WITHOUT ROWID');
    const sal = 'sal-antigua';
    const hash = crypto.createHash('sha256').update('MiClaveVieja1' + sal).digest('hex');
    const usuarios = [{ id: 'usr_old', usuario: 'director', nombre: 'Director', rol: 'ADMIN', aulaIds: [], salt: sal, hash, debeCambiarPass: false }];
    const ins = db.prepare('INSERT INTO kv VALUES (?,?,?)');
    ins.run('sigie:usuarios', JSON.stringify(JSON.stringify(usuarios)), new Date().toISOString());
    ins.run('sigie:bib_semilla_x', JSON.stringify('true'), new Date().toISOString());
    ins.run('sigie:bib_libros', JSON.stringify(JSON.stringify([{ id: 'l1', titulo: 'Libro viejo' }])), new Date().toISOString());
    ins.run('sigie:bib_usuarios_semilla', JSON.stringify('true'), new Date().toISOString());
    db.close();
  });
  try {
    const c = new Cliente(s.url);
    assert.strictEqual((await c.login('director', 'MiClaveVieja1')).status, 200, 'el hash SHA-256 antiguo sigue sirviendo');
    const libros = await c.get('sigie:bib_libros');
    assert.strictEqual(libros.status, 200);
    assert.strictEqual(libros.datos.version, 1, 'datos viejos reciben versión 1');
    assert.strictEqual(JSON.parse(libros.datos.value)[0].titulo, 'Libro viejo');
    // tras entrar, el hash se migró a PBKDF2 (se comprueba entrando de nuevo con la misma clave)
    assert.strictEqual((await new Cliente(s.url).login('director', 'MiClaveVieja1')).status, 200);
    const dbDirecta = new (require('node:sqlite').DatabaseSync)(path.join(s.dir, 'sigie.db'), { readOnly: true });
    const fila = dbDirecta.prepare("SELECT value FROM kv WHERE key='sigie:usuarios'").get();
    dbDirecta.close();
    assert.strictEqual(JSON.parse(JSON.parse(fila.value))[0].algo, 'pbkdf2');
  } finally { s.parar(); }
});

test('"Reiniciar sistema": al vaciar los usuarios, el servidor vuelve a crear admin/admin123 y cierra las sesiones', async () => {
  const s = await iniciarServidor();
  try {
    const admin = await entrarComoAdmin(s.url);
    assert.strictEqual((await admin.put('sigie:usuarios', T([]))).status, 200);
    assert.strictEqual((await admin.get('sigie:config')).status, 401, 'la sesión anterior ya no sirve');
    const nuevo = new Cliente(s.url);
    const r = await nuevo.login('admin', 'admin123');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.datos.debeCambiarPass, true);
    assert.strictEqual((await nuevo.pedir('POST', '/api/password', { nueva: 'OtraClave#2026x' })).status, 200);
    const usuarios = JSON.parse((await nuevo.get('sigie:usuarios')).datos.value);
    assert.deepStrictEqual(usuarios.map(u => u.usuario), ['admin'], 'solo admin: las cuentas de ejemplo de biblioteca no vuelven');
  } finally { s.parar(); }
});
