/* SIGIE v16 — Inicio: cálculos y dibujo de gráficos.
   Todo es SVG/HTML puro (sin Chart.js ni CDN): carga al instante y funciona sin internet.
   Lógica pura: se prueba en Node (test/inicio.test.js). La pantalla está en inicio.js. */
(function(root){
  const C = { navy:'#1B3A5C', ambar:'#C77D2E', verde:'#3E6B4F', rojo:'#A63A3A', azul:'#2c5a8c', morado:'#8c5a9e', dorado:'#a9822f', gris:'#b9b4a8', tinta:'#4d5c6b' };
  const PALETA = [C.navy, C.ambar, C.verde, C.rojo, C.azul, C.morado, C.dorado, C.tinta];
  const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const num = n => Number(n) || 0;
  const addDias = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const difDias = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
  const ejem = l => Math.max(1, Number(l.cant) || 1);
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;

  /* ===================== Cálculos ===================== */
  function calcular(d){
    d = d || {};
    const hoy = d.hoy, prest = d.prest || [], res = d.res || [], libros = d.libros || [], cats = d.cats || [];
    const lectores = (d.lect || []).filter(x => !x.baja);
    const claveGrado = d.claveGrado || (g => String(g || '—'));
    const lib = new Map(libros.map(l => [l.id, l]));
    const activos = prest.filter(p => !p.devuelto);
    const vencidos = activos.filter(p => p.vence && p.vence < hoy);
    const porVencer = activos.filter(p => p.vence && p.vence >= hoy && p.vence <= addDias(hoy, 2));
    const alDia = activos.length - vencidos.length - porVencer.length;
    const estadoPrest = [
      { label:'Al día', valor:alDia, color:C.verde },
      { label:'Por vencer (2 días)', valor:porVencer.length, color:C.ambar },
      { label:'Vencidos', valor:vencidos.length, color:C.rojo }
    ];

    const diasAtras = n => Array.from({ length:n }, (_, i) => addDias(hoy, -(n - 1 - i)));
    const contarPor = (campo, fechas) => {
      const m = new Map();
      prest.forEach(p => { const f = p[campo]; if(f && !(campo === 'devuelto' && p.perdido)) m.set(String(f), (m.get(String(f)) || 0) + 1); });
      return fechas.map(f => m.get(f) || 0);
    };
    const d30 = diasAtras(30), d14 = diasAtras(14);
    const dia30 = { fechas:d30, prestados:contarPor('fecha', d30), devueltos:contarPor('devuelto', d30) };
    const spark = { prestados:contarPor('fecha', d14), devueltos:contarPor('devuelto', d14) };

    const desde30 = addDias(hoy, -30), desde90 = addDias(hoy, -90), desde365 = addDias(hoy, -365);
    const p30 = prest.filter(p => p.fecha >= desde30), p90 = prest.filter(p => p.fecha >= desde90), p365 = prest.filter(p => p.fecha >= desde365);

    const semana = [0, 0, 0, 0, 0, 0, 0];
    p90.forEach(p => { semana[(new Date(p.fecha + 'T12:00:00Z').getUTCDay() + 6) % 7]++; });

    const [y0, m0] = hoy.split('-').map(Number);
    const meses = Array.from({ length:6 }, (_, i) => {
      const dt = new Date(Date.UTC(y0, m0 - 1 - (5 - i), 1));
      return { k:dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0'), etiqueta:MESES[dt.getUTCMonth()], prestados:0, devueltos:0 };
    });
    prest.forEach(p => {
      const a = p.fecha && meses.find(m => String(p.fecha).startsWith(m.k)); if(a) a.prestados++;
      const b = p.devuelto && !p.perdido && meses.find(m => String(p.devuelto).startsWith(m.k)); if(b) b.devueltos++;
    });

    const ranking = (arr, fn, n) => {
      const m = new Map(); arr.forEach(x => { const k = fn(x); if(k) m.set(k, (m.get(k) || 0) + 1); });
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, valor]) => ({ label, valor }));
    };
    const topTitulos = ranking(p30, p => (lib.get(p.libroId) || {}).titulo, 5);
    const porGrado = ranking(p90, p => claveGrado(p.grado), 8);
    const topLectores = ranking(p90, p => p.lector, 5);

    const presPorLibro = new Map(); p365.forEach(p => presPorLibro.set(p.libroId, (presPorLibro.get(p.libroId) || 0) + 1));
    const porCat = cats.map(c => {
      const ls = libros.filter(l => l.catId === c.id), ej = ls.reduce((a, l) => a + ejem(l), 0), pr = ls.reduce((a, l) => a + (presPorLibro.get(l.id) || 0), 0);
      return { label:c.nombre || c.prefijo || '—', valor:ej, color:c.color || C.navy, pres:pr };
    }).filter(x => x.valor > 0);
    const categorias = [...porCat].sort((a, b) => b.valor - a.valor).slice(0, 8);
    const rotacion = porCat.map(x => ({ label:x.label, valor:Math.round(x.pres / x.valor * 100) / 100, color:x.color, extra:'' }))
      .sort((a, b) => b.valor - a.valor).slice(0, 8);

    const totalEj = libros.reduce((a, l) => a + ejem(l), 0);
    const disponibles = Math.max(0, totalEj - activos.length);
    const estadoLibro = e => libros.filter(l => l.estado === e).reduce((a, l) => a + ejem(l), 0);
    const conservacion = [
      { label:'Bueno', valor:estadoLibro('Bueno'), color:C.verde },
      { label:'Regular', valor:estadoLibro('Regular'), color:C.ambar },
      { label:'Malo', valor:estadoLibro('Malo'), color:C.rojo }
    ];

    const colorRes = { Espera:C.ambar, Disponible:C.azul, Atendida:C.verde, Vencida:C.rojo, Cancelada:C.gris };
    const cuentaRes = new Map(); res.forEach(r => cuentaRes.set(r.estado, (cuentaRes.get(r.estado) || 0) + 1));
    const reservas = [...cuentaRes.entries()].map(([label, valor]) => ({ label, valor, color:colorRes[label] || C.tinta }));

    const cuentaTipo = new Map(); lectores.forEach(x => { const t = x.tipo || 'Alumno'; cuentaTipo.set(t, (cuentaTipo.get(t) || 0) + 1); });
    const lectoresTipo = [...cuentaTipo.entries()].sort((a, b) => b[1] - a[1]).map(([label, valor], i) => ({ label, valor, color:PALETA[i % PALETA.length] }));

    const dev90 = p90.filter(p => p.devuelto && !p.perdido), aTiempo90 = dev90.filter(p => p.devuelto <= p.vence);
    const cumplimiento = {
      pct:pct(aTiempo90.length, dev90.length), devueltos:dev90.length, perdidos:p90.filter(p => p.perdido).length,
      promDias:dev90.length ? Math.round(dev90.reduce((a, p) => a + Math.max(0, difDias(p.fecha, p.devuelto)), 0) / dev90.length * 10) / 10 : 0
    };

    const estantes = d.estantes || [], verificados = estantes.filter(u => u.toma && u.diasToma !== null && u.diasToma <= 90).length;
    const conPrestamo = new Set(prest.map(p => p.libroId));

    return {
      hoy, activos:activos.length, vencidos:vencidos.length, porVencer:porVencer.length, estadoPrest, dia30, spark, semana, meses,
      topTitulos, porGrado, topLectores, categorias, rotacion, totalEj, disponibles, conservacion, reservas, lectoresTipo, cumplimiento,
      estantes:{ total:estantes.length, verificados, pct:pct(verificados, estantes.length) },
      prestHoy:prest.filter(p => p.fecha === hoy).length, devHoy:prest.filter(p => p.devuelto === hoy && !p.perdido).length,
      nuncaPrestados:libros.filter(l => !conPrestamo.has(l.id)).length, malos:libros.filter(l => l.estado === 'Malo').length,
      enEspera:res.filter(r => r.estado === 'Espera').length, listas:res.filter(r => r.estado === 'Disponible').length,
      renovados:activos.filter(p => num(p.renov) > 0).length, lectoresActivos:lectores.length, titulos:libros.length
    };
  }

  /* ===================== Gráficos ===================== */
  const vacio = msg => `<div class="hm-vacio">${esc(msg || 'Aún no hay datos para mostrar.')}</div>`;

  function donut(segs, centro, sub){
    const total = segs.reduce((a, s) => a + num(s.valor), 0), R = 42, L = 2 * Math.PI * R;
    let off = 0, arcos = '';
    if(total > 0) segs.filter(s => s.valor > 0).forEach(s => {
      const len = s.valor / total * L;
      arcos += `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${s.color}" stroke-width="16" stroke-dasharray="${len.toFixed(2)} ${(L - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 60 60)"><title>${esc(s.label)}: ${s.valor}</title></circle>`;
      off += len;
    });
    const svg = `<svg viewBox="0 0 120 120" class="hm-donut" role="img" aria-label="${esc(centro)}"><circle cx="60" cy="60" r="${R}" fill="none" stroke="#ece9e2" stroke-width="16"/>${arcos}`
      + `<text x="60" y="${sub ? 56 : 62}" text-anchor="middle" class="hm-c1">${esc(centro)}</text>${sub ? `<text x="60" y="72" text-anchor="middle" class="hm-c2">${esc(sub)}</text>` : ''}</svg>`;
    const leyenda = `<ul class="hm-legend">${segs.map(s => `<li><span class="hm-dot" style="background:${s.color}"></span><span>${esc(s.label)}</span><b>${s.valor}</b></li>`).join('')}</ul>`;
    return `<div class="hm-donut-wrap">${svg}${leyenda}</div>`;
  }

  function barrasH(items, o){
    o = o || {};
    if(!items || !items.length) return vacio(o.vacio);
    const max = Math.max(...items.map(i => i.valor), 0) || 1;
    return `<div class="hm-bars">${items.map((i, k) => `<div class="hm-row"><div class="hm-row-top"><span class="hm-lbl" title="${esc(i.label)}">${o.rank ? `<i>${k + 1}</i>` : ''}${esc(i.label)}</span><b>${esc(o.fmt ? o.fmt(i.valor) : i.valor)}</b></div>`
      + `<div class="hm-track"><div class="hm-fill" style="width:${i.valor > 0 ? Math.max(3, i.valor / max * 100).toFixed(1) : 0}%;background:${i.color || PALETA[k % PALETA.length]}"></div></div>${i.extra ? `<div class="hm-extra">${esc(i.extra)}</div>` : ''}</div>`).join('')}</div>`;
  }

  function pasoBonito(max){
    if(max <= 4) return 1;
    const crudo = max / 4, p = Math.pow(10, Math.floor(Math.log10(crudo))), f = crudo / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }
  function ejesY(max, x0, x1, y0, y1){
    const paso = pasoBonito(max), top = paso * 4;
    return { top, svg:[0, 1, 2, 3, 4].map(i => { const y = y1 - (y1 - y0) * i / 4;
      return `<line x1="${x0}" x2="${x1}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#ece9e2"/><text x="${x0 - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" class="hm-ax">${Math.round(paso * i * 10) / 10}</text>`; }).join('') };
  }
  function leyendaSeries(series){ return `<div class="hm-leg-inline">${series.map(s => `<span><i class="hm-dot" style="background:${s.color}"></i>${esc(s.nombre)}</span>`).join('')}</div>`; }

  function columnas(labels, series, o){
    o = o || {};
    const W = o.W || 300, H = 190, x0 = 30, x1 = W - 6, y0 = 14, y1 = H - 24;
    const max = Math.max(0, ...series.flatMap(s => s.valores));
    if(!labels.length || max === 0) return vacio(o.vacio);
    const ej = ejesY(max, x0, x1, y0, y1), gw = (x1 - x0) / labels.length, bw = Math.min(24, gw * 0.72 / series.length);
    let barras = '';
    labels.forEach((lb, i) => {
      const gx = x0 + gw * i + (gw - bw * series.length) / 2;
      series.forEach((s, k) => {
        const v = s.valores[i], h = (y1 - y0) * v / ej.top;
        barras += `<rect x="${(gx + bw * k).toFixed(1)}" y="${(y1 - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${s.color}"><title>${esc(s.nombre)} · ${esc(lb)}: ${v}</title></rect>`;
        if(v > 0 && labels.length <= 8) barras += `<text x="${(gx + bw * k + (bw - 2) / 2).toFixed(1)}" y="${(y1 - h - 3).toFixed(1)}" text-anchor="middle" class="hm-val">${v}</text>`;
      });
      barras += `<text x="${(x0 + gw * i + gw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="hm-ax">${esc(lb)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="hm-svg" role="img">${ej.svg}${barras}</svg>${series.length > 1 ? leyendaSeries(series) : ''}`;
  }

  function linea(labels, series, o){
    o = o || {};
    const W = o.W || 300, H = 190, x0 = 30, x1 = W - 12, y0 = 14, y1 = H - 24, n = labels.length;
    const max = Math.max(0, ...series.flatMap(s => s.valores));
    if(!n || max === 0) return vacio(o.vacio);
    const ej = ejesY(max, x0, x1, y0, y1), px = i => x0 + (n === 1 ? 0 : (x1 - x0) * i / (n - 1)), py = v => y1 - (y1 - y0) * v / ej.top;
    const cada = Math.ceil(n / 6);
    const ticks = labels.map((lb, i) => (i % cada === 0 && i + cada < n) || i === n - 1 ? `<text x="${px(i).toFixed(1)}" y="${H - 8}" text-anchor="${i === n - 1 ? 'end' : i === 0 ? 'start' : 'middle'}" class="hm-ax">${esc(lb)}</text>` : '').join('');
    const trazos = series.map(s => {
      const pts = s.valores.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
      const area = `M${px(0).toFixed(1)},${y1} L${pts.replace(/ /g, ' L')} L${px(n - 1).toFixed(1)},${y1} Z`;
      const puntos = s.valores.map((v, i) => `<circle cx="${px(i).toFixed(1)}" cy="${py(v).toFixed(1)}" r="5" fill="transparent"><title>${esc(s.nombre)} · ${esc(labels[i])}: ${v}</title></circle>`).join('');
      return `<path d="${area}" fill="${s.color}" opacity=".12"/><polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>${puntos}`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="hm-svg" role="img">${ej.svg}${trazos}${ticks}</svg>${series.length > 1 ? leyendaSeries(series) : ''}`;
  }

  function medidor(valor, color, titulo, sub){
    const v = Math.max(0, Math.min(100, num(valor))), L = Math.PI * 50;
    return `<div class="hm-gauge"><svg viewBox="0 0 120 76" class="hm-gsvg" role="img" aria-label="${esc(titulo)} ${v}%"><path d="M10 64 A50 50 0 0 1 110 64" fill="none" stroke="#ece9e2" stroke-width="14" stroke-linecap="round"/>`
      + `<path d="M10 64 A50 50 0 0 1 110 64" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${(v / 100 * L).toFixed(2)} ${L.toFixed(2)}"/>`
      + `<text x="60" y="60" text-anchor="middle" class="hm-g1">${v}%</text></svg><div class="hm-gt">${esc(titulo)}</div>${sub ? `<div class="hm-extra" style="text-align:center">${sub}</div>` : ''}</div>`;
  }

  function spark(valores, color){
    const W = 92, H = 34, max = Math.max(1, ...valores), n = valores.length;
    if(!n) return '';
    const pts = valores.map((v, i) => `${(2 + (W - 4) * i / Math.max(1, n - 1)).toFixed(1)},${(H - 3 - (H - 8) * v / max).toFixed(1)}`);
    return `<svg viewBox="0 0 ${W} ${H}" class="hm-spark" aria-hidden="true"><path d="M2,${H - 2} L${pts.join(' L')} L${W - 2},${H - 2} Z" fill="${color}" opacity=".14"/><polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  const api = { C, PALETA, calcular, donut, barrasH, columnas, linea, medidor, spark, vacio, addDias, esc };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SigieInicio = api;
})(typeof window !== 'undefined' ? window : globalThis);
