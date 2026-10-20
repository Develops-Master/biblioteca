/* =========================================================================
   SIGIE — Biblioteca v14: Uso de la colección (grupo Biblioteca)
   Qué libros se mueven y cuáles no, por categoría, para decidir qué comprar,
   qué exhibir y qué revisar. La lógica está en coleccion-util.js (con pruebas).
   Se carga después de lectura-panel.js y antes de ejemplo.js / app.js.
   ========================================================================= */
const co = { per:'anio' };
Object.assign(BIB_TITULOS7, { bibColec:['Uso de la colección','Qué libros se prestan, cuáles no se mueven y cuáles necesitan más ejemplares'] });
const coDesde = ()=> co.per==='anio' ? bibInicioAnio() : co.per==='365' ? bibEnDias(-365) : '';
const coPerTxt = ()=> ({ anio:'este año', '365':'los últimos 12 meses', todo:'todo el historial' })[co.per] || '';
function coAnalisis(){ return SigieCol.analizar({ libros:bibLibros(), prestamos:bibPrest(), reservas:bibRes(), categorias:bibCats(), desde:coDesde() }); }

function renderBibColec(){
  const a = coAnalisis(), k = a.kpi, kpi = (l,v,d)=>`<div class="card"><div class="kpi"><div class="lbl">${l}</div><div class="val">${v}</div>${d?`<div class="delta">${d}</div>`:''}</div></div>`;
  const grafico = SigiePanel.svgBarrasH({ titulo:'Préstamos por ejemplar, por categoría', sufijo:'', items:a.porCat.slice(0,10).map(c=>({ etiqueta:c.nombre, valor:c.rotacion })) });
  const fila = f=>`<tr><td><span class="mono">${esc(f.libro.cod||'')}</span> ${esc(f.libro.titulo)}<div class="hint">${esc(f.libro.autor||'')}</div></td><td class="num">${f.ejemplares}</td><td class="num">${f.prestamosPeriodo}</td><td class="num">${f.rotacion}</td><td class="num">${f.enEspera||''}</td></tr>`;
  return `<div class="toolbar noprint"><label class="hint">Periodo: <select id="coPer">${[['anio','Este año'],['365','Últimos 12 meses'],['todo','Todo el historial']].map(o=>`<option value="${o[0]}" ${co.per===o[0]?'selected':''}>${o[1]}</option>`).join('')}</select></label>
    <button class="btn" id="coXls">⇩ Exportar Excel</button><button class="btn" onclick="window.print()">🖨 Imprimir</button></div>
  <div class="grid g4" style="margin:8px 0">${kpi('Títulos en catálogo',k.titulos,k.ejemplares+' ejemplares')}${kpi('Con algún préstamo',k.pctUso+'%',k.conMovimiento+' títulos en '+coPerTxt())}${kpi('Nunca prestados',k.nuncaPrestados,'en todo el historial')}${kpi('Préstamos por ejemplar',k.rotacionMedia,k.prestamos+' préstamos')}</div>
  <div class="hint" style="margin:4px 0">La <b>rotación</b> es préstamos ÷ ejemplares en ${esc(coPerTxt())}: un libro que sale mucho y tiene un solo ejemplar necesita otro; uno que no sale nunca merece exhibirse o revisarse.</div>
  <div class="grid g2" style="margin:8px 0;gap:12px"><div class="card" style="padding:12px"><h3 style="margin:0 0 6px">Rotación por categoría</h3>${a.porCat.some(c=>c.rotacion)?grafico:'<div class="hint">Aún no hay préstamos en este periodo.</div>'}</div>
    <div class="card" style="padding:12px"><h3 style="margin:0 0 6px">Detalle por categoría</h3><div class="tbl-wrap"><table><thead><tr><th>Categoría</th><th>Títulos</th><th>Préstamos</th><th>Rotación</th><th>% en uso</th></tr></thead><tbody>${a.porCat.map(c=>`<tr><td>${esc(c.nombre)}</td><td class="num">${c.titulos}</td><td class="num">${c.prestamos}</td><td class="num">${c.rotacion}</td><td class="num">${c.pctUso}%</td></tr>`).join('')||'<tr><td colspan="5" class="empty">Sin libros.</td></tr>'}</tbody></table></div></div></div>
  <h3 style="margin:14px 0 6px">🔥 Alta demanda: conviene más ejemplares (${a.demanda.length})</h3>
  <div class="hint">Hay lectores en lista de espera o rotan al menos ${a.umbral} veces por ejemplar.</div>
  <div class="tbl-wrap"><table><thead><tr><th>Libro</th><th>Ejemplares</th><th>Préstamos</th><th>Rotación</th><th>En espera</th></tr></thead><tbody>${a.demanda.slice(0,15).map(fila).join('')||'<tr><td colspan="5" class="empty">Ningún libro destaca por demanda en este periodo.</td></tr>'}</tbody></table></div>
  <h3 style="margin:14px 0 6px">💤 Sin movimiento en ${esc(coPerTxt())} (${a.sinMovimiento.length})</h3>
  <div class="hint">Primero los que nunca salieron. Para el cotejo anual: exhíbelos en la cartelera lectora, recomiéndalos o revisa su estado.</div>
  <div class="tbl-wrap"><table><thead><tr><th>Libro</th><th>Ejemplares</th><th>Último préstamo</th></tr></thead><tbody>${a.sinMovimiento.slice(0,30).map(f=>`<tr><td><span class="mono">${esc(f.libro.cod||'')}</span> ${esc(f.libro.titulo)}<div class="hint">${esc(f.libro.autor||'')}</div></td><td class="num">${f.ejemplares}</td><td>${f.ultimo?esc(bibFechaCorta(f.ultimo)):'<b>Nunca</b>'}</td></tr>`).join('')||'<tr><td colspan="3" class="empty">Todos los libros tuvieron movimiento. 👍</td></tr>'}</tbody></table></div>${a.sinMovimiento.length>30?`<div class="hint">Se muestran 30 de ${a.sinMovimiento.length}; el Excel trae la lista completa.</div>`:''}`;
}

Object.assign(BIB_RENDER, { bibColec:renderBibColec }); BIB_VIEWS.push('bibColec');
(()=>{ const on = bibNav; bibNav = function(){ const g = on(), i = g.items.findIndex(x=>x.id==='bibReporte');
  g.items.splice(i<0?g.items.length:i+1, 0, { id:'bibColec', ic:'📉', label:'Uso de la colección' }); return g; }; })();

function bibWire14(){
  const $ = id=>document.getElementById(id);
  if($('coPer')) $('coPer').onchange = e=>{ co.per = e.target.value; render(); };
  if($('coXls')) $('coXls').onclick = ()=>{ const a = coAnalisis(); if(!a.filas.length){ toast('No hay libros para exportar.','err'); return; }
    const cat = new Map(bibCats().map(c=>[c.id,c.nombre||'']));
    bibXlsx('uso-de-la-coleccion-'+today(), [
      ['Libros', [['Código','Título','Autor','Categoría','Ejemplares','Préstamos ('+coPerTxt()+')','Rotación','En espera','Último préstamo'], ...a.filas.map(f=>[f.libro.cod||'', f.libro.titulo||'', f.libro.autor||'', cat.get(f.catId)||'', f.ejemplares, f.prestamosPeriodo, f.rotacion, f.enEspera, f.ultimo||'Nunca'])]],
      ['Por categoría', [['Categoría','Títulos','Ejemplares','Préstamos','Rotación','% en uso'], ...a.porCat.map(c=>[c.nombre, c.titulos, c.ejemplares, c.prestamos, c.rotacion, c.pctUso])]],
      ['Alta demanda', [['Código','Título','Ejemplares','Préstamos','Rotación','En espera'], ...a.demanda.map(f=>[f.libro.cod||'', f.libro.titulo||'', f.ejemplares, f.prestamosPeriodo, f.rotacion, f.enEspera])]],
      ['Sin movimiento', [['Código','Título','Ejemplares','Último préstamo'], ...a.sinMovimiento.map(f=>[f.libro.cod||'', f.libro.titulo||'', f.ejemplares, f.ultimo||'Nunca'])]]
    ]); };
}
(()=>{ const ow = bibWire5; bibWire5 = function(){ ow(); bibWire14(); }; })();
