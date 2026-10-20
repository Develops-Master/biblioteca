/* =========================================================================
   SIGIE — Biblioteca: Diplomas con verificación y Tablero del director
   -------------------------------------------------------------------------
     · 🎖 Diplomas: se generan desde la biblioteca y el Lectómetro (libros
          leídos en el año, nivel de lector, comprensión AD) o a mano. Cada
          uno lleva código único + folio + QR de verificación; queda un
          registro con entrega, reimpresión como DUPLICADO y anulación.
     · 📊 Tablero del director: un solo panel con lo importante.
   La lógica (código, folio, duplicados, verificación) está en
   diplomas-util.js y tiene pruebas. El servidor responde /api/verificar
   sin pedir sesión y sin mostrar datos personales completos.
   Se carga después de lectometro.js.
   ========================================================================= */

const D7 = { dip:'sigie:bib_diplomas', cfg:'sigie:bib_diplomas_cfg' };
const bibDiplomas = ()=>DB.get(D7.dip)||[];
const bibDipCfg = ()=>({ urlBase:'', ciudad:'', firma1:'', firma2:'', ...(DB.get(D7.cfg)||{}) });
const BIB_TITULOS8 = {
  bibDipl:['Diplomas y verificación','Diplomas con código único y QR; registro de entrega y verificación de autenticidad'],
  bibDir:['Tablero del director','Resumen de la biblioteca, el Lectómetro, los diplomas y los respaldos']
};
(()=>{ const oc = bibCargar; bibCargar = async function(){ await oc(); await Promise.all([DB.load(D7.dip, []), DB.load(D7.cfg, {})]); }; })();

const dp = { ver:'generar', tipo:'lectometro', anio:String(new Date().getFullYear()), grupo:'', minLibros:6, minAD:2, nivelMin:1, sel:new Set(), q:'', fTipo:'', respaldos:null };
const DIP_TIPOS = { lectometro:'Nivel de lector (Lectómetro)', lector:'Lector del año (libros leídos)', comprension:'Comprensión lectora destacada', manual:'Diploma manual' };

// Libros distintos que el lector terminó en el año (bitácora + préstamos devueltos).
function dipLibrosAnio(l, anio){
  const s = new Set();
  bibBitacora().filter(b=>b.lectorId===l.id && String(b.fecha).startsWith(anio)).forEach(b=>s.add(b.libroId||'t:'+bibNorm(b.libroTitulo)));
  bibPrest().filter(p=>p.lectorId===l.id && p.devuelto && !p.perdido && String(p.devuelto).startsWith(anio)).forEach(p=>s.add(p.libroId));
  s.delete(''); s.delete('t:'); return s.size;
}
// Candidatos según el tipo elegido. Cada uno trae todo lo necesario para emitir.
function dipCandidatos(){
  const anio = dp.anio, out = [];
  for(const l of lmAlumnos()){
    if(dp.grupo && lmGrupo(l)!==dp.grupo) continue;
    let c = null;
    if(dp.tipo==='lectometro'){
      const r = lmResumen(l), n = r.nivel;
      if(n.indice>=dp.nivelMin) c = { clave:n.nombre, titulo:'Nivel '+n.nombre, motivo:'Por alcanzar el nivel «'+n.nombre+'» del Lectómetro de la biblioteca, con '+r.puntos+' puntos de lectura y '+r.libros+' libro(s) leído(s).', dato:n.icono+' '+n.nombre+' · '+r.puntos+' pts' };
    } else if(dp.tipo==='lector'){
      const k = dipLibrosAnio(l, anio);
      if(k>=dp.minLibros) c = { clave:String(dp.minLibros), titulo:'Lector del año '+anio, motivo:'Por su constancia y amor a la lectura: terminó '+k+' libros durante el año '+anio+'.', dato:k+' libros en '+anio };
    } else if(dp.tipo==='comprension'){
      const k = bibCompr().filter(x=>x.lectorId===l.id && x.nivel==='AD' && String(x.fecha).startsWith(anio)).length;
      if(k>=dp.minAD) c = { clave:'AD', titulo:'Comprensión lectora destacada', motivo:'Por alcanzar el nivel de logro destacado (AD) en comprensión lectora en '+k+' evaluaciones durante el año '+anio+'.', dato:k+' evaluaciones AD' };
    }
    if(c) out.push({ lector:l, ...c, tipo:dp.tipo, duplicado:SigieDip.diplomaDuplicado(bibDiplomas(), { lectorId:l.id, tipo:dp.tipo, clave:c.clave, anio }) });
  }
  return out.sort((a,b)=>lmGrupo(a.lector).localeCompare(lmGrupo(b.lector),'es',{numeric:true}) || a.lector.nombre.localeCompare(b.lector.nombre,'es'));
}

function dipUrlBase(){ const c = bibDipCfg(); return (c.urlBase||location.origin||'').replace(/\/+$/,''); }
function dipImprimir(emitidos, duplicado){
  const cfg = bibDipCfg(), ie = (DB.get(KEYS.config)||{}).nombreIE||'';
  const html = SigieDip.diplomasHTML(emitidos.map(d=>({ nombre:d.nombre, grado:d.grado, titulo:d.titulo, motivo:d.motivo, fecha:new Date(d.fecha+'T12:00:00').toLocaleDateString('es-PE',{day:'numeric',month:'long',year:'numeric'}), folio:SigieDip.folioTexto(d.folio,d.anio), codigo:d.codigo, duplicado })), { nombreIE:ie, firma1:cfg.firma1, firma2:cfg.firma2, ciudad:cfg.ciudad, urlBase:dipUrlBase(), qrImg:bibQrImg });
  const w = window.open('', '_blank'); if(!w){ toast('El navegador bloqueó la ventana. Permite ventanas emergentes para este sitio.','err'); return false; }
  w.document.write(html); w.document.close(); return true;
}

// Crea los registros (código único + folio correlativo del año) y guarda UNA sola vez.
async function dipEmitir(items){
  const anio = dp.anio; let todos = [...bibDiplomas()]; const nuevos = [];
  for(const it of items){
    if(SigieDip.diplomaDuplicado(todos, { lectorId:it.lector.id, tipo:it.tipo, clave:it.clave, anio })) continue;
    const d = { id:uid('dp'), codigo:SigieDip.codigoNuevo(todos), folio:SigieDip.siguienteFolio(todos, anio), anio:Number(anio), lectorId:it.lector.id, nombre:it.lector.nombre, grado:it.lector.grado||'', tipo:it.tipo, clave:it.clave, titulo:it.titulo, motivo:it.motivo, fecha:today(), emitidoPor:bibQuien(), entregado:'', reimpresiones:0 };
    todos.push(d); nuevos.push(d);
  }
  if(nuevos.length) await DB.save(D7.dip, todos);
  return nuevos;
}

/* ---------------- Pantalla de diplomas ---------------- */
function renderBibDipl(){
  const edit = canEdit();
  const tabs = `<div class="toolbar noprint">${['generar','registro','verificar','config'].map(v=>`<button class="btn ${dp.ver===v?'btn-primary':''}" data-dpver="${v}">${({generar:'🎖 Generar',registro:'📋 Registro ('+bibDiplomas().length+')',verificar:'🔍 Verificar',config:'⚙ Configuración'})[v]}</button>`).join('')}</div>`;
  if(dp.ver==='registro') return tabs + dipRegistro(edit);
  if(dp.ver==='verificar') return tabs + `<div class="hint" style="margin:6px 0">Escribe el código del diploma o escanea su QR. Aquí, con tu sesión, ves el detalle completo; quien escanee el QR sin sesión solo ve el nombre parcial.</div><div class="toolbar"><input class="search" id="dvCod" placeholder="D-XXXX-XXXX" style="text-transform:uppercase;min-width:240px"><button class="btn btn-primary" id="dvBuscar">Verificar</button><button class="btn" id="dvScan">📷 Escanear QR</button></div><div id="dvRes"></div>`;
  if(dp.ver==='config') return tabs + dipConfig(edit);
  const grupos = [...new Set(lmAlumnos().map(lmGrupo))].sort((a,b)=>a.localeCompare(b,'es',{numeric:true}));
  const cand = dp.tipo==='manual' ? [] : dipCandidatos(), libres = cand.filter(c=>!c.duplicado);
  const param = dp.tipo==='lectometro' ? `<div class="field"><label>Desde el nivel</label><select id="dgNiv">${SigieLec.NIVELES_LECTOR.slice(1).map((n,i)=>`<option value="${i+1}" ${dp.nivelMin===i+1?'selected':''}>${esc(n.icono)} ${esc(n.nombre)} (${n.min}+ pts)</option>`).join('')}</select></div>` : dp.tipo==='lector' ? `<div class="field"><label>Mínimo de libros en el año</label><input id="dgMin" type="number" min="1" max="200" value="${dp.minLibros}" style="width:90px"></div>` : dp.tipo==='comprension' ? `<div class="field"><label>Mínimo de evaluaciones AD</label><input id="dgAD" type="number" min="1" max="50" value="${dp.minAD}" style="width:90px"></div>` : '';
  return tabs + `<div class="toolbar noprint"><select id="dgTipo">${Object.entries(DIP_TIPOS).map(([k,v])=>`<option value="${k}" ${dp.tipo===k?'selected':''}>${esc(v)}</option>`).join('')}</select><select id="dgAnio">${[0,1,2].map(i=>String(new Date().getFullYear()-i)).map(a=>`<option ${dp.anio===a?'selected':''}>${a}</option>`).join('')}</select><select id="dgGrupo"><option value="">Todas las aulas</option>${grupos.map(g=>`<option value="${esc(g)}" ${dp.grupo===g?'selected':''}>${esc(g)}</option>`).join('')}</select>${edit&&dp.tipo==='manual'?'<button class="btn btn-primary" id="dgManual">+ Diploma manual</button>':''}</div>
  ${param?`<div class="toolbar noprint">${param}</div>`:''}
  ${dp.tipo==='manual'?'<div class="hint">Para un reconocimiento especial (mejor reseña, feria del libro…) usa “+ Diploma manual”: eliges al lector y escribes el motivo.</div>':`<div class="hint" style="margin:6px 0">${cand.length} candidato(s) · ${libres.length} sin diploma este año${cand.length-libres.length?' · '+(cand.length-libres.length)+' ya emitido(s) (no se repiten)':''}. Marca a quienes recibirán diploma.</div>
  ${cand.length?`<div class="tbl-wrap"><table><thead><tr><th class="noprint"><input type="checkbox" id="dgTodos" title="Marcar todos"></th><th>Lector</th><th>Aula</th><th>Mérito</th><th>Estado</th></tr></thead><tbody>${cand.map(c=>`<tr><td class="noprint"><input type="checkbox" data-dgsel="${esc(c.lector.id)}" ${c.duplicado?'disabled':''} ${dp.sel.has(c.lector.id)&&!c.duplicado?'checked':''}></td><td>${esc(c.lector.nombre)}</td><td>${esc(lmGrupo(c.lector))}</td><td>${esc(c.dato)}</td><td>${c.duplicado?`<span class="badge badge-good">Ya emitido · ${esc(SigieDip.folioTexto(c.duplicado.folio,c.duplicado.anio))}</span>`:'<span class="badge badge-warn">Pendiente</span>'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="hint">Nadie cumple todavía con ese criterio. Prueba con un mínimo menor u otro año.</div>'}
  ${edit&&libres.length?`<div class="toolbar noprint" style="margin-top:10px"><button class="btn btn-primary" id="dgEmitir">🎖 Emitir e imprimir los marcados (${[...dp.sel].filter(id=>libres.some(c=>c.lector.id===id)).length})</button></div>`:''}`}`;
}
function dipRegistro(edit){
  const anios = [...new Set(bibDiplomas().map(d=>String(d.anio)))].sort().reverse();
  let lista = bibDiplomas().filter(d=>(!dp.fTipo||d.tipo===dp.fTipo)&&(!dp.anioReg||String(d.anio)===dp.anioReg));
  const q = bibNorm(dp.q); if(q) lista = lista.filter(d=>bibNorm(d.nombre+' '+d.codigo+' '+d.titulo).includes(q));
  lista = lista.sort((a,b)=>b.anio-a.anio||b.folio-a.folio);
  return `<div class="toolbar noprint"><input class="search" id="drQ" placeholder="Buscar por nombre o código…" value="${esc(dp.q)}"><select id="drTipo"><option value="">Todos los tipos</option>${Object.entries(DIP_TIPOS).map(([k,v])=>`<option value="${k}" ${dp.fTipo===k?'selected':''}>${esc(v)}</option>`).join('')}</select><select id="drAnio"><option value="">Todos los años</option>${anios.map(a=>`<option ${dp.anioReg===a?'selected':''}>${a}</option>`).join('')}</select><button class="btn" id="drXls">⇩ Excel</button></div>
  ${lista.length?`<div class="tbl-wrap"><table><thead><tr><th>Folio</th><th>Código</th><th>Lector</th><th>Aula</th><th>Diploma</th><th>Emitido</th><th>Entrega</th><th class="noprint"></th></tr></thead><tbody>${lista.slice(0,300).map(d=>`<tr ${d.anulado?'style="opacity:.55;text-decoration:line-through"':''}><td>${esc(SigieDip.folioTexto(d.folio,d.anio))}</td><td><code>${esc(d.codigo)}</code></td><td>${esc(d.nombre)}</td><td>${esc(d.grado||'')}</td><td>${esc(d.titulo)}</td><td>${esc(bibFechaCorta(d.fecha))}${d.reimpresiones?` <span class="hint">(${d.reimpresiones} reimp.)</span>`:''}</td><td>${d.anulado?'<span class="badge badge-bad">Anulado</span>':d.entregado?`<span class="badge badge-good">${esc(bibFechaCorta(d.entregado))}</span>${d.recibidoPor?`<div class="hint">${esc(d.recibidoPor)}</div>`:''}`:'<span class="badge badge-warn">Sin entregar</span>'}</td><td class="noprint">${d.anulado?'':`<button class="btn" data-dpre="${esc(d.id)}" title="Reimprimir como DUPLICADO">🖨</button>${edit&&!d.entregado?` <button class="btn" data-dpent="${esc(d.id)}">✔ Entregar</button>`:''}${isAdmin()?` <button class="btn" data-dpanu="${esc(d.id)}" title="Anular">⛔</button>`:''}`}</td></tr>`).join('')}</tbody></table></div>`:'<div class="hint">Todavía no se ha emitido ningún diploma.</div>'}`;
}
function dipConfig(edit){
  const c = bibDipCfg(), base = dipUrlBase(), local = /localhost|127\.0\.0\.1/.test(base);
  return `<div class="hint" style="margin:6px 0">El QR del diploma abre <code>${esc(base)}/verificar.html?c=CÓDIGO</code>. ${local?'<b style="color:var(--bad,#b3261e)">Ahora apunta a localhost: desde un celular ese enlace NO abriría.</b> Escribe abajo la dirección del servidor en la red del colegio (por ejemplo http://192.168.1.20:3000, con SIGIE_LAN=1) o la web institucional donde publiques la verificación.':'Verifica que esa dirección se pueda abrir desde el celular de una familia.'}</div>
  <div class="card" style="padding:12px;max-width:640px"><div class="field"><label>Dirección base para el QR</label><input id="dcUrl" value="${esc(c.urlBase)}" placeholder="${esc(location.origin)}" ${edit?'':'disabled'}></div><div class="field"><label>Ciudad (aparece junto a la fecha)</label><input id="dcCiu" value="${esc(c.ciudad)}" ${edit?'':'disabled'}></div><div class="field"><label>Firma izquierda (cargo)</label><input id="dcF1" value="${esc(c.firma1)}" placeholder="Responsable de la biblioteca" ${edit?'':'disabled'}></div><div class="field"><label>Firma derecha (cargo)</label><input id="dcF2" value="${esc(c.firma2)}" placeholder="Dirección" ${edit?'':'disabled'}></div>${edit?'<button class="btn btn-primary" id="dcGuardar">Guardar</button>':''}</div>`;
}
async function dipVerificarLocal(texto){
  const cod = SigieDip.normalizarCodigo(texto), out = document.getElementById('dvRes'); if(!out) return;
  if(!cod){ out.innerHTML = '<div class="hint" style="color:var(--bad,#b3261e)">El código no tiene el formato correcto (D-XXXX-XXXX).</div>'; return; }
  const d = bibDiplomas().find(x=>x.codigo===cod);
  out.innerHTML = !d ? '<div class="card" style="padding:12px;border-left:4px solid var(--bad,#b3261e)"><b>✖ No existe ningún diploma con el código '+esc(cod)+'.</b></div>'
    : `<div class="card" style="padding:12px;border-left:4px solid ${d.anulado?'var(--bad,#b3261e)':'var(--good,#1b7f3b)'}"><b>${d.anulado?'⛔ Diploma ANULADO':'✔ Diploma auténtico'}</b><div style="margin-top:6px">${esc(d.nombre)} · ${esc(d.grado||'')}<br>${esc(d.titulo)} · ${esc(SigieDip.folioTexto(d.folio,d.anio))}<br>Emitido el ${esc(bibFechaCorta(d.fecha))} por ${esc(d.emitidoPor||'—')}<br>${d.anulado?'Anulado'+(d.motivoAnulacion?': '+esc(d.motivoAnulacion):''):d.entregado?'Entregado el '+esc(bibFechaCorta(d.entregado))+(d.recibidoPor?' a '+esc(d.recibidoPor):''):'Aún sin entregar'}</div></div>`;
}

/* ---------------- Tablero del director ---------------- */
async function dirCargarRespaldos(){
  if(!isAdmin() || typeof STORAGE_MODE==='undefined' || STORAGE_MODE!=='servidor') return;
  try{ const r = await fetch('/api/respaldos', { credentials:'same-origin' }); if(r.ok){ dp.respaldos = await r.json(); if(STATE.view==='bibDir') render(); } }catch(e){}
}
function renderBibDir(){
  const hoy = today(), anio = String(new Date().getFullYear()), desde30 = bibEnDias(-30);
  const prest = bibPrest(), vencidos = prest.filter(bibVencido), alumnos = lmAlumnos(), bit = bibBitacora();
  const activos = new Set([...bit.filter(b=>b.fecha>=desde30).map(b=>b.lectorId), ...prest.filter(p=>p.fecha>=desde30).map(p=>p.lectorId)].filter(Boolean)).size;
  const cmp = bibCompr().filter(c=>String(c.fecha).startsWith(anio)), logro = cmp.length ? Math.round(cmp.filter(c=>c.nivel==='A'||c.nivel==='AD').length/cmp.length*100) : null;
  const rk = lmRanking(), porAula = [...new Set(rk.map(f=>f.grupo))].map(g=>{ const f = rk.filter(x=>x.grupo===g), al = alumnos.filter(x=>lmGrupo(x)===g).length; return { g, prom:al?Math.round(f.reduce((a,x)=>a+x.puntos,0)/al):0 }; }).sort((a,b)=>b.prom-a.prom).slice(0,5);
  const dips = bibDiplomas().filter(d=>!d.anulado && String(d.anio)===anio), sinEntregar = dips.filter(d=>!d.entregado).length;
  const alertas = (typeof bibNotificaciones==='function' ? bibNotificaciones() : []);
  const rs = dp.respaldos, ext = rs && rs.externo;
  const copia = !rs ? '<span class="hint">Disponible con el servidor local (solo administradores).</span>' : `Último respaldo del servidor: <b>${esc(rs.ultimoLocal ? bibFechaCorta(rs.ultimoLocal) : 'ninguno')}</b>. Copia externa: ${ext.configurado ? (ext.ok===false ? '<b style="color:var(--bad,#b3261e)">FALLÓ</b> ('+esc(ext.error)+')' : ext.ok ? '<b>correcta</b> ('+esc(bibFechaCorta(String(ext.fecha).slice(0,10)))+')' : 'aún no se ha hecho hoy') : '<b style="color:var(--bad,#b3261e)">no configurada</b> — si el disco de esta PC falla se pierde todo. Define SIGIE_BACKUP_DIR con una carpeta de otro disco o USB.'}${ext&&ext.configurado&&isAdmin()?' <button class="btn" id="dirCopiar">Copiar ahora</button>':''}`;
  const kpi = (l,v,d)=>`<div class="card"><div class="kpi"><div class="lbl">${l}</div><div class="val">${v}</div>${d?`<div class="delta">${d}</div>`:''}</div></div>`;
  return `<div class="grid g4" style="margin:8px 0">${kpi('Libros en catálogo', bibLibros().length)}${kpi('Préstamos vigentes', prest.filter(p=>!p.devuelto).length, vencidos.length+' vencido(s)')}${kpi('Lectores activos (30 días)', activos, 'de '+alumnos.length+' alumnos')}${kpi('Lecturas en el Lectómetro', bit.filter(b=>b.fecha>=desde30).length, 'últimos 30 días')}
  ${kpi('Comprensión A + AD', logro===null?'—':logro+'%', cmp.length+' evaluaciones en '+anio)}${kpi('Diplomas '+anio, dips.length, sinEntregar+' sin entregar')}${kpi('Premios por entregar', bibCanjes().filter(c=>c.estado==='pendiente').length)}${kpi('Actividades (7 días)', SigieLec.actividadesProximas(bibActivs(), hoy, 7).length)}</div>
  <div class="card" style="padding:12px;margin:8px 0"><b>💾 Respaldos</b><div style="margin-top:4px">${copia}</div></div>
  <div class="grid g2" style="margin:8px 0"><div><h3 style="margin:8px 0 6px">Aulas que más leen (puntos por alumno)</h3>${porAula.length?`<div class="tbl-wrap"><table><thead><tr><th>Aula</th><th>Promedio</th></tr></thead><tbody>${porAula.map(a=>`<tr><td>${esc(a.g)}</td><td class="num">${a.prom}</td></tr>`).join('')}</tbody></table></div>`:'<div class="hint">Sin lecturas registradas.</div>'}</div>
  <div><h3 style="margin:8px 0 6px">Alertas</h3>${alertas.length?`<div class="tbl-wrap"><table><tbody>${alertas.map(a=>`<tr><td>${esc(a.ic)}</td><td>${esc(a.texto)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="hint">Todo en orden. 👍</div>'}</div></div>`;
}

/* ---------------- Conexión ---------------- */
function bibNavLectometro(){
  return {grp:'Lectómetro y diplomas', items:[
    {id:'bibLectom', ic:'📈', label:'Lectómetro (bitácora y puntos)'},
    {id:'bibEval', ic:'📝', label:'Evaluaciones de lectura'},
    {id:'bibRank', ic:'🏆', label:'Ranking y niveles'},
    {id:'bibPremios', ic:'🎁', label:'Premios y canjes', badge:bibCanjes().filter(c=>c.estado==='pendiente').length||null},
    {id:'bibActiv', ic:'📅', label:'Plan lector: actividades', badge:bibActivasN()||null},
    {id:'bibDipl', ic:'🎖', label:'Diplomas y verificación', badge:bibDiplomas().filter(d=>!d.anulado&&!d.entregado).length||null},
    {id:'bibDir', ic:'📊', label:'Tablero del director'}
  ]};
}
Object.assign(BIB_RENDER, { bibDipl:renderBibDipl, bibDir:renderBibDir });
BIB_VIEWS.push('bibDipl','bibDir');

function bibWire9(){
  const $ = id=>document.getElementById(id), on = (id,fn)=>{ const e = $(id); if(e) e.addEventListener('click',fn); };
  document.querySelectorAll('[data-dpver]').forEach(b=>b.onclick=()=>{ dp.ver = b.dataset.dpver; render(); });
  const sel = (id,fn)=>{ const e = $(id); if(e) e.onchange = ev=>{ fn(ev.target.value); dp.sel = new Set(); render(); }; };
  sel('dgTipo', v=>dp.tipo=v); sel('dgAnio', v=>dp.anio=v); sel('dgGrupo', v=>dp.grupo=v); sel('dgNiv', v=>dp.nivelMin=Number(v));
  sel('dgMin', v=>dp.minLibros=Math.max(1,Math.round(Number(v))||1)); sel('dgAD', v=>dp.minAD=Math.max(1,Math.round(Number(v))||1));
  document.querySelectorAll('[data-dgsel]').forEach(c=>c.onchange=()=>{ c.checked ? dp.sel.add(c.dataset.dgsel) : dp.sel.delete(c.dataset.dgsel); const n = $('dgEmitir'); if(n) n.textContent = '🎖 Emitir e imprimir los marcados ('+[...document.querySelectorAll('[data-dgsel]:checked')].length+')'; });
  if($('dgTodos')) $('dgTodos').onchange = e=>{ document.querySelectorAll('[data-dgsel]:not(:disabled)').forEach(c=>{ c.checked = e.target.checked; e.target.checked ? dp.sel.add(c.dataset.dgsel) : dp.sel.delete(c.dataset.dgsel); }); const n = $('dgEmitir'); if(n) n.textContent = '🎖 Emitir e imprimir los marcados ('+document.querySelectorAll('[data-dgsel]:checked').length+')'; };
  on('dgEmitir', async()=>{
    if(!guardEdit()) return;
    const elegidos = dipCandidatos().filter(c=>!c.duplicado && dp.sel.has(c.lector.id));
    if(!elegidos.length){ toast('Marca al menos un lector.','err'); return; }
    if(!confirm('Se emitirán '+elegidos.length+' diploma(s) con código y folio. Después no se pueden repetir para la misma persona este año. ¿Continuar?')) return;
    const nuevos = await dipEmitir(elegidos); if(!nuevos.length){ toast('No se emitió nada: ya tenían su diploma.','err'); return; }
    registrarBitacora('Diplomas emitidos', nuevos.length+' · '+DIP_TIPOS[dp.tipo]+' · '+dp.anio); dp.sel = new Set(); dipImprimir(nuevos, false); render();
  });
  on('dgManual', ()=>{
    if(!guardEdit()) return;
    const bg = bibModal('Diploma manual', lmCampoLector('dmLec','')+`<div class="field f-12"><label>Título del diploma</label><input id="dmT" maxlength="80" placeholder="Mejor reseña del año"></div><div class="field f-12"><label>Motivo</label><textarea id="dmM" rows="3" maxlength="300" placeholder="Por …"></textarea></div>`, async bg=>{
      const l = lmBuscarLector(bg.querySelector('#dmLec').value), titulo = bibV(bg,'dmT'), motivo = bibV(bg,'dmM');
      if(!l){ toast('Elige un lector de la lista o escanea su carné.','err'); return false; } if(!titulo||!motivo){ toast('Escribe el título y el motivo.','err'); return false; }
      const nuevos = await dipEmitir([{ lector:l, tipo:'manual', clave:bibNorm(titulo), titulo, motivo }]);
      if(!nuevos.length){ toast('Ese lector ya tiene un diploma con ese título este año.','err'); return false; }
      registrarBitacora('Diploma manual emitido', l.cod+' · '+titulo); dipImprimir(nuevos, false); render();
    }, 'Emitir e imprimir', '560px'); lmWireCampoLector(bg);
  });
  // Registro
  if($('drQ')) $('drQ').oninput = e=>{ dp.q = e.target.value; const p = e.target.selectionStart; render(); const n = $('drQ'); if(n){ n.focus(); n.setSelectionRange(p,p); } };
  if($('drTipo')) $('drTipo').onchange = e=>{ dp.fTipo = e.target.value; render(); }; if($('drAnio')) $('drAnio').onchange = e=>{ dp.anioReg = e.target.value; render(); };
  on('drXls', ()=>{ const l = bibDiplomas(); if(!l.length){ toast('No hay diplomas para exportar.','err'); return; } bibXlsx('biblioteca-diplomas-'+today(), [['Diplomas', [['Folio','Código','Lector','Aula','Diploma','Emitido','Entregado','Recibido por','Estado'], ...l.map(d=>[SigieDip.folioTexto(d.folio,d.anio),d.codigo,d.nombre,d.grado||'',d.titulo,d.fecha,d.entregado||'',d.recibidoPor||'',d.anulado?'Anulado':'Vigente'])]]]); });
  document.querySelectorAll('[data-dpre]').forEach(b=>b.onclick=async()=>{ const d = bibDiplomas().find(x=>x.id===b.dataset.dpre); if(!d) return;
    if(!confirm('Se imprimirá una copia marcada como DUPLICADO con el mismo código y folio. ¿Continuar?')) return;
    if(dipImprimir([d], true) && canEdit()){ await DB.save(D7.dip, bibDiplomas().map(x=>x.id===d.id?{...x, reimpresiones:(x.reimpresiones||0)+1}:x)); registrarBitacora('Diploma reimpreso (duplicado)', d.codigo); render(); } });
  document.querySelectorAll('[data-dpent]').forEach(b=>b.onclick=()=>{ if(!guardEdit()) return; const d = bibDiplomas().find(x=>x.id===b.dataset.dpent); if(!d) return;
    bibModal('Entrega de diploma', `<div class="field f-12"><b>${esc(d.nombre)}</b> · ${esc(d.titulo)}</div><div class="field f-6"><label>Fecha de entrega</label><input id="deF" type="date" value="${today()}"></div><div class="field f-6"><label>Recibido por</label><input id="deR" maxlength="80" placeholder="El propio alumno / apoderado"></div>`, async bg=>{
      await DB.save(D7.dip, bibDiplomas().map(x=>x.id===d.id?{...x, entregado:bibV(bg,'deF')||today(), recibidoPor:bibV(bg,'deR')}:x)); registrarBitacora('Diploma entregado', d.codigo); render(); }, 'Registrar entrega', '460px'); });
  document.querySelectorAll('[data-dpanu]').forEach(b=>b.onclick=async()=>{ if(!isAdmin()) return; const d = bibDiplomas().find(x=>x.id===b.dataset.dpanu); if(!d) return;
    const m = prompt('Motivo de la anulación del diploma '+d.codigo+' (queda registrado; el número de folio no se reutiliza):'); if(m===null) return; if(!m.trim()){ toast('Escribe el motivo.','err'); return; }
    await DB.save(D7.dip, bibDiplomas().map(x=>x.id===d.id?{...x, anulado:true, motivoAnulacion:m.trim().slice(0,200), anuladoEl:today()}:x)); registrarBitacora('Diploma anulado', d.codigo+' · '+m.trim()); render(); });
  // Verificar
  const ver = ()=>dipVerificarLocal($('dvCod').value);
  on('dvBuscar', ver); if($('dvCod')) $('dvCod').addEventListener('keydown', e=>{ if(e.key==='Enter') ver(); });
  on('dvScan', ()=>bibEscanearUno(c=>{ $('dvCod').value = c; dipVerificarLocal(c); }));
  // Configuración
  on('dcGuardar', async()=>{ if(!guardEdit()) return; const url = $('dcUrl').value.trim();
    if(url && !/^https?:\/\/[^\s]+$/i.test(url)){ toast('La dirección debe empezar con http:// o https://','err'); return; }
    await DB.save(D7.cfg, { urlBase:url, ciudad:$('dcCiu').value.trim(), firma1:$('dcF1').value.trim(), firma2:$('dcF2').value.trim() }); registrarBitacora('Configuración de diplomas', url||'(sin dirección)'); toast('Guardado.','ok'); render(); });
  // Tablero
  on('dirCopiar', async()=>{ try{ const r = await fetch('/api/respaldos/copiar', { method:'POST', credentials:'same-origin' }), d = await r.json(); toast(r.ok?'Copia externa realizada.':(d.error||(d.externo&&d.externo.error)||'No se pudo copiar.'), r.ok?'ok':'err'); }catch(e){ toast('No se pudo comunicar con el servidor.','err'); } dirCargarRespaldos(); });
  if(STATE.view==='bibDir' && dp.respaldos===null) dirCargarRespaldos();
}
(()=>{ const ow = bibWire5; bibWire5 = function(){ ow(); bibWire9(); }; })();

// Aviso en la campanita: diplomas emitidos que nadie ha recibido, y copia externa que falló.
(()=>{ const on = bibNotificaciones; bibNotificaciones = function(){
  const g = on(), sin = bibDiplomas().filter(d=>!d.anulado && !d.entregado && d.fecha < bibEnDias(-14)).length;
  if(sin) g.push({ ic:'🎖', n:sin, texto:sin+' diploma(s) emitido(s) hace más de 2 semanas siguen sin entregar.', view:'bibDipl', nivel:'warn' });
  const ext = dp.respaldos && dp.respaldos.externo; if(ext && ext.configurado && ext.ok===false) g.push({ ic:'💾', n:1, texto:'La copia externa del respaldo falló: '+ext.error, view:'bibDir', nivel:'bad' });
  return g; }; })();
