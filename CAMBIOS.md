# Historial de cambios — SIGIE
Un solo archivo con todas las versiones, de la más reciente a la más antigua. La instalación y el uso actuales están en `LEEME_INSTALACION.md`.

---

## Versión 28 — Bajas y pérdidas: actas numeradas, reposición y reversión

### Qué hay de nuevo (Biblioteca → Bajas y pérdidas)
- **Actas numeradas**: «🖨 Acta de baja» genera el acta con lo que marques (o con todo lo que no tiene acta), sugiere el siguiente N° del año (`001-2026`, `002-2026`…), pide la fecha y **sella cada baja con su acta**. Una baja ya no puede quedar en dos actas; un N° repetido se rechaza. Antes se usaba `prompt()` del navegador, se podía reportar la misma baja varias veces y no quedaba rastro de qué acta la incluyó.
- **Reimprimir acta…**: elige un N° y vuelve a salir tal como se emitió.
- **↩ Revertir una baja**: si el libro apareció, el lector lo repuso o la baja fue un error, el ejemplar **vuelve al catálogo** (se suma al libro, o se recrea si se había retirado por completo) y el préstamo que figuraba como «Perdido» queda como devuelto. La baja **no se borra**: queda en el historial como «Revertida», con fecha y motivo, y deja de contarse en inventario, cotejo y kardex. Si la baja ya estaba en un acta, avisa que el acta impresa no cambia.
- Las bajas nuevas **guardan una copia completa del libro** (ISBN, ubicación, categoría, portada…) para poder reingresarlo exacto. Las bajas antiguas no la tienen: al revertirlas se recrea con código, título y autor y se avisa.
- **Reposición pendiente**: las bajas Perdido/Dañado con lector responsable llevan la etiqueta «reponer» y una tarjeta que las cuenta.
- **Tarjetas** (ejemplares dados de baja, sin acta, reposición pendiente, revertidas; las tres últimas filtran al pulsarlas), **filtros** por año, motivo y estado, **buscador** y **Excel** con N° de acta y estado.
- El **kardex** muestra las bajas revertidas con su baja y su reingreso.
- Versión 28.0.0, service worker `sigie-v47`.

### Archivos nuevos
`bajas-util.js`, `bajas.js`, `test/bajas.test.js` (5 pruebas), `test/ui-v28.test.js` (pantalla con servidor real: dos actas sin repetir bajas, número duplicado, tres reversiones de distinto tipo).

### Arreglos de pruebas (importante)
- **`ui-biblioteca` «préstamo por aula»** fallaba a veces desde el v22 original. Causa real, diagnosticada: la prueba seguía con la devolución por aula antes de que se cerrara el modal del préstamo por aula y pulsaba el botón del modal viejo. No era un error de datos. Corregido (esperar a que cierre): **0 fallos en 8 corridas** (antes ~2 de 5). Mis notas de v24–v27 lo atribuían a «tiempos de arranque»: para esta prueba, eso era incorrecto.
- Otras pruebas de pantalla fallaban cuando la suite corría completa porque el arranque simulado superaba los 10 s fijos: ahora 30 s (y 15 s por defecto en `hasta`).
- **Resultado: 205 de 205 en tres corridas completas seguidas** (~1 minuto cada una).

### Límites conocidos
- Revertir una baja es de **todo el registro** (no hay reversión parcial de, por ejemplo, 2 de 5 ejemplares).
- Las bajas hechas antes del v28 no tienen acta ni copia completa del libro.

### Estado del módulo Bajas (cerrado)
Dar de baja (Libros / Perdido en Préstamos) · actas numeradas y reimpresión · reposición pendiente · revertir · filtros · Excel.

### Pendiente
Siguiente módulo a elegir (Reseñas y más leídos, Inicio de la biblioteca, Libros/catálogo).

---

## Versión 27 — Mostrador (escáner): ficha del lector, resultado visible, deshacer

### Qué hay de nuevo (Biblioteca → Mostrador)
- **Resultado grande** de cada escaneo (verde ✔ / rojo ✖) con **sonido** (agudo si salió bien, grave si falló; casilla para silenciarlo, se recuerda). Antes solo había una tabla de eventos.
- **Ficha del lector** al escanear su carné: los libros que tiene en su poder con su vencimiento («Vencido hace 6 d», «Vence hoy», «Vence en 2 d»), cuántos más puede llevar y **avisos antes de prestar**: libros vencidos, máximo alcanzado, sanción vigente, baja, y **reservas listas para recoger**. Cada libro se puede **devolver desde la ficha** con un botón.
- **DNI en el campo del escáner**: escribir el DNI (o el código largo del lector) selecciona al lector, por si olvidó el carné. Solo coincidencia exacta; nunca se busca ni se muestra por nombre.
- **Ubicación al devolver**: «📍 Colócalo en el estante: B2» (campo Ubic. del libro).
- **↩ Deshacer este movimiento**: revierte el último préstamo o devolución (incluida la reserva que se hubiera atendido o liberado). Solo se ofrece si **nada más cambió** después; si no, avisa que ya no se puede. Queda en la bitácora.
- **Cierre por inactividad**: tras 3 minutos sin escanear, el lector se cierra solo para que el siguiente niño no reciba libros a nombre del anterior.
- Versión 27.0.0, service worker `sigie-v46`.

### Cómo está hecho
Se envuelve el escaneo existente (`bibMostScan`, con su pedido de reseña al devolver) en vez de reescribirlo: las reglas de préstamo no cambian. `mostrador-util.js` (reconocer lo escaneado, ficha con avisos, fotos para deshacer) es lógica pura con pruebas.

### Archivos nuevos
`mostrador-util.js`, `mostrador.js`, `test/mostrador.test.js` (4 pruebas), `test/ui-v27.test.js` (pantalla con servidor real: DNI, ficha, máximo, ubicación, deshacer y devolver desde la ficha, inactividad).

### Pruebas
199 pruebas, **199 pasan** en la corrida completa (~1 minuto). Las pruebas de pantalla intermitentes (`ficha-ugel`, préstamo por aula) pasaron esta vez, pero siguen siendo sensibles a los tiempos de arranque.

### Límites conocidos
- El sonido depende del navegador (algunos lo bloquean hasta la primera interacción de la página).
- Si se pide reseña al devolver y luego se deshace la devolución, la reseña ya guardada no se borra.
- No probado con un lector de códigos de barras real; la prueba simula el texto + Enter que envía.

### Estado del módulo Mostrador (cerrado)
Escaneo de carné / DNI / libro / ISBN · préstamo y devolución · ficha y avisos · reservas listas · ubicación · deshacer · cierre por inactividad.

### Pendiente
Siguiente módulo a elegir (Bajas y pérdidas, Reseñas y más leídos, Inicio de la biblioteca).

---

## Versión 26 — Préstamos y devoluciones: lo urgente primero, recordatorio con constancia

### Qué hay de nuevo (Biblioteca → Préstamos)
- **Tarjetas por situación**: Vencidos, Por vencer (vence hoy a 2 días), Prestados ahora y Devueltos hoy. Pulsar una tarjeta filtra; pulsarla otra vez quita el filtro.
- **Orden por urgencia**: arriba el más atrasado, luego lo que vence antes; lo devuelto va al final (lo más reciente primero). Antes se ordenaba solo por fecha de vencimiento.
- **Atraso a la vista**: debajo de la fecha de vencimiento dice «hace 5 días», «vence hoy», «vence mañana» o «en 2 días». Las fechas se ven dd/mm/aaaa. Marca de color en el borde de cada fila (rojo, ámbar, azul).
- **Nuevo estado «Por vencer»** en el filtro. «Prestado» sigue incluyendo esos préstamos, como siempre.
- **💬 Recordar** usa el **celular guardado en la ficha** del lector (antes había que teclearlo con código de país), habla a la familia en el caso de alumnos, menciona los días de atraso y **deja constancia** («✔ avisado dd/mm/aaaa»). Si falta el celular, lo pide, lo valida, lo guarda en la ficha y recién entonces abre WhatsApp. También aparece para los «por vencer».
- El modal **«Morosos por grado»** usa el mismo recordatorio (con celular de la ficha y constancia).
- Se muestra «renovado N×» y el botón **Renovar** ya no dice «+7d» (renueva los días que corresponden al tipo de lector, como siempre).
- **⇩ CSV** con lo que se ve (filtros incluidos): libro, lector, grado, fechas, estado, días de atraso, renovaciones y último aviso.
- Con muchos préstamos se muestran los 300 más urgentes (aviso en pantalla); el CSV lleva todos los del filtro.
- Versión 26.0.0, service worker `sigie-v45`.

### Archivos nuevos
`prestamos-util.js`, `prestamos.js`, `test/prestamos.test.js` (5 pruebas), `test/ui-v26.test.js` (pantalla con servidor real: orden, tarjetas, recordatorio con y sin celular, CSV).

### Pruebas
194 pruebas, 193 pasan en la corrida completa (~1 minuto). La que fallaba desde el v22, `ui-biblioteca-v9`, ahora pasa: comprobaba que se viera el nombre de la *primera* reseña generada del ejemplo, y esa reseña no aparece en la pantalla; ahora comprueba que se vea alguna. No investigué por qué esa no aparece (puede ser un orden o un tope de la pantalla de reseñas).
Los `ficha-ugel` y `ui-biblioteca` (préstamo por aula) siguen siendo intermitentes por tiempos de arranque, también en el v22 original; esta vez pasaron.

### Estado del módulo Préstamos (cerrado)
Prestar (mostrador, manual, por aula) · devolver (también por aula) · renovar con tope y fila de espera · perdido · recordatorio por WhatsApp con constancia · morosos por grado · CSV.
No incluido: sanciones automáticas desde esta pantalla (las reglas de suspensión siguen en «Reglas»).

### Pendiente
Estabilizar las pruebas de pantalla intermitentes. Siguiente módulo a elegir.

---

## Versión 25 — Reservas: avisos por WhatsApp con constancia

### Qué hay de nuevo (Biblioteca → Reservas)
- **Tarjetas de estado**: listos para recoger, por avisar y en lista de espera.
- **💬 Avisar**: abre el chat de WhatsApp con el mensaje ya escrito (familia, para alumnos; directo, para docentes) y **deja constancia**: la fila muestra «✔ avisado dd/mm/aaaa». Antes solo copiaba el texto y no quedaba registro.
- **Si el lector no tiene celular válido**, pide el número en el momento, lo valida (rechaza los que no sirven para WhatsApp), lo guarda en la ficha del lector y recién entonces abre el chat. 📱/📵 junto al nombre indica si ya tiene.
- **💬 Avisar a los N que ya pueden recoger**: lista con un botón de WhatsApp por reserva (uno por familia, como en los avisos de morosos), con filtro «solo los que aún no tienen aviso».
- **Orden claro**: arriba lo que ya se puede recoger (la que vence antes primero); abajo la fila por libro con su puesto.
- **Buscador** por libro o lector e **historial** (atendidas, canceladas y las que vencieron sin recoger).
- Cuando una reserva vence, el libro pasa solo al siguiente de la fila (ya lo hacía el sistema al abrir Reservas); ahora ese siguiente aparece enseguida como «por avisar».
- Versión 25.0.0, service worker `sigie-v44`.

### Archivos nuevos
`reservas-util.js`, `reservas.js`, `test/reservas.test.js` (3 pruebas), `test/ui-v25.test.js` (pantalla completa con servidor real: aviso, celular que falta, celular inválido, relevo de la fila, historial).

### Pruebas
188 pruebas, 186 pasan. Fallan:
- `ui-biblioteca-v9` (preexistente, también en el zip v22).
- Una prueba de pantalla de `ui-biblioteca` (préstamo por aula) o de `ficha-ugel`, según la corrida: intermitentes por tiempos de arranque, también en el v22 original.

### Estado del módulo Reservas (cerrado)
Reservar (mostrador y OPAC) · fila con puesto · aviso por WhatsApp con constancia · liberación automática de vencidas · historial · buscador.
No incluido: envío automático (WhatsApp no permite que una página mande mensajes sin que alguien pulse Enviar).

### Pendiente
Revisar `ui-biblioteca-v9` y estabilizar las pruebas de pantalla intermitentes. Siguiente módulo a elegir.

---

## Versión 24 — OPAC: reservas desde el celular

### Qué hay de nuevo
- **Botón «🔖 Reservar»** en los libros prestados del catálogo público (`/opac.html`). El lector escribe su código de carné (LEC-0001) y los **4 últimos dígitos de su DNI**. No se guarda nada en el navegador (puede ser una PC compartida).
- La reserva entra a Biblioteca → **Reservas** como «En espera» con la etiqueta **OPAC**; la bibliotecaria decide si la atiende (el flujo de lista de espera existente no cambia).
- El catálogo muestra «N en espera» por libro, sin nombres.
- **Interruptor** en Biblioteca → Catálogo público (OPAC): «Permitir reservar desde el catálogo». **Viene apagado.** El panel avisa cuántos lectores no tienen DNI (no podrán reservar).
- Reglas: solo libros sin ejemplar libre; no repetir la misma reserva; no reservar un libro que ya tiene en mano; máximo 2 reservas vivas por lector.

### Seguridad
- Código inexistente, clave mala, lector sin DNI o dado de baja: **el mismo mensaje**.
- 5 fallos bloquean ese código 15 minutos; 12 fallos bloquean la IP. Además rige el límite general de peticiones.
- `POST /api/opac/reservar` solo agrega una reserva «Espera»; no lee ni modifica nada más. Las demás rutas `/api/…` siguen exigiendo sesión (verificado).
- Respuestas y página pública sin nombres ni DNI. Los intentos rechazados y las reservas quedan en la bitácora.
- Límite conocido: la clave son 4 dígitos del DNI. Protege contra reservas de broma, no contra alguien que conozca el DNI de un compañero; por eso la reserva es solo «En espera» y la bibliotecaria la confirma al entregar el libro.

### Otros arreglos
- `manifest.json` estaba en 22.0.0 en el v23 (la prueba de versiones lo detectaba): ahora todo está en 24.0.0, service worker `sigie-v43`.
- Ícono de línea para «Reportes en color» (faltaba desde el v20; fallaba `ui-iconos`).
- `npm test` ahora usa `--test-force-exit`: las pruebas de pantalla no cerraban sus ventanas y la corrida completa no terminaba. Dura ~2 minutos.
- Las pruebas `ui-v20`, `ui-v21` y `ui-v24` cierran sus ventanas.

### Pruebas
184 pruebas, 180 pasan en la corrida completa. Fallan:
- `ui-biblioteca-v9` «el ejemplo trae reseñas»: **falla también en el zip v22 original** (preexistente, sin revisar).
- Pruebas de pantalla `ficha-ugel` y `ui-biblioteca` (préstamo por aula): **intermitentes por tiempos de arranque**; medido en el v22 original, también fallan a veces (hasta 2 de 7 según la corrida) y pasan al repetir.
Nuevas: `test/opac-reservas.test.js` (servidor real, HTTP), `test/ui-v24.test.js` (pantalla), 5 pruebas en `test/opac.test.js`.

### Estado del módulo OPAC (cerrado)
Búsqueda · filtros · colores · portadas · últimos agregados · más leídos · cartel con QR · reservas con clave.

### Pendiente
Revisar `ui-biblioteca-v9`; estabilizar las pruebas de pantalla intermitentes. Siguiente módulo a elegir.

---

## Versión 23 — Lectores: cierre del módulo (celulares, calidad de datos)

### Qué hay de nuevo
- **⇩ Lista para celulares** (Lectores): Excel que ya trae a todos los lectores activos (alumnos primero) con DNI, nombre, grado/cargo y celular; solo se completa la columna Celular y se vuelve a importar.
- **Importar un archivo solo de celulares** ya funciona: basta el DNI (no exige nombre) y **no cambia el tipo** del lector (antes, un archivo sin columna Tipo habría convertido docentes en alumnos).
- **Aviso de celulares raros** en la vista previa (no son 9 dígitos que empiecen con 9, con o sin +51).
- **Panel de calidad de datos** sobre la lista: cuántos lectores no tienen DNI, nivel (carné gris), celular (no recibirán avisos) o tienen documento de otro largo; si todo está completo, lo indica.
- Versión 23.0.0, service worker `sigie-v42`.

### Estado del módulo Lectores (cerrado)
Ficha con DNI y cargo · importación Excel/CSV/JSON con vista previa y sin duplicados · plantillas alumnos, personal y celulares · carnés por color de nivel e impresión por aula · búsqueda por DNI · calidad de datos · DNI nunca impreso ni público.
No incluido: listas desplegables en las plantillas (la librería de Excel del sistema no las escribe).

### Pruebas
`test/lectores.test.js`: 5 pruebas (2 nuevas). `test/ui-v20.test.js` pasa.

### Siguiente módulo
OPAC: reservas desde el celular del lector (requiere decidir cómo se identifica el lector con seguridad).

---

## Versión 22 — Reporte en color por aula

### Qué hay de nuevo (Biblioteca → Reportes en color → 🏫 Reporte por aula)
- Selector de aula (con la cantidad de lectores) y de periodo (90 días / este año / todo).
- 4 tarjetas de color: lectores, préstamos del periodo, **participación** (% de lectores del aula que pidieron algo) y vencidos ahora (rojo si hay).
- **Lo que más leen**: barras con el color de cada categoría.
- **Lectores con más préstamos**: top 5 con 🥇🥈🥉.
- **Sin préstamos en el periodo**: lista en píldoras ámbar, para que el docente los motive.
- Imprimir / PDF con colores y CSV. Es un reporte interno (muestra nombres): no se publica en el OPAC.
- Versión 22.0.0, service worker `sigie-v41`.

### Pruebas
`resumenAula` (1 prueba nueva en `test/reportes-color.test.js`); `test/ui-v20.test.js` ahora recorre también este reporte y cambia de aula. La prueba del OPAC pasó a `test/ui-v21.test.js` porque al correr dos pantallas jsdom en un mismo proceso la segunda se quedaba sin tiempo para cargar.

### Pendiente
Reservas desde el OPAC (a definir el acceso del lector), revisar fallo preexistente de `ui-biblioteca-v9`.

---

## Versión 21 — OPAC: últimos agregados, más leídos y portadas

### Qué hay de nuevo (página pública `/opac.html`)
- **✨ Últimos agregados**: los 12 libros ingresados más recientemente. La fecha de ingreso se deduce del identificador interno del libro; los libros sin ese dato (por ejemplo, datos de ejemplo antiguos) no aparecen aquí.
- **🏆 Más leídos**: los 12 libros más prestados, con «prestado N veces». Solo cuenta préstamos; no muestra quién.
- **Portadas**: si el libro tiene un ISBN válido (10 o 13 dígitos) se intenta cargar la portada desde Open Library; si no existe o no hay internet, se queda el lomo de color de la categoría.
- Versión 21.0.0, service worker `sigie-v40`.

### Privacidad
El endpoint `/api/opac` sigue sin entregar nombres de lectores. Ojo: las portadas hacen que el navegador de quien consulta pida las imágenes a `covers.openlibrary.org` (ese sitio ve su IP). Si no se quiere eso, quitar el `<img>` en `opac.js`.

### Archivos
Cambios en `opac-util.js`, `opac.js`, `opac.html`; pruebas nuevas en `test/opac.test.js` y `test/ui-v20.test.js` (carga el `opac.html` real contra el servidor).

### Pendiente
Reservas desde el OPAC (requiere identificar al lector con seguridad y un endpoint que escriba; se decidió no abrirlo sin diseño de seguridad), reporte en color por aula, revisar fallo preexistente de `ui-biblioteca-v9`.

---

## Versión 20 — Reportes en color

### Qué hay de nuevo
- **Biblioteca → Reportes en color** (3 reportes, con selector de periodo donde aplica, «Imprimir / PDF» y «CSV»):
  - 🔥 **Lectura por categoría y nivel**: mapa de calor; el color de cada fila es el de su categoría y se intensifica con más préstamos.
  - 🚦 **Vencidos por aula**: semáforo amarillo (1–7 días), naranja (8–15) y rojo (más de 15).
  - 📚 **Colección por categoría**: barras con el color de cada categoría (títulos y ejemplares; ignora bajas).
- Los colores salen al imprimir. El **CSV no lleva color** (el Excel del sistema no escribe estilos); los reportes oficiales existentes no se tocaron.
- Versión 20.0.0, service worker `sigie-v39`.

### Archivos nuevos
`reportes-color-util.js`, `reportes-color.js`, `test/reportes-color.test.js` (3 pruebas), `test/ui-v20.test.js` (dibuja Lectores, OPAC y los 3 reportes con datos de ejemplo en jsdom).

### Pendiente
Portadas, «Novedades» y «Más leídos» y reservas en el OPAC; botón de reporte en color por aula individual; revisar fallo preexistente de `ui-biblioteca-v9`.

---

## Versión 19 — OPAC dentro del sistema, carnés por color y búsqueda por DNI

### Qué hay de nuevo
- **Biblioteca → Catálogo público (OPAC)**: muestra el enlace, botón «Copiar enlace», «Abrir el catálogo» y un cartel con QR para imprimir. Avisa si se abre desde `localhost` (ese enlace solo sirve en esa PC) o si el sistema no corre con el servidor local.
- **Carnés por color de nivel**: Primaria verde, Secundaria azul, personal ámbar, sin nivel gris (borde grueso a la izquierda).
- **Búsqueda por DNI exacto** en Lectores (el DNI no se imprime en el carné).
- Título de la pantalla registrado con el gancho `BIB_TITULOS9` (nuevo en `app.js`).
- Versión 19.0.0, service worker `sigie-v38`.

### Archivos nuevos
`opac-panel.js`; cambios en `lectores.js`, `lectores-util.js`, `app.js`, `index.html`, `build.js`, `server.js`, `sw.js`.

### Pruebas
168 pruebas con `jsdom` instalado. Fallo ya existente (también en el zip original v16): `ui-biblioteca-v9` «se ven las reseñas del ejemplo». Algunas pruebas de interfaz y de ficha UGEL fallan de forma intermitente solo en la corrida completa (tiempos de arranque); solas pasan.

### Pendiente
Portadas, «Novedades» y «Más leídos» en el OPAC, reservas desde el OPAC, reportes multicolor. Revisar el fallo de v9 (preexistente).

---

## Versión 18 — OPAC (catálogo de consulta público)

### Qué hay de nuevo
- Página pública `http://<servidor>:<puerto>/opac.html`: sin inicio de sesión, solo lectura, hecha para celular (modo claro/oscuro).
- Búsqueda por título, autor, código, editorial o categoría (sin importar tildes), chips de colores por categoría, filtro «solo disponibles».
- Cada libro muestra: lomo de color de su categoría, estante, y «Disponible (2 de 3)» o «Prestado · vuelve el dd/mm/aaaa».
- **Privacidad**: el endpoint `/api/opac` solo entrega datos del libro. Nunca nombres de lectores, DNI ni quién tiene el libro. Tiene límite de consultas por minuto. Los demás `/api/…` siguen exigiendo sesión (verificado: 401).
- Versión 18.0.0, service worker `sigie-v37`.

### Archivos nuevos
`opac.html`, `opac.js`, `opac-util.js`, `test/opac.test.js` (2 pruebas). Cambios en `server.js` (ruta pública y lista de archivos), `build.js`, `sw.js`.

### Pruebas
167 pruebas: 146 pasan, 0 fallan, 21 se omiten (falta `jsdom`).

### Pendiente
Portadas de libros, «Novedades» y «Más leídos» en el OPAC, reservas desde el OPAC, botón/QR del OPAC dentro del sistema, carnés por color de nivel, reportes multicolor.

---

## Versión 17 — Lectores: DNI, importación con vista previa y plantillas

### Qué hay de nuevo
- **DNI y cargo** en la ficha del lector (nuevo y editar). No se muestra en carnés. Un DNI repetido se rechaza.
- **Importar (Excel / CSV / JSON)** con vista previa: nuevos, se actualizan, sin cambios y errores. Nada se guarda hasta confirmar.
- **Sin duplicados**: empareja por DNI; si el lector antiguo no tenía DNI, por nombre. Reimportar el mismo archivo no cambia nada.
- **Plantillas descargables** (Excel): alumnos y personal, con hoja de instrucciones.
- Lee directo el JSON de la lista de nombres (ALU→Alumno, DOC→Docente, ADM/VIG→Otro). Probado con 459 personas: 0 errores, 9 avisos (códigos de 14 dígitos).
- Versión 17.0.0, service worker `sigie-v36`.

### Archivos nuevos
`lectores-util.js`, `lectores.js`, `test/lectores.test.js` (3 pruebas).

### Pendiente (próximos avances)
OPAC, carnés por color de nivel, búsqueda por DNI en la lista, reportes multicolor. Las plantillas no traen listas desplegables (la librería de Excel del sistema no las escribe).

---

## Versión 16 — Inicio con gráficos en 3 columnas

### Qué hay de nuevo
El módulo **Inicio** (Biblioteca) pasó de 8 números y 2 listas a un tablero de **6 indicadores + 15 tarjetas**, en una cuadrícula de **3 columnas** (2 en tablet, 1 en celular):

| Fila | Contenido |
|---|---|
| 1–2 | 6 indicadores: ejemplares, prestados ahora, vencidos, reservas listas, prestados hoy (con minigráfico de 14 días), lectores activos |
| 3 | **Requiere atención** (alertas con botón de acción) · **Vencidos más atrasados** |
| 4 | **Movimiento de 6 meses** (columnas) · **Estado de los préstamos** (dona: al día / por vencer / vencidos) |
| 5 | **Actividad diaria** de 30 días (líneas) · **Devoluciones a tiempo** (medidor + promedio de días) |
| 6 | **Préstamos por día de la semana** · **Libros por categoría** · **Disponibilidad** (dona) |
| 7 | **Más prestados** · **Préstamos por grado** · **Lectores más activos** |
| 8 | **Estado de conservación** · **Reservas** · **Lectores por tipo** |
| 9 | **Rotación por categoría** · **Estantes verificados** (medidor) · **Pulso de la colección** |

- Los gráficos son **SVG propio** (sin Chart.js ni internet): cargan al instante y funcionan sin conexión. Pasa el mouse sobre una barra, punto o sección para ver su valor.
- Cada tarjeta con detalle tiene un botón **Abrir** que lleva a la pantalla correspondiente.
- Si no hay datos, cada tarjeta lo dice con un mensaje claro en vez de mostrar un gráfico vacío.
- Seguridad: si el nuevo Inicio fallara al dibujarse, el sistema muestra automáticamente el Inicio anterior.
- Versión 16.0.0, service worker `sigie-v35`; archivos nuevos registrados en `index.html`, `build.js`, `sw.js` y `server.js`.

### Archivos nuevos
`inicio-util.js` (cálculos y gráficos, lógica pura), `inicio.js` (pantalla), `test/inicio.test.js` (5 pruebas: cálculos, gráficos, pantalla completa, biblioteca vacía y respaldo si falla). Los estilos están al final de `styles.css` (bloque «v16»).

### Pruebas
162 pruebas: 141 pasan, 0 fallan, 21 se omiten porque `jsdom` no está instalado (con `npm install` corren).

### Notas
- Los periodos son fijos y se indican en cada tarjeta (30 días, 90 días, 12 meses), para que el Inicio no cambie según el filtro de otros reportes.
- «Panel general» (bienes patrimoniales) no se tocó; si lo quieres con el mismo estilo de tarjetas y gráficos, se puede hacer igual.

---

## Versión 15 — Rediseño amigable (estilo Lectómetro)

### Qué hay de nuevo
- 🎨 **Botones más presentables**: más grandes y redondeados, con efecto al pasar el mouse y al presionar. Los botones de acción principal (Guardar, Nuevo, Registrar, Crear...) se ven en ámbar; Eliminar en rojo suave; Cancelar discreto.
- 🔣 **Íconos de línea** en el menú lateral (reemplazan los emojis y símbolos mezclados) y en los botones, según su texto (Guardar, Nuevo, Editar, Eliminar, Excel, Imprimir, Buscar...). Los íconos van **dentro del sistema** (`ui-iconos.js`): funcionan sin internet.
- 🧱 **Tarjetas e indicadores (KPI)** con barra de color a la izquierda, como en Lectómetro.
- 📋 **Tablas** con más espacio entre filas, encabezado claro y resaltado cálido al pasar el mouse.
- 📝 **Formularios**: campos más cómodos y foco ámbar visible. **Ventanas** y **avisos** con esquinas más suaves.
- 🔖 **Pestañas tipo píldora** y **estados vacíos** con recuadro punteado que invita a actuar.
- 🔤 **Tipografía** Fraunces (títulos) + Inter (texto), igual que Lectómetro.
- 📱 **Celular**: botones de mínimo 44 px para tocar con el dedo.
- Versión 15.0.0, service worker `sigie-v34`; archivo nuevo registrado en `index.html`, `build.js`, `sw.js` y `server.js`.

### Cómo está hecho
- Todo el cambio visual está en un bloque al **final de `styles.css`** (desde «v15 — Rediseño amigable»). No se tocó la lógica del sistema. Si algo no gusta, se borra ese bloque y vuelve el look anterior.
- Único cambio en `app.js`: el menú pide el ícono a `iconoNav()` y, si no hay uno, muestra el símbolo de antes.
- Los íconos de botones se agregan solos al cargar cada pantalla; los botones que ya traen su propio emoji se respetan.

### Archivos nuevos
`ui-iconos.js`, `test/ui-iconos.test.js` (2 pruebas: cobertura de íconos del menú y respaldo).

### Pruebas
157 pruebas: 136 pasan, 0 fallan, 21 se omiten porque `jsdom` no está instalado (con `npm install` corren).

### Notas
- Las fuentes nuevas se bajan de Google Fonts; sin internet se usa una tipografía parecida del sistema.
- Revisé el diseño en una maqueta con los estilos reales, pero conviene recorrer las pantallas con datos reales (sobre todo Bienes patrimoniales y Préstamos) y avisarme si alguna se ve rara.

---

## Versión 14 — Uso de la colección

### Qué hay de nuevo
- 📉 **Uso de la colección** (grupo Biblioteca, justo después de «Reporte general»). Con filtro de periodo (este año, últimos 12 meses o todo el historial):
  - **Resumen**: títulos y ejemplares, % de títulos con algún préstamo, libros que nunca se han prestado y préstamos por ejemplar.
  - **Rotación por categoría**: gráfico y tabla (títulos, préstamos, rotación, % en uso).
  - 🔥 **Alta demanda**: libros con lectores en lista de espera o que rotan al menos el doble del promedio (mínimo 2 préstamos por ejemplar). Sirve para decidir qué comprar o duplicar; se complementa con *Sugerencias de compra*.
  - 💤 **Sin movimiento**: primero los que nunca salieron y luego los que llevan más tiempo quietos. Sirve para el cotejo anual: exhibirlos en la cartelera lectora o revisar su estado.
  - ⬇ **Excel** con 4 hojas: Libros, Por categoría, Alta demanda y Sin movimiento (listas completas). También se puede imprimir.
- La paleta Ctrl+K encuentra la vista sola.
- Versión 14.0.0, service worker `sigie-v33`; archivos nuevos registrados en `index.html`, `build.js`, `sw.js` y `server.js`.

### Archivos nuevos
`coleccion-util.js` (lógica pura), `coleccion.js` (pantalla), `test/coleccion.test.js` (5 pruebas: lógica y pantalla dibujada con los scripts reales en un sandbox de Node).

### Pruebas
155 pruebas: 134 pasan, 0 fallan, 21 se omiten porque `jsdom` no está instalado (con `npm install` corren).

### Notas
- Los libros dados de baja no cuentan; los préstamos perdidos sí cuentan como uso.
- Sigue pendiente lo de siempre: familias/estudiantes/padres (privacidad de menores), la prueba `ui-biblioteca-v9` que ya fallaba desde la v11 (necesita jsdom para reproducirla) y `npm run build` (sin red).

---

## Versión 13 — Panel «Mi lectura» y gráficos del tablero

Cierra dos de los pendientes que dejó la v12. Los otros dos siguen fuera a propósito (ver abajo).

### Qué hay de nuevo

- 📖 **Mi lectura** (grupo *Lectómetro y diplomas*, justo debajo del Lectómetro): el personal busca al lector por nombre o escanea su carné y ve:
  - 🎯 **Meta del mes**: libros leídos este mes contra la meta (la del aula si tiene una fijada en *Retos de lectura*; si no, la meta personal de 4), cuántos faltan, cuántos días quedan y si va al día o atrasado.
  - 📈 **Tendencia de 14 días**: gráfico de minutos leídos por día, y comparación de la última semana contra la anterior (sube / baja / igual).
  - 📚 **Para leer a continuación**: hasta 5 libros **con ejemplares libres** que el lector aún no leyó, según la categoría y el autor de lo que ya leyó y valoró con 4 o 5 estrellas, y los más pedidos y mejor valorados del colegio. Cada tarjeta dice por qué se recomienda. El personal puede **prestar** el libro desde ahí (respeta los límites y bloqueos de préstamo de siempre).
  - 🖨 Se puede imprimir.
- 📊 **Gráficos en el Tablero del director** (debajo de lo que ya tenía): lecturas por día (30 días), préstamos por mes (6 meses), comprensión AD/A/B/C del año y aulas que más leen (puntos por alumno). Si aún no hay datos, cada gráfico muestra un aviso en vez de quedar vacío.
- Los gráficos son SVG propios (sin librerías ni internet), con título accesible y todo el texto escapado.
- La paleta **Ctrl+K** ya encuentra «Mi lectura» sola.
- Versión 13.0.0 (`package.json`, `manifest.json`), service worker `sigie-v32`, archivos nuevos registrados en `index.html`, `build.js`, `sw.js` y la lista pública de `server.js`.

### Archivos nuevos
- `panel-util.js` — lógica pura (series, tendencia, meta, recomendaciones, SVG). Funciona en navegador y en Node.
- `lectura-panel.js` — solo dibuja y conecta botones.
- `test/panel-util.test.js` (10 pruebas) y `test/lectura-panel.test.js` (6 pruebas que dibujan las pantallas con los scripts reales en un sandbox de Node; no necesitan jsdom).

### Pruebas
150 pruebas: 129 pasan, 0 fallan, 21 se omiten porque `jsdom` no está instalado (las mismas 21 de la v12; corren con `npm install`).

### Lo que NO se hizo (y por qué)
- **Seguimiento para familias, e ingreso de estudiantes y padres**: siguen fuera por la privacidad de menores. «Mi lectura» se consulta en la biblioteca con el carné; no hay cuentas ni enlaces para familias.
- **La prueba `ui-biblioteca-v9` («se ven las reseñas del ejemplo»)**: ya fallaba en la v11 y no se tocó. Es una prueba de pantalla (necesita jsdom, que no estaba disponible aquí), así que no pude reproducirla. Revisé con los datos de ejemplo la hipótesis de que la primera reseña quedaba fuera de las 30 «Últimas reseñas» y **no se confirma** (sí aparece), así que la causa sigue sin identificar.
- **Las pruebas de pantalla con jsdom del panel nuevo**: no las incluí porque no pude ejecutarlas aquí y no quiero entregar pruebas sin verificar. Las 6 pruebas en sandbox cubren el dibujo y el escape de HTML.
- `npm run build` (esbuild) sigue sin poder ejecutarse sin red.
- «Panel CIST»: lo interpreté como el **Tablero del director** (en el código no existe otro panel con ese nombre). Si te referías a otra pantalla, dime cuál y muevo los gráficos.

---

## Versión 12 — Catálogo de consulta, sugerencias de compra, reportes del Lectómetro y paleta Ctrl+K

Ideas tomadas de sistemas como Koha (OPAC, sugerencias de compra con estado, vitrina de novedades) y de las páginas originales del Lectómetro (Reportes).

- 🔎 **Catálogo de consulta (OPAC)** (grupo Biblioteca): búsqueda por título, autor, código o Dewey; filtro por categoría y «solo disponibles»; muestra cuántos ejemplares hay libres; vitrina de **novedades** al abrir.
- 💡 **Sugerencias de compra**: cualquier lector (registrado por el personal) pide un título; el administrador la pasa a Aprobada, Comprada o Rechazada. Aviso en la campanita y contador en el menú.
- 📑 **Reportes del Lectómetro** (grupo Lectómetro y diplomas): filtro por aula y fechas, totales, lectores activos, páginas, minutos, opinión promedio, puntos y niveles de comprensión (AD/A/B/C). Exporta a Excel e imprime.
- ⌨ **Paleta de búsqueda global**: Ctrl+K (o «/») abre un buscador para saltar a cualquier módulo con el teclado.
- Versión 12.0.0 (package.json, manifest.json), service worker `sigie-v31`, `build.js` incluye `mejoras.js`.

### Pendiente (no hecho en esta versión)
Panel «Mi lectura» con meta mensual y tendencia, seguimiento familiar, ingreso de estudiantes/padres, gráficos del Panel CIST. Siguen pendientes por su alcance y por privacidad de menores.

---

## Versión 11 — Lectómetro integrado, diplomas con verificación y respaldo externo

### Qué hay de nuevo

#### Lectómetro dentro de la biblioteca (grupo del menú «Lectómetro y diplomas»)
El Lectómetro (LectorIEP) ya no es un sistema aparte: usa **los mismos lectores, carnés LEC-…, libros y préstamos** de la biblioteca.

| Vista | Qué hace |
|---|---|
| 📈 Lectómetro | Bitácora de lectura (libro, páginas, minutos, opinión, comentario). Puntos (2 por página, 0,5 por minuto), racha, nivel de lector (Explorador → Aventurero → Sabio → Leyenda) y 8 insignias. Certificado de lectura imprimible. |
| 📝 Evaluaciones de lectura | Cuestionarios por libro con calificación automática. El resultado se guarda **también en Comprensión lectora** (91+ = AD, 71+ = A, 51+ = B, menos = C), así alimenta la ficha UGEL. Un lector no puede rendir dos veces la misma evaluación. |
| 🏆 Ranking y niveles | Por puntos, con filtro por aula, ranking de aulas (puntos por alumno matriculado) y exportación a Excel. |
| 🎁 Premios y canjes | Catálogo con costo y stock; canje con saldo; entrega; anulación (devuelve puntos y stock). |
| 📅 Plan lector: actividades | Fechas del plan lector; aviso en la campanita de las próximas (7 días) y vencidas. |

- **Puntos, nivel, racha e insignias no se guardan: se calculan** con la bitácora, los préstamos, las reseñas y las evaluaciones. No se desfasan y no chocan cuando dos computadoras guardan a la vez.
- **Importar de LectorIEP**: botón en la vista Lectómetro. Lee el `.json` de «Base de datos → Descargar respaldo» del Lectómetro viejo, reutiliza lectores por nombre, enlaza libros por título y trae bitácora, evaluaciones, resultados, premios, canjes, actividades y préstamos. **No borra ni modifica nada**; muestra un resumen antes de importar y se puede repetir sin duplicar. Los puntos que la bitácora no explicaba se conservan.

#### Diplomas con código único y verificación (🎖)
- Se generan desde: nivel de lector del Lectómetro, libros leídos en el año, comprensión AD, o a mano.
- Cada diploma lleva **código único D-XXXX-XXXX** (sin letras confundibles), **folio correlativo por año** y **QR de verificación**. El código no depende del alumno ni del año de impresión.
- No se repite el mismo diploma para el mismo lector y año. Registro con entrega (fecha y quién recibió), **reimpresión como DUPLICADO** y anulación con motivo (el folio no se reutiliza).
- **Verificación pública** `verificar.html` (sin iniciar sesión): dice si es auténtico, anulado o inexistente y muestra solo el **nombre enmascarado** (`RO*** DE LA CR** DA****`), sin grado, DNI, celular ni quién lo recibió. Límite de 30 consultas por minuto por IP.
- ⚠ **El QR apunta a la dirección del servidor.** Con la instalación por defecto (`localhost`) un celular no podría abrirlo. En *Diplomas → Configuración* escribe la dirección real (p. ej. `http://192.168.1.20:3000` iniciando con `SIGIE_LAN=1`). La pantalla avisa si sigue en localhost. Desde fuera del colegio solo funciona si el servidor es accesible desde internet.

#### Tablero del director (📊)
Un solo panel: libros, préstamos vigentes/vencidos, lectores activos (30 días), lecturas del Lectómetro, % de comprensión A + AD, diplomas del año y sin entregar, premios por entregar, actividades próximas, aulas que más leen, alertas y estado de los respaldos.

#### Respaldos
- **Copia externa**: `SIGIE_BACKUP_DIR=<carpeta de otro disco o USB>` copia cada respaldo diario fuera de la carpeta del sistema (se conservan los últimos 30). Si falla, el tablero y la campanita lo avisan; botón «Copiar ahora».
- Las claves nuevas (bitácora, evaluaciones, premios, canjes, actividades, diplomas) entran en el respaldo/restauración de la biblioteca.
- Nuevas rutas: `GET /api/verificar?c=…` (pública), `GET /api/respaldos` y `POST /api/respaldos/copiar` (solo administradores).

#### Orden
- Versiones sincronizadas: `manifest.json` y `package.json` en **11.0.0** (había 7.0.0 y 10.0.0). Una prueba lo vigila.
- Service worker `sigie-v30`; `build.js` incluye los archivos nuevos y `verificar.html`.
- Los módulos nuevos se llaman por su función (`lectometro.js`, `diplomas.js`, `*-util.js`), no por número de versión.
- Datos de ejemplo: ahora incluyen bitácora, una evaluación con resultados, premios, canjes y actividades.

### Pruebas
131 pruebas (110 corren sin `npm install`; las 21 de pantalla con jsdom se omiten si no está instalado). Nuevas: `lectometro-diplomas` (lógica pura), `lectometro-pantallas` (scripts reales con DOM simulado, escape de HTML), `verificacion-respaldos` (servidor real), `versiones`, y coherencia del ejemplo.

### Lo que NO se hizo (y por qué)
- **Actualizar SheetJS 0.18.5** y llevar Bootstrap/fuentes a archivos locales: requiere descargar librerías y el entorno de desarrollo no tenía red. Pendiente.
- **Migrar a tablas SQLite reales, dividir `app.js`, HTTPS, permisos por aula en el servidor**: cambios grandes de arquitectura que merecen su propia versión y migración de datos.
- **Login de estudiantes y padres / portal para familias**: el Lectómetro viejo tenía cuentas de estudiante; aquí el personal registra y los lectores rinden evaluaciones en el equipo de la biblioteca con su carné. Un portal para familias expone datos de menores y necesita su propio diseño de privacidad.
- **PDF por lote real**: los diplomas se imprimen desde el navegador (A4 horizontal; «Guardar como PDF» funciona desde ahí).
- `npm run build` (esbuild) no se pudo ejecutar sin red; el resto del flujo está probado.
- El archivo suelto `sistema-diplomas-13.html` **no se modificó**; sus problemas (código no único, duplicados por año actual, `cuerpo` sin escapar al importar respaldos, nombres reales dentro del código) quedan resueltos solo en el módulo integrado.

---

## v10.0.0 — Plan lector medible

Cuatro funciones nuevas, todas calculadas con los préstamos que el sistema ya registra. Las bases existentes siguen funcionando:
solo se agregan claves nuevas (`sigie:bib_lecturas`, `sigie:bib_comprension`, `sigie:bib_sanciones`, `sigie:bib_metas`) y un campo
opcional `lecturaId` en los préstamos hechos desde una lectura asignada.

### 📖 Lecturas por aula (menú: *Lecturas por aula*)
- El docente asigna un libro a un aula con **fecha límite** (buscador de títulos, indicación opcional).
- Cada fila muestra **recibieron / devolvieron / atrasados** y una barra de avance. *Atrasado* = pasada la fecha límite sin devolver,
  lo haya recibido o no. También cuenta el préstamo que el alumno hizo por su cuenta desde la fecha de asignación.
- Botón **Prestar**: abre el *Préstamo por aula* de la v8 ya con el aula, el libro y los días hasta la fecha límite; los préstamos
  quedan ligados a la lectura (`lecturaId`) y siguen devolviéndose por lote.
- **Ver**: lista por alumno (estado, fechas) con el nivel de comprensión de cada uno; Excel por lectura y general.
- Aviso en **Inicio** y número en el menú con los alumnos atrasados. Quitar una lectura no borra préstamos.

### 🧠 Comprensión lectora AD / A / B / C (menú: *Comprensión lectora*)
- Escala: AD logro destacado · A logro esperado · B en proceso · C en inicio.
- Se registra: en el detalle de una lectura (un selector por alumno que ya devolvió), desde *Devoluciones recientes sin evaluar*,
  o **al devolver** en Mostrador/Préstamos si se activa en *Reglas de préstamo* (viene **apagado**, para no cambiar el flujo actual).
  Al devolver se pide primero la comprensión y luego la reseña; teclas A, B, C y D (= AD).
- Informe por **grado y sección, grado o nivel**, periodo (año / 90 días / todo), % en A + AD, con encabezado de la I.E.
  Excel (hojas por aula, grado, nivel y detalle) e impresión, pensado para la UGEL.
- Solo alumnos: docentes y personal no se evalúan. **Solo quien puede editar** (ADMIN, ADMIN2, DOCENTE) la registra; CONSULTA la ve pero no
  puede registrar (comprobado también contra el servidor).

### 🎯 Meta mensual por aula (dentro de *Retos de lectura*)
- Meta de libros por mes para cada aula, con barra de avance y ✅ cuando se cumple. **Leídos** = devueltos dentro del mes (sin perdidos);
  *en curso* = prestados ese mes y aún sin devolver.
- *Fijar para todas las aulas*: N libros por alumno × alumnos del aula; después se ajusta aula por aula. Selector de mes.

### ⏳ Sanción proporcional al atraso (opcional; apagada)
- *Reglas de préstamo* → casilla **Sanción proporcional al atraso**, días de suspensión por cada día de atraso (0,5 a 10) y tope en días.
- Al devolver un libro vencido se registra la suspensión; el lector no puede llevar libros (Mostrador, Préstamos y préstamo por aula)
  hasta la fecha indicada. No se acumulan: queda la más larga. Los libros perdidos no sancionan.
- Vista *Sanciones por atraso* (aparece en el menú solo si la política está activa o hay historial): suspendidos hoy, historial y **Levantar**.
- Se suma al bloqueo existente (`bloquear`), que sigue impidiendo prestar mientras haya un libro vencido en poder del lector.
  Apagar la política desactiva el efecto de las sanciones ya registradas.

### Archivos
- Nuevo `biblioteca.js` (antes biblioteca6.js) (pantallas). Lógica pura en `bib-util.js`: `avanceLectura`, `resumenComprension`, `devolucionesSinComprension`,
  `metaMensual`, `calcularSancion`, `sancionVigente`, `NIVELES_LOGRO`.
- `index.html`, `sw.js` (**sigie-v29**), `build.js`, `server.js` registran el archivo nuevo. El **respaldo** y los **datos de ejemplo**
  incluyen las claves nuevas (el ejemplo trae 3 lecturas —una vencida, una vigente, una completa—, evaluaciones y metas).
- `biblioteca.js` (antes biblioteca4.js): `bibAulaModal` acepta un aula/libro/lectura preelegidos. `biblioteca.js` (antes biblioteca2.js): campos nuevos en Reglas.

### Pruebas
- `npm test`: **90 pruebas** (antes 79). Nuevas: 11 de lógica pura (`test/bib-util-v10.test.js`). La de datos de ejemplo ahora carga `bib-util.js`.
- `node test/e2e-v10.js`: recorrido de **22 pasos en un navegador real** (Chromium con Playwright) contra el servidor real, sin internet:
  asignar y prestar, niveles, encadenado al devolver, sanción, metas, respaldo, y permisos de ADMIN, DOCENTE y CONSULTA.
  No forma parte de `npm test` (requiere `npm i -D playwright && npx playwright install chromium`).
- Las pruebas de pantalla con jsdom de la v10 **no** se escribieron (jsdom no estaba disponible); las cubre el recorrido anterior.
- Hallazgos del recorrido ya corregidos: los atajos de teclado de la ventana de comprensión no funcionaban hasta hacer clic dentro;
  el informe incluía a docentes en "DOCENTES Y PERSONAL".

### No incluido / límites
- **Calendario de actividades** (opcional en el plan): no se hizo.
- No se ejecutó `npm run build` (esbuild no estaba instalado); el archivo nuevo está registrado en `build.js`.
- En el ejemplo, el libro de cada lectura tiene un ejemplar por alumno; en un colegio real hacen falta tantos ejemplares como alumnos
  para prestar el mismo título a toda el aula (si no, quedan "sin ejemplar libre").
- Los permisos siguen siendo por rol (no por aula del docente), como en la v8.

---

## v9.0.0 — Ideas del Lectómetro en la biblioteca

Tres funciones nuevas, todas calculadas con los préstamos que el sistema ya registra. Las bases existentes siguen funcionando:
solo se agrega una clave nueva (`sigie:bib_resenas`); el formato de los demás datos no cambió.

### ⭐ Reseña y estrellas al devolver (menú: *Reseñas y más leídos*)
- Al devolver un libro en el **Mostrador (escáner)** o en **Préstamos de libros** se abre una ventana: 1 a 5 estrellas (clic o tecla 1–5)
  y un comentario opcional. **Omitir** no guarda nada y la devolución ya quedó registrada.
- En el Mostrador, al cerrar la ventana el cursor vuelve al campo del escáner.
- Si se devuelve **por aula** (lote), no se interrumpe con 30 ventanas: esas devoluciones aparecen en *Devoluciones recientes sin reseña*
  (últimos 30 días) con el botón **★ Reseñar**.
- Un préstamo se reseña una sola vez. Se puede eliminar una reseña desde la lista.
- **Catálogo**: nueva columna ★ con el promedio y la cantidad de reseñas de cada libro.
- **Más leídos y mejor valorados**: ranking por préstamos del periodo (este año / 90 días / todo), con promedio de estrellas. Excel incluido.
- **Reglas de préstamo** → casilla *Pedir reseña (estrellas) al devolver un libro* para apagarlo.

### 💤 Lectores sin actividad (menú: *Lectores sin actividad*)
- Alumnos cuyo último préstamo o devolución fue hace N días o más (por defecto **30**; se cambia en la pantalla o fija en *Reglas de préstamo*).
- Quien tiene ahora un libro **sin vencer** no aparece (está leyendo). Los dados de baja y los docentes no se incluyen.
- Resumen **por aula** (alumnos, sin actividad, %), lista filtrable por aula, columna con el celular del apoderado, Excel e impresión.
- Los que **nunca sacaron un libro** se marcan aparte.
- Aviso en **Inicio** (“N alumno(s) sin leer hace más de 30 días”), número en el menú y línea en el resumen de alertas.

### 🎓 Certificado de lector (menú: *Certificados de lector*)
- Candidatos = lectores con un mínimo de libros **devueltos** (sin los perdidos) en el año o en todo el historial (mínimo por defecto: 3).
- Filtro por aula, casillas para incluir o quitar a alguien, insignia según los libros (🥉 3 · 🥈 6 · 🥇 10 · 🏆 20, las de Retos de lectura).
- Se imprime en **A4 horizontal, un certificado por hoja**, con el nombre de la institución y dos firmas editables.

### Archivos
- Nuevo `biblioteca.js` (antes biblioteca5.js) (pantallas). Lógica pura nueva en `bib-util.js`: `resumenResenas`, `rankingLibros`, `devolucionesSinResena`,
  `lectoresInactivos`, `candidatosCertificado`, `certificadosHTML`.
- `index.html`, `sw.js` (**sigie-v28**), `build.js` y `server.js` registran el archivo nuevo.
- El **respaldo** de la biblioteca y los **datos de ejemplo** incluyen las reseñas.

### Pruebas
- `npm test`: **79 pruebas** (antes 68). Nuevas: 5 de lógica pura y 6 de pantalla con jsdom (devolver con reseña / omitir / duplicado,
  Mostrador con la opción apagada, inactivos con filtro y plazo, certificados con desmarcar, respaldo).
- Una prueba de mutación (quitar la regla “tiene un libro en mano”) mostró que el primer borrador de las pruebas **no** detectaba
  ese error; se reforzaron y ahora fallan si la regla se rompe.

### Pendiente (siguientes bloques)
(Resuelto en la v10: ver CAMBIOS.md. Falta el calendario de actividades.)

---

## v8.0.0 — Seguridad real y escritura simultánea segura

### Seguridad (antes: la API no tenía autenticación)
- **Login validado por el servidor** (`POST /api/login`). Sesión en una cookie `HttpOnly` + `SameSite=Strict`
  (12 h de inactividad). Se acabó el "id en localStorage": copiar un id ya no da acceso.
- **Toda la API de datos exige sesión** (401 sin ella). `/api/health` ya no revela la ruta del archivo ni la cantidad de registros.
- **Hashes y sales nunca salen del servidor**: `GET sigie:usuarios` los quita; los respaldos ya no los incluyen.
  Las claves se hashean en el servidor (PBKDF2-SHA256, 150 000 it.; las cuentas con SHA-256 antiguo migran al entrar).
- **Permisos en el servidor**: `CONSULTA` no escribe; solo `ADMIN` gestiona usuarios/roles (validación de roles, nombres repetidos,
  mínimo un ADMIN, no auto-eliminarse); `DOCENTE` solo puede borrar fotos.
- **Cambio de clave provisional exigido por el servidor** (con clave provisional solo se puede cambiar la clave o salir).
  Cambiar la clave cierra las demás sesiones; eliminar un usuario cierra las suyas al instante.
- **Freno de intentos en el servidor** (5 fallos = 1 min por usuario+IP, tope general por IP). Bitácora de accesos escrita por el servidor.
- Las cuentas iniciales ahora las crea el servidor al arrancar.

### Escrituras simultáneas (antes: gana la última y se pierde lo otro)
- Cada clave tiene **versión**. `PUT` con `baseVersion` desactualizada → **409** con los datos actuales; la comprobación y la
  escritura son atómicas.
- `merge.js`: el navegador **fusiona por registro** (por `id`) lo suyo con lo del servidor y reintenta: préstamos simultáneos se conservan
  los dos; ediciones de campos distintos se combinan; borrar algo que otro editó lo conserva; contadores toman el mayor.
- **Sincronización cada ~10 s** y al volver a la pestaña; no cambia datos con un formulario abierto ni redibuja mientras escribes.
- Restaurar respaldo, Reiniciar y Datos de ejemplo usan escritura incondicional (`{ reemplazar:true }`).
- Los guardados de una misma clave van en fila (un doble clic ya no pierde nada).

### Biblioteca: funciones nuevas
- **Grado y sección normalizados** (`bib-util.js`): “3A / 3° A / 3ro A primaria / Tercero A” = misma aula; primaria y secundaria no se
  mezclan. Aplicado a Morosos, Ranking por aula e Informe anual.
- **📊 Estadísticas por nivel, grado y sección** con participación, promedio, vencidos y categoría más leída (Excel incluido).
- **Celular del apoderado** por lector (formulario e importación) y **📲 avisos por WhatsApp** en lote: un mensaje por familia con todos sus
  libros, validación de celulares peruanos, marca de “último aviso”. Un chat por familia: WhatsApp no permite el envío automático masivo.
- **🖨 Carnés en hojas A4 (8 por hoja)** por aula, con líneas de corte.
- **👥 Préstamo y ↩ devolución por aula** (plan lector): reparte un título entre el aula con las reglas de siempre (vencidos, tope, reservas).
- Nuevos archivos: `bib-util.js` (lógica pura, con pruebas) y `biblioteca.js` (antes biblioteca4.js) (pantallas).

### Mantenimiento
- **Menos peso al abrir:** Chart.js, JsBarcode y Tesseract ya no se cargan con `index.html` (la biblioteca no los usa). Se descargan
  solo cuando se abre el panel de bienes, se imprime una etiqueta con código de barras o se usa el lector OCR (`cargarLibreria()` en `core.js`).
  El service worker tampoco los precarga.
- **Datos de ejemplo de la biblioteca** ahora incluyen **reservas** (en espera, atendidas y canceladas) y **bajas** de libros, coherentes con el
  catálogo y los préstamos (reserva solo de libros agotados; baja solo de ejemplares que nunca se prestaron, retirados del catálogo).
- `CAMBIOS.md` indica que es historial; `DEPLOY.md` y `LEEME_INSTALACION.md` actualizados.

### Compatibilidad
- **Las bases existentes siguen funcionando**: la columna `version` se agrega sola; el formato de los datos no cambió.
- Variable nueva `SIGIE_DATA_DIR` (carpeta de datos alterna, usada por las pruebas).

### Pruebas
- Nuevo `npm test` (68 pruebas): fusión, servidor real, capa de datos del navegador, actualización desde base antigua, datos de ejemplo,
  coherencia entre archivos, lógica de la biblioteca y **pantallas con jsdom** (login, cambio de clave, todas las vistas, avisos, carnés,
  préstamo por aula). Las de pantalla se omiten si no se hizo `npm install`.
- Las pruebas de pantalla detectaron un fallo real que las demás no veían: el botón *Ingresar* del navegador no llamaba al login del servidor.
  Ya está corregido y cubierto por prueba.
- Service worker: `sigie-v27`.

### Decisión: el código patrimonial se queda
- El módulo patrimonial de `app.js` **no se elimina**: alimenta la **Ficha de Levantamiento de Información** (formato oficial UGEL,
  20 bienes por hoja) que el colegio entrega a la UGEL. Se genera desde *Reportes → Inventario completo → PDF oficial UGEL (20/hoja)*
  (todo el colegio, agrupado por aula) y desde *Planillas de verificación* (un aula). Código: `fichaBienesHTML`,
  `construirFichasHTML` y `construirInventarioCompletoFichasHTML` en `app.js`.
- **Protección:** `test/ficha-ugel.test.js` (5 pruebas, con los datos de ejemplo patrimoniales y sin tocar el servidor) comprueba:
  columnas y textos del formato oficial, 20 filas por hoja (las sobrantes en blanco), planilla correlativa 0001…N, cada bien una sola vez
  con su código patrimonial de 12 dígitos, ningún aula mezclada con otra, aulas de 20 y 21 bienes, bienes sin aula, texto con HTML
  escapado, orientación horizontal del PDF, el botón de Reportes y la pantalla de planillas, y que el rol CONSULTA (director/UGEL) puede
  verla y exportarla. Se comprobó que fallan si se rompe la ficha (19 filas, columna de código vacía, bloques de 25).
- Regla práctica: antes de recortar o mover código de `app.js`/`core.js`, correr `npm test`. Si falla `ficha-ugel`, el reporte para la UGEL cambió.

### Pendiente
- `app.js` (~7.300 líneas) sigue concentrando todo lo patrimonial: la lista de permitidos solo oculta el menú, y `wireContentEvents`
  (469 líneas) atiende todas las vistas. Si más adelante se quiere separarlo, **la ficha UGEL y lo que ella usa (bienes, aulas, custodios,
  configuración de la I.E.) deben conservarse**; lo que aún falta decidir es el destino de las demás vistas (Reportes de Gestión, modo rápido).
  Hacerlo requiere probarlo en un navegador.

### Límites conocidos
- Los permisos por aula del rol DOCENTE siguen siendo solo de pantalla.
- Con `SIGIE_LAN=1` el tráfico va por HTTP sin cifrar.
- La fusión conserva los dos préstamos si dos PC prestan el último ejemplar a la vez, y no evita códigos correlativos repetidos en altas simultáneas.

---

## v7.0.0 — Revisión completa y mejoras
### Errores corregidos
- server.js no servía `biblioteca.js` (antes biblioteca2.js) → pantalla en blanco y service worker sin instalar.
- Promoción de grado por nivel (Inicial/Primaria/Secundaria); "1ro" ya no pasa a "2ro".
- Guardar Reglas ya no borra la fecha del último respaldo.
- No se elimina un libro con préstamos activos; no se dan de baja ejemplares prestados.
- No se presta el mismo libro dos veces al mismo lector.
- Renovaciones con máximo configurable y bloqueo si hay lista de espera.
- Fechas en hora local (antes UTC: desde las 19:00 en Perú avanzaba un día).
- Estilo de las tarjetas KPI del Reporte general.
### Nuevo
- Inicio (panel del día), Revisión de datos (admin), buscador global de libros/lectores/préstamos,
  campanita con alertas de biblioteca, botón Mostrador en la barra. Archivo `biblioteca.js` (antes biblioteca3.js).
- Service worker: sigie-v24.

---

## Versiones v2 a v6 (historial)

### v4 — biblioteca: ISBN, morosos y uso de la colección
- **Autocompletar por ISBN** (Nuevo/Editar libro): botón "🔍 Buscar" o Enter (sirve con lector de código de barras USB). Consulta Open Library y, si no está, Google Books. Llena título, autor y editorial solo en campos vacíos y avisa si el ISBN ya existe en el catálogo. Requiere internet.
- **Morosos por grado/sección** (Préstamos → "📋 Morosos por grado"): filtro por días de atraso, "Copiar aviso para el tutor", recordatorio por estudiante, impresión/PDF con columna de firma y Excel.
- **Uso de la colección** (Reporte general): % de títulos que han circulado, rotación por categoría, categorías por uso y libros que nunca salieron. El Excel suma las hojas "Uso por categoría" y "Sin préstamos".
- Service worker: `sigie-v18`.

### v5 — biblioteca: reglas, mostrador, reservas, bajas, promoción y retos
- **Reglas de préstamo** (Préstamos → ⚙ Reglas): máximo de libros y días de plazo por tipo de lector (Alumno 2/7, Docente 5/15 por defecto) y bloqueo mientras haya un libro vencido.
- **Mostrador (escáner)**: campo siempre enfocado para lector de código de barras USB. Escanear carné + libros presta; escanear un libro que ya tiene el lector lo devuelve.
- **Reservas y lista de espera**: al devolverse un libro se aparta para el primero de la fila (días configurables) y se puede avisar por WhatsApp.
- **Bajas y pérdidas**: botón ⬇ en el catálogo y “Perdido” en préstamos; motivo, lector responsable, resumen por motivo, Excel y acta de baja imprimible.
- **Nómina y promoción** (Lectores): promueve de grado a todos, egresa a los del último grado e importa la nómina anual (actualiza, agrega y da de baja).
- **Retos de lectura**: ranking por aula (libros por alumno matriculado) e insignias 🥉🥈🥇🏆.
- Service worker: `sigie-v19`.

### v5.1 — respaldo e informe por nivel
- **Respaldo de biblioteca** (Reporte general → 💾 Respaldo): descarga un JSON con libros, lectores, préstamos, reservas, bajas y reglas. Solo administradores pueden **restaurarlo** (reemplaza los datos). Aviso en Préstamos si pasan más de 14 días sin respaldo. Con el servidor local, además se sigue creando el respaldo diario de toda la base en data/backups/.
- **Informe por nivel** (Reporte general → 📑): fondo bibliográfico, bajas del año, préstamos y participación por nivel (Inicial/Primaria/Secundaria/Docentes), libros más prestados y firmas. Base para el formato que pida la UGEL.
- Service worker: `sigie-v20`.

### v5.2 — alta por ISBN, etiquetas por estante y egresados
- **Importar ISBN** (Libros): pega o escanea una lista de ISBN; crea libros con título, autor y editorial, suma ejemplares a los repetidos y lista los no encontrados.
- **Etiquetas QR por estante**: nuevo filtro por estante además de la categoría.
- **Egresados con libros pendientes**: aviso en Préstamos con cuántos libros siguen en manos de lectores dados de baja.
- Service worker: `sigie-v21`.

### v5.3 — Ficha de Levantamiento UGEL para libros
- **Reporte general → 📋 Ficha UGEL (formato oficial)**: usa la misma “Ficha de Levantamiento de Información” del inventario patrimonial (20 filas por hoja, firmas, planilla N° correlativa), agrupada por estante, con opción de una fila por ejemplar, filtro por categoría y descarga en Excel con las mismas columnas.
- Service worker: `sigie-v22`.

### v6 — Reportes y exportación de biblioteca
Nuevo menú **Biblioteca → Reportes y exportación**, espejo del módulo del inventario patrimonial, adaptado a libros (PDF de 20 filas por hoja con el mismo encabezado, CSV y Excel):
Inventario completo (ficha oficial UGEL) · Relación por estante · Kardex de movimientos · Registro de inventarios por estante (reemplaza calibraciones) · Libros por lector (por responsable) · Libros por uso (por monto) · Pendientes por antigüedad · Conservación y reposición (reemplaza depreciación) · Acta de toma de inventario físico · Informe de bajas (acta) · Resumen semanal de alertas (correo/copiar) · Catálogo codificado tipo SBN · Cotejo con la cartelera lectora + acta TXT (conciliación) · Informe anual por nivel (ejecutivo) · Respaldo/restauración.
No se adaptó: depreciación NICSP, calibraciones, RAEE ni conciliación contable, porque los libros no tienen valor ni vida útil registrados.
- Service worker: `sigie-v23`.
