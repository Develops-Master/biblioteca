/* =========================================================================
   SIGIE — Panel «Mi lectura» y gráficos del tablero: lógica pura (v13)
   -------------------------------------------------------------------------
   Sin DOM y sin acceso a datos: todo entra por parámetros, así se prueba en Node.
     serieDias            lecturas por día (páginas, minutos) de un lector o de todos
     tendencia            compara la última semana con la anterior
     metaMes              avance de la meta mensual de libros (con días que quedan)
     recomendar           libros disponibles que aún no leyó, por afinidad de categoría,
                          autor y valoración (sin datos personales de otros lectores)
     serieMeses           préstamos por mes
     distribucionNiveles  AD / A / B / C
     svgBarras / svgBarrasH   gráficos en SVG con colores del tema y texto escapado
   Funciona igual en el navegador (<script>) y en Node (tests).
   ========================================================================= */
(function (global) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const aISO = d => d.toISOString().slice(0, 10);
  const sumarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return aISO(d); };
  const diasDelMes = iso => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).getUTCDate();
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const etiquetaDia = iso => Number(iso.slice(8, 10)) + ' ' + MESES[Number(iso.slice(5, 7)) - 1];

  /* ---------- 1. Lecturas por día ---------- */
  // lectorId vacío = todos los lectores. Devuelve `dias` entradas, la última es `hoy`.
  function serieDias({ bitacora, lectorId, hoy, dias }) {
    const n = Math.max(1, Math.min(366, Math.round(num(dias)) || 14)), ini = sumarDias(hoy, -(n - 1));
    const out = [];
    for (let i = 0; i < n; i++) out.push({ fecha: sumarDias(ini, i), lecturas: 0, paginas: 0, minutos: 0 });
    const idx = new Map(out.map((o, i) => [o.fecha, i]));
    (bitacora || []).forEach(b => {
      if (lectorId && b.lectorId !== lectorId) return;
      const i = idx.get(String(b.fecha).slice(0, 10)); if (i == null) return;
      out[i].lecturas++; out[i].paginas += Math.max(0, num(b.paginas)); out[i].minutos += Math.max(0, num(b.minutos));
    });
    return out;
  }

  // Última semana (7 días) contra la anterior, en minutos. estado: sube | baja | igual | sin_datos
  function tendencia(serie) {
    const s = serie || [], a = s.slice(-7), p = s.slice(-14, -7);
    const actual = a.reduce((t, x) => t + x.minutos, 0), previo = p.reduce((t, x) => t + x.minutos, 0);
    const diasConLectura = a.filter(x => x.lecturas > 0).length;
    if (!actual && !previo) return { actual, previo, cambioPct: null, estado: 'sin_datos', diasConLectura };
    if (!previo) return { actual, previo, cambioPct: null, estado: 'sube', diasConLectura };
    const cambioPct = Math.round((actual - previo) / previo * 100);
    return { actual, previo, cambioPct, estado: Math.abs(cambioPct) < 5 ? 'igual' : cambioPct > 0 ? 'sube' : 'baja', diasConLectura };
  }

  /* ---------- 2. Meta mensual de libros ---------- */
  function metaMes({ leidos, meta, hoy }) {
    const m = Math.max(0, Math.round(num(meta))), l = Math.max(0, Math.round(num(leidos)));
    const diasMes = diasDelMes(hoy), diaHoy = Number(hoy.slice(8, 10)), quedan = Math.max(0, diasMes - diaHoy);
    const pct = m ? Math.min(100, Math.round(l / m * 100)) : null, faltan = m ? Math.max(0, m - l) : 0;
    // Ritmo: ¿va por buen camino? (lo leído vs lo esperado a esta altura del mes)
    const esperado = m ? m * diaHoy / diasMes : 0;
    const ritmo = !m ? 'sin_meta' : l >= m ? 'cumplida' : l + 0.5 >= esperado ? 'al_dia' : 'atrasado';
    return { leidos: l, meta: m, faltan, pct, quedan, ritmo };
  }

  /* ---------- 3. Recomendaciones ---------- */
  // libros: [{id,titulo,autor,catId,baja}] · libres(libro) → ejemplares disponibles
  // categorias: [{id,nombre}] · prestamos/bitacora/resenas: los de TODO el colegio (solo se usan agregados)
  function recomendar({ lector, libros, categorias, prestamos, bitacora, resenas, libres, max }) {
    const tope = Math.max(1, Math.min(12, Math.round(num(max)) || 5));
    const cats = new Map((categorias || []).map(c => [c.id, c.nombre]));
    const porId = new Map((libros || []).map(l => [l.id, l]));
    const porTit = new Map((libros || []).map(l => [norm(l.titulo), l]));
    const mios = new Set(), gustados = [];   // gustados: libros que valoró 4 o más
    (prestamos || []).forEach(p => { if (p.lectorId === lector.id && p.libroId) mios.add(p.libroId); });
    (bitacora || []).forEach(b => {
      if (b.lectorId !== lector.id) return;
      const l = (b.libroId && porId.get(b.libroId)) || porTit.get(norm(b.libroTitulo));
      if (l) { mios.add(l.id); if (num(b.autoevaluacion) >= 4) gustados.push(l); }
    });
    (resenas || []).forEach(r => { if (r.lectorId === lector.id && r.libroId) { mios.add(r.libroId); if (num(r.estrellas) >= 4 && porId.get(r.libroId)) gustados.push(porId.get(r.libroId)); } });
    const peso = new Map(), autores = new Map();
    mios.forEach(id => { const l = porId.get(id); if (l && l.catId) peso.set(l.catId, (peso.get(l.catId) || 0) + 1); });
    gustados.forEach(l => { if (l.catId) peso.set(l.catId, (peso.get(l.catId) || 0) + 2); if (l.autor) autores.set(norm(l.autor), true); });
    const stat = new Map();   // libroId → { n préstamos, suma estrellas, k reseñas }
    const g = id => { if (!stat.has(id)) stat.set(id, { n: 0, s: 0, k: 0 }); return stat.get(id); };
    (prestamos || []).forEach(p => { if (p.libroId) g(p.libroId).n++; });
    (resenas || []).forEach(r => { if (r.libroId && num(r.estrellas) > 0) { const o = g(r.libroId); o.s += num(r.estrellas); o.k++; } });
    const maxPeso = Math.max(1, ...peso.values()), maxN = Math.max(1, ...[...stat.values()].map(o => o.n));
    const cand = (libros || []).filter(l => !l.baja && !mios.has(l.id) && num(libres(l)) > 0).map(l => {
      const o = stat.get(l.id) || { n: 0, s: 0, k: 0 }, prom = o.k ? o.s / o.k : 0;
      const afin = l.catId && peso.has(l.catId) ? peso.get(l.catId) / maxPeso : 0, mismoAutor = l.autor && autores.has(norm(l.autor));
      const score = afin * 5 + (mismoAutor ? 2 : 0) + (o.k >= 2 ? prom / 5 * 2 : 0) + o.n / maxN;
      let motivo;
      if (mismoAutor) motivo = 'Del mismo autor de un libro que le gustó';
      else if (afin >= 0.5) motivo = 'Le gusta la categoría ' + (cats.get(l.catId) || 'de sus lecturas');
      else if (o.k >= 2 && prom >= 4) motivo = 'Muy bien valorado (' + prom.toFixed(1) + ' de 5)';
      else if (o.n >= 3) motivo = 'Uno de los más pedidos';
      else motivo = 'Para explorar algo nuevo';
      return { libro: l, score, motivo, prom: o.k ? Math.round(prom * 10) / 10 : null };
    });
    cand.sort((a, b) => b.score - a.score || String(a.libro.titulo).localeCompare(String(b.libro.titulo), 'es'));
    return cand.slice(0, tope);
  }

  /* ---------- 4. Series para el tablero ---------- */
  // Préstamos por mes: los últimos `meses` meses terminando en el de `hoy`.
  function serieMeses({ prestamos, hoy, meses }) {
    const n = Math.max(1, Math.min(24, Math.round(num(meses)) || 6));
    let y = Number(hoy.slice(0, 4)), m = Number(hoy.slice(5, 7));
    const claves = [];
    for (let i = 0; i < n; i++) { claves.unshift(y + '-' + String(m).padStart(2, '0')); m--; if (m < 1) { m = 12; y--; } }
    const idx = new Map(claves.map((k, i) => [k, i])), out = claves.map(k => ({ mes: k, etiqueta: MESES[Number(k.slice(5)) - 1], prestamos: 0 }));
    (prestamos || []).forEach(p => { const i = idx.get(String(p.fecha || '').slice(0, 7)); if (i != null) out[i].prestamos++; });
    return out;
  }
  function distribucionNiveles(comprension, anio) {
    const o = { AD: 0, A: 0, B: 0, C: 0 };
    (comprension || []).forEach(c => { if ((!anio || String(c.fecha).startsWith(String(anio))) && o[c.nivel] != null) o[c.nivel]++; });
    return o;
  }

  /* ---------- 5. Gráficos SVG (sin librerías, texto escapado, colores del tema) ---------- */
  const COL = { base: 'var(--primary,#14304d)', ok: '#2a7d4f', warn: '#b7791f', bad: '#b3261e', ejes: 'var(--line,#cfd6de)', texto: 'currentColor' };
  // items: [{ etiqueta, valor, color? }] → columnas verticales. Muestra el valor encima y cada `cadaN` etiquetas.
  function svgBarras({ items, titulo, ancho, alto, cadaN }) {
    const W = Math.max(240, Math.round(num(ancho)) || 560), H = Math.max(120, Math.round(num(alto)) || 180), arr = items || [];
    const padI = 28, padD = 8, padS = 14, padB = 26, n = Math.max(1, arr.length), paso = (W - padI - padD) / n, bw = Math.max(2, paso * 0.68);
    const max = Math.max(1, ...arr.map(x => num(x.valor))), h = H - padS - padB, c = Math.max(1, Math.round(num(cadaN)) || 1);
    const barras = arr.map((x, i) => {
      const v = Math.max(0, num(x.valor)), bh = v / max * h, bx = padI + i * paso + (paso - bw) / 2, by = padS + h - bh;
      return `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${x.color || COL.base}"><title>${esc(x.etiqueta)}: ${v}</title></rect>`
        + (n <= 12 && v ? `<text x="${(bx + bw / 2).toFixed(1)}" y="${(by - 3).toFixed(1)}" font-size="10" text-anchor="middle" fill="${COL.texto}">${v}</text>` : '')
        + (i % c === 0 ? `<text x="${(bx + bw / 2).toFixed(1)}" y="${H - 9}" font-size="10" text-anchor="middle" fill="${COL.texto}" opacity=".75">${esc(x.etiqueta)}</text>` : '');
    }).join('');
    const ejes = `<line x1="${padI}" y1="${padS + h}" x2="${W - padD}" y2="${padS + h}" stroke="${COL.ejes}"/><line x1="${padI}" y1="${padS}" x2="${padI}" y2="${padS + h}" stroke="${COL.ejes}"/>`
      + `<text x="${padI - 4}" y="${padS + 8}" font-size="10" text-anchor="end" fill="${COL.texto}" opacity=".75">${max}</text><text x="${padI - 4}" y="${padS + h}" font-size="10" text-anchor="end" fill="${COL.texto}" opacity=".75">0</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(titulo || 'Gráfico')}" style="max-width:${W}px;height:auto"><title>${esc(titulo || 'Gráfico')}</title>${ejes}${barras}</svg>`;
  }
  // Barras horizontales (categorías con nombres largos): items [{ etiqueta, valor, color? }]
  function svgBarrasH({ items, titulo, ancho, sufijo }) {
    const W = Math.max(260, Math.round(num(ancho)) || 560), arr = items || [], fila = 26, H = Math.max(40, arr.length * fila + 8), padI = 130, padD = 46;
    const max = Math.max(1, ...arr.map(x => num(x.valor))), suf = sufijo || '';
    const filas = arr.map((x, i) => {
      const v = Math.max(0, num(x.valor)), w = v / max * (W - padI - padD), y = 4 + i * fila, et = String(x.etiqueta == null ? '' : x.etiqueta), corto = et.length > 20 ? et.slice(0, 19) + '…' : et;
      return `<text x="${padI - 6}" y="${y + 15}" font-size="11" text-anchor="end" fill="${COL.texto}"><title>${esc(et)}</title>${esc(corto)}</text>`
        + `<rect x="${padI}" y="${y + 3}" width="${Math.max(2, w).toFixed(1)}" height="16" rx="3" fill="${x.color || COL.base}"><title>${esc(et)}: ${v}${esc(suf)}</title></rect>`
        + `<text x="${(padI + Math.max(2, w) + 5).toFixed(1)}" y="${y + 15}" font-size="11" fill="${COL.texto}">${v}${esc(suf)}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(titulo || 'Gráfico')}" style="max-width:${W}px;height:auto"><title>${esc(titulo || 'Gráfico')}</title>${filas}</svg>`;
  }

  const api = { serieDias, tendencia, metaMes, recomendar, serieMeses, distribucionNiveles, svgBarras, svgBarrasH, etiquetaDia, sumarDias, COL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SigiePanel = api;
})(typeof window !== 'undefined' ? window : globalThis);
