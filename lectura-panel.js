/* =========================================================================
   SIGIE — Biblioteca v13: panel «Mi lectura» y gráficos del tablero
     · 📖 Mi lectura (grupo Lectómetro y diplomas): el personal busca al lector (o escanea
       su carné) y ve su meta mensual de libros, la tendencia de 14 días y libros
       recomendados que están disponibles. No hay inicio de sesión de estudiantes ni de
       familias: los datos de menores no salen de la biblioteca.
     · 📊 Gráficos en el Tablero del director: lecturas por día, préstamos por mes,
       comprensión AD/A/B/C y aulas que más leen.
   La lógica está en panel-util.js (con pruebas); este archivo solo dibuja.
   Se carga después de mejoras.js y antes de ejemplo.js / app.js.
   ========================================================================= */
const pl = { lectorId:'', q:'' };
Object.assign(BIB_TITULOS7, {
  bibMiLec:['Mi lectura','Meta del mes, tendencia de 14 días y libros recomendados para cada lector']
});

const plLector = ()=> pl.lectorId ? lmLector(pl.lectorId) : null;
function plMetaAula(l){
  const g = lmGrupo(l), m = bibMetas().find(x=>x.aula===g);
  return m && Number(m.libros) > 0 ? { libros:Number(m.libros), deAula:true } : { libros:null, deAula:false };
}
function plResumen(l){
  const ma = plMetaAula(l);
  return SigieLec.resumenLector({ lector:l, bitacora:bibBitacora(), prestamos:bibPrest(), comprension:bibCompr(), resenas:bibResenas(), canjes:bibCanjes(), premios:bibPremios(), hoy:today(), metaLibros:ma.libros });
}
const plElegir = l => { pl.lectorId = l ? l.id : ''; pl.q = ''; render(); };

function plRecomendaciones(l, max){
  return SigiePanel.recomendar({ lector:l, libros:bibLibros(), categorias:bibCats(), prestamos:bibPrest(), bitacora:bibBitacora(), resenas:bibResenas(), max,
    libres:x=>Math.max(0, bibEjemplares(x) - bibPrestados(x.id)) });
}

function renderBibMiLec(){
  const l = plLector(), edit = canEdit();
  const barra = `<div class="toolbar noprint"><input class="search" id="plQ" list="lmLecDL" placeholder="Buscar lector por nombre o código…" autocomplete="off" value="${l?esc(l.cod+' — '+l.nombre):esc(pl.q)}" style="min-width:280px"><button class="btn" id="plScan">📷 Escanear carné</button>${l?'<button class="btn" id="plOtro">Otro lector</button><button class="btn" onclick="window.print()">🖨 Imprimir</button>':''}</div>${lmDatalist()}`;
  if(!l) return barra + `<div class="hint" style="margin:8px 0">Elige un lector (escribe su nombre o escanea el carné) para ver <b>su meta del mes</b>, <b>cómo va su lectura en las últimas dos semanas</b> y <b>libros disponibles que podrían gustarle</b>. Se consulta en la biblioteca con el carné: no hay cuentas de estudiantes ni de familias.</div>`;
  const r = plResumen(l), ma = plMetaAula(l), hoy = today();
  const mm = SigiePanel.metaMes({ leidos:r.mesActual, meta:r.meta, hoy });
  const serie = SigiePanel.serieDias({ bitacora:bibBitacora(), lectorId:l.id, hoy, dias:14 }), tn = SigiePanel.tendencia(serie);
  const barras = SigiePanel.svgBarras({ titulo:'Minutos leídos por día, últimos 14 días', cadaN:2, alto:170,
    items:serie.map(s=>({ etiqueta:SigiePanel.etiquetaDia(s.fecha), valor:s.minutos })) });
  const rec = plRecomendaciones(l, 5);
  const ritmoTxt = { cumplida:'✅ ¡Meta cumplida este mes!', al_dia:'👍 Va al día con su meta', atrasado:'⏳ Va un poco atrasado: conviene un libro pronto', sin_meta:'' }[mm.ritmo];
  const tnTxt = { sube:'📈 Leyó más que la semana anterior', baja:'📉 Leyó menos que la semana anterior', igual:'➡ Ritmo parecido al de la semana anterior', sin_datos:'Todavía no hay lecturas registradas en estas dos semanas' }[tn.estado];
  return barra + `<div class="card" style="padding:14px;margin:8px 0"><div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;justify-content:space-between">
    <div><div style="font-size:20px;font-weight:700">${esc(l.nombre)}</div><div class="hint">${esc(l.cod)} · ${esc(l.grado||'sin grado')}</div></div>
    <div style="text-align:right"><div style="font-size:20px">${esc(r.nivel.icono)} <b>${esc(r.nivel.nombre)}</b></div><div class="hint">${r.puntos} puntos · 🔥 racha de ${r.racha} día(s)</div></div></div></div>
  <div class="grid g2" style="margin:8px 0;gap:12px">
    <div class="card" style="padding:14px"><h3 style="margin:0 0 6px">🎯 Meta del mes</h3>
      <div style="font-size:26px;font-weight:700">${mm.leidos} <span style="font-size:15px;font-weight:400">de ${mm.meta} libro(s)</span></div>
      ${bibBar(mm.pct==null?0:mm.pct, mm.ritmo==='cumplida'?'#2a7d4f':'#14304d')}
      <div style="margin-top:6px">${esc(ritmoTxt)}</div>
      <div class="hint">${mm.ritmo==='cumplida'?'':`Faltan ${mm.faltan} libro(s) y quedan ${mm.quedan} día(s) del mes. `}${ma.deAula?'La meta es la de su aula.':'Meta personal (el aula no tiene una fijada).'}</div></div>
    <div class="card" style="padding:14px"><h3 style="margin:0 0 6px">📈 Últimos 14 días</h3>${barras}
      <div style="margin-top:6px">${esc(tnTxt)}${tn.estado!=='sin_datos'?` <span class="hint">(${tn.actual} min esta semana · ${tn.previo} min la anterior${tn.cambioPct==null?'':', '+(tn.cambioPct>0?'+':'')+tn.cambioPct+'%'})</span>`:''}</div>
      <div class="hint">Leyó en ${tn.diasConLectura} de los últimos 7 días.</div></div></div>
  <h3 style="margin:14px 0 6px">📚 Para leer a continuación</h3>
  ${rec.length?`<div class="grid g3" style="gap:10px">${rec.map(x=>{ const libres = Math.max(0, bibEjemplares(x.libro)-bibPrestados(x.libro.id)); return `<div class="card" style="padding:12px"><div style="font-weight:700">${esc(x.libro.titulo)}</div><div class="hint">${esc(x.libro.autor||'Autor no registrado')}</div>
    <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="badge badge-info">${esc(x.libro.cod||'')}</span><span class="badge badge-ok">Disponible (${libres})</span>${x.prom?`<span class="badge" style="color:#b7791f">${esc(lmEstrellas(x.prom))} ${x.prom.toFixed(1)}</span>`:''}</div>
    <div class="hint" style="margin-top:6px">${esc(x.motivo)}</div>${edit?`<div class="noprint" style="margin-top:8px"><button class="btn btn-sm" data-plprestar="${esc(x.libro.id)}">Prestar a ${esc(l.nombre.split(' ')[0])}</button></div>`:''}</div>`; }).join('')}</div>`
  :'<div class="hint">No hay libros disponibles que este lector no haya leído ya.</div>'}
  <div class="hint" style="margin:10px 0">Las recomendaciones salen de lo que el lector ya leyó y valoró, y de los libros más pedidos y mejor valorados del colegio. No se muestran datos de otros lectores.</div>`;
}

/* ---------------- Gráficos del tablero del director ---------------- */
function plGraficos(){
  const hoy = today(), anio = String(new Date().getFullYear());
  const d30 = SigiePanel.serieDias({ bitacora:bibBitacora(), lectorId:'', hoy, dias:30 });
  const meses = SigiePanel.serieMeses({ prestamos:bibPrest(), hoy, meses:6 });
  const niv = SigiePanel.distribucionNiveles(bibCompr(), anio), C = SigiePanel.COL;
  const alumnos = lmAlumnos(), rk = lmRanking();
  const aulas = [...new Set(rk.map(f=>f.grupo))].map(g=>{ const al = alumnos.filter(x=>lmGrupo(x)===g).length, f = rk.filter(x=>x.grupo===g); return { etiqueta:g, valor:al?Math.round(f.reduce((a,x)=>a+x.puntos,0)/al):0 }; }).sort((a,b)=>b.valor-a.valor).slice(0,8);
  const hayLec = d30.some(x=>x.lecturas), hayPres = meses.some(x=>x.prestamos), hayNiv = Object.values(niv).some(Boolean);
  const caja = (t,cuerpo,vacio,hay)=>`<div class="card" style="padding:12px"><h3 style="margin:0 0 6px">${t}</h3>${hay?cuerpo:`<div class="hint">${vacio}</div>`}</div>`;
  return `<h3 style="margin:18px 0 6px">📊 Gráficos</h3><div class="grid g2" style="margin:8px 0;gap:12px">
    ${caja('Lecturas registradas por día (30 días)', SigiePanel.svgBarras({ titulo:'Lecturas por día, últimos 30 días', cadaN:5, items:d30.map(s=>({ etiqueta:SigiePanel.etiquetaDia(s.fecha), valor:s.lecturas })) }), 'Aún no hay lecturas en el Lectómetro en los últimos 30 días.', hayLec)}
    ${caja('Préstamos por mes (6 meses)', SigiePanel.svgBarras({ titulo:'Préstamos por mes, últimos 6 meses', items:meses.map(m=>({ etiqueta:m.etiqueta, valor:m.prestamos })) }), 'Aún no hay préstamos en estos meses.', hayPres)}
    ${caja('Comprensión lectora '+anio, SigiePanel.svgBarrasH({ titulo:'Evaluaciones de comprensión por nivel de logro', items:[['AD',C.ok],['A','#4a9d6f'],['B',C.warn],['C',C.bad]].map(([k,c])=>({ etiqueta:'Nivel '+k, valor:niv[k], color:c })) }), 'Aún no hay evaluaciones de comprensión este año.', hayNiv)}
    ${caja('Aulas que más leen (puntos por alumno)', SigiePanel.svgBarrasH({ titulo:'Puntos por alumno, por aula', items:aulas }), 'Sin lecturas registradas.', aulas.some(a=>a.valor))}
  </div>`;
}

/* ---------------- Conexión ---------------- */
Object.assign(BIB_RENDER, { bibMiLec:renderBibMiLec });
BIB_VIEWS.push('bibMiLec');
(()=>{ const od = BIB_RENDER.bibDir; BIB_RENDER.bibDir = ()=> od() + plGraficos(); })();
(()=>{ const on = bibNavLectometro; bibNavLectometro = function(){ const g = on(), i = g.items.findIndex(x=>x.id==='bibLectom');
  g.items.splice(i<0?0:i+1, 0, { id:'bibMiLec', ic:'📖', label:'Mi lectura (meta y recomendados)' }); return g; }; })();

function bibWire13(){
  const $ = id=>document.getElementById(id), on = (id,fn)=>{ const e = $(id); if(e) e.addEventListener('click',fn); };
  const q = $('plQ');
  if(q){
    const elegir = ()=>{ const l = lmBuscarLector(q.value); if(l) plElegir(l); else if(q.value.trim()) toast('No encuentro un lector único con ese texto. Elige uno de la lista.','err'); };
    q.addEventListener('change', elegir); q.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); elegir(); } });
  }
  on('plScan', ()=>bibEscanearUno(c=>{ const l = lmBuscarLector(c); if(l) plElegir(l); else toast('Ese carné no corresponde a ningún lector.','err'); }));
  on('plOtro', ()=>plElegir(null));
  document.querySelectorAll('[data-plprestar]').forEach(b=>b.onclick=async()=>{
    if(!guardEdit()) return; const l = plLector(), libro = bibLibros().find(x=>x.id===b.dataset.plprestar); if(!l || !libro) return;
    if(!confirm('¿Prestar «'+libro.titulo+'» a '+l.nombre+'?')) return;
    const e = await bibPrestar(libro, l, l.nombre, l.grado);
    if(e) toast(e,'err'); else { toast('Prestado: '+libro.cod+' → '+l.nombre,'ok'); render(); } });
}
(()=>{ const ow = bibWire5; bibWire5 = function(){ ow(); bibWire13(); }; })();
