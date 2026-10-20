/* =========================================================================
   SIGIE — Lectómetro integrado a la biblioteca (lógica pura, con pruebas)
   -------------------------------------------------------------------------
   El Lectómetro (LectorIEP) llevaba aparte: bitácora de lectura, puntos,
   rachas, insignias, niveles de lector, evaluaciones con cuestionarios y
   tienda de premios. Aquí se calcula todo SOBRE los datos de la biblioteca:

     · El "usuario estudiante" del Lectómetro es un LECTOR de la biblioteca
       (mismo carné LEC-…, mismo grado y sección).
     · Puntos, nivel, racha e insignias NO se guardan: se calculan siempre a
       partir de la bitácora, los préstamos, las reseñas y las evaluaciones.
       Así no se desfasan ni chocan cuando dos computadoras guardan a la vez.
     · Cada evaluación rendida genera también un registro de Comprensión
       lectora AD / A / B / C, así que alimenta el informe UGEL y los diplomas.

   Funciona igual en el navegador (<script>) y en Node (pruebas).
   ========================================================================= */
(function (global) {
  'use strict';

  const NIVELES_LECTOR = [
    { min: 0, nombre: 'Explorador de Páginas', icono: '📖' },
    { min: 200, nombre: 'Aventurero Literario', icono: '🧭' },
    { min: 600, nombre: 'Sabio Lector', icono: '🎓' },
    { min: 1500, nombre: 'Leyenda de la Biblioteca', icono: '🏆' }
  ];

  // Mismo conjunto del Lectómetro; "cuando" explica el criterio en pantalla.
  const INSIGNIAS = [
    { id: 'primer_libro', nombre: 'Primer Libro', icono: '🔖', cuando: 'Completó su primera lectura' },
    { id: 'racha_7', nombre: 'Racha de Fuego', icono: '🔥', cuando: '7 días seguidos registrando lectura' },
    { id: 'racha_30', nombre: 'Constancia de Oro', icono: '🏅', cuando: '30 días seguidos registrando lectura' },
    { id: 'devorador', nombre: 'Devorador de Libros', icono: '📚', cuando: '10 libros completados' },
    { id: 'comprension_alta', nombre: 'Maestro de la Comprensión', icono: '💡', cuando: '5 evaluaciones en Logro Destacado' },
    { id: 'prestamo_responsable', nombre: 'Lector Responsable', icono: '⏱', cuando: '10 préstamos devueltos a tiempo' },
    { id: 'critico', nombre: 'Crítico Literario', icono: '💬', cuando: '5 reseñas de libros' },
    { id: 'meta_mensual', nombre: 'Meta Cumplida', icono: '🚩', cuando: 'Leyó su meta de libros en un mes' }
  ];

  const META_PERSONAL_DEFECTO = 4;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase(); }
  const aISO = d => d.toISOString().slice(0, 10);
  function sumarDias(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return aISO(d); }

  /* ---------- Puntos y niveles ---------- */

  // 2 puntos por página y medio punto por minuto (igual que el Lectómetro).
  function puntosLectura(paginas, minutos) {
    const p = Math.max(0, Number(paginas) || 0), m = Math.max(0, Number(minutos) || 0);
    return Math.round(p * 2 + m * 0.5);
  }

  function nivelDeLector(puntos) {
    const pts = Math.max(0, Number(puntos) || 0);
    let actual = NIVELES_LECTOR[0], idx = 0;
    NIVELES_LECTOR.forEach((n, i) => { if (pts >= n.min) { actual = n; idx = i; } });
    const sig = NIVELES_LECTOR[idx + 1] || null;
    return { ...actual, indice: idx, siguiente: sig, faltan: sig ? sig.min - pts : 0 };
  }

  // Puntaje 0-100 → escala del Currículo Nacional (la misma que usa Comprensión lectora).
  function nivelLogroDePuntaje(p) {
    const n = Number(p) || 0;
    return n >= 91 ? 'AD' : n >= 71 ? 'A' : n >= 51 ? 'B' : 'C';
  }

  /* ---------- Evaluaciones (cuestionarios por libro) ---------- */

  // Devuelve un texto de error o '' si el cuestionario está bien armado.
  function validarEvaluacion(q) {
    if (!q || !String(q.titulo || '').trim()) return 'Escribe el título de la evaluación.';
    const ps = Array.isArray(q.preguntas) ? q.preguntas : [];
    if (!ps.length) return 'Agrega al menos una pregunta.';
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i], ops = Array.isArray(p.opciones) ? p.opciones.filter(o => String(o || '').trim()) : [];
      if (!String(p.texto || '').trim()) return 'La pregunta ' + (i + 1) + ' no tiene enunciado.';
      if (ops.length < 2) return 'La pregunta ' + (i + 1) + ' necesita al menos 2 opciones.';
      if (!Number.isInteger(p.correcta) || p.correcta < 0 || p.correcta >= (p.opciones || []).length || !String(p.opciones[p.correcta] || '').trim()) return 'Marca la respuesta correcta de la pregunta ' + (i + 1) + '.';
    }
    return '';
  }

  // respuestas: arreglo de índices elegidos (null = sin responder, cuenta como incorrecta).
  function calificarEvaluacion(quiz, respuestas) {
    const ps = (quiz && quiz.preguntas) || [];
    let correctas = 0;
    ps.forEach((p, i) => { if (respuestas && respuestas[i] === p.correcta) correctas++; });
    const puntaje = ps.length ? Math.round(correctas / ps.length * 100) : 0;
    return { correctas, total: ps.length, puntaje, nivel: nivelDeLogro(puntaje) };
  }
  const nivelDeLogro = nivelLogroDePuntaje;

  /* ---------- Rachas ---------- */

  // fechas: ISO 'AAAA-MM-DD' (con repetidas). La racha sigue viva si leyó hoy o ayer.
  function rachaActual(fechas, hoy) {
    const set = new Set(fechas || []);
    let dia = set.has(hoy) ? hoy : sumarDias(hoy, -1);
    if (!set.has(dia)) return 0;
    let n = 0;
    while (set.has(dia)) { n++; dia = sumarDias(dia, -1); }
    return n;
  }
  function rachaMaxima(fechas) {
    const orden = [...new Set(fechas || [])].sort();
    let max = 0, cur = 0, prev = '';
    for (const f of orden) { cur = prev && sumarDias(prev, 1) === f ? cur + 1 : 1; if (cur > max) max = cur; prev = f; }
    return max;
  }

  /* ---------- Resumen de un lector ---------- */

  // Todo lo que se muestra de un lector, calculado con los datos de la biblioteca.
  //   lector, bitacora[], prestamos[], comprension[], resenas[], canjes[], premios[]
  function resumenLector({ lector, bitacora, prestamos, comprension, resenas, canjes, premios, hoy, metaLibros }) {
    const id = lector.id;
    const bit = (bitacora || []).filter(b => b.lectorId === id);
    const costo = new Map((premios || []).map(p => [p.id, Number(p.costoPuntos) || 0]));
    const gastados = (canjes || []).filter(c => c.lectorId === id && c.estado !== 'anulado').reduce((a, c) => a + (Number(c.costo != null ? c.costo : costo.get(c.premioId)) || 0), 0);
    const ganados = Math.max(0, Number(lector.puntosIniciales) || 0) + bit.reduce((a, b) => a + (Number(b.puntos) || 0), 0);
    const devueltos = (prestamos || []).filter(p => p.lectorId === id && p.devuelto && !p.perdido);
    const libros = new Set();
    bit.forEach(b => libros.add(b.libroId || 't:' + norm(b.libroTitulo)));
    devueltos.forEach(p => libros.add(p.libroId));
    libros.delete(''); libros.delete('t:');
    const fechas = bit.map(b => b.fecha);
    const racha = rachaActual(fechas, hoy), rachaMax = rachaMaxima(fechas);
    const evals = (comprension || []).filter(c => c.lectorId === id);
    const destacadas = evals.filter(c => c.nivel === 'AD').length;
    const aTiempo = devueltos.filter(p => p.vence && p.devuelto <= p.vence).length;
    const nResenas = (resenas || []).filter(r => r.lectorId === id).length;
    // Meta mensual: libros distintos leídos en un mismo mes ≥ meta (de ese lector o la general).
    const meta = Math.max(1, Number(metaLibros) || META_PERSONAL_DEFECTO), porMes = new Map();
    const marca = (mes, l) => { if (!porMes.has(mes)) porMes.set(mes, new Set()); porMes.get(mes).add(l); };
    bit.forEach(b => marca(String(b.fecha).slice(0, 7), b.libroId || 't:' + norm(b.libroTitulo)));
    devueltos.forEach(p => marca(String(p.devuelto).slice(0, 7), p.libroId));
    const mejorMes = Math.max(0, ...[...porMes.values()].map(s => s.size));
    const insignias = [];
    if (libros.size >= 1) insignias.push('primer_libro');
    if (rachaMax >= 7) insignias.push('racha_7');
    if (rachaMax >= 30) insignias.push('racha_30');
    if (libros.size >= 10) insignias.push('devorador');
    if (destacadas >= 5) insignias.push('comprension_alta');
    if (aTiempo >= 10) insignias.push('prestamo_responsable');
    if (nResenas >= 5) insignias.push('critico');
    if (mejorMes >= meta) insignias.push('meta_mensual');
    const mesActual = String(hoy).slice(0, 7);
    return {
      puntos: ganados, gastados, saldo: ganados - gastados, nivel: nivelDeLector(ganados), racha, rachaMax,
      libros: libros.size, minutos: bit.reduce((a, b) => a + (Number(b.minutos) || 0), 0), paginas: bit.reduce((a, b) => a + (Number(b.paginas) || 0), 0),
      registros: bit.length, insignias, evaluaciones: evals.length, destacadas, mesActual: (porMes.get(mesActual) || new Set()).size, meta
    };
  }

  // Ranking por puntos ganados (no por saldo: canjear un premio no te hace bajar de puesto).
  function rankingPuntos({ lectores, bitacora, hoy, grupoDe, prestamos, comprension, resenas, canjes, premios }) {
    const filas = (lectores || []).filter(l => !l.baja && (l.tipo || 'Alumno') === 'Alumno').map(l => {
      const r = resumenLector({ lector: l, bitacora, prestamos, comprension, resenas, canjes, premios, hoy });
      return { lector: l, grupo: grupoDe ? grupoDe(l) : (l.grado || ''), ...r };
    }).filter(f => f.puntos > 0);
    filas.sort((a, b) => b.puntos - a.puntos || b.libros - a.libros || String(a.lector.nombre).localeCompare(String(b.lector.nombre), 'es'));
    let pos = 0, ant = null, n = 0;
    filas.forEach(f => { n++; if (f.puntos !== ant) { pos = n; ant = f.puntos; } f.pos = pos; });
    return filas;
  }

  /* ---------- Premios ---------- */
  // Devuelve '' si puede canjear o el motivo si no.
  function motivoNoCanje(premio, saldo) {
    if (!premio || premio.activo === false) return 'Este premio ya no está disponible.';
    if (premio.stock !== null && premio.stock !== undefined && premio.stock !== '' && Number(premio.stock) <= 0) return 'No quedan unidades de este premio.';
    if ((Number(saldo) || 0) < (Number(premio.costoPuntos) || 0)) return 'Puntos insuficientes: tiene ' + (Number(saldo) || 0) + ' y el premio cuesta ' + (Number(premio.costoPuntos) || 0) + '.';
    return '';
  }

  /* ---------- Certificado de lectura (nivel de lector) ---------- */
  function certificadoLectorHTML({ nombre, grado, resumen, nombreIE, fecha, firma1, firma2 }) {
    const n = resumen.nivel, ins = resumen.insignias.map(id => (INSIGNIAS.find(i => i.id === id) || {}).icono || '').join(' ');
    return `<div class="cert"><div class="marco"><div class="ie">${esc(nombreIE || '')}</div><div class="bib">BIBLIOTECA ESCOLAR · LECTÓMETRO</div>
<div class="tit">CERTIFICADO DE LECTURA</div><div class="otg">Se otorga con orgullo a</div><div class="nom">${esc(nombre)}</div>${grado ? `<div class="gr">${esc(grado)}</div>` : ''}
<div class="txt">Por alcanzar el nivel <b>${esc(n.icono)} ${esc(n.nombre)}</b> con <b>${esc(resumen.puntos)}</b> puntos de lectura, <b>${esc(resumen.libros)}</b> libro(s) leídos y una racha máxima de <b>${esc(resumen.rachaMax)}</b> día(s).</div>
${ins ? `<div class="ins">${ins}</div>` : ''}<div class="fec">${esc(fecha || '')}</div>
<div class="firmas"><div><div class="ln"></div>${esc(firma1 || 'Responsable de la biblioteca')}</div><div><div class="ln"></div>${esc(firma2 || 'Dirección')}</div></div></div></div>`;
  }

  /* ---------- Migración desde LectorIEP (exportarTodo() → .json) ---------- */
  // paquete: el archivo de "Base de datos → Descargar respaldo" del Lectómetro.
  // ctx: { lectores, libros, prestamos, uid(prefijo), siguienteCod(extra[]) } con los datos YA existentes en SIGIE.
  // No toca nada: devuelve lo NUEVO a agregar y un reporte. Se puede correr dos veces sin duplicar
  // (cada registro importado guarda origen:'lectometro:<id>').
  function convertirLectometro(paquete, ctx) {
    const rep = { lectores: 0, lectoresExistentes: 0, bitacora: 0, evaluaciones: 0, resultados: 0, premios: 0, canjes: 0, actividades: 0, prestamos: 0, omitidos: [] };
    if (!paquete || typeof paquete !== 'object' || !paquete.data || typeof paquete.data !== 'object') return { error: 'El archivo no es un respaldo del Lectómetro (falta "data").', reporte: rep };
    const D = paquete.data, arr = k => Array.isArray(D[k]) ? D[k] : [];
    const uid = ctx.uid || (p => p + '_' + Math.random().toString(36).slice(2, 9));
    const lectoresSigie = ctx.lectores || [], libros = ctx.libros || [];
    const yaImp = new Set((ctx.yaImportados || []));
    const nuevo = { lectores: [], bitacora: [], quizzes: [], quizres: [], premios: [], canjes: [], actividades: [], comprension: [], prestamos: [] };

    // Usuarios estudiantes → lectores (por nombre; si no existe, se crea con carné nuevo).
    const aulaTxt = u => { const niv = u.nivel === 'secundaria' ? 'Secundaria' : u.nivel === 'primaria' ? 'Primaria' : ''; return [u.grado ? u.grado + '°' : '', u.seccion || '', niv].filter(Boolean).join(' '); };
    const aulas = new Map(arr('aulas').map(a => [a.id, a]));
    const mapaLector = new Map(), usuariosEst = arr('usuarios').filter(u => u.rol === 'estudiante');
    for (const u of usuariosEst) {
      const clave = norm(u.nombre); if (!clave) continue;
      const aula = aulas.get(u.aulaId) || u, existente = lectoresSigie.find(l => norm(l.nombre) === clave) || nuevo.lectores.find(l => norm(l.nombre) === clave);
      if (existente) { mapaLector.set(u.id, existente.id); rep.lectoresExistentes++; if (existente._nuevo === undefined && Number(u.puntos) > 0) { /* los puntos se reconstruyen abajo */ } continue; }
      const l = { id: uid('lec'), cod: ctx.siguienteCod ? ctx.siguienteCod(nuevo.lectores) : 'LEC-' + String(lectoresSigie.length + nuevo.lectores.length + 1).padStart(4, '0'), nombre: String(u.nombre).toUpperCase(), grado: aulaTxt(aula), tipo: 'Alumno', tel: '', origen: 'lectometro:' + u.id };
      nuevo.lectores.push(l); mapaLector.set(u.id, l.id); rep.lectores++;
    }
    // Libros por título (y autor si hay) para no depender de ids distintos.
    const libroSigie = new Map(); libros.forEach(l => libroSigie.set(norm(l.titulo), l.id));
    const libroLec = new Map(arr('libros').map(b => [b.id, b]));
    const mapaLibro = id => { const b = libroLec.get(id); return b ? (libroSigie.get(norm(b.titulo)) || '') : ''; };
    const tituloDe = id => (libroLec.get(id) || {}).titulo || '';

    // Bitácora de lectura.
    for (const b of arr('bitacora')) {
      const lid = mapaLector.get(b.usuarioId); if (!lid) { rep.omitidos.push('Bitácora de un usuario que no es estudiante (' + b.usuarioId + ')'); continue; }
      const origen = 'lectometro:' + b.id; if (yaImp.has(origen)) continue;
      nuevo.bitacora.push({ id: uid('bt'), lectorId: lid, libroId: mapaLibro(b.libroId), libroTitulo: tituloDe(b.libroId), fecha: b.fecha, paginas: Number(b.paginas) || 0, minutos: Number(b.minutos) || 0, autoevaluacion: Number(b.autoevaluacion) || 0, comentario: String(b.comentario || '').slice(0, 300), puntos: b.puntos != null ? Number(b.puntos) : puntosLectura(b.paginas, b.minutos), origen });
      rep.bitacora++;
    }
    // Evaluaciones y resultados (los resultados también pasan a Comprensión lectora).
    const mapaQuiz = new Map();
    for (const q of arr('quizzes')) {
      const origen = 'lectometro:' + q.id; if (yaImp.has(origen)) { continue; }
      const nq = { id: uid('ev'), libroId: mapaLibro(q.libroId), libroTitulo: tituloDe(q.libroId), titulo: q.titulo || 'Evaluación', preguntas: (q.preguntas || []).map(p => ({ texto: p.texto || p.pregunta || '', opciones: p.opciones || [], correcta: p.correcta })), origen };
      nuevo.quizzes.push(nq); mapaQuiz.set(q.id, nq.id); rep.evaluaciones++;
    }
    for (const r of arr('resultadosQuiz')) {
      const lid = mapaLector.get(r.usuarioId); if (!lid) continue;
      const origen = 'lectometro:' + r.id; if (yaImp.has(origen)) continue;
      const nivel = nivelLogroDePuntaje(r.puntaje), lec = lectoresSigie.find(l => l.id === lid) || nuevo.lectores.find(l => l.id === lid) || {};
      nuevo.quizres.push({ id: uid('qr'), quizId: mapaQuiz.get(r.quizId) || '', lectorId: lid, puntaje: Number(r.puntaje) || 0, nivel, fecha: r.fecha, origen });
      nuevo.comprension.push({ id: uid('cp'), prestId: '', libroId: '', lectorId: lid, lector: lec.nombre || '', grado: lec.grado || '', nivel, obs: 'Evaluación del Lectómetro (' + (Number(r.puntaje) || 0) + '%)', fecha: r.fecha, docente: '', origen });
      rep.resultados++;
    }
    // Premios y canjes.
    const mapaPremio = new Map();
    for (const p of arr('premios')) {
      const origen = 'lectometro:' + p.id; if (yaImp.has(origen)) continue;
      const np = { id: uid('pr'), nombre: p.nombre, descripcion: p.descripcion || '', costoPuntos: Number(p.costoPuntos) || 0, stock: p.stock === null || p.stock === undefined ? null : Number(p.stock), activo: p.activo !== false, origen };
      nuevo.premios.push(np); mapaPremio.set(p.id, np.id); rep.premios++;
    }
    const costoPremio = new Map(arr('premios').map(p => [p.id, Number(p.costoPuntos) || 0]));
    for (const c of arr('canjes')) {
      const lid = mapaLector.get(c.usuarioId), pid = mapaPremio.get(c.premioId); if (!lid || !pid) continue;
      const origen = 'lectometro:' + c.id; if (yaImp.has(origen)) continue;
      nuevo.canjes.push({ id: uid('cj'), lectorId: lid, premioId: pid, costo: costoPremio.get(c.premioId) || 0, fecha: c.fecha, estado: c.estado === 'entregado' ? 'entregado' : 'pendiente', origen }); rep.canjes++;
    }
    for (const a of arr('actividades')) {
      const origen = 'lectometro:' + a.id; if (yaImp.has(origen)) continue;
      nuevo.actividades.push({ id: uid('ac'), titulo: a.titulo || 'Actividad', fecha: a.fecha, tipo: a.tipo || 'Otro', descripcion: a.descripcion || '', hecha: false, origen }); rep.actividades++;
    }
    // Ajuste de puntos: si el usuario tenía más puntos de los que explica su bitácora, se conservan.
    for (const u of usuariosEst) {
      const lid = mapaLector.get(u.id), l = nuevo.lectores.find(x => x.id === lid); if (!l) continue;
      const exp = nuevo.bitacora.filter(b => b.lectorId === lid).reduce((a, b) => a + b.puntos, 0) - nuevo.canjes.filter(c => c.lectorId === lid).reduce((a, c) => a + c.costo, 0);
      const dif = (Number(u.puntos) || 0) - exp; if (dif > 0) l.puntosIniciales = dif;
    }
    // Préstamos (solo de libros que ya existen en el catálogo de SIGIE).
    for (const p of arr('prestamos')) {
      const lid = mapaLector.get(p.usuarioId), libId = mapaLibro(p.libroId); if (!lid || !libId) { if (lid) rep.omitidos.push('Préstamo de «' + (tituloDe(p.libroId) || p.libroId) + '»: ese libro no está en el catálogo de SIGIE'); continue; }
      const origen = 'lectometro:' + p.id; if (yaImp.has(origen)) continue;
      const lec = lectoresSigie.find(l => l.id === lid) || nuevo.lectores.find(l => l.id === lid) || {};
      nuevo.prestamos.push({ id: uid('bp'), libroId: libId, lectorId: lid, lector: lec.nombre || '', grado: lec.grado || '', fecha: p.fechaPrestamo, vence: p.fechaDevolucionEsperada, devuelto: p.fechaDevolucionReal || '', origen }); rep.prestamos++;
    }
    return { nuevo, reporte: rep };
  }

  /* ---------- Plan lector: actividades ---------- */
  // Actividades pendientes que caen entre hoy y hoy+dias (incluye las de hoy), de la más cercana a la más lejana.
  function actividadesProximas(actividades, hoy, dias) {
    const tope = sumarDias(hoy, Math.max(0, dias == null ? 7 : dias));
    return (actividades || []).filter(a => a.fecha && !a.hecha && a.fecha >= hoy && a.fecha <= tope).sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.titulo).localeCompare(String(b.titulo), 'es'));
  }
  function actividadesVencidas(actividades, hoy) { return (actividades || []).filter(a => a.fecha && !a.hecha && a.fecha < hoy); }

  // Hoja lista para imprimir con los certificados de lectura (mismo diseño que el certificado de lector).
  function documentoCertificados(hojas, titulo) {
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${esc(titulo || 'Certificados de lectura')}</title><style>
@page{size:A4 landscape;margin:0}
*{box-sizing:border-box} body{font-family:Georgia,'Times New Roman',serif;margin:0;color:#1a1a1a}
.barra{background:#14304d;color:#fff;padding:8px 12px;display:flex;gap:12px;align-items:center;font-family:Arial,sans-serif} .barra button{padding:5px 10px;cursor:pointer}
.cert{width:297mm;height:210mm;padding:10mm;page-break-after:always;break-after:page;display:flex}
.cert:last-of-type{page-break-after:auto;break-after:auto}
.marco{flex:1;border:2.5mm double #14304d;padding:10mm 18mm;text-align:center;display:flex;flex-direction:column;justify-content:center;gap:3mm}
.ie{font-size:13pt;letter-spacing:.5mm;color:#14304d;font-weight:700} .bib{font-size:10pt;letter-spacing:1.2mm;color:#666}
.tit{font-size:32pt;font-weight:700;color:#14304d;margin:5mm 0 2mm} .otg{font-size:13pt;font-style:italic;color:#555}
.nom{font-size:30pt;font-weight:700;border-bottom:.4mm solid #999;padding:1mm 8mm;margin:2mm auto;align-self:center;min-width:140mm}
.gr{font-size:12pt;color:#444} .txt{font-size:14pt;line-height:1.5;margin:3mm auto;max-width:200mm}
.ins{font-size:22pt;margin:1mm 0} .fec{font-size:11pt;color:#555}
.firmas{display:flex;justify-content:space-around;margin-top:12mm;font-size:11pt} .ln{width:62mm;border-top:.3mm solid #333;margin:0 auto 1.5mm}
@media print{.barra{display:none}}
</style></head><body><div class="barra"><b>${hojas.length} certificado(s)</b><button onclick="window.print()">🖨 Imprimir</button><span style="font-size:12px">Papel A4 horizontal, sin márgenes ni ajuste a la página.</span></div>
${hojas.join('\n')}
</body></html>`;
  }

  const api = { documentoCertificados, actividadesProximas, actividadesVencidas, NIVELES_LECTOR, INSIGNIAS, META_PERSONAL_DEFECTO, puntosLectura, nivelDeLector, nivelLogroDePuntaje, validarEvaluacion, calificarEvaluacion, rachaActual, rachaMaxima, resumenLector, rankingPuntos, motivoNoCanje, certificadoLectorHTML, convertirLectometro };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SigieLec = api;
})(typeof window !== 'undefined' ? window : globalThis);
