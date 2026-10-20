/* ---------------------------------------------------------------------
   SIGIE — Service Worker
   Objetivo: que el sistema (interfaz + librerías de terceros por CDN)
   siga funcionando aunque el colegio se quede sin internet, siempre que
   el servidor local (server.js) siga corriendo en esa misma computadora
   o en la red local. Las llamadas a /api/db (los datos reales) NUNCA se
   cachean aquí: si el internet falla pero el servidor local sigue
   encendido, los datos siguen viajando en vivo por la red local; si
   además se apaga el servidor, la app avisa igual que siempre (no es
   responsabilidad de este service worker).
   Sube CACHE_VERSION cada vez que cambies archivos del sistema para que
   los navegadores ya instalados descarguen la versión nueva.
   --------------------------------------------------------------------- */
const CACHE_VERSION = 'sigie-v48';
const APP_SHELL = [
  './', './index.html', './login.html', './core.js', './merge.js', './bib-util.js', './app.js', './biblioteca.js', './lectometro-util.js', './diplomas-util.js', './lectometro.js', './diplomas.js', './mejoras.js', './panel-util.js', './lectura-panel.js', './coleccion-util.js', './coleccion.js', './ui-iconos.js', './inicio-util.js', './inicio.js', './lectores-util.js', './lectores.js', './reservas-util.js', './reservas.js', './prestamos-util.js', './prestamos.js', './mostrador-util.js', './mostrador.js', './bajas-util.js', './bajas.js', './opac-panel.js', './reportes-color-util.js', './reportes-color.js', './verificar.html', './ejemplo.js', './login.js',
  './modo-rapido.html', './modo-rapido.js',
  './styles.css', './manifest.json', './icon-192.png', './icon-512.png'
];
const CDN_LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qr-scanner/1.4.2/qr-scanner.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qr-scanner/1.4.2/qr-scanner-worker.min.js'
];

self.addEventListener('install', event=>{
  event.waitUntil((async ()=>{
    const cache = await caches.open(CACHE_VERSION);
    // El shell propio es indispensable: si falla, que falle la instalación.
    await cache.addAll(APP_SHELL);
    // Las librerías CDN son "mejor si se puede": si el colegio instala el
    // sistema sin internet en ese preciso momento, no se debe romper todo.
    await Promise.all(CDN_LIBS.map(async url=>{
      try{ const r = await fetch(url, {mode:'cors'}); if(r.ok) await cache.put(url, r); }catch(e){ /* sin red por ahora, no pasa nada */ }
    }));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', event=>{
  event.waitUntil((async ()=>{
    const nombres = await caches.keys();
    await Promise.all(nombres.filter(n=>n!==CACHE_VERSION).map(n=>caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event=>{
  const req = event.request;
  const url = new URL(req.url);

  // 1) Datos reales del sistema: SIEMPRE red, nunca caché.
  if(url.pathname.startsWith('/api/')){
    event.respondWith(fetch(req));
    return;
  }
  if(req.method!=='GET') return;

  // 2) Librerías CDN de terceros: caché primero (arrancan al instante y
  //    funcionan sin internet), actualizando en segundo plano si hay red.
  if(url.origin==='https://cdnjs.cloudflare.com'){
    event.respondWith((async ()=>{
      const cache = await caches.open(CACHE_VERSION);
      const cacheada = await cache.match(req);
      const enRed = fetch(req).then(r=>{ if(r.ok) cache.put(req, r.clone()); return r; }).catch(()=>null);
      return cacheada || (await enRed) || new Response('', {status:504});
    })());
    return;
  }

  // 3) Archivos propios del sistema (mismo origen): caché primero, con
  //    actualización en segundo plano para tomar cambios cuando haya red.
  if(url.origin===self.location.origin){
    event.respondWith((async ()=>{
      const cache = await caches.open(CACHE_VERSION);
      const cacheada = await cache.match(req, {ignoreSearch:true});
      const enRed = fetch(req).then(r=>{ if(r.ok) cache.put(req, r.clone()); return r; }).catch(()=>null);
      return cacheada || (await enRed) || cache.match('./index.html');
    })());
  }
});
