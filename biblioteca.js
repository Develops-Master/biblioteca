/* =========================================================================
   SIGIE Biblioteca — módulo de biblioteca escolar (catálogo por categoría,
   cartelera lectora / lista de cotejo, préstamos y reporte general).
   Reutiliza core.js: usuarios y roles, base SQLite local, bitácora, Excel.
   Orden de carga: antes de app.js (app.js lo engancha en initApp, buildNav
   y renderContent).
   ========================================================================= */
const BKEYS = { cats:'sigie:bib_categorias', libros:'sigie:bib_libros', prest:'sigie:bib_prestamos', tomas:'sigie:bib_tomas', lect:'sigie:bib_lectores' };
const BIB_ESTADOS = ['Bueno','Regular','Malo'];
const BIB_VIEWS = ['bibLibros','bibCats','bibPrest','bibReporte','bibQR','bibToma','bibLect'];
// Cartelera lectora original (hoja manual): [nombre, prefijo, color, ubicaciones, total declarado]
const BIB_SEED = [
['DICCIONARIO','DIC','#1a237e','1, 2, 3, 4',120],['ENCICLOPEDIA','ENC','#0d47a1','5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17',689],
['PSICOLOGIA Y FILOSOFIA','PSI','#006064','18',11],['RELIGION','REL','#004d40','18, 19',68],['ECONOMIA','ECO','#1b5e20','19, 20',37],
['NEGOCIOS','NEG','#33691e','20',15],['EDUCACION','EDU','#827717','20',50],['INGLES','ING','#f57f17','20, 21',212],
['LENGUAS E IDIOMAS','LEN','#ff6f00','22',13],['LEYES','LEY','#e65100','22',25],['REVISTAS','REV','#bf360c','22',7],
['MATEMATICA','MAT','#b71c1c','23, 24',129],['QUIMICA','QUI','#880e4f','25',18],['BIOLOGIA','BIO','#4a148c','25',4],['FISICA','FIS','#311b92','25',7],
['CIENCIAS DE LA VIDA Y LA NATURALEZA','CIE','#3e2723','25',47],['ARTE','ART','#212121','26',41],['LENGUA Y LITERATURA','LEA','#263238','27',46],
['OBRAS LITERARIAS','OBR','#000000','29, 33, 36, 38, 39',779],['TERROR','TER','#283593','40',12],['HISTORIETA, COMIC Y MANGA','HIS','#1565c0','40',29],
['BIOGRAFIAS','BIS','#0277bd','46',52],['ATLAS','ATL','#00838f','46',18],['HISTORIA UNIVERSAL','HIL','#00695c','47',16],['HISTORIA DEL PERU','HIU','#2e7d32','47, 48, 49',188],
['GEOGRAFIA','GEO','#558b2f','49',7],['CIENCIAS SOCIALES','CIS','#9e9d24','49',104],['EDUCACION2','EDN','#ef6c00','50',106],['TUTORIA','TUT','#ff8f00','51, 52, 53',437],
['EDUCACION FISICA','EDA','#c62828','53',52],['COMUNICACION','COM','#ad1457','54',111],['PEDAGOGIA','PED','#6a1b9a','55',113],
['PERSONA FAMILIA Y RELACIONES HUMANAS','PER','#4527a0','56',56],['MATEMATICA - OTROS','MAS','#4e342e','56',128],['C Y T','CYT','#37474f','57, 58',232],
['PEDAGOGIA 2','PEA','#303f9f','59',6],['EDUCACION PARA EL TRABAJO','EDO','#1976d2','60',59],['ARTE 2','ARE','#0288d1','60',51],
['POESIA','POE','#0097a7','',111],['CUENTOS MITOS Y LEYENDAS','CUE','#00796b','',82]
].map(r=>({id:'cat_'+r[1], nombre:r[0], prefijo:r[1], color:r[2], ubicaciones:r[3], totalDeclarado:r[4]}));

async function bibCargar(){
  await Promise.all([DB.load(BKEYS.cats, BIB_SEED), DB.load(BKEYS.libros, []), DB.load(BKEYS.prest, []), DB.load(BKEYS.tomas, []), DB.load(BKEYS.lect, [])]);
  await bib2Cargar();
}
const bibCats = ()=>DB.get(BKEYS.cats)||[], bibLibros = ()=>DB.get(BKEYS.libros)||[], bibPrest = ()=>DB.get(BKEYS.prest)||[];
const bibCat = id => bibCats().find(c=>c.id===id);
const bibF = { q:'', cat:'', estado:'', ubi:'', pag:1 };
function bibEjemplares(l){ return Math.max(1, Number(l.cant)||1); }
function bibPrestados(libroId){ return bibPrest().filter(p=>p.libroId===libroId && !p.devuelto).length; }
function bibVencido(p){ return !p.devuelto && p.vence && p.vence < today(); }
function bibNav(){
  const nv = bibPrest().filter(bibVencido).length;
  return {grp:'Biblioteca', items:[
    {id:'bibInicio', ic:'🏠', label:'Inicio'},
    {id:'bibLibros', ic:'📚', label:'Libros (catálogo)'},
    {id:'bibMost', ic:'⌨', label:'Mostrador (escáner)'},
    {id:'bibPrest', ic:'⇄', label:'Préstamos de libros', badge:nv||null},
    {id:'bibRes', ic:'🔖', label:'Reservas', badge:bibRes().filter(r=>r.estado==='Disponible').length||null},
    {id:'bibLect', ic:'🪪', label:'Lectores y carnés'},
    {id:'bibQR', ic:'▦', label:'Etiquetas QR de libros'},
    {id:'bibToma', ic:'☑', label:'Inventario por estante'},
    {id:'bibCats', ic:'🎨', label:'Cartelera lectora / cotejo'},
    {id:'bibRetos', ic:'🏅', label:'Retos de lectura'},
    {id:'bibResenas', ic:'⭐', label:'Reseñas y más leídos'},
    {id:'bibInact', ic:'💤', label:'Lectores sin actividad', badge:(typeof bibInactN==='function'&&bibInactN())||null},
    {id:'bibCert', ic:'🎓', label:'Certificados de lector'},
    {id:'bibLecturas', ic:'📖', label:'Lecturas por aula', badge:(typeof bibLecturasAtrasadasN==='function'&&bibLecturasAtrasadasN())||null},
    {id:'bibCompr', ic:'🧠', label:'Comprensión lectora'},
    ...((typeof bibSancVisible==='function'&&bibSancVisible())?[{id:'bibSanc', ic:'⏳', label:'Sanciones por atraso', badge:(typeof bibSancVigentes==='function'&&bibSancVigentes().length)||null}]:[]),
    {id:'bibBajas', ic:'⬇', label:'Bajas y pérdidas'},
    {id:'bibReporte', ic:'▣', label:'Reporte general'},
    {id:'bibRepExp', ic:'⇩', label:'Reportes y exportación'},
    ...(isAdmin()?[{id:'bibSalud', ic:'🩺', label:'Revisión de datos', badge:(typeof bibSaludProblemas==='function'&&bibSaludProblemas())||null}]:[])
  ]};
}
// Siguiente código correlativo de la categoría: DIC-001, DIC-002…
function bibSiguienteCodigo(cat){
  let max = 0;
  bibLibros().filter(l=>l.catId===cat.id).forEach(l=>{ const m = String(l.cod||'').match(/(\d+)\s*$/); if(m) max = Math.max(max, Number(m[1])); });
  return cat.prefijo + '-' + String(max+1).padStart(3,'0');
}
function bibSwatch(c){ return `<span style="display:inline-block;width:34px;height:14px;border-radius:3px;background:${esc(c.color)};vertical-align:middle;margin-right:6px;"></span>`; }

/* ---------- Vistas ---------- */
function bibListaFiltrada(){
  let list = bibLibros();
  const q = bibF.q.trim().toLowerCase();
  if(q) list = list.filter(l=>[l.cod,l.titulo,l.autor,l.isbn,l.editorial,l.dewey,l.obs].some(v=>String(v||'').toLowerCase().includes(q)));
  if(bibF.cat) list = list.filter(l=>l.catId===bibF.cat);
  if(bibF.estado) list = list.filter(l=>l.estado===bibF.estado);
  if(bibF.ubi) list = list.filter(l=>String(l.ubi)===bibF.ubi);
  return list;
}
const BIB_PAG = 100;
function renderBibLibros(){
  const cats = bibCats();
  const list = bibListaFiltrada();
  const total = list.reduce((a,l)=>a+bibEjemplares(l),0);
  const edit = canEdit(), rsm = SigieBib.resumenResenas(typeof bibResenas==='function' ? bibResenas() : []);
  const paginas = Math.max(1, Math.ceil(list.length/BIB_PAG));
  if(bibF.pag>paginas) bibF.pag = paginas; if(bibF.pag<1) bibF.pag = 1;
  const ini = (bibF.pag-1)*BIB_PAG, vista = list.slice(ini, ini+BIB_PAG);
  const pager = list.length>BIB_PAG ? `<div class="toolbar noprint" style="margin:6px 0"><button class="btn btn-sm" id="bibPgPrev" ${bibF.pag<=1?'disabled':''}>‹ Anterior</button><span class="hint">Página ${bibF.pag} de ${paginas} · filas ${ini+1}–${Math.min(ini+BIB_PAG,list.length)} de ${list.length}</span><button class="btn btn-sm" id="bibPgNext" ${bibF.pag>=paginas?'disabled':''}>Siguiente ›</button></div>` : '';
  return `<div class="toolbar noprint">
    <input class="search" id="bibQ" placeholder="Buscar código, título, autor, ISBN, editorial, observación…" value="${esc(bibF.q)}">
    <select id="bibFCat"><option value="">Todas las categorías</option>${cats.map(c=>`<option value="${c.id}" ${bibF.cat===c.id?'selected':''}>${esc(c.nombre)} (${esc(c.prefijo)})</option>`).join('')}</select>
    <select id="bibFEst"><option value="">Cualquier estado</option>${BIB_ESTADOS.map(e=>`<option ${bibF.estado===e?'selected':''}>${e}</option>`).join('')}</select>
    <input id="bibFUbi" placeholder="Ubic." style="width:70px" value="${esc(bibF.ubi)}">
    ${edit?`<button class="btn btn-primary" id="bibNuevo">+ Nuevo libro</button><button class="btn" id="bibImp">⇧ Importar Excel</button><button class="btn" id="bibIsbnLote">📚 Importar ISBN</button><input type="file" id="bibImpFile" accept=".xlsx,.xls,.csv" style="display:none">`:''}
    <button class="btn" id="bibExp">⇩ Exportar Excel</button><button class="btn" id="bibPdfLista" title="Genera el PDF con el formato de la planilla física, con lo que se ve filtrado">📄 PDF (formato planilla)</button>${isAdmin()?'<button class="btn" id="bibEjemplo" onclick="generarDatosEjemplo()" title="Rellena todos los módulos con datos simulados">🧪 Datos de ejemplo</button>':''}
  </div>
  <div class="hint" style="margin:6px 0">${list.length} registros · ${total} ejemplares</div>${pager}
  <div class="tbl-wrap"><table><thead><tr><th>Cód.</th><th>Dewey</th><th>Categoría</th><th>Título del libro</th><th>Autor</th><th>Cant.</th><th>Estado</th><th>ISBN</th><th>Editorial</th><th>Observación</th><th>Ubi.</th><th>Disp.</th><th title="Promedio de estrellas de las reseñas">★</th>${edit?'<th></th>':''}</tr></thead><tbody>
  ${vista.map(l=>{ const c=bibCat(l.catId)||{nombre:'—',color:'#999'}; const disp=bibEjemplares(l)-bibPrestados(l.id);
    return `<tr><td class="mono">${esc(l.cod)}</td><td>${esc(l.dewey)}</td><td>${bibSwatch(c)}${esc(c.nombre)}</td><td>${esc(l.titulo)}</td><td>${esc(l.autor)}</td><td class="num">${bibEjemplares(l)}</td><td><span class="badge ${l.estado==='Malo'?'badge-bad':l.estado==='Regular'?'badge-warn':'badge-good'}">${esc(l.estado)}</span></td><td>${esc(l.isbn)}</td><td>${esc(l.editorial)}</td><td>${esc(l.obs)}</td><td class="num">${esc(l.ubi)}</td><td class="num">${disp}</td><td style="white-space:nowrap">${(()=>{ const r = rsm.get(l.id); return r ? '<span style="color:#f2a900">★</span> <b>'+r.prom.toFixed(1)+'</b> <span class="hint">('+r.n+')</span>' : ''; })()}</td>${edit?`<td><button class="btn btn-sm" data-bibedit="${l.id}">✎</button> <button class="btn btn-sm" data-bibbaja="${l.id}" title="Dar de baja (perdido, dañado…)">⬇</button> <button class="btn btn-sm btn-danger" data-bibdel="${l.id}">🗑</button></td>`:''}</tr>`; }).join('') || `<tr><td colspan="14" class="empty">Sin libros. Usa “Nuevo libro” o “Importar Excel”.</td></tr>`}
  </tbody></table></div>${pager}`;
}
function renderBibCats(){
  const libros = bibLibros();
  return `<div class="toolbar noprint">${canEdit()?'<button class="btn btn-primary" id="bibNuevaCat">+ Nueva categoría</button>':''}<button class="btn" onclick="window.print()">🖨 Imprimir lista de cotejo</button></div>
  <div class="hint" style="margin:6px 0">Lista de cotejo – Cartelera lectora: compara el total declarado con lo registrado en el sistema.</div>
  <div class="tbl-wrap"><table><thead><tr><th>Categoría</th><th>Prefijo</th><th>Color (HEX)</th><th>Muestra</th><th>Ubicaciones</th><th>Total declarado</th><th>Registrados</th><th>Diferencia</th>${canEdit()?'<th></th>':''}</tr></thead><tbody>
  ${bibCats().map(c=>{ const reg=libros.filter(l=>l.catId===c.id).reduce((a,l)=>a+bibEjemplares(l),0); const dif=reg-(Number(c.totalDeclarado)||0);
    return `<tr><td>${esc(c.nombre)}</td><td class="mono">${esc(c.prefijo)}</td><td class="mono">${esc(c.color)}</td><td><div style="width:90px;height:16px;border-radius:3px;background:${esc(c.color)}"></div></td><td>${esc(c.ubicaciones)||'Sin datos'}</td><td class="num">${c.totalDeclarado||0}</td><td class="num">${reg}</td><td class="num"><span class="badge ${dif===0?'badge-good':'badge-warn'}">${dif>0?'+':''}${dif}</span></td>${canEdit()?`<td><button class="btn btn-sm" data-bibcatedit="${c.id}">✎</button></td>`:''}</tr>`; }).join('')}
  </tbody></table></div>`;
}
const bibPf = { q:'', est:'' };
function bibEstadoPrest(p){ return p.perdido?'Perdido':p.devuelto?'Devuelto':bibVencido(p)?'Vencido':'Prestado'; }
function renderBibPrest(){
  const libros = bibLibros(), q = bibPf.q.trim().toLowerCase();
  let lista = [...bibPrest()].filter(p=>!bibPf.est || bibEstadoPrest(p)===bibPf.est);
  if(q) lista = lista.filter(p=>{ const l=libros.find(x=>x.id===p.libroId)||{}; return [p.lector,p.grado,l.cod,l.titulo].some(v=>String(v||'').toLowerCase().includes(q)); });
  lista.sort((a,b)=>(a.devuelto?1:0)-(b.devuelto?1:0) || String(a.vence).localeCompare(String(b.vence)));
  const nv = bibPrest().filter(bibVencido).length;
  return `<div class="toolbar noprint"><input class="search" id="bpQ" placeholder="Buscar lector, grado, libro…" value="${esc(bibPf.q)}"><select id="bpEst"><option value="">Todos</option>${['Prestado','Vencido','Devuelto','Perdido'].map(e=>`<option ${bibPf.est===e?'selected':''}>${e}</option>`).join('')}</select>${canEdit()?'<button class="btn btn-primary" id="bibNuevoPrest">+ Nuevo préstamo</button><button class="btn" id="bibAula">👥 Préstamo por aula</button><button class="btn" id="bibAulaDev">↩ Devolución por aula</button>':''}<button class="btn" id="bibMorosos">📋 Morosos por grado</button>${canEdit()?'<button class="btn" id="bibReglas">⚙ Reglas</button>':''}<button class="btn" onclick="window.print()">🖨 Imprimir</button></div>
  ${(()=>{ const ids=new Set(bibLect().filter(x=>x.baja).map(x=>x.id)), n=bibPrest().filter(p=>!p.devuelto&&ids.has(p.lectorId)).length; return n?'<div class="note-banner">'+n+' libro(s) siguen en manos de lectores dados de baja (egresados): búscalos por su nombre y reclámalos o márcalos como perdidos.</div>':''; })()}${(()=>{ const u=(DB.get(B2.cfg)||{}).ultimoRespaldo; return (!u||bibDias(u,today())>14)?'<div class="note-banner">Hace más de 14 días que no descargas un respaldo de la biblioteca (Reporte general → 💾 Respaldo).</div>':''; })()}${nv?`<div class="note-banner">${nv} préstamo(s) vencido(s). Usa “Recordar” para enviar el aviso por WhatsApp o copiar el mensaje.</div>`:''}
  <div class="tbl-wrap"><table><thead><tr><th>Libro</th><th>Lector</th><th>Grado / sección</th><th>Fecha</th><th>Vence</th><th>Estado</th>${canEdit()?'<th class="noprint"></th>':''}</tr></thead><tbody>
  ${lista.map(p=>{ const l=libros.find(x=>x.id===p.libroId)||{}; const e=bibEstadoPrest(p); const st=e==='Perdido'?'<span class="badge badge-bad">Perdido</span>':e==='Devuelto'?'<span class="badge badge-good">Devuelto '+esc(p.devuelto)+'</span>':e==='Vencido'?'<span class="badge badge-bad">Vencido</span>':'<span class="badge badge-info">Prestado</span>';
    return `<tr><td><span class="mono">${esc(l.cod)}</span> ${esc(l.titulo)}</td><td>${esc(p.lector)}</td><td>${esc(p.grado)}</td><td>${esc(p.fecha)}</td><td>${esc(p.vence)}</td><td>${st}</td>${canEdit()?`<td class="noprint">${p.devuelto?'':`<button class="btn btn-sm" data-bibdev="${p.id}">Devolver</button> <button class="btn btn-sm" data-bibren="${p.id}" title="Renovar 7 días">+7d</button> <button class="btn btn-sm" data-bibper="${p.id}" title="Marcar como perdido">Perdido</button> ${e==='Vencido'?`<button class="btn btn-sm" data-bibrec="${p.id}">Recordar</button>`:''}`}</td>`:''}</tr>`; }).join('') || '<tr><td colspan="7" class="empty">Sin préstamos para mostrar.</td></tr>'}
  </tbody></table></div>`;
}
function bibRecordar(id){
  const p=bibPrest().find(x=>x.id===id); if(!p) return; const l=bibLibros().find(x=>x.id===p.libroId)||{}; const cfg=DB.get(KEYS.config)||{};
  const msg=`Hola ${p.lector}, desde la biblioteca${cfg.nombreIE?' de '+cfg.nombreIE:''} te recordamos devolver el libro "${l.titulo}" (${l.cod}), prestado el ${p.fecha} y con vencimiento el ${p.vence}. ¡Gracias!`;
  const bg=bibModal('Recordatorio de devolución', `<div class="field"><label>Mensaje</label><textarea id="br_msg" rows="5" style="width:100%">${esc(msg)}</textarea></div><div class="field"><label>Celular (opcional, con código de país, ej. 51987654321)</label><input id="br_tel"></div>`,
  async bg=>{ const t=bibV(bg,'br_msg'); const tel=bibV(bg,'br_tel').replace(/\D/g,''); if(tel){ window.open('https://wa.me/'+tel+'?text='+encodeURIComponent(t),'_blank'); } else { try{ await navigator.clipboard.writeText(t); toast('Mensaje copiado.','ok'); }catch(e){ toast('No se pudo copiar; selecciona el texto manualmente.','err'); return false; } } }, 'Enviar / copiar');
}
// ---- Morosos agrupados por grado / sección (para avisar a cada tutor) ----
function bibMorososGrupos(minDias){
  const lib = new Map(bibLibros().map(l=>[l.id,l])), lecs = new Map(bibLect().map(l=>[l.id,l])), g = new Map();
  bibPrest().filter(bibVencido).forEach(p=>{
    const atraso = bibDias(p.vence, today()); if(atraso < minDias) return;
    const lec = lecs.get(p.lectorId);
    const pg = SigieBib.parsearGrado(lec ? ((lec.tipo||'Alumno')!=='Alumno' ? 'DOCENTE' : lec.grado) : p.grado), k = pg.etiquetaSeccion;
    if(!g.has(k)) g.set(k, { orden:pg.orden, filas:[] }); g.get(k).filas.push({ p, l:lib.get(p.libroId)||{}, atraso });
  });
  return [...g.entries()].sort((a,b)=>a[1].orden-b[1].orden || a[0].localeCompare(b[0],'es')).map(([grado,o])=>({ grado, filas:o.filas.sort((a,b)=>b.atraso-a.atraso) }));
}
function bibAvisoTutor(gr){
  const cfg = DB.get(KEYS.config)||{};
  return 'Estimado(a) tutor(a) de '+gr.grado+': los siguientes estudiantes tienen libros de la biblioteca'+(cfg.nombreIE?' de '+cfg.nombreIE:'')+' pendientes de devolución:\n'
    + gr.filas.map(f=>'• '+f.p.lector+': "'+(f.l.titulo||'—')+'" ('+(f.l.cod||'—')+'), vencía el '+f.p.vence+' ('+f.atraso+' día'+(f.atraso===1?'':'s')+' de atraso)').join('\n')
    + '\nAgradeceremos su apoyo para que los devuelvan a la brevedad. ¡Gracias!';
}
function bibMorososHTML(grupos, minDias){
  const cfg = DB.get(KEYS.config)||{}, total = grupos.reduce((a,g)=>a+g.filas.length,0);
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Morosos de biblioteca</title><style>
  body{font-family:Arial,sans-serif;font-size:12px;margin:18px;color:#111;} h1{font-size:17px;margin:0;} .sub{color:#555;margin:2px 0 14px;}
  h2{font-size:14px;margin:0 0 4px;} section{break-inside:avoid;margin-bottom:18px;} table{width:100%;border-collapse:collapse;}
  th,td{border:1px solid #999;padding:4px 6px;text-align:left;} th{background:#e8ecf3;} td.n{text-align:right;}
  .bar{background:#14304d;color:#fff;padding:8px 12px;margin:-18px -18px 14px;display:flex;gap:12px;align-items:center;} .bar button{padding:5px 10px;cursor:pointer;}
  @media print{.bar{display:none;} section{page-break-inside:avoid;}}</style></head><body>
  <div class="bar"><b>Libros pendientes de devolución</b><button onclick="window.print()">🖨 Imprimir / Guardar como PDF</button></div>
  <h1>Libros pendientes de devolución — ${esc(cfg.nombreIE||'Biblioteca')}</h1>
  <div class="sub">Al ${esc(today())} · ${total} libro(s) vencido(s)${minDias>1?' con '+minDias+' o más días de atraso':''} · ${grupos.length} grado(s)/sección(es)</div>
  ${grupos.map(g=>`<section><h2>${esc(g.grado)} <small>(${g.filas.length})</small></h2><table><thead><tr><th>Estudiante</th><th>Cód.</th><th>Libro</th><th>Prestado</th><th>Vencía</th><th>Atraso (días)</th><th>Firma / cargo</th></tr></thead><tbody>${g.filas.map(f=>`<tr><td>${esc(f.p.lector)}</td><td>${esc(f.l.cod||'')}</td><td>${esc(f.l.titulo||'')}</td><td>${esc(f.p.fecha)}</td><td>${esc(f.p.vence)}</td><td class="n">${f.atraso}</td><td style="width:90px"></td></tr>`).join('')}</tbody></table></section>`).join('')||'<p>No hay préstamos vencidos.</p>'}</body></html>`;
}
const bibMorosoUI = { min:1 };
function bibMorosos(){
  const ayuda = ()=>`Se agrupan por el grado/sección actual del lector: “3A”, “3° A” y “3ro A primaria” cuentan como la misma aula.`;
  const cuerpo = ()=>{
    const grupos = bibMorososGrupos(bibMorosoUI.min), total = grupos.reduce((a,g)=>a+g.filas.length,0);
    return `<div class="toolbar noprint"><label class="hint">Atraso mínimo: <select id="bmMin">${[[1,'Cualquiera (1+ día)'],[7,'7 días o más'],[15,'15 días o más'],[30,'30 días o más']].map(o=>`<option value="${o[0]}" ${bibMorosoUI.min===o[0]?'selected':''}>${o[1]}</option>`).join('')}</select></label>
      <span style="flex:1"></span><button class="btn btn-primary" id="bmWa">📲 Avisos por WhatsApp</button><button class="btn" id="bmXls">⇩ Excel</button><button class="btn btn-primary" id="bmPdf">🖨 Imprimir / PDF</button></div>
      <div class="hint" style="margin-bottom:10px;">${total} libro(s) vencido(s) en ${grupos.length} grado(s)/sección(es). ${ayuda()}</div>
      ${grupos.map((g,gi)=>`<div class="card" style="margin-bottom:12px;"><div class="card-h"><h3>${esc(g.grado)} <span class="badge badge-bad">${g.filas.length}</span></h3><button class="btn btn-sm" data-bmaviso="${gi}">📋 Copiar aviso para el tutor</button></div>
        <div class="tbl-wrap"><table><thead><tr><th>Estudiante</th><th>Libro</th><th>Vencía</th><th>Atraso</th><th class="noprint"></th></tr></thead><tbody>${g.filas.map(f=>`<tr><td>${esc(f.p.lector)}</td><td><span class="mono">${esc(f.l.cod||'')}</span> ${esc(f.l.titulo||'')}</td><td>${esc(f.p.vence)}</td><td><span class="badge badge-bad">${f.atraso} d</span></td><td class="noprint"><button class="btn btn-sm" data-bmrec="${f.p.id}">Recordar</button></td></tr>`).join('')}</tbody></table></div></div>`).join('') || '<div class="empty"><div class="big">🎉</div>No hay préstamos vencidos con ese criterio.</div>'}`;
  };
  const bg = bibModal('Morosos por grado / sección', cuerpo(), ()=>true, 'Cerrar', '1100px');
  const c = bg.querySelector('#bmC'); if(c) c.style.display='none';
  const pintar = ()=>{
    const mb = bg.querySelector('.m-b'); mb.innerHTML = cuerpo();
    mb.querySelector('#bmMin').onchange = e=>{ bibMorosoUI.min = Number(e.target.value)||1; pintar(); };
    const grupos = bibMorososGrupos(bibMorosoUI.min);
    mb.querySelector('#bmWa').onclick = ()=>bibAvisosModal(bibMorosoUI.min);
    mb.querySelector('#bmPdf').onclick = ()=>{
      if(!grupos.length){ toast('No hay morosos para imprimir.','err'); return; }
      const w = window.open('', '_blank'); if(!w){ toast('El navegador bloqueó la ventana. Permite ventanas emergentes para este sitio.','err'); return; }
      w.document.write(bibMorososHTML(grupos, bibMorosoUI.min)); w.document.close(); setTimeout(()=>{ try{ w.focus(); w.print(); }catch(e){} }, 500);
    };
    mb.querySelector('#bmXls').onclick = ()=>{
      if(!grupos.length){ toast('No hay morosos para exportar.','err'); return; }
      const aoa = [['Grado / sección','Estudiante','Cód. libro','Título','Prestado','Vencía','Días de atraso'], ...grupos.flatMap(g=>g.filas.map(f=>[g.grado, f.p.lector, f.l.cod||'', f.l.titulo||'', f.p.fecha, f.p.vence, f.atraso]))];
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Morosos'); XLSX.writeFile(wb, 'biblioteca-morosos-'+today()+'.xlsx');
    };
    mb.querySelectorAll('[data-bmaviso]').forEach(b=>b.onclick=async()=>{ try{ await navigator.clipboard.writeText(bibAvisoTutor(grupos[+b.dataset.bmaviso])); toast('Aviso copiado. Pégalo en WhatsApp o en un correo.','ok'); }catch(e){ toast('No se pudo copiar; usa "Imprimir / PDF".','err'); } });
    mb.querySelectorAll('[data-bmrec]').forEach(b=>b.onclick=()=>bibRecordar(b.dataset.bmrec));
  };
  pintar();
}
function bibHistorialLector(id){
  const x=bibLect().find(r=>r.id===id); if(!x) return;
  const ps=bibPrest().filter(p=>p.lectorId===id || (!p.lectorId && p.lector===x.nombre)).sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha)));
  const bg=bibModal('Historial de '+esc(x.nombre), `<div class="hint">${ps.length} préstamo(s) · ${ps.filter(p=>!p.devuelto).length} pendiente(s)</div><div class="tbl-wrap"><table><thead><tr><th>Libro</th><th>Fecha</th><th>Estado</th></tr></thead><tbody>${ps.map(p=>{ const l=bibLibros().find(y=>y.id===p.libroId)||{}; return `<tr><td>${esc(l.cod)} ${esc(l.titulo)}</td><td>${esc(p.fecha)}</td><td>${esc(bibEstadoPrest(p))}</td></tr>`; }).join('')||'<tr><td colspan="3" class="empty">Sin préstamos.</td></tr>'}</tbody></table></div>`, ()=>true, 'Cerrar');
  const c=bg.querySelector('#bmC'); if(c) c.style.display='none';
}
/* ---------- Reporte general (estadísticas, PDF en formato planilla y Excel completo) ---------- */
const bibRp = { per:'todo' };
const BIB_MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const bibDias = (a,b)=>Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/864e5);
const bibNatural = (a,b)=>String(a.cod).localeCompare(String(b.cod),'es',{numeric:true});
function bibPeriodoDesde(){ const n = {'30':30,'90':90,'365':365}[bibRp.per]; return n ? fechaLocalISO(new Date(Date.now()-n*864e5)) : ''; }
function bibStats(){
  const libros = bibLibros(), cats = bibCats(), prest = bibPrest(), hoyS = today(), desde = bibPeriodoDesde();
  const lib = new Map(libros.map(l=>[l.id,l]));
  const activos = {}; prest.filter(p=>!p.devuelto).forEach(p=>{ activos[p.libroId] = (activos[p.libroId]||0)+1; });
  const porCat = cats.map(c=>{
    const ls = libros.filter(l=>l.catId===c.id), ej = ls.reduce((a,l)=>a+bibEjemplares(l),0);
    const est = e=>ls.filter(l=>l.estado===e).reduce((a,l)=>a+bibEjemplares(l),0);
    const pr = ls.reduce((a,l)=>a+(activos[l.id]||0),0), decl = Number(c.totalDeclarado)||0;
    return { c, titulos:new Set(ls.map(l=>(l.titulo+'|'+l.autor).toUpperCase())).size, ej, decl, dif:ej-decl, bueno:est('Bueno'), regular:est('Regular'), malo:est('Malo'), prestados:pr, disp:ej-pr };
  });
  const tomas = DB.get(BKEYS.tomas)||[];
  const mapaU = new Map();
  libros.forEach(l=>{ const u = String(l.ubi||'').trim()||'Sin ubicación'; if(!mapaU.has(u)) mapaU.set(u,[]); mapaU.get(u).push(l); });
  const porUbi = [...mapaU.entries()].sort((a,b)=>a[0].localeCompare(b[0],'es',{numeric:true})).map(([u,ls])=>{
    const t = tomas.filter(x=>String(x.ubi)===u).sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha)))[0];
    return { ubi:u, registros:ls.length, ej:ls.reduce((a,l)=>a+bibEjemplares(l),0), cats:[...new Set(ls.map(l=>(bibCat(l.catId)||{}).prefijo||'—'))].join(', '),
      prestados:ls.reduce((a,l)=>a+(activos[l.id]||0),0), toma:t||null, diasToma:t?bibDias(t.fecha,hoyS):null };
  });
  const pp = prest.filter(p=>!desde||p.fecha>=desde), dev = pp.filter(p=>p.devuelto&&!p.perdido), aTiempo = dev.filter(p=>p.devuelto<=p.vence);
  const prom = dev.length ? dev.reduce((a,p)=>a+Math.max(0,bibDias(p.fecha,p.devuelto)),0)/dev.length : 0;
  const contar = (arr,fn)=>{ const m=new Map(); arr.forEach(x=>{ const k=fn(x); if(k) m.set(k,(m.get(k)||0)+1); }); return [...m.entries()].sort((a,b)=>b[1]-a[1]); };
  const meses = []; const d0 = new Date(); for(let i=5;i>=0;i--){ const d=new Date(d0.getFullYear(), d0.getMonth()-i, 1); const k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); meses.push({ k, etiqueta:BIB_MESES[d.getMonth()]+' '+d.getFullYear(), prestados:prest.filter(p=>String(p.fecha).startsWith(k)).length, devueltos:prest.filter(p=>String(p.devuelto).startsWith(k)).length }); }
  const vencidos = prest.filter(bibVencido).map(p=>({ p, l:lib.get(p.libroId)||{}, atraso:bibDias(p.vence,hoyS) })).sort((a,b)=>b.atraso-a.atraso);
  const lectores = bibLect();
  const presPorLibro = new Map(); pp.forEach(p=>presPorLibro.set(p.libroId,(presPorLibro.get(p.libroId)||0)+1));
  const uso = cats.map(c=>{ const ls = libros.filter(l=>l.catId===c.id); const ej = ls.reduce((a,l)=>a+bibEjemplares(l),0); const pres = ls.reduce((a,l)=>a+(presPorLibro.get(l.id)||0),0); const usados = ls.filter(l=>presPorLibro.has(l.id)).length;
    return { c, regs:ls.length, ej, pres, usados, rot: ej ? pres/ej : 0, pctUsados: ls.length ? Math.round(usados/ls.length*100) : 0 }; }).filter(x=>x.regs>0).sort((a,b)=>b.pres-a.pres || b.rot-a.rot);
  const sinPrestamo = libros.filter(l=>!presPorLibro.has(l.id)).sort(bibNatural);
  return { libros, cats, porCat, porUbi, pp, dev, aTiempo, prom, meses, vencidos, lect:lectores.length, uso, sinPrestamo,
    topTitulos:contar(pp,p=>(lib.get(p.libroId)||{}).titulo).slice(0,10), topLectores:contar(pp,p=>p.lector).slice(0,10), porGrado:contar(pp,p=>SigieBib.claveGrado(p.grado,'seccion')).slice(0,10),
    malos:libros.filter(l=>l.estado==='Malo').sort(bibNatural), activos:prest.filter(p=>!p.devuelto).length,
    totalEj:libros.reduce((a,l)=>a+bibEjemplares(l),0), totalDecl:cats.reduce((a,c)=>a+(Number(c.totalDeclarado)||0),0),
    faltantes:porUbi.filter(u=>u.toma && u.toma.faltantes && u.toma.faltantes.length).map(u=>({ ubi:u.ubi, fecha:u.toma.fecha, cods:u.toma.faltantes })) };
}
const bibBar = (pct,color)=>`<div style="background:#e6e9ef;border-radius:3px;height:10px;min-width:70px;"><div style="width:${Math.max(0,Math.min(100,pct))}%;height:100%;border-radius:3px;background:${color};"></div></div>`;
function bibUsoHTML(s, tabla){
  const maxRot = Math.max(0.0001, ...s.uso.map(x=>x.rot));
  const totalRegs = s.libros.length, circulan = totalRegs - s.sinPrestamo.length;
  const per = bibRp.per==='todo' ? 'en todo el historial' : 'en el periodo';
  return `<h3 style="margin:18px 0 6px">Uso de la colección${bibRp.per==='todo'?'':' (periodo elegido)'}</h3>
  <div class="grid g4"><div class="kpi"><div class="label">Títulos que han circulado</div><div class="num">${totalRegs?Math.round(circulan/totalRegs*100):0}%</div></div><div class="kpi"><div class="label">Registros prestados ${per}</div><div class="num">${circulan}</div></div><div class="kpi"><div class="label">Registros sin ningún préstamo</div><div class="num">${s.sinPrestamo.length}</div></div><div class="kpi"><div class="label">Rotación general (préstamos / ejemplar)</div><div class="num">${s.totalEj?(s.pp.length/s.totalEj).toFixed(2):'0.00'}</div></div></div>
  <h4 style="margin:12px 0 4px">Categorías por uso</h4>
  ${tabla(['Categoría','Registros','Ejemplares','Préstamos','Rotación','% de títulos prestados',''], s.uso.map(x=>`<tr><td>${bibSwatch(x.c)}${esc(x.c.nombre)}</td><td class="num">${x.regs}</td><td class="num">${x.ej}</td><td class="num">${x.pres}</td><td class="num">${x.rot.toFixed(2)}</td><td class="num">${x.pctUsados}%</td><td style="width:22%">${bibBar(x.rot/maxRot*100, x.rot===0?'#c62828':'#14304d')}</td></tr>`), 'Sin datos.')}
  <h4 style="margin:12px 0 4px">Libros que nunca salieron ${per} (${s.sinPrestamo.length})</h4>
  <div class="hint" style="margin-bottom:6px;">Útil para promocionarlos en la cartelera, reubicarlos o decidir qué reponer. Excel trae la lista completa.</div>
  ${tabla(['Cód.','Categoría','Título','Autor','Ubi.'], s.sinPrestamo.slice(0,40).map(l=>`<tr><td class="mono">${esc(l.cod)}</td><td>${esc((bibCat(l.catId)||{}).nombre||'—')}</td><td>${esc(l.titulo)}</td><td>${esc(l.autor)}</td><td class="num">${esc(l.ubi)}</td></tr>`).concat(s.sinPrestamo.length>40?[`<tr><td colspan="5" class="hint">… y ${s.sinPrestamo.length-40} más (ver Excel).</td></tr>`]:[]), 'Todos los libros tuvieron al menos un préstamo.')}`;
}
function renderBibReporte(){
  const s = bibStats(), edit = canEdit();
  const dif = s.totalEj - s.totalDecl, disp = s.totalEj - s.activos;
  const est = e=>s.porCat.reduce((a,x)=>a+x[e],0);
  const pct = n=>s.totalEj ? Math.round(n/s.totalEj*1000)/10 : 0;
  const tabla = (cab, filas, vacio)=>`<div class="tbl-wrap"><table><thead><tr>${cab.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${filas.join('')||`<tr><td colspan="${cab.length}" class="empty">${vacio||'Sin datos.'}</td></tr>`}</tbody></table></div>`;
  return `<div class="toolbar noprint">
    <button class="btn btn-primary" id="bibRepPdf">📄 PDF inventario completo (formato planilla)</button>
    <select id="bibRepPlCat"><option value="">Todas las categorías</option>${bibCats().map(c=>`<option value="${c.id}">${esc(c.nombre)} (${esc(c.prefijo)})</option>`).join('')}</select>
    <button class="btn" id="bibRepPdfCat">📄 PDF de la categoría elegida</button>
    <button class="btn" id="bibRepXls">⇩ Excel completo (todas las hojas)</button><button class="btn btn-primary" id="bibFicha">📋 Ficha UGEL (formato oficial)</button><button class="btn" id="bibInf">📑 Informe anual por nivel</button><button class="btn" id="bibGrupos">📊 Por grado y sección</button><button class="btn" id="bibResp">💾 Respaldo (JSON)</button>${isAdmin()?'<button class="btn" id="bibRest">♻ Restaurar respaldo</button><input type="file" id="bibRestF" accept=".json" style="display:none">':''}<button class="btn" onclick="window.print()">🖨 Imprimir esta página</button>
    <label class="hint">Préstamos del periodo: <select id="bibRepPer">${[['todo','Todo el historial'],['30','Últimos 30 días'],['90','Últimos 90 días'],['365','Último año']].map(o=>`<option value="${o[0]}" ${bibRp.per===o[0]?'selected':''}>${o[1]}</option>`).join('')}</select></label>
  </div>
  <div class="grid g4"><div class="kpi"><div class="label">Total de ejemplares</div><div class="num">${s.totalEj}</div></div><div class="kpi"><div class="label">Declarado en cartelera</div><div class="num">${s.totalDecl}</div></div><div class="kpi"><div class="label">Diferencia (registrado − declarado)</div><div class="num">${dif>0?'+':''}${dif}</div></div><div class="kpi"><div class="label">Títulos distintos</div><div class="num">${new Set(s.libros.map(l=>(l.titulo+'|'+l.autor).toUpperCase())).size}</div></div></div>
  <div class="grid g4" style="margin-top:10px"><div class="kpi"><div class="label">Prestados ahora</div><div class="num">${s.activos}</div></div><div class="kpi"><div class="label">Disponibles</div><div class="num">${disp}</div></div><div class="kpi"><div class="label">Préstamos vencidos</div><div class="num" style="${s.vencidos.length?'color:var(--bad,#b3261e)':''}">${s.vencidos.length}</div></div><div class="kpi"><div class="label">Lectores registrados</div><div class="num">${s.lect}</div></div></div>

  <h3 style="margin:18px 0 6px">Estado de conservación</h3>
  ${tabla(['Estado','Ejemplares','%','Gráfico'], [['Bueno','#2e7d32'],['Regular','#f9a825'],['Malo','#c62828']].map(([e,col])=>{ const n=est(e.toLowerCase()); return `<tr><td>${e}</td><td class="num">${n}</td><td class="num">${pct(n)}%</td><td style="width:40%">${bibBar(pct(n),col)}</td></tr>`; }))}

  <h3 style="margin:18px 0 6px">Por categoría (cotejo con la cartelera)</h3>
  ${tabla(['Categoría','Pref.','Ubicaciones','Títulos','Ejemplares','Declarado','Dif.','Bueno','Regular','Malo','Prestados','Disp.','% en uso'], s.porCat.map(x=>`<tr><td>${bibSwatch(x.c)}${esc(x.c.nombre)}</td><td class="mono">${esc(x.c.prefijo)}</td><td>${esc(x.c.ubicaciones)||'—'}</td><td class="num">${x.titulos}</td><td class="num">${x.ej}</td><td class="num">${x.decl}</td><td class="num"><span class="badge ${x.dif===0?'badge-good':'badge-warn'}">${x.dif>0?'+':''}${x.dif}</span></td><td class="num">${x.bueno}</td><td class="num">${x.regular}</td><td class="num">${x.malo}</td><td class="num">${x.prestados}</td><td class="num">${x.disp}</td><td class="num">${x.ej?Math.round(x.prestados/x.ej*100):0}%</td></tr>`).concat([`<tr><td colspan="3"><b>TOTAL GENERAL</b></td><td class="num"><b>${s.porCat.reduce((a,x)=>a+x.titulos,0)}</b></td><td class="num"><b>${s.totalEj}</b></td><td class="num"><b>${s.totalDecl}</b></td><td class="num"><b>${dif>0?'+':''}${dif}</b></td><td class="num"><b>${est('bueno')}</b></td><td class="num"><b>${est('regular')}</b></td><td class="num"><b>${est('malo')}</b></td><td class="num"><b>${s.activos}</b></td><td class="num"><b>${disp}</b></td><td></td></tr>`]))}

  <h3 style="margin:18px 0 6px">Por estante / ubicación</h3>
  ${tabla(['Ubic.','Categorías','Registros','Ejemplares','Prestados','Última toma','Verificados','Faltantes','Situación'], s.porUbi.map(u=>{ const t=u.toma; const sit=!t?'<span class="badge badge-bad">Sin verificar</span>':u.diasToma>90?'<span class="badge badge-warn">Hace '+u.diasToma+' días</span>':'<span class="badge badge-good">Reciente</span>'; return `<tr><td class="num"><b>${esc(u.ubi)}</b></td><td>${esc(u.cats)}</td><td class="num">${u.registros}</td><td class="num">${u.ej}</td><td class="num">${u.prestados}</td><td>${t?esc(t.fecha):'—'}</td><td class="num">${t?(t.verificados+'/'+t.total):'—'}</td><td>${t?esc((t.faltantes||[]).join(', ')||'—'):'—'}</td><td>${sit}</td></tr>`; }))}

  <h3 style="margin:18px 0 6px">Préstamos — resumen${bibRp.per==='todo'?'':' del periodo'}</h3>
  <div class="grid g4"><div class="kpi"><div class="label">Préstamos en el periodo</div><div class="num">${s.pp.length}</div></div><div class="kpi"><div class="label">Devueltos a tiempo</div><div class="num">${s.dev.length?Math.round(s.aTiempo.length/s.dev.length*100):0}%</div></div><div class="kpi"><div class="label">Días promedio de préstamo</div><div class="num">${s.prom.toFixed(1)}</div></div><div class="kpi"><div class="label">Sin devolver (periodo)</div><div class="num">${s.pp.filter(p=>!p.devuelto).length}</div></div></div>
  <div class="grid g2" style="margin-top:10px"><div><h4 style="margin:8px 0 4px">Movimiento de los últimos 6 meses</h4>${tabla(['Mes','Prestados','Devueltos',''], s.meses.map(m=>`<tr><td>${m.etiqueta}</td><td class="num">${m.prestados}</td><td class="num">${m.devueltos}</td><td style="width:40%">${bibBar(m.prestados/Math.max(1,...s.meses.map(z=>z.prestados))*100,'#14304d')}</td></tr>`))}</div>
  <div><h4 style="margin:8px 0 4px">Préstamos por grado / sección</h4>${tabla(['Grado','Préstamos'], s.porGrado.map(g=>`<tr><td>${esc(g[0])}</td><td class="num">${g[1]}</td></tr>`),'Sin préstamos en el periodo.')}</div></div>
  <div class="grid g2" style="margin-top:10px"><div><h4 style="margin:8px 0 4px">Libros más prestados</h4>${tabla(['#','Título','Veces'], s.topTitulos.map((t,i)=>`<tr><td class="num">${i+1}</td><td>${esc(t[0])}</td><td class="num">${t[1]}</td></tr>`),'Sin préstamos en el periodo.')}</div>
  <div><h4 style="margin:8px 0 4px">Lectores más activos</h4>${tabla(['#','Lector','Préstamos'], s.topLectores.map((t,i)=>`<tr><td class="num">${i+1}</td><td>${esc(t[0])}</td><td class="num">${t[1]}</td></tr>`),'Sin préstamos en el periodo.')}</div></div>

  ${bibUsoHTML(s, tabla)}
  <h3 style="margin:18px 0 6px">Préstamos vencidos (a reclamar)</h3>
  ${tabla(['Libro','Lector','Grado / sección','Prestado','Vencía','Días de atraso'], s.vencidos.map(v=>`<tr><td><span class="mono">${esc(v.l.cod)}</span> ${esc(v.l.titulo)}</td><td>${esc(v.p.lector)}</td><td>${esc(v.p.grado)}</td><td>${esc(v.p.fecha)}</td><td>${esc(v.p.vence)}</td><td class="num"><span class="badge badge-bad">${v.atraso}</span></td></tr>`),'No hay préstamos vencidos.')}

  <h3 style="margin:18px 0 6px">Libros en mal estado (para reparar o reponer)</h3>
  ${tabla(['Cód.','Categoría','Título','Autor','Ubi.','Observación'], s.malos.map(l=>`<tr><td class="mono">${esc(l.cod)}</td><td>${esc((bibCat(l.catId)||{}).nombre||'—')}</td><td>${esc(l.titulo)}</td><td>${esc(l.autor)}</td><td class="num">${esc(l.ubi)}</td><td>${esc(l.obs)}</td></tr>`),'No hay libros en mal estado.')}
  ${s.faltantes.length?`<h3 style="margin:18px 0 6px">Faltantes detectados en el último inventario de cada estante</h3>${tabla(['Estante','Fecha de la toma','Códigos faltantes'], s.faltantes.map(f=>`<tr><td class="num">${esc(f.ubi)}</td><td>${esc(f.fecha)}</td><td>${esc(f.cods.join(', '))}</td></tr>`))}`:''}`;
}

/* ---------- Modales y eventos ---------- */
function bibModal(titulo, cuerpo, onSave, btn, ancho){
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal" style="max-width:${ancho||'640px'};"><div class="m-h"><h3>${titulo}</h3><button class="close-x">&times;</button></div><div class="m-b">${cuerpo}</div><div class="m-f"><button class="btn" id="bmC">Cancelar</button><button class="btn btn-primary" id="bmS">${btn||'Guardar'}</button></div></div>`;
  document.body.appendChild(bg);
  organizarModal(bg.querySelector('.m-b'));
  const close=()=>bg.remove(); bg.querySelector('.close-x').onclick=close; bg.querySelector('#bmC').onclick=close;
  bg.querySelector('#bmS').onclick=async()=>{ if(await onSave(bg)!==false) close(); };
  return bg;
}
const bibV = (bg,id)=>(bg.querySelector('#'+id).value||'').trim();
function bibLibroModal(id){
  if(!guardEdit()) return;
  const l = id ? bibLibros().find(x=>x.id===id) : null, cats = bibCats();
  const bg = bibModal(l?'Editar libro':'Nuevo libro', `<div class="field f-6"><label>Categoría</label><select id="bl_cat">${cats.map(c=>`<option value="${c.id}" ${l&&l.catId===c.id?'selected':''}>${esc(c.nombre)} (${esc(c.prefijo)})</option>`).join('')}</select></div>
    <div class="field f-3"><label>Código</label><input id="bl_cod" value="${esc(l?l.cod:'')}" placeholder="Se genera solo (ej. DIC-031)"></div>
    <div class="field f-3"><label>Dewey</label><input id="bl_dew" value="${esc(l?l.dewey:'')}"></div>
    <div class="field f-12"><label>Título del libro</label><input id="bl_tit" value="${esc(l?l.titulo:'')}"></div>
    <div class="field f-6"><label>Autor</label><input id="bl_aut" value="${esc(l?l.autor:'')}"></div>
    <div class="field f-6"><label>Editorial</label><input id="bl_edi" value="${esc(l?l.editorial:'')}"></div>
    <div class="field f-2"><label>Cantidad</label><input id="bl_can" type="number" min="1" value="${l?bibEjemplares(l):1}"></div>
    <div class="field f-3"><label>Estado</label><select id="bl_est">${BIB_ESTADOS.map(e=>`<option ${l&&l.estado===e?'selected':''}>${e}</option>`).join('')}</select></div>
    <div class="field f-5"><label>ISBN</label><div style="display:flex;gap:6px;"><input id="bl_isbn" value="${esc(l?l.isbn:'')}" placeholder="Escribe o escanea + Enter" inputmode="numeric" style="flex:1;"><button type="button" class="btn" id="bl_isbnBtn" title="Buscar título, autor y editorial por ISBN">🔍 Buscar</button></div><div class="hint" id="bl_isbnMsg"></div></div>
    <div class="field f-2"><label>Estante</label><input id="bl_ubi" value="${esc(l?l.ubi:'')}"></div>
    <div class="field f-12"><label>Observación</label><input id="bl_obs" value="${esc(l?l.obs:'')}"></div>`,
  async bg=>{
    const titulo=bibV(bg,'bl_tit'); if(!titulo){ toast('Escribe el título del libro.','err'); return false; }
    const cat = bibCat(bibV(bg,'bl_cat')); let cod = bibV(bg,'bl_cod').toUpperCase() || bibSiguienteCodigo(cat);
    if(bibLibros().some(x=>x.cod===cod && x.id!==id)){ toast('Ya existe el código '+cod,'err'); return false; }
    const rec = { id:l?l.id:uid('lib'), cod, catId:cat.id, titulo:titulo.toUpperCase(), autor:bibV(bg,'bl_aut').toUpperCase(), dewey:bibV(bg,'bl_dew'), cant:Math.max(1,Number(bibV(bg,'bl_can'))||1), estado:bibV(bg,'bl_est'), isbn:bibV(bg,'bl_isbn'), editorial:bibV(bg,'bl_edi').toUpperCase(), obs:bibV(bg,'bl_obs'), ubi:bibV(bg,'bl_ubi') };
    await DB.save(BKEYS.libros, l ? bibLibros().map(x=>x.id===id?rec:x) : [...bibLibros(), rec]);
    registrarBitacora(l?'Libro editado':'Libro registrado', cod+' · '+rec.titulo); render();
  }, l?'Guardar cambios':'Registrar libro', '860px');
  bibWireISBN(bg, id);
  if(!l){ const sel=bg.querySelector('#bl_cat'), cod=bg.querySelector('#bl_cod'); const f=()=>{ cod.placeholder='Se genera solo (ej. '+bibSiguienteCodigo(bibCat(sel.value))+')'; }; sel.onchange=f; f(); }
}
// ---- Autocompletar por ISBN (Open Library y, si no, Google Books; ambas gratuitas y sin clave) ----
async function bibBuscarISBN(isbn){
  const n = String(isbn||'').replace(/[^0-9Xx]/g,'').toUpperCase();
  if(n.length!==10 && n.length!==13) throw new Error('El ISBN debe tener 10 o 13 dígitos.');
  const lista = (a,k)=>(a||[]).map(x=>x&&x[k]).filter(Boolean).join(', ');
  try{
    const r = await fetch('https://openlibrary.org/api/books?bibkeys=ISBN:'+n+'&format=json&jscmd=data');
    if(r.ok){ const j = await r.json(); const d = j['ISBN:'+n];
      if(d && d.title) return { titulo:d.title+(d.subtitle?': '+d.subtitle:''), autor:lista(d.authors,'name'), editorial:lista(d.publishers,'name'), fuente:'Open Library' }; }
  }catch(e){}
  try{
    const r = await fetch('https://www.googleapis.com/books/v1/volumes?q=isbn:'+n+'&maxResults=1');
    if(r.ok){ const j = await r.json(); const v = j.items && j.items[0] && j.items[0].volumeInfo;
      if(v && v.title) return { titulo:v.title+(v.subtitle?': '+v.subtitle:''), autor:(v.authors||[]).join(', '), editorial:v.publisher||'', fuente:'Google Books' }; }
  }catch(e){}
  return null;
}
function bibWireISBN(bg, idActual){
  const inp = bg.querySelector('#bl_isbn'), btn = bg.querySelector('#bl_isbnBtn'), msg = bg.querySelector('#bl_isbnMsg');
  if(!inp || !btn) return;
  const aviso = (t, ok)=>{ msg.textContent = t; msg.style.color = ok===false ? 'var(--bad)' : (ok ? 'var(--good)' : ''); };
  const duplicado = ()=>{
    const n = inp.value.replace(/[^0-9Xx]/g,'').toUpperCase(); if(!n) return null;
    return bibLibros().find(x=>x.id!==idActual && String(x.isbn||'').replace(/[^0-9Xx]/g,'').toUpperCase()===n) || null;
  };
  const buscar = async ()=>{
    const dup = duplicado();
    btn.disabled = true; aviso('Buscando…');
    try{
      const d = await bibBuscarISBN(inp.value);
      if(!d){ aviso('No se encontró ese ISBN en Open Library ni en Google Books. Completa los datos a mano.', false); return; }
      const llenos = [];
      const poner = (id, v, may)=>{ const e = bg.querySelector('#'+id); if(e && v && !e.value.trim()){ e.value = may ? v.toUpperCase() : v; llenos.push(id); } };
      poner('bl_tit', d.titulo, true); poner('bl_aut', d.autor, true); poner('bl_edi', d.editorial, true);
      aviso((llenos.length ? 'Completado desde '+d.fuente+': '+d.titulo : 'Encontrado en '+d.fuente+' ("'+d.titulo+'"), pero los campos ya tenían datos y no se cambiaron.')
        + (dup ? ' ⚠ Ojo: este ISBN ya está registrado como '+dup.cod+'.' : ''), dup ? false : true);
    }catch(e){ aviso(e.message || 'No se pudo consultar (¿sin internet?).', false); }
    finally{ btn.disabled = false; }
  };
  btn.onclick = buscar;
  inp.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); buscar(); } });   // lector de código de barras USB
  inp.addEventListener('change', ()=>{ const d = duplicado(); if(d) aviso('⚠ Este ISBN ya está registrado como '+d.cod+' ('+d.titulo+'). Si es otro ejemplar, súmalo en "Cantidad".', false); });
}
function bibCatModal(id){
  const c = id ? bibCat(id) : null;
  bibModal(c?'Editar categoría':'Nueva categoría', `<div class="field f-8"><label>Categoría</label><input id="bc_nom" value="${esc(c?c.nombre:'')}"></div><div class="field f-4"><label>Prefijo (3 letras)</label><input id="bc_pre" maxlength="4" value="${esc(c?c.prefijo:'')}"></div>
   <div class="field f-3"><label>Color</label><input id="bc_col" type="color" value="${esc(c?c.color:'#1a237e')}"></div><div class="field f-5"><label>Ubicaciones</label><input id="bc_ubi" value="${esc(c?c.ubicaciones:'')}" placeholder="Ej. 18, 19"></div><div class="field f-4"><label>Total declarado</label><input id="bc_tot" type="number" value="${c?c.totalDeclarado:0}"></div>`,
  async bg=>{
    const nombre=bibV(bg,'bc_nom').toUpperCase(), prefijo=bibV(bg,'bc_pre').toUpperCase(); if(!nombre||!prefijo){ toast('Nombre y prefijo son obligatorios.','err'); return false; }
    if(bibCats().some(x=>x.prefijo===prefijo && x.id!==id)){ toast('Ese prefijo ya existe.','err'); return false; }
    const rec = { id:c?c.id:'cat_'+prefijo, nombre, prefijo, color:bibV(bg,'bc_col'), ubicaciones:bibV(bg,'bc_ubi'), totalDeclarado:Number(bibV(bg,'bc_tot'))||0 };
    await DB.save(BKEYS.cats, c ? bibCats().map(x=>x.id===id?rec:x) : [...bibCats(), rec]); render();
  });
}
const BIB_COLS = ['Cod','Dewey','Categoría','Título del libro','Autor','Cant','Estado','ISBN','Editorial','Observación','Ubi'];
function bibExportar(){
  const filas = bibLibros().map(l=>[l.cod,l.dewey,(bibCat(l.catId)||{}).nombre||'',l.titulo,l.autor,bibEjemplares(l),l.estado,l.isbn,l.editorial,l.obs,l.ubi]);
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([BIB_COLS,...filas]), 'Libros'); XLSX.writeFile(wb,'biblioteca-libros-'+today()+'.xlsx');
}
/* ---------- PDF / impresión en el formato de la planilla física ---------- */
function bibPlanillaHTML(lista){
  const cfg = DB.get(KEYS.config)||{}, cats = bibCats(), fecha = today();
  const grupos = cats.map(c=>({ c, filas:lista.filter(l=>l.catId===c.id).sort(bibNatural) })).filter(g=>g.filas.length);
  const huer = lista.filter(l=>!cats.some(c=>c.id===l.catId)); if(huer.length) grupos.push({ c:{nombre:'SIN CATEGORÍA',color:'#999',prefijo:'—'}, filas:huer.sort(bibNatural) });
  const ancho = [6,5,8,23,14,3,6,8,10,14,3];
  const colg = '<colgroup>'+ancho.map(a=>`<col style="width:${a}%">`).join('')+'</colgroup>';
  const cab = '<thead><tr>'+BIB_COLS.map((c,i)=>`<th>${i===3?'TÍTULO DEL LIBRO (TEXTO LIBRO)':esc(c).toUpperCase()}</th>`).join('')+'</tr></thead>';
  const secciones = grupos.map(g=>{
    const tot = g.filas.reduce((a,l)=>a+bibEjemplares(l),0);
    return `<section class="cat"><div class="cat-h"><span class="ie">${esc(cfg.nombreIE||'')} · BIBLIOTECA — ${esc(fecha)}</span><b style="border-bottom:4px solid ${esc(g.c.color)}">${esc(g.c.nombre)}</b></div>
    <table>${colg}${cab}<tbody>${g.filas.map(l=>`<tr><td class="m">${esc(l.cod)}</td><td class="c">${esc(l.dewey)}</td><td>${esc(g.c.nombre)}</td><td>${esc(l.titulo)}</td><td>${esc(l.autor)}</td><td class="c">${bibEjemplares(l)}</td><td>${esc(l.estado)}</td><td class="c">${esc(l.isbn)}</td><td>${esc(l.editorial)}</td><td>${esc(l.obs)}</td><td class="c">${esc(l.ubi)}</td></tr>`).join('')}
    <tr class="tot"><td colspan="5">TOTAL ${esc(g.c.nombre)} — ${g.filas.length} registro(s)</td><td class="c">${tot}</td><td colspan="5"></td></tr></tbody></table></section>`;
  }).join('');
  const resumen = `<section class="cat"><div class="cat-h"><span class="ie">${esc(cfg.nombreIE||'')} · BIBLIOTECA — ${esc(fecha)}</span><b>RESUMEN GENERAL</b></div><table style="width:70%;margin:0 auto"><thead><tr><th>CATEGORÍA</th><th>PREFIJO</th><th>UBICACIONES</th><th>REGISTROS</th><th>EJEMPLARES</th></tr></thead><tbody>${grupos.map(g=>`<tr><td>${esc(g.c.nombre)}</td><td class="m">${esc(g.c.prefijo)}</td><td>${esc(g.c.ubicaciones||'')}</td><td class="c">${g.filas.length}</td><td class="c">${g.filas.reduce((a,l)=>a+bibEjemplares(l),0)}</td></tr>`).join('')}<tr class="tot"><td colspan="3">TOTAL GENERAL DE EJEMPLARES</td><td class="c">${lista.length}</td><td class="c">${lista.reduce((a,l)=>a+bibEjemplares(l),0)}</td></tr></tbody></table></section>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Inventario de biblioteca — formato planilla</title><style>
  @page{ size:A4 landscape; margin:8mm; } *{ box-sizing:border-box; } body{ font-family:Arial,Helvetica,sans-serif; color:#111; margin:0; }
  .bar{ position:sticky; top:0; background:#14304d; color:#fff; padding:8px 12px; display:flex; gap:12px; align-items:center; font-size:13px; } .bar button{ padding:6px 14px; font-weight:700; cursor:pointer; }
  section.cat{ page-break-after:always; padding:2mm 0; } section.cat:last-child{ page-break-after:auto; }
  .cat-h{ display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:5px; } .cat-h .ie{ font-size:9px; color:#444; } .cat-h b{ font-size:17px; letter-spacing:.5px; text-transform:uppercase; padding-bottom:2px; }
  table{ width:100%; border-collapse:collapse; table-layout:fixed; } thead{ display:table-header-group; } tr{ page-break-inside:avoid; }
  th{ background:#2f4b7c; color:#fff; font-size:8px; padding:4px 3px; border:1px solid #1d3358; text-transform:uppercase; }
  td{ border:1px solid #2f4b7c; padding:2px 3px; font-size:8px; text-transform:uppercase; overflow:hidden; word-wrap:break-word; } td.c{ text-align:center; } td.m{ font-family:Consolas,monospace; font-weight:700; }
  tbody tr:nth-child(even){ background:#eef2f8; } tr.tot td{ background:#dfe6f2; font-weight:700; }
  @media print{ .bar{ display:none; } }</style></head><body>
  <div class="bar"><b>Inventario de biblioteca</b><span>${lista.length} registros · ${lista.reduce((a,l)=>a+bibEjemplares(l),0)} ejemplares · ${grupos.length} categorías</span><button onclick="window.print()">🖨 Imprimir / Guardar como PDF</button><span>(en el cuadro de impresión elige “Guardar como PDF”, orientación horizontal)</span></div>${secciones}${resumen}</body></html>`;
}
function bibPlanilla(lista){
  if(!lista.length){ toast('No hay libros para el PDF.','err'); return; }
  const w = window.open('', '_blank'); if(!w){ toast('El navegador bloqueó la ventana. Permite ventanas emergentes para este sitio.','err'); return; }
  w.document.write(bibPlanillaHTML(lista)); w.document.close(); setTimeout(()=>{ try{ w.focus(); w.print(); }catch(e){} }, 600);
}
function bibExportarReporte(){
  const s = bibStats(), cat = l=>(bibCat(l.catId)||{}).nombre||'';
  const wb = XLSX.utils.book_new(); const hoja = (n,aoa)=>XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), n);
  hoja('Resumen', [['Indicador','Valor'],['Total de ejemplares',s.totalEj],['Declarado en cartelera',s.totalDecl],['Diferencia',s.totalEj-s.totalDecl],['Prestados ahora',s.activos],['Disponibles',s.totalEj-s.activos],['Préstamos vencidos',s.vencidos.length],['Lectores registrados',s.lect],['Libros en mal estado',s.malos.length]]);
  hoja('Por categoría', [['Categoría','Prefijo','Ubicaciones','Títulos','Ejemplares','Declarado','Diferencia','Bueno','Regular','Malo','Prestados','Disponibles'],...s.porCat.map(x=>[x.c.nombre,x.c.prefijo,x.c.ubicaciones||'',x.titulos,x.ej,x.decl,x.dif,x.bueno,x.regular,x.malo,x.prestados,x.disp]),['TOTAL GENERAL','','',s.porCat.reduce((a,x)=>a+x.titulos,0),s.totalEj,s.totalDecl,s.totalEj-s.totalDecl,'','','',s.activos,s.totalEj-s.activos]]);
  hoja('Por estante', [['Ubicación','Categorías','Registros','Ejemplares','Prestados','Última toma','Verificados','Total','Faltantes'],...s.porUbi.map(u=>[u.ubi,u.cats,u.registros,u.ej,u.prestados,u.toma?u.toma.fecha:'Sin verificar',u.toma?u.toma.verificados:'',u.toma?u.toma.total:'',u.toma?(u.toma.faltantes||[]).join(', '):''])]);
  hoja('Catálogo completo', [BIB_COLS,...s.libros.slice().sort((a,b)=>(s.cats.findIndex(c=>c.id===a.catId)-s.cats.findIndex(c=>c.id===b.catId))||bibNatural(a,b)).map(l=>[l.cod,l.dewey,cat(l),l.titulo,l.autor,bibEjemplares(l),l.estado,l.isbn,l.editorial,l.obs,l.ubi])]);
  const lib = new Map(s.libros.map(l=>[l.id,l]));
  hoja('Préstamos', [['Cód. libro','Título','Lector','Grado / sección','Fecha','Vence','Devuelto','Estado'],...bibPrest().slice().sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha))).map(p=>{ const l=lib.get(p.libroId)||{}; return [l.cod||'',l.titulo||'',p.lector,p.grado,p.fecha,p.vence,p.devuelto||'',bibEstadoPrest(p)]; })]);
  hoja('Vencidos', [['Cód. libro','Título','Lector','Grado / sección','Prestado','Vencía','Días de atraso'],...s.vencidos.map(v=>[v.l.cod||'',v.l.titulo||'',v.p.lector,v.p.grado,v.p.fecha,v.p.vence,v.atraso])]);
  hoja('Uso por categoría', [['Categoría','Registros','Ejemplares','Préstamos','Rotación (préstamos/ejemplar)','% de títulos prestados'],...s.uso.map(x=>[x.c.nombre,x.regs,x.ej,x.pres,Number(x.rot.toFixed(2)),x.pctUsados])]);
  hoja('Sin préstamos', [['Cód.','Categoría','Título','Autor','Ubi.'],...s.sinPrestamo.map(l=>[l.cod,cat(l),l.titulo,l.autor,l.ubi])]);
  hoja('Más prestados', [['Título','Veces prestado'],...s.topTitulos]);
  hoja('Lectores activos', [['Lector','Préstamos'],...s.topLectores]);
  hoja('Mal estado', [['Cód.','Categoría','Título','Autor','Ubi.','Observación'],...s.malos.map(l=>[l.cod,cat(l),l.titulo,l.autor,l.ubi,l.obs])]);
  XLSX.writeFile(wb, 'biblioteca-reporte-completo-'+today()+'.xlsx');
}
async function bibImportar(file){
  try{
    const wb = XLSX.read(await file.arrayBuffer(), {type:'array'}); const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:''});
    const norm = s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
    const get = (r,...ks)=>{ for(const k of Object.keys(r)) if(ks.includes(norm(k))) return String(r[k]).trim(); return ''; };
    const cats = bibCats(); const libros = [...bibLibros()]; const cods = new Set(libros.map(l=>l.cod)); let n=0, omit=0;
    for(const r of filas){
      const titulo = get(r,'TITULO DEL LIBRO (TEXTO LIBRO)','TITULO DEL LIBRO','TITULO'); if(!titulo) continue;
      let cod = get(r,'COD','CODIGO').toUpperCase(); const catNom = norm(get(r,'CATEGORIA'));
      const cat = cats.find(c=>norm(c.nombre)===catNom) || cats.find(c=>cod.startsWith(c.prefijo+'-')); if(!cat){ omit++; continue; }
      if(!cod){ let m=0; libros.filter(l=>l.catId===cat.id).forEach(l=>{ const x=String(l.cod).match(/(\d+)$/); if(x) m=Math.max(m,+x[1]); }); cod = cat.prefijo+'-'+String(m+1).padStart(3,'0'); }
      if(cods.has(cod)){ omit++; continue; } cods.add(cod);
      const est = get(r,'ESTADO'); libros.push({ id:uid('lib'), cod, catId:cat.id, titulo, autor:get(r,'AUTOR'), dewey:get(r,'DEWEY'), cant:Math.max(1,Number(get(r,'CANT','CANTIDAD'))||1), estado:BIB_ESTADOS.find(e=>norm(e)===norm(est))||'Regular', isbn:get(r,'ISBN'), editorial:get(r,'EDITORIAL'), obs:get(r,'OBSERVACION'), ubi:get(r,'UBI','UBICACION') }); n++;
    }
    await DB.save(BKEYS.libros, libros); registrarBitacora('Importación de libros', n+' libros'); toast(n+' libros importados'+(omit?' ('+omit+' omitidos: código repetido o categoría no reconocida)':''),'ok'); render();
  }catch(e){ toast('No se pudo leer el archivo: '+e.message,'err'); }
}
function bibWire(){
  const $=id=>document.getElementById(id), on=(id,fn)=>{ const e=$(id); if(e) e.addEventListener('click',fn); };
  const f=(id,key,ev)=>{ const e=$(id); if(e) e.addEventListener(ev||'change',()=>{ bibF[key]=e.value; bibF.pag=1; if(id==='bibQ'||id==='bibFUbi'){ const p=e.selectionStart; render(); const n=$(id); if(n){ n.focus(); try{n.setSelectionRange(p,p);}catch(x){} } } else render(); }); };
  f('bibQ','q','input'); f('bibFCat','cat'); f('bibFEst','estado'); f('bibFUbi','ubi','input');
  on('bibNuevo',()=>bibLibroModal()); on('bibExp',bibExportar); on('bibRepXls',bibExportarReporte); on('bibPdfLista',()=>bibPlanilla(bibListaFiltrada())); on('bibRepPdf',()=>bibPlanilla(bibLibros())); on('bibRepPdfCat',()=>{ const c=$('bibRepPlCat').value; bibPlanilla(c?bibLibros().filter(l=>l.catId===c):bibLibros()); }); on('bibPgPrev',()=>{ bibF.pag--; render(); }); on('bibPgNext',()=>{ bibF.pag++; render(); }); { const sp=$('bibRepPer'); if(sp) sp.onchange=()=>{ bibRp.per=sp.value; render(); }; } on('bibNuevaCat',()=>bibCatModal()); on('bibNuevoPrest',bibPrestModal);
  on('bibImp',()=>$('bibImpFile').click()); const fi=$('bibImpFile'); if(fi) fi.onchange=()=>fi.files[0]&&bibImportar(fi.files[0]);
  bibWire2(); bibWire3(); bibWire4(); if(typeof bibWire5==='function') bibWire5();
  document.querySelectorAll('[data-bibedit]').forEach(b=>b.onclick=()=>bibLibroModal(b.dataset.bibedit));
  document.querySelectorAll('[data-bibcatedit]').forEach(b=>b.onclick=()=>bibCatModal(b.dataset.bibcatedit));
  document.querySelectorAll('[data-bibdel]').forEach(b=>b.onclick=async()=>{ if(!guardEdit()) return; const l=bibLibros().find(x=>x.id===b.dataset.bibdel); if(!l) return; const pend = bibPrestados(l.id); if(pend>0){ toast('No se puede eliminar '+l.cod+': tiene '+pend+' ejemplar(es) prestado(s). Registra primero la devolución o la pérdida.','err'); return; } const rsv = bibRes().filter(r=>r.libroId===l.id && (r.estado==='Espera'||r.estado==='Disponible')); if(confirm('¿Eliminar '+l.cod+' · '+l.titulo+'?'+(rsv.length?'\n\nSe cancelarán '+rsv.length+' reserva(s) de este libro.':''))){ if(rsv.length) await DB.save(B2.res, bibRes().map(r=>rsv.some(x=>x.id===r.id)?{...r,estado:'Cancelada'}:r)); await DB.save(BKEYS.libros, bibLibros().filter(x=>x.id!==l.id)); registrarBitacora('Libro eliminado', l.cod); render(); } });
  document.querySelectorAll('[data-bibdev]').forEach(b=>b.onclick=async()=>{ const p = await bibDevolver(b.dataset.bibdev); render(); if(p && typeof bibResenaPedir==='function') bibResenaPedir(p.id); });
}
const BIB_RENDER = { bibLect:renderBibLect, bibQR:renderBibQR, bibToma:renderBibToma, bibLibros:renderBibLibros, bibCats:renderBibCats, bibPrest:renderBibPrest, bibReporte:renderBibReporte };

/* ---------- Etiquetas QR por libro ---------- */
const bibQ = { cat:'', ubi:'' };
function bibQrImg(texto){ try{ const q=qrcode(0,'M'); q.addData(texto); q.make(); return q.createDataURL(4,0); }catch(e){ return ''; } }
function renderBibQR(){
  let list = bibLibros().filter(l=>(!bibQ.cat || l.catId===bibQ.cat) && (!bibQ.ubi || String(l.ubi||'').trim()===bibQ.ubi));
  const total = list.length; list = list.slice(0,240);
  return `<div class="toolbar noprint"><select id="bqCat"><option value="">Elige una categoría</option>${bibCats().map(c=>`<option value="${c.id}" ${bibQ.cat===c.id?'selected':''}>${esc(c.nombre)} (${esc(c.prefijo)})</option>`).join('')}</select><select id="bqUbi"><option value="">Todos los estantes</option>${bibUbis().map(u=>`<option ${bibQ.ubi===u?'selected':''}>${esc(u)}</option>`).join('')}</select><button class="btn btn-primary" onclick="window.print()">🖨 Imprimir etiquetas</button></div>
  <div class="hint noprint" style="margin:6px 0">Cada etiqueta lleva el QR con el código del libro, para usarlo en el inventario por estante. ${total>240?'Se muestran 240 de '+total+'; filtra por categoría.':''}</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;">
  ${(bibQ.cat||bibQ.ubi)?list.map(l=>{ const c=bibCat(l.catId)||{color:'#999'}; return `<div style="border:1px solid #999;border-top:8px solid ${esc(c.color)};padding:6px;text-align:center;break-inside:avoid;font-size:11px;"><img src="${bibQrImg(l.cod)}" style="width:84px;height:84px"><div class="mono" style="font-weight:700;font-size:13px">${esc(l.cod)}</div><div>${esc(String(l.titulo).slice(0,38))}</div><div>Ubic. ${esc(l.ubi||'—')}</div></div>`; }).join(''):'<div class="empty">Elige una categoría o un estante para generar sus etiquetas.</div>'}</div>`;
}

/* ---------- Inventario físico por estante (ubicación) ---------- */
const bibT = { ubi:'', ok:new Set(), sobrantes:new Set() };
function bibUbis(){ return [...new Set(bibLibros().map(l=>String(l.ubi||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es',{numeric:true})); }
function renderBibToma(){
  const hist = [...(DB.get(BKEYS.tomas)||[])].reverse().slice(0,10);
  const histHtml = `<h3 style="margin:18px 0 6px">Últimas tomas</h3><div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Estante</th><th>Responsable</th><th>Verificados</th><th>Faltantes</th><th>De otro estante</th></tr></thead><tbody>${hist.map(t=>`<tr><td>${esc(t.fecha)}</td><td>${esc(t.ubi)}</td><td>${esc(t.responsable)}</td><td class="num">${t.verificados}/${t.total}</td><td>${esc(t.faltantes.join(', ')||'—')}</td><td>${esc(t.sobrantes.join(', ')||'—')}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">Aún no hay tomas.</td></tr>'}</tbody></table></div>`;
  if(!bibT.ubi) return `<div class="toolbar noprint"><select id="btUbi"><option value="">Elige el estante a verificar</option>${bibUbis().map(u=>`<option>${esc(u)}</option>`).join('')}</select></div><div class="hint">Elige un estante: el sistema lista sus libros y los marcas escaneando el QR o a mano.</div>${histHtml}`;
  const libros = bibLibros().filter(l=>String(l.ubi).trim()===bibT.ubi), v = libros.filter(l=>bibT.ok.has(l.cod)).length;
  return `<div class="toolbar noprint"><b>Estante ${esc(bibT.ubi)}</b> — ${v}/${libros.length} verificados<button class="btn" id="btScan">📷 Escanear QR</button><input id="btCod" placeholder="Código a mano (DIC-001) + Enter" style="width:220px"><button class="btn btn-primary" id="btFin">Finalizar toma</button><button class="btn" id="btCan">Cancelar</button></div>
  ${bibT.sobrantes.size?`<div class="note-banner">De otro estante: ${esc([...bibT.sobrantes].join(', '))}</div>`:''}
  <div class="tbl-wrap"><table><thead><tr><th></th><th>Cód.</th><th>Título</th><th>Cant.</th></tr></thead><tbody>${libros.map(l=>`<tr><td><input type="checkbox" data-btchk="${esc(l.cod)}" ${bibT.ok.has(l.cod)?'checked':''}></td><td class="mono">${esc(l.cod)}</td><td>${esc(l.titulo)}</td><td class="num">${bibEjemplares(l)}</td></tr>`).join('')}</tbody></table></div>`;
}
function bibMarcar(cod){
  cod = String(cod||'').trim().toUpperCase(); const l = bibLibros().find(x=>x.cod===cod);
  if(!l){ toast('Código no registrado: '+cod,'err'); return false; }
  if(String(l.ubi).trim()===bibT.ubi) bibT.ok.add(cod); else bibT.sobrantes.add(cod);
  render(); return true;
}
function bibEscaner(){
  if(typeof QrScanner==='undefined'){ toast('No se pudo cargar el lector de QR (sin internet).','err'); return; }
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal" style="max-width:420px"><div class="m-h"><h3>Escanear libros</h3><button class="close-x">&times;</button></div><div class="m-b"><video playsinline style="width:100%;border-radius:8px;background:#000"></video><div class="hint" id="bsH" style="margin-top:8px">Apunta al QR de cada libro; se marca solo.</div></div></div>`;
  document.body.appendChild(bg); let sc=null, ult='', ts=0;
  const close=()=>{ if(sc){ try{sc.stop();sc.destroy();}catch(e){} } bg.remove(); }; bg.querySelector('.close-x').onclick=close;
  sc=new QrScanner(bg.querySelector('video'), r=>{ const c=String(r.data||r).trim().toUpperCase(); if(c===ult && Date.now()-ts<1800) return; ult=c; ts=Date.now(); const ok=bibMarcar(c); bg.querySelector('#bsH').textContent=(ok?'✔ ':'✖ ')+c; }, {highlightScanRegion:true,returnDetailedScanResult:true});
  sc.start().catch(()=>{ toast('No se pudo abrir la cámara.','err'); close(); });
}
async function bibFinalizar(){
  const libros = bibLibros().filter(l=>String(l.ubi).trim()===bibT.ubi), ok = libros.filter(l=>bibT.ok.has(l.cod));
  if(!confirm('Finalizar: '+ok.length+' de '+libros.length+' libros verificados. ¿Guardar la toma?')) return;
  const rec = { id:uid('bt'), fecha:today(), ubi:bibT.ubi, responsable:(STATE.session&&(STATE.session.nombre||STATE.session.usuario))||'—', total:libros.length, verificados:ok.length, faltantes:libros.filter(l=>!bibT.ok.has(l.cod)).map(l=>l.cod), sobrantes:[...bibT.sobrantes] };
  await DB.save(BKEYS.tomas, [...(DB.get(BKEYS.tomas)||[]), rec]); registrarBitacora('Inventario por estante', 'Estante '+rec.ubi+': '+rec.verificados+'/'+rec.total);
  bibT.ubi=''; bibT.ok=new Set(); bibT.sobrantes=new Set(); toast('Toma guardada.','ok'); render();
}
function bibWire2(){
  const $=id=>document.getElementById(id);
  if($('bqCat')) $('bqCat').onchange=e=>{ bibQ.cat=e.target.value; render(); };
  if($('bqUbi')) $('bqUbi').onchange=e=>{ bibQ.ubi=e.target.value; render(); };
  if($('btUbi')) $('btUbi').onchange=e=>{ if(!guardEdit()){ e.target.value=''; return; } bibT.ubi=e.target.value; bibT.ok=new Set(); bibT.sobrantes=new Set(); render(); };
  if($('btScan')) $('btScan').onclick=bibEscaner;
  if($('btFin')) $('btFin').onclick=bibFinalizar;
  if($('btCan')) $('btCan').onclick=()=>{ bibT.ubi=''; bibT.ok=new Set(); bibT.sobrantes=new Set(); render(); };
  if($('btCod')) $('btCod').onkeydown=e=>{ if(e.key==='Enter'){ bibMarcar(e.target.value); } };
  document.querySelectorAll('[data-btchk]').forEach(c=>c.onchange=()=>{ c.checked?bibT.ok.add(c.dataset.btchk):bibT.ok.delete(c.dataset.btchk); render(); });
}

/* ---------- Lectores y carnés con QR ---------- */
const bibLect = ()=>DB.get(BKEYS.lect)||[];
const bibLf = { q:'', grupo:'' };
function bibEscanearUno(cb){
  if(typeof QrScanner==='undefined'){ toast('No se pudo cargar el lector de QR (sin internet).','err'); return; }
  const bg=document.createElement('div'); bg.className='modal-bg'; bg.style.zIndex=9999;
  bg.innerHTML=`<div class="modal" style="max-width:380px"><div class="m-h"><h3>Escanear QR</h3><button class="close-x">&times;</button></div><div class="m-b"><video playsinline style="width:100%;border-radius:8px;background:#000"></video></div></div>`;
  document.body.appendChild(bg); let sc=null; const close=()=>{ if(sc){ try{sc.stop();sc.destroy();}catch(e){} } bg.remove(); };
  bg.querySelector('.close-x').onclick=close;
  sc=new QrScanner(bg.querySelector('video'), r=>{ const c=String(r.data||r).trim().toUpperCase(); close(); cb(c); }, {returnDetailedScanResult:true});
  sc.start().catch(()=>{ toast('No se pudo abrir la cámara.','err'); close(); });
}
function renderBibLect(){
  const q=bibLf.q.trim().toLowerCase(); const list=bibLect().filter(x=>!x.baja).filter(x=>!bibLf.grupo||bibGrupoDe(x)===bibLf.grupo).filter(x=>!q||[x.cod,x.nombre,x.grado].some(v=>String(v||'').toLowerCase().includes(q)));
  const cfg = DB.get(KEYS.config)||{};
  return `<div class="toolbar noprint"><input class="search" id="blQ" placeholder="Buscar lector…" value="${esc(bibLf.q)}">${canEdit()?'<button class="btn btn-primary" id="blNuevo">+ Nuevo lector</button><button class="btn" id="blImp">⇧ Importar Excel</button><input type="file" id="blImpF" accept=".xlsx,.xls,.csv" style="display:none">':''}<select id="blGrupo" title="Ver solo un aula"><option value="">Todas las aulas</option>${bibGruposLector().map(g=>`<option value="${esc(g.clave)}" ${bibLf.grupo===g.clave?'selected':''}>${esc(g.clave)} (${g.n})</option>`).join('')}</select><button class="btn btn-primary" id="blCarnes" title="8 carnés por hoja A4, con líneas de corte">🖨 Carnés en hojas</button><button class="btn" onclick="window.print()">🖨 Imprimir esta página</button>${canEdit()?'<button class="btn" id="blProm">🎓 Nómina y promoción</button>':''}</div>
  <div class="hint noprint" style="margin:6px 0">${list.length} lectores. Excel con columnas: Nombre, Grado, Tipo (Alumno/Docente) y, si quieres avisar por WhatsApp, Celular. El carné lleva un QR con el código LEC-… para agilizar los préstamos.</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px;">${list.slice(0,300).map(x=>`<div style="border:1px solid #888;border-radius:8px;padding:8px;display:flex;gap:8px;align-items:center;break-inside:avoid"><img src="${bibQrImg(x.cod)}" style="width:80px;height:80px"><div style="font-size:12px"><div style="font-weight:700;font-size:10px;color:#555">BIBLIOTECA · ${esc(cfg.nombreIE||'')}</div><div style="font-weight:700;font-size:14px">${esc(x.nombre)}</div><div>${esc(x.tipo)} · ${esc(x.grado)}</div><div class="mono">${esc(x.cod)}</div>${x.tel?`<div class="noprint" style="font-size:11px;color:#555">📱 ${esc(x.tel)}</div>`:''}<button class="btn btn-sm noprint" data-blhis="${x.id}">Historial</button> ${canEdit()?`<button class="btn btn-sm noprint" data-bled="${x.id}">✏️ Editar</button> <button class="btn btn-sm noprint" data-blel="${x.id}">🗑</button>`:''}</div></div>`).join('')||'<div class="empty">Sin lectores todavía.</div>'}</div>`;
}
function bibSigLec(extra){ let m=0; [...bibLect(),...(extra||[])].forEach(x=>{ const r=String(x.cod).match(/(\d+)$/); if(r) m=Math.max(m,+r[1]); }); return 'LEC-'+String(m+1).padStart(4,'0'); }
function bibLectModal(){
  if(!guardEdit()) return;
  bibModal('Nuevo lector', `<div class="field"><label>Nombre completo</label><input id="bn_nom"></div><div class="field"><label>Grado / sección o área</label><input id="bn_gra"></div><div class="field"><label>Tipo</label><select id="bn_tip"><option>Alumno</option><option>Docente</option><option>Otro</option></select></div><div class="field"><label>Celular del apoderado (opcional, para avisos por WhatsApp)</label><input id="bn_tel" inputmode="tel" placeholder="987654321"></div>`,
  async bg=>{ const nombre=bibV(bg,'bn_nom').toUpperCase(); if(!nombre){ toast('Escribe el nombre.','err'); return false; }
    await DB.save(BKEYS.lect, [...bibLect(), {id:uid('lec'), cod:bibSigLec(), nombre, grado:bibV(bg,'bn_gra'), tipo:bibV(bg,'bn_tip'), tel:bibV(bg,'bn_tel')}]); render(); });
}
function bibLectEditar(id){
  if(!guardEdit()) return;
  const x=bibLect().find(l=>l.id===id); if(!x) return;
  bibModal('Editar lector', `<div class="field"><label>Código</label><input value="${esc(x.cod)}" disabled></div><div class="field"><label>Nombre completo</label><input id="bn_nom" value="${esc(x.nombre)}"></div><div class="field"><label>Grado / sección o área</label><input id="bn_gra" value="${esc(x.grado||'')}"></div><div class="field"><label>Tipo</label><select id="bn_tip">${['Alumno','Docente','Otro'].map(t=>`<option ${x.tipo===t?'selected':''}>${t}</option>`).join('')}</select></div><div class="field"><label>Celular del apoderado (opcional, para avisos por WhatsApp)</label><input id="bn_tel" inputmode="tel" value="${esc(x.tel||'')}"></div>`,
  async bg=>{ const nombre=bibV(bg,'bn_nom').toUpperCase(); if(!nombre){ toast('Escribe el nombre.','err'); return false; }
    await DB.save(BKEYS.lect, bibLect().map(l=>l.id===id?{...l, nombre, grado:bibV(bg,'bn_gra'), tipo:bibV(bg,'bn_tip'), tel:bibV(bg,'bn_tel')}:l)); toast('Lector actualizado.','ok'); render(); }, 'Guardar cambios');
}
async function bibImportarLect(file){
  try{
    const wb=XLSX.read(await file.arrayBuffer(),{type:'array'}); const filas=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});
    const norm=t=>String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase(); const get=(r,...k)=>{ for(const c of Object.keys(r)) if(k.includes(norm(c))) return String(r[c]).trim(); return ''; };
    const nuevos=[]; for(const r of filas){ const nombre=get(r,'NOMBRE','NOMBRES','APELLIDOS Y NOMBRES','ALUMNO').toUpperCase(); if(!nombre) continue; nuevos.push({id:uid('lec'), cod:bibSigLec(nuevos), nombre, grado:get(r,'GRADO','GRADO Y SECCION','SECCION'), tipo:get(r,'TIPO')||'Alumno', tel:get(r,'CELULAR','TELEFONO','CEL','WHATSAPP','CELULAR APODERADO','TELEFONO APODERADO','CELULAR DEL APODERADO')}); }
    await DB.save(BKEYS.lect,[...bibLect(),...nuevos]); toast(nuevos.length+' lectores importados','ok'); render();
  }catch(e){ toast('No se pudo leer el archivo: '+e.message,'err'); }
}
function bibWire3(){
  const $=id=>document.getElementById(id);
  if($('bpQ')) $('bpQ').oninput=e=>{ bibPf.q=e.target.value; const p=e.target.selectionStart; render(); const n=$('bpQ'); n.focus(); try{n.setSelectionRange(p,p);}catch(x){} };
  if($('bpEst')) $('bpEst').onchange=e=>{ bibPf.est=e.target.value; render(); };
  document.querySelectorAll('[data-bibrec]').forEach(b=>b.onclick=()=>bibRecordar(b.dataset.bibrec));
  document.querySelectorAll('[data-blhis]').forEach(b=>b.onclick=()=>bibHistorialLector(b.dataset.blhis));
  document.querySelectorAll('[data-bibren]').forEach(b=>b.onclick=async()=>{ if(!guardEdit()) return; await bibRenovar(b.dataset.bibren); render(); });
  if($('blQ')) $('blQ').oninput=e=>{ bibLf.q=e.target.value; const p=e.target.selectionStart; render(); const n=$('blQ'); n.focus(); try{n.setSelectionRange(p,p);}catch(x){} };
  if($('bibMorosos')) $('bibMorosos').onclick=bibMorosos;
  if($('blNuevo')) $('blNuevo').onclick=bibLectModal;
  if($('blImp')) $('blImp').onclick=()=>$('blImpF').click();
  if($('blImpF')) $('blImpF').onchange=e=>e.target.files[0]&&bibImportarLect(e.target.files[0]);
  document.querySelectorAll('[data-bled]').forEach(b=>b.onclick=()=>bibLectEditar(b.dataset.bled));
  document.querySelectorAll('[data-blel]').forEach(b=>b.onclick=async()=>{ if(confirm('¿Eliminar este lector?')){ await DB.save(BKEYS.lect, bibLect().filter(x=>x.id!==b.dataset.blel)); render(); } });
}


/* ======================= (antes biblioteca2.js) ======================= */
/* SIGIE Biblioteca v5 — reglas de préstamo, mostrador con escáner, reservas, bajas/actas, promoción de grado y retos de lectura.
   Se carga después de biblioteca.js y antes de app.js. */
const B2 = { cfg:'sigie:bib_config', res:'sigie:bib_reservas', baj:'sigie:bib_bajas' };
const B2_CFG0 = { Alumno:{max:2,dias:7}, Docente:{max:5,dias:15}, Otro:{max:2,dias:7}, bloquear:true, reservaDias:3, ultimoGrado:5, maxRenov:2, niveles:{ Inicial:5, Primaria:6, Secundaria:5 } };
const bibCfg = ()=>({ ...B2_CFG0, ...(DB.get(B2.cfg)||{}) }), bibRes = ()=>DB.get(B2.res)||[], bibBaj = ()=>DB.get(B2.baj)||[];
const BIB_TITULOS2 = { bibMost:['Mostrador (escáner)','Presta y devuelve escaneando el carné y el libro'], bibRes:['Reservas y lista de espera','Libros pedidos que están prestados'], bibBajas:['Bajas y pérdidas','Libros perdidos, dañados o retirados, con acta de baja'], bibRetos:['Retos de lectura','Ranking por aula e insignias de lectores'] };
async function bib2Cargar(){ await Promise.all([DB.load(B2.cfg,{}), DB.load(B2.res,[]), DB.load(B2.baj,[])]); }
const bibNorm = s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase().replace(/\s+/g,' ');
const bibEnDias = n=>fechaLocalISO(new Date(Date.now()+n*864e5));

/* ---- Reglas ---- */
function bibPuede(lec, nombre){
  const c = bibCfg(), t = (lec&&lec.tipo)||'Alumno', r = c[t]||c.Alumno;
  if(lec && lec.baja) return nombre+' está dado de baja.';
  const mios = bibPrest().filter(p=>!p.devuelto && (lec ? p.lectorId===lec.id : p.lector===nombre));
  if(c.bloquear && mios.some(bibVencido)) return nombre+' tiene libros vencidos: debe devolverlos primero.';
  if(mios.length>=r.max) return nombre+' ya tiene '+mios.length+' libro(s) (máximo '+r.max+' para '+t+').';
  return '';
}
function bibLibre(l, lecId, nombre){
  const disp = bibEjemplares(l)-bibPrestados(l.id), rs = bibRes().filter(r=>r.libroId===l.id && r.estado==='Disponible' && r.hasta>=today());
  const suya = rs.find(r=>lecId ? r.lectorId===lecId : r.lector===nombre);
  return suya ? { ok:disp>0, res:suya } : { ok:disp-rs.length>0 };
}
async function bibPrestar(l, lec, nombre, grado, vence, extra){
  const e = bibPuede(lec, nombre); if(e) return e;
  if(bibPrest().some(p=>!p.devuelto && p.libroId===l.id && (lec ? p.lectorId===lec.id : p.lector===nombre))) return nombre+' ya tiene un ejemplar de '+l.cod+' prestado.';
  const q = bibLibre(l, lec&&lec.id, nombre); if(!q.ok) return 'No hay ejemplares libres de '+l.cod+' (prestado o reservado para otro lector).';
  await DB.save(BKEYS.prest, [...bibPrest(), { id:uid('bp'), libroId:l.id, lectorId:lec?lec.id:'', lector:nombre, grado:grado||'', fecha:today(), vence:vence||bibEnDias((bibCfg()[(lec&&lec.tipo)||'Alumno']||{dias:7}).dias), devuelto:'', ...(extra||{}) }]);
  if(q.res) await DB.save(B2.res, bibRes().map(r=>r.id===q.res.id?{...r,estado:'Atendida'}:r));
  registrarBitacora('Préstamo de libro', nombre+' · '+l.cod); return '';
}
async function bibResPromover(libroId){
  const l = bibLibros().find(x=>x.id===libroId); if(!l) return [];
  let rs = bibRes().map(r=>r.libroId===libroId && r.estado==='Disponible' && r.hasta<today() ? {...r,estado:'Vencida'} : r), avis = [];
  let libres = bibEjemplares(l)-bibPrestados(libroId)-rs.filter(r=>r.libroId===libroId && r.estado==='Disponible').length;
  rs = rs.map(r=>{ if(libres>0 && r.libroId===libroId && r.estado==='Espera'){ libres--; avis.push(r); return {...r, estado:'Disponible', hasta:bibEnDias(bibCfg().reservaDias)}; } return r; });
  await DB.save(B2.res, rs); return avis;
}
async function bibDevolver(id){
  const p = bibPrest().find(x=>x.id===id); if(!p) return null;
  await DB.save(BKEYS.prest, bibPrest().map(x=>x.id===id?{...x,devuelto:today()}:x)); registrarBitacora('Devolución de libro', id);
  const av = await bibResPromover(p.libroId), l = bibLibros().find(x=>x.id===p.libroId)||{};
  if(av.length) toast('Reservado para '+av.map(r=>r.lector).join(', ')+' ('+l.cod+'). Avísale desde Reservas.','ok');
  return p;
}
function bibReglasModal(){
  if(!guardEdit()) return; const c = bibCfg();
  const fila = t=>`<div class="field f-4"><label>${t}</label></div><div class="field f-4"><input id="rg_${t}_m" type="number" min="1" value="${c[t].max}"></div><div class="field f-4"><input id="rg_${t}_d" type="number" min="1" value="${c[t].dias}"></div>`;
  bibModal('Reglas de préstamo', `<div class="hint f-12">Por tipo de lector: máximo de libros a la vez (centro) y días de plazo (derecha).</div>${['Alumno','Docente','Otro'].map(fila).join('')}
   <div class="field f-12"><label><input type="checkbox" id="rg_blq" ${c.bloquear?'checked':''}> Bloquear nuevos préstamos mientras el lector tenga un libro vencido</label></div>
   <div class="field f-6"><label>Días que se guarda una reserva</label><input id="rg_res" type="number" min="1" value="${c.reservaDias}"></div><div class="field f-6"><label>Renovaciones máximas por préstamo</label><input id="rg_ren" type="number" min="0" value="${c.maxRenov}"></div>
   <div class="field f-6"><label>Alerta: alumno sin leer hace (días)</label><input id="rg_inact" type="number" min="1" max="365" value="${c.diasInactivo||30}"></div><div class="field f-6"><label><input type="checkbox" id="rg_resena" ${c.pedirResena===false?'':'checked'}> Pedir reseña (estrellas) al devolver un libro</label></div>
   <div class="field f-12"><label><input type="checkbox" id="rg_compr" ${c.pedirComprension===true?'checked':''}> Pedir el nivel de comprensión (AD / A / B / C) al devolver un libro (solo lo registra quien puede editar)</label></div>
   <div class="field f-12"><label><input type="checkbox" id="rg_san" ${(c.sancion||{}).activa?'checked':''}> <b>Sanción proporcional al atraso</b>: al devolver un libro vencido, el lector no puede llevar otro durante unos días según cuánto se atrasó</label></div>
   <div class="field f-6"><label>Días de suspensión por cada día de atraso</label><input id="rg_sanf" type="number" min="0.5" max="10" step="0.5" value="${(c.sancion||{}).factor||1}"></div><div class="field f-6"><label>Suspensión máxima (días)</label><input id="rg_sanm" type="number" min="1" max="365" value="${(c.sancion||{}).maxDias||30}"></div>
   <div class="hint f-12">La sanción es una política del colegio y viene apagada. Se suma al bloqueo de arriba (que solo impide prestar mientras el lector tiene un libro vencido en su poder). Cada sanción se puede levantar desde <i>Sanciones por atraso</i>.</div>
   <div class="hint f-12">Último grado de cada nivel (para la promoción anual): Inicial = años (5), Primaria = 6.°, Secundaria = 5.°.</div>${['Inicial','Primaria','Secundaria'].map(t=>`<div class="field f-4"><label>${t}</label><input id="rg_nv_${t}" type="number" min="1" max="6" value="${c.niveles[t]}"></div>`).join('')}`,
  async bg=>{ const n = id=>Math.max(1, Number(bibV(bg,id))||1), o = { ...c, bloquear:bg.querySelector('#rg_blq').checked, reservaDias:n('rg_res'), maxRenov:Math.max(0, Math.floor(Number(bibV(bg,'rg_ren'))||0)), diasInactivo:Math.min(365, n('rg_inact')), pedirResena:bg.querySelector('#rg_resena').checked, pedirComprension:bg.querySelector('#rg_compr').checked, sancion:{ activa:bg.querySelector('#rg_san').checked, factor:Math.max(0.5, Math.min(10, Number(bibV(bg,'rg_sanf'))||1)), maxDias:Math.min(365, n('rg_sanm')) }, niveles:{ Inicial:n('rg_nv_Inicial'), Primaria:n('rg_nv_Primaria'), Secundaria:n('rg_nv_Secundaria') } };
    ['Alumno','Docente','Otro'].forEach(t=>o[t]={ max:n('rg_'+t+'_m'), dias:n('rg_'+t+'_d') }); await DB.save(B2.cfg, o); toast('Reglas guardadas.','ok'); render(); });
}
function bibPrestModal(){
  if(!guardEdit()) return; const libros = bibLibros(), lect = bibLect().filter(x=>!x.baja);
  if(!libros.length){ toast('Registra libros primero.','err'); return; }
  const bg = bibModal('Nuevo préstamo', `<div class="field f-12"><label>Libro (código o título)</label><div style="display:flex;gap:6px"><input id="bp_lib" list="bpLibs" placeholder="Escribe o escanea el QR del libro" style="flex:1"><button type="button" class="btn btn-sm" id="bpScan">📷</button></div><datalist id="bpLibs">${libros.slice(0,2000).map(l=>`<option value="${esc(l.cod)}">${esc(l.titulo)} (disp. ${bibEjemplares(l)-bibPrestados(l.id)})</option>`).join('')}</datalist></div>
   <div class="field f-12"><label>Lector (código LEC-… o nombre)</label><input id="bp_lec" list="bpLecs" placeholder="Escribe o escanea el carné"><datalist id="bpLecs">${lect.map(x=>`<option value="${esc(x.cod)}">${esc(x.nombre)} · ${esc(x.grado)}</option>`).join('')}</datalist></div>
   <div class="field f-6"><label>Grado / sección</label><input id="bp_gra"></div><div class="field f-6"><label>Fecha de devolución</label><input id="bp_ven" type="date" value="${bibEnDias(7)}"></div>`,
  async bg=>{
    const l = libros.find(x=>x.cod===bibV(bg,'bp_lib').toUpperCase()); if(!l){ toast('Elige un libro por su código.','err'); return false; }
    const txt = bibV(bg,'bp_lec'), lc = lect.find(x=>x.cod===txt.toUpperCase()), nombre = lc?lc.nombre:txt; if(!nombre){ toast('Indica el lector.','err'); return false; }
    const e = await bibPrestar(l, lc, nombre, lc?lc.grado:bibV(bg,'bp_gra'), bibV(bg,'bp_ven')); if(e){ toast(e,'err'); return false; } render();
  }, 'Registrar');
  const lecEl = bg.querySelector('#bp_lec'), graEl = bg.querySelector('#bp_gra'), venEl = bg.querySelector('#bp_ven');
  lecEl.addEventListener('change',()=>{ const lc = lect.find(x=>x.cod===lecEl.value.trim().toUpperCase()); if(lc){ graEl.value = lc.grado; venEl.value = bibEnDias((bibCfg()[lc.tipo]||{dias:7}).dias); } });
  bg.querySelector('#bpScan').onclick = ()=>bibEscanearUno(c=>{ if(/^LEC-/i.test(c)){ lecEl.value=c; lecEl.dispatchEvent(new Event('change')); } else bg.querySelector('#bp_lib').value=c; });
}

/* ---- Mostrador: lector de código de barras USB (campo siempre enfocado) ---- */
const bibM = { lec:null, log:[] };
function renderBibMost(){
  const l = bibM.lec, mios = l ? bibPrest().filter(p=>!p.devuelto && p.lectorId===l.id) : [];
  return `<div class="card" style="padding:14px"><div class="hint">1) Escanea el carné (LEC-…)  2) Escanea cada libro: si está libre se presta, si lo tiene este lector se devuelve. Sin carné, escanear un libro prestado lo devuelve.</div>
  <input id="bmIn" autofocus autocomplete="off" placeholder="Escanea aquí (código LEC-…, código del libro o ISBN) + Enter" style="width:100%;font-size:18px;padding:10px;margin:10px 0">
  <div style="font-size:15px">${l?`<b>${esc(l.nombre)}</b> · ${esc(l.tipo)} · ${esc(l.grado)} — ${mios.length} libro(s) en su poder <button class="btn btn-sm" id="bmOtro">Siguiente lector</button>`:'<span class="hint">Sin lector seleccionado.</span>'}</div></div>
  <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>Hora</th><th>Resultado</th></tr></thead><tbody>${bibM.log.map(x=>`<tr><td>${x.h}</td><td style="color:${x.ok?'var(--good)':'var(--bad)'}">${x.ok?'✔':'✖'} ${esc(x.t)}</td></tr>`).join('')||'<tr><td colspan="2" class="empty">Aún sin movimientos.</td></tr>'}</tbody></table></div>`;
}
async function bibMostScan(raw){
  const c = String(raw||'').trim().toUpperCase(); if(!c) return; const say = (ok,t)=>bibM.log.unshift({ ok, t, h:new Date().toLocaleTimeString('es-PE') });
  if(/^LEC-/.test(c)){ const x = bibLect().find(r=>r.cod===c); if(!x) say(false,'Carné no registrado: '+c); else { bibM.lec = x; say(true,'Lector: '+x.nombre); } }
  else {
    const n = c.replace(/[^0-9X]/g,''), l = bibLibros().find(x=>x.cod===c || (n.length>=10 && String(x.isbn||'').replace(/[^0-9Xx]/g,'').toUpperCase()===n));
    if(!l) say(false,'Libro no registrado: '+c);
    else {
      const act = bibPrest().filter(p=>!p.devuelto && p.libroId===l.id).sort((a,b)=>String(a.fecha).localeCompare(String(b.fecha))), lec = bibM.lec;
      const mio = lec && act.find(p=>p.lectorId===lec.id);
      if(mio){ await bibDevolver(mio.id); say(true,'Devuelto: '+l.cod+' '+l.titulo+' ('+mio.lector+')'); }
      else if(lec){ const e = await bibPrestar(l, lec, lec.nombre, lec.grado); say(!e, e || 'Prestado: '+l.cod+' '+l.titulo+' → '+lec.nombre+' (vence '+bibEnDias((bibCfg()[lec.tipo]||{dias:7}).dias)+')'); }
      else if(act.length){ await bibDevolver(act[0].id); say(true,'Devuelto: '+l.cod+' '+l.titulo+' ('+act[0].lector+')'); }
      else say(false,'Escanea primero el carné del lector para prestar '+l.cod+'.');
    }
  }
  bibM.log = bibM.log.slice(0,15); render();
}

/* ---- Reservas y lista de espera ---- */
function renderBibRes(){
  const rs = bibRes().filter(r=>r.estado==='Espera'||r.estado==='Disponible'), lib = new Map(bibLibros().map(l=>[l.id,l]));
  const pos = r=>rs.filter(x=>x.libroId===r.libroId && x.estado==='Espera' && x.fecha+x.id<=r.fecha+r.id).length;
  return `<div class="toolbar noprint">${canEdit()?'<button class="btn btn-primary" id="brNueva">+ Nueva reserva</button>':''}<button class="btn" id="bibReglas">⚙ Reglas de préstamo</button></div>
  <div class="hint" style="margin:6px 0">Al devolverse un libro con lista de espera, se aparta para el primero de la fila durante ${bibCfg().reservaDias} día(s); mientras tanto nadie más puede llevárselo.</div>
  <div class="tbl-wrap"><table><thead><tr><th>Libro</th><th>Lector</th><th>Grado</th><th>Pidió</th><th>Estado</th>${canEdit()?'<th></th>':''}</tr></thead><tbody>${rs.map(r=>{ const l = lib.get(r.libroId)||{};
   return `<tr><td><span class="mono">${esc(l.cod)}</span> ${esc(l.titulo)}</td><td>${esc(r.lector)}</td><td>${esc(r.grado)}</td><td>${esc(r.fecha)}${r.origen==='OPAC'?' <span class="badge" title="Reservada por el lector desde el catálogo público">OPAC</span>':''}</td><td>${r.estado==='Disponible'?'<span class="badge badge-good">Listo · guardado hasta '+esc(r.hasta)+'</span>':'<span class="badge badge-warn">En espera · puesto '+pos(r)+'</span>'}</td>${canEdit()?`<td>${r.estado==='Disponible'?`<button class="btn btn-sm" data-brpre="${r.id}">Prestar</button> <button class="btn btn-sm" data-brav="${r.id}">Avisar</button> `:''}<button class="btn btn-sm btn-danger" data-brcan="${r.id}">Cancelar</button></td>`:''}</tr>`; }).join('')||'<tr><td colspan="6" class="empty">No hay reservas.</td></tr>'}</tbody></table></div>`;
}
function bibResModal(){
  if(!guardEdit()) return; const lect = bibLect().filter(x=>!x.baja);
  bibModal('Nueva reserva', `<div class="field f-12"><label>Libro (código)</label><input id="rs_lib" list="rsLibs" placeholder="Código del libro"><datalist id="rsLibs">${bibLibros().slice(0,2000).map(l=>`<option value="${esc(l.cod)}">${esc(l.titulo)}</option>`).join('')}</datalist></div>
   <div class="field f-12"><label>Lector (código LEC-…)</label><input id="rs_lec" list="rsLecs"><datalist id="rsLecs">${lect.map(x=>`<option value="${esc(x.cod)}">${esc(x.nombre)} · ${esc(x.grado)}</option>`).join('')}</datalist></div>`,
  async bg=>{ const l = bibLibros().find(x=>x.cod===bibV(bg,'rs_lib').toUpperCase()), lc = lect.find(x=>x.cod===bibV(bg,'rs_lec').toUpperCase());
    if(!l||!lc){ toast('Elige un libro y un lector registrados (con su código).','err'); return false; }
    if(bibRes().some(r=>r.libroId===l.id && r.lectorId===lc.id && (r.estado==='Espera'||r.estado==='Disponible'))){ toast('Ese lector ya reservó este libro.','err'); return false; }
    if(bibEjemplares(l)-bibPrestados(l.id)>0 && !bibRes().some(r=>r.libroId===l.id && r.estado==='Disponible')){ toast('El libro está disponible: préstalo directamente.','err'); return false; }
    await DB.save(B2.res, [...bibRes(), { id:uid('rs'), libroId:l.id, lectorId:lc.id, lector:lc.nombre, grado:lc.grado, fecha:today(), estado:'Espera' }]); render(); }, 'Reservar');
}
/* ---- Bajas y pérdidas + acta ---- */
const BIB_MOTIVOS = ['Perdido','Dañado','Robo','Desgaste','Obsoleto','Donado'];
function bibBajaModal(libroId, prestId){
  if(!guardEdit()) return; const l = bibLibros().find(x=>x.id===libroId); if(!l) return; const p = prestId ? bibPrest().find(x=>x.id===prestId) : null;
  bibModal('Dar de baja: '+esc(l.cod)+' '+esc(l.titulo), `<div class="field f-3"><label>Cantidad</label><input id="bj_can" type="number" min="1" max="${bibEjemplares(l)}" value="1"></div><div class="field f-4"><label>Motivo</label><select id="bj_mot">${BIB_MOTIVOS.map(m=>`<option ${p&&m==='Perdido'?'selected':''}>${m}</option>`).join('')}</select></div><div class="field f-5"><label>Resolución / N° (opcional)</label><input id="bj_res"></div>
   <div class="field f-12"><label>Lector responsable (si lo hay)</label><input id="bj_lec" value="${esc(p?p.lector:'')}"></div><div class="field f-12"><label>Observación</label><input id="bj_obs"></div>`,
  async bg=>{ const n = Math.max(1, Number(bibV(bg,'bj_can'))||1), enCasa = bibPrestados(l.id) - (p&&!p.devuelto?1:0), baja = bibEjemplares(l) - enCasa; if(n>bibEjemplares(l)){ toast('Solo hay '+bibEjemplares(l)+' ejemplar(es).','err'); return false; } if(n>baja){ toast('Hay '+enCasa+' ejemplar(es) prestado(s): ahora solo puedes dar de baja '+Math.max(0,baja)+'. Registra primero su devolución.','err'); return false; }
    const rec = { id:uid('bj'), fecha:today(), libroId:l.id, cod:l.cod, titulo:l.titulo, autor:l.autor, cat:(bibCat(l.catId)||{}).nombre||'', cant:n, motivo:bibV(bg,'bj_mot'), resolucion:bibV(bg,'bj_res'), lector:bibV(bg,'bj_lec'), grado:p?p.grado:'', obs:bibV(bg,'bj_obs'), libro:{...l}, prestId:p?p.id:'', responsable:(STATE.session&&(STATE.session.nombre||STATE.session.usuario))||'—' };
    await DB.save(B2.baj, [...bibBaj(), rec]);
    if(p) await DB.save(BKEYS.prest, bibPrest().map(x=>x.id===p.id?{...x,devuelto:today(),perdido:true}:x));
    const resto = bibEjemplares(l)-n; await DB.save(BKEYS.libros, resto>0 ? bibLibros().map(x=>x.id===l.id?{...x,cant:resto}:x) : bibLibros().filter(x=>x.id!==l.id));
    registrarBitacora('Baja de libro', l.cod+' · '+rec.motivo+' x'+n); render(); }, 'Registrar baja');
}
const bibBf = { anio:'' };
function renderBibBajas(){
  const todas = bibBaj(), anios = [...new Set(todas.map(b=>b.fecha.slice(0,4)))].sort(), lista = todas.filter(b=>!bibBf.anio||b.fecha.startsWith(bibBf.anio)).sort((a,b)=>b.fecha.localeCompare(a.fecha));
  const por = BIB_MOTIVOS.map(m=>[m, lista.filter(b=>b.motivo===m).reduce((a,b)=>a+b.cant,0)]).filter(x=>x[1]);
  return `<div class="toolbar noprint"><select id="bjAnio"><option value="">Todos los años</option>${anios.map(a=>`<option ${bibBf.anio===a?'selected':''}>${a}</option>`).join('')}</select><button class="btn btn-primary" id="bjActa">🖨 Acta de baja</button><button class="btn" id="bjXls">⇩ Excel</button></div>
  <div class="hint" style="margin:6px 0">${lista.reduce((a,b)=>a+b.cant,0)} ejemplar(es) dados de baja${por.length?' — '+por.map(x=>x[0]+': '+x[1]).join(' · '):''}. Se da de baja desde Libros (🗑 al lado: botón ⬇) o con “Perdido” en Préstamos.</div>
  <div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Cód.</th><th>Título</th><th>Cant.</th><th>Motivo</th><th>Lector</th><th>Resolución</th><th>Observación</th></tr></thead><tbody>${lista.map(b=>`<tr><td>${esc(b.fecha)}</td><td class="mono">${esc(b.cod)}</td><td>${esc(b.titulo)}</td><td class="num">${b.cant}</td><td>${esc(b.motivo)}</td><td>${esc(b.lector)} ${esc(b.grado)}</td><td>${esc(b.resolucion)}</td><td>${esc(b.obs)}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">Sin bajas registradas.</td></tr>'}</tbody></table></div>`;
}
function bibActa(lista){
  if(!lista.length){ toast('No hay bajas para el acta.','err'); return; } const cfg = DB.get(KEYS.config)||{}, tot = lista.reduce((a,b)=>a+b.cant,0), nro = prompt('N° de acta (opcional):','')||'';
  const w = window.open('','_blank'); if(!w){ toast('Permite ventanas emergentes para imprimir.','err'); return; }
  w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Acta de baja</title><style>body{font-family:Arial;font-size:12px;margin:24px;color:#111}h1{font-size:16px;text-align:center;margin:4px}p{margin:6px 0}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border:1px solid #777;padding:4px 6px;text-align:left}th{background:#e8ecf3}.f{display:flex;justify-content:space-around;margin-top:70px}.f div{border-top:1px solid #000;padding-top:4px;width:28%;text-align:center}@media print{button{display:none}}</style></head><body><button onclick="window.print()">🖨 Imprimir / Guardar como PDF</button>
  <h1>ACTA DE BAJA DE MATERIAL BIBLIOGRÁFICO${nro?' N° '+esc(nro):''}</h1><p style="text-align:center">${esc(cfg.nombreIE||'')}</p><p>En la fecha ${esc(today())}, se da de baja de la biblioteca escolar los siguientes materiales, por los motivos indicados (${tot} ejemplar(es)):</p>
  <table><thead><tr><th>N°</th><th>Cód.</th><th>Título / autor</th><th>Cant.</th><th>Motivo</th><th>Responsable / observación</th></tr></thead><tbody>${lista.map((b,i)=>`<tr><td>${i+1}</td><td>${esc(b.cod)}</td><td>${esc(b.titulo)}${b.autor?' — '+esc(b.autor):''}</td><td>${b.cant}</td><td>${esc(b.motivo)}</td><td>${esc([b.lector,b.grado,b.obs].filter(Boolean).join(' · '))}</td></tr>`).join('')}</tbody></table>
  <div class="f"><div>Responsable de biblioteca</div><div>Director(a)</div><div>Representante / comité</div></div></body></html>`); w.document.close();
}
/* ---- Nómina anual y promoción de grado ---- */
const BIB_ORD = ['','PRIMERO','SEGUNDO','TERCERO','CUARTO','QUINTO','SEXTO'];
// Devuelve el grado siguiente: texto nuevo, null (egresa) o undefined (formato no reconocido).
// Reconoce el nivel por el texto ("3° SEC A", "5 AÑOS", "6TO PRIMARIA"): Inicial → Primaria → Secundaria → egreso.
// Si el texto no dice el nivel (p. ej. "3° A") usa el "último grado" general (ult).
const BIB_SUF = { 1:'ro', 2:'do', 3:'ro', 4:'to', 5:'to', 6:'to' };
function bibGradoSig(g, ult, niveles){
  const s = String(g||'').trim(), N = bibNorm(s); if(!s) return undefined;
  const nv = { Inicial:5, Primaria:6, Secundaria:5, ...(niveles||bibCfg().niveles||{}) };
  const nivel = /INICIAL|\bANOS?\b/.test(N) ? 'Inicial' : /\bPRIM/.test(N) ? 'Primaria' : /\bSEC/.test(N) ? 'Secundaria' : '';
  let n = 0, w = null; const d = s.match(/(\d+)\s*(ro|do|er|to|mo|vo)?\b/i);
  if(d) n = +d[1]; else { w = N.match(/PRIMERO|SEGUNDO|TERCERO|CUARTO|QUINTO|SEXTO/); if(w) n = BIB_ORD.indexOf(w[0]); }
  if(!n) return undefined;
  const ultimo = nivel ? nv[nivel] : ult;
  const seccion = (s.match(/(?:^|\s)([A-Z])\s*$/i)||[])[1];
  if(n < ultimo){
    if(d){ const suf = d[2] ? (d[2][0]===d[2][0].toUpperCase() ? BIB_SUF[n+1].toUpperCase() : BIB_SUF[n+1]) : null; return s.replace(/(\d+)(\s*)(ro|do|er|to|mo|vo)?\b/i, (m,a,sp,sf)=>(n+1)+(sf?(sp||'')+suf:(sp||''))); }
    return s.toUpperCase().replace(w[0], BIB_ORD[n+1]);
  }
  if(nivel==='Inicial') return '1° PRIMARIA'+(seccion?' '+seccion.toUpperCase():'');
  if(nivel==='Primaria') return '1° '+(/PRIMARIA/.test(N)?'SECUNDARIA':'SEC')+(seccion?' '+seccion.toUpperCase():'');
  return null;   // último grado de Secundaria (o grado sin nivel ≥ último general): egresa
}
function bibPromocionModal(){
  if(!guardEdit()) return; const c = bibCfg();
  bibModal('Nómina y promoción de grado', `<div class="hint f-12"><b>Promover:</b> sube un grado a todos los alumnos activos (3° A → 4° A); los del último grado pasan a baja como egresados. <b>Nómina:</b> actualiza grados, agrega nuevos y da de baja a los alumnos que ya no figuran (Excel con Nombre, Grado, Tipo). Haz un respaldo antes.</div>
   <div class="field f-4"><label>Último grado (si el grado no indica nivel)</label><input id="pm_ult" type="number" min="1" max="6" value="${c.ultimoGrado}"></div><div class="field f-8"><label>&nbsp;</label><div style="display:flex;gap:6px"><button class="btn btn-primary" id="pm_prom">🎓 Promover a todos</button><button class="btn" id="pm_nom">⇧ Importar nómina</button><input type="file" id="pm_f" accept=".xlsx,.xls,.csv" style="display:none"></div></div>`, ()=>true, 'Cerrar').querySelector('#bmC').style.display='none';
  const $ = id=>document.getElementById(id);
  const pendientes = ids=>bibPrest().filter(p=>!p.devuelto && ids.has(p.lectorId)).length;
  $('pm_prom').onclick = async ()=>{
    const ult = Math.max(1, Number($('pm_ult').value)||5), act = bibLect().filter(x=>!x.baja && (x.tipo||'Alumno')==='Alumno'); let sube=0, egr=[], sin=0;
    const nuevo = bibLect().map(x=>{ if(x.baja || (x.tipo||'Alumno')!=='Alumno') return x; const g = bibGradoSig(x.grado, ult, c.niveles); if(g===undefined){ sin++; return x; } if(g===null){ egr.push(x); return {...x, baja:today(), motivoBaja:'Egresado'}; } sube++; return {...x, grado:g}; });
    if(!confirm('Se promoverán '+sube+' alumnos, '+egr.length+' egresarán (baja) y '+sin+' con grado no reconocido quedan igual.'+(pendientes(new Set(egr.map(x=>x.id)))?'\n⚠ Egresados con libros pendientes: '+pendientes(new Set(egr.map(x=>x.id)))+'.':'')+'\n¿Continuar?')) return;
    await DB.save(B2.cfg, {...c, ultimoGrado:ult}); await DB.save(BKEYS.lect, nuevo); registrarBitacora('Promoción de grado', sube+' promovidos, '+egr.length+' egresados'); toast('Promoción aplicada.','ok'); document.querySelector('.modal-bg').remove(); render();
  };
  $('pm_nom').onclick = ()=>$('pm_f').click();
  $('pm_f').onchange = async e=>{ try{
    const wb = XLSX.read(await e.target.files[0].arrayBuffer(), {type:'array'}), filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:''});
    const get = (r,...k)=>{ for(const key of Object.keys(r)) if(k.includes(bibNorm(key))) return String(r[key]).trim(); return ''; };
    const nom = filas.map(r=>({ nombre:get(r,'NOMBRE','NOMBRES','APELLIDOS Y NOMBRES','ALUMNO').toUpperCase(), grado:get(r,'GRADO','GRADO Y SECCION','SECCION'), tipo:get(r,'TIPO')||'Alumno' })).filter(r=>r.nombre);
    const mapa = new Map(nom.map(r=>[bibNorm(r.nombre), r])); let lect = [...bibLect()], act=0, nue=0, baj=0; const visto = new Set();
    lect = lect.map(x=>{ const r = mapa.get(bibNorm(x.nombre)); if(r){ visto.add(bibNorm(x.nombre)); act++; return {...x, grado:r.grado||x.grado, baja:'', motivoBaja:''}; } if(!x.baja && (x.tipo||'Alumno')==='Alumno'){ baj++; return {...x, baja:today(), motivoBaja:'No figura en la nómina'}; } return x; });
    nom.filter(r=>!visto.has(bibNorm(r.nombre))).forEach(r=>{ nue++; lect.push({ id:uid('lec'), cod:bibSigLec(lect), nombre:r.nombre, grado:r.grado, tipo:r.tipo }); });
    if(!confirm('Nómina: '+act+' actualizados, '+nue+' nuevos, '+baj+' alumnos a dar de baja. ¿Aplicar?')) return;
    await DB.save(BKEYS.lect, lect); registrarBitacora('Importación de nómina', act+' act., '+nue+' nuevos, '+baj+' bajas'); toast('Nómina aplicada.','ok'); document.querySelector('.modal-bg').remove(); render();
  }catch(err){ toast('No se pudo leer el archivo: '+err.message,'err'); } };
}
/* ---- Retos de lectura ---- */
const bibRt = { per:'anio' }, BIB_INSIGNIAS = [[20,'🏆','Súper lector'],[10,'🥇','Lector experto'],[6,'🥈','Lector constante'],[3,'🥉','Lector curioso']];
function renderBibRetos(){
  const desde = bibRt.per==='anio' ? new Date().getFullYear()+'-01-01' : bibRt.per==='90' ? bibEnDias(-90) : '', ps = bibPrest().filter(p=>!desde||p.fecha>=desde), lect = bibLect().filter(x=>!x.baja);
  const aulas = new Map(), g = x=>SigieBib.claveGrado(x,'seccion'); lect.filter(x=>(x.tipo||'Alumno')==='Alumno').forEach(x=>{ const k = g(x.grado); if(!aulas.has(k)) aulas.set(k,{ n:0, pr:0, act:new Set() }); aulas.get(k).n++; });
  ps.forEach(p=>{ const k = g(p.grado); if(!aulas.has(k)) aulas.set(k,{ n:0, pr:0, act:new Set() }); const a = aulas.get(k); a.pr++; a.act.add(p.lectorId||p.lector); });
  const rank = [...aulas.entries()].map(([k,a])=>({ k, ...a, ppl:a.n?a.pr/a.n:0, part:a.n?Math.round(Math.min(a.act.size,a.n)/a.n*100):0 })).filter(a=>a.pr||a.n).sort((a,b)=>b.ppl-a.ppl||b.pr-a.pr), maxP = Math.max(0.01,...rank.map(a=>a.ppl));
  const cnt = new Map(); ps.forEach(p=>{ const k = p.lectorId||p.lector; const o = cnt.get(k)||{ nombre:p.lector, grado:p.grado, n:0 }; o.n++; cnt.set(k,o); });
  const lectores = [...cnt.values()].sort((a,b)=>b.n-a.n), ins = n=>(BIB_INSIGNIAS.find(i=>n>=i[0])||[0,'','']);
  return `<div class="toolbar noprint"><label class="hint">Periodo: <select id="rtPer">${[['anio','Este año'],['90','Últimos 90 días'],['todo','Todo el historial']].map(o=>`<option value="${o[0]}" ${bibRt.per===o[0]?'selected':''}>${o[1]}</option>`).join('')}</select></label><button class="btn" onclick="window.print()">🖨 Imprimir</button></div>
  <div class="hint" style="margin:6px 0">Insignias por préstamos en el periodo: 🥉 3 · 🥈 6 · 🥇 10 · 🏆 20. El ranking de aulas usa libros prestados por alumno matriculado, para que sea justo entre salones de distinto tamaño.</div>
  <h3 style="margin:12px 0 6px">Ranking por aula</h3><div class="tbl-wrap"><table><thead><tr><th>#</th><th>Aula</th><th>Alumnos</th><th>Préstamos</th><th>Libros por alumno</th><th>% que leyó</th><th></th></tr></thead><tbody>${rank.map((a,i)=>`<tr><td class="num">${['🥇','🥈','🥉'][i]||i+1}</td><td>${esc(a.k)}</td><td class="num">${a.n}</td><td class="num">${a.pr}</td><td class="num">${a.ppl.toFixed(2)}</td><td class="num">${a.part}%</td><td style="width:25%">${bibBar(a.ppl/maxP*100,'#14304d')}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">Sin datos todavía.</td></tr>'}</tbody></table></div>
  <h3 style="margin:18px 0 6px">Lectores destacados</h3><div class="tbl-wrap"><table><thead><tr><th>#</th><th>Lector</th><th>Aula</th><th>Libros</th><th>Insignia</th></tr></thead><tbody>${lectores.slice(0,20).map((x,i)=>`<tr><td class="num">${i+1}</td><td>${esc(x.nombre)}</td><td>${esc(x.grado)}</td><td class="num">${x.n}</td><td>${ins(x.n)[1]} ${ins(x.n)[2]}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">Sin préstamos en el periodo.</td></tr>'}</tbody></table></div>
  <div class="hint" style="margin-top:8px">Con insignia: ${BIB_INSIGNIAS.map(i=>i[1]+' '+lectores.filter(x=>ins(x.n)[1]===i[1]).length).join(' · ')}</div>`;
}
Object.assign(BIB_RENDER, { bibMost:renderBibMost, bibRes:renderBibRes, bibBajas:renderBibBajas, bibRetos:renderBibRetos }); BIB_VIEWS.push('bibMost','bibRes','bibBajas','bibRetos');
function bibWire4(){
  const $ = id=>document.getElementById(id), on = (id,fn)=>{ const e = $(id); if(e) e.addEventListener('click',fn); };
  const mi = $('bmIn'); if(mi){ mi.focus(); mi.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); bibMostScan(mi.value); } }); }
  on('bmOtro',()=>{ bibM.lec = null; render(); });
  on('bibReglas',bibReglasModal); on('bibIsbnLote',bibIsbnLoteModal); on('brNueva',bibResModal); on('blProm',bibPromocionModal);
  if($('rtPer')) $('rtPer').onchange = e=>{ bibRt.per = e.target.value; render(); };
  if($('bjAnio')) $('bjAnio').onchange = e=>{ bibBf.anio = e.target.value; render(); };
  const bajasVista = ()=>bibBaj().filter(b=>!bibBf.anio||b.fecha.startsWith(bibBf.anio)).sort((a,b)=>a.fecha.localeCompare(b.fecha));
  on('bjActa',()=>bibActa(bajasVista()));
  on('bjXls',()=>{ const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Fecha','Cód.','Título','Autor','Categoría','Cant.','Motivo','Lector','Grado','Resolución','Observación','Responsable'],...bajasVista().map(b=>[b.fecha,b.cod,b.titulo,b.autor,b.cat,b.cant,b.motivo,b.lector,b.grado,b.resolucion,b.obs,b.responsable])]), 'Bajas'); XLSX.writeFile(wb,'biblioteca-bajas-'+today()+'.xlsx'); });
  document.querySelectorAll('[data-bibbaja]').forEach(b=>b.onclick=()=>bibBajaModal(b.dataset.bibbaja));
  document.querySelectorAll('[data-bibper]').forEach(b=>b.onclick=()=>{ const p = bibPrest().find(x=>x.id===b.dataset.bibper); if(p) bibBajaModal(p.libroId, p.id); });
  document.querySelectorAll('[data-brcan]').forEach(b=>b.onclick=async()=>{ const r = bibRes().find(x=>x.id===b.dataset.brcan); await DB.save(B2.res, bibRes().map(x=>x.id===r.id?{...x,estado:'Cancelada'}:x)); await bibResPromover(r.libroId); render(); });
  document.querySelectorAll('[data-brpre]').forEach(b=>b.onclick=async()=>{ const r = bibRes().find(x=>x.id===b.dataset.brpre), l = bibLibros().find(x=>x.id===r.libroId), lc = bibLect().find(x=>x.id===r.lectorId); if(!l||!lc){ toast('Libro o lector ya no existe.','err'); return; } const e = await bibPrestar(l, lc, lc.nombre, lc.grado); if(e) toast(e,'err'); else toast('Préstamo registrado.','ok'); render(); });
  document.querySelectorAll('[data-brav]').forEach(b=>b.onclick=async()=>{ const r = bibRes().find(x=>x.id===b.dataset.brav), l = bibLibros().find(x=>x.id===r.libroId)||{}; const t = 'Hola '+r.lector+', ya está disponible en la biblioteca el libro "'+l.titulo+'" ('+l.cod+') que reservaste. Lo guardamos hasta el '+r.hasta+'. ¡Te esperamos!'; try{ await navigator.clipboard.writeText(t); toast('Aviso copiado. Pégalo en WhatsApp.','ok'); }catch(e){ prompt('Copia el mensaje:', t); } });
  if(STATE.view==='bibRes' && bibRes().some(r=>r.estado==='Disponible' && r.hasta<today())){ const ids = [...new Set(bibRes().filter(r=>r.estado==='Disponible' && r.hasta<today()).map(r=>r.libroId))]; Promise.all(ids.map(bibResPromover)).then(render); }
}

/* ---- Respaldo de la biblioteca (JSON) e informe por nivel ---- */
const bibKeysTodas = ()=>[...Object.values(BKEYS), B2.cfg, B2.res, B2.baj, ...(typeof B5!=='undefined'?[B5.res]:[]), ...(typeof B6!=='undefined'?Object.values(B6):[]), ...(typeof L7!=='undefined'?Object.values(L7):[]), ...(typeof D7!=='undefined'?Object.values(D7):[])];
function bibRespaldar(){
  const o = { sigieBiblioteca:5, fecha:new Date().toISOString(), datos:{} }; bibKeysTodas().forEach(k=>o.datos[k] = DB.get(k));
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(o)],{type:'application/json'})); a.download = 'biblioteca-respaldo-'+today()+'.json'; a.click();
  DB.save(B2.cfg, { ...(DB.get(B2.cfg)||{}), ultimoRespaldo:today() }).then(()=>toast('Respaldo descargado.','ok'));
}
async function bibRestaurar(file){
  try{
    const o = JSON.parse(await file.text()); if(!o.sigieBiblioteca || !o.datos) throw new Error('No es un respaldo de biblioteca de SIGIE.');
    if(!confirm('Esto REEMPLAZA los libros, préstamos, lectores y demás datos de biblioteca por los del respaldo del '+String(o.fecha).slice(0,10)+'. ¿Continuar?')) return;
    for(const k of bibKeysTodas()) if(o.datos[k]!==undefined && o.datos[k]!==null) await DB.save(k, o.datos[k], { reemplazar:true });
    registrarBitacora('Restauración de biblioteca', String(o.fecha).slice(0,10)); toast('Respaldo restaurado.','ok'); render();
  }catch(e){ toast('No se pudo restaurar: '+e.message,'err'); }
}
function bibNivel(grado, def){ const g = bibNorm(grado); return /INICIAL|\b[345] ANOS/.test(g) ? 'Inicial' : /PRIM/.test(g) ? 'Primaria' : /SEC/.test(g) ? 'Secundaria' : def; }
function bibInformeModal(){
  const cfg = DB.get(KEYS.config)||{}, ie = cfg.nombreIE||'';
  bibModal('Informe de la biblioteca por nivel', `<div class="hint f-12">Resumen para entregar a la UGEL o a dirección. Si el grado no dice el nivel (ej. “3° A”), se asigna el nivel por defecto. Si la UGEL pide un formato propio, este informe sirve de base para llenarlo.</div>
   <div class="field f-4"><label>Año</label><input id="in_a" type="number" value="${new Date().getFullYear()}"></div><div class="field f-4"><label>Nivel por defecto</label><select id="in_n"><option>Secundaria</option><option>Primaria</option><option>Inicial</option></select></div>`,
  bg=>{
    const anio = bibV(bg,'in_a'), def = bibV(bg,'in_n'), ps = bibPrest().filter(p=>String(p.fecha).startsWith(anio)), niv = ['Inicial','Primaria','Secundaria','Docentes / otros'];
    const lect = bibLect().filter(x=>!x.baja), nivDe = (g,t)=>(t&&t!=='Alumno') ? 'Docentes / otros' : bibNivel(g,def);
    const filas = niv.map(n=>{ const ls = lect.filter(x=>nivDe(x.grado,x.tipo)===n), pr = ps.filter(p=>{ const lc = bibLect().find(x=>x.id===p.lectorId); return nivDe(p.grado, lc&&lc.tipo)===n; }), act = new Set(pr.map(p=>p.lectorId||p.lector)).size;
      return [n, ls.length, pr.length, act, ls.length ? (pr.length/ls.length).toFixed(2) : '—', ls.length ? Math.min(100,Math.round(act/ls.length*100))+'%' : '—']; });
    const ej = bibLibros().reduce((a,l)=>a+bibEjemplares(l),0), est = e=>bibLibros().filter(l=>l.estado===e).reduce((a,l)=>a+bibEjemplares(l),0), bj = bibBajVig().filter(b=>b.fecha.startsWith(anio)).reduce((a,b)=>a+b.cant,0);
    const w = window.open('','_blank'); if(!w){ toast('Permite ventanas emergentes para imprimir.','err'); return false; }
    w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Informe de biblioteca ${esc(anio)}</title><style>body{font-family:Arial;font-size:12px;margin:24px;color:#111}h1{font-size:16px;text-align:center;margin:4px}h2{font-size:13px;margin:16px 0 4px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #777;padding:4px 6px;text-align:left}th{background:#e8ecf3}td.n{text-align:right}.f{display:flex;justify-content:space-around;margin-top:70px}.f div{border-top:1px solid #000;padding-top:4px;width:30%;text-align:center}@media print{button{display:none}}</style></head><body><button onclick="window.print()">🖨 Imprimir / Guardar como PDF</button>
    <h1>INFORME ANUAL DE LA BIBLIOTECA ESCOLAR ${esc(anio)}</h1><p style="text-align:center">${esc(ie)}</p>
    <h2>1. Fondo bibliográfico (al ${esc(today())})</h2><table><tr><th>Ejemplares</th><th>Títulos distintos</th><th>Bueno</th><th>Regular</th><th>Malo</th><th>Dados de baja en ${esc(anio)}</th></tr><tr><td class="n">${ej}</td><td class="n">${new Set(bibLibros().map(l=>(l.titulo+'|'+l.autor).toUpperCase())).size}</td><td class="n">${est('Bueno')}</td><td class="n">${est('Regular')}</td><td class="n">${est('Malo')}</td><td class="n">${bj}</td></tr></table>
    <h2>2. Uso por nivel en ${esc(anio)}</h2><table><thead><tr><th>Nivel</th><th>Lectores registrados</th><th>Préstamos</th><th>Lectores que pidieron libros</th><th>Libros por lector</th><th>% de participación</th></tr></thead><tbody>${filas.map(f=>'<tr>'+f.map((c,i)=>`<td class="${i?'n':''}">${esc(c)}</td>`).join('')+'</tr>').join('')}<tr><td><b>TOTAL</b></td><td class="n"><b>${lect.length}</b></td><td class="n"><b>${ps.length}</b></td><td class="n"><b>${new Set(ps.map(p=>p.lectorId||p.lector)).size}</b></td><td></td><td></td></tr></tbody></table>
    <h2>3. Libros más prestados</h2><table><tr><th>#</th><th>Título</th><th>Veces</th></tr>${(()=>{ const m = new Map(); ps.forEach(p=>{ const l = bibLibros().find(x=>x.id===p.libroId); if(l) m.set(l.titulo,(m.get(l.titulo)||0)+1); }); return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x[0])}</td><td class="n">${x[1]}</td></tr>`).join('')||'<tr><td colspan="3">Sin préstamos.</td></tr>'; })()}</table>
    <div class="f"><div>Responsable de biblioteca</div><div>Director(a)</div></div></body></html>`); w.document.close();
  }, 'Generar informe');
}
(()=>{ const ow = bibWire4; bibWire4 = function(){ ow(); const $ = id=>document.getElementById(id);
  if($('bibResp')) $('bibResp').onclick = bibRespaldar; if($('bibInf')) $('bibInf').onclick = bibInformeModal;
  if($('bibRest')) $('bibRest').onclick = ()=>$('bibRestF').click(); if($('bibRestF')) $('bibRestF').onchange = e=>e.target.files[0] && bibRestaurar(e.target.files[0]); }; })();

/* ---- Alta masiva por lista de ISBN ---- */
function bibIsbnLoteModal(){
  if(!guardEdit()) return;
  const bg = bibModal('Importar libros por lista de ISBN', `<div class="hint f-12">Pega o escanea un ISBN por línea (uno repetido suma ejemplares; uno ya registrado suma 1 a su cantidad). Busca título, autor y editorial en Open Library / Google Books; requiere internet. Los no encontrados se te listan para completarlos a mano.</div>
   <div class="field f-6"><label>Categoría</label><select id="il_cat">${bibCats().map(c=>`<option value="${c.id}">${esc(c.nombre)} (${esc(c.prefijo)})</option>`).join('')}</select></div><div class="field f-3"><label>Estante</label><input id="il_ubi"></div><div class="field f-3"><label>Estado</label><select id="il_est">${BIB_ESTADOS.map(e=>`<option>${e}</option>`).join('')}</select></div>
   <div class="field f-12"><textarea id="il_txt" rows="8" style="width:100%" placeholder="9788437604947&#10;9788420412146"></textarea></div><div class="hint f-12" id="il_msg"></div>`,
  async bg=>{
    const cat = bibCat(bibV(bg,'il_cat')), msg = bg.querySelector('#il_msg'), btn = bg.querySelector('#bmS'); if(!cat){ toast('Elige una categoría.','err'); return false; }
    const cuenta = new Map(); bibV(bg,'il_txt').split(/[\s,;]+/).map(x=>x.replace(/[^0-9Xx]/g,'').toUpperCase()).filter(x=>x.length===10||x.length===13).forEach(x=>cuenta.set(x,(cuenta.get(x)||0)+1));
    if(!cuenta.size){ toast('No hay ISBN válidos (10 o 13 dígitos).','err'); return false; }
    btn.disabled = true; let libros = [...bibLibros()], nuevos = 0, sumados = 0, noEnc = []; const norm = s=>String(s||'').replace(/[^0-9Xx]/g,'').toUpperCase(); let i = 0;
    for(const [isbn,n] of cuenta){
      msg.textContent = 'Procesando '+(++i)+' de '+cuenta.size+'…'; const ya = libros.find(l=>norm(l.isbn)===isbn);
      if(ya){ ya.cant = bibEjemplares(ya)+n; sumados += n; continue; }
      let d = null; try{ d = await bibBuscarISBN(isbn); }catch(e){}
      if(!d){ noEnc.push(isbn); continue; }
      let m = 0; libros.filter(l=>l.catId===cat.id).forEach(l=>{ const x = String(l.cod).match(/(\d+)\s*$/); if(x) m = Math.max(m,+x[1]); });
      libros.push({ id:uid('lib'), cod:cat.prefijo+'-'+String(m+1).padStart(3,'0'), catId:cat.id, titulo:d.titulo.toUpperCase(), autor:(d.autor||'').toUpperCase(), dewey:'', cant:n, estado:bibV(bg,'il_est'), isbn, editorial:(d.editorial||'').toUpperCase(), obs:'', ubi:bibV(bg,'il_ubi') }); nuevos++;
    }
    await DB.save(BKEYS.libros, libros); registrarBitacora('Alta por ISBN', nuevos+' nuevos, '+sumados+' ejemplares sumados'); btn.disabled = false;
    if(noEnc.length) prompt('No se encontraron '+noEnc.length+' ISBN. Cópialos para registrarlos a mano:', noEnc.join('\n'));
    toast(nuevos+' libro(s) nuevo(s), '+sumados+' ejemplar(es) sumado(s)'+(noEnc.length?', '+noEnc.length+' sin datos':'')+'.','ok'); render();
  }, 'Importar');
}

/* ---- Ficha de Levantamiento de Información (formato UGEL) para los libros ---- */
function bibFichaItems(catId, porEj){
  const out = [];
  bibLibros().filter(l=>!catId || l.catId===catId).forEach(l=>{ const n = porEj ? bibEjemplares(l) : 1;
    for(let i=0;i<n;i++) out.push({ ubi:String(l.ubi||'').trim()||'Sin estante', it:{ codigoInterno:l.cod, codigoAnioAnterior:'S/C', denominacion:(l.titulo||'')+(!porEj&&bibEjemplares(l)>1?' (x'+bibEjemplares(l)+')':''), marca:l.editorial||'', modelo:l.isbn||'', numeroSerie:l.autor||'', color:'', estadoConservacion:l.estado } }); });
  return out.sort((a,b)=>a.ubi.localeCompare(b.ubi,'es',{numeric:true}) || bibNatural({cod:a.it.codigoInterno},{cod:b.it.codigoInterno}));
}
function bibFichaModal(){
  const cfg = DB.get(KEYS.config)||{};
  const bg = bibModal('Ficha de levantamiento (formato UGEL)', `<div class="hint f-12">Genera el formato oficial “Ficha de Levantamiento de Información” (20 filas por hoja, una hoja por estante o más) con los libros. Cód. Patrimonial = código del libro; Marca = editorial; Modelo = ISBN; Serie/Dim. = autor.</div>
   <div class="field f-6"><label>Categoría</label><select id="fl_cat"><option value="">Todas</option>${bibCats().map(c=>`<option value="${c.id}">${esc(c.nombre)} (${esc(c.prefijo)})</option>`).join('')}</select></div>
   <div class="field f-6"><label>Usuario responsable</label><input id="fl_resp" value="${esc(cfg.bibliotecario||'')}" placeholder="Encargado de biblioteca"></div>
   <div class="field f-12"><label><input type="checkbox" id="fl_ej" checked> Una fila por ejemplar (si un libro tiene 3 copias, salen 3 filas)</label></div>
   <div class="field f-12"><button class="btn" id="fl_xls">⇩ Descargar en Excel (mismas columnas)</button></div>`, async bg=>{
    const its = bibFichaItems(bibV(bg,'fl_cat'), bg.querySelector('#fl_ej').checked); if(!its.length){ toast('No hay libros para la ficha.','err'); return false; }
    const ubis = [...new Set(its.map(x=>x.ubi))], bloques = ubis.map(u=>({ u, g:paginar(its.filter(x=>x.ubi===u).map(x=>x.it), 20) })), total = bloques.reduce((a,b)=>a+b.g.length,0); let n = 0;
    const html = bloques.map(b=>b.g.map(g=>{ n++; return fichaBienesHTML(cfg, g, n, 'Biblioteca · Estante '+b.u, bibV(bg,'fl_resp'), n===total); }).join('')).join('');
    abrirVentanaImpresion('Ficha de levantamiento — biblioteca', html, 'landscape');
  }, 'Generar fichas (PDF)', '720px');
  bg.querySelector('#fl_xls').onclick = ()=>{ const its = bibFichaItems(bibV(bg,'fl_cat'), bg.querySelector('#fl_ej').checked), ab = ESTADO_ABREV;
    const aoa = [['N°','Cód. Patrimonial','Código Anterior','Denominación','Marca','Modelo','Serie/Dim.','Color','Estado','Observaciones','Ubicación / Área'], ...its.map((x,i)=>[i+1,x.it.codigoInterno,'S/C',x.it.denominacion,x.it.marca,x.it.modelo,x.it.numeroSerie,'',ab[x.it.estadoConservacion]||'','','Biblioteca · Estante '+x.ubi])];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Ficha biblioteca'); XLSX.writeFile(wb,'biblioteca-ficha-ugel-'+today()+'.xlsx'); };
}
(()=>{ const ow = bibWire4; bibWire4 = function(){ ow(); const e = document.getElementById('bibFicha'); if(e) e.onclick = bibFichaModal; }; })();

/* =====================================================================
   REPORTES Y EXPORTACIÓN de biblioteca (equivalente al módulo del inventario patrimonial)
   ===================================================================== */
BIB_TITULOS2.bibRepExp = ['Reportes y exportación','Informes oficiales, relaciones y exportaciones de la biblioteca'];
function bibRepData(id){
  const L = bibLibros(), lib = new Map(L.map(l=>[l.id,l])), cat = l=>(bibCat(l.catId)||{}).nombre||'', P = bibPrest(), hoy = today(), ab = e=>ESTADO_ABREV[e]||e||'', st = bibStats();
  const ubi = l=>String(l.ubi||'').trim()||'Sin estante', porUbi = (a,b)=>ubi(a).localeCompare(ubi(b),'es',{numeric:true})||bibNatural(a,b), act = P.filter(p=>!p.devuelto);
  const usos = new Map(); P.forEach(p=>usos.set(p.libroId,(usos.get(p.libroId)||0)+1));
  switch(id){
    case 'inv': return { t:'Inventario completo de la biblioteca', sub:'Catálogo con ejemplares, estado y ubicación', f:'biblioteca_inventario', cols:['Cód.','Dewey','Categoría','Título','Autor','Editorial','ISBN','Cant.','Disp.','Estado','Estante','Observación'],
      rows:[...L].sort((a,b)=>(st.cats.findIndex(c=>c.id===a.catId)-st.cats.findIndex(c=>c.id===b.catId))||bibNatural(a,b)).map(l=>[l.cod,l.dewey,cat(l),l.titulo,l.autor,l.editorial,l.isbn,bibEjemplares(l),bibEjemplares(l)-bibPrestados(l.id),ab(l.estado),l.ubi,l.obs]) };
    case 'estante': { const tomas = DB.get(BKEYS.tomas)||[]; return { t:'Relación de libros por estante', sub:'Listado agrupado para la verificación física', f:'biblioteca_por_estante', cols:['Estante','Cód.','Título','Cant.','Estado','Última toma'],
      rows:[...L].sort(porUbi).map(l=>{ const t = tomas.filter(x=>String(x.ubi)===String(l.ubi||'').trim()).sort((a,b)=>b.fecha.localeCompare(a.fecha))[0]; return [ubi(l),l.cod,l.titulo,bibEjemplares(l),ab(l.estado),t?t.fecha:'Sin verificar']; }) }; }
    case 'kardex': { const r = []; P.forEach(p=>{ const l = lib.get(p.libroId)||{}; r.push([p.fecha,'Préstamo',l.cod||'',l.titulo||'',p.lector+(p.grado?' · '+p.grado:'')+' (vence '+p.vence+')']); if(p.devuelto) r.push([p.devuelto,p.perdido?'Pérdida':'Devolución',l.cod||'',l.titulo||'',p.lector]); });
      bibBajVig().forEach(b=>r.push([b.fecha,'Baja · '+b.motivo,b.cod,b.titulo,'x'+b.cant+(b.lector?' · '+b.lector:'')])); bibBaj().filter(b=>b.revertida).forEach(b=>{ r.push([b.fecha,'Baja · '+b.motivo,b.cod,b.titulo,'x'+b.cant+(b.lector?' · '+b.lector:'')]); r.push([b.revertida.fecha,'Reingreso · '+b.revertida.motivo,b.cod,b.titulo,'x'+b.cant]); }); (DB.get(BKEYS.tomas)||[]).forEach(t=>r.push([t.fecha,'Toma de estante','','Estante '+t.ubi,t.verificados+'/'+t.total+' verificados, '+t.faltantes.length+' faltantes']));
      return { t:'Kardex de movimientos de la biblioteca', sub:'Préstamos, devoluciones, pérdidas, bajas y tomas de inventario', f:'biblioteca_kardex', cols:['Fecha','Tipo','Cód.','Título / detalle','Lector / resultado'], rows:r.sort((a,b)=>String(b[0]).localeCompare(String(a[0]))) }; }
    case 'tomas': return { t:'Registro de inventarios por estante', sub:'Historial de tomas físicas: verificados, faltantes y libros de otro estante', f:'biblioteca_tomas', cols:['Fecha','Estante','Responsable','Verificados','Total','Faltantes','De otro estante'],
      rows:[...(DB.get(BKEYS.tomas)||[])].sort((a,b)=>b.fecha.localeCompare(a.fecha)).map(t=>[t.fecha,t.ubi,t.responsable,t.verificados,t.total,(t.faltantes||[]).join(', '),(t.sobrantes||[]).join(', ')]) };
    case 'lector': return { t:'Libros en poder de cada lector', sub:'Préstamos vigentes agrupados por lector (responsable del libro)', f:'biblioteca_por_lector', cols:['Lector','Grado / sección','Cód.','Título','Prestado','Vence','Situación'],
      rows:[...act].sort((a,b)=>String(a.lector).localeCompare(String(b.lector),'es')).map(p=>{ const l = lib.get(p.libroId)||{}; return [p.lector,p.grado,l.cod||'',l.titulo||'',p.fecha,p.vence,bibVencido(p)?'Vencido ('+bibDias(p.vence,hoy)+' d)':'En plazo']; }) };
    case 'uso': return { t:'Libros por uso (más prestados)', sub:'Ordenado de mayor a menor número de préstamos, con rotación por ejemplar', f:'biblioteca_por_uso', cols:['Cód.','Título','Categoría','Ejemplares','Préstamos','Rotación'],
      rows:[...L].sort((a,b)=>(usos.get(b.id)||0)-(usos.get(a.id)||0)||bibNatural(a,b)).map(l=>[l.cod,l.titulo,cat(l),bibEjemplares(l),usos.get(l.id)||0,((usos.get(l.id)||0)/bibEjemplares(l)).toFixed(2)]) };
    case 'antig': return { t:'Préstamos pendientes por antigüedad', sub:'De más antiguo a más reciente, según la fecha de préstamo', f:'biblioteca_pendientes_antiguedad', cols:['Prestado','Días fuera','Lector','Grado / sección','Cód.','Título','Vence'],
      rows:[...act].sort((a,b)=>String(a.fecha).localeCompare(String(b.fecha))).map(p=>{ const l = lib.get(p.libroId)||{}; return [p.fecha,bibDias(p.fecha,hoy),p.lector,p.grado,l.cod||'',l.titulo||'',p.vence]; }) };
    case 'conserv': return { t:'Conservación y reposición', sub:'Libros en estado Regular o Malo para reparar, forrar o reponer', f:'biblioteca_conservacion', cols:['Cód.','Título','Categoría','Cant.','Estado','Estante','Observación'],
      rows:L.filter(l=>l.estado==='Malo'||l.estado==='Regular').sort((a,b)=>(a.estado==='Malo'?0:1)-(b.estado==='Malo'?0:1)||bibNatural(a,b)).map(l=>[l.cod,l.titulo,cat(l),bibEjemplares(l),ab(l.estado),l.ubi,l.obs]) };
    case 'catalogo': return { t:'Catálogo codificado', sub:'Columnas equivalentes a las del inventario del Estado: estado MB/B/R/M, ubicación y categoría', f:'biblioteca_catalogo_codificado', cols:['Código','Prefijo','Categoría','Dewey','Título','Autor','Editorial','ISBN','Cantidad','Estado','Estante'],
      rows:[...L].sort(bibNatural).map(l=>[l.cod,(bibCat(l.catId)||{}).prefijo||'',cat(l),l.dewey,l.titulo,l.autor,l.editorial,l.isbn,bibEjemplares(l),ab(l.estado),l.ubi]) };
    case 'cotejo': { const bj = new Map(); bibBajVig().forEach(b=>{ const l = lib.get(b.libroId), c = l?l.catId:(bibCats().find(x=>x.nombre===b.cat)||{}).id; if(c) bj.set(c,(bj.get(c)||0)+b.cant); });
      return { t:'Cotejo con la cartelera lectora', sub:'Total declarado vs. ejemplares registrados por categoría', f:'biblioteca_cotejo_cartelera', cols:['Categoría','Prefijo','Declarado','Registrado','Diferencia','Bajas','Situación'],
      rows:st.porCat.map(x=>[x.c.nombre,x.c.prefijo,x.decl,x.ej,x.dif,bj.get(x.c.id)||0,x.dif===0?'Conforme':x.dif<0?'Faltan '+(-x.dif):'Sobran '+x.dif]).concat([['TOTAL GENERAL','',st.totalDecl,st.totalEj,st.totalEj-st.totalDecl,bibBaj().reduce((a,b)=>a+b.cant,0),'']]) }; }
  }
}
function bibRepPDF(id){ const d = bibRepData(id); if(!d.rows.length){ toast('No hay datos para este reporte.','err'); return; }
  const heads = [{key:'n',label:'N°'},...d.cols.map((c,i)=>({key:'c'+i,label:c}))], rows = d.rows.map((r,i)=>{ const o = {n:i+1}; r.forEach((v,j)=>o['c'+j]=v); return o; });
  abrirVentanaImpresion(d.t, construirReportePaginadoHTML(d.t, d.sub, heads, rows, 20), 'landscape'); }
function bibRepCSV(id){ const d = bibRepData(id); if(!d.rows.length){ toast('No hay datos para este reporte.','err'); return; }
  downloadFile(d.f+'.csv', '\uFEFF'+d.cols.map(csvEscape).join(',')+'\n'+d.rows.map(r=>r.map(csvEscape).join(',')).join('\n'), 'text/csv;charset=utf-8;'); }
function bibRepXLSX(id){ const d = bibRepData(id); if(!d.rows.length){ toast('No hay datos para este reporte.','err'); return; }
  const ws = XLSX.utils.aoa_to_sheet([['N°',...d.cols],...d.rows.map((r,i)=>[i+1,...r])]); ws['!cols'] = [{wch:5},...d.cols.map(()=>({wch:18}))]; const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Biblioteca'); XLSX.writeFile(wb, d.f+'.xlsx'); }
function bibAlertasTexto(){
  const st = bibStats(), cfg = DB.get(KEYS.config)||{}, listas = bibRes().filter(r=>r.estado==='Disponible').length, esperas = bibRes().filter(r=>r.estado==='Espera').length, u = (DB.get(B2.cfg)||{}).ultimoRespaldo;
  const sin = st.porUbi.filter(x=>!x.toma||x.diasToma>90).length, bajas = new Set(bibLect().filter(x=>x.baja).map(x=>x.id)), egr = bibPrest().filter(p=>!p.devuelto && bajas.has(p.lectorId)).length;
  return ['RESUMEN DE ALERTAS DE BIBLIOTECA — '+(cfg.nombreIE||'')+' — '+today(), '',
   '• Préstamos vencidos: '+st.vencidos.length+(st.vencidos.length?' (el más atrasado: '+st.vencidos[0].atraso+' días, '+st.vencidos[0].p.lector+')':''),
   '• Libros prestados ahora: '+st.activos, '• Reservas listas para recoger: '+listas+' · en lista de espera: '+esperas,
   '• Estantes sin verificar o con toma de más de 90 días: '+sin+' de '+st.porUbi.length, '• Libros en estado Malo: '+st.malos.length, '• Alumnos sin leer hace más de '+(bibCfg().diasInactivo||30)+' días: '+(typeof bibInactN==='function'?bibInactN():0),
   '• Libros en manos de lectores dados de baja (egresados): '+egr, '• Último respaldo de la biblioteca: '+(u||'nunca')].join('\n');
}
function bibActaTomaModal(){
  if(!guardEdit()) return; const cfg = DB.get(KEYS.config)||{};
  bibModal('Acta de toma de inventario físico (biblioteca)', `<div class="field f-4"><label>Fecha</label><input id="at_f" type="date" value="${today()}"></div><div class="field f-3"><label>Hora</label><input id="at_h" placeholder="08:00"></div><div class="field f-5"><label>Lugar</label><input id="at_l" value="Biblioteca"></div>
   <div class="field f-12"><label>Comisión (una persona por línea: Nombre — Cargo)</label><textarea id="at_c" rows="4" style="width:100%" placeholder="Nombre Apellido — Presidente&#10;Nombre Apellido — Encargado de biblioteca&#10;Nombre Apellido — Miembro"></textarea></div><div class="field f-12"><label>Observaciones</label><input id="at_o"></div>`,
  bg=>{ const st = bibStats(), com = bibV(bg,'at_c').split('\n').map(x=>x.trim()).filter(Boolean), tomados = st.porUbi.filter(u=>u.toma), ver = tomados.reduce((a,u)=>a+u.toma.verificados,0), tot = tomados.reduce((a,u)=>a+u.toma.total,0), falt = tomados.reduce((a,u)=>a+(u.toma.faltantes||[]).length,0), est = e=>st.porCat.reduce((a,x)=>a+x[e],0);
    const html = `<div style="font-size:13px;line-height:1.5"><h2 style="font-size:15px !important">ACTA DE TOMA DE INVENTARIO FÍSICO DE LA BIBLIOTECA</h2><h3 style="font-size:12px !important">${esc(cfg.nombreIE||'')}</h3>
     <p>En ${esc(bibV(bg,'at_l'))}, el ${esc(bibV(bg,'at_f'))}${bibV(bg,'at_h')?' a las '+esc(bibV(bg,'at_h')):''}, la comisión integrada por ${com.length?com.map(esc).join('; '):'_______________________'} realizó la verificación física de los materiales bibliográficos, con el siguiente resultado:</p>
     <table><tr><th>Ejemplares registrados</th><th>Declarado en cartelera</th><th>Estantes verificados</th><th>Libros verificados</th><th>Faltantes detectados</th></tr><tr><td>${st.totalEj}</td><td>${st.totalDecl}</td><td>${tomados.length} de ${st.porUbi.length}</td><td>${ver} de ${tot}</td><td>${falt}</td></tr></table>
     <table><tr><th>Estado Bueno</th><th>Estado Regular</th><th>Estado Malo</th><th>Prestados</th><th>Dados de baja (acumulado)</th></tr><tr><td>${est('bueno')}</td><td>${est('regular')}</td><td>${est('malo')}</td><td>${st.activos}</td><td>${bibBaj().reduce((a,b)=>a+b.cant,0)}</td></tr></table>
     <table><tr><th>Estante</th><th>Fecha de toma</th><th>Verificados</th><th>Faltantes</th></tr>${tomados.map(u=>`<tr><td>${esc(u.ubi)}</td><td>${esc(u.toma.fecha)}</td><td>${u.toma.verificados}/${u.toma.total}</td><td>${esc((u.toma.faltantes||[]).join(', ')||'—')}</td></tr>`).join('')||'<tr><td colspan="4">Sin tomas registradas.</td></tr>'}</table>
     <p>Observaciones: ${esc(bibV(bg,'at_o'))||'Ninguna.'}</p><p>Siendo conforme, firman:</p><div style="display:flex;flex-wrap:wrap;gap:40px 6%;margin-top:70px">${(com.length?com:['','','']).map(c=>`<div style="border-top:1px solid #000;width:28%;text-align:center;padding-top:4px;font-size:12px">${esc(c)}</div>`).join('')}</div></div>`;
    abrirVentanaImpresion('Acta de toma de inventario físico — biblioteca', html); }, 'Generar acta');
}
const BIB_RX = [
 ['Inventario completo','Ficha de Levantamiento de Información oficial (20 filas por hoja, por estante) para presentar a la UGEL, más el catálogo completo.',[['PDF oficial UGEL (20/hoja)','f:ficha',1],['CSV','csv:inv'],['Excel (.xlsx)','xls:inv']]],
 ['Relación por estante','Listado agrupado por estante para la verificación física.',[['PDF (20/hoja)','pdf:estante',1],['CSV','csv:estante']]],
 ['Kardex de movimientos','Préstamos, devoluciones, pérdidas, bajas y tomas de inventario.',[['PDF (20/hoja)','pdf:kardex',1],['CSV','csv:kardex']]],
 ['Registro de inventarios por estante','Historial de tomas físicas: verificados, faltantes y libros de otro estante.',[['PDF (20/hoja)','pdf:tomas',1],['CSV','csv:tomas']]],
 ['Libros por lector','Préstamos vigentes agrupados por la persona que tiene el libro.',[['PDF (20/hoja)','pdf:lector',1],['CSV','csv:lector']]],
 ['Libros por uso','Ordenado de más a menos prestado, con rotación por ejemplar (equivale a “por monto”).',[['PDF (20/hoja)','pdf:uso',1],['CSV','csv:uso']]],
 ['Pendientes por antigüedad','Préstamos sin devolver, del más antiguo al más reciente.',[['PDF (20/hoja)','pdf:antig',1],['CSV','csv:antig']]],
 ['Conservación y reposición','Libros en estado Regular o Malo para reparar o reponer (reemplaza a la depreciación).',[['PDF (20/hoja)','pdf:conserv',1],['CSV','csv:conserv']]],
 ['Acta de toma de inventario físico','Documento formal con comisión, fecha, lugar y resumen consolidado del inventario de la biblioteca.',[['Generar acta (PDF)','f:acta',1]]],
 ['Informe de bajas','Libros perdidos, dañados o retirados, con acta de baja imprimible. Se registran en “Bajas y pérdidas”.',[['Acta de baja (PDF)','f:bajas',1],['Ir a Bajas y pérdidas','f:irbajas']]],
 ['Resumen semanal de alertas','Vencidos, reservas listas, estantes sin verificar, libros en mal estado y respaldo, en un solo texto.',[['Enviar por correo','f:mail',1],['Copiar texto','f:copiar']]],
 ['Catálogo codificado (tipo SBN)','CSV con estado MB/B/R/M, categoría y ubicación, para trasladar los datos a otro sistema.',[['Descargar CSV','csv:catalogo',1]]],
 ['Cotejo con la cartelera lectora','Declarado vs. registrado por categoría, con bajas y situación (equivale a la conciliación).',[['PDF (20/hoja)','pdf:cotejo',1],['CSV','csv:cotejo'],['Acta resumen (TXT)','f:cotejotxt']]],
 ['Informe anual por nivel','Resumen para Director/UGEL: fondo, bajas, uso por nivel y libros más prestados.',[['Generar informe (PDF)','f:informe',1]]],
 ['Respaldo de la biblioteca','Descarga o restaura todos los datos de biblioteca en un JSON.',[['Descargar respaldo (.json)','f:resp',1],['Restaurar respaldo','f:rest']]]
];
function renderBibRepExp(){
  const btn = (l,k,p)=>`<button class="btn ${p?'btn-primary ':''}btn-sm" data-rx="${k}" ${k==='f:rest'&&!isAdmin()?'disabled':''}>${l}</button>`;
  return `<div class="grid g3 noprint">${BIB_RX.map(c=>`<div class="card"><div class="card-b"><h3 style="font-size:15px;">${c[0]}</h3><p class="hint">${c[1]}</p>${c[2].map(a=>btn(a[0],a[1],a[2])).join(' ')}</div></div>`).join('')}</div>
  <input type="file" id="rxRestF" accept=".json" style="display:none"><div class="hint noprint" style="margin-top:10px;">${bibLibros().length} registros · ${bibLibros().reduce((a,l)=>a+bibEjemplares(l),0)} ejemplares en la biblioteca.</div>`;
}
function bibRxClick(k){
  const [t,id] = k.split(':');
  if(t==='pdf') return bibRepPDF(id); if(t==='csv') return bibRepCSV(id); if(t==='xls') return bibRepXLSX(id);
  const fn = { ficha:bibFichaModal, acta:bibActaTomaModal, informe:bibInformeModal, resp:bibRespaldar, rest:()=>document.getElementById('rxRestF').click(),
    bajas:()=>bibActa(bibBajVig().sort((a,b)=>a.fecha.localeCompare(b.fecha))), irbajas:()=>{ STATE.view='bibBajas'; render(); },
    copiar:async()=>{ try{ await navigator.clipboard.writeText(bibAlertasTexto()); toast('Texto copiado.','ok'); }catch(e){ prompt('Copia el texto:', bibAlertasTexto()); } },
    mail:()=>{ const t = bibAlertasTexto(); window.location.href = 'mailto:?subject='+encodeURIComponent('Resumen de alertas de biblioteca '+today())+'&body='+encodeURIComponent(t); },
    cotejotxt:()=>{ const d = bibRepData('cotejo'), cfg = DB.get(KEYS.config)||{}; downloadFile('acta_cotejo_cartelera_'+today()+'.txt', 'ACTA RESUMEN DE COTEJO CON LA CARTELERA LECTORA\n'+(cfg.nombreIE||'')+' — '+today()+'\n\n'+d.rows.map(r=>r[0]+': declarado '+r[2]+', registrado '+r[3]+', diferencia '+r[4]+', bajas '+r[5]+' → '+r[6]).join('\n')+'\n\nFirmas: ____________________   ____________________\n','text/plain;charset=utf-8;'); } }[id];
  if(fn) fn();
}
Object.assign(BIB_RENDER, { bibRepExp:renderBibRepExp }); BIB_VIEWS.push('bibRepExp');
(()=>{ const ow = bibWire4; bibWire4 = function(){ ow(); document.querySelectorAll('[data-rx]').forEach(b=>b.onclick=()=>bibRxClick(b.dataset.rx)); const f = document.getElementById('rxRestF'); if(f) f.onchange = e=>e.target.files[0] && bibRestaurar(e.target.files[0]); }; })();


/* ======================= (antes biblioteca3.js) ======================= */
/* =========================================================================
   SIGIE Biblioteca v7 — Inicio (panel del día), Revisión de datos y
   renovaciones con reglas.
   Va después del bloque anterior y antes de ejemplo.js / app.js.
   ========================================================================= */
const BIB_TITULOS3 = {
  bibInicio:['Inicio','Resumen de la biblioteca: lo de hoy y lo que requiere atención'],
  bibSalud:['Revisión de datos','Detecta datos inconsistentes (libros duplicados, préstamos sin libro, etc.) y los corrige']
};

/* ---------- Renovaciones con reglas ---------- */
// Reglas: máximo de renovaciones por préstamo (Reglas de préstamo) y no renovar si hay otros
// lectores esperando ese libro. La renovación suma el plazo del tipo de lector (Alumno 7, Docente 15…).
async function bibRenovar(id){
  const p = bibPrest().find(x=>x.id===id); if(!p || p.devuelto) return false;
  const c = bibCfg(), usadas = p.renov||0;
  if(usadas >= c.maxRenov){ toast('Este préstamo ya se renovó '+usadas+' vez/veces (máximo '+c.maxRenov+'). El lector debe devolver el libro.','err'); return false; }
  const espera = bibRes().filter(r=>r.libroId===p.libroId && r.estado==='Espera' && r.lectorId!==p.lectorId);
  if(espera.length){ toast('No se puede renovar: '+espera.length+' lector(es) esperan este libro ('+espera[0].lector+').','err'); return false; }
  const lec = bibLect().find(x=>x.id===p.lectorId), dias = (c[(lec&&lec.tipo)||'Alumno']||c.Alumno).dias;
  const base = p.vence && p.vence>today() ? p.vence : today();
  const nueva = fechaLocalISO(new Date(new Date(base+'T12:00:00').getTime()+dias*864e5));
  await DB.save(BKEYS.prest, bibPrest().map(x=>x.id===id ? {...x, vence:nueva, renov:usadas+1} : x));
  registrarBitacora('Renovación de préstamo', id+' → '+nueva+' ('+(usadas+1)+'/'+c.maxRenov+')');
  toast('Renovado hasta el '+nueva+' ('+(usadas+1)+' de '+c.maxRenov+' renovaciones).','ok');
  return true;
}

/* ---------- Inicio ---------- */
function bibDiasDesdeRespaldo(){ const u = bibCfg().ultimoRespaldo; return u ? bibDias(u, today()) : null; }
function renderBibInicio(){
  const s = bibStats(), cfg = DB.get(KEYS.config)||{}, hoy = today(), pres = bibPrest(), res = bibRes();
  const prestHoy = pres.filter(p=>p.fecha===hoy).length, devHoy = pres.filter(p=>p.devuelto===hoy && !p.perdido).length;
  const listas = res.filter(r=>r.estado==='Disponible'), espera = res.filter(r=>r.estado==='Espera');
  const lectActivos = bibLect().filter(x=>!x.baja).length, disp = s.totalEj - s.activos;
  const dResp = bibDiasDesdeRespaldo(), sinVerif = s.porUbi.filter(x=>!x.toma || x.diasToma>90).length;
  const kpi = (lbl,val,sub,alerta)=>`<div class="card"><div class="kpi"><div class="lbl">${lbl}</div><div class="val" ${alerta?'style="color:var(--bad,#b3261e)"':''}>${val}</div>${sub?`<div class="delta">${sub}</div>`:''}</div></div>`;
  const aviso = (ic,txt,ir,btn)=>`<li style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--line,#e6e9ef);"><span>${ic}</span><span style="flex:1">${txt}</span>${ir?`<button class="btn btn-sm" data-bigo="${ir}">${btn||'Ver'}</button>`:''}</li>`;
  const avisos = [];
  if(s.vencidos.length) avisos.push(aviso('⏰','<b>'+s.vencidos.length+'</b> préstamo(s) vencido(s). El más atrasado: '+s.vencidos[0].atraso+' día(s) ('+esc(s.vencidos[0].p.lector)+').','bibPrest','Reclamar'));
  if(listas.length) avisos.push(aviso('🔖','<b>'+listas.length+'</b> reserva(s) lista(s) para recoger: avisa a los lectores.','bibRes','Avisar'));
  if(espera.length) avisos.push(aviso('⏳','<b>'+espera.length+'</b> lector(es) en lista de espera.','bibRes'));
  if(dResp===null || dResp>14) avisos.push(`<li style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--line,#e6e9ef);"><span>💾</span><span style="flex:1">${dResp===null?'Todavía no has descargado un respaldo de la biblioteca.':'Último respaldo hace <b>'+dResp+'</b> días.'}</span><button class="btn btn-sm btn-primary" id="biBackup">Respaldar ahora</button></li>`);
  if(sinVerif) avisos.push(aviso('☑','<b>'+sinVerif+'</b> de '+s.porUbi.length+' estante(s) sin verificar o con inventario de más de 90 días.','bibToma','Verificar'));
  const nIn = typeof bibInactN==='function' ? bibInactN() : 0;
  if(nIn) avisos.push(aviso('💤','<b>'+nIn+'</b> alumno(s) sin leer hace más de '+(bibCfg().diasInactivo||30)+' días.','bibInact','Ver aulas'));
  const nLa = typeof bibLecturasAtrasadasN==='function' ? bibLecturasAtrasadasN() : 0;
  if(nLa) avisos.push(aviso('📖','<b>'+nLa+'</b> alumno(s) con una lectura asignada atrasada.','bibLecturas','Ver lecturas'));
  if(s.malos.length) avisos.push(aviso('🩹','<b>'+s.malos.length+'</b> libro(s) en mal estado para reparar o reponer.','bibRepExp','Reporte'));
  const nProb = isAdmin() && typeof bibSaludProblemas==='function' ? bibSaludProblemas() : 0;
  if(nProb) avisos.push(aviso('🩺','La revisión de datos encontró <b>'+nProb+'</b> punto(s) por corregir.','bibSalud','Revisar'));
  const venc = s.vencidos.slice(0,6);
  const meses = s.meses, maxM = Math.max(1, ...meses.map(m=>Math.max(m.prestados,m.devueltos)));
  const desde30 = fechaLocalISO(new Date(Date.now()-30*864e5)), lib = new Map(bibLibros().map(l=>[l.id,l])), cuenta = new Map();
  pres.filter(p=>p.fecha>=desde30).forEach(p=>{ const t=(lib.get(p.libroId)||{}).titulo; if(t) cuenta.set(t,(cuenta.get(t)||0)+1); });
  const top = [...cuenta.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
  const go = (id,ic,t)=>`<button class="btn" data-bigo="${id}">${ic} ${t}</button>`;
  return `<div class="hint" style="margin-bottom:12px;">${esc(cfg.nombreIE||'')} · ${esc(new Date().toLocaleDateString('es-PE',{weekday:'long',day:'numeric',month:'long',year:'numeric'}))}</div>
  <div class="toolbar noprint">${go('bibMost','⌨','Mostrador (escáner)')}${go('bibPrest','⇄','Préstamos')}${go('bibRes','🔖','Reservas')}${go('bibLect','🪪','Lectores')}${go('bibLibros','📚','Catálogo')}${go('bibToma','☑','Inventario por estante')}</div>
  <div class="grid g4">${kpi('Ejemplares en la biblioteca',s.totalEj,s.libros.length+' registros en el catálogo')}${kpi('Prestados ahora',s.activos,disp+' disponibles')}${kpi('Préstamos vencidos',s.vencidos.length,s.vencidos.length?'Requieren reclamo':'Todo al día',s.vencidos.length>0)}${kpi('Reservas listas',listas.length,espera.length+' en lista de espera')}</div>
  <div class="grid g4" style="margin-top:12px;">${kpi('Prestados hoy',prestHoy)}${kpi('Devueltos hoy',devHoy)}${kpi('Lectores activos',lectActivos)}${kpi('Tiempo promedio de préstamo',s.prom?s.prom.toFixed(1)+' días':'—','Desde que sale hasta que se devuelve')}</div>
  <div class="grid g2" style="margin-top:16px;">
    <div class="card"><div class="card-b"><h3 style="font-size:15px;margin-bottom:6px;">Requiere atención</h3>${avisos.length?'<ul style="list-style:none;margin:0;padding:0;">'+avisos.join('')+'</ul>':'<div class="msgbox ok" style="margin:0;">✅ Todo en orden: sin vencidos, reservas pendientes ni respaldos atrasados.</div>'}</div></div>
    <div class="card"><div class="card-b"><h3 style="font-size:15px;margin-bottom:6px;">Vencidos más atrasados</h3><div class="tbl-wrap"><table><thead><tr><th>Lector</th><th>Grado</th><th>Libro</th><th>Atraso</th></tr></thead><tbody>${venc.map(v=>`<tr><td>${esc(v.p.lector)}</td><td>${esc(v.p.grado)}</td><td><span class="mono">${esc(v.l.cod||'')}</span> ${esc(v.l.titulo||'(libro eliminado)')}</td><td class="num">${v.atraso} d</td></tr>`).join('')||'<tr><td colspan="4" class="empty">Sin préstamos vencidos 🎉</td></tr>'}</tbody></table></div>${s.vencidos.length>6?`<div class="hint" style="margin-top:6px;">y ${s.vencidos.length-6} más en Préstamos.</div>`:''}</div></div>
  </div>
  <div class="grid g2" style="margin-top:16px;">
    <div class="card"><div class="card-b"><h3 style="font-size:15px;margin-bottom:8px;">Movimiento de los últimos 6 meses</h3>${meses.map(m=>`<div style="display:flex;align-items:center;gap:8px;margin:5px 0;font-size:12.5px;"><span style="width:62px;color:var(--ink-soft)">${esc(m.etiqueta)}</span><div style="flex:1">${bibBar(Math.round(m.prestados/maxM*100),'#1a5fb4')}</div><span style="width:78px;text-align:right">${m.prestados} préstamos</span></div>`).join('')}</div></div>
    <div class="card"><div class="card-b"><h3 style="font-size:15px;margin-bottom:8px;">Más prestados en los últimos 30 días</h3>${top.length?`<ol style="margin:0;padding-left:20px;">${top.map(t=>`<li style="margin:4px 0;">${esc(t[0])} <span class="hint">· ${t[1]} vez/veces</span></li>`).join('')}</ol>`:'<div class="hint">Todavía no hay préstamos en los últimos 30 días.</div>'}</div></div>
  </div>`;
}

/* ---------- Revisión de datos (integridad) ---------- */
function bibSaludChecks(){
  const libros = bibLibros(), lect = bibLect(), prest = bibPrest(), res = bibRes(), cats = bibCats();
  const lid = new Set(libros.map(l=>l.id)), lecId = new Set(lect.map(x=>x.id)), catId = new Set(cats.map(c=>c.id));
  const dup = (arr, fn)=>{ const m = new Map(); arr.forEach(x=>{ const k = fn(x); if(k) (m.get(k)||m.set(k,[]).get(k)).push(x); }); return [...m.entries()].filter(e=>e[1].length>1); };
  const activos = prest.filter(p=>!p.devuelto);
  const huerf = activos.filter(p=>!lid.has(p.libroId));
  const sinLec = activos.filter(p=>p.lectorId && !lecId.has(p.lectorId));
  const exceden = libros.filter(l=>bibPrestados(l.id) > bibEjemplares(l));
  const codDup = dup(libros, l=>String(l.cod||'').trim().toUpperCase());
  const isbnDup = dup(libros, l=>String(l.isbn||'').replace(/[^0-9Xx]/g,'').toUpperCase());
  const sinCat = libros.filter(l=>!catId.has(l.catId));
  const lecDup = [...dup(lect.filter(x=>!x.baja), x=>bibNorm(x.nombre)+'|'+bibNorm(x.grado)), ...dup(lect, x=>String(x.cod||'').toUpperCase())];
  const resHuerf = res.filter(r=>(r.estado==='Espera'||r.estado==='Disponible') && (!lid.has(r.libroId) || !lecId.has(r.lectorId)));
  const cantMal = libros.filter(l=>l.cant!==undefined && l.cant!=='' && (!Number.isInteger(Number(l.cant)) || Number(l.cant)<1));
  const bajasIds = new Set(lect.filter(x=>x.baja).map(x=>x.id)), egr = activos.filter(p=>bajasIds.has(p.lectorId));
  const dResp = bibDiasDesdeRespaldo(), pend = Object.keys(DB.pending||{}).length;
  const L = (a,f,n)=>a.slice(0,n||8).map(f); const t = x=>esc(x.cod+' · '+(x.titulo||''));
  return [
    { id:'pend', t:'Cambios sin guardar en la base de datos', nivel:'bad', n:pend, det:[pend+' clave(s) esperando sincronizar. Revisa que el servidor siga encendido.'] },
    { id:'huerf', t:'Préstamos activos cuyo libro ya no existe', nivel:'bad', n:huerf.length, det:L(huerf,p=>esc(p.lector)+' · prestado el '+esc(p.fecha)), fix:['Cerrar estos préstamos','cerrar'] },
    { id:'exceden', t:'Libros con más préstamos activos que ejemplares', nivel:'bad', n:exceden.length, det:L(exceden,l=>t(l)+' ('+bibPrestados(l.id)+' prestados de '+bibEjemplares(l)+')') },
    { id:'codDup', t:'Códigos de libro repetidos', nivel:'bad', n:codDup.length, det:L(codDup,e=>esc(e[0])+' aparece '+e[1].length+' veces ('+e[1].map(l=>esc(l.titulo||'')).join(' / ')+')') },
    { id:'isbnDup', t:'ISBN repetidos (posibles libros duplicados; suma ejemplares en vez de crear otro registro)', nivel:'warn', n:isbnDup.length, det:L(isbnDup,e=>esc(e[0])+': '+e[1].map(l=>esc(l.cod)).join(', ')) },
    { id:'sinCat', t:'Libros con categoría inexistente', nivel:'warn', n:sinCat.length, det:L(sinCat,t) },
    { id:'cantMal', t:'Libros con cantidad inválida (vacía, 0 o decimal)', nivel:'warn', n:cantMal.length, det:L(cantMal,l=>t(l)+' (cant = "'+esc(l.cant)+'")') },
    { id:'lecDup', t:'Lectores duplicados (mismo nombre y grado, o carné repetido)', nivel:'warn', n:lecDup.length, det:L(lecDup,e=>esc(e[1][0].nombre||e[0])+' × '+e[1].length) },
    { id:'sinLec', t:'Préstamos activos de un lector que ya no existe', nivel:'warn', n:sinLec.length, det:L(sinLec,p=>esc(p.lector)+' · '+esc(p.fecha)) },
    { id:'resHuerf', t:'Reservas de un libro o lector que ya no existen', nivel:'warn', n:resHuerf.length, det:L(resHuerf,r=>esc(r.lector)+' (reserva '+esc(r.estado)+')'), fix:['Cancelar estas reservas','cancelar'] },
    { id:'egr', t:'Libros en manos de lectores dados de baja (egresados)', nivel:'warn', n:egr.length, det:L(egr,p=>esc(p.lector)+' · '+esc(p.fecha)) },
    { id:'resp', t:'Respaldo de la biblioteca', nivel:'warn', n:(dResp===null||dResp>14)?1:0, det:[dResp===null?'Nunca se descargó un respaldo.':'Último respaldo hace '+dResp+' días.'], fix:['Descargar respaldo ahora','respaldar'] }
  ];
}
function bibSaludProblemas(){ try{ return bibSaludChecks().filter(c=>c.n>0).length; }catch(e){ return 0; } }
function renderBibSalud(){
  if(!isAdmin()) return '<div class="msgbox err">Solo un administrador puede usar la revisión de datos.</div>';
  const cs = bibSaludChecks(), malos = cs.filter(c=>c.n>0);
  const fila = c=>{ const ok = c.n===0, ic = ok?'✅':c.nivel==='bad'?'❌':'⚠️';
    return `<div class="card" style="margin-bottom:10px;"><div class="card-b" style="display:flex;gap:12px;align-items:flex-start;"><div style="font-size:20px;line-height:1.2">${ic}</div><div style="flex:1;"><div style="font-weight:600;">${c.t} ${ok?'':`<span class="badge ${c.nivel==='bad'?'badge-bad':'badge-warn'}">${c.n}</span>`}</div>${ok?'<div class="hint">Sin problemas.</div>':`<details style="margin-top:6px;"><summary class="hint" style="cursor:pointer;">Ver detalle${c.n>c.det.length?' (primeros '+c.det.length+')':''}</summary><ul style="margin:6px 0 0 18px;padding:0;">${c.det.map(d=>`<li style="margin:2px 0;font-size:13px;">${d}</li>`).join('')}</ul></details>`}</div>${!ok && c.fix?`<button class="btn btn-sm btn-primary" data-saludfix="${c.fix[1]}">${c.fix[0]}</button>`:''}</div></div>`; };
  return `<div class="toolbar noprint"><button class="btn" id="bsRev">↻ Volver a revisar</button></div>
  <div class="msgbox ${malos.length?'err':'ok'}" style="margin-bottom:14px;">${malos.length?'Se encontraron <b>'+malos.length+'</b> punto(s) por revisar de '+cs.length+' comprobaciones.':'✅ Los datos de la biblioteca están consistentes ('+cs.length+' comprobaciones sin problemas).'}</div>${cs.slice().sort((a,b)=>(b.n>0)-(a.n>0)).map(fila).join('')}`;
}
async function bibSaludArreglar(que){
  if(!guardEdit()) return;
  if(que==='respaldar'){ bibRespaldar(); setTimeout(render,400); return; }
  const lid = new Set(bibLibros().map(l=>l.id)), lecId = new Set(bibLect().map(x=>x.id));
  if(que==='cerrar'){
    const ids = new Set(bibPrest().filter(p=>!p.devuelto && !lid.has(p.libroId)).map(p=>p.id));
    if(!ids.size || !confirm('Se cerrarán '+ids.size+' préstamo(s) de libros que ya no existen (quedarán como devueltos hoy con una nota). ¿Continuar?')) return;
    await DB.save(BKEYS.prest, bibPrest().map(p=>ids.has(p.id) ? {...p, devuelto:today(), nota:'Cerrado por revisión de datos: el libro ya no existe'} : p));
    registrarBitacora('Revisión de datos', ids.size+' préstamo(s) huérfano(s) cerrado(s)');
  }
  if(que==='cancelar'){
    const ids = new Set(bibRes().filter(r=>(r.estado==='Espera'||r.estado==='Disponible') && (!lid.has(r.libroId)||!lecId.has(r.lectorId))).map(r=>r.id));
    if(!ids.size || !confirm('Se cancelarán '+ids.size+' reserva(s). ¿Continuar?')) return;
    await DB.save(B2.res, bibRes().map(r=>ids.has(r.id) ? {...r, estado:'Cancelada'} : r));
    registrarBitacora('Revisión de datos', ids.size+' reserva(s) huérfana(s) cancelada(s)');
  }
  toast('Corregido.','ok'); render();
}

/* ---------- Notificaciones (campanita) y búsqueda global de la biblioteca ---------- */
function bibNotificaciones(){
  const g = [], st = bibStats(), listas = bibRes().filter(r=>r.estado==='Disponible').length, d = bibDiasDesdeRespaldo();
  if(st.vencidos.length) g.push({ ic:'⇄', n:st.vencidos.length, texto:st.vencidos.length+' préstamo(s) de libros vencido(s). El más atrasado: '+st.vencidos[0].atraso+' día(s) ('+st.vencidos[0].p.lector+').', view:'bibPrest', nivel:'bad' });
  if(listas) g.push({ ic:'🔖', n:listas, texto:listas+' reserva(s) lista(s) para recoger: avisa a los lectores.', view:'bibRes', nivel:'warn' });
  if(d===null || d>14) g.push({ ic:'💾', n:1, texto:d===null?'Aún no hay un respaldo de la biblioteca.':'Último respaldo de la biblioteca hace '+d+' días.', view:'bibInicio', nivel:'warn' });
  const nProb = isAdmin() ? bibSaludProblemas() : 0;
  if(nProb) g.push({ ic:'🩺', n:nProb, texto:nProb+' punto(s) por corregir en la revisión de datos.', view:'bibSalud', nivel:'warn' });
  return g;
}
function bibBuscar(q){
  const has = (...c)=>c.join(' ').toLowerCase().includes(q), ql = q.replace(/[^0-9xX]/g,'');
  const libros = bibLibros().filter(l=>has(l.cod,l.titulo,l.autor,l.editorial) || (ql.length>=4 && String(l.isbn||'').replace(/[^0-9xX]/g,'').includes(ql))).slice(0,8);
  const lectores = bibLect().filter(x=>has(x.cod,x.nombre,x.grado)).slice(0,6);
  const lib = new Map(bibLibros().map(l=>[l.id,l]));
  const prest = bibPrest().filter(p=>!p.devuelto && (has(p.lector,p.grado) || has((lib.get(p.libroId)||{}).titulo||'',(lib.get(p.libroId)||{}).cod||''))).slice(0,5);
  const grp = (t,h)=>h?`<div class="gsearch-grp">${t}</div>`+h:'', sub = s=>`<br><span style="color:var(--ink-soft);">${s}</span>`;
  const html = grp('Libros', libros.map(l=>`<div class="ri" data-bgl="${esc(l.id)}"><b>${esc(l.cod)}</b> — ${esc(l.titulo)}${sub(esc(l.autor||'—')+' · '+(bibPrestados(l.id)<bibEjemplares(l)?'disponible':'todos prestados'))}</div>`).join(''))
    + grp('Lectores', lectores.map(x=>`<div class="ri" data-bgo="${esc(x.id)}"><b>${esc(x.nombre)}</b>${sub(esc(x.cod)+' · '+esc(x.grado||x.tipo||'')+(x.baja?' · de baja':''))}</div>`).join(''))
    + grp('Préstamos vigentes', prest.map(p=>{ const l = lib.get(p.libroId)||{}; return `<div class="ri" data-bgp="${esc(p.lector)}"><b>${esc(p.lector)}</b> — ${esc(l.titulo||'(libro eliminado)')}${sub('vence '+esc(p.vence)+(bibVencido(p)?' · <b style="color:var(--bad)">VENCIDO</b>':''))}</div>`; }).join(''));
  return { total:libros.length+lectores.length+prest.length, html, wire:(res,inp)=>{
    const ir = ()=>{ res.style.display='none'; inp.value=''; };
    res.querySelectorAll('[data-bgl]').forEach(el=>el.addEventListener('click',()=>{ const l = bibLibros().find(x=>x.id===el.dataset.bgl); ir(); Object.assign(bibF,{ q:l?l.cod:'', cat:'', estado:'', ubi:'', pag:1 }); STATE.view='bibLibros'; render(); }));
    res.querySelectorAll('[data-bgo]').forEach(el=>el.addEventListener('click',()=>{ const x = bibLect().find(r=>r.id===el.dataset.bgo); ir(); bibLf.q = x?x.nombre:''; STATE.view='bibLect'; render(); }));
    res.querySelectorAll('[data-bgp]').forEach(el=>el.addEventListener('click',()=>{ ir(); Object.assign(bibPf,{ q:el.dataset.bgp, est:'' }); STATE.view='bibPrest'; render(); }));
  } };
}

Object.assign(BIB_RENDER, { bibInicio:renderBibInicio, bibSalud:renderBibSalud }); BIB_VIEWS.push('bibInicio','bibSalud');
(()=>{ const ow = bibWire4; bibWire4 = function(){ ow();
  document.querySelectorAll('[data-bigo]').forEach(b=>b.onclick=()=>{ STATE.view = b.dataset.bigo; render(); });
  const bk = document.getElementById('biBackup'); if(bk) bk.onclick = ()=>{ bibRespaldar(); setTimeout(render,400); };
  const rv = document.getElementById('bsRev'); if(rv) rv.onclick = ()=>{ render(); toast('Revisión actualizada.','ok'); };
  document.querySelectorAll('[data-saludfix]').forEach(b=>b.onclick=()=>bibSaludArreglar(b.dataset.saludfix));
}; })();


/* ======================= (antes biblioteca4.js) ======================= */
/* =========================================================================
   SIGIE — Biblioteca (v8): pantallas nuevas
   -------------------------------------------------------------------------
     · Avisos por WhatsApp a los morosos (un mensaje por familia, con su celular)
     · Estadísticas por nivel / grado / sección
     · Carnés en hojas (8 por A4), por aula
     · Préstamo y devolución por aula (plan lector)
   La lógica (agrupar, armar mensajes, repartir libros…) está en bib-util.js y
   tiene pruebas; este archivo solo dibuja y guarda.
   ========================================================================= */

/* ---------- Grupos de lectores (aulas) ---------- */
const bibGrupoDe = x => SigieBib.claveGrado((x.tipo || 'Alumno') !== 'Alumno' ? 'DOCENTE' : x.grado, 'seccion');
function bibGruposLector(){
  const m = new Map();
  bibLect().filter(x=>!x.baja).forEach(x=>{
    const k = bibGrupoDe(x);
    if(!m.has(k)) m.set(k, { clave:k, n:0, orden:SigieBib.parsearGrado((x.tipo||'Alumno')!=='Alumno' ? 'DOCENTE' : x.grado).orden });
    m.get(k).n++;
  });
  return [...m.values()].sort((a,b)=>a.orden-b.orden || a.clave.localeCompare(b.clave,'es'));
}

function bibDescargar(nombre, texto, tipo){
  const blob = new Blob(['\ufeff'+texto], { type:tipo||'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const bibCsv = filas => filas.map(f=>f.map(v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"').join(';')).join('\r\n');

/* ---------- 1. Avisos por WhatsApp ---------- */
function bibAvisosModal(minDias){
  const cfg = DB.get(KEYS.config) || {};
  const ui = { filtro:'todos' };           // 'todos' | 'nuevos' (no avisados en los últimos 3 días)
  const calcular = ()=>{
    let l = SigieBib.avisosMorosos({ prestamos:bibPrest(), lectores:bibLect(), libros:bibLibros(), nombreIE:cfg.nombreIE, hoy:today(), minDias:minDias||1 });
    if(ui.filtro==='nuevos') l = l.filter(a=>a.diasDesdeAviso===null || a.diasDesdeAviso>=3);
    return l;
  };
  const cuerpo = lista=>{
    const sinTel = lista.filter(a=>!a.url).length;
    return `<div class="note-banner">WhatsApp no deja que una página web envíe mensajes a muchas personas de golpe. Aquí se abre <b>un chat por familia</b> con el mensaje ya escrito: solo pulsas <b>Enviar</b> en WhatsApp. Cada aviso queda marcado para que no se repita por error.</div>
    <div class="toolbar noprint" style="margin:8px 0"><label class="hint">Mostrar: <select id="bwFiltro"><option value="todos" ${ui.filtro==='todos'?'selected':''}>Todos los morosos</option><option value="nuevos" ${ui.filtro==='nuevos'?'selected':''}>Sin aviso en los últimos 3 días</option></select></label>
      <span style="flex:1"></span><button class="btn" id="bwCopiar">📋 Copiar todos los mensajes</button><button class="btn" id="bwCsv">⇩ CSV (para envío masivo externo)</button></div>
    <div class="hint" style="margin-bottom:8px">${lista.length} familia(s)${sinTel?` · <b>${sinTel} sin celular válido</b> (escríbelo abajo y se guarda en la ficha del lector)`:''}${minDias>1?` · atraso de ${minDias} días o más`:''}</div>
    <div class="tbl-wrap"><table><thead><tr><th>Lector</th><th>Libros</th><th>Celular</th><th>Último aviso</th><th></th></tr></thead><tbody>${lista.map((a,i)=>`<tr data-bwfila="${i}">
      <td><b>${esc(a.nombre)}</b><br><span class="hint">${esc(a.grado)}</span></td>
      <td>${a.libros} <span class="badge badge-bad">${a.atrasoMax} d</span></td>
      <td>${a.url ? '📱 +'+esc(a.telefono) : `<input data-bwtel="${i}" placeholder="987654321" style="width:120px" inputmode="tel" value="${esc(a.telefonoOriginal)}"> <button class="btn btn-sm" data-bwgtel="${i}">Guardar</button>${a.telefonoProblema?`<div class="hint">${esc(a.telefonoProblema)}</div>`:''}`}</td>
      <td>${a.ultimoAviso ? esc(a.ultimoAviso)+' <span class="hint">(hace '+a.diasDesdeAviso+' d)</span>' : '<span class="hint">—</span>'}</td>
      <td class="noprint">${a.url ? `<button class="btn btn-sm btn-primary" data-bwabrir="${i}">💬 WhatsApp</button> ` : ''}<button class="btn btn-sm" data-bwcopia="${i}">Copiar</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No hay morosos con ese criterio. 🎉</td></tr>'}</tbody></table></div>`;
  };
  const bg = bibModal('Avisos de devolución por WhatsApp', cuerpo(calcular()), ()=>true, 'Cerrar', '1000px');
  const c = bg.querySelector('#bmC'); if(c) c.style.display = 'none';
  const pintar = ()=>{
    const lista = calcular();
    const mb = bg.querySelector('.m-b'); mb.innerHTML = cuerpo(lista);
    mb.querySelector('#bwFiltro').onchange = e=>{ ui.filtro = e.target.value; pintar(); };
    mb.querySelector('#bwCopiar').onclick = async ()=>{
      const t = lista.map(a=>'Para: '+a.nombre+(a.telefono?' (+'+a.telefono+')':' (sin celular)')+'\n'+a.mensaje).join('\n\n— — — — —\n\n');
      try{ await navigator.clipboard.writeText(t); toast(lista.length+' mensaje(s) copiado(s).','ok'); }catch(e){ toast('No se pudo copiar.','err'); }
    };
    mb.querySelector('#bwCsv').onclick = ()=>{
      if(!lista.length){ toast('No hay avisos para exportar.','err'); return; }
      bibDescargar('avisos-morosos-'+today()+'.csv', bibCsv([['Nombre','Grado','Celular (con 51)','Libros','Días de atraso','Mensaje'], ...lista.map(a=>[a.nombre, a.grado, a.telefono, a.libros, a.atrasoMax, a.mensaje])]));
    };
    mb.querySelectorAll('[data-bwcopia]').forEach(b=>b.onclick = async ()=>{
      try{ await navigator.clipboard.writeText(lista[+b.dataset.bwcopia].mensaje); toast('Mensaje copiado.','ok'); }catch(e){ toast('No se pudo copiar.','err'); }
    });
    mb.querySelectorAll('[data-bwabrir]').forEach(b=>b.onclick = async ()=>{
      const a = lista[+b.dataset.bwabrir];
      const w = window.open(a.url, '_blank');
      if(!w){ toast('El navegador bloqueó la ventana. Permite ventanas emergentes para este sitio.','err'); return; }
      const ids = new Set(a.prestamoIds);
      await DB.save(BKEYS.prest, bibPrest().map(p=>ids.has(p.id) ? { ...p, avisado:today() } : p));
      registrarBitacora('Aviso de morosidad', a.nombre+' · '+a.libros+' libro(s)');
      pintar();
    });
    mb.querySelectorAll('[data-bwgtel]').forEach(b=>b.onclick = async ()=>{
      const i = +b.dataset.bwgtel, a = lista[i];
      const val = mb.querySelector('[data-bwtel="'+i+'"]').value;
      const t = SigieBib.normalizarTelefono(val);
      if(!t.ok){ toast('Celular no válido: '+t.motivo+'.','err'); return; }
      if(!a.lectorId){ toast('Este lector ya no está en la lista; no se puede guardar su celular.','err'); return; }
      await DB.save(BKEYS.lect, bibLect().map(l=>l.id===a.lectorId ? { ...l, tel:val.trim() } : l));
      toast('Celular guardado en la ficha de '+a.nombre+'.','ok'); pintar();
    });
  };
  pintar();
}

/* ---------- 2. Estadísticas por nivel / grado / sección ---------- */
const bibGr = { cuanto:'seccion' };
function bibGruposModal(){
  const per = { todo:'Todo el historial', '30':'Últimos 30 días', '90':'Últimos 90 días', '365':'Último año' }[bibRp.per] || 'Todo el historial';
  const calcular = ()=>SigieBib.estadisticasPorGrupo({ prestamos:bibPrest(), lectores:bibLect(), libros:bibLibros(), cats:bibCats(), hoy:today(), desde:bibPeriodoDesde(), cuanto:bibGr.cuanto });
  const nombreCuanto = { nivel:'Nivel', grado:'Grado', seccion:'Grado y sección' }[bibGr.cuanto];
  const cuerpo = r=>`<div class="toolbar noprint"><label class="hint">Agrupar por: <select id="bgCuanto">${[['nivel','Nivel (Inicial / Primaria / Secundaria)'],['grado','Grado (todas las secciones juntas)'],['seccion','Grado y sección']].map(o=>`<option value="${o[0]}" ${bibGr.cuanto===o[0]?'selected':''}>${o[1]}</option>`).join('')}</select></label>
      <span class="hint">Periodo: <b>${esc(per)}</b> (se cambia en Reporte general)</span><span style="flex:1"></span><button class="btn" id="bgXls">⇩ Excel</button><button class="btn" onclick="window.print()">🖨 Imprimir</button></div>
    <div class="grid g4" style="margin:8px 0"><div class="kpi"><div class="label">Alumnos</div><div class="num">${r.totalAlumnos.lectores}</div></div><div class="kpi"><div class="label">Préstamos</div><div class="num">${r.totalAlumnos.prestamos}</div></div><div class="kpi"><div class="label">Participación</div><div class="num">${r.totalAlumnos.participacion}%</div></div><div class="kpi"><div class="label">Libros vencidos</div><div class="num">${r.totalAlumnos.vencidos}</div></div></div>
    <div class="hint" style="margin-bottom:6px">“3A”, “3° A” y “3ro A primaria” cuentan como el mismo grupo. Si un aula no indica el nivel (solo “3° A”), no se adivina: queda como grupo aparte. Participación = alumnos que sacaron al menos un libro en el periodo.</div>
    <div class="tbl-wrap"><table><thead><tr><th>${nombreCuanto}</th><th>Lectores</th><th>Préstamos</th><th>Promedio por lector</th><th>Participación</th><th>En casa</th><th>Vencidos</th><th>Categoría más leída</th></tr></thead><tbody>${r.filas.map(f=>`<tr><td><b>${esc(f.grupo)}</b></td><td class="num">${f.lectores}</td><td class="num">${f.prestamos}</td><td class="num">${f.promedio}</td>
      <td><div style="display:flex;align-items:center;gap:6px"><div style="flex:1;background:#e4e8ef;border-radius:4px;height:8px;min-width:60px"><div style="width:${Math.min(100,f.participacion)}%;background:#2a7d4f;height:8px;border-radius:4px"></div></div><span>${f.participacion}%</span></div></td>
      <td class="num">${f.enCasa}</td><td class="num">${f.vencidos?`<span class="badge badge-bad">${f.vencidos}</span>`:0}</td><td>${esc(f.categoriaTop||'—')}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Aún no hay lectores ni préstamos.</td></tr>'}</tbody></table></div>`;
  const bg = bibModal('Estadísticas por grado y sección', cuerpo(calcular()), ()=>true, 'Cerrar', '1100px');
  const c = bg.querySelector('#bmC'); if(c) c.style.display = 'none';
  const pintar = ()=>{
    const r = calcular();
    const mb = bg.querySelector('.m-b'); mb.innerHTML = cuerpo(r);
    mb.querySelector('#bgCuanto').onchange = e=>{ bibGr.cuanto = e.target.value; pintar(); };
    mb.querySelector('#bgXls').onclick = ()=>{
      const aoa = [[nombreCuanto,'Lectores','Préstamos','Promedio por lector','Participación %','En casa','Vencidos','Categoría más leída'], ...r.filas.map(f=>[f.grupo,f.lectores,f.prestamos,f.promedio,f.participacion,f.enCasa,f.vencidos,f.categoriaTop])];
      if(typeof XLSX==='undefined'){ bibDescargar('biblioteca-por-grado-'+today()+'.csv', bibCsv(aoa)); return; }
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Por grado'); XLSX.writeFile(wb, 'biblioteca-por-grado-'+today()+'.xlsx');
    };
  };
  pintar();
}

/* ---------- 3. Carnés en hojas ---------- */
function bibCarnesHojas(){
  const lista = bibLect().filter(x=>!x.baja && (!bibLf.grupo || bibGrupoDe(x)===bibLf.grupo));
  if(!lista.length){ toast('No hay lectores para imprimir carné.','err'); return; }
  const cfg = DB.get(KEYS.config) || {};
  const html = SigieBib.carnesHTML(lista, { nombreIE:cfg.nombreIE, qr:bibQrImg, hoy:today(), titulo:'Carnés de biblioteca'+(bibLf.grupo?' — '+bibLf.grupo:'') });
  const w = window.open('', '_blank');
  if(!w){ toast('El navegador bloqueó la ventana. Permite ventanas emergentes para este sitio.','err'); return; }
  w.document.write(html); w.document.close();
  registrarBitacora('Impresión de carnés', lista.length+' carné(s)'+(bibLf.grupo?' · '+bibLf.grupo:''));
}

/* ---------- 4. Préstamo por aula (plan lector) ---------- */
// pre (opcional, desde Lecturas por aula): { aula, titulo, dias, lecturaId } deja elegidos el aula y el libro.
function bibAulaModal(pre){
  if(!guardEdit()) return;
  pre = pre && typeof pre.aula==='string' ? pre : null;
  const aulas = bibGruposLector().filter(g=>!/^DOCENTES/.test(g.clave) && !/^SIN GRADO/.test(g.clave));
  if(!aulas.length){ toast('Primero registra lectores con su grado y sección (Lectores).','err'); return; }
  const titulos = ()=>SigieBib.agruparTitulos(bibLibros(), bibPrestados, bibEjemplares).filter(t=>t.libres>0);
  if(!titulos().length){ toast('No hay libros con ejemplares libres.','err'); return; }
  const ui = { aula:(pre && aulas.some(g=>g.clave===pre.aula)) ? pre.aula : aulas[0].clave, titulo:(pre && titulos().some(t=>t.clave===pre.titulo)) ? pre.titulo : titulos()[0].clave, dias:(pre && pre.dias) || 14, plan:null };
  const calcular = ()=>{
    const t = titulos().find(x=>x.clave===ui.titulo); if(!t) return null;
    const lecs = bibLect().filter(x=>!x.baja && (x.tipo||'Alumno')==='Alumno' && bibGrupoDe(x)===ui.aula);
    const plan = SigieBib.asignarAula(lecs, t.items.filter(i=>i.libres>0), {
      lector: lec=>bibPuede(lec, lec.nombre),
      libro: (lec, libro)=> bibPrest().some(p=>!p.devuelto && p.libroId===libro.id && p.lectorId===lec.id) ? 'ya lo tiene' : (bibLibre(libro, lec.id, lec.nombre).ok ? '' : 'sin ejemplar libre')
    });
    return { t, lecs, ...plan };
  };
  const cuerpo = ()=>{
    return `<div class="field f-6"><label>Aula</label><select id="baAula">${aulas.map(g=>`<option value="${esc(g.clave)}" ${ui.aula===g.clave?'selected':''}>${esc(g.clave)} (${g.n})</option>`).join('')}</select></div>
    <div class="field f-6"><label>Libro (título con ejemplares libres)</label><select id="baTit">${titulos().map(t=>`<option value="${esc(t.clave)}" ${ui.titulo===t.clave?'selected':''}>${esc(t.titulo)}${t.autor?' — '+esc(t.autor):''} (${t.libres} libres de ${t.total})</option>`).join('')}</select></div>
    <div class="field f-3"><label>Días de préstamo</label><input id="baDias" type="number" min="1" max="90" value="${ui.dias}"></div>
    <div class="field f-12"><div id="baPrev"></div></div>`;
  };
  const prev = ()=>{
    const r = ui.plan = calcular(); const box = bg.querySelector('#baPrev'); if(!r){ box.innerHTML = ''; return; }
    box.innerHTML = `<div class="hint" style="margin-bottom:6px"><b>${r.asignaciones.length}</b> alumno(s) recibirán un ejemplar${r.sinEjemplar.length?` · <b>${r.sinEjemplar.length}</b> sin ejemplar libre (faltan ${r.sinEjemplar.length} ejemplares)`:''}${r.bloqueados.length?` · <b>${r.bloqueados.length}</b> bloqueado(s)`:''}. Desmarca a quien no deba llevarse el libro.</div>
      <div class="tbl-wrap" style="max-height:260px;overflow:auto"><table><thead><tr><th></th><th>Alumno</th><th>Ejemplar</th></tr></thead><tbody>${r.asignaciones.map((a,i)=>`<tr><td><input type="checkbox" data-baidx="${i}" checked></td><td>${esc(a.lector.nombre)}</td><td><span class="mono">${esc(a.libro.cod)}</span></td></tr>`).join('')
        + r.sinEjemplar.map(l=>`<tr><td></td><td>${esc(l.nombre)}</td><td><span class="badge badge-warn">sin ejemplar libre</span></td></tr>`).join('')
        + r.bloqueados.map(b=>`<tr><td></td><td>${esc(b.lector.nombre)}</td><td><span class="badge badge-bad">${esc(b.motivo)}</span></td></tr>`).join('')
        || '<tr><td colspan="3" class="empty">No hay alumnos en esa aula.</td></tr>'}</tbody></table></div>`;
  };
  const bg = bibModal('Préstamo por aula (plan lector)', cuerpo(), async bg=>{
    const r = ui.plan; if(!r || !r.asignaciones.length){ toast('No hay nada que prestar.','err'); return false; }
    const elegidos = [...bg.querySelectorAll('[data-baidx]')].filter(c=>c.checked).map(c=>r.asignaciones[+c.dataset.baidx]);
    if(!elegidos.length){ toast('Marca al menos un alumno.','err'); return false; }
    const dias = Math.max(1, Math.min(90, Number(bg.querySelector('#baDias').value)||14));
    const vence = bibEnDias(dias), lote = uid('pl'), loteNombre = ui.aula+' · '+r.t.titulo;
    let ok = 0; const fallos = [];
    for(const a of elegidos){
      const err = await bibPrestar(a.libro, a.lector, a.lector.nombre, a.lector.grado, vence, { lote, loteNombre, ...(pre && pre.lecturaId ? { lecturaId:pre.lecturaId } : {}) });
      if(err) fallos.push(a.lector.nombre+': '+err); else ok++;
    }
    registrarBitacora('Préstamo por aula', loteNombre+' · '+ok+' libro(s)');
    toast(ok+' préstamo(s) registrado(s) para '+ui.aula+(fallos.length?' · '+fallos.length+' no se pudieron registrar':'')+'.', fallos.length?'err':'ok');
    if(fallos.length) bibModal('Préstamos que no se pudieron registrar', '<ul>'+fallos.map(f=>'<li>'+esc(f)+'</li>').join('')+'</ul>', ()=>true, 'Entendido');
    render();
  }, 'Registrar préstamos', '820px');
  const enlazar = ()=>{
    bg.querySelector('#baAula').onchange = e=>{ ui.aula = e.target.value; prev(); };
    bg.querySelector('#baTit').onchange = e=>{ ui.titulo = e.target.value; prev(); };
    bg.querySelector('#baDias').onchange = e=>{ ui.dias = Number(e.target.value)||14; };
  };
  enlazar(); prev();
}

function bibAulaDevModal(){
  if(!guardEdit()) return;
  const lotes = SigieBib.lotesActivos(bibPrest());
  if(!lotes.length){ toast('No hay préstamos por aula pendientes de devolver.','err'); return; }
  const ui = { lote:lotes[0].lote };
  const libros = new Map(bibLibros().map(l=>[l.id,l]));
  const cuerpo = ()=>{
    const L = lotes.find(x=>x.lote===ui.lote) || lotes[0];
    return `<div class="field f-12"><label>Préstamo por aula</label><select id="bdLote">${lotes.map(x=>`<option value="${esc(x.lote)}" ${ui.lote===x.lote?'selected':''}>${esc(x.nombre)} · prestado ${esc(x.fecha)} (${x.pendientes} de ${x.total} pendientes)</option>`).join('')}</select></div>
    <div class="field f-12"><div class="hint">Marca los libros que el aula devuelve hoy. Los que no marques seguirán como prestados.</div>
    <div class="tbl-wrap" style="max-height:300px;overflow:auto"><table><thead><tr><th><input type="checkbox" id="bdTodos" checked></th><th>Alumno</th><th>Libro</th><th>Vence</th></tr></thead><tbody>${L.items.filter(p=>!p.devuelto).map(p=>`<tr><td><input type="checkbox" data-bdid="${esc(p.id)}" checked></td><td>${esc(p.lector)}</td><td><span class="mono">${esc((libros.get(p.libroId)||{}).cod||'')}</span> ${esc((libros.get(p.libroId)||{}).titulo||'')}</td><td>${esc(p.vence)}${bibVencido(p)?' <span class="badge badge-bad">vencido</span>':''}</td></tr>`).join('')}</tbody></table></div></div>`;
  };
  const bg = bibModal('Devolución por aula', cuerpo(), async bg=>{
    const ids = [...bg.querySelectorAll('[data-bdid]')].filter(c=>c.checked).map(c=>c.dataset.bdid);
    if(!ids.length){ toast('Marca al menos un libro.','err'); return false; }
    for(const id of ids) await bibDevolver(id);
    toast(ids.length+' libro(s) devuelto(s).','ok'); render();
  }, 'Registrar devolución', '820px');
  const enlazar = ()=>{
    const mb = bg.querySelector('.m-b');
    mb.querySelector('#bdLote').onchange = e=>{ ui.lote = e.target.value; mb.innerHTML = cuerpo(); enlazar(); };
    mb.querySelector('#bdTodos').onchange = e=>mb.querySelectorAll('[data-bdid]').forEach(c=>c.checked = e.target.checked);
  };
  enlazar();
}

/* ---------- Conexión con los botones de las pantallas ---------- */
function bibWire5(){
  const $ = id=>document.getElementById(id), on = (id,fn)=>{ const e = $(id); if(e) e.addEventListener('click',fn); };
  on('bibAula', ()=>bibAulaModal()); on('bibAulaDev', bibAulaDevModal);
  on('bibGrupos', bibGruposModal); on('blCarnes', bibCarnesHojas);
  if($('blGrupo')) $('blGrupo').onchange = e=>{ bibLf.grupo = e.target.value; render(); };
}


/* ======================= (antes biblioteca5.js) ======================= */
/* =========================================================================
   SIGIE — Biblioteca (v9): ideas del Lectómetro
   -------------------------------------------------------------------------
     · ⭐ Reseña y estrellas al devolver un libro (Mostrador y Préstamos),
          promedio por libro y ranking "más leídos y mejor valorados"
     · 💤 Lectores sin actividad, por aula (se calcula con los préstamos)
     · 🎓 Certificado de lector imprimible (A4 horizontal)
   La lógica (promedios, ranking, inactivos, candidatos, HTML del certificado)
   está en bib-util.js y tiene pruebas; este archivo solo dibuja y guarda.
   Va después del bloque anterior y antes de ejemplo.js / app.js.
   ========================================================================= */

const B5 = { res:'sigie:bib_resenas' };
const bibResenas = ()=>DB.get(B5.res)||[];
const BIB_TITULOS5 = {
  bibResenas:['Reseñas y más leídos','Estrellas y comentarios de los lectores; libros más leídos y mejor valorados'],
  bibInact:['Lectores sin actividad','Alumnos que dejaron de leer, por aula'],
  bibCert:['Certificados de lector','Reconocimiento imprimible para los lectores del año']
};
const bibEstr = n => { const r = Math.max(0, Math.min(5, Math.round(Number(n)||0))); return '★'.repeat(r)+'☆'.repeat(5-r); };
const bibInicioAnio = ()=>new Date().getFullYear()+'-01-01';

// La reseña se guarda en su propia clave: se carga junto con el resto de la biblioteca.
(()=>{ const oc = bibCargar; bibCargar = async function(){ await oc(); await DB.load(B5.res, []); }; })();

/* ---------- 1. Reseña y estrellas al devolver ---------- */
// forzar=true la pide aunque en Reglas esté apagado "pedir reseña al devolver" (botón ★ Reseñar).
function bibResenaPedir(prestId, forzar){
  if(!canEdit()) return;
  const p = bibPrest().find(x=>x.id===prestId); if(!p) return;
  if(!forzar && bibCfg().pedirResena===false) return;
  if(bibResenas().some(r=>r.prestId===prestId)) { if(forzar) toast('Este préstamo ya tiene reseña.','err'); return; }
  const l = bibLibros().find(x=>x.id===p.libroId); if(!l) return;
  let est = 0;
  const pintar = bg=>bg.querySelectorAll('[data-rsest]').forEach(b=>{ const on = Number(b.dataset.rsest)<=est; b.textContent = on?'★':'☆'; b.style.color = on?'#f2a900':'#999'; });
  const bg = bibModal('¿Qué te pareció el libro?',
    `<div class="field f-12"><b>${esc(l.titulo)}</b> <span class="hint">· ${esc(l.cod)} · ${esc(p.lector)}${p.grado?' · '+esc(p.grado):''}</span></div>
     <div class="field f-12" style="text-align:center"><div id="rsEst" style="font-size:38px;line-height:1">${[1,2,3,4,5].map(n=>`<button type="button" data-rsest="${n}" title="${n} estrella(s)" style="background:none;border:0;cursor:pointer;font-size:38px;padding:0 4px;color:#999">☆</button>`).join('')}</div><div class="hint">Toca una estrella (o teclea 1 a 5). Es opcional: “Omitir” no guarda nada.</div></div>
     <div class="field f-12"><label>Comentario (opcional)</label><textarea id="rsCom" rows="3" maxlength="300" placeholder="Una frase sobre el libro"></textarea></div>`,
    async bg=>{
      if(!est){ toast('Elige de 1 a 5 estrellas, o pulsa Omitir.','err'); return false; }
      await DB.save(B5.res, [...bibResenas(), { id:uid('rs'), libroId:l.id, prestId:p.id, lectorId:p.lectorId||'', lector:p.lector, grado:p.grado||'', estrellas:est, comentario:String(bibV(bg,'rsCom')||'').trim().slice(0,300), fecha:today() }]);
      registrarBitacora('Reseña de libro', l.cod+' · '+est+' estrella(s)'); toast('Reseña guardada. ¡Gracias!','ok'); render();
    }, 'Guardar reseña', '520px');
  bg.querySelector('#bmC').textContent = 'Omitir';
  bg.querySelectorAll('[data-rsest]').forEach(b=>b.onclick=()=>{ est = Number(b.dataset.rsest); pintar(bg); });
  bg.addEventListener('keydown', e=>{ if(e.target && e.target.tagName==='TEXTAREA') return; if(/^[1-5]$/.test(e.key)){ est = Number(e.key); pintar(bg); } });
  // al cerrar, el cursor vuelve al campo del escáner del Mostrador
  const quitar = bg.remove.bind(bg); bg.remove = ()=>{ quitar(); const i = document.getElementById('bmIn'); if(i) i.focus(); };
}

// Mostrador: si el escaneo devolvió exactamente un libro, pide la reseña después de mostrar el resultado.
(()=>{ const om = bibMostScan; bibMostScan = async function(raw){
  const antes = new Set(bibPrest().filter(p=>!p.devuelto).map(p=>p.id));
  await om(raw);
  const dev = bibPrest().filter(p=>antes.has(p.id) && p.devuelto===today() && !p.perdido);
  if(dev.length===1) bibResenaPedir(dev[0].id);
}; })();

/* ---------- Reseñas y más leídos ---------- */
const bibRsF = { per:'anio' };
function renderBibResenas(){
  const desde = bibRsF.per==='anio' ? bibInicioAnio() : bibRsF.per==='90' ? bibEnDias(-90) : '';
  const res = bibResenas(), rank = SigieBib.rankingLibros(bibPrest(), res, bibLibros(), desde).slice(0,20), maxP = Math.max(1, ...rank.map(x=>x.prestamos));
  const lib = new Map(bibLibros().map(l=>[l.id,l])), edit = canEdit();
  const ult = [...res].sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha)) || String(b.id).localeCompare(String(a.id))).slice(0,30);
  const sin = SigieBib.devolucionesSinResena(bibPrest(), res, bibEnDias(-30)).filter(p=>lib.has(p.libroId)).slice(0,15);
  const promGen = res.length ? res.reduce((a,r)=>a+Number(r.estrellas||0),0)/res.length : 0;
  return `<div class="toolbar noprint"><label class="hint">Periodo: <select id="rsPer">${[['anio','Este año'],['90','Últimos 90 días'],['todo','Todo el historial']].map(o=>`<option value="${o[0]}" ${bibRsF.per===o[0]?'selected':''}>${o[1]}</option>`).join('')}</select></label>
    <button class="btn" id="rsXls">⇩ Exportar Excel</button><button class="btn" onclick="window.print()">🖨 Imprimir</button>${isAdmin()?'<button class="btn" id="bibReglas">⚙ Reglas de préstamo</button>':''}</div>
  <div class="hint" style="margin:6px 0">${res.length} reseña(s) en total${res.length?' · promedio general '+promGen.toFixed(1)+' '+bibEstr(promGen):''}. La reseña se pide al devolver un libro en el Mostrador o en Préstamos${bibCfg().pedirResena===false?' (<b>ahora está apagada</b> en Reglas de préstamo)':''}; las devoluciones por aula se reseñan desde la lista de abajo.</div>
  <h3 style="margin:12px 0 6px">Más leídos y mejor valorados</h3>
  <div class="tbl-wrap"><table><thead><tr><th>#</th><th>Libro</th><th>Préstamos</th><th>Valoración</th><th></th></tr></thead><tbody>${rank.map((x,i)=>`<tr><td class="num">${i+1}</td><td><span class="mono">${esc(x.libro.cod)}</span> ${esc(x.libro.titulo)}<div class="hint">${esc(x.libro.autor||'')}</div></td><td class="num">${x.prestamos}</td><td>${x.resenas?`<span style="color:#f2a900">${bibEstr(x.prom)}</span> <b>${x.prom.toFixed(1)}</b> <span class="hint">(${x.resenas} reseña${x.resenas===1?'':'s'})</span>`:'<span class="hint">Sin reseñas</span>'}</td><td style="width:22%">${bibBar(x.prestamos/maxP*100,'#14304d')}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">Sin préstamos en el periodo.</td></tr>'}</tbody></table></div>
  <h3 style="margin:18px 0 6px">Últimas reseñas</h3>
  <div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Libro</th><th>Lector</th><th>Estrellas</th><th>Comentario</th>${edit?'<th class="noprint"></th>':''}</tr></thead><tbody>${ult.map(r=>{ const l = lib.get(r.libroId)||{}; return `<tr><td>${esc(r.fecha)}</td><td><span class="mono">${esc(l.cod||'')}</span> ${esc(l.titulo||'(libro eliminado)')}</td><td>${esc(r.lector)}<div class="hint">${esc(r.grado||'')}</div></td><td style="color:#f2a900;white-space:nowrap">${bibEstr(r.estrellas)}</td><td>${esc(r.comentario||'')}</td>${edit?`<td class="noprint"><button class="btn btn-sm btn-danger" data-rsdel="${esc(r.id)}" title="Eliminar reseña">🗑</button></td>`:''}</tr>`; }).join('')||`<tr><td colspan="${edit?6:5}" class="empty">Todavía no hay reseñas.</td></tr>`}</tbody></table></div>
  ${edit?`<h3 style="margin:18px 0 6px" class="noprint">Devoluciones recientes sin reseña</h3><div class="tbl-wrap noprint"><table><thead><tr><th>Devuelto</th><th>Libro</th><th>Lector</th><th></th></tr></thead><tbody>${sin.map(p=>{ const l = lib.get(p.libroId)||{}; return `<tr><td>${esc(p.devuelto)}</td><td><span class="mono">${esc(l.cod||'')}</span> ${esc(l.titulo||'')}</td><td>${esc(p.lector)}<div class="hint">${esc(p.grado||'')}</div></td><td><button class="btn btn-sm" data-rsnew="${esc(p.id)}">★ Reseñar</button></td></tr>`; }).join('')||'<tr><td colspan="4" class="empty">No hay devoluciones de los últimos 30 días pendientes de reseña.</td></tr>'}</tbody></table></div>`:''}`;
}
function bibResenasXlsx(){
  const lib = new Map(bibLibros().map(l=>[l.id,l])), res = SigieBib.resumenResenas(bibResenas()), wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Cód.','Título','Autor','Préstamos (todo el historial)','Reseñas','Promedio ★'],
    ...SigieBib.rankingLibros(bibPrest(), bibResenas(), bibLibros(), '').map(x=>[x.libro.cod,x.libro.titulo,x.libro.autor,x.prestamos,x.resenas,x.resenas?Number(x.prom.toFixed(2)):''])]), 'Más leídos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Fecha','Cód.','Título','Lector','Grado','Estrellas','Comentario'],
    ...[...bibResenas()].sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha))).map(r=>{ const l = lib.get(r.libroId)||{}; return [r.fecha,l.cod||'',l.titulo||'(libro eliminado)',r.lector,r.grado,r.estrellas,r.comentario||'']; })]), 'Reseñas');
  XLSX.writeFile(wb, 'biblioteca-resenas-'+today()+'.xlsx');
}

/* ---------- 2. Lectores sin actividad ---------- */
const bibIn = { dias:null, grupo:'' };
const bibInDias = ()=>Math.max(1, Math.round(Number(bibIn.dias!=null ? bibIn.dias : bibCfg().diasInactivo))||30);
const bibEsAlumno = x=>(x.tipo||'Alumno')==='Alumno';
function bibInactivos(dias){
  return SigieBib.lectoresInactivos(bibLect().filter(bibEsAlumno), bibPrest(), today(), dias||bibInDias());
}
function bibInactN(){ try{ return bibInactivos(Number(bibCfg().diasInactivo)||30).length; }catch(e){ return 0; } }
function renderBibInact(){
  const dias = bibInDias(), todos = bibInactivos(dias), alumnos = bibLect().filter(x=>!x.baja && bibEsAlumno(x));
  const lista = todos.filter(x=>!bibIn.grupo || bibGrupoDe(x.lector)===bibIn.grupo);
  const aulas = new Map(); alumnos.forEach(x=>{ const k = bibGrupoDe(x); if(!aulas.has(k)) aulas.set(k,{ n:0, i:0, orden:SigieBib.parsearGrado(x.grado).orden }); aulas.get(k).n++; });
  todos.forEach(x=>{ const a = aulas.get(bibGrupoDe(x.lector)); if(a) a.i++; });
  const filas = [...aulas.entries()].sort((a,b)=>a[1].orden-b[1].orden || a[0].localeCompare(b[0],'es'));
  return `<div class="toolbar noprint"><label class="hint">Sin leer hace <input id="inDias" type="number" min="1" max="365" value="${dias}" style="width:70px"> días o más</label>
    <select id="inGrupo"><option value="">Todas las aulas</option>${filas.map(([k])=>`<option value="${esc(k)}" ${bibIn.grupo===k?'selected':''}>${esc(k)}</option>`).join('')}</select>
    <button class="btn" id="inXls">⇩ Exportar Excel</button><button class="btn" onclick="window.print()">🖨 Imprimir</button></div>
  <div class="hint" style="margin:6px 0">Se calcula con los préstamos: cuenta el último préstamo o devolución de cada alumno. Quien tiene ahora un libro sin vencer no aparece (está leyendo). Los alumnos dados de baja y los docentes no se incluyen. El plazo se puede dejar fijo en <i>Reglas de préstamo</i>.</div>
  <div class="grid g4" style="margin:8px 0"><div class="card"><div class="kpi"><div class="lbl">Alumnos sin actividad</div><div class="val" ${todos.length?'style="color:var(--bad,#b3261e)"':''}>${todos.length}</div><div class="delta">de ${alumnos.length} alumnos</div></div></div>
    <div class="card"><div class="kpi"><div class="lbl">Nunca sacaron un libro</div><div class="val">${todos.filter(x=>x.sinPrestamos).length}</div></div></div></div>
  <h3 style="margin:12px 0 6px">Por aula</h3><div class="tbl-wrap"><table><thead><tr><th>Aula</th><th>Alumnos</th><th>Sin actividad</th><th>%</th><th></th></tr></thead><tbody>${filas.map(([k,a])=>`<tr><td>${esc(k)}</td><td class="num">${a.n}</td><td class="num">${a.i}</td><td class="num">${a.n?Math.round(a.i/a.n*100):0}%</td><td style="width:25%">${bibBar(a.n?a.i/a.n*100:0,'#c62828')}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">No hay alumnos registrados.</td></tr>'}</tbody></table></div>
  <h3 style="margin:18px 0 6px">Lectores${bibIn.grupo?' de '+esc(bibIn.grupo):''}</h3><div class="tbl-wrap"><table><thead><tr><th>Lector</th><th>Aula</th><th>Último movimiento</th><th>Sin leer</th><th>Celular del apoderado</th></tr></thead><tbody>${lista.map(x=>`<tr><td>${esc(x.lector.nombre)}</td><td>${esc(x.lector.grado||'')}</td><td>${x.sinPrestamos?'—':esc(x.ultima)}</td><td>${x.sinPrestamos?'<span class="badge badge-warn">Nunca sacó un libro</span>':'<b>'+x.dias+'</b> días'}</td><td>${esc(x.lector.tel||'')}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">Nadie con este plazo: todos leyeron hace poco. ✅</td></tr>'}</tbody></table></div>`;
}

/* ---------- 3. Certificado de lector ---------- */
const bibCt = { per:'anio', min:3, grupo:'', fuera:new Set(), f1:'', f2:'' };
function bibCtCandidatos(){
  return SigieBib.candidatosCertificado(bibLect(), bibPrest(), bibCt.min, bibCt.per==='anio' ? bibInicioAnio() : '').filter(c=>!bibCt.grupo || bibGrupoDe(c.lector)===bibCt.grupo);
}
const bibInsigniaDe = n => { const i = BIB_INSIGNIAS.find(x=>n>=x[0]); return i ? i[1]+' '+i[2] : ''; };
function renderBibCert(){
  const cand = bibCtCandidatos(), sel = cand.filter(c=>!bibCt.fuera.has(c.lector.id));
  return `<div class="toolbar noprint"><label class="hint">Periodo: <select id="ctPer">${[['anio','Este año'],['todo','Todo el historial']].map(o=>`<option value="${o[0]}" ${bibCt.per===o[0]?'selected':''}>${o[1]}</option>`).join('')}</select></label>
    <label class="hint">Mínimo de libros leídos <input id="ctMin" type="number" min="1" max="99" value="${bibCt.min}" style="width:64px"></label>
    <select id="ctGrupo"><option value="">Todas las aulas</option>${bibGruposLector().map(g=>`<option value="${esc(g.clave)}" ${bibCt.grupo===g.clave?'selected':''}>${esc(g.clave)}</option>`).join('')}</select>
    <button class="btn btn-primary" id="ctImp" ${sel.length?'':'disabled'}>🖨 Imprimir ${sel.length} certificado(s)</button></div>
  <div class="hint" style="margin:6px 0">Cuenta los libros <b>devueltos</b> (sin los perdidos) en el periodo. Desmarca a quien no quieras incluir. Se imprime en A4 horizontal, un certificado por hoja.</div>
  <div class="toolbar noprint"><label class="hint">Firma 1 <input id="ctF1" value="${esc(bibCt.f1)}" placeholder="Responsable de la biblioteca" style="width:230px"></label><label class="hint">Firma 2 <input id="ctF2" value="${esc(bibCt.f2)}" placeholder="Dirección" style="width:230px"></label></div>
  <div class="tbl-wrap"><table><thead><tr><th><input type="checkbox" id="ctTodos" ${sel.length===cand.length&&cand.length?'checked':''}></th><th>Lector</th><th>Aula</th><th>Libros leídos</th><th>Insignia</th></tr></thead><tbody>${cand.map(c=>`<tr><td><input type="checkbox" data-ctid="${esc(c.lector.id)}" ${bibCt.fuera.has(c.lector.id)?'':'checked'}></td><td>${esc(c.lector.nombre)}</td><td>${esc(c.lector.grado||'')}</td><td class="num">${c.libros}</td><td>${esc(bibInsigniaDe(c.libros))}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">Nadie alcanza el mínimo todavía. Baja el mínimo de libros o cambia el periodo.</td></tr>'}</tbody></table></div>`;
}
function bibCertImprimir(){
  const sel = bibCtCandidatos().filter(c=>!bibCt.fuera.has(c.lector.id)); if(!sel.length){ toast('No hay lectores marcados.','err'); return; }
  const cfg = DB.get(KEYS.config)||{}, anio = bibCt.per==='anio' ? String(new Date().getFullYear()) : '';
  const html = SigieBib.certificadosHTML(sel.map(c=>({ nombre:c.lector.nombre, grado:(c.lector.grado||''), libros:c.libros, insignia:bibInsigniaDe(c.libros),
      motivo: anio ? '' : 'Por su constancia y entusiasmo en la lectura, habiendo leído '+c.libros+' libro(s) en la biblioteca.' })),
    { nombreIE:cfg.nombreIE, anio, fecha:new Date().toLocaleDateString('es-PE',{day:'numeric',month:'long',year:'numeric'}), titulo:'Certificados de lector', firma1:bibCt.f1, firma2:bibCt.f2 });
  const w = window.open('', '_blank');
  if(!w){ toast('El navegador bloqueó la ventana. Permite ventanas emergentes para este sitio.','err'); return; }
  w.document.write(html); w.document.close();
  registrarBitacora('Impresión de certificados de lector', sel.length+' certificado(s)'+(bibCt.grupo?' · '+bibCt.grupo:''));
}

/* ---------- Conexión con los botones ---------- */
Object.assign(BIB_RENDER, { bibResenas:renderBibResenas, bibInact:renderBibInact, bibCert:renderBibCert }); BIB_VIEWS.push('bibResenas','bibInact','bibCert');
function bibWire6(){
  const $ = id=>document.getElementById(id), on = (id,fn)=>{ const e = $(id); if(e) e.addEventListener('click',fn); };
  if($('rsPer')) $('rsPer').onchange = e=>{ bibRsF.per = e.target.value; render(); };
  on('rsXls', bibResenasXlsx);
  document.querySelectorAll('[data-rsnew]').forEach(b=>b.onclick=()=>bibResenaPedir(b.dataset.rsnew, true));
  document.querySelectorAll('[data-rsdel]').forEach(b=>b.onclick=async()=>{ if(!guardEdit()) return; if(!confirm('¿Eliminar esta reseña?')) return;
    await DB.save(B5.res, bibResenas().filter(r=>r.id!==b.dataset.rsdel)); registrarBitacora('Reseña eliminada', b.dataset.rsdel); render(); });
  if($('inDias')) $('inDias').onchange = e=>{ bibIn.dias = Math.max(1, Math.min(365, Math.round(Number(e.target.value))||30)); render(); };
  if($('inGrupo')) $('inGrupo').onchange = e=>{ bibIn.grupo = e.target.value; render(); };
  on('inXls', ()=>{ const l = bibInactivos().filter(x=>!bibIn.grupo || bibGrupoDe(x.lector)===bibIn.grupo);
    if(!l.length){ toast('No hay lectores para exportar.','err'); return; }
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Lector','Aula','Último movimiento','Días sin leer','Celular del apoderado'],...l.map(x=>[x.lector.nombre,x.lector.grado||'',x.ultima||'',x.sinPrestamos?'Nunca sacó un libro':x.dias,x.lector.tel||''])]), 'Sin actividad');
    XLSX.writeFile(wb, 'biblioteca-lectores-sin-actividad-'+today()+'.xlsx'); });
  if($('ctPer')) $('ctPer').onchange = e=>{ bibCt.per = e.target.value; bibCt.fuera.clear(); render(); };
  if($('ctMin')) $('ctMin').onchange = e=>{ bibCt.min = Math.max(1, Math.round(Number(e.target.value))||1); bibCt.fuera.clear(); render(); };
  if($('ctGrupo')) $('ctGrupo').onchange = e=>{ bibCt.grupo = e.target.value; render(); };
  if($('ctF1')) $('ctF1').onchange = e=>{ bibCt.f1 = e.target.value.trim(); };
  if($('ctF2')) $('ctF2').onchange = e=>{ bibCt.f2 = e.target.value.trim(); };
  if($('ctTodos')) $('ctTodos').onchange = e=>{ bibCtCandidatos().forEach(c=>e.target.checked ? bibCt.fuera.delete(c.lector.id) : bibCt.fuera.add(c.lector.id)); render(); };
  document.querySelectorAll('[data-ctid]').forEach(c=>c.onchange=()=>{ c.checked ? bibCt.fuera.delete(c.dataset.ctid) : bibCt.fuera.add(c.dataset.ctid); render(); });
  on('ctImp', ()=>{ const a = $('ctF1'), b = $('ctF2'); if(a) bibCt.f1 = a.value.trim(); if(b) bibCt.f2 = b.value.trim(); bibCertImprimir(); });
}
(()=>{ const ow = bibWire5; bibWire5 = function(){ ow(); bibWire6(); }; })();


/* ======================= (antes biblioteca6.js) ======================= */
/* =========================================================================
   SIGIE — Biblioteca (v10): plan lector medible
   -------------------------------------------------------------------------
     · 📖 Lecturas asignadas por aula, con fecha límite y avance (recibieron /
          devolvieron / atrasados). Reutiliza el préstamo por aula de la v8.
     · 🧠 Comprensión lectora con niveles de logro AD / A / B / C, informe por
          aula, grado y nivel (Excel). Solo la registra quien puede editar.
     · 🎯 Meta mensual de libros por aula, con barra de avance en Retos de lectura.
     · ⏳ Sanción proporcional al atraso (opcional, apagada por defecto).
   La lógica (avance, resúmenes, meta, sanción) está en bib-util.js y tiene
   pruebas; este archivo solo dibuja y guarda.
   Va después del bloque anterior y antes de ejemplo.js / app.js.
   ========================================================================= */

const B6 = { lec:'sigie:bib_lecturas', cmp:'sigie:bib_comprension', san:'sigie:bib_sanciones', met:'sigie:bib_metas' };
const bibLecturas = ()=>DB.get(B6.lec)||[], bibCompr = ()=>DB.get(B6.cmp)||[], bibSanciones = ()=>DB.get(B6.san)||[], bibMetas = ()=>DB.get(B6.met)||[];
const BIB_TITULOS6 = {
  bibLecturas:['Lecturas por aula','Un libro asignado a un aula con fecha límite y su avance'],
  bibCompr:['Comprensión lectora','Niveles de logro AD / A / B / C por aula y grado'],
  bibSanc:['Sanciones por atraso','Suspensión proporcional al atraso en la devolución']
};
const BIB_NIV_COLOR = { AD:'#1565c0', A:'#2e7d32', B:'#e0a100', C:'#c62828' };
const bibNivBadge = c => c ? `<span class="badge" style="background:${BIB_NIV_COLOR[c]||'#666'};color:#fff" title="${esc((SigieBib.NIVELES_LOGRO.find(n=>n.cod===c)||{}).nombre||'')}">${esc(c)}</span>` : '<span class="hint">—</span>';
const bibQuien = ()=>(typeof STATE!=='undefined' && STATE.session && (STATE.session.nombre||STATE.session.usuario)) || '';
const bibFechaCorta = f => f ? String(f).split('-').reverse().join('/') : '';

// Las claves nuevas se cargan junto con el resto de la biblioteca.
(()=>{ const oc = bibCargar; bibCargar = async function(){ await oc(); await Promise.all([DB.load(B6.lec, []), DB.load(B6.cmp, []), DB.load(B6.san, []), DB.load(B6.met, [])]); }; })();

// Excel (con CSV de respaldo si la librería de Excel no cargó, p. ej. sin internet).
function bibXlsx(archivo, hojas){
  if(typeof XLSX==='undefined'){ bibDescargar(archivo+'.csv', bibCsv(hojas[0][1])); return; }
  const wb = XLSX.utils.book_new(); hojas.forEach(([n,aoa])=>XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), n)); XLSX.writeFile(wb, archivo+'.xlsx');
}

/* =====================================================================
   1. LECTURAS ASIGNADAS POR AULA
   ===================================================================== */
const bibLc = { ver:'activas' };
function bibLecturasCalcTodas(){
  const tit = new Map(SigieBib.agruparTitulos(bibLibros(), null, bibEjemplares).map(t=>[t.clave, t]));
  const alumnos = bibLect().filter(x=>!x.baja && bibEsAlumno(x)), pres = bibPrest(), cmp = bibCompr(), hoy = today();
  return bibLecturas().map(l=>{
    const t = tit.get(l.titulo), ids = new Set(t ? t.items.map(i=>i.libro.id) : []);
    const av = SigieBib.avanceLectura({ lectura:l, alumnos:alumnos.filter(x=>bibGrupoDe(x)===l.aula), prestamos:pres, libroIds:ids, hoy, comprension:cmp });
    return { l, t, av };
  });
}
// Alumnos con una lectura asignada atrasada (para la insignia del menú y el aviso de Inicio).
function bibLecturasAtrasadasN(){
  try{ return bibLecturasCalcTodas().filter(x=>!x.av.completa).reduce((a,x)=>a+x.av.atrasados, 0); }catch(e){ return 0; }
}

function bibLecturaModal(){
  if(!guardEdit()) return;
  const aulas = bibGruposLector().filter(g=>!/^DOCENTES/.test(g.clave) && !/^SIN GRADO/.test(g.clave));
  if(!aulas.length){ toast('Primero registra lectores con su grado y sección (Lectores).','err'); return; }
  const titulos = SigieBib.agruparTitulos(bibLibros(), null, bibEjemplares);
  if(!titulos.length){ toast('Registra libros primero.','err'); return; }
  const norm = s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const opciones = q=>{ const k = norm(q).trim(); return titulos.filter(t=>!k || norm(t.titulo+' '+t.autor).includes(k)).slice(0,200); };
  const bg = bibModal('Asignar una lectura a un aula',
    `<div class="field f-6"><label>Aula</label><select id="lcAula">${aulas.map(g=>`<option value="${esc(g.clave)}">${esc(g.clave)} (${g.n})</option>`).join('')}</select></div>
     <div class="field f-6"><label>Fecha límite de devolución</label><input id="lcLim" type="date" min="${today()}" value="${bibEnDias(14)}"></div>
     <div class="field f-12"><label>Libro (busca por título o autor)</label><input id="lcQ" placeholder="Escribe parte del título…" autocomplete="off"><select id="lcTit" size="7" style="width:100%;margin-top:4px"></select><div class="hint" id="lcInfo"></div></div>
     <div class="field f-12"><label>Indicación para el aula (opcional)</label><input id="lcObs" maxlength="200" placeholder="Ej.: leer los capítulos 1 al 5 para la práctica de comprensión"></div>`,
    async bg=>{
      const aula = bibV(bg,'lcAula'), clave = bg.querySelector('#lcTit').value, limite = bibV(bg,'lcLim'), t = titulos.find(x=>x.clave===clave);
      if(!t){ toast('Elige el libro de la lista.','err'); return false; }
      if(!limite || limite < today()){ toast('La fecha límite debe ser hoy o una fecha futura.','err'); return false; }
      if(bibLecturasCalcTodas().some(x=>x.l.aula===aula && x.l.titulo===clave && !x.av.completa)){ toast('Esa aula ya tiene asignado este libro y aún no lo completa.','err'); return false; }
      await DB.save(B6.lec, [...bibLecturas(), { id:uid('lc'), aula, titulo:clave, libroTitulo:t.titulo, autor:t.autor||'', fecha:today(), limite, obs:bibV(bg,'lcObs').slice(0,200), docente:bibQuien() }]);
      registrarBitacora('Lectura asignada', aula+' · '+t.titulo+' · hasta '+limite); toast('Lectura asignada a '+aula+'.','ok'); render();
    }, 'Asignar lectura', '700px');
  const pintar = ()=>{
    const ops = opciones(bg.querySelector('#lcQ').value), sel = bg.querySelector('#lcTit'), previo = sel.value;
    sel.innerHTML = ops.map(t=>`<option value="${esc(t.clave)}">${esc(t.titulo)}${t.autor?' — '+esc(t.autor):''} (${t.total} ejemplar${t.total===1?'':'es'})</option>`).join('');
    if(ops.some(t=>t.clave===previo)) sel.value = previo; else if(ops.length) sel.selectedIndex = 0;
    bg.querySelector('#lcInfo').textContent = ops.length===200 ? 'Se muestran los primeros 200; escribe más letras para acotar.' : ops.length+' título(s).';
  };
  bg.querySelector('#lcQ').addEventListener('input', pintar); pintar();
}

function bibLecturaDetalle(id){
  const x = bibLecturasCalcTodas().find(r=>r.l.id===id); if(!x) return;
  const { l, av } = x, edit = canEdit();
  const estado = f=>{
    const mapa = { 'sin-recibir':['badge-warn','Sin recibir'], leyendo:['badge-good','Leyendo'], devuelto:['badge-good','Devuelto'], perdido:['badge-bad','Perdido'] };
    const m = mapa[f.estado]; return `<span class="badge ${f.atrasado?'badge-bad':m[0]}">${f.atrasado?'Atrasado · ':''}${m[1]}</span>${f.tarde?' <span class="hint">(devuelto con atraso)</span>':''}`;
  };
  const cuerpo = `<div class="hint" style="margin-bottom:6px"><b>${esc(l.libroTitulo)}</b>${l.autor?' — '+esc(l.autor):''} · ${esc(l.aula)} · asignada ${esc(bibFechaCorta(l.fecha))} · límite <b>${esc(bibFechaCorta(l.limite))}</b>${l.obs?' · '+esc(l.obs):''}</div>
    <div class="toolbar noprint" style="margin:6px 0"><span class="badge badge-good">${av.recibieron}/${av.total} recibieron</span><span class="badge badge-good">${av.devolvieron}/${av.total} devolvieron</span>${av.atrasados?`<span class="badge badge-bad">${av.atrasados} atrasado(s)</span>`:''}<span style="flex:1"></span>
      ${edit?'<button class="btn btn-sm" id="ldPres">👥 Prestar al aula</button>':''}<button class="btn btn-sm" id="ldXls">⇩ Excel</button></div>
    <div class="tbl-wrap" style="max-height:380px;overflow:auto"><table><thead><tr><th>Alumno</th><th>Estado</th><th>Prestado</th><th>Vence</th><th>Devuelto</th><th title="Nivel de comprensión (solo se puede registrar cuando ya devolvió)">Comprensión</th></tr></thead><tbody>${av.filas.map(f=>{
      const p = f.prestamo, puede = edit && f.estado==='devuelto';
      return `<tr><td>${esc(f.lector.nombre)}</td><td>${estado(f)}</td><td>${p?esc(bibFechaCorta(p.fecha)):'—'}</td><td>${p?esc(bibFechaCorta(p.vence)):'—'}</td><td>${p&&p.devuelto?esc(bibFechaCorta(p.devuelto)):'—'}</td>
        <td>${puede?`<select data-ldniv="${esc(p.id)}" data-ldini="${esc(f.nivel)}"><option value="">—</option>${SigieBib.NIVELES_LOGRO.map(n=>`<option value="${n.cod}" ${f.nivel===n.cod?'selected':''}>${n.cod} · ${esc(n.nombre)}</option>`).join('')}</select>`:bibNivBadge(f.nivel)}</td></tr>`; }).join('')||'<tr><td colspan="6" class="empty">No hay alumnos en esta aula.</td></tr>'}</tbody></table></div>
    ${edit?'<div class="hint" style="margin-top:6px">Elige el nivel de cada alumno que ya devolvió y pulsa <b>Guardar niveles</b>. Solo cambia lo que modifiques.</div>':''}`;
  const bg = bibModal('Avance de la lectura', cuerpo, async bg=>{
    if(!edit) return true;
    const cambios = [...bg.querySelectorAll('[data-ldniv]')].filter(s=>s.value!==s.dataset.ldini);
    if(!cambios.length) return true;
    if(!guardEdit()) return false;
    const tocados = new Set(cambios.map(s=>s.dataset.ldniv)), previos = new Map(bibCompr().filter(c=>tocados.has(c.prestId)).map(c=>[c.prestId,c]));
    const nuevos = [];
    for(const s of cambios){
      if(!s.value) continue;
      const f = av.filas.find(r=>r.prestamo && r.prestamo.id===s.dataset.ldniv), p = f.prestamo, ant = previos.get(p.id);
      nuevos.push({ ...(ant||{}), id:ant?ant.id:uid('cp'), prestId:p.id, libroId:p.libroId, lectorId:p.lectorId||'', lector:p.lector, grado:p.grado||f.lector.grado||'', nivel:s.value, obs:ant?ant.obs||'':'', fecha:today(), lecturaId:l.id, docente:bibQuien() });
    }
    await DB.save(B6.cmp, [...bibCompr().filter(c=>!tocados.has(c.prestId)), ...nuevos]);
    registrarBitacora('Comprensión lectora registrada', l.aula+' · '+l.libroTitulo+' · '+cambios.length+' alumno(s)'); toast('Niveles guardados.','ok'); render();
  }, edit?'Guardar niveles':'Cerrar', '920px');
  if(!edit){ const c = bg.querySelector('#bmC'); if(c) c.style.display = 'none'; }
  const b1 = bg.querySelector('#ldPres'); if(b1) b1.onclick = ()=>{ bg.remove(); const d = SigieBib.diasEntre(today(), l.limite); bibAulaModal({ aula:l.aula, titulo:l.titulo, dias:d>=1 ? Math.min(90,d) : 14, lecturaId:l.id }); };
  bg.querySelector('#ldXls').onclick = ()=>bibXlsx('lectura-'+today(), [['Avance', [['Aula',l.aula],['Libro',l.libroTitulo],['Fecha límite',l.limite],[],['Alumno','Estado','Prestado','Vence','Devuelto','Comprensión'],
    ...av.filas.map(f=>[f.lector.nombre, (f.atrasado?'Atrasado · ':'')+({ 'sin-recibir':'Sin recibir', leyendo:'Leyendo', devuelto:'Devuelto', perdido:'Perdido' })[f.estado], f.prestamo?f.prestamo.fecha:'', f.prestamo?f.prestamo.vence:'', f.prestamo?f.prestamo.devuelto||'':'', f.nivel])]]]);
}

function renderBibLecturas(){
  const todas = bibLecturasCalcTodas(), edit = canEdit();
  const lista = todas.filter(x=>bibLc.ver==='todas' || !x.av.completa).sort((a,b)=>(b.av.atrasados>0)-(a.av.atrasados>0) || String(a.l.limite||'9999').localeCompare(String(b.l.limite||'9999')) || a.l.aula.localeCompare(b.l.aula,'es'));
  const vigentes = todas.filter(x=>!x.av.completa), atras = vigentes.reduce((a,x)=>a+x.av.atrasados,0);
  return `<div class="toolbar noprint">${edit?'<button class="btn btn-primary" id="lcNueva">+ Asignar lectura a un aula</button><button class="btn" id="bibAula">👥 Préstamo por aula</button><button class="btn" id="bibAulaDev">↩ Devolución por aula</button>':''}
    <label class="hint">Mostrar: <select id="lcVer"><option value="activas" ${bibLc.ver==='activas'?'selected':''}>Pendientes</option><option value="todas" ${bibLc.ver==='todas'?'selected':''}>Todas (con las completas)</option></select></label>
    <button class="btn" id="lcXls">⇩ Excel</button><button class="btn" onclick="window.print()">🖨 Imprimir</button></div>
  <div class="hint" style="margin:6px 0">El docente asigna un libro a un aula con fecha límite. El préstamo se hace con <b>👥 Préstamo por aula</b> (botón <i>Prestar</i> de cada fila lo deja ya preparado) y el avance se calcula solo con los préstamos: <b>recibieron</b> el libro, <b>devolvieron</b> y <b>atrasados</b> (pasada la fecha límite sin devolver, lo hayan recibido o no). También cuenta el préstamo hecho por cuenta propia desde la fecha de asignación.</div>
  <div class="grid g4" style="margin:8px 0"><div class="card"><div class="kpi"><div class="lbl">Lecturas pendientes</div><div class="val">${vigentes.length}</div><div class="delta">de ${todas.length} asignadas</div></div></div>
    <div class="card"><div class="kpi"><div class="lbl">Alumnos atrasados</div><div class="val" ${atras?'style="color:var(--bad,#b3261e)"':''}>${atras}</div></div></div></div>
  <div class="tbl-wrap"><table><thead><tr><th>Aula</th><th>Libro</th><th>Asignada</th><th>Límite</th><th>Recibieron</th><th>Devolvieron</th><th>Atrasados</th><th>Avance</th><th class="noprint"></th></tr></thead><tbody>${lista.map(({l,av})=>`<tr>
    <td><b>${esc(l.aula)}</b><div class="hint">${esc(l.docente||'')}</div></td><td>${esc(l.libroTitulo)}<div class="hint">${esc(l.autor||'')}</div></td><td>${esc(bibFechaCorta(l.fecha))}</td>
    <td>${esc(bibFechaCorta(l.limite))}${av.completa?'':av.vencida?' <span class="badge badge-bad">vencida</span>':''}</td><td class="num">${av.recibieron}/${av.total}</td><td class="num">${av.devolvieron}/${av.total}</td>
    <td class="num">${av.completa?'<span class="badge badge-good">Completa</span>':av.atrasados?`<span class="badge badge-bad">${av.atrasados}</span>`:0}</td><td style="width:14%">${bibBar(av.pct,av.completa?'#2a7d4f':av.atrasados?'#c62828':'#14304d')}<div class="hint">${av.pct}% devuelto</div></td>
    <td class="noprint" style="white-space:nowrap"><button class="btn btn-sm" data-lcver="${esc(l.id)}">Ver</button>${edit?` <button class="btn btn-sm" data-lcpres="${esc(l.id)}" title="Prestar este libro al aula">Prestar</button> <button class="btn btn-sm btn-danger" data-lcdel="${esc(l.id)}" title="Quitar la asignación (no borra préstamos)">🗑</button>`:''}</td></tr>`).join('')
    ||`<tr><td colspan="9" class="empty">${todas.length?'No hay lecturas pendientes. ✅':'Todavía no hay lecturas asignadas. Usa “Asignar lectura a un aula”.'}</td></tr>`}</tbody></table></div>`;
}
function bibLecturasXls(){
  const todas = bibLecturasCalcTodas(); if(!todas.length){ toast('No hay lecturas para exportar.','err'); return; }
  bibXlsx('lecturas-por-aula-'+today(), [['Resumen', [['Aula','Libro','Autor','Asignada','Fecha límite','Alumnos','Recibieron','Devolvieron','Atrasados','% devuelto'],
      ...todas.map(({l,av})=>[l.aula,l.libroTitulo,l.autor||'',l.fecha,l.limite,av.total,av.recibieron,av.devolvieron,av.atrasados,av.pct])]],
    ['Por alumno', [['Aula','Libro','Alumno','Estado','Atrasado','Prestado','Vence','Devuelto','Comprensión'],
      ...todas.flatMap(({l,av})=>av.filas.map(f=>[l.aula,l.libroTitulo,f.lector.nombre,({ 'sin-recibir':'Sin recibir', leyendo:'Leyendo', devuelto:'Devuelto', perdido:'Perdido' })[f.estado],f.atrasado?'Sí':'',f.prestamo?f.prestamo.fecha:'',f.prestamo?f.prestamo.vence:'',f.prestamo?f.prestamo.devuelto||'':'',f.nivel]))]]]);
}

/* =====================================================================
   2. COMPRENSIÓN LECTORA (AD / A / B / C)
   ===================================================================== */
const bibCp = { per:'anio', cuanto:'seccion' };
const bibCpDesde = ()=>bibCp.per==='anio' ? bibInicioAnio() : bibCp.per==='90' ? bibEnDias(-90) : '';

// Ventana para registrar el nivel de un préstamo ya devuelto. `luego` se llama al cerrarla (guardando u omitiendo).
function bibComprPedir(prestId, luego, forzar){
  const fin = ()=>{ if(luego) luego(); };
  if(!canEdit()){ fin(); return; }
  const p = bibPrest().find(x=>x.id===prestId), l = p && bibLibros().find(x=>x.id===p.libroId);
  if(!p || !l){ fin(); return; }
  if(!SigieBib.parsearGrado(p.grado).esAlumno){ if(forzar) toast('La comprensión lectora se registra solo para alumnos.','err'); fin(); return; }
  if(bibCompr().some(c=>c.prestId===prestId)){ if(forzar) toast('Este préstamo ya tiene nivel de comprensión.','err'); fin(); return; }
  let niv = '';
  const pintar = bg=>bg.querySelectorAll('[data-cpniv]').forEach(b=>{ const on = b.dataset.cpniv===niv; b.style.background = on ? BIB_NIV_COLOR[niv] : ''; b.style.color = on ? '#fff' : ''; b.style.borderColor = BIB_NIV_COLOR[b.dataset.cpniv]; });
  const bg = bibModal('Comprensión del libro',
    `<div class="field f-12"><b>${esc(l.titulo)}</b> <span class="hint">· ${esc(l.cod)} · ${esc(p.lector)}${p.grado?' · '+esc(p.grado):''}</span></div>
     <div class="field f-12"><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">${SigieBib.NIVELES_LOGRO.map(n=>`<button type="button" class="btn" data-cpniv="${n.cod}" style="padding:10px 4px;border-width:2px;line-height:1.2"><span style="font-size:22px;font-weight:700">${n.cod}</span><br><span style="font-size:12px">${esc(n.nombre)}</span></button>`).join('')}</div>
       <div class="hint">Escala de logro: AD destacado · A esperado · B en proceso · C en inicio. Teclas A, B, C y D (= AD). Es opcional: “Omitir” no guarda nada.</div></div>
     <div class="field f-12"><label>Observación (opcional)</label><textarea id="cpObs" rows="2" maxlength="300" placeholder="Ej.: identifica la idea principal pero no infiere"></textarea></div>`,
    async bg=>{
      if(!niv){ toast('Elige AD, A, B o C, o pulsa Omitir.','err'); return false; }
      if(!guardEdit()) return false;
      if(bibCompr().some(c=>c.prestId===prestId)){ toast('Este préstamo ya tiene nivel de comprensión.','err'); return true; }
      await DB.save(B6.cmp, [...bibCompr(), { id:uid('cp'), prestId:p.id, libroId:l.id, lectorId:p.lectorId||'', lector:p.lector, grado:p.grado||'', nivel:niv, obs:bibV(bg,'cpObs').slice(0,300), fecha:today(), docente:bibQuien() }]);
      registrarBitacora('Comprensión lectora registrada', l.cod+' · '+p.lector+' · '+niv); toast('Nivel '+niv+' registrado.','ok'); render();
    }, 'Guardar nivel', '560px');
  bg.querySelector('#bmC').textContent = 'Omitir';
  bg.tabIndex = -1; bg.focus();   // para que las teclas A, B, C y D funcionen sin hacer clic antes
  bg.querySelectorAll('[data-cpniv]').forEach(b=>b.onclick=()=>{ niv = b.dataset.cpniv; pintar(bg); }); pintar(bg);
  bg.addEventListener('keydown', e=>{ if(e.target && e.target.tagName==='TEXTAREA') return; const k = String(e.key).toUpperCase(); const m = { A:'A', B:'B', C:'C', D:'AD' }[k]; if(m){ niv = m; pintar(bg); } });
  const quitar = bg.remove.bind(bg); bg.remove = ()=>{ quitar(); fin(); };
}

// Al devolver un libro (Mostrador y Préstamos): primero el nivel de comprensión (si está activado en Reglas) y después la reseña.
(()=>{ const orp = bibResenaPedir; bibResenaPedir = function(prestId, forzar){
  if(forzar || bibCfg().pedirComprension!==true || !canEdit()) return orp(prestId, forzar);
  const p = bibPrest().find(x=>x.id===prestId);
  if(!p || p.perdido || !p.devuelto || !SigieBib.parsearGrado(p.grado).esAlumno || bibCompr().some(c=>c.prestId===prestId)) return orp(prestId, forzar);
  bibComprPedir(prestId, ()=>{ orp(prestId, false); });
}; })();

function renderBibCompr(){
  const desde = bibCpDesde(), reg = bibCompr(), r = SigieBib.resumenComprension(reg, { desde, cuanto:bibCp.cuanto }), t = r.totales, edit = canEdit();
  const cfg = DB.get(KEYS.config)||{}, per = { anio:'Este año', '90':'Últimos 90 días', todo:'Todo el historial' }[bibCp.per];
  const lib = new Map(bibLibros().map(l=>[l.id,l]));
  const ult = reg.filter(c=>!desde || c.fecha>=desde).sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha)) || String(b.id).localeCompare(String(a.id))).slice(0,30);
  const sin = SigieBib.devolucionesSinComprension(bibPrest(), reg, bibEnDias(-60)).filter(p=>lib.has(p.libroId)).slice(0,15);
  const barra = f=>`<div style="display:flex;height:10px;border-radius:3px;overflow:hidden;min-width:110px;background:#e6e9ef">${['AD','A','B','C'].map(n=>f[n]?`<div title="${n}: ${f[n]}" style="width:${f[n]/f.total*100}%;background:${BIB_NIV_COLOR[n]}"></div>`:'').join('')}</div>`;
  const nombreGrupo = { seccion:'Grado y sección', grado:'Grado', nivel:'Nivel' }[bibCp.cuanto];
  return `<div class="toolbar noprint"><label class="hint">Periodo: <select id="cpPer">${[['anio','Este año'],['90','Últimos 90 días'],['todo','Todo el historial']].map(o=>`<option value="${o[0]}" ${bibCp.per===o[0]?'selected':''}>${o[1]}</option>`).join('')}</select></label>
    <label class="hint">Agrupar por: <select id="cpCuanto">${[['seccion','Grado y sección'],['grado','Grado'],['nivel','Nivel']].map(o=>`<option value="${o[0]}" ${bibCp.cuanto===o[0]?'selected':''}>${o[1]}</option>`).join('')}</select></label>
    <button class="btn" id="cpXls">⇩ Exportar Excel (UGEL)</button><button class="btn" onclick="window.print()">🖨 Imprimir</button>${isAdmin()?'<button class="btn" id="bibReglas">⚙ Reglas de préstamo</button>':''}</div>
  <div class="card" style="padding:10px 14px;margin:8px 0"><b>${esc(cfg.nombreIE||'Institución educativa')}</b> — Informe de comprensión lectora · ${esc(per)} · ${esc(bibFechaCorta(today()))}
    <div class="hint">Escala: ${SigieBib.NIVELES_LOGRO.map(n=>`<b>${n.cod}</b> ${esc(n.nombre)}`).join(' · ')}. El docente lo registra al devolver el libro (activar en <i>Reglas de préstamo</i>), en <i>Lecturas por aula</i> o desde la lista de abajo.${bibCfg().pedirComprension===true?'':' <b>Ahora no se pide automáticamente al devolver.</b>'}</div></div>
  <div class="grid g4" style="margin:8px 0"><div class="card"><div class="kpi"><div class="lbl">Evaluaciones</div><div class="val">${t.total}</div></div></div>
    <div class="card"><div class="kpi"><div class="lbl">En logro esperado o destacado (A + AD)</div><div class="val">${t.logro}%</div></div></div>
    <div class="card"><div class="kpi"><div class="lbl">En proceso (B)</div><div class="val">${t.B}</div></div></div>
    <div class="card"><div class="kpi"><div class="lbl">En inicio (C)</div><div class="val" ${t.C?'style="color:var(--bad,#b3261e)"':''}>${t.C}</div></div></div></div>
  <h3 style="margin:12px 0 6px">Por ${esc(nombreGrupo.toLowerCase())}</h3>
  <div class="tbl-wrap"><table><thead><tr><th>${esc(nombreGrupo)}</th><th>AD</th><th>A</th><th>B</th><th>C</th><th>Total</th><th>% A + AD</th><th></th></tr></thead><tbody>${r.filas.map(f=>`<tr><td><b>${esc(f.grupo)}</b></td><td class="num">${f.AD}</td><td class="num">${f.A}</td><td class="num">${f.B}</td><td class="num">${f.C?`<span class="badge badge-bad">${f.C}</span>`:0}</td><td class="num">${f.total}</td><td class="num">${f.logro}%</td><td style="width:20%">${barra(f)}</td></tr>`).join('')
    ||'<tr><td colspan="8" class="empty">Todavía no hay niveles registrados en este periodo.</td></tr>'}${r.filas.length>1?`<tr style="font-weight:700"><td>Total</td><td class="num">${t.AD}</td><td class="num">${t.A}</td><td class="num">${t.B}</td><td class="num">${t.C}</td><td class="num">${t.total}</td><td class="num">${t.logro}%</td><td></td></tr>`:''}</tbody></table></div>
  <h3 style="margin:18px 0 6px">Últimas evaluaciones</h3>
  <div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Libro</th><th>Alumno</th><th>Nivel</th><th>Observación</th>${edit?'<th class="noprint"></th>':''}</tr></thead><tbody>${ult.map(c=>{ const l = lib.get(c.libroId)||{}; return `<tr><td>${esc(bibFechaCorta(c.fecha))}</td><td><span class="mono">${esc(l.cod||'')}</span> ${esc(l.titulo||'(libro eliminado)')}</td><td>${esc(c.lector)}<div class="hint">${esc(c.grado||'')}</div></td><td>${bibNivBadge(c.nivel)}</td><td>${esc(c.obs||'')}</td>${edit?`<td class="noprint"><button class="btn btn-sm btn-danger" data-cpdel="${esc(c.id)}" title="Eliminar evaluación">🗑</button></td>`:''}</tr>`; }).join('')||`<tr><td colspan="${edit?6:5}" class="empty">Sin evaluaciones en este periodo.</td></tr>`}</tbody></table></div>
  ${edit?`<h3 style="margin:18px 0 6px" class="noprint">Devoluciones recientes sin evaluar</h3><div class="tbl-wrap noprint"><table><thead><tr><th>Devuelto</th><th>Libro</th><th>Alumno</th><th></th></tr></thead><tbody>${sin.map(p=>{ const l = lib.get(p.libroId)||{}; return `<tr><td>${esc(bibFechaCorta(p.devuelto))}</td><td><span class="mono">${esc(l.cod||'')}</span> ${esc(l.titulo||'')}</td><td>${esc(p.lector)}<div class="hint">${esc(p.grado||'')}</div></td><td><button class="btn btn-sm" data-cpnew="${esc(p.id)}">🧠 Evaluar</button></td></tr>`; }).join('')||'<tr><td colspan="4" class="empty">No hay devoluciones de los últimos 60 días pendientes de evaluar.</td></tr>'}</tbody></table></div>`:''}`;
}
function bibComprXlsx(){
  const desde = bibCpDesde(), reg = bibCompr().filter(c=>SigieBib.nivelLogroValido(c.nivel) && (!desde || c.fecha>=desde)); if(!reg.length){ toast('No hay evaluaciones para exportar.','err'); return; }
  const lib = new Map(bibLibros().map(l=>[l.id,l])), cfg = DB.get(KEYS.config)||{};
  const hoja = cuanto=>{ const r = SigieBib.resumenComprension(reg, { cuanto }), nom = { seccion:'Grado y sección', grado:'Grado', nivel:'Nivel' }[cuanto];
    return [[cfg.nombreIE||''],['Informe de comprensión lectora','Periodo desde',desde||'(todo)','Generado',today()],[],[nom,'AD','A','B','C','Total','% A + AD'],
      ...r.filas.map(f=>[f.grupo,f.AD,f.A,f.B,f.C,f.total,f.logro]), ['TOTAL',r.totales.AD,r.totales.A,r.totales.B,r.totales.C,r.totales.total,r.totales.logro]]; };
  bibXlsx('comprension-lectora-'+today(), [['Por aula', hoja('seccion')], ['Por grado', hoja('grado')], ['Por nivel', hoja('nivel')],
    ['Detalle', [['Fecha','Alumno','Grado','Cód.','Libro','Nivel','Descripción','Observación','Registrado por'],
      ...reg.sort((a,b)=>String(a.fecha).localeCompare(String(b.fecha))).map(c=>{ const l = lib.get(c.libroId)||{}; return [c.fecha,c.lector,c.grado||'',l.cod||'',l.titulo||'(libro eliminado)',c.nivel,(SigieBib.NIVELES_LOGRO.find(n=>n.cod===c.nivel)||{}).nombre||'',c.obs||'',c.docente||'']; })]]]);
}

/* =====================================================================
   3. SANCIÓN PROPORCIONAL AL ATRASO (opcional)
   ===================================================================== */
const bibSancCfg = ()=>bibCfg().sancion||{};
const bibSancVisible = ()=>!!bibSancCfg().activa || bibSanciones().length>0;
const bibSancVigentes = ()=>bibSancCfg().activa ? bibSanciones().filter(s=>!s.levantada && s.hasta>today()) : [];

// El bloqueo por sanción vive en la regla general de préstamo: la usan el Mostrador, Préstamos y el préstamo por aula.
(()=>{ const op = bibPuede; bibPuede = function(lec, nombre){
  const e = op(lec, nombre); if(e) return e;
  if(bibSancCfg().activa){ const s = SigieBib.sancionVigente(bibSanciones(), lec || { nombre }, today());
    if(s) return nombre+' está suspendido hasta el '+bibFechaCorta(s.hasta)+' por devolver con '+s.atraso+' día(s) de atraso.'; }
  return '';
}; })();

// Al devolver con atraso se registra la sanción (una sola vez por préstamo).
(()=>{ const od = bibDevolver; bibDevolver = async function(id){
  const p = await od(id); if(!p) return p;
  try{
    const act = bibPrest().find(x=>x.id===id), s = SigieBib.calcularSancion(act, today(), bibSancCfg());
    if(s && !bibSanciones().some(x=>x.prestId===id)){
      const vig = SigieBib.sancionVigente(bibSanciones(), { id:act.lectorId||'', nombre:act.lector }, today());
      const hasta = vig && vig.hasta > s.hasta ? vig.hasta : s.hasta;     // no se acumulan: queda la suspensión más larga
      await DB.save(B6.san, [...bibSanciones(), { id:uid('sn'), prestId:id, libroId:act.libroId, lectorId:act.lectorId||'', lector:act.lector, grado:act.grado||'', atraso:s.atraso, dias:s.dias, desde:today(), hasta, levantada:false }]);
      registrarBitacora('Sanción por atraso', act.lector+' · '+s.atraso+' día(s) de atraso · hasta '+hasta);
      toast(act.lector+' devolvió con '+s.atraso+' día(s) de atraso: no podrá llevar libros hasta el '+bibFechaCorta(hasta)+'.','err');
    }
  }catch(e){ console.error('Sanción por atraso:', e); }
  return p;
}; })();

function renderBibSanc(){
  const c = bibSancCfg(), lib = new Map(bibLibros().map(l=>[l.id,l])), edit = canEdit(), hoy = today();
  const vig = bibSancVigentes(), hist = bibSanciones().filter(s=>!vig.includes(s)).sort((a,b)=>String(b.desde).localeCompare(String(a.desde))).slice(0,50);
  const fila = (s,activa)=>{ const l = lib.get(s.libroId)||{}; return `<tr><td>${esc(s.lector)}<div class="hint">${esc(s.grado||'')}</div></td><td><span class="mono">${esc(l.cod||'')}</span> ${esc(l.titulo||'')}</td><td class="num">${s.atraso} d</td><td class="num">${s.dias} d</td><td>${esc(bibFechaCorta(s.desde))}</td><td>${esc(bibFechaCorta(s.hasta))}</td>${activa?(edit?`<td class="noprint"><button class="btn btn-sm" data-sanlev="${esc(s.id)}">Levantar</button></td>`:'<td></td>'):`<td>${s.levantada?'<span class="badge badge-warn">Levantada</span>':'<span class="badge badge-good">Cumplida</span>'}</td>`}</tr>`; };
  return `<div class="toolbar noprint">${isAdmin()?'<button class="btn" id="bibReglas">⚙ Reglas de préstamo</button>':''}<button class="btn" onclick="window.print()">🖨 Imprimir</button></div>
  <div class="hint" style="margin:6px 0">${c.activa?`Activada: al devolver un libro vencido, el lector no puede llevar otro durante <b>${c.factor||1}</b> día(s) por cada día de atraso (máximo <b>${c.maxDias||30}</b>). No se acumulan: queda la suspensión más larga. Se suma al bloqueo de quien todavía tiene un libro vencido en su poder.`:'<b>Apagada.</b> Es una política del colegio: se activa en <i>Reglas de préstamo</i> y solo afecta a las devoluciones que se hagan desde ese momento. Mientras esté apagada no suspende a nadie.'}</div>
  <h3 style="margin:12px 0 6px">Suspendidos hoy (${vig.length})</h3>
  <div class="tbl-wrap"><table><thead><tr><th>Lector</th><th>Libro</th><th>Atraso</th><th>Suspensión</th><th>Desde</th><th>Podrá llevar libros el</th><th class="noprint"></th></tr></thead><tbody>${vig.map(s=>fila(s,true)).join('')||'<tr><td colspan="7" class="empty">Nadie está suspendido. ✅</td></tr>'}</tbody></table></div>
  <h3 style="margin:18px 0 6px">Historial</h3>
  <div class="tbl-wrap"><table><thead><tr><th>Lector</th><th>Libro</th><th>Atraso</th><th>Suspensión</th><th>Desde</th><th>Hasta</th><th>Estado</th></tr></thead><tbody>${hist.map(s=>fila(s,false)).join('')||'<tr><td colspan="7" class="empty">Sin sanciones anteriores.</td></tr>'}</tbody></table></div>`;
}

/* =====================================================================
   4. META MENSUAL POR AULA (dentro de Retos de lectura)
   ===================================================================== */
const bibMt = { mes:'' };
const bibMtMes = ()=>bibMt.mes && /^\d{4}-\d{2}$/.test(bibMt.mes) ? bibMt.mes : today().slice(0,7);
function bibMetaHTML(){
  const mes = bibMtMes(), edit = canEdit();
  const r = SigieBib.metaMensual({ prestamos:bibPrest(), alumnos:bibLect().filter(x=>!x.baja && bibEsAlumno(x)), metas:bibMetas(), mes }), t = r.totales;
  return `<h3 style="margin:22px 0 6px">🎯 Meta mensual por aula</h3>
  <div class="toolbar noprint"><label class="hint">Mes: <input type="month" id="mtMes" value="${esc(mes)}"></label>
    ${edit?'<label class="hint">Fijar para todas las aulas: <input id="mtPorAlumno" type="number" min="0" max="20" step="0.5" value="1" style="width:64px"> libro(s) por alumno</label><button class="btn" id="mtAplicar">Aplicar a todas</button>':''}</div>
  <div class="hint" style="margin:6px 0">Libros <b>leídos</b> = devueltos dentro del mes (sin los perdidos). “En curso” = prestados este mes y todavía sin devolver. La meta es por aula y se puede cambiar cuando se quiera.${t.conMeta?` · <b>${t.cumplidas}</b> de ${t.conMeta} aula(s) con meta ya la cumplieron.`:''}</div>
  <div class="tbl-wrap"><table><thead><tr><th>Aula</th><th>Alumnos</th><th>Meta del mes</th><th>Leídos</th><th>En curso</th><th>Avance</th><th></th></tr></thead><tbody>${r.filas.map(f=>`<tr><td>${esc(f.aula)}</td><td class="num">${f.alumnos}</td>
    <td class="num">${edit?`<input type="number" min="0" max="999" data-mtaula="${esc(f.aula)}" value="${f.meta||''}" placeholder="—" style="width:70px">`:(f.meta||'—')}</td><td class="num">${f.leidos}</td><td class="num">${f.enCurso}</td>
    <td style="width:24%">${f.meta?bibBar(Math.min(100,f.pct),f.cumplida?'#2a7d4f':'#14304d'):'<span class="hint">Sin meta</span>'}</td><td>${f.meta?(f.cumplida?'<span class="badge badge-good">✅ Cumplida</span>':f.pct+'%'):''}</td></tr>`).join('')
    ||'<tr><td colspan="7" class="empty">Registra alumnos con su grado y sección para fijar metas.</td></tr>'}</tbody></table></div>`;
}
async function bibMetaGuardar(aula, libros){
  const n = Math.max(0, Math.min(999, Math.round(Number(libros))||0)), id = 'mt_'+aula;
  const otras = bibMetas().filter(m=>m.id!==id);
  await DB.save(B6.met, n ? [...otras, { id, aula, libros:n }] : otras);
}
(()=>{ const orr = BIB_RENDER.bibRetos; BIB_RENDER.bibRetos = ()=>orr() + bibMetaHTML(); })();

/* =====================================================================
   Conexión con los botones y el menú
   ===================================================================== */
Object.assign(BIB_RENDER, { bibLecturas:renderBibLecturas, bibCompr:renderBibCompr, bibSanc:renderBibSanc }); BIB_VIEWS.push('bibLecturas','bibCompr','bibSanc');
function bibWire7(){
  const $ = id=>document.getElementById(id), on = (id,fn)=>{ const e = $(id); if(e) e.addEventListener('click',fn); };
  // lecturas
  on('lcNueva', bibLecturaModal); on('lcXls', bibLecturasXls);
  if($('lcVer')) $('lcVer').onchange = e=>{ bibLc.ver = e.target.value; render(); };
  document.querySelectorAll('[data-lcver]').forEach(b=>b.onclick=()=>bibLecturaDetalle(b.dataset.lcver));
  document.querySelectorAll('[data-lcpres]').forEach(b=>b.onclick=()=>{ const l = bibLecturas().find(x=>x.id===b.dataset.lcpres); if(!l) return; const d = SigieBib.diasEntre(today(), l.limite);
    bibAulaModal({ aula:l.aula, titulo:l.titulo, dias:d>=1 ? Math.min(90,d) : 14, lecturaId:l.id }); });
  document.querySelectorAll('[data-lcdel]').forEach(b=>b.onclick=async()=>{ if(!guardEdit()) return; const l = bibLecturas().find(x=>x.id===b.dataset.lcdel); if(!l) return;
    if(!confirm('¿Quitar la lectura “'+l.libroTitulo+'” de '+l.aula+'? Los préstamos ya hechos no se borran.')) return;
    await DB.save(B6.lec, bibLecturas().filter(x=>x.id!==l.id)); registrarBitacora('Lectura quitada', l.aula+' · '+l.libroTitulo); render(); });
  // comprensión
  if($('cpPer')) $('cpPer').onchange = e=>{ bibCp.per = e.target.value; render(); };
  if($('cpCuanto')) $('cpCuanto').onchange = e=>{ bibCp.cuanto = e.target.value; render(); };
  on('cpXls', bibComprXlsx);
  document.querySelectorAll('[data-cpnew]').forEach(b=>b.onclick=()=>bibComprPedir(b.dataset.cpnew, null, true));
  document.querySelectorAll('[data-cpdel]').forEach(b=>b.onclick=async()=>{ if(!guardEdit()) return; if(!confirm('¿Eliminar esta evaluación de comprensión?')) return;
    await DB.save(B6.cmp, bibCompr().filter(c=>c.id!==b.dataset.cpdel)); registrarBitacora('Comprensión lectora eliminada', b.dataset.cpdel); render(); });
  // sanciones
  document.querySelectorAll('[data-sanlev]').forEach(b=>b.onclick=async()=>{ if(!guardEdit()) return; const s = bibSanciones().find(x=>x.id===b.dataset.sanlev); if(!s) return;
    if(!confirm('¿Levantar la sanción de '+s.lector+'? Podrá volver a llevar libros desde hoy.')) return;
    await DB.save(B6.san, bibSanciones().map(x=>x.id===s.id ? { ...x, levantada:true, levantadaPor:bibQuien(), levantadaFecha:today() } : x));
    registrarBitacora('Sanción levantada', s.lector); toast('Sanción levantada.','ok'); render(); });
  // meta mensual (en Retos de lectura)
  if($('mtMes')) $('mtMes').onchange = e=>{ bibMt.mes = e.target.value; render(); };
  document.querySelectorAll('[data-mtaula]').forEach(i=>i.onchange=async()=>{ if(!guardEdit()) return; await bibMetaGuardar(i.dataset.mtaula, i.value); render(); });
  on('mtAplicar', async ()=>{ if(!guardEdit()) return; const k = Number($('mtPorAlumno').value);
    if(!(k>=0)){ toast('Escribe cuántos libros por alumno.','err'); return; }
    const r = SigieBib.metaMensual({ prestamos:[], alumnos:bibLect().filter(x=>!x.baja && bibEsAlumno(x)), metas:[], mes:bibMtMes() });
    const aulas = r.filas.filter(f=>f.alumnos>0); if(!aulas.length){ toast('No hay aulas con alumnos.','err'); return; }
    const otras = bibMetas().filter(m=>!aulas.some(f=>'mt_'+f.aula===m.id));
    await DB.save(B6.met, [...otras, ...aulas.map(f=>({ id:'mt_'+f.aula, aula:f.aula, libros:Math.round(k*f.alumnos) })).filter(m=>m.libros>0)]);
    registrarBitacora('Meta mensual fijada', k+' libro(s) por alumno en '+aulas.length+' aula(s)'); toast('Metas fijadas para '+aulas.length+' aula(s).','ok'); render(); });
}
(()=>{ const ow = bibWire5; bibWire5 = function(){ ow(); bibWire7(); }; })();
