/* SIGIE v20 — Pantalla «Reportes en color» (mapa de calor, semáforo de vencidos, colección por categoría). */
(function(){
  const R = window.SigieRepColor, LC = window.SigieLectores, F = { rep:'mapa', per:'90', aula:'' };
  const nav0 = window.bibNav;
  window.bibNav = function(){ const g = nav0(); const i = g.items.findIndex(x => x.id==='bibRepExp');
    g.items.splice(i < 0 ? g.items.length : i + 1, 0, { id:'bibRepColor', ic:'🎨', label:'Reportes en color' }); return g; };
  window.BIB_TITULOS9 = Object.assign(window.BIB_TITULOS9 || {}, { bibRepColor:['Reportes en color', 'Mapa de lectura, vencidos con semáforo y colección por categoría; listos para imprimir'] });
  const desde = () => F.per==='anio' ? new Date().getFullYear() + '-01-01' : F.per==='90' ? bibEnDias(-90) : '';
  const parsear = g => SigieBib.parsearGrado(g);
  const nivelDe = (l, p) => LC.colorNivel(l || { tipo:'Alumno', grado:(p && p.grado) || '' }, parsear).nivel;
  const ctx = () => ({ libros:bibLibros(), cats:bibCats(), prest:bibPrest(), lect:bibLect(), hoy:today(), desde:desde(), nivelDe,
    aulaDe:p => { const l = bibLect().find(x => x.id===p.lectorId); return bibGrupoDe(l || { tipo:'Alumno', grado:p.grado }); } });
  let ultimoCsv = [];
  function tablaMapa(c){
    const m = R.matrizNivelCategoria(c); if(!m.filas.length) return '<div class="empty">Aún no hay préstamos en este periodo.</div>';
    ultimoCsv = [['Categoría', ...m.niveles, 'Total'], ...m.filas.map(f => [f.cat, ...f.valores, f.total])];
    return `<table class="rc"><thead><tr><th>Categoría</th>${m.niveles.map(n => `<th>${esc(n)}</th>`).join('')}<th>Total</th></tr></thead><tbody>${m.filas.map(f =>
      `<tr><td class="cat"><span class="sw" style="background:${esc(f.color)}"></span>${esc(f.cat)}</td>${f.valores.map(v => `<td class="n" style="background:${R.calor(v, m.max, f.color)}">${v||''}</td>`).join('')}<td class="n"><b>${f.total}</b></td></tr>`).join('')}</tbody></table>
      <p class="hint">${m.total} préstamos. Cuanto más intenso el color, más préstamos de esa categoría en ese nivel.</p>`;
  }
  function tablaVencidos(c){
    const g = R.vencidosPorAula(c); if(!g.length) return '<div class="empty">🎉 No hay préstamos vencidos.</div>';
    ultimoCsv = [['Aula', 'Lector', 'Libro', 'Vencía', 'Días de atraso'], ...g.flatMap(x => x.items.map(i => [x.aula, i.lector, i.libro, i.vence, i.dias]))];
    return `<div class="rc-leyenda"><span><i style="background:#e0b324"></i>1–7 días</span><span><i style="background:#e8913a"></i>8–15 días</span><span><i style="background:#c0392b"></i>más de 15</span></div>` +
      g.map(x => `<h3 class="rc-aula">${esc(x.aula)} <small>(${x.items.length})</small></h3><table class="rc"><tbody>${x.items.map(i =>
        `<tr><td class="sem" style="background:${i.color}"></td><td>${esc(i.lector)}</td><td>${esc(i.libro)}</td><td class="n">${esc(i.vence)}</td><td class="n"><b>${i.dias}</b> d</td></tr>`).join('')}</tbody></table>`).join('');
  }
  function tablaColeccion(c){
    const k = R.coleccionPorCategoria(c); if(!k.filas.length) return '<div class="empty">No hay libros registrados.</div>';
    ultimoCsv = [['Categoría', 'Títulos', 'Ejemplares'], ...k.filas.map(f => [f.cat, f.titulos, f.ejemplares])];
    return `<table class="rc"><tbody>${k.filas.map(f => `<tr><td class="cat" style="width:34%"><span class="sw" style="background:${esc(f.color)}"></span>${esc(f.cat)}</td>
      <td><div style="background:${esc(f.color)};height:20px;border-radius:5px;width:${Math.max(3, Math.round(f.ejemplares / k.max * 100))}%"></div></td><td class="n"><b>${f.ejemplares}</b> <small>(${f.titulos} títulos)</small></td></tr>`).join('')}</tbody></table><p class="hint">${k.total} ejemplares en total.</p>`;
  }
  function tablaAula(c){
    const gs = bibGruposLector(); if(!gs.length) return '<div class="empty">Aún no hay lectores registrados.</div>';
    if(!gs.some(g => g.clave === F.aula)) F.aula = gs[0].clave;
    const r = R.resumenAula({ ...c, aulaLector:bibGrupoDe }, F.aula), kpi = (n, t, col) => `<div style="flex:1;min-width:130px;border-left:6px solid ${col};background:color-mix(in srgb, ${col} 10%, transparent);border-radius:8px;padding:8px 12px"><div style="font-size:26px;font-weight:700">${n}</div><div class="hint">${t}</div></div>`;
    ultimoCsv = [['Aula', r.aula], ['Lectores', r.lectores], ['Préstamos del periodo', r.prestamos], ['Vencidos', r.vencidos], ['Participación %', r.participacion], [], ['Lector con más préstamos', 'Préstamos'], ...r.topLectores.map(t => [t.nombre, t.n]), [], ['Sin préstamos en el periodo'], ...r.sinLectura.map(n => [n])];
    const mx = r.categorias.reduce((a, k) => Math.max(a, k.n), 0);
    return `<div class="noprint" style="margin-bottom:10px"><label>Aula: <select id="rcAula">${gs.map(g => `<option value="${esc(g.clave)}" ${g.clave===F.aula?'selected':''}>${esc(g.clave)} (${g.n})</option>`).join('')}</select></label></div>
      <h3 style="text-align:center;margin:0 0 10px">${esc(r.aula)}</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">${kpi(r.lectores, 'lectores', '#2c5a8c')}${kpi(r.prestamos, 'préstamos en el periodo', '#3E6B4F')}${kpi(r.participacion + '%', 'participación (' + r.lectoresActivos + ' de ' + r.lectores + ')', '#8c5a9e')}${kpi(r.vencidos, 'vencidos ahora', r.vencidos ? '#c0392b' : '#b9b4a8')}</div>
      <h4>Lo que más leen</h4>${r.categorias.length ? `<table class="rc"><tbody>${r.categorias.map(k => `<tr><td class="cat" style="width:30%"><span class="sw" style="background:${esc(k.color)}"></span>${esc(k.cat)}</td><td><div style="background:${esc(k.color)};height:18px;border-radius:5px;width:${Math.max(4, Math.round(k.n / mx * 100))}%"></div></td><td class="n"><b>${k.n}</b></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Sin préstamos en este periodo.</div>'}
      <h4>Lectores con más préstamos</h4>${r.topLectores.length ? `<table class="rc"><tbody>${r.topLectores.map((t, i) => `<tr><td class="n" style="width:40px">${['🥇', '🥈', '🥉', '4°', '5°'][i]}</td><td>${esc(t.nombre)}</td><td class="n"><b>${t.n}</b></td></tr>`).join('')}</tbody></table>` : '<div class="empty">—</div>'}
      <h4 style="color:#a86a1b">Sin préstamos en el periodo (${r.sinLectura.length})</h4>${r.sinLectura.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${r.sinLectura.map(n => `<span style="background:#fbeacc;border-radius:999px;padding:3px 10px;font-size:13px">${esc(n)}</span>`).join('')}</div>` : '<div class="empty">🎉 Todos leyeron algo en este periodo.</div>'}`;
  }
  const REPS = { mapa:['🔥 Lectura por categoría y nivel', tablaMapa, true], aula:['🏫 Reporte por aula', tablaAula, true], venc:['🚦 Vencidos por aula', tablaVencidos, false], coleccion:['📚 Colección por categoría', tablaColeccion, false] };
  BIB_RENDER.bibRepColor = function(){
    const cfg = DB.get(KEYS.config) || {}, r = REPS[F.rep], cuerpo = r[1](ctx());
    return `<style>.rc{width:100%;border-collapse:collapse;font-size:14px}.rc th,.rc td{padding:8px 10px;border-bottom:1px solid #e3dccd}.rc th{background:#14304d;color:#fff;text-align:center}.rc th:first-child{text-align:left}
      .rc .n{text-align:center}.rc .cat{font-weight:600}.sw{display:inline-block;width:14px;height:14px;border-radius:4px;margin-right:8px;vertical-align:-2px}.sem{width:10px;padding:0}
      .rc-aula{margin:16px 0 4px}.rc-leyenda{display:flex;gap:14px;flex-wrap:wrap;margin:6px 0}.rc-leyenda i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:5px}
      .rc-tabs{display:flex;gap:8px;flex-wrap:wrap}@media print{.rc,.rc *,.sw,.sem{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style>
      <div class="toolbar noprint"><div class="rc-tabs">${Object.entries(REPS).map(([k, v]) => `<button class="btn ${F.rep===k?'btn-primary':''}" data-rcrep="${k}">${v[0]}</button>`).join('')}</div>
      ${r[2] ? `<select id="rcPer" title="Periodo"><option value="90" ${F.per==='90'?'selected':''}>Últimos 90 días</option><option value="anio" ${F.per==='anio'?'selected':''}>Este año</option><option value="" ${F.per===''?'selected':''}>Todo</option></select>` : ''}
      <button class="btn" id="rcImp">🖨 Imprimir / PDF</button><button class="btn" id="rcCsv">⇩ CSV</button></div>
      <div class="card"><div class="card-b"><div class="hint" style="text-align:center">${esc(cfg.nombreIE || '')} · ${today()}</div><h2 style="margin:4px 0 12px;text-align:center">${r[0]}</h2>${cuerpo}</div></div>`;
  };
  document.addEventListener('click', e => { const t = e.target.closest && e.target.closest('[data-rcrep],#rcImp,#rcCsv'); if(!t) return;
    if(t.dataset.rcrep){ F.rep = t.dataset.rcrep; render(); } else if(t.id==='rcImp') window.print();
    else if(ultimoCsv.length) bibDescargar('reporte_color_' + F.rep + '_' + today() + '.csv', R.csv(ultimoCsv)); });
  document.addEventListener('change', e => { if(e.target && e.target.id==='rcPer'){ F.per = e.target.value; render(); } else if(e.target && e.target.id==='rcAula'){ F.aula = e.target.value; render(); } });
})();
