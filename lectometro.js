/* =========================================================================
   SIGIE — Biblioteca: Lectómetro integrado
   -------------------------------------------------------------------------
     · 📈 Lectómetro: bitácora de lectura con puntos, racha, nivel de lector e
          insignias de cada lector (el carné LEC-… es su "usuario").
     · 📝 Evaluaciones de lectura: cuestionarios por libro con calificación
          automática. El resultado queda también en Comprensión lectora (AD/A/B/C).
     · 🏆 Ranking y niveles por puntos, por aula.
     · 🎁 Premios y canjes: tienda de puntos con stock y entrega.
     · 📅 Plan lector: actividades con fecha (aviso en la campanita).
     · ⇧ Importar el respaldo de LectorIEP (el Lectómetro independiente).
   La lógica (puntos, rachas, insignias, migración) está en lectometro-util.js
   y tiene pruebas; este archivo solo dibuja y guarda. Los puntos, el nivel y
   las insignias NO se guardan: se calculan con los datos de la biblioteca.
   Se carga después de biblioteca.js y antes de ejemplo.js / app.js.
   ========================================================================= */

const L7 = { bit:'sigie:bib_bitacora', quiz:'sigie:bib_evaluaciones', qres:'sigie:bib_evalresultados', prem:'sigie:bib_premios', canj:'sigie:bib_canjes', act:'sigie:bib_actividades' };
const bibBitacora = ()=>DB.get(L7.bit)||[], bibEvals = ()=>DB.get(L7.quiz)||[], bibEvalRes = ()=>DB.get(L7.qres)||[], bibPremios = ()=>DB.get(L7.prem)||[], bibCanjes = ()=>DB.get(L7.canj)||[], bibActivs = ()=>DB.get(L7.act)||[];
const BIB_TITULOS7 = {
  bibLectom:['Lectómetro','Bitácora de lectura con puntos, racha, nivel de lector e insignias'],
  bibEval:['Evaluaciones de lectura','Cuestionarios por libro con calificación automática y nivel AD / A / B / C'],
  bibRank:['Ranking y niveles','Los lectores con más puntos, por aula'],
  bibPremios:['Premios y canjes','Tienda de puntos: los lectores canjean sus puntos por premios'],
  bibActiv:['Plan lector: actividades','Fechas del plan lector: ferias, concursos, entregas y ceremonias']
};

(()=>{ const oc = bibCargar; bibCargar = async function(){ await oc(); await Promise.all(Object.values(L7).map(k=>DB.load(k, []))); }; })();

const lm = { lectorId:'', q:'', grupo:'', evalVer:'banco', premVer:'todos', actVer:'pendientes' };
const lmAlumnos = ()=>bibLect().filter(x=>!x.baja && bibEsAlumno(x));
const lmLector = id => bibLect().find(x=>x.id===id);
const lmNivelLogro = c => (typeof bibNivBadge==='function') ? bibNivBadge(c) : esc(c);

function lmResumen(l){
  return SigieLec.resumenLector({ lector:l, bitacora:bibBitacora(), prestamos:bibPrest(), comprension:bibCompr(), resenas:bibResenas(), canjes:bibCanjes(), premios:bibPremios(), hoy:today() });
}
// Texto escrito o escaneado (LEC-0007, o parte del nombre) → lector. Devuelve null si no hay uno claro.
function lmBuscarLector(texto){
  const t = String(texto||'').trim(); if(!t) return null;
  const cod = t.split(/\s+[—-]\s+/)[0].trim().toUpperCase();
  const porCod = bibLect().find(x=>String(x.cod).toUpperCase()===cod && !x.baja);
  if(porCod) return porCod;
  const n = bibNorm(t), exacto = bibLect().filter(x=>!x.baja && bibNorm(x.nombre)===n);
  if(exacto.length===1) return exacto[0];
  const parcial = bibLect().filter(x=>!x.baja && bibNorm(x.nombre).includes(n));
  return parcial.length===1 ? parcial[0] : null;
}
const lmDatalist = ()=>`<datalist id="lmLecDL">${lmAlumnos().map(x=>`<option value="${esc(x.cod)} — ${esc(x.nombre)}">${esc(x.grado||'')}</option>`).join('')}</datalist>`;
function lmCampoLector(id, valorInicial){
  const l = valorInicial ? lmLector(valorInicial) : null;
  return `<div class="field f-12"><label>Lector (escribe su nombre o escanea el carné)</label><div style="display:flex;gap:6px"><input id="${id}" list="lmLecDL" autocomplete="off" placeholder="LEC-0001 o nombre" value="${l?esc(l.cod+' — '+l.nombre):''}" style="flex:1"><button type="button" class="btn" data-lmscan="${id}" title="Escanear el QR del carné">📷</button></div>${lmDatalist()}</div>`;
}
function lmWireCampoLector(bg){
  bg.querySelectorAll('[data-lmscan]').forEach(b=>b.onclick=()=>bibEscanearUno(c=>{ const i = bg.querySelector('#'+b.dataset.lmscan); const l = lmBuscarLector(c); if(i) i.value = l ? l.cod+' — '+l.nombre : c; }));
}
const lmEstrellas = n => '★'.repeat(Math.max(0,Math.min(5,Math.round(Number(n)||0))))+'☆'.repeat(5-Math.max(0,Math.min(5,Math.round(Number(n)||0))));
const lmGrupo = l => (typeof bibGrupoDe==='function') ? bibGrupoDe(l) : (l.grado||'');

/* =====================================================================
   1. LECTÓMETRO (bitácora, puntos, racha, insignias)
   ===================================================================== */
function renderBibLectom(){
  const l = lm.lectorId ? lmLector(lm.lectorId) : null;
  const edit = canEdit();
  const barra = `<div class="toolbar noprint"><input class="search" id="lmQ" list="lmLecDL" placeholder="Buscar lector por nombre o código…" autocomplete="off" value="${l?esc(l.cod+' — '+l.nombre):esc(lm.q)}" style="min-width:280px"><button class="btn" id="lmScan">📷 Escanear carné</button>${l?'<button class="btn" id="lmOtro">Otro lector</button>':''}${edit?'<button class="btn" id="lmImp" title="Trae los datos del Lectómetro independiente (LectorIEP)">⇧ Importar de LectorIEP</button><input type="file" id="lmImpF" accept=".json,application/json" style="display:none">':''}</div>${lmDatalist()}`;
  if(!l){
    const rk = SigieLec.rankingPuntos({ lectores:bibLect(), bitacora:bibBitacora(), hoy:today(), grupoDe:lmGrupo, prestamos:bibPrest(), comprension:bibCompr(), resenas:bibResenas(), canjes:bibCanjes(), premios:bibPremios() });
    const semana = bibEnDias(-6), activos = new Set(bibBitacora().filter(b=>b.fecha>=semana).map(b=>b.lectorId)).size, hoyN = bibBitacora().filter(b=>b.fecha===today()).length;
    return barra + `<div class="hint" style="margin:6px 0">Elige un lector para registrar su lectura del día. Cada página vale 2 puntos y cada minuto 0,5. Los puntos suben su nivel (Explorador → Aventurero → Sabio → Leyenda) y desbloquean insignias.</div>
    <div class="grid g4" style="margin:8px 0"><div class="card"><div class="kpi"><div class="lbl">Lecturas hoy</div><div class="val">${hoyN}</div></div></div><div class="card"><div class="kpi"><div class="lbl">Lectores activos (7 días)</div><div class="val">${activos}</div></div></div><div class="card"><div class="kpi"><div class="lbl">Con puntos</div><div class="val">${rk.length}</div></div></div><div class="card"><div class="kpi"><div class="lbl">Registros en total</div><div class="val">${bibBitacora().length}</div></div></div></div>
    <h3 style="margin:12px 0 6px">Los 5 mejores lectores</h3>${rk.length?`<div class="tbl-wrap"><table><thead><tr><th>#</th><th>Lector</th><th>Aula</th><th>Nivel</th><th>Puntos</th></tr></thead><tbody>${rk.slice(0,5).map(f=>`<tr><td>${f.pos}</td><td><a href="#" data-lmsel="${esc(f.lector.id)}">${esc(f.lector.nombre)}</a></td><td>${esc(f.grupo)}</td><td>${esc(f.nivel.icono)} ${esc(f.nivel.nombre)}</td><td class="num">${f.puntos}</td></tr>`).join('')}</tbody></table></div>`:'<div class="hint">Todavía no hay lecturas registradas.</div>'}`;
  }
  const r = lmResumen(l), n = r.nivel, bit = bibBitacora().filter(b=>b.lectorId===l.id).sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha))||String(b.id).localeCompare(String(a.id)));
  const pct = n.siguiente ? Math.max(0, Math.min(100, Math.round((r.puntos-n.min)/(n.siguiente.min-n.min)*100))) : 100;
  const titulos = bibLibros().map(x=>x.titulo);
  return barra + `<div class="card" style="padding:14px;margin:8px 0"><div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;justify-content:space-between">
    <div><div style="font-size:20px;font-weight:700">${esc(l.nombre)}</div><div class="hint">${esc(l.cod)} · ${esc(l.grado||'sin grado')}${l.puntosIniciales?` · incluye ${esc(l.puntosIniciales)} puntos traídos del Lectómetro`:''}</div></div>
    <div style="text-align:right"><div style="font-size:22px">${esc(n.icono)} <b>${esc(n.nombre)}</b></div><div class="hint">${n.siguiente?`Faltan ${n.faltan} puntos para ${esc(n.siguiente.icono)} ${esc(n.siguiente.nombre)}`:'Nivel máximo alcanzado'}</div></div></div>
    <div style="height:10px;background:var(--line,#ddd);border-radius:6px;margin-top:10px;overflow:hidden"><div style="width:${pct}%;height:100%;background:var(--primary,#14304d)"></div></div></div>
  <div class="grid g4" style="margin:8px 0"><div class="card"><div class="kpi"><div class="lbl">Puntos</div><div class="val">${r.puntos}</div><div class="delta">Saldo para premios: ${r.saldo}</div></div></div><div class="card"><div class="kpi"><div class="lbl">Racha</div><div class="val">🔥 ${r.racha}</div><div class="delta">día(s) seguidos · récord ${r.rachaMax}</div></div></div><div class="card"><div class="kpi"><div class="lbl">Libros leídos</div><div class="val">${r.libros}</div><div class="delta">Este mes: ${r.mesActual} de ${r.meta}</div></div></div><div class="card"><div class="kpi"><div class="lbl">Minutos / páginas</div><div class="val">${r.minutos}</div><div class="delta">${r.paginas} páginas · ${r.evaluaciones} evaluación(es)</div></div></div></div>
  <h3 style="margin:12px 0 6px">Insignias (${r.insignias.length} de ${SigieLec.INSIGNIAS.length})</h3><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px">${SigieLec.INSIGNIAS.map(i=>{ const ok = r.insignias.includes(i.id); return `<div style="border:1px solid #bbb;border-radius:10px;padding:8px 10px;${ok?'':'opacity:.45;filter:grayscale(1)'}"><div style="font-size:22px">${i.icono} <b style="font-size:13px">${esc(i.nombre)}</b></div><div class="hint">${esc(i.cuando)}</div></div>`; }).join('')}</div>
  ${edit?`<h3 style="margin:16px 0 6px">Registrar lectura de hoy</h3><div class="card" style="padding:12px"><div class="fgrid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">
    <div class="field" style="grid-column:1/-1"><label>Libro (del catálogo o escribe el título)</label><input id="lmLibro" list="lmLibDL" autocomplete="off" placeholder="Título del libro"><datalist id="lmLibDL">${titulos.slice(0,4000).map(t=>`<option value="${esc(t)}"></option>`).join('')}</datalist></div>
    <div class="field"><label>Páginas leídas</label><input id="lmPag" type="number" min="0" max="2000" value="10"></div><div class="field"><label>Minutos</label><input id="lmMin" type="number" min="0" max="600" value="20"></div>
    <div class="field"><label>¿Cómo le pareció? (1-5)</label><select id="lmAuto">${[5,4,3,2,1].map(k=>`<option value="${k}">${lmEstrellas(k)}</option>`).join('')}</select></div>
    <div class="field" style="grid-column:1/-1"><label>Comentario (opcional)</label><input id="lmCom" maxlength="300" placeholder="Una frase sobre lo que leyó"></div></div>
    <div style="margin-top:8px"><button class="btn btn-primary" id="lmGuardar">+ Registrar lectura</button> <span class="hint" id="lmPrev"></span></div></div>`:''}
  <h3 style="margin:16px 0 6px">Historial de lectura</h3>${bit.length?`<div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Libro</th><th>Páginas</th><th>Min.</th><th>Opinión</th><th>Puntos</th><th>Comentario</th><th class="noprint"></th></tr></thead><tbody>${bit.slice(0,30).map(b=>`<tr><td>${esc(bibFechaCorta(b.fecha))}</td><td>${esc((bibLibros().find(x=>x.id===b.libroId)||{}).titulo||b.libroTitulo||'—')}</td><td class="num">${b.paginas}</td><td class="num">${b.minutos}</td><td>${lmEstrellas(b.autoevaluacion)}</td><td class="num">+${b.puntos}</td><td>${esc(b.comentario||'')}</td><td class="noprint">${edit?`<button class="btn" data-lmdel="${esc(b.id)}" title="Eliminar este registro">🗑</button>`:''}</td></tr>`).join('')}</tbody></table></div>${bit.length>30?`<div class="hint">Se muestran los 30 más recientes de ${bit.length}.</div>`:''}`:'<div class="hint">Este lector todavía no tiene lecturas registradas.</div>'}
  <div class="toolbar noprint" style="margin-top:12px"><button class="btn" id="lmCert">🎓 Certificado de lectura</button><button class="btn" id="lmEvalIr">📝 Rendir una evaluación</button><button class="btn" id="lmPremIr">🎁 Canjear puntos</button></div>`;
}
function lmElegir(l){ lm.lectorId = l ? l.id : ''; lm.q = ''; render(); }

async function lmRegistrarLectura(){
  if(!guardEdit()) return;
  const l = lmLector(lm.lectorId); if(!l) return;
  const $ = id=>document.getElementById(id), titulo = String($('lmLibro').value||'').trim().slice(0,200);
  const pag = Math.round(Number($('lmPag').value)||0), min = Math.round(Number($('lmMin').value)||0);
  if(!titulo){ toast('Escribe o elige el libro que leyó.','err'); return; }
  if(pag<=0 && min<=0){ toast('Escribe las páginas o los minutos leídos.','err'); return; }
  if(pag>2000 || min>600){ toast('Revisa los números: páginas máx. 2000 y minutos máx. 600 por registro.','err'); return; }
  const lib = bibLibros().find(x=>bibNorm(x.titulo)===bibNorm(titulo)), antes = lmResumen(l).insignias;
  const pts = SigieLec.puntosLectura(pag, min);
  await DB.save(L7.bit, [...bibBitacora(), { id:uid('bt'), lectorId:l.id, libroId:lib?lib.id:'', libroTitulo:lib?'':titulo, fecha:today(), paginas:pag, minutos:min, autoevaluacion:Number($('lmAuto').value)||0, comentario:String($('lmCom').value||'').trim().slice(0,300), puntos:pts }]);
  const despues = lmResumen(l), nuevas = despues.insignias.filter(i=>!antes.includes(i)).map(i=>SigieLec.INSIGNIAS.find(x=>x.id===i)).filter(Boolean);
  registrarBitacora('Lectómetro: lectura registrada', l.cod+' · '+titulo+' · +'+pts+' pts');
  toast('+'+pts+' puntos para '+l.nombre+(nuevas.length?' · ¡Nueva insignia! '+nuevas.map(i=>i.icono+' '+i.nombre).join(', '):''),'ok');
  render();
}

function lmCertificado(){
  const l = lmLector(lm.lectorId); if(!l) return;
  const r = lmResumen(l); if(r.puntos<=0){ toast('Este lector aún no tiene puntos para certificar.','err'); return; }
  const cfg = DB.get(KEYS.config)||{};
  const hoja = SigieLec.certificadoLectorHTML({ nombre:l.nombre, grado:l.grado||'', resumen:r, nombreIE:cfg.nombreIE, fecha:new Date().toLocaleDateString('es-PE',{day:'numeric',month:'long',year:'numeric'}) });
  const w = window.open('', '_blank'); if(!w){ toast('El navegador bloqueó la ventana. Permite ventanas emergentes para este sitio.','err'); return; }
  w.document.write(SigieLec.documentoCertificados([hoja], 'Certificado de lectura')); w.document.close();
  registrarBitacora('Lectómetro: certificado de lectura', l.cod);
}

// Importar el respaldo del Lectómetro independiente (LectorIEP → Base de datos → Descargar respaldo).
async function lmImportarLectorIEP(file){
  if(!guardEdit()) return;
  let paquete; try{ paquete = JSON.parse(await file.text()); }catch(e){ toast('No se pudo leer el archivo: no es un JSON válido.','err'); return; }
  const yaImportados = [L7.bit, L7.quiz, L7.qres, L7.prem, L7.canj, L7.act, BKEYS.prest, B6.cmp, BKEYS.lect].flatMap(k=>(DB.get(k)||[]).map(x=>x.origen).filter(Boolean));
  const res = SigieLec.convertirLectometro(paquete, { lectores:bibLect(), libros:bibLibros(), uid, siguienteCod:bibSigLec, yaImportados });
  if(res.error){ toast(res.error,'err'); return; }
  const r = res.reporte, n = res.nuevo;
  const total = r.lectores + r.bitacora + r.evaluaciones + r.resultados + r.premios + r.canjes + r.actividades + r.prestamos;
  if(!total){ toast('No hay nada nuevo que importar: todo lo de ese archivo ya estaba en SIGIE.','ok'); return; }
  const omit = r.omitidos.length ? '\n\nNo se importó ('+r.omitidos.length+'):\n- '+[...new Set(r.omitidos)].slice(0,6).join('\n- ')+(r.omitidos.length>6?'\n- …':'') : '';
  if(!confirm('Se agregarán a la biblioteca:\n• '+r.lectores+' lector(es) nuevo(s) ('+r.lectoresExistentes+' ya existían y se reutilizan)\n• '+r.bitacora+' registro(s) de lectura\n• '+r.evaluaciones+' evaluación(es) y '+r.resultados+' resultado(s)\n• '+r.premios+' premio(s) y '+r.canjes+' canje(s)\n• '+r.actividades+' actividad(es)\n• '+r.prestamos+' préstamo(s)\n\nNo se borra ni se modifica nada de lo que ya existe.'+omit+'\n\n¿Importar?')) return;
  const add = (k,nuevos)=>nuevos.length ? DB.save(k, [...(DB.get(k)||[]), ...nuevos]) : null;
  await Promise.all([add(BKEYS.lect,n.lectores), add(L7.bit,n.bitacora), add(L7.quiz,n.quizzes), add(L7.qres,n.quizres), add(L7.prem,n.premios), add(L7.canj,n.canjes), add(L7.act,n.actividades), add(B6.cmp,n.comprension), add(BKEYS.prest,n.prestamos)].filter(Boolean));
  registrarBitacora('Importación de LectorIEP', total+' registro(s): '+r.lectores+' lectores, '+r.bitacora+' lecturas, '+r.resultados+' resultados');
  toast('Importación terminada: '+total+' registro(s).','ok'); render();
}

/* =====================================================================
   2. EVALUACIONES DE LECTURA
   ===================================================================== */
function renderBibEval(){
  const edit = canEdit(), quizzes = bibEvals(), res = bibEvalRes();
  const tabs = `<div class="toolbar noprint"><button class="btn ${lm.evalVer==='banco'?'btn-primary':''}" data-lmev="banco">📝 Banco de evaluaciones (${quizzes.length})</button><button class="btn ${lm.evalVer==='res'?'btn-primary':''}" data-lmev="res">📊 Resultados (${res.length})</button>${edit&&lm.evalVer==='banco'?'<button class="btn btn-primary" id="evNueva">+ Nueva evaluación</button>':''}</div>`;
  if(lm.evalVer==='res'){
    const filas = [...res].sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha))).slice(0,200);
    return tabs + `<div class="hint" style="margin:6px 0">Cada resultado se guarda también en <b>Comprensión lectora</b> con su nivel AD / A / B / C (91+ = AD, 71+ = A, 51+ = B, menos = C).</div>${filas.length?`<div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Lector</th><th>Aula</th><th>Evaluación</th><th>Puntaje</th><th>Nivel</th><th class="noprint"></th></tr></thead><tbody>${filas.map(r=>{ const l = lmLector(r.lectorId)||{}, q = quizzes.find(x=>x.id===r.quizId)||{}; return `<tr><td>${esc(bibFechaCorta(r.fecha))}</td><td>${esc(l.nombre||'(lector eliminado)')}</td><td>${esc(l.grado||'')}</td><td>${esc(q.titulo||'(evaluación eliminada)')}</td><td class="num">${r.puntaje}%</td><td>${lmNivelLogro(r.nivel)}</td><td class="noprint">${isAdmin()?`<button class="btn" data-evresdel="${esc(r.id)}" title="Eliminar resultado">🗑</button>`:''}</td></tr>`; }).join('')}</tbody></table></div>`:'<div class="hint">Aún no se ha rendido ninguna evaluación.</div>'}`;
  }
  return tabs + `<div class="hint" style="margin:6px 0">Un cuestionario por libro. El docente o el bibliotecario crea las preguntas y el lector responde con su carné; se califica solo.</div>${quizzes.length?`<div class="tbl-wrap"><table><thead><tr><th>Evaluación</th><th>Libro</th><th>Preguntas</th><th>Rendida</th><th class="noprint"></th></tr></thead><tbody>${quizzes.map(q=>{ const lib = bibLibros().find(x=>x.id===q.libroId); return `<tr><td>${esc(q.titulo)}</td><td>${esc(lib?lib.titulo:(q.libroTitulo||'—'))}</td><td class="num">${(q.preguntas||[]).length}</td><td class="num">${res.filter(r=>r.quizId===q.id).length} vez(es)</td><td class="noprint">${edit?`<button class="btn btn-primary" data-evrendir="${esc(q.id)}">▶ Rendir</button> <button class="btn" data-evedit="${esc(q.id)}">✎</button> <button class="btn" data-evdel="${esc(q.id)}">🗑</button>`:''}</td></tr>`; }).join('')}</tbody></table></div>`:'<div class="hint">Aún no hay evaluaciones. Crea la primera con “+ Nueva evaluación”.</div>'}`;
}

let lmQN = 0;
function lmBloquePregunta(p){
  const k = ++lmQN, ops = [...(p&&p.opciones||[]), '', '', '', ''].slice(0,4);
  return `<div class="lmq" style="border:1px solid #aaa;border-radius:8px;padding:8px;margin:8px 0"><div class="field"><label>Pregunta</label><textarea rows="2" data-qt maxlength="300">${esc(p?p.texto:'')}</textarea></div><div class="hint">Marca con el círculo la respuesta correcta (mínimo 2 opciones).</div>${ops.map((o,j)=>`<div style="display:flex;gap:6px;align-items:center;margin:3px 0"><input type="radio" name="lmc${k}" value="${j}" ${p&&p.correcta===j?'checked':''}><input data-qo="${j}" maxlength="200" value="${esc(o)}" placeholder="Opción ${j+1}" style="flex:1"></div>`).join('')}<button type="button" class="btn" data-qdel>Quitar pregunta</button></div>`;
}
function lmLeerPreguntas(bg){
  return [...bg.querySelectorAll('.lmq')].map(b=>{
    const op = [...b.querySelectorAll('[data-qo]')].map(i=>i.value.trim()), c = b.querySelector('input[type=radio]:checked');
    return { texto:b.querySelector('[data-qt]').value.trim(), opciones:op, correcta:c?Number(c.value):-1 };
  });
}
function lmEvalModal(id){
  if(!guardEdit()) return;
  const q = id ? bibEvals().find(x=>x.id===id) : null;
  const lib = q && q.libroId ? bibLibros().find(x=>x.id===q.libroId) : null;
  const bg = bibModal(q?'Editar evaluación':'Nueva evaluación', `<div class="field f-12"><label>Título de la evaluación</label><input id="evT" maxlength="120" value="${esc(q?q.titulo:'')}"></div>
    <div class="field f-12"><label>Libro (opcional)</label><input id="evL" list="evLibDL" autocomplete="off" value="${esc(lib?lib.titulo:(q?q.libroTitulo||'':''))}" placeholder="Título del libro"><datalist id="evLibDL">${bibLibros().slice(0,4000).map(x=>`<option value="${esc(x.titulo)}"></option>`).join('')}</datalist></div>
    <div class="field f-12"><div id="evPs">${(q&&q.preguntas&&q.preguntas.length?q.preguntas:[null,null,null]).map(lmBloquePregunta).join('')}</div><button type="button" class="btn" id="evAdd">+ Agregar pregunta</button></div>`,
    async bg=>{
      const preguntas = lmLeerPreguntas(bg), titulo = bibV(bg,'evT'), tl = bibV(bg,'evL'), libro = bibLibros().find(x=>bibNorm(x.titulo)===bibNorm(tl));
      const obj = { titulo, preguntas }, err = SigieLec.validarEvaluacion(obj); if(err){ toast(err,'err'); return false; }
      const nuevo = { id:q?q.id:uid('ev'), titulo, libroId:libro?libro.id:'', libroTitulo:libro?'':tl, preguntas, ...(q&&q.origen?{origen:q.origen}:{}) };
      await DB.save(L7.quiz, q ? bibEvals().map(x=>x.id===q.id?nuevo:x) : [...bibEvals(), nuevo]);
      registrarBitacora(q?'Evaluación editada':'Evaluación creada', titulo); toast('Evaluación guardada.','ok'); render();
    }, 'Guardar', '720px');
  const ps = bg.querySelector('#evPs');
  bg.querySelector('#evAdd').onclick = ()=>ps.insertAdjacentHTML('beforeend', lmBloquePregunta(null));
  ps.addEventListener('click', e=>{ const b = e.target.closest('[data-qdel]'); if(b) b.closest('.lmq').remove(); });
}
function lmRendirModal(quizId, lectorPre){
  if(!guardEdit()) return;
  const q = bibEvals().find(x=>x.id===quizId); if(!q) return;
  const bg = bibModal('Rendir: '+esc(q.titulo), lmCampoLector('rdLec', lectorPre||lm.lectorId)+`<div class="field f-12">${q.preguntas.map((p,i)=>`<div style="margin:10px 0"><b>${i+1}. ${esc(p.texto)}</b>${p.opciones.map((o,j)=>String(o).trim()?`<label style="display:block;margin:3px 0 3px 12px"><input type="radio" name="rd${i}" value="${j}"> ${esc(o)}</label>`:'').join('')}</div>`).join('')}</div>`,
    async bg=>{
      const l = lmBuscarLector(bg.querySelector('#rdLec').value); if(!l){ toast('Elige un lector de la lista o escanea su carné.','err'); return false; }
      if(bibEvalRes().some(r=>r.quizId===q.id && r.lectorId===l.id)){ toast(l.nombre+' ya rindió esta evaluación.','err'); return false; }
      const resp = q.preguntas.map((p,i)=>{ const c = bg.querySelector('input[name=rd'+i+']:checked'); return c?Number(c.value):null; });
      if(resp.includes(null)){ toast('Faltan preguntas por responder.','err'); return false; }
      const r = SigieLec.calificarEvaluacion(q, resp);
      await DB.save(L7.qres, [...bibEvalRes(), { id:uid('qr'), quizId:q.id, lectorId:l.id, puntaje:r.puntaje, nivel:r.nivel, fecha:today() }]);
      await DB.save(B6.cmp, [...bibCompr(), { id:uid('cp'), prestId:'', libroId:q.libroId||'', lectorId:l.id, lector:l.nombre, grado:l.grado||'', nivel:r.nivel, obs:('Evaluación: '+q.titulo+' ('+r.puntaje+'%)').slice(0,300), fecha:today(), docente:bibQuien(), evalId:q.id }]);
      registrarBitacora('Evaluación de lectura rendida', l.cod+' · '+q.titulo+' · '+r.puntaje+'% ('+r.nivel+')');
      bibModal('Resultado', `<div class="field f-12" style="text-align:center"><div style="font-size:15px">${esc(l.nombre)}</div><div style="font-size:40px;font-weight:700;margin:6px 0">${r.puntaje}%</div><div>${r.correctas} de ${r.total} correctas</div><div style="margin-top:8px;font-size:18px">Nivel de logro: ${lmNivelLogro(r.nivel)}</div></div>`, ()=>{}, 'Aceptar', '380px').querySelector('#bmC').style.display = 'none';
      render();
    }, 'Enviar respuestas', '720px');
  lmWireCampoLector(bg);
}

/* =====================================================================
   3. RANKING Y NIVELES
   ===================================================================== */
function lmRanking(){
  return SigieLec.rankingPuntos({ lectores:bibLect(), bitacora:bibBitacora(), hoy:today(), grupoDe:lmGrupo, prestamos:bibPrest(), comprension:bibCompr(), resenas:bibResenas(), canjes:bibCanjes(), premios:bibPremios() });
}
function renderBibRank(){
  const todos = lmRanking(), grupos = [...new Set(todos.map(f=>f.grupo))].sort((a,b)=>a.localeCompare(b,'es',{numeric:true}));
  const lista = todos.filter(f=>!lm.grupo || f.grupo===lm.grupo);
  const porAula = grupos.map(g=>{ const fs = todos.filter(f=>f.grupo===g), pts = fs.reduce((a,f)=>a+f.puntos,0), alum = lmAlumnos().filter(x=>lmGrupo(x)===g).length; return { g, n:fs.length, alum, pts, prom:alum?Math.round(pts/alum):0 }; }).sort((a,b)=>b.prom-a.prom);
  const porNivel = SigieLec.NIVELES_LECTOR.map(n=>({ n, c:todos.filter(f=>f.nivel.nombre===n.nombre).length }));
  return `<div class="toolbar noprint"><select id="rkGrupo"><option value="">Todas las aulas</option>${grupos.map(g=>`<option value="${esc(g)}" ${lm.grupo===g?'selected':''}>${esc(g)}</option>`).join('')}</select><button class="btn" id="rkXls">⇩ Exportar Excel</button><button class="btn" onclick="window.print()">🖨 Imprimir</button></div>
  <div class="hint" style="margin:6px 0">Se ordena por puntos ganados (canjear un premio no hace bajar de puesto). Empatados comparten puesto. Solo alumnos con lecturas registradas.</div>
  <div class="grid g4" style="margin:8px 0">${porNivel.map(x=>`<div class="card"><div class="kpi"><div class="lbl">${esc(x.n.icono)} ${esc(x.n.nombre)}</div><div class="val">${x.c}</div><div class="delta">desde ${x.n.min} puntos</div></div></div>`).join('')}</div>
  <h3 style="margin:12px 0 6px">Lectores${lm.grupo?' de '+esc(lm.grupo):''}</h3>${lista.length?`<div class="tbl-wrap"><table><thead><tr><th>#</th><th>Lector</th><th>Aula</th><th>Nivel</th><th>Puntos</th><th>Libros</th><th>Racha</th><th>Insignias</th></tr></thead><tbody>${lista.slice(0,100).map(f=>`<tr><td>${f.pos}</td><td>${esc(f.lector.nombre)}</td><td>${esc(f.grupo)}</td><td>${esc(f.nivel.icono)} ${esc(f.nivel.nombre)}</td><td class="num">${f.puntos}</td><td class="num">${f.libros}</td><td class="num">${f.racha}</td><td>${f.insignias.map(i=>(SigieLec.INSIGNIAS.find(x=>x.id===i)||{}).icono||'').join(' ')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="hint">Aún no hay lecturas registradas.</div>'}
  <h3 style="margin:18px 0 6px">Ranking de aulas (puntos por alumno matriculado)</h3>${porAula.length?`<div class="tbl-wrap"><table><thead><tr><th>#</th><th>Aula</th><th>Alumnos</th><th>Con puntos</th><th>Puntos totales</th><th>Promedio por alumno</th></tr></thead><tbody>${porAula.map((a,i)=>`<tr><td>${i+1}</td><td>${esc(a.g)}</td><td class="num">${a.alum}</td><td class="num">${a.n}</td><td class="num">${a.pts}</td><td class="num">${a.prom}</td></tr>`).join('')}</tbody></table></div>`:''}`;
}

/* =====================================================================
   4. PREMIOS Y CANJES
   ===================================================================== */
function renderBibPremios(){
  const edit = canEdit(), pr = bibPremios(), cj = bibCanjes(), pend = cj.filter(c=>c.estado==='pendiente');
  const nom = id => (pr.find(p=>p.id===id)||{}).nombre||'(premio eliminado)';
  return `<div class="toolbar noprint">${edit?'<button class="btn btn-primary" id="pmNuevo">+ Nuevo premio</button><button class="btn" id="pmCanje">🎁 Canjear puntos de un lector</button>':''}</div>
  <div class="hint" style="margin:6px 0">Los lectores canjean los puntos que ganaron en el Lectómetro. El canje queda <b>pendiente</b> hasta que se entrega el premio; si se anula, los puntos y el stock se devuelven.</div>
  <h3 style="margin:12px 0 6px">Catálogo de premios</h3>${pr.length?`<div class="tbl-wrap"><table><thead><tr><th>Premio</th><th>Descripción</th><th>Costo</th><th>Stock</th><th>Estado</th><th class="noprint"></th></tr></thead><tbody>${pr.map(p=>`<tr><td>${esc(p.nombre)}</td><td>${esc(p.descripcion||'')}</td><td class="num">${p.costoPuntos} pts</td><td class="num">${p.stock===null||p.stock===undefined?'∞':p.stock}</td><td>${p.activo===false?'<span class="badge badge-warn">Inactivo</span>':'<span class="badge badge-good">Disponible</span>'}</td><td class="noprint">${edit?`<button class="btn" data-pmedit="${esc(p.id)}">✎</button> <button class="btn" data-pmtog="${esc(p.id)}">${p.activo===false?'Activar':'Desactivar'}</button> ${isAdmin()?`<button class="btn" data-pmdel="${esc(p.id)}">🗑</button>`:''}`:''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="hint">Aún no hay premios. Crea el primero (por ejemplo: stickers, 50 puntos).</div>'}
  <h3 style="margin:18px 0 6px">Canjes pendientes de entrega (${pend.length})</h3>${pend.length?`<div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Lector</th><th>Aula</th><th>Premio</th><th>Costo</th><th class="noprint"></th></tr></thead><tbody>${pend.map(c=>{ const l = lmLector(c.lectorId)||{}; return `<tr><td>${esc(bibFechaCorta(c.fecha))}</td><td>${esc(l.nombre||'(lector eliminado)')}</td><td>${esc(l.grado||'')}</td><td>${esc(nom(c.premioId))}</td><td class="num">${c.costo} pts</td><td class="noprint">${edit?`<button class="btn btn-primary" data-cjent="${esc(c.id)}">✔ Entregar</button> <button class="btn" data-cjanu="${esc(c.id)}">Anular</button>`:''}</td></tr>`; }).join('')}</tbody></table></div>`:'<div class="hint">No hay canjes pendientes.</div>'}
  <h3 style="margin:18px 0 6px">Últimos canjes entregados</h3>${(()=>{ const ent = cj.filter(c=>c.estado==='entregado').sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha))).slice(0,15); return ent.length?`<div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Lector</th><th>Premio</th><th>Costo</th></tr></thead><tbody>${ent.map(c=>`<tr><td>${esc(bibFechaCorta(c.fecha))}</td><td>${esc((lmLector(c.lectorId)||{}).nombre||'(lector eliminado)')}</td><td>${esc(nom(c.premioId))}</td><td class="num">${c.costo} pts</td></tr>`).join('')}</tbody></table></div>`:'<div class="hint">Todavía no se ha entregado ningún premio.</div>'; })()}`;
}
function lmPremioModal(id){
  if(!guardEdit()) return;
  const p = id ? bibPremios().find(x=>x.id===id) : null;
  bibModal(p?'Editar premio':'Nuevo premio', `<div class="field f-12"><label>Nombre</label><input id="pmN" maxlength="80" value="${esc(p?p.nombre:'')}"></div><div class="field f-12"><label>Descripción (opcional)</label><input id="pmD" maxlength="200" value="${esc(p?p.descripcion||'':'')}"></div><div class="field f-6"><label>Costo en puntos</label><input id="pmC" type="number" min="1" max="100000" value="${p?p.costoPuntos:50}"></div><div class="field f-6"><label>Stock (vacío = sin límite)</label><input id="pmS" type="number" min="0" max="100000" value="${p&&p.stock!==null&&p.stock!==undefined?p.stock:''}"></div>`,
    async bg=>{
      const nombre = bibV(bg,'pmN'), costo = Math.round(Number(bibV(bg,'pmC'))), st = bibV(bg,'pmS');
      if(!nombre){ toast('Escribe el nombre del premio.','err'); return false; }
      if(!(costo>0)){ toast('El costo debe ser mayor que 0.','err'); return false; }
      if(st!=='' && !(Number(st)>=0)){ toast('El stock no es válido.','err'); return false; }
      const nuevo = { ...(p||{}), id:p?p.id:uid('pr'), nombre, descripcion:bibV(bg,'pmD'), costoPuntos:costo, stock:st===''?null:Math.round(Number(st)), activo:p?p.activo!==false:true };
      await DB.save(L7.prem, p ? bibPremios().map(x=>x.id===p.id?nuevo:x) : [...bibPremios(), nuevo]);
      registrarBitacora(p?'Premio editado':'Premio creado', nombre); render();
    }, 'Guardar', '520px');
}
function lmCanjearModal(premioPre){
  if(!guardEdit()) return;
  const disp = bibPremios().filter(p=>p.activo!==false);
  if(!disp.length){ toast('Primero crea un premio disponible.','err'); return; }
  const bg = bibModal('Canjear puntos', lmCampoLector('cjLec', lm.lectorId)+`<div class="field f-12"><label>Premio</label><select id="cjPrem">${disp.map(p=>`<option value="${esc(p.id)}" ${p.id===premioPre?'selected':''}>${esc(p.nombre)} — ${p.costoPuntos} pts${p.stock!==null&&p.stock!==undefined?' (quedan '+p.stock+')':''}</option>`).join('')}</select></div><div class="hint f-12" id="cjSaldo"></div>`,
    async bg=>{
      const l = lmBuscarLector(bg.querySelector('#cjLec').value); if(!l){ toast('Elige un lector de la lista o escanea su carné.','err'); return false; }
      const p = bibPremios().find(x=>x.id===bg.querySelector('#cjPrem').value), saldo = lmResumen(l).saldo, why = SigieLec.motivoNoCanje(p, saldo);
      if(why){ toast(why,'err'); return false; }
      await DB.save(L7.canj, [...bibCanjes(), { id:uid('cj'), lectorId:l.id, premioId:p.id, costo:p.costoPuntos, fecha:today(), estado:'pendiente' }]);
      if(p.stock!==null && p.stock!==undefined) await DB.save(L7.prem, bibPremios().map(x=>x.id===p.id?{...x, stock:Math.max(0,Number(x.stock)-1)}:x));
      registrarBitacora('Canje de premio', l.cod+' · '+p.nombre+' · −'+p.costoPuntos+' pts'); toast(l.nombre+' canjeó «'+p.nombre+'». Quedan '+(saldo-p.costoPuntos)+' puntos.','ok'); render();
    }, 'Canjear', '520px');
  lmWireCampoLector(bg);
  const pintar = ()=>{ const l = lmBuscarLector(bg.querySelector('#cjLec').value); bg.querySelector('#cjSaldo').textContent = l ? l.nombre+' tiene '+lmResumen(l).saldo+' puntos disponibles.' : ''; };
  bg.querySelector('#cjLec').addEventListener('input', pintar); bg.querySelector('#cjLec').addEventListener('change', pintar); pintar();
}

/* =====================================================================
   5. PLAN LECTOR: ACTIVIDADES
   ===================================================================== */
const BIB_ACT_TIPOS = ['Feria del libro','Concurso','Entrega de diplomas','Ceremonia','Taller','Visita','Otro'];
function bibActivasN(){ return SigieLec.actividadesProximas(bibActivs(), today(), 7).length + SigieLec.actividadesVencidas(bibActivs(), today()).length; }
function renderBibActiv(){
  const edit = canEdit(), hoy = today(), todas = bibActivs(), prox = SigieLec.actividadesProximas(todas, hoy, 7), venc = SigieLec.actividadesVencidas(todas, hoy);
  const lista = [...todas].filter(a=>lm.actVer==='todas' || !a.hecha).sort((a,b)=>String(a.fecha).localeCompare(String(b.fecha)));
  return `<div class="toolbar noprint">${edit?'<button class="btn btn-primary" id="acNueva">+ Nueva actividad</button>':''}<button class="btn ${lm.actVer==='pendientes'?'btn-primary':''}" data-acver="pendientes">Pendientes</button><button class="btn ${lm.actVer==='todas'?'btn-primary':''}" data-acver="todas">Todas</button></div>
  <div class="grid g3" style="margin:8px 0"><div class="card"><div class="kpi"><div class="lbl">Próximos 7 días</div><div class="val">${prox.length}</div></div></div><div class="card"><div class="kpi"><div class="lbl">Vencidas sin marcar</div><div class="val" ${venc.length?'style="color:var(--bad,#b3261e)"':''}>${venc.length}</div></div></div><div class="card"><div class="kpi"><div class="lbl">Hechas</div><div class="val">${todas.filter(a=>a.hecha).length}</div></div></div></div>
  ${lista.length?`<div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Actividad</th><th>Tipo</th><th>Estado</th><th class="noprint"></th></tr></thead><tbody>${lista.map(a=>{ const d = SigieBib.diasEntre(hoy, a.fecha), est = a.hecha?'<span class="badge badge-good">Hecha</span>':d<0?'<span class="badge badge-bad">Vencida</span>':d===0?'<span class="badge badge-warn">Hoy</span>':d<=7?`<span class="badge badge-warn">En ${d} día(s)</span>`:`<span class="badge">En ${d} días</span>`; return `<tr><td>${esc(bibFechaCorta(a.fecha))}</td><td><b>${esc(a.titulo)}</b>${a.descripcion?`<div class="hint">${esc(a.descripcion)}</div>`:''}</td><td>${esc(a.tipo||'Otro')}</td><td>${est}</td><td class="noprint">${edit?`<button class="btn" data-acok="${esc(a.id)}">${a.hecha?'↺ Reabrir':'✔ Hecha'}</button> <button class="btn" data-acedit="${esc(a.id)}">✎</button> <button class="btn" data-acdel="${esc(a.id)}">🗑</button>`:''}</td></tr>`; }).join('')}</tbody></table></div>`:'<div class="hint">No hay actividades. Programa la primera (por ejemplo, la entrega de diplomas).</div>'}`;
}
function lmActividadModal(id){
  if(!guardEdit()) return;
  const a = id ? bibActivs().find(x=>x.id===id) : null;
  bibModal(a?'Editar actividad':'Nueva actividad', `<div class="field f-12"><label>Título</label><input id="acT" maxlength="120" value="${esc(a?a.titulo:'')}"></div><div class="field f-6"><label>Fecha</label><input id="acF" type="date" value="${esc(a?a.fecha:today())}"></div><div class="field f-6"><label>Tipo</label><select id="acP">${BIB_ACT_TIPOS.map(t=>`<option ${a&&a.tipo===t?'selected':''}>${t}</option>`).join('')}</select></div><div class="field f-12"><label>Descripción (opcional)</label><input id="acD" maxlength="250" value="${esc(a?a.descripcion||'':'')}"></div>`,
    async bg=>{
      const titulo = bibV(bg,'acT'), fecha = bibV(bg,'acF'); if(!titulo){ toast('Escribe el título.','err'); return false; } if(!/^\d{4}-\d{2}-\d{2}$/.test(fecha)){ toast('Elige la fecha.','err'); return false; }
      const nuevo = { ...(a||{}), id:a?a.id:uid('ac'), titulo, fecha, tipo:bibV(bg,'acP'), descripcion:bibV(bg,'acD'), hecha:a?!!a.hecha:false };
      await DB.save(L7.act, a ? bibActivs().map(x=>x.id===a.id?nuevo:x) : [...bibActivs(), nuevo]); registrarBitacora(a?'Actividad editada':'Actividad creada', titulo+' · '+fecha); render();
    }, 'Guardar', '520px');
}

/* =====================================================================
   Conexión con menú, campanita, respaldo y botones
   ===================================================================== */
Object.assign(BIB_RENDER, { bibLectom:renderBibLectom, bibEval:renderBibEval, bibRank:renderBibRank, bibPremios:renderBibPremios, bibActiv:renderBibActiv });
BIB_VIEWS.push('bibLectom','bibEval','bibRank','bibPremios','bibActiv');

(()=>{ const on = bibNotificaciones; bibNotificaciones = function(){
  const g = on(), hoy = today();
  const prox = SigieLec.actividadesProximas(bibActivs(), hoy, 7), venc = SigieLec.actividadesVencidas(bibActivs(), hoy);
  if(prox.length) g.push({ ic:'📅', n:prox.length, texto:prox.length+' actividad(es) del plan lector en los próximos 7 días. La más cercana: «'+prox[0].titulo+'» ('+bibFechaCorta(prox[0].fecha)+').', view:'bibActiv', nivel:'warn' });
  if(venc.length) g.push({ ic:'📅', n:venc.length, texto:venc.length+' actividad(es) del plan lector ya pasaron y no están marcadas como hechas.', view:'bibActiv', nivel:'warn' });
  const pend = bibCanjes().filter(c=>c.estado==='pendiente').length;
  if(pend) g.push({ ic:'🎁', n:pend, texto:pend+' premio(s) canjeado(s) esperan ser entregados.', view:'bibPremios', nivel:'warn' });
  return g; }; })();

function bibWire8(){
  const $ = id=>document.getElementById(id), on = (id,fn)=>{ const e = $(id); if(e) e.addEventListener('click',fn); };
  // Lectómetro
  const q = $('lmQ');
  if(q){
    const elegir = ()=>{ const l = lmBuscarLector(q.value); if(l) lmElegir(l); else if(q.value.trim()) toast('No encuentro un lector único con ese texto. Elige uno de la lista.','err'); };
    q.addEventListener('change', elegir); q.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); elegir(); } });
  }
  on('lmScan', ()=>bibEscanearUno(c=>{ const l = lmBuscarLector(c); if(l) lmElegir(l); else toast('Ese carné no corresponde a ningún lector.','err'); }));
  on('lmOtro', ()=>lmElegir(null));
  document.querySelectorAll('[data-lmsel]').forEach(a=>a.onclick=e=>{ e.preventDefault(); lmElegir(lmLector(a.dataset.lmsel)); });
  on('lmGuardar', lmRegistrarLectura); on('lmCert', lmCertificado);
  on('lmEvalIr', ()=>{ lm.evalVer='banco'; STATE.view='bibEval'; render(); }); on('lmPremIr', ()=>{ STATE.view='bibPremios'; render(); });
  if($('lmPag')){ const prev = ()=>{ const el = $('lmPrev'); if(el) el.textContent = 'Ganará '+SigieLec.puntosLectura($('lmPag').value, $('lmMin').value)+' puntos.'; }; $('lmPag').oninput = prev; $('lmMin').oninput = prev; prev(); }
  document.querySelectorAll('[data-lmdel]').forEach(b=>b.onclick=async()=>{ if(!guardEdit()) return; if(!confirm('¿Eliminar este registro de lectura? Se restan sus puntos.')) return;
    await DB.save(L7.bit, bibBitacora().filter(x=>x.id!==b.dataset.lmdel)); registrarBitacora('Lectómetro: lectura eliminada', b.dataset.lmdel); render(); });
  on('lmImp', ()=>$('lmImpF').click()); if($('lmImpF')) $('lmImpF').onchange = e=>{ if(e.target.files[0]) lmImportarLectorIEP(e.target.files[0]); e.target.value = ''; };
  // Evaluaciones
  document.querySelectorAll('[data-lmev]').forEach(b=>b.onclick=()=>{ lm.evalVer = b.dataset.lmev; render(); });
  on('evNueva', ()=>lmEvalModal());
  document.querySelectorAll('[data-evedit]').forEach(b=>b.onclick=()=>lmEvalModal(b.dataset.evedit));
  document.querySelectorAll('[data-evrendir]').forEach(b=>b.onclick=()=>lmRendirModal(b.dataset.evrendir));
  document.querySelectorAll('[data-evdel]').forEach(b=>b.onclick=async()=>{ if(!guardEdit()) return; const x = bibEvals().find(e=>e.id===b.dataset.evdel); if(!x||!confirm('¿Eliminar la evaluación «'+x.titulo+'»? Sus resultados dejarán de mostrarse aquí (la comprensión lectora ya registrada se conserva).')) return;
    await DB.save(L7.quiz, bibEvals().filter(e=>e.id!==x.id)); await DB.save(L7.qres, bibEvalRes().filter(r=>r.quizId!==x.id)); registrarBitacora('Evaluación eliminada', x.titulo); render(); });
  document.querySelectorAll('[data-evresdel]').forEach(b=>b.onclick=async()=>{ if(!confirm('¿Eliminar este resultado? El lector podrá rendir la evaluación otra vez.')) return;
    const r = bibEvalRes().find(x=>x.id===b.dataset.evresdel); await DB.save(L7.qres, bibEvalRes().filter(x=>x.id!==b.dataset.evresdel));
    if(r) await DB.save(B6.cmp, bibCompr().filter(c=>!(c.evalId===r.quizId && c.lectorId===r.lectorId && c.fecha===r.fecha))); registrarBitacora('Resultado de evaluación eliminado', b.dataset.evresdel); render(); });
  // Ranking
  if($('rkGrupo')) $('rkGrupo').onchange = e=>{ lm.grupo = e.target.value; render(); };
  on('rkXls', ()=>{ const l = lmRanking().filter(f=>!lm.grupo||f.grupo===lm.grupo); if(!l.length){ toast('No hay datos para exportar.','err'); return; }
    bibXlsx('biblioteca-ranking-lectometro-'+today(), [['Ranking', [['Puesto','Lector','Aula','Nivel','Puntos','Libros','Racha','Insignias'], ...l.map(f=>[f.pos,f.lector.nombre,f.grupo,f.nivel.nombre,f.puntos,f.libros,f.racha,f.insignias.length])]]]); });
  // Premios
  on('pmNuevo', ()=>lmPremioModal()); on('pmCanje', ()=>lmCanjearModal());
  document.querySelectorAll('[data-pmedit]').forEach(b=>b.onclick=()=>lmPremioModal(b.dataset.pmedit));
  document.querySelectorAll('[data-pmtog]').forEach(b=>b.onclick=async()=>{ if(!guardEdit()) return; await DB.save(L7.prem, bibPremios().map(p=>p.id===b.dataset.pmtog?{...p, activo:p.activo===false}:p)); render(); });
  document.querySelectorAll('[data-pmdel]').forEach(b=>b.onclick=async()=>{ const p = bibPremios().find(x=>x.id===b.dataset.pmdel); if(!p) return; const n = bibCanjes().filter(c=>c.premioId===p.id).length;
    if(!confirm('¿Eliminar el premio «'+p.nombre+'»?'+(n?' Tiene '+n+' canje(s) registrado(s): también se quitan y los puntos se devuelven.':''))) return;
    await DB.save(L7.prem, bibPremios().filter(x=>x.id!==p.id)); if(n) await DB.save(L7.canj, bibCanjes().filter(c=>c.premioId!==p.id)); registrarBitacora('Premio eliminado', p.nombre); render(); });
  document.querySelectorAll('[data-cjent]').forEach(b=>b.onclick=async()=>{ if(!guardEdit()) return; await DB.save(L7.canj, bibCanjes().map(c=>c.id===b.dataset.cjent?{...c, estado:'entregado', entregado:today(), entregadoPor:bibQuien()}:c)); registrarBitacora('Premio entregado', b.dataset.cjent); toast('Marcado como entregado.','ok'); render(); });
  document.querySelectorAll('[data-cjanu]').forEach(b=>b.onclick=async()=>{ if(!guardEdit()) return; const c = bibCanjes().find(x=>x.id===b.dataset.cjanu); if(!c||!confirm('¿Anular este canje? Se devuelven los puntos y una unidad al stock.')) return;
    await DB.save(L7.canj, bibCanjes().map(x=>x.id===c.id?{...x, estado:'anulado'}:x)); const p = bibPremios().find(x=>x.id===c.premioId);
    if(p && p.stock!==null && p.stock!==undefined) await DB.save(L7.prem, bibPremios().map(x=>x.id===p.id?{...x, stock:Number(x.stock)+1}:x)); registrarBitacora('Canje anulado', c.id); render(); });
  // Actividades
  on('acNueva', ()=>lmActividadModal());
  document.querySelectorAll('[data-acver]').forEach(b=>b.onclick=()=>{ lm.actVer = b.dataset.acver; render(); });
  document.querySelectorAll('[data-acedit]').forEach(b=>b.onclick=()=>lmActividadModal(b.dataset.acedit));
  document.querySelectorAll('[data-acok]').forEach(b=>b.onclick=async()=>{ if(!guardEdit()) return; await DB.save(L7.act, bibActivs().map(a=>a.id===b.dataset.acok?{...a, hecha:!a.hecha}:a)); render(); });
  document.querySelectorAll('[data-acdel]').forEach(b=>b.onclick=async()=>{ if(!guardEdit()) return; const a = bibActivs().find(x=>x.id===b.dataset.acdel); if(!a||!confirm('¿Eliminar la actividad «'+a.titulo+'»?')) return; await DB.save(L7.act, bibActivs().filter(x=>x.id!==a.id)); registrarBitacora('Actividad eliminada', a.titulo); render(); });
}
(()=>{ const ow = bibWire5; bibWire5 = function(){ ow(); bibWire8(); }; })();
