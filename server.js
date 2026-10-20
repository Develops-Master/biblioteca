/* =========================================================================
   SIGIE — Servidor local de datos
   -------------------------------------------------------------------------
   Este archivo NO depende de ningún paquete externo (no hace falta
   "npm install"): usa solo módulos que ya vienen incluidos con Node.js
   (http, fs, path). Así, con tener Node.js instalado, alcanza para
   arrancar el sistema.

   © 2026 Luis Hider Manco Berrocal — CIST. Todos los derechos reservados.

   Qué hace:
   1) Sirve los archivos del sistema (index.html, login.html, core.js,
      app.js, login.js, styles.css) como si fuera una página web normal,
      pero corriendo en esta misma computadora (http://localhost:3000).
   2) Expone una pequeña API (/api/db/...) que el sistema usa para GUARDAR
      y LEER todos sus datos.
   3) Todo lo que se guarda queda escrito en el archivo:
        data/sigie.db   (base de datos SQLite)
      dentro de esta MISMA carpeta. Por eso, si copian toda la carpeta del
      sistema (incluida la subcarpeta "data") a otra computadora y vuelven
      a iniciar el servidor ahí, el inventario completo viaja con ella.
   4) Crea un respaldo diario de la base en data/backups/ (se quedan los
      últimos 30), como red de protección adicional a los respaldos manuales.
   ========================================================================= */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Opac = require('./opac-util.js');
const Dip = require('./diplomas-util.js'); // verificación pública de diplomas (misma lógica que el navegador)

const PORT = process.env.PORT || 3000;
// -------------------------------------------------------------------------
// SEGURIDAD (v8): la API de datos exige iniciar sesión. El login lo valida
// ESTE servidor (no el navegador): al entrar correctamente se entrega una
// cookie de sesión HttpOnly + SameSite=Strict que JavaScript no puede leer.
// Los hashes de contraseña NUNCA salen del servidor.
//
// Por defecto el servidor sigue escuchando SOLO en esta computadora
// (127.0.0.1). Si necesitas que otras PC de la red usen este mismo servidor:
//   (Windows)   set SIGIE_LAN=1 && node server.js
//   (Mac/Linux) SIGIE_LAN=1 node server.js
// En ese modo ya NO se puede leer ni escribir sin usuario y contraseña,
// pero el tráfico viaja por HTTP sin cifrar dentro de tu red (las contraseñas
// se ven en texto claro para quien espíe esa red). Úsalo solo en redes de
// confianza, o pon un proxy HTTPS delante.
// -------------------------------------------------------------------------
const EXPONER_EN_RED = process.env.SIGIE_LAN === '1';
const HOST = EXPONER_EN_RED ? '0.0.0.0' : '127.0.0.1';
const RAIZ = __dirname;
const CARPETA_DATOS = process.env.SIGIE_DATA_DIR ? path.resolve(process.env.SIGIE_DATA_DIR) : path.join(RAIZ, 'data');
const ARCHIVO_DB = path.join(CARPETA_DATOS, 'sigie.db');                 // base de datos SQLite
const ARCHIVO_JSON_ANTIGUO = path.join(CARPETA_DATOS, 'sigie-datos.json'); // formato de versiones anteriores
const CARPETA_BACKUPS = path.join(CARPETA_DATOS, 'backups');
const MAX_BACKUPS = 30;
// Copia EXTERNA del respaldo diario (USB, disco de red, carpeta sincronizada). Si el disco de la PC falla,
// los respaldos de data/backups/ se pierden junto con la base: esta copia vive en otro lugar.
//   (Windows)   set SIGIE_BACKUP_DIR=E:\Respaldos-SIGIE && node server.js
const CARPETA_BACKUP_EXTERNO = process.env.SIGIE_BACKUP_DIR ? path.resolve(process.env.SIGIE_BACKUP_DIR) : '';

// Sesiones y contraseñas
const SESION_HORAS = 12;                 // una sesión inactiva por más de esto se cierra
const COOKIE_SESION = 'sigie_sid';
const PBKDF2_ITER = 150000;              // igual que core.js: las cuentas existentes siguen funcionando
const PASS_MIN_LARGO = 8;
const ROLES = ['ADMIN', 'ADMIN2', 'DOCENTE', 'CONSULTA'];
const CLAVE_USUARIOS = 'sigie:usuarios';
const CLAVE_BITACORA = 'sigie:bitacora';
const CLAVE_SEMILLA_BIB = 'sigie:bib_usuarios_semilla';
const PREFIJO_IMAGENES = 'sigie:imagenes:';

/* ---------------------------------------------------------------------
   0. BASE DE DATOS LOCAL (SQLite, incluida en Node.js 22+ — sin instalar nada)
   -------------------------------------------------------------------------
   Todo el inventario vive en un único archivo: data/sigie.db
   - Modo WAL + synchronous=FULL: si la PC se apaga de golpe, no se corrompe.
   - Cada guardado es una transacción atómica (todo o nada).
   - Si existe un data/sigie-datos.json de una versión anterior, se importa
     automáticamente la primera vez y se conserva como sigie-datos.json.migrado.
   --------------------------------------------------------------------- */
if (!fs.existsSync(CARPETA_DATOS)) fs.mkdirSync(CARPETA_DATOS, { recursive: true });
if (!fs.existsSync(CARPETA_BACKUPS)) fs.mkdirSync(CARPETA_BACKUPS, { recursive: true });

// Solo claves "normales" del sistema (sigie:...). Evita claves como __proto__.
const CLAVE_VALIDA = /^[A-Za-z0-9_:.\-]{1,200}$/;
function claveOk(key) {
  return typeof key === 'string' && CLAVE_VALIDA.test(key) && key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

// Silencia solo el aviso "ExperimentalWarning" de SQLite (el módulo es estable para este uso).
const _emitWarning = process.emitWarning;
process.emitWarning = function (w, ...args) {
  const tipo = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].type);
  if (tipo === 'ExperimentalWarning' && /SQLite/i.test(String(w))) return;
  return _emitWarning.call(process, w, ...args);
};

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  console.error('');
  console.error('❌ Esta versión de Node.js (' + process.version + ') no incluye la base de datos SQLite.');
  console.error('   SIGIE necesita Node.js 22.13 o superior. Instala la versión "LTS" desde https://nodejs.org');
  console.error('   y vuelve a iniciar el sistema. (Tus datos no se tocaron.)');
  console.error('');
  process.exit(1);
}
const db = new DatabaseSync(ARCHIVO_DB);
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
db.exec(`CREATE TABLE IF NOT EXISTS kv (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  actualizado TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1
) WITHOUT ROWID`);
// Bases creadas con versiones anteriores no tienen la columna "version": se agrega sola.
if (!db.prepare('PRAGMA table_info(kv)').all().some(c => c.name === 'version')) {
  db.exec('ALTER TABLE kv ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
}
db.exec(`CREATE TABLE IF NOT EXISTS sesiones (
  token_hash TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  creada     INTEGER NOT NULL,
  expira     INTEGER NOT NULL,
  ip         TEXT
) WITHOUT ROWID`);

const stGet = db.prepare('SELECT value, version FROM kv WHERE key = ?');
// version = versión anterior + 1 (la primera vez queda en 1). RETURNING nos da la nueva.
const stPut = db.prepare(`INSERT INTO kv (key, value, actualizado, version) VALUES (?, ?, ?, 1)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, actualizado = excluded.actualizado, version = kv.version + 1
  RETURNING version`);
const stDel = db.prepare('DELETE FROM kv WHERE key = ?');
const stListTodo = db.prepare('SELECT key FROM kv ORDER BY key');
const stListPrefijo = db.prepare('SELECT key FROM kv WHERE substr(key, 1, ?) = ? ORDER BY key');
const stVersionesTodo = db.prepare('SELECT key, version FROM kv');
const stVersionesPrefijo = db.prepare('SELECT key, version FROM kv WHERE substr(key, 1, ?) = ?');
const stCuenta = db.prepare('SELECT COUNT(*) AS n FROM kv');

const stSesionNueva = db.prepare('INSERT INTO sesiones (token_hash, usuario_id, creada, expira, ip) VALUES (?, ?, ?, ?, ?)');
const stSesionGet = db.prepare('SELECT token_hash, usuario_id, expira FROM sesiones WHERE token_hash = ?');
const stSesionRenovar = db.prepare('UPDATE sesiones SET expira = ? WHERE token_hash = ?');
const stSesionBorrar = db.prepare('DELETE FROM sesiones WHERE token_hash = ?');
const stSesionBorrarUsuario = db.prepare('DELETE FROM sesiones WHERE usuario_id = ?');
const stSesionBorrarOtras = db.prepare('DELETE FROM sesiones WHERE usuario_id = ? AND token_hash <> ?');
const stSesionLimpiar = db.prepare('DELETE FROM sesiones WHERE expira < ?');

function importarJSONAntiguoSiCorresponde() {
  if (stCuenta.get().n > 0 || !fs.existsSync(ARCHIVO_JSON_ANTIGUO)) return;
  let datos;
  try {
    datos = JSON.parse(fs.readFileSync(ARCHIVO_JSON_ANTIGUO, 'utf8'));
  } catch (e) {
    console.error('⚠️  No se pudo leer data/sigie-datos.json (¿archivo dañado?). Se conserva una copia como sigie-datos.json.CORRUPTO y se empieza con una base nueva.');
    try { fs.copyFileSync(ARCHIVO_JSON_ANTIGUO, ARCHIVO_JSON_ANTIGUO + '.CORRUPTO'); } catch (e2) {}
    return;
  }
  const ahora = new Date().toISOString();
  let n = 0;
  db.exec('BEGIN');
  try {
    for (const [k, v] of Object.entries(datos)) {
      if (!claveOk(k)) continue;
      stPut.run(k, JSON.stringify(v === undefined ? null : v), ahora);
      n++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('❌ Falló la importación de data/sigie-datos.json:', e.message);
    process.exit(1);
  }
  try { fs.renameSync(ARCHIVO_JSON_ANTIGUO, ARCHIVO_JSON_ANTIGUO + '.migrado'); } catch (e) {}
  console.log('✅ Se importaron ' + n + ' registros del archivo JSON anterior a la base de datos SQLite.');
}

let ultimoBackupFecha = '';
// Estado de la copia externa (solo en memoria): lo muestra /api/respaldos y avisa si falló.
const estadoExterno = { configurado: !!CARPETA_BACKUP_EXTERNO, ok: null, fecha: '', archivo: '', error: '' };
function copiarRespaldoExterno(origen) {
  if (!CARPETA_BACKUP_EXTERNO) return;
  try {
    if (!fs.existsSync(CARPETA_BACKUP_EXTERNO)) fs.mkdirSync(CARPETA_BACKUP_EXTERNO, { recursive: true });
    const destino = path.join(CARPETA_BACKUP_EXTERNO, path.basename(origen));
    fs.copyFileSync(origen, destino);
    const nombres = fs.readdirSync(CARPETA_BACKUP_EXTERNO).filter(f => /^sigie-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
    while (nombres.length > MAX_BACKUPS) fs.unlinkSync(path.join(CARPETA_BACKUP_EXTERNO, nombres.shift()));
    Object.assign(estadoExterno, { ok: true, fecha: new Date().toISOString(), archivo: path.basename(origen), error: '' });
  } catch (e) {
    Object.assign(estadoExterno, { ok: false, fecha: new Date().toISOString(), error: String(e && e.message || e).slice(0, 200) });
  }
}
function backupDiarioSiCorresponde() {
  const hoy = new Date().toISOString().slice(0, 10);
  if (hoy === ultimoBackupFecha) return;
  ultimoBackupFecha = hoy;
  try {
    const destino = path.join(CARPETA_BACKUPS, `sigie-${hoy}.db`);
    if (!fs.existsSync(destino)) {
      // VACUUM INTO crea una copia consistente de la base aunque esté en uso.
      db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
    }
    copiarRespaldoExterno(destino);
    // Limpieza: conserva solo los últimos MAX_BACKUPS respaldos .db
    const archivos = fs.readdirSync(CARPETA_BACKUPS)
      .filter(f => /^sigie-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort();
    while (archivos.length > MAX_BACKUPS) {
      fs.unlinkSync(path.join(CARPETA_BACKUPS, archivos.shift()));
    }
  } catch (e) { /* un backup fallido nunca debe romper el guardado real */ }
}

function cerrarBaseDeDatos() {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch (e) {}
}
process.on('SIGINT', () => { cerrarBaseDeDatos(); process.exit(0); });
process.on('SIGTERM', () => { cerrarBaseDeDatos(); process.exit(0); });

importarJSONAntiguoSiCorresponde();
backupDiarioSiCorresponde();

/* ---------------------------------------------------------------------
   1. API DE BASE DE DATOS (clave -> valor), usada por core.js
   --------------------------------------------------------------------- */
function enviarJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.setHeader('Cache-Control', 'no-store'); // datos y sesión: nunca en caché del navegador ni de proxies
  res.writeHead(status);
  res.end(body);
}

function leerCuerpo(req, limite) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let total = 0;
    const LIMITE = limite || 200 * 1024 * 1024; // 200 MB por si guardan muchas fotos (login/contraseña: 10 KB)
    req.on('data', (c) => {
      total += c.length;
      if (total > LIMITE) { req.destroy(); reject(new Error('Cuerpo demasiado grande')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* ---------------------------------------------------------------------
   1-bis. LÍMITE DE PETICIONES POR IP ("rate limit")
   -------------------------------------------------------------------------
   El límite de 200 MB de leerCuerpo() evita que UNA petición gigante tumbe
   el servidor, pero no evita que lleguen MUCHAS peticiones seguidas (por
   error de programación en el navegador, o de alguien probando cosas si el
   servidor está en modo SIGIE_LAN=1). Cada escritura reescribe el archivo
   completo de la base de datos, así que un bucle de peticiones podría
   llenar el disco o dejar el servidor sin responder a usuarios reales.

   Se guarda, por IP, la marca de tiempo de sus últimas peticiones a la API
   en los últimos VENTANA_MS milisegundos. Si supera MAX_PETICIONES en ese
   lapso, se responde 429 sin llegar a tocar disco. El límite es generoso a
   propósito: al abrir el sistema se cargan ~30 claves en paralelo, así que
   no debe molestar el uso normal, solo un bucle fuera de control.
   --------------------------------------------------------------------- */
const VENTANA_MS = 10 * 1000; // 10 segundos
const MAX_PETICIONES = 200;   // hasta 200 peticiones a la API por IP cada 10s
const peticionesPorIP = new Map(); // ip -> [timestamps]

function demasiadasPeticiones(ip) {
  const ahora = Date.now();
  const historial = (peticionesPorIP.get(ip) || []).filter(t => ahora - t < VENTANA_MS);
  historial.push(ahora);
  peticionesPorIP.set(ip, historial);
  return historial.length > MAX_PETICIONES;
}

// La verificación de diplomas es pública (la usa quien escanea el QR): se limita más para que nadie pueda
// probar códigos al azar. El espacio de códigos es de ~8·10^11, así que 30 intentos por minuto no sirven de nada.
const intentosVerificar = new Map(); // ip -> [timestamps]
function verificacionExcedida(ip) {
  const ahora = Date.now();
  const h = (intentosVerificar.get(ip) || []).filter(t => ahora - t < 60 * 1000);
  h.push(ahora); intentosVerificar.set(ip, h);
  if (intentosVerificar.size > 5000) intentosVerificar.clear();
  return h.length > 30;
}

const limitadorReservas = Opac.crearLimitador(); // intentos fallidos de las reservas del OPAC (por código de lector y por IP)

// Limpieza periódica para no acumular IPs viejas en memoria indefinidamente.
setInterval(() => {
  const ahora = Date.now();
  for (const [ip, historial] of peticionesPorIP) {
    const vigente = historial.filter(t => ahora - t < VENTANA_MS);
    if (vigente.length === 0) peticionesPorIP.delete(ip);
    else peticionesPorIP.set(ip, vigente);
  }
}, 60 * 1000).unref();

/* ---------------------------------------------------------------------
   Protección contra "DNS rebinding" y peticiones desde otras webs (CSRF):
   - En modo solo-local, el encabezado Host debe ser localhost / 127.0.0.1.
   - Si el navegador envía Origin, debe coincidir con el Host al que se pidió
     (es decir, la petición debe venir de esta misma página del sistema).
   Así, una página web externa abierta en el navegador del colegio no puede
   leer ni borrar el inventario a través de http://localhost:3000/api.
   --------------------------------------------------------------------- */
function origenValido(req) {
  const host = (req.headers.host || '').toLowerCase();
  if (!host) return false;
  if (!EXPONER_EN_RED) {
    const nombre = host.replace(/:\d+$/, '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(nombre)) return false;
  }
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host.toLowerCase() !== host) return false; }
    catch (e) { return false; }
  }
  return true;
}

/* ---------------------------------------------------------------------
   1-ter. VALORES LÓGICOS, USUARIOS, CONTRASEÑAS Y SESIONES
   -------------------------------------------------------------------------
   Formato de almacenamiento (sin cambios respecto a versiones anteriores):
   el navegador guarda cada clave como un TEXTO JSON, y la base guarda ese
   texto envuelto otra vez con JSON.stringify. Estas funciones lo leen y
   escriben igual, para que los datos viejos sigan sirviendo.
   --------------------------------------------------------------------- */
function leerLogico(key, defecto) {
  const f = stGet.get(key);
  if (!f) return defecto;
  try {
    let v = JSON.parse(f.value);
    if (typeof v === 'string') v = JSON.parse(v);
    return v === null || v === undefined ? defecto : v;
  } catch (e) { return defecto; }
}
function escribirLogico(key, obj) {
  backupDiarioSiCorresponde();
  return stPut.get(key, JSON.stringify(JSON.stringify(obj)), new Date().toISOString()).version;
}

function nuevoId(prefijo) { return prefijo + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function leerUsuarios() { const u = leerLogico(CLAVE_USUARIOS, []); return Array.isArray(u) ? u : []; }
function usuarioPublico(u) { const { hash, salt, algo, nuevaClave, ...resto } = u; return resto; }
function sesionDe(u) { return { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, aulaIds: u.aulaIds || [] }; }

function pbkdf2Async(texto, salt) {
  return new Promise((resolve, reject) => crypto.pbkdf2(texto, salt, PBKDF2_ITER, 32, 'sha256', (e, b) => e ? reject(e) : resolve(b.toString('hex'))));
}
async function crearCredencial(pass) {
  const salt = crypto.randomBytes(12).toString('hex');
  return { salt, hash: await pbkdf2Async(pass, salt), algo: 'pbkdf2' };
}
function iguales(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
async function verificarClave(u, pass) {
  if (!u || !u.salt || !u.hash) { await pbkdf2Async(pass, 'relleno-tiempo-constante'); return false; }
  const calculado = u.algo === 'pbkdf2'
    ? await pbkdf2Async(pass, u.salt)
    : crypto.createHash('sha256').update(pass + u.salt).digest('hex'); // formato de las primeras versiones
  return iguales(calculado, u.hash);
}
function errorClaveNueva(pass) {
  if (typeof pass !== 'string' || pass.length < PASS_MIN_LARGO) return 'La contraseña debe tener al menos ' + PASS_MIN_LARGO + ' caracteres.';
  if (pass.length > 200) return 'La contraseña es demasiado larga.';
  if (['admin123', '12345678', 'password', 'contraseña', 'contrasena'].includes(pass.toLowerCase())) return 'Esa contraseña es demasiado común. Elige otra.';
  return '';
}

// Bitácora de auditoría escrita por el propio servidor (inicios de sesión, intentos fallidos…).
function bitacoraServidor(accion, detalle, usuario, rol) {
  try {
    const log = leerLogico(CLAVE_BITACORA, []);
    let nuevo = [...(Array.isArray(log) ? log : []), { id: nuevoId('log'), fecha: new Date().toISOString(), usuario: usuario || '—', rol: rol || '—', accion, detalle: detalle || '' }];
    if (nuevo.length > 3000) nuevo = nuevo.slice(nuevo.length - 3000);
    escribirLogico(CLAVE_BITACORA, nuevo);
  } catch (e) { /* la bitácora nunca debe impedir iniciar sesión */ }
}

// Cuentas iniciales. Antes las creaba el navegador; ahora, como la API exige sesión, las crea el servidor.
async function sembrarUsuariosIniciales() {
  let users = leerUsuarios();
  let cambio = false;
  if (users.length === 0) {
    users = [{ id: nuevoId('usr'), usuario: 'admin', nombre: 'Coordinador de Innovación y Soporte Tecnológico (CIST)', rol: 'ADMIN', aulaIds: [], ...(await crearCredencial('admin123')), debeCambiarPass: true }];
    cambio = true;
  }
  if (leerLogico(CLAVE_SEMILLA_BIB, false) !== true) {
    const base = [
      ['biblioteca', 'Bibliotecario(a) responsable', 'ADMIN2', 'Biblio2026'],
      ['docente', 'Docente (registra préstamos)', 'DOCENTE', 'Docente2026'],
      ['consulta', 'Solo consulta', 'CONSULTA', 'Consulta2026']
    ];
    for (const [usuario, nombre, rol, pass] of base) {
      if (users.some(u => u.usuario === usuario)) continue;
      users.push({ id: nuevoId('usr'), usuario, nombre, rol, aulaIds: [], ...(await crearCredencial(pass)), debeCambiarPass: true });
    }
    escribirLogico(CLAVE_SEMILLA_BIB, true);
    cambio = true;
  }
  if (cambio) escribirLogico(CLAVE_USUARIOS, users);
}

/* ----- Sesiones ----- */
function hashToken(t) { return crypto.createHash('sha256').update(t).digest('hex'); }
function leerCookie(req, nombre) {
  const c = req.headers.cookie || '';
  for (const parte of c.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nombre) return parte.slice(i + 1).trim();
  }
  return '';
}
function cabeceraCookie(req, token, maxAge) {
  const seguro = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
  return COOKIE_SESION + '=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + maxAge + (seguro ? '; Secure' : '');
}
function crearSesion(req, usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  const ahora = Date.now();
  stSesionNueva.run(hashToken(token), usuarioId, ahora, ahora + SESION_HORAS * 3600 * 1000, req.socket.remoteAddress || '');
  return token;
}
// Devuelve { token, usuario } si la cookie corresponde a una sesión vigente de un usuario que SIGUE existiendo.
function autenticar(req) {
  const token = leerCookie(req, COOKIE_SESION);
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const h = hashToken(token);
  const s = stSesionGet.get(h);
  if (!s) return null;
  const ahora = Date.now();
  if (s.expira < ahora) { stSesionBorrar.run(h); return null; }
  const u = leerUsuarios().find(x => x.id === s.usuario_id);
  if (!u) { stSesionBorrar.run(h); return null; }
  // sesión deslizante: se renueva con el uso (como máximo una vez por minuto)
  if (s.expira - ahora < (SESION_HORAS * 3600 * 1000) - 60 * 1000) stSesionRenovar.run(ahora + SESION_HORAS * 3600 * 1000, h);
  return { token, hash: h, usuario: u };
}
setInterval(() => { try { stSesionLimpiar.run(Date.now()); } catch (e) {} }, 60 * 60 * 1000).unref();
try { stSesionLimpiar.run(Date.now()); } catch (e) {}

/* ----- Freno a intentos de login (ahora en el servidor, no en el navegador) ----- */
const LOGIN_MAX_INTENTOS = 5;
const LOGIN_BLOQUEO_MS = 60 * 1000;
const intentosLogin = new Map();       // "ip|usuario" -> { n, hasta }
const fallosPorIP = new Map();         // ip -> [timestamps de fallos]
const FALLOS_IP_MAX = 20, FALLOS_IP_VENTANA = 5 * 60 * 1000;
function segundosBloqueo(ip, usuario) {
  const ahora = Date.now();
  const a = intentosLogin.get(ip + '|' + usuario);
  let resto = a && a.hasta > ahora ? a.hasta - ahora : 0;
  const f = (fallosPorIP.get(ip) || []).filter(t => ahora - t < FALLOS_IP_VENTANA);
  if (f.length >= FALLOS_IP_MAX) resto = Math.max(resto, FALLOS_IP_VENTANA - (ahora - f[0]));
  return Math.ceil(resto / 1000);
}
function registrarFallo(ip, usuario) {
  const ahora = Date.now();
  const k = ip + '|' + usuario;
  const a = intentosLogin.get(k) || { n: 0, hasta: 0 };
  a.n++;
  if (a.n >= LOGIN_MAX_INTENTOS) { a.hasta = ahora + LOGIN_BLOQUEO_MS; a.n = 0; }
  intentosLogin.set(k, a);
  const f = (fallosPorIP.get(ip) || []).filter(t => ahora - t < FALLOS_IP_VENTANA); f.push(ahora); fallosPorIP.set(ip, f);
}
setInterval(() => {
  const ahora = Date.now();
  for (const [k, a] of intentosLogin) if (a.hasta < ahora && a.n === 0) intentosLogin.delete(k);
  for (const [ip, f] of fallosPorIP) { const v = f.filter(t => ahora - t < FALLOS_IP_VENTANA); if (v.length) fallosPorIP.set(ip, v); else fallosPorIP.delete(ip); }
}, 60 * 1000).unref();

/* ----- Validación de la lista de usuarios que envía un administrador ----- */
// Devuelve { error } o { lista } ya lista para guardar (con las credenciales intactas o recién hasheadas).
async function procesarUsuariosEntrantes(texto, solicitante) {
  let arr;
  try { arr = JSON.parse(texto); } catch (e) { return { error: 'Lista de usuarios inválida.' }; }
  if (!Array.isArray(arr)) return { error: 'Lista de usuarios inválida.' };
  const previos = new Map(leerUsuarios().map(u => [u.id, u]));
  const lista = [];
  const nombresVistos = new Set();
  for (const u of arr) {
    if (!u || typeof u !== 'object' || typeof u.id !== 'string' || !u.id) return { error: 'Usuario sin identificador.' };
    const usuario = String(u.usuario || '').trim();
    if (!/^[A-Za-z0-9_.@\-]{1,60}$/.test(usuario)) return { error: 'Nombre de usuario inválido: "' + usuario + '".' };
    if (nombresVistos.has(usuario.toLowerCase())) return { error: 'Usuario repetido: ' + usuario + '.' };
    nombresVistos.add(usuario.toLowerCase());
    if (!ROLES.includes(u.rol)) return { error: 'Rol inválido para ' + usuario + '.' };
    const prev = previos.get(u.id);
    const limpio = { ...(prev || {}), id: u.id, usuario, nombre: String(u.nombre || '').slice(0, 200), rol: u.rol,
      aulaIds: Array.isArray(u.aulaIds) ? u.aulaIds.filter(x => typeof x === 'string') : [], debeCambiarPass: !!u.debeCambiarPass };
    delete limpio.nuevaClave;
    if (typeof u.nuevaClave === 'string' && u.nuevaClave) {
      const e = errorClaveNueva(u.nuevaClave);
      if (e) return { error: e };
      Object.assign(limpio, await crearCredencial(u.nuevaClave));
    } else if (!prev || !prev.hash) {
      return { error: 'El usuario ' + usuario + ' necesita una contraseña.' };
    }
    lista.push(limpio);
  }
  if (lista.length > 0) {
    if (!lista.some(u => u.rol === 'ADMIN')) return { error: 'Debe quedar al menos un usuario ADMIN.' };
    if (!lista.some(u => u.id === solicitante.id)) return { error: 'No puedes eliminar tu propia cuenta.' };
  }
  return { lista };
}

async function manejarAPI(req, res, url) {
  const ip = req.socket.remoteAddress || 'desconocida';
  if (!origenValido(req)) {
    return enviarJSON(res, 403, { error: 'Origen no permitido.' });
  }
  if (demasiadasPeticiones(ip)) {
    return enviarJSON(res, 429, { error: 'Demasiadas peticiones en poco tiempo. Espera unos segundos e intenta de nuevo.' });
  }
  const ruta = url.pathname;

  // ---- Públicas ----
  if (req.method === 'GET' && ruta === '/api/health') {
    // Sin rutas de archivos ni cantidad de registros: eso solo se muestra a quien inició sesión.
    return enviarJSON(res, 200, { ok: true, modo: 'servidor-local', motor: 'sqlite', auth: true });
  }

  // Catálogo público (OPAC): solo datos de los libros; jamás lectores, DNI ni nombres de quien tiene el libro.
  if (req.method === 'GET' && ruta === '/api/opac') {
    if (verificacionExcedida(ip)) return enviarJSON(res, 429, { error: 'Demasiadas consultas. Espera un minuto.' });
    const cfg = leerLogico('sigie:config', {}) || {};
    res.setHeader('Cache-Control', 'no-store');
    return enviarJSON(res, 200, Opac.construir({ libros: leerLogico('sigie:bib_libros', []), cats: leerLogico('sigie:bib_categorias', []), prest: leerLogico('sigie:bib_prestamos', []), res: leerLogico('sigie:bib_reservas', []), bcfg: leerLogico('sigie:bib_config', {}) || {}, cfg }));
  }

  // Reserva desde el catálogo público: se identifica con código LEC + 4 últimos dígitos del DNI. Solo agrega una reserva en espera.
  if (req.method === 'POST' && ruta === '/api/opac/reservar') {
    let c;
    try { c = JSON.parse(await leerCuerpo(req, 2 * 1024)); } catch (e) { return enviarJSON(res, 400, { error: 'Solicitud inválida.' }); }
    const cod = String((c && c.cod) || '').trim().toUpperCase().slice(0, 20);
    const seg = limitadorReservas.segundos(ip, cod);
    if (seg > 0) return enviarJSON(res, 429, { error: 'Demasiados intentos fallidos. Espera ' + Math.ceil(seg / 60) + ' minuto(s) e intenta de nuevo.' });
    const lista = x => { const v = leerLogico(x, []); return Array.isArray(v) ? v : []; };
    const r = Opac.reservar({ libros: lista('sigie:bib_libros'), prest: lista('sigie:bib_prestamos'), res: lista('sigie:bib_reservas'), lect: lista('sigie:bib_lectores'), bcfg: leerLogico('sigie:bib_config', {}) || {} },
      { libroId: String((c && c.libroId) || '').slice(0, 80), cod, clave: String((c && c.clave) || '').slice(0, 20) }, new Date().toISOString().slice(0, 10), nuevoId);
    if (!r.ok) {
      if (r.codigo === 'CREDENCIALES') { limitadorReservas.fallo(ip, cod); bitacoraServidor('Reserva OPAC rechazada', 'Código o clave incorrectos (' + cod + ')', 'OPAC', '—'); }
      return enviarJSON(res, r.codigo === 'CREDENCIALES' ? 401 : 409, { error: r.error, codigo: r.codigo });
    }
    limitadorReservas.acierto(ip, cod);
    escribirLogico('sigie:bib_reservas', [...lista('sigie:bib_reservas'), r.reserva]);
    bitacoraServidor('Reserva desde el catálogo', r.reserva.lector + ' · ' + r.titulo, 'OPAC', '—');
    return enviarJSON(res, 200, { ok: true, puesto: r.puesto, titulo: r.titulo });
  }

  // Verificación pública de diplomas (sin sesión): solo dice si el código es auténtico y muestra el nombre enmascarado.
  if (req.method === 'GET' && ruta === '/api/verificar') {
    if (verificacionExcedida(ip)) return enviarJSON(res, 429, { error: 'Demasiadas consultas. Espera un minuto.' });
    const diplomas = leerLogico('sigie:bib_diplomas', []);
    const cfg = leerLogico('sigie:config', {}) || {};
    res.setHeader('Cache-Control', 'no-store');
    return enviarJSON(res, 200, Dip.verificarDiploma(Array.isArray(diplomas) ? diplomas : [], String(url.searchParams.get('c') || '').slice(0, 300), { nombreIE: cfg.nombreIE || '' }));
  }

  if (req.method === 'POST' && ruta === '/api/login') {
    let c;
    try { c = JSON.parse(await leerCuerpo(req, 10 * 1024)); } catch (e) { return enviarJSON(res, 400, { error: 'Solicitud inválida.' }); }
    const usuario = String((c && c.usuario) || '').trim();
    const pass = typeof (c && c.password) === 'string' ? c.password : '';
    if (!usuario || !pass || usuario.length > 100 || pass.length > 200) return enviarJSON(res, 400, { error: 'Ingresa usuario y contraseña.' });
    const clave = usuario.toLowerCase();
    const espera = segundosBloqueo(ip, clave);
    if (espera > 0) return enviarJSON(res, 429, { error: 'Demasiados intentos fallidos. Espera ' + espera + ' segundo(s) antes de volver a intentar.', segundos: espera });

    await sembrarUsuariosIniciales(); // si el sistema se reinició y no quedan usuarios, vuelve a crear "admin"
    const users = leerUsuarios();
    const u = users.find(x => String(x.usuario).toLowerCase() === clave);
    const MSG = { error: 'Usuario o contraseña incorrectos.' };
    if (!u) { await verificarClave(null, pass); registrarFallo(ip, clave); bitacoraServidor('Intento de acceso fallido', 'Usuario no encontrado: ' + usuario, usuario, '—'); return enviarJSON(res, 401, MSG); }
    if (!(await verificarClave(u, pass))) { registrarFallo(ip, clave); bitacoraServidor('Intento de acceso fallido', 'Contraseña incorrecta para: ' + u.usuario, u.usuario, u.rol); return enviarJSON(res, 401, MSG); }
    intentosLogin.delete(ip + '|' + clave);

    // Migración silenciosa de hashes antiguos (SHA-256 simple) a PBKDF2, y cambio forzado de la clave de fábrica.
    let mod = false, actual = u;
    if (u.algo !== 'pbkdf2') { actual = { ...actual, ...(await crearCredencial(pass)) }; mod = true; }
    if (pass === 'admin123' && !actual.debeCambiarPass) { actual = { ...actual, debeCambiarPass: true }; mod = true; }
    if (mod) escribirLogico(CLAVE_USUARIOS, leerUsuarios().map(x => x.id === actual.id ? actual : x));

    const token = crearSesion(req, actual.id);
    bitacoraServidor('Inicio de sesión', '', actual.nombre || actual.usuario, actual.rol);
    res.setHeader('Set-Cookie', cabeceraCookie(req, token, SESION_HORAS * 3600));
    return enviarJSON(res, 200, { ok: true, debeCambiarPass: !!actual.debeCambiarPass, sesion: sesionDe(actual) });
  }

  // ---- A partir de aquí TODO exige sesión ----
  const auth = autenticar(req);
  if (!auth) return enviarJSON(res, 401, { error: 'Debes iniciar sesión.', codigo: 'SIN_SESION' });
  const yo = auth.usuario;

  if (req.method === 'GET' && ruta === '/api/session') {
    return enviarJSON(res, 200, { ok: true, debeCambiarPass: !!yo.debeCambiarPass, sesion: sesionDe(yo) });
  }

  if (req.method === 'POST' && ruta === '/api/logout') {
    stSesionBorrar.run(auth.hash);
    bitacoraServidor('Cierre de sesión', '', yo.nombre || yo.usuario, yo.rol);
    res.setHeader('Set-Cookie', cabeceraCookie(req, '', 0));
    return enviarJSON(res, 200, { ok: true });
  }

  if (req.method === 'POST' && ruta === '/api/password') {
    let c;
    try { c = JSON.parse(await leerCuerpo(req, 10 * 1024)); } catch (e) { return enviarJSON(res, 400, { error: 'Solicitud inválida.' }); }
    const nueva = c && c.nueva;
    // Si ya tenía una contraseña definitiva, exige la actual (evita que alguien con la PC desbloqueada la cambie).
    if (!yo.debeCambiarPass && !(await verificarClave(yo, String((c && c.actual) || '')))) return enviarJSON(res, 403, { error: 'La contraseña actual no es correcta.' });
    const e = errorClaveNueva(nueva);
    if (e) return enviarJSON(res, 400, { error: e });
    const cred = await crearCredencial(nueva);
    escribirLogico(CLAVE_USUARIOS, leerUsuarios().map(x => x.id === yo.id ? { ...x, ...cred, debeCambiarPass: false } : x));
    stSesionBorrarOtras.run(yo.id, auth.hash); // cerrar sesiones abiertas en otros equipos
    bitacoraServidor('Cambio de contraseña', yo.debeCambiarPass ? 'Cambio obligatorio de contraseña provisional: ' + yo.usuario : 'Cambio de contraseña: ' + yo.usuario, yo.nombre || yo.usuario, yo.rol);
    return enviarJSON(res, 200, { ok: true });
  }

  // Con contraseña provisional solo se puede cambiar la contraseña (rutas de arriba) o cerrar sesión.
  if (yo.debeCambiarPass) return enviarJSON(res, 403, { error: 'Debes cambiar tu contraseña provisional antes de continuar.', codigo: 'CAMBIO_CLAVE' });

  const puedeEscribir = yo.rol !== 'CONSULTA';
  const esAdmin = yo.rol === 'ADMIN' || yo.rol === 'ADMIN2';

  // ---- Estado de los respaldos (solo administradores) ----
  if (req.method === 'GET' && ruta === '/api/respaldos') {
    if (!esAdmin) return enviarJSON(res, 403, { error: 'Solo un administrador puede ver los respaldos.' });
    let locales = [];
    try {
      locales = fs.readdirSync(CARPETA_BACKUPS).filter(f => /^sigie-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse().slice(0, 10)
        .map(f => ({ nombre: f, fecha: f.slice(6, 16), bytes: fs.statSync(path.join(CARPETA_BACKUPS, f)).size }));
    } catch (e) { /* carpeta vacía */ }
    return enviarJSON(res, 200, { locales, ultimoLocal: locales[0] ? locales[0].fecha : '', externo: { ...estadoExterno, carpeta: CARPETA_BACKUP_EXTERNO } });
  }
  if (req.method === 'POST' && ruta === '/api/respaldos/copiar') {
    if (!esAdmin) return enviarJSON(res, 403, { error: 'Solo un administrador puede copiar respaldos.' });
    if (!CARPETA_BACKUP_EXTERNO) return enviarJSON(res, 400, { error: 'No hay carpeta externa configurada (variable SIGIE_BACKUP_DIR).' });
    const hoy = new Date().toISOString().slice(0, 10), destino = path.join(CARPETA_BACKUPS, `sigie-${hoy}.db`);
    try { if (!fs.existsSync(destino)) db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`); } catch (e) { return enviarJSON(res, 500, { error: 'No se pudo crear el respaldo: ' + e.message }); }
    copiarRespaldoExterno(destino);
    bitacoraServidor('Copia de respaldo a carpeta externa', estadoExterno.ok ? 'Correcta' : 'Falló: ' + estadoExterno.error, yo.nombre || yo.usuario, yo.rol);
    return enviarJSON(res, estadoExterno.ok ? 200 : 500, { ok: estadoExterno.ok, externo: { ...estadoExterno, carpeta: CARPETA_BACKUP_EXTERNO } });
  }

  // ---- Datos ----
  if (req.method === 'GET' && ruta === '/api/db/item') {
    const key = url.searchParams.get('key');
    if (!claveOk(key)) return enviarJSON(res, 400, { error: 'key inválida' });
    const fila = stGet.get(key);
    if (!fila) return enviarJSON(res, 404, { error: 'no encontrado' });
    let value = JSON.parse(fila.value);
    if (key === CLAVE_USUARIOS) value = JSON.stringify(leerUsuarios().map(usuarioPublico)); // los hashes nunca salen
    return enviarJSON(res, 200, { key, value, version: fila.version });
  }

  if (req.method === 'GET' && ruta === '/api/db/versions') {
    const prefix = url.searchParams.get('prefix') || '';
    const filas = prefix ? stVersionesPrefijo.all(prefix.length, prefix) : stVersionesTodo.all();
    const versions = {};
    for (const f of filas) versions[f.key] = f.version;
    return enviarJSON(res, 200, { versions });
  }

  if (req.method === 'PUT' && ruta === '/api/db/item') {
    if (!puedeEscribir) return enviarJSON(res, 403, { error: 'Tu rol es de solo consulta: no puedes guardar cambios.' });
    let cuerpo;
    try { cuerpo = JSON.parse(await leerCuerpo(req)); }
    catch (e) {
      if (e && e.message === 'Cuerpo demasiado grande') return enviarJSON(res, 413, { error: 'Datos demasiado grandes.' });
      return enviarJSON(res, 400, { error: 'JSON inválido' });
    }
    const { key, value, baseVersion } = cuerpo || {};
    if (!claveOk(key)) return enviarJSON(res, 400, { error: 'key inválida' });
    if (baseVersion !== undefined && baseVersion !== null && !(Number.isInteger(baseVersion) && baseVersion >= 0)) return enviarJSON(res, 400, { error: 'baseVersion inválida' });
    if (key === CLAVE_USUARIOS && yo.rol !== 'ADMIN') return enviarJSON(res, 403, { error: 'Solo un administrador (ADMIN) puede gestionar usuarios.' });

    let aGuardar = value === undefined ? null : value;
    if (key === CLAVE_USUARIOS) {
      if (typeof value !== 'string') return enviarJSON(res, 400, { error: 'Formato de usuarios inválido.' });
      const r = await procesarUsuariosEntrantes(value, yo);
      if (r.error) return enviarJSON(res, 400, { error: r.error });
      aGuardar = JSON.stringify(r.lista);
    }
    // Todo lo que sigue es síncrono: entre la comprobación de versión y la escritura no puede colarse otra petición.
    const actual = stGet.get(key);
    const vActual = actual ? actual.version : 0;
    if (baseVersion !== undefined && baseVersion !== null && baseVersion !== vActual) {
      let valorActual = actual ? JSON.parse(actual.value) : null;
      if (key === CLAVE_USUARIOS && actual) valorActual = JSON.stringify(leerUsuarios().map(usuarioPublico));
      return enviarJSON(res, 409, { error: 'Los datos cambiaron en el servidor desde que los leíste.', codigo: 'CONFLICTO', version: vActual, value: valorActual });
    }
    const idsAntes = key === CLAVE_USUARIOS ? leerUsuarios().map(u => u.id) : [];
    let version;
    try {
      backupDiarioSiCorresponde();
      version = stPut.get(key, JSON.stringify(aGuardar), new Date().toISOString()).version;
    } catch (e) {
      return enviarJSON(res, 500, { error: 'no se pudo escribir en la base de datos: ' + e.message });
    }
    if (key === CLAVE_USUARIOS) {
      // cuentas eliminadas → cerrar sus sesiones
      const ids = new Set(JSON.parse(aGuardar).map(u => u.id));
      for (const id of idsAntes) if (!ids.has(id)) stSesionBorrarUsuario.run(id);
    }
    return enviarJSON(res, 200, { key, version });
  }

  if (req.method === 'DELETE' && ruta === '/api/db/item') {
    const key = url.searchParams.get('key');
    if (!claveOk(key)) return enviarJSON(res, 400, { error: 'key inválida' });
    const permitido = key === CLAVE_USUARIOS ? yo.rol === 'ADMIN'
      : esAdmin || (yo.rol === 'DOCENTE' && key.startsWith(PREFIJO_IMAGENES));
    if (!permitido) return enviarJSON(res, 403, { error: 'No tienes permiso para borrar esos datos.' });
    try { backupDiarioSiCorresponde(); } catch (e) {}
    try { stDel.run(key); } catch (e) { return enviarJSON(res, 500, { error: 'no se pudo escribir en la base de datos: ' + e.message }); }
    return enviarJSON(res, 200, { key, deleted: true });
  }

  if (req.method === 'GET' && ruta === '/api/db/list') {
    const prefix = url.searchParams.get('prefix') || '';
    const keys = (prefix ? stListPrefijo.all(prefix.length, prefix) : stListTodo.all()).map(r => r.key);
    return enviarJSON(res, 200, { keys, prefix });
  }

  return enviarJSON(res, 404, { error: 'ruta de API no encontrada' });
}

/* ---------------------------------------------------------------------
   2. ARCHIVOS ESTÁTICOS (el sistema en sí)
   --------------------------------------------------------------------- */
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

// SEGURIDAD: solo se sirven estos archivos (los que el navegador necesita).
// Nunca se entregan data/ (la base de datos y sus backups), server.js, build.js,
// package.json, los lanzadores, la documentación ni archivos ocultos.
const ARCHIVOS_PUBLICOS = new Set([
  'index.html', 'login.html', 'modo-rapido.html', 'verificar.html', 'opac.html', 'opac.js', 'opac-util.js',
  'core.js', 'merge.js', 'bib-util.js', 'app.js', 'biblioteca.js', 'lectometro-util.js', 'diplomas-util.js', 'lectometro.js', 'diplomas.js', 'mejoras.js', 'panel-util.js', 'lectura-panel.js', 'coleccion-util.js', 'coleccion.js', 'ui-iconos.js', 'inicio-util.js', 'inicio.js', 'lectores-util.js', 'lectores.js', 'reservas-util.js', 'reservas.js', 'prestamos-util.js', 'prestamos.js', 'mostrador-util.js', 'mostrador.js', 'bajas-util.js', 'bajas.js', 'opac-panel.js', 'reportes-color-util.js', 'reportes-color.js', 'ejemplo.js', 'login.js', 'modo-rapido.js', 'sw.js',
  'styles.css', 'manifest.json', 'icon-192.png', 'icon-512.png'
]);

function servirArchivo(req, res, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath.split('?')[0]); }
  catch (e) { res.writeHead(400); return res.end('Solicitud inválida'); }
  if (rel === '/') rel = '/index.html';
  const nombre = rel.replace(/^\/+/, '');
  if (!ARCHIVOS_PUBLICOS.has(nombre)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('No encontrado');
  }
  const destino = path.join(RAIZ, nombre);
  fs.readFile(destino, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
    const ext = path.extname(destino).toLowerCase();
    const cabeceras = { 'Content-Type': TIPOS[ext] || 'application/octet-stream' };
    // El service worker y el manifest no deben quedar cacheados por el navegador para que las actualizaciones lleguen.
    if (nombre === 'sw.js' || nombre === 'manifest.json') cabeceras['Cache-Control'] = 'no-cache';
    res.writeHead(200, cabeceras);
    res.end(data);
  });
}

/* ---------------------------------------------------------------------
   3. SERVIDOR HTTP
   --------------------------------------------------------------------- */
const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  let url;
  try { url = new URL(req.url, `http://localhost:${PORT}`); }
  catch (e) { res.writeHead(400); return res.end('Solicitud inválida'); }
  if (url.pathname.startsWith('/api/')) {
    manejarAPI(req, res, url).catch((e) => enviarJSON(res, 500, { error: e.message }));
  } else {
    servirArchivo(req, res, url.pathname);
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('');
    console.error('❌ El puerto ' + PORT + ' ya está en uso por otro programa.');
    console.error('   Cierra lo que esté usando ese puerto o inicia este servidor con otro puerto, por ejemplo:');
    console.error('   (Windows)  set PORT=3001 && node server.js');
    console.error('');
    process.exit(1);
  } else {
    console.error('❌ Error del servidor:', e);
    process.exit(1);
  }
});

sembrarUsuariosIniciales().catch(e => console.error('⚠️  No se pudieron crear las cuentas iniciales:', e.message)).then(() => {
  server.listen(PORT, HOST, () => {
    console.log('=========================================================');
    console.log(' SIGIE — servidor local iniciado correctamente');
    console.log(' Base de datos (SQLite): ' + ARCHIVO_DB);
    console.log(' Abre en tu navegador: http://localhost:' + PORT + '/');
    console.log(' Acceso: la API exige usuario y contraseña (sesión en el servidor).');
    if (EXPONER_EN_RED) {
      console.log('');
      console.log(' ⚠️  MODO RED LOCAL ACTIVADO (SIGIE_LAN=1): otras computadoras de');
      console.log('    tu red pueden conectarse, pero deben iniciar sesión. El tráfico');
      console.log('    va por HTTP sin cifrar: úsalo solo en redes de confianza.');
    } else {
      console.log(' Modo: solo esta computadora (no accesible desde la red).');
    }
    console.log(' Para apagar el servidor: cierra esta ventana o presiona Ctrl+C');
    console.log('=========================================================');
  });
});
