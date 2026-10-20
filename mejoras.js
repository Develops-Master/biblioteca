/* =========================================================================
   SIGIE — Biblioteca v12: ideas de Koha / SLiMS y del Lectómetro original
     · 🔎 Catálogo de consulta (OPAC): búsqueda con filtros, disponibilidad y novedades
     · 💡 Sugerencias de compra con estado (pendiente → aprobada → comprada / rechazada)
     · 📑 Reportes del Lectómetro: filtro por aula y fechas, niveles, Excel
     · ⌨ Paleta de búsqueda global (Ctrl+K o «/»): ir a cualquier módulo al instante
   Se carga después de diplomas.js y antes de ejemplo.js / app.js.
   ========================================================================= */
const M12 = { sug:'sigie:bib_sugerencias' };
const bibSugs = ()=>DB.get(M12.sug)||[];
const SUG_EST = { pendiente:'Pendiente', aprobada:'Aprobada', comprada:'Comprada', rechazada:'Rechazada' };
const mj = { q:'', cat:'', soloDisp:false, sugVer:'pendiente', aula:'', desde:'', hasta:'' };
Object.assign(BIB_TITULOS7, { // app.js (que carga después) junta estos títulos con los de los demás módulos
  bibOpac:['Catálogo de consulta (OPAC)','Busca libros por título, autor o código y mira si hay ejemplares disponibles'],
  bibSug:['Sugerencias de compra','Lo que los lectores piden que llegue a la biblioteca, con su estado'],
  bibRepLec:['Reportes del Lectómetro','Lecturas por aula y periodo, listas para exportar a Excel']
});

/* ---------------- 1. OPAC ---------------- */
function mjLibroCard(l){
  const tot = bibEjemplares(l), disp = Math.max(0, tot - bibPrestados(l.id)), c = bibCat(l.catId);
  return `<div class="card" style="padding:12px"><div style="font-weight:700">${esc(l.titulo)}</div><div class="hint">${esc(l.autor||'Autor no registrado')}</div>
  <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="badge badge-info">${esc(l.cod||'')}</span>${c?`<span class="badge">${esc(c.nombre||'')}</span>`:''}
  <span class="badge ${disp?'badge-ok':'badge-gold'}">${disp?`Disponible (${disp} de ${tot})`:'Prestado: sin ejemplares'}</span></div></div>`;
}
function renderBibOpac(){
  const q = bibNorm(mj.q), todos = bibLibros().filter(l=>!l.baja);
  let res = todos.filter(l=>(!mj.cat || l.catId===mj.cat) && (!q || bibNorm([l.titulo,l.autor,l.cod,l.dewey].join(' ')).includes(q)) && (!mj.soloDisp || bibEjemplares(l)>bibPrestados(l.id)));
  const buscando = !!(q || mj.cat || mj.soloDisp), mostrar = res.slice(0, 60);
  const nov = todos.slice(-8).reverse();
  return `<div class="toolbar noprint"><input class="search" id="opQ" placeholder="🔎 Escribe título, autor o código…" autocomplete="off" value="${esc(mj.q)}" style="min-width:320px;font-size:16px;padding:10px">
    <select id="opCat"><option value="">Todas las categorías</option>${bibCats().map(c=>`<option value="${esc(c.id)}" ${mj.cat===c.id?'selected':''}>${esc(c.nombre||'')}</option>`).join('')}</select>
    <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="opDisp" ${mj.soloDisp?'checked':''}> Solo disponibles</label></div>
  ${buscando ? `<div class="hint" style="margin:6px 0">${res.length} resultado(s)${res.length>60?' — mostrando los 60 primeros; afina la búsqueda':''}.</div>
    ${mostrar.length?`<div class="grid g3" style="gap:10px">${mostrar.map(mjLibroCard).join('')}</div>`:'<div class="hint">No hay coincidencias. Prueba con menos palabras o <a href="#" data-nav="bibSug">sugiere que se compre este título</a>.</div>'}`
  : `<h3 style="margin:12px 0 6px">✨ Novedades en la biblioteca</h3>${nov.length?`<div class="grid g3" style="gap:10px">${nov.map(mjLibroCard).join('')}</div>`:'<div class="hint">Aún no hay libros en el catálogo.</div>'}
    <div class="hint" style="margin-top:10px">${todos.length} títulos en catálogo. Tip: pulsa <b>Ctrl+K</b> en cualquier pantalla para saltar a un módulo.</div>`}`;
}

/* ---------------- 2. Sugerencias de compra ---------------- */
function renderBibSug(){
  const edit = canEdit(), todas = bibSugs(), ver = mj.sugVer;
  const lista = todas.filter(s=>ver==='todas' || s.estado===ver).sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha)));
  const cuenta = k=>todas.filter(s=>s.estado===k).length;
  return `<div class="toolbar noprint"><select id="sgVer">${['pendiente','aprobada','comprada','rechazada','todas'].map(k=>`<option value="${k}" ${ver===k?'selected':''}>${k==='todas'?'Todas ('+todas.length+')':SUG_EST[k]+'s ('+cuenta(k)+')'}</option>`).join('')}</select>
    ${edit?'<button class="btn btn-primary" id="sgNueva">+ Nueva sugerencia</button>':''}</div>
  ${lista.length?`<div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Título</th><th>Autor</th><th>Pedido por</th><th>Motivo</th><th>Estado</th></tr></thead><tbody>${lista.map(s=>`<tr><td>${esc(bibFechaCorta(s.fecha))}</td><td><b>${esc(s.titulo)}</b></td><td>${esc(s.autor||'—')}</td><td>${esc(s.solicitante||'—')}</td><td>${esc(s.motivo||'—')}</td>
    <td>${isAdmin()?`<select data-sgest="${esc(s.id)}">${Object.keys(SUG_EST).map(k=>`<option value="${k}" ${s.estado===k?'selected':''}>${SUG_EST[k]}</option>`).join('')}</select>`:esc(SUG_EST[s.estado]||s.estado)}</td></tr>`).join('')}</tbody></table></div>`
  :'<div class="hint" style="margin:10px 0">No hay sugerencias en esta lista. Los lectores piden aquí los libros que quieren leer; la dirección decide cuáles comprar.</div>'}`;
}

/* ---------------- 3. Reportes del Lectómetro ---------------- */
function mjRegistrosLec(){
  const L = new Map(bibLect().map(l=>[l.id,l]));
  return bibBitacora().filter(b=>L.has(b.lectorId) && (!mj.desde||b.fecha>=mj.desde) && (!mj.hasta||b.fecha<=mj.hasta) && (!mj.aula||lmGrupo(L.get(b.lectorId))===mj.aula)).map(b=>({ b, l:L.get(b.lectorId) }));
}
function mjFilasLec(){
  const por = new Map();
  mjRegistrosLec().forEach(({b,l})=>{ const f = por.get(l.id)||{ l, n:0, pag:0, min:0, op:0, pts:0 }; f.n++; f.pag+=Number(b.paginas)||0; f.min+=Number(b.minutos)||0; f.op+=Number(b.autoevaluacion)||0; f.pts+=Number(b.puntos)||0; por.set(l.id,f); });
  return [...por.values()].sort((a,b)=>b.pag-a.pag);
}
function renderBibRepLec(){
  const filas = mjFilasLec(), tot = k=>filas.reduce((a,f)=>a+f[k],0), n = tot('n');
  const grupos = [...new Set(bibLect().map(lmGrupo).filter(Boolean))].sort();
  const res = bibEvalRes().filter(r=>(!mj.desde||r.fecha>=mj.desde)&&(!mj.hasta||r.fecha<=mj.hasta)), niv = ['AD','A','B','C'].map(k=>[k,res.filter(r=>r.nivel===k).length]);
  const kpi = (l,v)=>`<div class="card"><div class="kpi"><div class="lbl">${l}</div><div class="val">${v}</div></div></div>`;
  return `<div class="toolbar noprint"><select id="rlAula"><option value="">Todas las aulas</option>${grupos.map(g=>`<option ${mj.aula===g?'selected':''}>${esc(g)}</option>`).join('')}</select>
    <label>Desde <input type="date" id="rlDesde" value="${esc(mj.desde)}"></label><label>Hasta <input type="date" id="rlHasta" value="${esc(mj.hasta)}"></label>
    <button class="btn" id="rlXls">⬇ Excel</button><button class="btn" onclick="window.print()">🖨 Imprimir</button></div>
  <div class="grid g4" style="margin:8px 0">${kpi('Registros de lectura',n)}${kpi('Lectores que leyeron',filas.length)}${kpi('Páginas leídas',tot('pag'))}${kpi('Minutos leídos',tot('min'))}</div>
  <div class="hint" style="margin:4px 0">Comprensión lectora en el periodo: ${niv.map(([k,v])=>`<b>${k}</b> ${v}`).join(' · ')}</div>
  ${filas.length?`<div class="tbl-wrap"><table><thead><tr><th>Lector</th><th>Aula</th><th>Lecturas</th><th>Páginas</th><th>Minutos</th><th>Opinión prom.</th><th>Puntos</th></tr></thead><tbody>${filas.map(f=>`<tr><td>${esc(f.l.nombre)}</td><td>${esc(lmGrupo(f.l)||'')}</td><td class="num">${f.n}</td><td class="num">${f.pag}</td><td class="num">${f.min}</td><td>${lmEstrellas(f.op/f.n)}</td><td class="num">${f.pts}</td></tr>`).join('')}</tbody></table></div>`:'<div class="hint">No hay lecturas con este filtro.</div>'}`;
}

Object.assign(BIB_RENDER, { bibOpac:renderBibOpac, bibSug:renderBibSug, bibRepLec:renderBibRepLec });
BIB_VIEWS.push('bibOpac','bibSug','bibRepLec');

/* ---------------- Menú, avisos y conexiones ---------------- */
(()=>{ const on = bibNav; bibNav = function(){ const g = on(), n = bibSugs().filter(s=>s.estado==='pendiente').length;
  g.items.splice(1,0,{id:'bibOpac', ic:'🔎', label:'Catálogo de consulta (OPAC)'},{id:'bibSug', ic:'💡', label:'Sugerencias de compra', badge:(isAdmin()&&n)||null}); return g; }; })();
(()=>{ const on = bibNavLectometro; bibNavLectometro = function(){ const g = on(); g.items.push({id:'bibRepLec', ic:'📑', label:'Reportes del Lectómetro'}); return g; }; })();
(()=>{ const on = bibNotificaciones; bibNotificaciones = function(){ const g = on(), n = bibSugs().filter(s=>s.estado==='pendiente').length;
  if(n && isAdmin()) g.push({ ic:'💡', n, texto:n+' sugerencia(s) de compra esperan una decisión.', view:'bibSug', nivel:'warn' }); return g; }; })();

function bibWire12(){
  const $ = id=>document.getElementById(id), foco = (id,fn)=>{ const e = $(id); if(e) e.oninput = ev=>{ fn(ev.target.value); const p = ev.target.selectionStart; render(); const n = $(id); if(n){ n.focus(); n.setSelectionRange(p,p); } }; };
  const sel = (id,fn)=>{ const e = $(id); if(e) e.onchange = ev=>{ fn(ev.target.type==='checkbox'?ev.target.checked:ev.target.value); render(); }; };
  foco('opQ', v=>mj.q=v); sel('opCat', v=>mj.cat=v); sel('opDisp', v=>mj.soloDisp=v);
  sel('sgVer', v=>mj.sugVer=v); sel('rlAula', v=>mj.aula=v); sel('rlDesde', v=>mj.desde=v); sel('rlHasta', v=>mj.hasta=v);
  if($('sgNueva')) $('sgNueva').onclick = ()=>{ if(!guardEdit()) return;
    bibModal('Nueva sugerencia de compra', lmCampoLector('sgLec','')+`<div class="field f-12"><label>Título que pide</label><input id="sgT" maxlength="150"></div><div class="field f-6"><label>Autor</label><input id="sgA" maxlength="100"></div><div class="field f-6"><label>¿Por qué lo pide?</label><input id="sgM" maxlength="200"></div>`, async bg=>{
      const titulo = bibV(bg,'sgT'); if(!titulo){ toast('Escribe el título que se pide.','err'); return false; }
      const raw = bibV(bg,'sgLec'), l = lmBuscarLector(raw);
      await DB.save(M12.sug, [...bibSugs(), { id:uid('sg'), titulo, autor:bibV(bg,'sgA'), motivo:bibV(bg,'sgM'), solicitante:l?l.nombre:raw, lectorId:l?l.id:'', fecha:today(), estado:'pendiente' }]);
      registrarBitacora('Sugerencia de compra', titulo); toast('Sugerencia registrada.','ok'); render(); }, 'Guardar', '560px'); lmWireCampoLector(document.querySelector('.modal-bg:last-of-type')); };
  document.querySelectorAll('[data-sgest]').forEach(s=>s.onchange = async()=>{ if(!isAdmin()) return;
    await DB.save(M12.sug, bibSugs().map(x=>x.id===s.dataset.sgest?{...x, estado:s.value}:x)); registrarBitacora('Sugerencia de compra: '+SUG_EST[s.value], s.dataset.sgest); render(); });
  if($('rlXls')) $('rlXls').onclick = ()=>{ const f = mjFilasLec(); if(!f.length){ toast('No hay lecturas para exportar.','err'); return; }
    bibXlsx('lectometro-reporte-'+today(), [['Lecturas', [['Lector','Aula','Lecturas','Páginas','Minutos','Opinión promedio','Puntos'], ...f.map(x=>[x.l.nombre, lmGrupo(x.l)||'', x.n, x.pag, x.min, +(x.op/x.n).toFixed(1), x.pts])]]]); };
}
(()=>{ const ow = bibWire5; bibWire5 = function(){ ow(); bibWire12(); }; })();

/* ---------------- 4. Paleta global Ctrl+K ---------------- */
function mjPaleta(){
  if(document.getElementById('mjPal') || typeof STATE==='undefined' || !STATE.session) return;
  const items = buildNav().flatMap(g=>g.items.map(i=>({ ...i, grp:g.grp }))); let sel = 0, vis = items;
  const bg = document.createElement('div'); bg.id = 'mjPal'; bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" style="max-width:520px;margin-top:10vh"><div class="m-b"><input id="mjPalQ" class="search" style="width:100%;font-size:16px;padding:10px" placeholder="Ir a… (préstamos, ranking, diplomas, sugerencias)" autocomplete="off"><div id="mjPalL" style="margin-top:8px;max-height:50vh;overflow:auto"></div><div class="hint" style="margin-top:6px">↑↓ para elegir · Enter para abrir · Esc para cerrar</div></div></div>`;
  document.body.appendChild(bg);
  const q = bg.querySelector('#mjPalQ'), lista = bg.querySelector('#mjPalL'), cerrar = ()=>bg.remove();
  const pinta = ()=>{ lista.innerHTML = vis.length ? vis.slice(0,12).map((i,k)=>`<div data-pal="${esc(i.id)}" style="padding:8px 10px;border-radius:8px;cursor:pointer;${k===sel?'background:var(--line,#e5e9ef)':''}">${esc(i.ic)} ${esc(i.label)} <span class="hint">· ${esc(i.grp)}</span></div>`).join('') : '<div class="hint">Nada coincide.</div>';
    lista.querySelectorAll('[data-pal]').forEach(d=>d.onclick = ()=>ir(d.dataset.pal)); };
  const ir = id=>{ cerrar(); STATE.view = id; STATE.sidebarOpen = false; render(); };
  q.oninput = ()=>{ const t = bibNorm(q.value); vis = items.filter(i=>!t || bibNorm(i.label+' '+i.grp).includes(t)); sel = 0; pinta(); };
  q.onkeydown = e=>{ if(e.key==='Escape') cerrar(); else if(e.key==='ArrowDown'){ sel = Math.min(sel+1, Math.min(vis.length,12)-1); pinta(); e.preventDefault(); } else if(e.key==='ArrowUp'){ sel = Math.max(sel-1,0); pinta(); e.preventDefault(); } else if(e.key==='Enter' && vis[sel]) ir(vis[sel].id); };
  bg.onclick = e=>{ if(e.target===bg) cerrar(); };
  pinta(); q.focus();
}
document.addEventListener('keydown', e=>{ const enCampo = /INPUT|TEXTAREA|SELECT/.test((e.target&&e.target.tagName)||'');
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); mjPaleta(); } else if(e.key==='/' && !enCampo){ e.preventDefault(); mjPaleta(); } });
