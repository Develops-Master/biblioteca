> **Nota:** SIGIE está pensado para **modo local** con su base de datos SQLite
> (`data/sigie.db`, ver `LEEME_INSTALACION.md`). Publicarlo en Netlify/Vercel
> solo sirve la interfaz: allí **no hay servidor ni base de datos**, así que los
> datos se guardarían únicamente en el navegador de cada usuario. Esta guía se
> conserva solo como referencia; para el uso normal del colegio no la necesitas.
>
> **Importante (v8):** las protecciones de acceso (sesión en el servidor, permisos por
> rol, ocultar hashes y control de versiones) viven en `server.js`. Una publicación
> estática en Netlify/Vercel **no las tiene**: no la uses con datos reales.

# Publicar SIGIE en línea con el repositorio en privado

Este proyecto ahora incluye:
- `build.js` / `npm run build` → genera una carpeta `dist/` con el sitio
  minificado y solo los archivos necesarios para la web (sin `server.js`,
  sin los `.bat`/`.command`, sin `LEEME_INSTALACION.md`).
- `netlify.toml` y `vercel.json` → configuración lista para que Netlify o
  Vercel hagan el build automáticamente.
- `.gitignore` → evita subir `node_modules/`, `dist/` y la carpeta `data/`
  (esta última NUNCA debe ir a un repo, ni privado: son los datos reales
  del inventario si alguna vez corriste el servidor local ahí).

## Antes que nada: revisa las reglas de seguridad de Firestore

Esto es más importante que ocultar el código. Como la clave de Firebase
va incrustada en el JS (es normal en Firebase, no es un descuido), la
protección real de los datos depende de las **reglas de seguridad** de tu
proyecto `inventario-1eb3f` en la consola de Firebase
(Firestore Database → Reglas). Confirma que solo usuarios autenticados
puedan leer/escribir (por lo menos `request.auth != null`) y que no existan
reglas abiertas como `allow read, write: if true;`.

**Ojo:** el sistema inicia sesión en Firebase de forma *anónima*
(`signInAnonymously`), y el login de usuarios/contraseñas se valida solo en el
navegador. Eso significa que las reglas de Firestore no pueden distinguir a un
usuario del colegio de cualquier visitante del sitio publicado. Para datos
sensibles, no publiques el sistema en internet abierto: usa el modo servidor
local, o protege el sitio con autenticación del hosting (por ejemplo,
Netlify/Vercel con contraseña o Cloudflare Access).

## Paso 1 — Crear el repositorio privado en GitHub

1. En GitHub, "New repository".
2. Marca **Private**.
3. Sube todo el contenido de esta carpeta (con git o arrastrando los
   archivos), **incluyendo** `build.js`, `netlify.toml`, `.gitignore`,
   `package.json`. El `.gitignore` ya se encarga de no subir `data/` ni
   `node_modules/`.

```bash
git init
git add .
git commit -m "SIGIE - version para publicar"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

## Paso 2 — Conectar Netlify (o Vercel) al repo privado

**Con Netlify (gratis):**
1. Crea cuenta en netlify.com con tu cuenta de GitHub.
2. "Add new site" → "Import an existing project" → GitHub.
3. Autoriza a Netlify a acceder a tu repositorio privado (se puede limitar
   el acceso a un solo repo).
4. Elige el repo. Netlify detecta automáticamente `netlify.toml`
   (comando `npm run build`, carpeta `dist`). Dale a "Deploy".
5. Cada vez que hagas `git push`, Netlify vuelve a construir y publicar
   solo. Te da una URL tipo `tu-sitio.netlify.app` (puedes poner un
   dominio propio después, gratis).

**Con Vercel (gratis):** el proceso es prácticamente igual — "Add New
Project" → importar el repo de GitHub → Vercel lee `vercel.json` solo.

En ambos casos el repositorio de GitHub **queda privado**: nadie puede
entrar a github.com/tu-usuario/tu-repo a leer el código fuente completo,
el historial de commits ni los comentarios internos.

## Qué sigue siendo visible (y por qué es inevitable)

Quien visite tu sitio publicado sí podrá ver, con el inspector del
navegador, el HTML/CSS/JS ya minificado que corre en su propia
computadora — eso pasa con cualquier aplicación web del mundo, es cómo
funciona el navegador. La diferencia con este setup es que:
- Ya no verán tu código fuente original con comentarios y nombres de
  variables claros (verán la versión comprimida de `dist/`).
- No tendrán acceso al repositorio completo, historial ni archivos
  internos como `server.js`.

## Volver a generar el sitio local (modo servidor en una PC)

Nada de esto afecta el modo local: `server.js`, `Iniciar_SIGIE_Windows.bat`
e `Iniciar_SIGIE_Mac.command` siguen funcionando igual que siempre para
uso en una sola computadora sin internet.
