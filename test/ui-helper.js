// Utilidades para probar las pantallas con jsdom contra el servidor REAL (sin navegador).
// jsdom es opcional: si no está instalado (npm install), las pruebas de pantalla se omiten.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

let jsdom = null;
try { jsdom = require('jsdom'); } catch (e) { /* sin jsdom */ }
const RAIZ = path.join(__dirname, '..');
let puerto = 5200 + Math.floor(Math.random() * 600);

async function iniciarServidor() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigie-ui-'));
  const p = puerto++;
  const hijo = spawn(process.execPath, [path.join(RAIZ, 'server.js')], { env: { ...process.env, PORT: String(p), SIGIE_DATA_DIR: dir }, stdio: 'ignore' });
  const url = 'http://127.0.0.1:' + p;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(url + '/api/health')).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 100)); }
  return { url, parar: () => { hijo.kill(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

const esperar = ms => new Promise(r => setTimeout(r, ms));
async function hasta(cond, ms = 15000, paso = 25) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { try { const v = cond(); if (v) return v; } catch (e) {} await esperar(paso); }
  throw new Error('Tiempo agotado esperando la condición: ' + String(cond).slice(0, 120));
}

// Abre una página del sistema en jsdom: scripts propios reales, sin red externa (los CDN se bloquean), con cookies compartidas.
async function abrir(url, pagina, jar, opciones = {}) {
  const errores = [];
  const vc = new jsdom.VirtualConsole();
  vc.on('jsdomError', e => { if (!/Not implemented: (navigation|window\.print|HTMLCanvasElement|window\.alert|window\.open)/i.test(String(e && e.message))) errores.push(String(e && (e.stack || e.message))); });
  vc.on('error', (...a) => errores.push('console.error: ' + a.join(' ')));
  class Cargador extends jsdom.ResourceLoader {
    fetch(u, o) { return u.startsWith(url) ? super.fetch(u, o) : Promise.resolve(Buffer.from('')); }   // CDN: vacío
  }
  const ventanas = [];
  const dom = await jsdom.JSDOM.fromURL(url + '/' + pagina, {
    runScripts: 'dangerously', resources: new Cargador(), pretendToBeVisual: true, cookieJar: jar, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = async (u, o = {}) => {
        const abs = new URL(u, w.location.href).href;
        const cookie = await jar.getCookieString(abs);
        const r = await fetch(abs, { ...o, headers: { ...(o.headers || {}), ...(cookie ? { Cookie: cookie } : {}) } });
        for (const sc of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) await jar.setCookie(sc, abs);
        return r;
      };
      w.confirm = () => true; w.alert = () => {}; w.prompt = () => '';
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
      // window.open de mentira: guarda la URL y el HTML que se le escribe (carnés, informes) para poder revisarlos.
      w.open = (u) => {
        const doc = { html: '', write(h) { this.html += h; }, close() {} };
        ventanas.push({ url: String(u), doc });
        return { document: doc, focus() {}, print() {}, close() {} };
      };
      w.HTMLCanvasElement.prototype.getContext = () => null;
      if (opciones.antes) opciones.antes(w);
    }
  });
  return { dom, w: dom.window, d: dom.window.document, errores, ventanas, // Espera a que terminen los guardados en curso (bitácora, etc.) antes de cerrar la ventana simulada.
    cerrar: async () => { try { await hasta(() => !dom.window.eval('typeof DB!=="undefined" && Object.values(DB.guardando).some(n => n > 0)'), 3000); } catch (e) {} dom.window.close(); } };
}

// Inicia sesión como admin por la API y deja la cookie en el jar.
async function entrar(url, jar, usuario = 'admin', clave = 'ClaveSegura#2026') {
  const post = async (ruta, cuerpo) => {
    const cookie = await jar.getCookieString(url);
    const r = await fetch(url + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(cuerpo) });
    for (const sc of r.headers.getSetCookie()) await jar.setCookie(sc, url);
    return r;
  };
  const r = await post('/api/login', { usuario, password: usuario === 'admin' ? 'admin123' : clave });
  const d = await r.json();
  if (d.debeCambiarPass) await post('/api/password', { nueva: clave });
  return d;
}

module.exports = { jsdom, iniciarServidor, abrir, entrar, esperar, hasta, RAIZ };
