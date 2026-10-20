# SIGIE — Sistema local con base de datos propia (SQLite)

SIGIE funciona **en modo local**: tiene su propia base de datos **SQLite**
dentro de esta misma carpeta, en el archivo:

```
data/sigie.db
```

Ahí se guardan bienes, usuarios, aulas, préstamos, mantenimientos, fotos,
bitácora, etc. No hace falta internet ni ninguna cuenta en la nube. Si copias
**toda esta carpeta** (incluida `data/`) a otra computadora, el inventario
viaja con ella.

La base de datos es resistente a apagones (modo WAL con escritura segura) y
cada guardado es atómico. Cada día se crea un respaldo en
`data/backups/sigie-AAAA-MM-DD.db` (se conservan los últimos 30), además del
botón manual "Descargar respaldo (.json)" de Reportes.

**Requisito:** Node.js **22.13 o superior** (versión LTS), que ya trae SQLite
incluido. No hace falta `npm install`. Los lanzadores comprueban la versión y,
en Windows, intentan instalar/actualizar Node.js solos.

**Si ya usabas una versión anterior** (archivo `data/sigie-datos.json`): al
iniciar por primera vez, el sistema importa ese archivo automáticamente a la
base de datos SQLite y lo conserva renombrado como `sigie-datos.json.migrado`.

**Restaurar un respaldo:** cierra el sistema, copia el archivo de
`data/backups/` a `data/` con el nombre `sigie.db` (borra antes los archivos
`sigie.db-wal` y `sigie.db-shm` si existen) y vuelve a iniciar.

## Cómo iniciar el sistema

### En Windows

1. Copia toda la carpeta del sistema a la computadora (debe incluir
   `index.html`, `core.js`, `app.js`, `login.html`, `login.js`,
   `styles.css`, `server.js`, `package.json` y este archivo, todos juntos).
2. Haz doble clic en **`Iniciar_SIGIE_Windows.bat`**.
   - Si la computadora no tiene Node.js instalado, el instalador lo
     detecta e intenta instalarlo automáticamente (usando `winget`, ya
     incluido en Windows 10/11 actualizados). Si no puede instalarlo
     solo, te abre la página oficial de descarga — instala la versión
     "LTS" y vuelve a ejecutar el `.bat`.
   - Una vez que Node.js está listo, el mismo archivo abre el servidor
     local (una ventana negra que debe quedar abierta mientras usas el
     sistema) y abre el navegador automáticamente en
     `http://localhost:3000/`.
3. Para apagar el sistema, simplemente cierra esa ventana negra.

No hace falta ejecutar `npm install` ni instalar nada más: el servidor
(`server.js`) no usa ningún paquete externo, solo Node.js 22.13 o superior.

### En Mac / Linux

1. Doble clic en **`Iniciar_SIGIE_Mac.command`**
   (la primera vez en Mac puede que tengas que hacer clic derecho →
   "Abrir" para permitirlo, por seguridad de macOS).
2. Se abrirá una ventana de Terminal con el servidor corriendo y el
   navegador se abrirá solo en `http://localhost:3000/`.
3. Para apagar el sistema, cierra esa ventana de Terminal (o presiona
   Ctrl+C).

## Mover el sistema a otra computadora

Copia **toda la carpeta completa**, incluida la subcarpeta `data/` (ahí
vive la base de datos `sigie.db`). Si `data/` no existe todavía (primera vez que se
usa en esa computadora), el sistema la crea solo al iniciar.

## Modo rápido (verificación de inventario con el celular)

Para la toma de inventario física caminando por las aulas, hay una página
liviana separada, pensada para el celular: **`modo-rapido.html`**. Se abre
desde el botón "🏃 Modo rápido" de la barra superior del sistema, o desde
"Toma de inventario" → "🏃 Modo rápido (celular)".

Flujo: eliges el aula → apuntas la cámara a la etiqueta QR de cada bien →
el sistema lo marca como verificado solo (sin cerrar la cámara ni pedir
confirmación) → al terminar, presionas "Finalizar toma de inventario". El
resultado queda guardado junto con las tomas hechas desde la computadora,
visible en la sección "Toma de inventario" del sistema completo.

Si una etiqueta QR está dañada o despegada, se puede marcar el bien a mano
desde la lista de "Pendientes" o escribiendo su código en el campo de
texto de esa misma pantalla.

## Preguntas frecuentes

**¿Y Firebase (la nube)?**
Está **desactivado**: el sistema ya no se conecta a la nube por su cuenta, ni
siquiera si el servidor local se detiene un momento. Todo se guarda en
`data/sigie.db`. (El código de Firebase sigue en `core.js` solo por si algún
día se necesita; reactivarlo exige agregar las librerías de Firebase en los
HTML y activar la marca `sigie:usar_firebase`.)

**¿Qué pasa si abro `index.html` con doble clic, sin usar el servidor?**
La pantalla de acceso mostrará un aviso en rojo: sin servidor no hay base de
datos local y los datos quedarían solo en el almacenamiento del navegador, que
**no viaja** si copias la carpeta. Para usar la base de datos, siempre inicia
el sistema con `Iniciar_SIGIE_Windows.bat` (o `Iniciar_SIGIE_Mac.command`).

**¿Qué usuario uso la primera vez?**
Usuario: `admin` — Contraseña: `admin123`. Al entrar por primera vez el
sistema te **obliga a elegir una contraseña nueva** (mínimo 8 caracteres)
antes de continuar. Lo mismo ocurre con las cuentas nuevas y con las que el
administrador restablece: la persona debe cambiar la clave provisional en su
primer ingreso. Las contraseñas se guardan con PBKDF2-SHA256; las cuentas
creadas con versiones anteriores se actualizan solas la próxima vez que
inicien sesión.

## Seguridad del servidor local (v8)

**El inicio de sesión lo valida el servidor**, no el navegador. Toda la API de
datos exige una sesión: sin iniciar sesión no se puede leer ni escribir nada
(respuesta 401). Al entrar correctamente, el servidor entrega una cookie de
sesión `HttpOnly` + `SameSite=Strict` que JavaScript no puede leer ni copiar,
y que se cierra sola tras 12 horas sin uso o al pulsar *Salir*.

- **Las contraseñas (hash y sal) nunca salen del servidor.** El navegador solo
  recibe nombre, rol y aulas de cada usuario. Los respaldos `.json` tampoco las
  incluyen (y por eso *Restaurar respaldo* no restaura usuarios).
- **Permisos en el servidor:** `CONSULTA` no puede guardar nada; solo `ADMIN`
  puede crear, editar o eliminar usuarios y roles; `DOCENTE` no puede borrar
  datos del sistema (solo fotos). Antes estos límites existían solo en la pantalla.
- **Freno a intentos de acceso:** 5 contraseñas incorrectas seguidas bloquean ese
  usuario desde esa PC durante 1 minuto, y hay un tope general por IP. Ya no se
  puede saltar borrando el almacenamiento del navegador.
- **Bitácora:** los inicios de sesión, cierres e intentos fallidos los registra
  el propio servidor.
- Las cuentas iniciales (`admin`, `biblioteca`, `docente`, `consulta`) las crea
  el servidor la primera vez que arranca. Si usas *Reiniciar sistema*, el servidor
  vuelve a crear solo `admin` / `admin123` (con cambio obligatorio).

Por defecto, `server.js` solo acepta conexiones **desde esta misma
computadora**. Si necesitas que **varias computadoras de la misma red local**
usen este mismo servidor, puedes habilitarlo a propósito:

```
(Windows)   set SIGIE_LAN=1 && node server.js
(Mac/Linux) SIGIE_LAN=1 node server.js
```

En ese modo cada persona debe iniciar sesión, pero **el tráfico viaja por HTTP
sin cifrar**: quien espíe esa red puede ver contraseñas y datos. Úsalo solo en
la red interna del colegio (nunca un Wi-Fi público) o pon un proxy HTTPS delante.

Además, el servidor solo entrega al navegador los archivos del sistema
(`index.html`, `app.js`, etc.). **Nunca** entrega la carpeta `data/` (base de
datos y respaldos), `server.js`, `package.json` ni la documentación, y rechaza
peticiones a la API que provengan de otras páginas web (CSRF / DNS rebinding).

**Limitaciones conocidas:**
- Los permisos por **aula** del rol `DOCENTE` siguen aplicándose solo en pantalla;
  el servidor distingue roles, no aulas.
- Si abres el sistema **sin** el servidor (doble clic al `.html`), los datos y el
  login quedan solo en ese navegador y no tienen estas protecciones.
- La carpeta `data/` contiene los hashes: protege el acceso a la computadora y a
  los respaldos de `data/backups/`.

## Varias computadoras a la vez (v8)

Cada dato guardado tiene un **número de versión**. Si dos computadoras guardan lo
mismo al mismo tiempo (por ejemplo, dos préstamos distintos), el servidor avisa y el
navegador **fusiona los dos cambios por registro** en lugar de dejar que el último
pise al primero. Además, cada PC trae cada ~10 segundos lo que guardaron las demás
(no interrumpe si tienes un formulario abierto o estás escribiendo).

Lo que la fusión **no** puede evitar: dos personas prestando **el último ejemplar** del
mismo libro en el mismo segundo (ambos préstamos se conservan), o dos altas simultáneas
que generen el mismo código correlativo. Son casos raros; la pantalla *Revisión de datos*
ayuda a detectarlos.

## Pruebas automáticas

```
npm install      (una sola vez; instala las herramientas de prueba)
npm test
```

Arranca un servidor temporal (no toca tu `data/`) y comprueba: autenticación y permisos, versiones y fusión de
cambios simultáneos, la capa de datos del navegador, la lógica de la biblioteca y —con un navegador simulado
(jsdom)— las pantallas: login, cambio de clave, todas las vistas, avisos, carnés y préstamo por aula.
Sin `npm install` se ejecutan todas menos las de pantalla. Requiere Node.js 22.13 o superior.

## Novedades de la biblioteca en v9
- **⭐ Reseñas**: al devolver un libro se pide de 1 a 5 estrellas (opcional). Promedio en el catálogo y ranking *Más leídos y mejor valorados*.
- **💤 Lectores sin actividad**: alumnos que dejaron de leer, por aula (plazo en *Reglas de préstamo*, 30 días por defecto).
- **🎓 Certificados de lector**: impresión A4 horizontal para quienes alcanzan el mínimo de libros.
- Detalle completo en `CAMBIOS.md`.

## Novedades de la biblioteca en v8

- **Grado y sección bien agrupados.** “3A”, “3° A”, “3ro A primaria” y “Tercero A” cuentan como la misma aula en Morosos,
  Ranking por aula e Informe anual. Si el texto no dice el nivel (solo “3° A”) no se adivina: queda como grupo aparte,
  así que conviene escribir el nivel al importar la nómina.
- **📊 Por grado y sección** (Reporte general): lectores, préstamos, promedio, participación, libros en casa y vencidos,
  y categoría más leída, por nivel, grado o sección, con Excel.
- **Celular del apoderado** en la ficha del lector (y columna *Celular* al importar Excel).
- **📲 Avisos por WhatsApp** (Préstamos → Morosos por grado): un mensaje por familia con todos sus libros vencidos; se abre un
  chat por familia con el texto ya escrito y tú pulsas *Enviar*. WhatsApp no permite el envío automático a muchos contactos desde
  una página web; también hay *Copiar todos* y un CSV para herramientas externas. Cada aviso queda marcado en el préstamo.
- **🖨 Carnés en hojas** (Lectores): elige un aula y se imprime en hojas A4 de 8 carnés, con líneas de corte.
- **👥 Préstamo por aula / ↩ Devolución por aula** (Préstamos): reparte un título (varios ejemplares) a todos los alumnos de un
  aula respetando las reglas de préstamo, y registra la devolución del grupo de una vez.

## Módulo de Biblioteca (biblioteca.js)

Menú **Biblioteca**: Libros (catálogo con Cód., Dewey, Categoría, Título, Autor, Cant., Estado, ISBN, Editorial, Observación, Ubic.), Préstamos de libros, Cartelera lectora / lista de cotejo (prefijo, color HEX, ubicaciones, total declarado vs. registrado) y Reporte general (total de ejemplares). El código se genera solo por categoría (DIC-001, DIC-002…). Se pueden importar los libros desde Excel con las mismas columnas de la hoja manual y exportar a Excel. Las 40 categorías de la cartelera vienen precargadas (total declarado: 4288 ejemplares).

**Lectores y carnés:** registra o importa (Excel: Nombre, Grado, Tipo) alumnos y docentes e imprime su carné con QR (LEC-0001…). En *Nuevo préstamo* se escribe o escanea el QR del libro y del carné.
**Etiquetas QR e Inventario por estante:** imprime la etiqueta de cada libro y verifica cada estante escaneándolas.

**Préstamos:** filtro por estado, renovación (+7 días), recordatorio de devolución por WhatsApp o copiado, e historial por lector (botón en cada carné).

## Usuarios iniciales (cambiar la contraseña en el primer ingreso)

| Usuario | Rol | Contraseña inicial |
|---|---|---|
| admin | ADMIN (todo, incluye usuarios) | admin123 |
| biblioteca | ADMIN2 (todo, salvo usuarios) | Biblio2026 |
| docente | DOCENTE (registra y edita) | Docente2026 |
| consulta | CONSULTA (solo ver y exportar) | Consulta2026 |

El sistema pide cambiar la contraseña al primer ingreso de cada cuenta. Si ya existía una base con usuarios, solo se agregan los que falten (una sola vez).

## Datos de ejemplo (ejemplo.js)

Para demostraciones, capacitaciones o pruebas, hay un botón que rellena **todos los módulos** con información simulada y coherente entre sí (biblioteca, aulas, personal, bienes con código SBN oficial, kardex, préstamos, mantenimientos y calibraciones, pólizas, compras, bajas, almacén, presupuesto, plano, bitácora, etc.).

- Dónde está: **Reportes y exportación → "Datos de ejemplo"** y también en **Biblioteca → Libros (catálogo) → "🧪 Datos de ejemplo"**. Solo lo ve un administrador.
- Qué hace: **reemplaza** los datos actuales de los módulos. Antes pide confirmación y ofrece descargar un respaldo (.json).
- Qué NO toca: la cuenta `admin`, el catálogo SBN, los cargos, la vida útil de depreciación y el logo.
- Es reproducible: cada clic genera el mismo conjunto de datos.
- Usuarios de ejemplo (contraseña `Ejemplo2026`): `secretaria` (ADMIN2), `director` (CONSULTA), `prof.quispe` y `prof.vargas` (DOCENTE).
- Todos los nombres, DNI, RUC, ISBN, montos y expedientes son ficticios.
- Para volver a empezar desde cero: **Reportes → Reiniciar sistema por completo**.

## PDF del inventario de biblioteca (formato planilla)

En **Biblioteca → Reporte general** hay un botón **"PDF inventario completo (formato planilla)"**: abre una vista con *todos* los libros, una sección por categoría (en el orden de la cartelera), con las 11 columnas de la planilla física (Cod, Dewey, Categoría, Título, Autor, Cant, Estado, ISBN, Editorial, Observación, Ubi), el nombre de la categoría arriba a la derecha, el encabezado repetido en cada hoja, el total por categoría y un resumen general al final. En el cuadro de impresión elige **"Guardar como PDF"** en horizontal. También se puede generar solo una categoría, y desde **Libros (catálogo)** el botón **"PDF (formato planilla)"** respeta los filtros activos.

El reporte general ahora incluye: cotejo por categoría (con estado de conservación y % en uso), situación por estante, resumen de préstamos con filtro de periodo, libros más prestados, lectores más activos, vencidos a reclamar, libros en mal estado y faltantes de la última toma. El **Excel completo** trae 9 hojas (incluye el catálogo con las 11 columnas).

## Novedades de la versión 11 (resumen)

- **Lectómetro integrado** a la biblioteca, **diplomas con código único y verificación** (`verificar.html`) y **tablero del director**. Detalle y limitaciones en `CAMBIOS.md`.
- **Copia externa del respaldo diario** — variable opcional `SIGIE_BACKUP_DIR`:
  - Windows: `set SIGIE_BACKUP_DIR=E:\Respaldos-SIGIE` y luego `node server.js`
  - Linux/Mac: `SIGIE_BACKUP_DIR=/media/usb/respaldos node server.js`
- Para que el **QR de los diplomas** abra en un celular, inicia con `SIGIE_LAN=1` y escribe la dirección del servidor en *Diplomas → Configuración*.
