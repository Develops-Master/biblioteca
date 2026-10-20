/* =========================================================================
   SIGIE — Modo rápido de verificación de inventario (por aula, con cámara)
   -------------------------------------------------------------------------
   Pensado para el trabajo de campo: caminar por las aulas escaneando la
   etiqueta QR de cada bien, sin cargar el sistema completo (catálogo SBN de
   más de 4700 denominaciones, presupuestos, consumibles, fotos, gráficos,
   etc.). Usa el MISMO core.js (misma base de datos, misma sesión) que
   index.html, así que todo lo que se registra aquí aparece de inmediato en
   el sistema completo — incluida la tabla de "Toma de inventario" (Kardex).

   © 2026 Luis Hider Manco Berrocal — CIST. Todos los derechos reservados.

   Flujo:
   1) Selección de aula a verificar.
   2) Escaneo continuo: cada bien encontrado se marca solo, sin cerrar la
      cámara ni pedir confirmación — apunta, "beep", siguiente bien.
   3) Si un QR no se puede leer (etiqueta dañada o despegada), hay una lista
      de pendientes con marcado manual, y un campo para escribir el código
      a mano.
   4) Al finalizar, se guarda un registro en KEYS.tomas con la MISMA
      estructura que genera la toma de inventario de escritorio (ver
      finalizarToma() en app.js), así que ambas aparecen juntas en los
      reportes existentes sin necesidad de tocar esa parte del sistema.
   ========================================================================= */

let sesion = null;      // { aulaId, aulaNombre, responsable, fecha, registros:[...] }
let escaner = null;     // instancia de QrScanner
let ultimoRegistro = null; // último bien marcado, para el panel de "cambiar estado"
let _ultimoCodigo = '', _ultimoCodigoTs = 0;
const MR_COOLDOWN_MS = 1800; // evita reprocesar el mismo QR si sigue frente a la cámara

/* ---------------------------------------------------------------------
   0. INICIO — carga solo lo indispensable (NO el catálogo SBN, NO fotos,
   NO consumibles/presupuestos/planos, etc.)
   --------------------------------------------------------------------- */
async function initModoRapido(){
  await detectarAlmacenamiento();
  // Con el servidor local la sesión vive en el servidor: sin sesión vigente no se pide ningún dato.
  if(STORAGE_MODE==='servidor'){
    const s = await cargarSesionServidor();
    if(!s){ window.location.href = 'login.html?next=modo-rapido.html'; return; }
    STATE.session = s;
  }
  await Promise.all([
    DB.load(KEYS.usuarios, []),
    DB.load(KEYS.aulas, []),
    DB.load(KEYS.items, []),
    DB.load(KEYS.tomas, []),
    DB.load(KEYS.movs, []),
    DB.load(KEYS.config, DEFAULT_CONFIG),
    // Estos cuatro son los que hacen falta para poder dar de alta, en el
    // momento, un bien hallado en el aula que nunca fue registrado (ver
    // sección 9, "saneamiento"). No son una carga extra real: el catálogo
    // SBN y las categorías de depreciación YA viven embebidos en core.js
    // como valor por defecto (SEED_CATALOGO / SEED_CATEGORIAS_DEPREC), así
    // que esto solo agrega una lectura más a la base de datos, no descarga
    // nada nuevo por internet.
    DB.load(KEYS.catalogo, SEED_CATALOGO),
    DB.load(KEYS.categoriasDeprec, SEED_CATEGORIAS_DEPREC),
    DB.load(KEYS.seqPorSBN, {}),
    DB.load(KEYS.seqInterno, 0)
  ]);

  // Sesión: mismo mecanismo que login.js/app.js (localStorage del navegador).
  if(STORAGE_MODE!=='claude' && STORAGE_MODE!=='servidor'){
    try{
      const raw = window.localStorage.getItem('sigie:sesion_actual');
      if(raw){
        const s = JSON.parse(raw);
        const u = DB.get(KEYS.usuarios).find(x=>x.id===s.id);
        if(u) STATE.session = { id:u.id, usuario:u.usuario, nombre:u.nombre, rol:u.rol, aulaIds:u.aulaIds||[] };
      }
    }catch(e){}
  }
  if(!STATE.session){ window.location.href = 'login.html?next=modo-rapido.html'; return; }

  if(typeof QrScanner==='undefined'){
    document.getElementById('app').innerHTML = `<div class="mr-wrap"><div class="mr-content">
      <div class="card"><div class="card-b">No se pudo cargar el lector de QR (verifica tu conexión a internet e inténtalo de nuevo). <br><br><a class="btn" href="index.html">Ir al sistema completo</a></div></div>
    </div></div>`;
    return;
  }
  render();
}

/* ---------------------------------------------------------------------
   1. AULAS QUE PUEDE VERIFICAR ESTE USUARIO (respeta el rol DOCENTE)
   --------------------------------------------------------------------- */
function misAulasRapido(){
  const mis = misAulaIds();
  const aulas = DB.get(KEYS.aulas)||[];
  return mis===null ? aulas : aulas.filter(a=>mis.includes(a.id));
}
function itemsActivosDeAula(aulaId){
  return (DB.get(KEYS.items)||[]).filter(i=>i.aulaId===aulaId && i.situacion!=='De baja');
}

/* ---------------------------------------------------------------------
   2. RENDER PRINCIPAL
   --------------------------------------------------------------------- */
function render(){
  const app = document.getElementById('app');
  app.innerHTML = sesion ? pantallaEscaneo() : pantallaSeleccion();
  wireEventosComunes();
  if(sesion){ wireEventosEscaneo(); iniciarCamara(); }
}

function pantallaSeleccion(){
  const cfg = DB.get(KEYS.config)||DEFAULT_CONFIG;
  const aulas = misAulasRapido().map(a=>({ aula:a, n: itemsActivosDeAula(a.id).length })).filter(x=>x.n>0);
  return `<div class="mr-wrap">
    <div class="mr-topbar">
      <div class="mr-topbar-row">
        <div><h2>🏃 Modo rápido</h2><div class="sub">${esc(cfg.nombreIE||'SIGIE')} · ${esc(currentUser().nombre||currentUser().usuario)}</div></div>
        <a class="mr-back" href="index.html">Sistema completo →</a>
      </div>
    </div>
    <div class="mr-content">
      ${!canEdit()?`<div class="card"><div class="card-b">Tu rol es de solo consulta: puedes ver este listado, pero no registrar una toma de inventario.</div></div>`:''}
      <div class="hint">Elige el aula que vas a verificar. Se listarán solo las aulas con bienes activos asignados.</div>
      <div class="mr-aula-list">
        ${aulas.map(({aula,n})=>`<button class="mr-aula-card" data-aula="${aula.id}">
          <span><span class="nom">${esc(aula.aulaLabel||aula.nombre)}</span><span class="det">${esc(aula.responsable||'Sin responsable asignado')} · ${n} bien(es) activo(s)</span></span>
          <span>›</span>
        </button>`).join('')}
        ${aulas.length===0?`<div class="card"><div class="card-b">No hay aulas con bienes activos disponibles para verificar.</div></div>`:''}
      </div>
    </div>
  </div>`;
}

function pantallaEscaneo(){
  const encontrados = sesion.registros.filter(r=>r.encontrado).length;
  const total = sesion.registros.length;
  const pct = total? Math.round(encontrados/total*100) : 0;
  return `<div class="mr-wrap">
    <div class="mr-topbar">
      <div class="mr-topbar-row">
        <div><h2>${esc(sesion.aulaNombre)}</h2><div class="sub">${encontrados} de ${total} verificado(s)</div></div>
        <a class="mr-back" id="mrCancelar" href="#">Cancelar ✕</a>
      </div>
      <div class="mr-progress"><div class="mr-progress-fill" style="width:${pct}%"></div></div>
    </div>
    <div class="mr-content">
      <div class="mr-video-wrap">
        <video id="mrVideo" playsinline muted></video>
        <div class="mr-flash" id="mrFlash"></div>
      </div>

      <div class="mr-last" id="mrLast" style="display:none;"></div>

      <div class="mr-manual">
        <input id="mrManualCodigo" placeholder="¿No lee el QR? Escribe el código aquí…">
        <button class="btn" id="mrManualBtn">Marcar</button>
      </div>
      <button class="btn btn-sm" id="mrSaneamiento" style="align-self:flex-start;">🧾 + Bien hallado sin registrar</button>

      <div class="card">
        <div class="card-h" id="mrTogglePend" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0;">Pendientes (${total-encontrados})</h3><span id="mrPendArrow">▾</span>
        </div>
        <div id="mrPendWrap" style="display:none;"><div class="card-b"><div class="mr-pend-list" id="mrPendList"></div></div></div>
      </div>

      <div class="mr-footer">
        <button class="btn btn-primary" id="mrFinalizar">Finalizar toma de inventario</button>
      </div>
    </div>
  </div>`;
}

function renderPendientes(){
  const wrap = document.getElementById('mrPendList');
  if(!wrap) return;
  const pendientes = sesion.registros.filter(r=>!r.encontrado);
  wrap.innerHTML = pendientes.map(r=>`<div class="mr-pend-item">
      <span><span class="nom">${esc(r.denominacion)}</span><br><span class="cod">${esc(r.codigoInterno)}</span></span>
      <button class="btn btn-sm" data-marcar-manual="${esc(r.itemId)}">Marcar</button>
    </div>`).join('') || `<div class="mr-pend-item">Todos los bienes de esta aula ya fueron verificados.</div>`;
  document.getElementById('mrTogglePend') && (document.getElementById('mrTogglePend').querySelector('h3').textContent = 'Pendientes ('+pendientes.length+')');
  wrap.querySelectorAll('[data-marcar-manual]').forEach(b=>b.addEventListener('click', ()=>marcarEncontradoPorItemId(b.dataset.marcarManual)));
}

/* ---------------------------------------------------------------------
   3. EVENTOS
   --------------------------------------------------------------------- */
function wireEventosComunes(){
  document.querySelectorAll('[data-aula]').forEach(b=>b.addEventListener('click', ()=>iniciarSesion(b.dataset.aula)));
}
function wireEventosEscaneo(){
  document.getElementById('mrCancelar').addEventListener('click', e=>{
    e.preventDefault();
    if(confirm('¿Cancelar esta toma de inventario? No se guardará nada de lo escaneado.')){ detenerCamara(); sesion=null; render(); }
  });
  document.getElementById('mrTogglePend').addEventListener('click', ()=>{
    const w = document.getElementById('mrPendWrap');
    const abierto = w.style.display!=='none';
    w.style.display = abierto?'none':'block';
    document.getElementById('mrPendArrow').textContent = abierto?'▾':'▴';
    if(!abierto) renderPendientes();
  });
  document.getElementById('mrManualBtn').addEventListener('click', ()=>{
    const inp = document.getElementById('mrManualCodigo');
    procesarCodigo(inp.value.trim());
    inp.value='';
  });
  document.getElementById('mrManualCodigo').addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('mrManualBtn').click(); });
  document.getElementById('mrSaneamiento').addEventListener('click', abrirFormularioSaneamiento);
  document.getElementById('mrFinalizar').addEventListener('click', finalizarTomaRapida);
}

/* ---------------------------------------------------------------------
   4. INICIAR / CANCELAR SESIÓN DE VERIFICACIÓN
   --------------------------------------------------------------------- */
function iniciarSesion(aulaId){
  if(!canEdit()){ toast('Tu rol es de solo consulta: no puedes registrar una toma de inventario.', 'err'); return; }
  const aula = (DB.get(KEYS.aulas)||[]).find(a=>a.id===aulaId);
  const items = itemsActivosDeAula(aulaId);
  if(!aula || items.length===0){ toast('Esta aula no tiene bienes activos registrados.', 'err'); return; }
  sesion = {
    aulaId, aulaNombre: aula.aulaLabel||aula.nombre, responsable: aula.responsable||'',
    fecha: today(),
    registros: items.map(i=>({
      itemId:i.id, codigoInterno:i.codigoInterno, codigoUsoInterno:i.codigoUsoInterno||'',
      denominacion:i.denominacion, estadoRegistrado:i.estadoConservacion,
      encontrado:false, estadoEncontrado:i.estadoConservacion, observacion:''
    })),
    // Bienes hallados durante ESTA sesión que no estaban en el inventario (ver
    // sección 9, "saneamiento"). Se listan aparte para el reporte, aunque
    // también se agregan a "registros" para que cuenten en el progreso.
    noRegistrados: []
  };
  render();
}

/* ---------------------------------------------------------------------
   5. CÁMARA — escaneo CONTINUO (no se cierra tras cada lectura, a
   diferencia del lector de QR del sistema completo, pensado para abrir
   una ficha puntual). Aquí el objetivo es encadenar bien tras bien.
   --------------------------------------------------------------------- */
function iniciarCamara(){
  const video = document.getElementById('mrVideo');
  if(!video) return;
  escaner = new QrScanner(video, result=>{
    const texto = (typeof result==='string') ? result : (result && result.data) || '';
    if(texto) procesarCodigo(texto);
  }, { highlightScanRegion:false, highlightCodeOutline:false, preferredCamera:'environment', maxScansPerSecond:6 });
  escaner.start().catch(err=>{
    marcarFeedback('err', 'No se pudo acceder a la cámara. Revisa el permiso de cámara del navegador ('+((err&&err.message)||err)+').');
  });
}
function detenerCamara(){
  if(escaner){ try{escaner.stop();}catch(e){} try{escaner.destroy();}catch(e){} escaner=null; }
}

/* ---------------------------------------------------------------------
   6. PROCESAR UN CÓDIGO (venga de la cámara o escrito a mano)
   --------------------------------------------------------------------- */
function procesarCodigo(textoCrudo){
  if(!textoCrudo) return;
  // El texto de la etiqueta QR trae la ficha completa; el código patrimonial
  // interno viene en la línea "Código: …" (ver qrPayload en app.js). Si se
  // escribe a mano, o es un código de barras, el texto ES el código.
  const m = textoCrudo.match(/C[oó]digo:\s*(\S+)/i);
  const codigo = (m ? m[1] : textoCrudo.trim());
  if(!codigo) return;

  const ahora = Date.now();
  if(codigo===_ultimoCodigo && (ahora-_ultimoCodigoTs)<MR_COOLDOWN_MS) return; // el mismo QR sigue frente a la cámara
  _ultimoCodigo = codigo; _ultimoCodigoTs = ahora;

  const reg = sesion.registros.find(r=>r.codigoInterno===codigo || r.codigoUsoInterno===codigo);
  if(reg){
    const yaEstaba = reg.encontrado;
    reg.encontrado = true;
    ultimoRegistro = reg;
    marcarFeedback(yaEstaba?'info':'ok', (yaEstaba?'Ya estaba verificado: ':'✓ ')+reg.denominacion);
    if(!yaEstaba) vibrarFeedback();
    mostrarPanelUltimo();
    actualizarProgreso();
    return;
  }
  // ¿Es un bien real pero de OTRA aula? (para no confundir al que escanea)
  const otro = (DB.get(KEYS.items)||[]).find(i=>i.codigoInterno===codigo || i.codigoUsoInterno===codigo);
  if(otro){
    marcarFeedback('warn', 'Ese bien pertenece a otra aula: '+(otro.aulaNombre||'—')+'. No se marcó aquí.');
  }else{
    marcarFeedback('err', 'Código no reconocido: '+codigo+'. Si es un bien real sin registrar, usa "+ Bien hallado sin registrar".');
  }
}
function marcarEncontradoPorItemId(itemId){
  const reg = sesion.registros.find(r=>r.itemId===itemId);
  if(!reg) return;
  reg.encontrado = true;
  ultimoRegistro = reg;
  toast('Marcado manualmente: '+reg.denominacion, 'ok');
  mostrarPanelUltimo();
  actualizarProgreso();
  renderPendientes();
}

/* ---------------------------------------------------------------------
   7. RETROALIMENTACIÓN (visual + vibración) Y PANEL DEL ÚLTIMO BIEN
   --------------------------------------------------------------------- */
function marcarFeedback(tipo, texto){
  const el = document.getElementById('mrFlash');
  if(!el) return;
  el.className = 'mr-flash show '+tipo;
  el.textContent = texto;
  clearTimeout(el._t);
  el._t = setTimeout(()=>{ el.classList.remove('show'); }, 1600);
}
function vibrarFeedback(){ try{ if(navigator.vibrate) navigator.vibrate(70); }catch(e){} }
function mostrarPanelUltimo(){
  const el = document.getElementById('mrLast');
  if(!el || !ultimoRegistro) return;
  const r = ultimoRegistro;
  el.style.display = 'block';
  el.innerHTML = `
    <div class="nom">Último: ${esc(r.denominacion)}</div>
    <div class="cod">${esc(r.codigoInterno)}</div>
    <div class="mr-estado-row">
      ${ESTADOS_CONSERVACION.map(e=>`<button class="btn btn-sm ${r.estadoEncontrado===e?'sel':''}" data-estado="${e}">${ESTADO_ABREV[e]}</button>`).join('')}
    </div>
    <input class="mr-obs" id="mrObsUltimo" placeholder="Observación (opcional, ej. falta un cajón)" value="${esc(r.observacion)}" style="margin-top:8px;width:100%;">
  `;
  el.querySelectorAll('[data-estado]').forEach(b=>b.addEventListener('click', ()=>{ r.estadoEncontrado = b.dataset.estado; mostrarPanelUltimo(); }));
  document.getElementById('mrObsUltimo').addEventListener('input', e=>{ r.observacion = e.target.value; });
}
function actualizarProgreso(){
  const encontrados = sesion.registros.filter(r=>r.encontrado).length;
  const total = sesion.registros.length;
  const sub = document.querySelector('.mr-topbar .sub');
  const fill = document.querySelector('.mr-progress-fill');
  if(sub) sub.textContent = encontrados+' de '+total+' verificado(s)';
  if(fill) fill.style.width = (total?Math.round(encontrados/total*100):0)+'%';
}

/* ---------------------------------------------------------------------
   8. FINALIZAR — guarda con la MISMA forma que finalizarToma() en app.js,
   para que esta toma aparezca junto a las de escritorio en los reportes.
   --------------------------------------------------------------------- */
async function finalizarTomaRapida(){
  const faltantes = sesion.registros.filter(r=>!r.encontrado);
  let mensaje = '';
  if(faltantes.length>0) mensaje += `Hay ${faltantes.length} bien(es) no escaneado(s). Quedarán marcados como "Perdido/Sustraído".\n`;
  if(!confirm(mensaje+'¿Finalizar esta toma de inventario?')) return;

  detenerCamara();

  let items = DB.get(KEYS.items)||[];
  const record = {
    id:uid('toma'), aulaId:sesion.aulaId, aulaNombre:sesion.aulaNombre, responsable:sesion.responsable,
    fecha:sesion.fecha, verificadoPor: (currentUser().nombre||currentUser().usuario)+' (modo rápido)',
    items: sesion.registros.map(r=>({ itemId:r.itemId, codigoInterno:r.codigoInterno, denominacion:r.denominacion, encontrado:r.encontrado, estadoEncontrado:r.estadoEncontrado, observacion:r.observacion })),
    noRegistrados: sesion.noRegistrados
  };
  await DB.save(KEYS.tomas, [...(DB.get(KEYS.tomas)||[]), record]);

  const movsNuevos = [];
  for(const r of sesion.registros){
    if(r.encontrado){
      if(r.estadoEncontrado !== r.estadoRegistrado) items = items.map(it=>it.id===r.itemId?{...it, estadoConservacion:r.estadoEncontrado}:it);
    }else{
      items = items.map(it=>it.id===r.itemId?{...it, situacion:'Perdido/Sustraído'}:it);
    }
    const detalle = r.encontrado
      ? ('Verificado en toma de inventario (modo rápido) del '+sesion.fecha+' — presente'+(r.estadoEncontrado!==r.estadoRegistrado?(', estado actualizado a '+r.estadoEncontrado):'')+(r.observacion?(' — '+r.observacion):'')+' ('+currentUser().usuario+').')
      : ('Verificado en toma de inventario (modo rápido) del '+sesion.fecha+' — NO encontrado ('+currentUser().usuario+').');
    movsNuevos.push({ id:uid('mov'), itemId:r.itemId, codigoInterno:r.codigoInterno, tipo:'Observación', detalle, fecha:today() });
  }
  await DB.save(KEYS.items, items);
  await DB.save(KEYS.movs, [...(DB.get(KEYS.movs)||[]), ...movsNuevos]);

  const encontrados = sesion.registros.filter(r=>r.encontrado).length;
  toast('Toma registrada: '+encontrados+'/'+sesion.registros.length+' bien(es) encontrados.', 'ok');
  sesion = null;
  render();
}

/* ---------------------------------------------------------------------
   9. BIENES HALLADOS SIN REGISTRAR ("saneamiento") — cuando durante el
   recorrido se encuentra en el aula un bien que nunca fue dado de alta
   (típico en inventarios heredados de años anteriores). Se registra ahí
   mismo, sin forzar una fecha ni un valor de adquisición inventados, con
   situación "Por sanear" — igual que hace la toma de inventario de
   escritorio (ver finalizarToma() en app.js). Copias pequeñas y puras de
   sus funciones de apoyo, para no tener que cargar app.js completo aquí.
   --------------------------------------------------------------------- */
function normalizaBusqueda(s){
  return (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
}
const PALABRAS_EXCLUIDAS_CARGADOR = ['FRONTAL','TELESCOPICO','APILADOR','DOSIMETRO','ELEVADOR','MINICARGADOR','STACKER'];
function esCargadorDeBateria(denominacion){
  const d = normalizaBusqueda(denominacion);
  if(!d.includes('CARGADOR')) return false;
  return !PALABRAS_EXCLUIDAS_CARGADOR.some(p=>d.includes(p));
}
const SINONIMOS_SBN = {
  'LAPTOP':'74080500', 'LAP TOP':'74080500', 'NOTEBOOK':'74080500', 'NOTE BOOK':'74080500',
  'COMPUTADORA PORTATIL':'74080500', 'COMPUTADORA PORTATIL PERSONAL':'74080500',
  'COMPUTADORA LAPTOP':'74080500', 'LAPTOP PORTATIL':'74080500', 'COMPUTADORA NOTEBOOK':'74080500',
  'PC PORTATIL':'74080500', 'PC LAPTOP':'74080500', 'COMPUTADORA PERSONAL LAPTOP':'74080500'
};
function lookupSBN(denominacion){
  if(!denominacion) return '';
  const cat = DB.get(KEYS.catalogo)||[];
  if(esCargadorDeBateria(denominacion) && cat.some(c=>c.codigoSBN==='46221341')) return '46221341';
  const d = normalizaBusqueda(denominacion);
  const sinonimo = SINONIMOS_SBN[d];
  if(sinonimo && cat.some(c=>c.codigoSBN===sinonimo)) return sinonimo;
  const hit = cat.find(c => normalizaBusqueda(c.denominacion) === d);
  if(hit) return hit.codigoSBN;
  const contenidos = cat.filter(c => d.includes(normalizaBusqueda(c.denominacion)));
  if(contenidos.length>0){
    contenidos.sort((a,b)=> normalizaBusqueda(b.denominacion).length - normalizaBusqueda(a.denominacion).length);
    return contenidos[0].codigoSBN;
  }
  const queLoContienen = cat.filter(c => normalizaBusqueda(c.denominacion).includes(d));
  return queLoContienen.length===1 ? queLoContienen[0].codigoSBN : '';
}
function buildCodigoPatrimonial(codigoSBN, correlativo){
  const s = String(codigoSBN||'').replace(/\D/g,'').padStart(8,'0').slice(0,8);
  const c = String(correlativo).padStart(4,'0');
  return s+c;
}
async function nextCorrelativoPorSBN(codigoSBN){
  const mapa = { ...(DB.get(KEYS.seqPorSBN)||{}) };
  const key = String(codigoSBN||'').trim() || 'SINCODIGO';
  const n = (mapa[key]||0) + 1;
  mapa[key] = n;
  await DB.save(KEYS.seqPorSBN, mapa);
  return n;
}
async function nextCorrelativoInterno(){
  let seq = (DB.get(KEYS.seqInterno)||0) + 1;
  await DB.save(KEYS.seqInterno, seq);
  return seq;
}
function buildCodigoUsoInterno(seq){ return String(seq).padStart(6,'0'); }

function abrirFormularioSaneamiento(){
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML = `<div class="modal" style="max-width:420px;">
    <div class="m-h"><h3>Bien hallado sin registrar</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="hint" style="margin-bottom:10px;">Se dará de alta en el aula <b>${esc(sesion.aulaNombre)}</b> con situación "Por sanear", sin forzar una fecha ni un valor de adquisición inventados.</div>
      <div class="field"><label>Denominación *</label><input id="sn_denom" placeholder="Ej. SILLA DE MADERA"></div>
      <div class="field"><label>Marca</label><input id="sn_marca"></div>
      <div class="field"><label>Modelo</label><input id="sn_modelo"></div>
      <div class="field"><label>Estado</label><select id="sn_estado">${ESTADOS_CONSERVACION.map(e=>`<option value="${e}">${ESTADO_ABREV[e]} - ${e}</option>`).join('')}</select></div>
      <div class="field"><label>Observación</label><input id="sn_obs" placeholder="Ej. Encontrado en el depósito del aula"></div>
    </div>
    <div class="m-f"><button class="btn" id="sn_cancel">Cancelar</button><button class="btn btn-primary" id="sn_guardar">Registrar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#sn_cancel').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  bg.querySelector('#sn_guardar').addEventListener('click', async ()=>{
    const denominacion = bg.querySelector('#sn_denom').value.trim().toUpperCase();
    if(!denominacion){ toast('Escribe la denominación del bien.', 'err'); return; }
    const nuevo = {
      denominacion, marca: bg.querySelector('#sn_marca').value.trim(),
      modelo: bg.querySelector('#sn_modelo').value.trim(),
      estadoConservacion: bg.querySelector('#sn_estado').value,
      observacion: bg.querySelector('#sn_obs').value.trim()
    };
    close();
    await registrarBienSaneado(nuevo);
  });
}
async function registrarBienSaneado(r){
  const cfg = DB.get(KEYS.config)||DEFAULT_CONFIG;
  const codigoSBN = lookupSBN(r.denominacion) || '';
  const correlativoSBN = await nextCorrelativoPorSBN(codigoSBN);
  const codigoInterno = buildCodigoPatrimonial(codigoSBN, correlativoSBN);
  const codigoUsoInterno = buildCodigoUsoInterno(await nextCorrelativoInterno());
  const nuevoItem = {
    id: uid('item'), codigoInterno, codigoAnioAnterior:'', codigoUsoInterno,
    denominacion: r.denominacion, codigoSBN,
    marca: r.marca||'', modelo: r.modelo||'', numeroSerie:'', color:'',
    estadoConservacion: r.estadoConservacion||'Bueno',
    aulaId: sesion.aulaId, aulaNombre: sesion.aulaNombre,
    valorAdquisicion: null, categoriaDeprecId: lookupCategoriaDeprec(r.denominacion),
    custodioId:'', custodioNombre: sesion.responsable||'',
    situacion:'Por sanear', pendienteSaneamiento:true,
    motivoSaneamiento: 'Hallado físicamente en el aula "'+sesion.aulaNombre+'" durante la toma de inventario (modo rápido) del '+sesion.fecha+', sin registro previo (sin documentación de compra).',
    fotoId:'', fotosIds:[], fotosHistorial:[],
    observaciones: r.observacion||'',
    fechaRegistro: sesion.fecha, anio: cfg.anioFiscal, garantiaHasta:'',
    registradoPor: currentUser().usuario
  };
  const items = [...(DB.get(KEYS.items)||[]), nuevoItem];
  await DB.save(KEYS.items, items);
  await DB.save(KEYS.movs, [...(DB.get(KEYS.movs)||[]), { id:uid('mov'), itemId:nuevoItem.id, codigoInterno, tipo:'Alta', detalle:'Hallado sin registro previo en toma de inventario (modo rápido) del '+sesion.fecha+' — dado de alta como "Por sanear" por '+currentUser().usuario+'.', fecha:today() }]);

  // Se agrega también a la sesión en curso, ya como "encontrado", para que
  // cuente en el progreso y quede incluido en el registro de la toma al
  // finalizar, con su código recién asignado.
  sesion.registros.push({ itemId:nuevoItem.id, codigoInterno, codigoUsoInterno, denominacion:nuevoItem.denominacion, estadoRegistrado:nuevoItem.estadoConservacion, encontrado:true, estadoEncontrado:nuevoItem.estadoConservacion, observacion:'Hallado sin registro previo (saneamiento).' });
  sesion.noRegistrados.push({ itemId:nuevoItem.id, codigoInterno, denominacion:nuevoItem.denominacion, observacion:nuevoItem.observaciones });
  ultimoRegistro = sesion.registros[sesion.registros.length-1];
  toast('Bien registrado como "Por sanear": '+codigoInterno, 'ok');
  mostrarPanelUltimo();
  actualizarProgreso();
}

initModoRapido();
