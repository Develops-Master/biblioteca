/* =========================================================================
   SIGIE — Script de build para publicación web (Netlify / Vercel / etc.)
   -------------------------------------------------------------------------
   Qué hace:
   1) Crea una carpeta "dist/" limpia.
   2) Copia ahí SOLO lo que el sitio necesita en línea (HTML, CSS, íconos,
      manifest, service worker).
   3) Minifica core.js, app.js, login.js, modo-rapido.js y sw.js con esbuild
      (nombres de variables cortos, sin comentarios, sin espacios) para que
      lo que vea el navegador no sea el código fuente original.
   4) A propósito NO copia: server.js, package.json, los .bat/.command de
      inicio local, ni LEEME_INSTALACION.md — esos son solo para uso local
      en una PC y no deben publicarse en la web.

   Uso:  npm run build   →  genera la carpeta dist/
   ========================================================================= */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const RAIZ = __dirname;
const DIST = path.join(RAIZ, 'dist');

// Archivos que se copian tal cual (no son JS)
const ARCHIVOS_ESTATICOS = [
  'index.html',
  'login.html',
  'modo-rapido.html',
  'verificar.html',
  'opac.html',
  'styles.css',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
];

// Archivos JS que se minifican (mismo nombre de salida, mismas rutas
// relativas que ya usan los <script src="..."> en los HTML)
const ARCHIVOS_JS = ['core.js', 'merge.js', 'bib-util.js', 'app.js', 'biblioteca.js', 'lectometro-util.js', 'diplomas-util.js', 'lectometro.js', 'diplomas.js', 'mejoras.js', 'panel-util.js', 'lectura-panel.js', 'coleccion-util.js', 'coleccion.js', 'ui-iconos.js', 'inicio-util.js', 'inicio.js', 'lectores-util.js', 'lectores.js', 'reservas-util.js', 'reservas.js', 'prestamos-util.js', 'prestamos.js', 'mostrador-util.js', 'mostrador.js', 'bajas-util.js', 'bajas.js', 'opac-panel.js', 'reportes-color-util.js', 'reportes-color.js', 'opac-util.js', 'opac.js', 'ejemplo.js', 'login.js', 'modo-rapido.js', 'sw.js'];

function limpiarDist() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
}

function copiarEstaticos() {
  for (const archivo of ARCHIVOS_ESTATICOS) {
    const origen = path.join(RAIZ, archivo);
    if (!fs.existsSync(origen)) {
      console.warn(`⚠️  No se encontró ${archivo}, se omite.`);
      continue;
    }
    fs.copyFileSync(origen, path.join(DIST, archivo));
  }
}

async function minificarJS() {
  for (const archivo of ARCHIVOS_JS) {
    const origen = path.join(RAIZ, archivo);
    if (!fs.existsSync(origen)) {
      console.warn(`⚠️  No se encontró ${archivo}, se omite.`);
      continue;
    }
    await esbuild.build({
      entryPoints: [origen],
      outfile: path.join(DIST, archivo),
      minify: true,
      bundle: false, // son <script> clásicos, no módulos: no hay que unirlos
      target: ['es2018'],
      legalComments: 'none',
    });
  }
}

async function main() {
  limpiarDist();
  copiarEstaticos();
  await minificarJS();
  console.log('✅ Build lista en dist/ — esto es lo que hay que publicar.');
}

main().catch((err) => {
  console.error('❌ Error durante el build:', err);
  process.exit(1);
});
