/* =========================================================================
   SIGIE — Biblioteca: lógica pura (sin pantalla, sin base de datos)
   -------------------------------------------------------------------------
   Todo lo de aquí recibe datos y devuelve datos, así que se prueba con
   `npm test` sin abrir un navegador. Las pantallas (biblioteca*.js) solo
   llaman a estas funciones y dibujan el resultado.

     parsearGrado / claveGrado   "3° A", "3A", "3ro A primaria" → mismo grupo
     normalizarTelefono          celulares peruanos → formato wa.me (51 + 9 dígitos)
     avisosMorosos               un mensaje por lector (con todos sus libros vencidos)
     estadisticasPorGrupo        préstamos, participación y atraso por nivel / grado / sección
     carnesHTML                  hojas de carnés (8 por página A4) listas para imprimir
     resumenResenas / rankingLibros / devolucionesSinResena   estrellas por libro y "más leídos" (v9)
     lectoresInactivos           lectores que dejaron de leer (v9)
     candidatosCertificado / certificadosHTML   certificado de lector imprimible (v9)
     agruparTitulos / asignarAula   préstamo de un mismo título a toda un aula (plan lector)
     lotesActivos                préstamos por aula pendientes de devolver
     avanceLectura               lecturas asignadas por aula: recibieron / devolvieron / atrasados (v10)
     resumenComprension          niveles de logro AD / A / B / C por aula, grado o nivel (v10)
     metaMensual                 meta de libros por mes y aula, con avance (v10)
     calcularSancion / sancionVigente   suspensión proporcional al atraso, opcional (v10)

   Funciona igual en el navegador (<script>) y en Node (tests).
   ========================================================================= */
(function (global) {
  'use strict';

  const sinTildes = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NIVELES = ['Inicial', 'Primaria', 'Secundaria'];
  const ORDINALES = { PRIMERO: 1, PRIMER: 1, SEGUNDO: 2, TERCERO: 3, TERCER: 3, CUARTO: 4, QUINTO: 5, SEXTO: 6 };

  /* ------------------------------------------------------------------ */
  /* 1. GRADO Y SECCIÓN                                                  */
  /* ------------------------------------------------------------------ */
  // Entiende las formas en que la gente escribe un aula:
  //   "3° A", "3A", "3ro A", "3.º a", "Tercero A", "3° A PRIMARIA", "1° SEC B", "5 años B", "Inicial 4 años A"
  // y devuelve las piezas por separado más dos etiquetas canónicas para agrupar:
  //   etiquetaGrado   → "3° PRIMARIA"        (todas las secciones juntas)
  //   etiquetaSeccion → "3° A PRIMARIA"      (una por sección; mismo estilo que usa el sistema)
  // Si no hay nivel en el texto ("3° A") el grado queda sin nivel: no se adivina, para no mezclar 3° de primaria con 3° de secundaria.
  function parsearGrado(texto) {
    const original = String(texto == null ? '' : texto).trim();
    const base = { original, esAlumno: true, nivel: '', grado: 0, seccion: '', etiquetaNivel: '', etiquetaGrado: '', etiquetaSeccion: '', orden: 9e6 };
    let t = sinTildes(original).toUpperCase().replace(/[º°ª.,;:()\-–—_/]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return { ...base, etiquetaNivel: 'SIN GRADO / SECCIÓN', etiquetaGrado: 'SIN GRADO / SECCIÓN', etiquetaSeccion: 'SIN GRADO / SECCIÓN', orden: 9e7 };

    if (/^(DOCENTE|PROFESOR|PERSONAL|ADMINISTRATIV|AUXILIAR|DIRECTOR|SUBDIRECTOR|SECRETARI|APOYO|COORDINADOR)/.test(t)) {
      const g = 'DOCENTES Y PERSONAL';
      return { ...base, esAlumno: false, etiquetaNivel: g, etiquetaGrado: g, etiquetaSeccion: g, orden: 8e7 };
    }

    // "tercero" → 3 ; "3ro" → 3 ; "3A" → "3 A"
    t = t.replace(/\b(PRIMERO|PRIMER|SEGUNDO|TERCERO|TERCER|CUARTO|QUINTO|SEXTO)\b/g, (m, w) => String(ORDINALES[w]));
    t = t.replace(/\b([1-6])(RO|DO|ER|TO|MO|VO)\b/g, '$1');
    t = t.replace(/\b([1-6])([A-Z])\b/g, '$1 $2');

    let nivel = '';
    if (/\bINICIAL\b|\bINI\b/.test(t)) nivel = 'Inicial';
    else if (/\bPRIMARIA\b|\bPRIM\b/.test(t)) nivel = 'Primaria';
    else if (/\bSECUNDARIA\b|\bSEC\b/.test(t)) nivel = 'Secundaria';
    t = t.replace(/\b(INICIAL|INI|PRIMARIA|PRIM|SECUNDARIA|SEC|GRADO|SECCION|AULA|NIVEL)\b/g, ' ').replace(/\s+/g, ' ').trim();

    let grado = 0;
    const anos = t.match(/\b([345]) ANOS?\b/);
    if (anos) { grado = Number(anos[1]); nivel = 'Inicial'; t = t.replace(anos[0], ' '); }
    else {
      const g = t.match(/\b([1-6])\b/);
      if (g) { grado = Number(g[1]); t = t.replace(g[0], ' '); }
    }
    t = t.replace(/\s+/g, ' ').trim();
    const sec = t.match(/\b([A-Z])\b/g);
    const seccion = sec ? sec[sec.length - 1] : '';

    if (!grado && !nivel) {            // texto libre que no se entiende ("TALLER", "4TO CICLO"…)
      const libre = sinTildes(original).toUpperCase().replace(/\s+/g, ' ').trim();
      return { ...base, etiquetaNivel: libre, etiquetaGrado: libre, etiquetaSeccion: libre, orden: 7e7 };
    }
    const NIV = nivel.toUpperCase();
    const gTxt = grado ? (nivel === 'Inicial' ? grado + ' AÑOS' : grado + '°') : '';
    const unir = (...p) => p.filter(Boolean).join(' ');
    const ordenNivel = nivel ? NIVELES.indexOf(nivel) : 3;
    return {
      ...base, nivel, grado, seccion,
      etiquetaNivel: nivel ? nivel.toUpperCase() : 'SIN NIVEL',
      etiquetaGrado: unir(gTxt, NIV),
      etiquetaSeccion: unir(gTxt, seccion, NIV),
      orden: ordenNivel * 1e4 + grado * 100 + (seccion ? seccion.charCodeAt(0) - 64 : 0)
    };
  }
  // Clave para agrupar. nivel: 'nivel' | 'grado' | 'seccion'
  function claveGrado(texto, cuanto) {
    const p = parsearGrado(texto);
    return cuanto === 'nivel' ? p.etiquetaNivel : cuanto === 'grado' ? p.etiquetaGrado : p.etiquetaSeccion;
  }

  /* ------------------------------------------------------------------ */
  /* 2. TELÉFONOS                                                        */
  /* ------------------------------------------------------------------ */
  // Devuelve { ok, numero } con el número listo para https://wa.me/<numero>.
  //   987654321 → 51987654321 · +51 987 654 321 → 51987654321 · 0051987654321 → 51987654321
  //   (01) 4567890 (fijo) → no sirve para WhatsApp · un número de otro país con código se respeta tal cual
  function normalizarTelefono(texto, pais) {
    pais = pais || '51';
    let d = String(texto == null ? '' : texto).replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (!d) return { ok: false, numero: '', motivo: 'vacío' };
    if (d.length === 9 && d[0] === '9') return { ok: true, numero: pais + d };
    if (d.startsWith(pais) && d.length === pais.length + 9 && d[pais.length] === '9') return { ok: true, numero: d };
    if (d.startsWith(pais) && d.length > pais.length + 9) return { ok: false, numero: '', motivo: 'demasiados dígitos' };
    if (!d.startsWith(pais) && d.length >= 10 && d.length <= 15) return { ok: true, numero: d };   // otro país, con su código
    return { ok: false, numero: '', motivo: d.length < 9 ? 'incompleto (los celulares tienen 9 dígitos)' : 'no parece un celular' };
  }

  /* ------------------------------------------------------------------ */
  /* 3. AVISOS A MOROSOS (uno por lector)                                */
  /* ------------------------------------------------------------------ */
  const diasEntre = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);

  // Un aviso por lector, con TODOS sus libros vencidos, para no mandar tres WhatsApp a la misma familia.
  //   prestamos: [{id, libroId, lectorId, lector, grado, fecha, vence, devuelto, avisado?}]
  //   lectores:  [{id, nombre, grado, tipo, tel?}]   libros: [{id, cod, titulo}]
  function avisosMorosos({ prestamos, lectores, libros, nombreIE, hoy, minDias }) {
    minDias = minDias || 1;
    const porLector = new Map(lectores.map(l => [l.id, l]));
    const porLibro = new Map(libros.map(l => [l.id, l]));
    const grupos = new Map();
    for (const p of prestamos) {
      if (p.devuelto || !p.vence || p.vence >= hoy) continue;
      const atraso = diasEntre(p.vence, hoy);
      if (atraso < minDias) continue;
      const clave = p.lectorId || ('n:' + p.lector);
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave).push({ p, atraso, libro: porLibro.get(p.libroId) || {} });
    }
    const avisos = [];
    for (const [clave, filas] of grupos) {
      const lec = porLector.get(filas[0].p.lectorId) || null;
      const nombre = lec ? lec.nombre : filas[0].p.lector;
      const grado = lec ? lec.grado : filas[0].p.grado;
      const esAlumno = !lec || (lec.tipo || 'Alumno') === 'Alumno';
      const tel = normalizarTelefono(lec && lec.tel);
      filas.sort((a, b) => b.atraso - a.atraso);
      const lista = filas.map(f => '• "' + (f.libro.titulo || '—') + '" (' + (f.libro.cod || '—') + '), vencía el ' + f.p.vence + ' (' + f.atraso + ' día' + (f.atraso === 1 ? '' : 's') + ' de atraso)').join('\n');
      const saludo = esAlumno ? 'Estimado(a) apoderado(a) de ' + nombre + (grado ? ' (' + grado + ')' : '') : 'Estimado(a) ' + nombre;
      const mensaje = saludo + ': desde la biblioteca' + (nombreIE ? ' de ' + nombreIE : '') + ' le recordamos que ' + (filas.length === 1 ? 'tiene pendiente de devolución el siguiente libro' : 'tiene pendientes de devolución los siguientes libros') + ':\n' + lista + '\nAgradeceremos devolver' + (filas.length === 1 ? 'lo' : 'los') + ' a la brevedad. ¡Gracias!';
      const ultimoAviso = filas.map(f => f.p.avisado || '').sort().pop() || '';
      avisos.push({
        clave, lectorId: lec ? lec.id : '', nombre, grado: grado || '', esAlumno,
        telefono: tel.ok ? tel.numero : '', telefonoOriginal: (lec && lec.tel) || '', telefonoProblema: tel.ok ? '' : (lec && lec.tel ? tel.motivo : 'sin celular registrado'),
        libros: filas.length, atrasoMax: filas[0].atraso, prestamoIds: filas.map(f => f.p.id),
        mensaje, url: tel.ok ? 'https://wa.me/' + tel.numero + '?text=' + encodeURIComponent(mensaje) : '',
        ultimoAviso, diasDesdeAviso: ultimoAviso ? diasEntre(ultimoAviso, hoy) : null
      });
    }
    return avisos.sort((a, b) => b.atrasoMax - a.atrasoMax || a.nombre.localeCompare(b.nombre, 'es'));
  }

  /* ------------------------------------------------------------------ */
  /* 4. ESTADÍSTICAS POR NIVEL / GRADO / SECCIÓN                         */
  /* ------------------------------------------------------------------ */
  // cuanto: 'nivel' | 'grado' | 'seccion'. desde: 'YYYY-MM-DD' o '' (todo el historial).
  // Los préstamos se atribuyen al grado ACTUAL del lector (así un alumno promovido no deja su historial en el grado anterior);
  // si el lector ya no existe, se usa el grado escrito en el préstamo.
  function estadisticasPorGrupo({ prestamos, lectores, libros, cats, hoy, desde, cuanto }) {
    cuanto = cuanto || 'seccion';
    const porLector = new Map(lectores.map(l => [l.id, l]));
    const porLibro = new Map(libros.map(l => [l.id, l]));
    const porCat = new Map((cats || []).map(c => [c.id, c.nombre]));
    const filas = new Map();
    const fila = (texto, tipo) => {
      const p = (tipo && tipo !== 'Alumno') ? parsearGrado('DOCENTE') : parsearGrado(texto);
      const k = cuanto === 'nivel' ? p.etiquetaNivel : cuanto === 'grado' ? p.etiquetaGrado : p.etiquetaSeccion;
      if (!filas.has(k)) filas.set(k, { grupo: k, orden: cuanto === 'nivel' ? (p.esAlumno ? (NIVELES.indexOf(p.nivel) >= 0 ? NIVELES.indexOf(p.nivel) : 3) : 8) : p.orden, esAlumno: p.esAlumno, lectores: 0, prestamos: 0, activos: new Set(), enCasa: 0, vencidos: 0, cats: new Map() });
      return filas.get(k);
    };
    for (const l of lectores) { if (l.baja) continue; fila(l.grado, l.tipo).lectores++; }
    for (const p of prestamos) {
      const lec = porLector.get(p.lectorId);
      const f = fila(lec ? lec.grado : p.grado, lec ? lec.tipo : '');
      if (!p.devuelto) { f.enCasa++; if (p.vence && p.vence < hoy) f.vencidos++; }
      if (desde && p.fecha < desde) continue;
      f.prestamos++;
      f.activos.add(p.lectorId || ('n:' + p.lector));
      const libro = porLibro.get(p.libroId);
      const cat = libro ? (porCat.get(libro.catId) || '') : '';
      if (cat) f.cats.set(cat, (f.cats.get(cat) || 0) + 1);
    }
    const out = [...filas.values()].map(f => {
      const top = [...f.cats.entries()].sort((a, b) => b[1] - a[1])[0];
      const activos = f.esAlumno ? Math.min(f.activos.size, Math.max(f.lectores, 0)) : f.activos.size;
      return {
        grupo: f.grupo, orden: f.orden, esAlumno: f.esAlumno, lectores: f.lectores, prestamos: f.prestamos, lectoresActivos: f.activos.size,
        participacion: f.lectores ? Math.round(Math.min(activos, f.lectores) / f.lectores * 100) : 0,
        promedio: f.lectores ? Math.round(f.prestamos / f.lectores * 100) / 100 : 0,
        enCasa: f.enCasa, vencidos: f.vencidos, categoriaTop: top ? top[0] : ''
      };
    }).filter(f => f.lectores || f.prestamos || f.enCasa).sort((a, b) => a.orden - b.orden || a.grupo.localeCompare(b.grupo, 'es'));
    const alumnos = out.filter(f => f.esAlumno);
    const tot = alumnos.reduce((a, f) => ({ lectores: a.lectores + f.lectores, prestamos: a.prestamos + f.prestamos, activos: a.activos + Math.min(f.lectoresActivos, f.lectores), enCasa: a.enCasa + f.enCasa, vencidos: a.vencidos + f.vencidos }), { lectores: 0, prestamos: 0, activos: 0, enCasa: 0, vencidos: 0 });
    return { filas: out, totalAlumnos: { lectores: tot.lectores, prestamos: tot.prestamos, participacion: tot.lectores ? Math.round(tot.activos / tot.lectores * 100) : 0, promedio: tot.lectores ? Math.round(tot.prestamos / tot.lectores * 100) / 100 : 0, enCasa: tot.enCasa, vencidos: tot.vencidos } };
  }

  /* ------------------------------------------------------------------ */
  /* 5. CARNÉS EN HOJAS                                                  */
  /* ------------------------------------------------------------------ */
  // 8 carnés por hoja A4 (2 columnas × 4 filas, tamaño tarjeta 85.6 × 54 mm), con líneas de corte punteadas.
  // qr(codigo) debe devolver la imagen (data URL) del QR; se inyecta para poder probar sin navegador.
  function carnesHTML(lectores, { nombreIE, qr, hoy, titulo } = {}) {
    const POR_HOJA = 8;
    const paginas = [];
    for (let i = 0; i < lectores.length; i += POR_HOJA) paginas.push(lectores.slice(i, i + POR_HOJA));
    const carne = l => `<div class="carne"><img class="qr" src="${esc(qr ? qr(l.cod) : '')}" alt=""><div class="dato"><div class="ie">BIBLIOTECA${nombreIE ? ' · ' + esc(nombreIE) : ''}</div><div class="nom">${esc(l.nombre)}</div><div class="gr">${esc(l.tipo || 'Alumno')}${l.grado ? ' · ' + esc(l.grado) : ''}</div><div class="cod">${esc(l.cod)}</div></div></div>`;
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${esc(titulo || 'Carnés de biblioteca')}</title><style>
@page{size:A4;margin:10mm}
*{box-sizing:border-box} body{font-family:Arial,sans-serif;margin:0;color:#111}
.barra{background:#14304d;color:#fff;padding:8px 12px;display:flex;gap:12px;align-items:center;margin-bottom:8px} .barra button{padding:5px 10px;cursor:pointer}
.pagina{display:grid;grid-template-columns:repeat(2,85.6mm);grid-auto-rows:54mm;gap:0;justify-content:center;page-break-after:always;break-after:page}
.pagina:last-of-type{page-break-after:auto;break-after:auto}
.carne{width:85.6mm;height:54mm;border:.3mm dashed #888;padding:4mm;display:flex;gap:4mm;align-items:center;overflow:hidden}
.qr{width:26mm;height:26mm;flex:none} .dato{min-width:0} .ie{font-size:7pt;font-weight:700;color:#555}
.nom{font-size:11pt;font-weight:700;line-height:1.15;margin:1mm 0} .gr{font-size:8.5pt;color:#333} .cod{font-family:monospace;font-size:10pt;margin-top:1.5mm}
@media print{.barra{display:none}}
</style></head><body><div class="barra"><b>${lectores.length} carné(s) · ${paginas.length} hoja(s) A4</b><button onclick="window.print()">🖨 Imprimir</button><span style="font-size:12px">Imprime al 100 % (sin ajustar a la página) para que midan 85.6 × 54 mm.</span></div>
${paginas.map(pg => '<div class="pagina">' + pg.map(carne).join('') + '</div>').join('\n')}
</body></html>`;
  }

  /* ------------------------------------------------------------------ */
  /* 6. PRÉSTAMO POR AULA (plan lector)                                  */
  /* ------------------------------------------------------------------ */
  const claveTitulo = l => sinTildes((l.titulo || '') + '|' + (l.autor || '')).toUpperCase().replace(/\s+/g, ' ').trim();
  // Junta los ejemplares de un mismo título (en el catálogo cada ejemplar puede ser una fila distinta).
  // prestadosDe(libroId) = cuántos ejemplares de esa fila están prestados. Un libro con cant 3 cuenta 3 ejemplares.
  function agruparTitulos(libros, prestadosDe, ejemplaresDe) {
    const g = new Map();
    for (const l of libros) {
      const k = claveTitulo(l);
      if (!g.has(k)) g.set(k, { clave: k, titulo: l.titulo || '', autor: l.autor || '', total: 0, libres: 0, items: [] });
      const o = g.get(k);
      const total = ejemplaresDe ? ejemplaresDe(l) : Math.max(1, Number(l.cant) || 1);
      const libres = Math.max(0, total - (prestadosDe ? prestadosDe(l.id) : 0));
      o.total += total; o.libres += libres; o.items.push({ libro: l, libres });
    }
    return [...g.values()].sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));
  }

  // Reparte ejemplares a los lectores de un aula, uno por lector, en orden alfabético.
  //   reglas.lector(lec)        → '' o motivo por el que NO se le puede prestar (vencidos, tope de libros…)
  //   reglas.libro(lec, libro)  → '' o motivo (ya tiene ese ejemplar, reservado para otro…)
  // Devuelve { asignaciones:[{lector, libro}], sinEjemplar:[lector], bloqueados:[{lector, motivo}] }
  function asignarAula(lectores, items, reglas) {
    reglas = reglas || {};
    const slots = items.map(i => ({ libro: i.libro, libres: i.libres }));
    const asignaciones = [], sinEjemplar = [], bloqueados = [];
    const orden = [...lectores].sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
    for (const lec of orden) {
      const m = reglas.lector ? reglas.lector(lec) : '';
      if (m) { bloqueados.push({ lector: lec, motivo: m }); continue; }
      const s = slots.find(x => x.libres > 0 && !(reglas.libro && reglas.libro(lec, x.libro)));
      if (!s) { sinEjemplar.push(lec); continue; }
      s.libres--;
      asignaciones.push({ lector: lec, libro: s.libro });
    }
    return { asignaciones, sinEjemplar, bloqueados };
  }

  // Préstamos por aula que todavía tienen libros sin devolver (se reconocen por el campo `lote`).
  function lotesActivos(prestamos) {
    const m = new Map();
    for (const p of prestamos) {
      if (!p.lote) continue;
      if (!m.has(p.lote)) m.set(p.lote, { lote: p.lote, nombre: p.loteNombre || p.lote, fecha: p.fecha, vence: p.vence, items: [] });
      m.get(p.lote).items.push(p);
    }
    return [...m.values()].map(x => ({ ...x, pendientes: x.items.filter(p => !p.devuelto).length, total: x.items.length }))
      .filter(x => x.pendientes > 0).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }

  /* ------------------------------------------------------------------ */
  /* 7. RESEÑAS Y ESTRELLAS                                              */
  /* ------------------------------------------------------------------ */

  // Estrellas válidas: entero de 1 a 5. Cualquier otra cosa → 0 (no válida).
  function estrellasValidas(n) { n = Math.round(Number(n)); return n >= 1 && n <= 5 ? n : 0; }

  // Promedio y cantidad de reseñas por libro → Map(libroId → { n, prom })
  function resumenResenas(resenas) {
    const m = new Map();
    for (const r of resenas || []) {
      const e = estrellasValidas(r.estrellas); if (!e || !r.libroId) continue;
      const o = m.get(r.libroId) || { n: 0, suma: 0 }; o.n++; o.suma += e; m.set(r.libroId, o);
    }
    for (const o of m.values()) { o.prom = o.suma / o.n; delete o.suma; }
    return m;
  }

  // "Más leídos y mejor valorados": préstamos (desde `desde`) + promedio de estrellas por título.
  // Orden: más préstamos primero; con empate, mejor promedio.
  function rankingLibros(prestamos, resenas, libros, desde) {
    const res = resumenResenas(resenas), cuenta = new Map();
    for (const p of prestamos || []) {
      if (p.perdido || !p.libroId || (desde && p.fecha < desde)) continue;
      cuenta.set(p.libroId, (cuenta.get(p.libroId) || 0) + 1);
    }
    const lib = new Map((libros || []).map(l => [l.id, l]));
    return [...cuenta.entries()].filter(([id]) => lib.has(id)).map(([id, n]) => {
      const r = res.get(id) || { n: 0, prom: 0 };
      return { libro: lib.get(id), prestamos: n, resenas: r.n, prom: r.prom };
    }).sort((a, b) => b.prestamos - a.prestamos || b.prom - a.prom || String(a.libro.titulo).localeCompare(String(b.libro.titulo), 'es'));
  }

  // Devoluciones recientes que todavía no tienen reseña (para reseñarlas después, p. ej. tras una devolución por aula).
  function devolucionesSinResena(prestamos, resenas, desde) {
    const hechas = new Set((resenas || []).map(r => r.prestId).filter(Boolean));
    return (prestamos || []).filter(p => p.devuelto && !p.perdido && !hechas.has(p.id) && (!desde || p.devuelto >= desde))
      .sort((a, b) => String(b.devuelto).localeCompare(String(a.devuelto)));
  }

  /* ------------------------------------------------------------------ */
  /* 8. LECTORES SIN ACTIVIDAD                                           */
  /* ------------------------------------------------------------------ */

  // Lectores (no dados de baja) cuyo último movimiento (préstamo o devolución) es de hace `dias` o más.
  // Quien tiene un libro en su poder sin vencer NO cuenta como inactivo (está leyendo).
  // Devuelve [{ lector, ultima, dias, sinPrestamos }] — los que nunca leyeron van primero.
  function lectoresInactivos(lectores, prestamos, hoy, dias) {
    dias = Math.max(1, Math.round(Number(dias)) || 30);
    const por = new Map();
    for (const p of prestamos || []) {
      const k = p.lectorId; if (!k) continue;
      const o = por.get(k) || { ultima: '', enMano: false };
      for (const f of [p.fecha, p.devuelto]) if (f && f > o.ultima) o.ultima = f;
      if (!p.devuelto && !(p.vence && p.vence < hoy)) o.enMano = true;
      por.set(k, o);
    }
    const out = [];
    for (const l of lectores || []) {
      if (l.baja) continue;
      const o = por.get(l.id);
      if (!o) { out.push({ lector: l, ultima: '', dias: null, sinPrestamos: true }); continue; }
      if (o.enMano) continue;
      const d = diasEntre(o.ultima, hoy);
      if (d >= dias) out.push({ lector: l, ultima: o.ultima, dias: d, sinPrestamos: false });
    }
    return out.sort((a, b) => (a.sinPrestamos === b.sinPrestamos ? (b.dias || 0) - (a.dias || 0) : a.sinPrestamos ? -1 : 1)
      || String(a.lector.nombre).localeCompare(String(b.lector.nombre), 'es'));
  }

  /* ------------------------------------------------------------------ */
  /* 9. CERTIFICADO DE LECTOR                                            */
  /* ------------------------------------------------------------------ */

  // Lectores que alcanzan `minimo` libros leídos (préstamos devueltos, sin perdidos) desde `desde`.
  // Devuelve [{ lector, libros }] de mayor a menor.
  function candidatosCertificado(lectores, prestamos, minimo, desde) {
    const n = new Map();
    for (const p of prestamos || []) {
      if (!p.devuelto || p.perdido || !p.lectorId || (desde && p.fecha < desde)) continue;
      n.set(p.lectorId, (n.get(p.lectorId) || 0) + 1);
    }
    return (lectores || []).filter(l => !l.baja && (n.get(l.id) || 0) >= Math.max(1, minimo))
      .map(l => ({ lector: l, libros: n.get(l.id) }))
      .sort((a, b) => b.libros - a.libros || String(a.lector.nombre).localeCompare(String(b.lector.nombre), 'es'));
  }

  // Certificados (uno por hoja A4 horizontal) listos para imprimir.
  //   items: [{ nombre, grado, libros, insignia, motivo }]
  function certificadosHTML(items, { nombreIE, anio, fecha, titulo, firma1, firma2 } = {}) {
    const hoja = c => `<div class="cert"><div class="marco"><div class="ie">${esc(nombreIE || '')}</div><div class="bib">BIBLIOTECA ESCOLAR</div>
<div class="tit">CERTIFICADO DE LECTOR</div><div class="otg">Se otorga con orgullo a</div><div class="nom">${esc(c.nombre)}</div>${c.grado ? `<div class="gr">${esc(c.grado)}</div>` : ''}
<div class="txt">${c.motivo ? esc(c.motivo) : 'Por su constancia y entusiasmo en la lectura, habiendo leído <b>' + esc(c.libros) + '</b> libro(s) durante el año ' + esc(anio || '') + '.'}</div>
${c.insignia ? `<div class="ins">${esc(c.insignia)}</div>` : ''}<div class="fec">${esc(fecha || '')}</div>
<div class="firmas"><div><div class="ln"></div>${esc(firma1 || 'Responsable de la biblioteca')}</div><div><div class="ln"></div>${esc(firma2 || 'Dirección')}</div></div></div></div>`;
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${esc(titulo || 'Certificados de lector')}</title><style>
@page{size:A4 landscape;margin:0}
*{box-sizing:border-box} body{font-family:Georgia,'Times New Roman',serif;margin:0;color:#1a1a1a}
.barra{background:#14304d;color:#fff;padding:8px 12px;display:flex;gap:12px;align-items:center;font-family:Arial,sans-serif} .barra button{padding:5px 10px;cursor:pointer}
.cert{width:297mm;height:210mm;padding:10mm;page-break-after:always;break-after:page;display:flex}
.cert:last-of-type{page-break-after:auto;break-after:auto}
.marco{flex:1;border:2.5mm double #14304d;padding:10mm 18mm;text-align:center;display:flex;flex-direction:column;justify-content:center;gap:3mm}
.ie{font-size:13pt;letter-spacing:.5mm;color:#14304d;font-weight:700} .bib{font-size:10pt;letter-spacing:1.2mm;color:#666}
.tit{font-size:34pt;font-weight:700;color:#14304d;margin:5mm 0 2mm} .otg{font-size:13pt;font-style:italic;color:#555}
.nom{font-size:30pt;font-weight:700;border-bottom:.4mm solid #999;padding:1mm 8mm;margin:2mm auto;align-self:center;min-width:140mm}
.gr{font-size:12pt;color:#444} .txt{font-size:14pt;line-height:1.5;margin:3mm auto;max-width:200mm}
.ins{font-size:20pt;margin:1mm 0} .fec{font-size:11pt;color:#555}
.firmas{display:flex;justify-content:space-around;margin-top:12mm;font-size:11pt} .ln{width:62mm;border-top:.3mm solid #333;margin:0 auto 1.5mm}
@media print{.barra{display:none}}
</style></head><body><div class="barra"><b>${items.length} certificado(s)</b><button onclick="window.print()">🖨 Imprimir</button><span style="font-size:12px">Papel A4 horizontal, sin márgenes ni ajuste a la página.</span></div>
${items.map(hoja).join('\n')}
</body></html>`;
  }

  /* ------------------------------------------------------------------ */
  /* 10. v10: LECTURAS ASIGNADAS, COMPRENSIÓN, META MENSUAL, SANCIÓN      */
  /* ------------------------------------------------------------------ */

  // Escala de logro del sistema peruano (CNEB). El código es lo que se guarda.
  const NIVELES_LOGRO = [
    { cod: 'AD', nombre: 'Logro destacado', valor: 4 },
    { cod: 'A', nombre: 'Logro esperado', valor: 3 },
    { cod: 'B', nombre: 'En proceso', valor: 2 },
    { cod: 'C', nombre: 'En inicio', valor: 1 }
  ];
  function nivelLogroValido(x) {
    const c = String(x == null ? '' : x).trim().toUpperCase();
    return NIVELES_LOGRO.some(n => n.cod === c) ? c : '';
  }
  const sumarDias = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

  // Avance de una lectura asignada a un aula.
  //   lectura:   { id, fecha, limite }       (limite '' = sin fecha límite)
  //   alumnos:   lectores del aula (ya filtrados: sin bajas ni docentes)
  //   libroIds:  Set con los ids de los ejemplares del título asignado
  //   comprension: [{ prestId, nivel }]  (opcional, para mostrar el nivel de cada alumno)
  // Un alumno "recibió" el libro si tiene un préstamo de ese título hecho para esta lectura (campo lecturaId)
  // o hecho por su cuenta desde la fecha de asignación. Si tiene varios, cuenta el más reciente.
  // Está "atrasado" si ya pasó la fecha límite y todavía no devolvió (haya recibido el libro o no).
  function avanceLectura({ lectura, alumnos, prestamos, libroIds, hoy, comprension }) {
    const ids = libroIds instanceof Set ? libroIds : new Set(libroIds || []);
    const niv = new Map((comprension || []).map(c => [c.prestId, nivelLogroValido(c.nivel)]));
    const limite = lectura.limite || '';
    const vencida = !!limite && hoy > limite;
    const filas = [];
    for (const a of alumnos || []) {
      const mios = (prestamos || []).filter(p => p.lectorId === a.id && ids.has(p.libroId) && (p.lecturaId === lectura.id || (p.fecha || '') >= (lectura.fecha || '')))
        .sort((x, y) => (y.lecturaId === lectura.id) - (x.lecturaId === lectura.id) || String(y.fecha).localeCompare(String(x.fecha)));
      const p = mios[0] || null;
      let estado, atrasado = false, tarde = false;
      if (!p) { estado = 'sin-recibir'; atrasado = vencida; }
      else if (p.devuelto) { estado = 'devuelto'; tarde = !!limite && p.devuelto > limite; }
      else if (p.perdido) estado = 'perdido';
      else { estado = 'leyendo'; atrasado = vencida; }
      filas.push({ lector: a, prestamo: p, estado, atrasado, tarde, nivel: p ? (niv.get(p.id) || '') : '' });
    }
    filas.sort((x, y) => String(x.lector.nombre).localeCompare(String(y.lector.nombre), 'es'));
    const cuenta = f => filas.filter(f).length;
    const total = filas.length, recibieron = cuenta(f => f.prestamo), devolvieron = cuenta(f => f.estado === 'devuelto');
    return {
      total, recibieron, devolvieron, atrasados: cuenta(f => f.atrasado), leyendo: cuenta(f => f.estado === 'leyendo'),
      sinRecibir: cuenta(f => f.estado === 'sin-recibir'), perdidos: cuenta(f => f.estado === 'perdido'), devueltosTarde: cuenta(f => f.tarde),
      pct: total ? Math.round(devolvieron / total * 100) : 0, vencida, completa: total > 0 && devolvieron === total, filas
    };
  }

  // Comprensión lectora por aula, grado o nivel.
  //   registros: [{ nivel, grado, fecha }]   → [{ grupo, orden, AD, A, B, C, total, logro (% AD+A) }] + totales
  function resumenComprension(registros, { desde, cuanto } = {}) {
    cuanto = cuanto || 'seccion';
    const g = new Map(), tot = { AD: 0, A: 0, B: 0, C: 0, total: 0, logro: 0 };
    for (const r of registros || []) {
      const n = nivelLogroValido(r.nivel); if (!n || (desde && String(r.fecha || '') < desde)) continue;
      if (!parsearGrado(r.grado).esAlumno) continue;   // el informe es de alumnos: docentes y personal no se evalúan
      const k = claveGrado(r.grado, cuanto) || 'SIN GRADO';
      if (!g.has(k)) g.set(k, { grupo: k, orden: parsearGrado(r.grado).orden, AD: 0, A: 0, B: 0, C: 0, total: 0, logro: 0 });
      const o = g.get(k); o[n]++; o.total++; tot[n]++; tot.total++;
    }
    const filas = [...g.values()].map(o => ({ ...o, logro: Math.round((o.AD + o.A) / o.total * 100) }))
      .sort((a, b) => a.orden - b.orden || a.grupo.localeCompare(b.grupo, 'es'));
    tot.logro = tot.total ? Math.round((tot.AD + tot.A) / tot.total * 100) : 0;
    return { filas, totales: tot };
  }

  // Devoluciones recientes de ALUMNOS que todavía no tienen nivel de comprensión.
  function devolucionesSinComprension(prestamos, registros, desde) {
    const hechas = new Set((registros || []).map(r => r.prestId).filter(Boolean));
    return (prestamos || []).filter(p => p.devuelto && !p.perdido && !hechas.has(p.id) && (!desde || p.devuelto >= desde) && parsearGrado(p.grado).esAlumno)
      .sort((a, b) => String(b.devuelto).localeCompare(String(a.devuelto)));
  }

  // Meta mensual de libros por aula. mes = 'YYYY-MM'.
  //   alumnos: lectores alumnos activos · metas: [{ aula, libros }] (aula = claveGrado 'seccion')
  //   "leídos" = libros devueltos en el mes (sin los perdidos); "en curso" = prestados en el mes y aún sin devolver.
  function metaMensual({ prestamos, alumnos, metas, mes }) {
    const aulas = new Map(), k = t => claveGrado(t, 'seccion') || 'SIN GRADO';
    const get = (clave, grado) => { if (!aulas.has(clave)) aulas.set(clave, { aula: clave, orden: parsearGrado(grado).orden, alumnos: 0, meta: 0, leidos: 0, enCurso: 0 }); return aulas.get(clave); };
    for (const a of alumnos || []) { if (!a.baja) get(k(a.grado), a.grado).alumnos++; }
    for (const m of metas || []) get(m.aula, m.aula).meta = Math.max(0, Math.round(Number(m.libros)) || 0);
    for (const p of prestamos || []) {
      if (p.perdido || !parsearGrado(p.grado).esAlumno) continue;   // la meta es de las aulas: docentes y personal no cuentan
      const o = get(k(p.grado), p.grado);
      if (p.devuelto && String(p.devuelto).slice(0, 7) === mes) o.leidos++;
      else if (!p.devuelto && String(p.fecha || '').slice(0, 7) === mes) o.enCurso++;
    }
    const filas = [...aulas.values()].filter(o => o.alumnos || o.meta || o.leidos || o.enCurso)
      .map(o => ({ ...o, pct: o.meta ? Math.round(o.leidos / o.meta * 100) : null, cumplida: !!o.meta && o.leidos >= o.meta }))
      .sort((a, b) => a.orden - b.orden || a.aula.localeCompare(b.aula, 'es'));
    const meta = filas.reduce((s, o) => s + o.meta, 0), leidos = filas.reduce((s, o) => s + o.leidos, 0);
    return { filas, totales: { meta, leidos, enCurso: filas.reduce((s, o) => s + o.enCurso, 0), cumplidas: filas.filter(o => o.cumplida).length, conMeta: filas.filter(o => o.meta).length } };
  }

  // Sanción proporcional al atraso (opcional; apagada por defecto en Reglas de préstamo).
  //   cfg: { activa, factor (días de suspensión por cada día de atraso), maxDias }
  // Se calcula al DEVOLVER un libro vencido: atraso = días entre el vencimiento y hoy.
  // Devuelve null si no corresponde sanción; si no, { atraso, dias, hasta }. El lector puede volver a llevar libros desde `hasta`.
  function calcularSancion(prestamo, hoy, cfg) {
    if (!cfg || !cfg.activa || !prestamo || prestamo.perdido || !prestamo.vence || hoy <= prestamo.vence) return null;
    const factor = Number(cfg.factor) > 0 ? Number(cfg.factor) : 1, tope = Math.max(1, Math.round(Number(cfg.maxDias)) || 30);
    const atraso = diasEntre(prestamo.vence, hoy), dias = Math.min(tope, Math.max(1, Math.ceil(atraso * factor - 1e-9)));
    return { atraso, dias, hasta: sumarDias(hoy, dias) };
  }
  // Sanción que sigue vigente hoy para un lector ({ id, nombre }); si hay varias, la que termina más tarde.
  function sancionVigente(sanciones, lector, hoy) {
    const l = lector || {};
    return (sanciones || []).filter(s => !s.levantada && s.hasta > hoy && (s.lectorId ? s.lectorId === l.id : (!l.id && s.lector === l.nombre)))
      .sort((a, b) => String(b.hasta).localeCompare(String(a.hasta)))[0] || null;
  }

  const api = { parsearGrado, claveGrado, normalizarTelefono, avisosMorosos, estadisticasPorGrupo, carnesHTML, agruparTitulos, asignarAula, lotesActivos, diasEntre, estrellasValidas, resumenResenas, rankingLibros, devolucionesSinResena, lectoresInactivos, candidatosCertificado, certificadosHTML,
    NIVELES_LOGRO, nivelLogroValido, sumarDias, avanceLectura, resumenComprension, devolucionesSinComprension, metaMensual, calcularSancion, sancionVigente };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SigieBib = api;
})(typeof window !== 'undefined' ? window : globalThis);
