/* =========================================================================
   SIGIE — Sistema de Gestión de Inventario Escolar
   Lógica principal de la aplicación (index.html)
   -------------------------------------------------------------------------
   © 2026 Luis Hider Manco Berrocal — CIST. Todos los derechos reservados.
   ========================================================================= */
async function initApp(){
  await detectarAlmacenamiento();
  // Con el servidor local la sesión vive en el servidor: sin sesión vigente no se pide ningún dato.
  if(STORAGE_MODE==='servidor'){
    const s = await cargarSesionServidor();
    if(!s){ window.location.href = 'login.html'; return; }
    STATE.session = s;
  }
  await Promise.all([
    DB.load(KEYS.config, DEFAULT_CONFIG), DB.load(KEYS.aulas, []), DB.load(KEYS.custodios, []),
    DB.load(KEYS.catalogo, SEED_CATALOGO), DB.load(KEYS.items, []), DB.load(KEYS.movs, []),
    DB.load(KEYS.seq, 0), DB.load(KEYS.seqInterno, 0), DB.load(KEYS.seqPorSBN, {}), DB.load(KEYS.usuarios, []), DB.load(KEYS.papelera, []), DB.load(KEYS.prestamos, []),
    DB.load(KEYS.cargos, SEED_CARGOS), DB.load(KEYS.tomas, []), DB.load(KEYS.mantenimientos, []),
    DB.load(KEYS.categoriasDeprec, SEED_CATEGORIAS_DEPREC), DB.load(KEYS.snapshots, []), DB.load(KEYS.bitacora, []),
    DB.load(KEYS.polizas, []), DB.load(KEYS.conciliaciones, []), DB.load(KEYS.requerimientos, []), DB.load(KEYS.seqReq, 0),
    DB.load(KEYS.planos, []), DB.load(KEYS.bajas, []), DB.load(KEYS.seqBaja, 0),
    DB.load(KEYS.comision, []), DB.load(KEYS.actasFirmadas, []),
    DB.load(KEYS.consumibles, []), DB.load(KEYS.movsConsumibles, []),
    DB.load(KEYS.presupuestos, []), bibCargar()
  ]);
  await seedAdminIfNeeded();
  await preloadImagenes();
  await backfillCodigoUsoInterno();
  await backfillCategoriaDeprec();
  await migrarCodigoPatrimonialPorSBN();
  await normalizarDenominacionesPortatiles();
  await normalizarCargadores();
  await normalizarTabletas();
  await backfillCodigoSBNPorMejoraDeteccion();
  // Fuera de Claude sí se puede usar localStorage: recuperamos la sesión guardada
  // (si el usuario sigue existiendo) para no pedir login en cada recarga.
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
  STATE.loaded = true;
  if(!STATE.session){ window.location.href = 'login.html'; return; }
  // Cuando otro usuario guarda algo, DB.sincronizar() trae los datos nuevos y llama aquí para redibujar.
  DB.alActualizar = ()=>{ if(STATE.session) render(); };
  render();
  mostrarAlertaSesion();
  iniciarReintentoAutomatico();
}

/* ---------------------------------------------------------------------
   5. GENERADORES DE CÓDIGO
   --------------------------------------------------------------------- */
async function nextCorrelativo(){
  let seq = (DB.get(KEYS.seq)||0) + 1;
  await DB.save(KEYS.seq, seq);
  return seq;
}
// Correlativo independiente para el código interno de uso exclusivo del colegio:
// 000001, 000002, 000003... aumenta uno por cada bien que se registra, sin
// depender del año, la entidad ni del código patrimonial oficial.
async function nextCorrelativoInterno(){
  let seq = (DB.get(KEYS.seqInterno)||0) + 1;
  await DB.save(KEYS.seqInterno, seq);
  return seq;
}
function buildCodigoUsoInterno(seq){
  return String(seq).padStart(6,'0');
}
// Los bienes que ya estaban registrados ANTES de crearse el código interno
// del colegio no lo tienen guardado. Se les asigna aquí, una sola vez y en
// orden (por fecha de registro), para que salga en su etiqueta sin tener
// que abrir y volver a guardar cada bien manualmente.
async function backfillCodigoUsoInterno(){
  const items = DB.get(KEYS.items) || [];
  const pendientes = items.filter(i=>!i.codigoUsoInterno).sort((a,b)=>(a.fechaRegistro||'').localeCompare(b.fechaRegistro||''));
  if(pendientes.length===0) return;
  for(const it of pendientes){
    it.codigoUsoInterno = buildCodigoUsoInterno(await nextCorrelativoInterno());
  }
  await DB.save(KEYS.items, items);
}
// Bienes registrados antes de activar la depreciación automática (NICSP) no
// tienen categoriaDeprecId: se la asignamos una sola vez por sugerencia según
// su denominación, sin pisar la de quien ya la haya elegido a mano.
async function backfillCategoriaDeprec(){
  const items = DB.get(KEYS.items) || [];
  const categorias = DB.get(KEYS.categoriasDeprec) || [];
  const pendientes = items.filter(i=>!i.categoriaDeprecId);
  if(pendientes.length===0) return;
  for(const it of pendientes){ it.categoriaDeprecId = lookupCategoriaDeprec(it.denominacion, categorias); }
  await DB.save(KEYS.items, items);
}
// Código Patrimonial (formato SBN): Código SBN del bien (8 dígitos) + correlativo
// (4 dígitos). El correlativo es independiente por cada Código SBN: cada
// denominación/clase de bien lleva su propia numeración empezando en 0001,
// tal como lo pidió el responsable de patrimonio.
function buildCodigoPatrimonial(codigoSBN, correlativo){
  const s = String(codigoSBN||'').replace(/\D/g,'').padStart(8,'0').slice(0,8);
  const c = String(correlativo).padStart(4,'0');
  return s+c;
}
// Lleva, por cada Código SBN, el último correlativo (4 dígitos) ya asignado.
// Los bienes sin código SBN detectado comparten un grupo aparte ('SINCODIGO').
async function nextCorrelativoPorSBN(codigoSBN){
  const mapa = { ...(DB.get(KEYS.seqPorSBN)||{}) };
  const key = String(codigoSBN||'').trim() || 'SINCODIGO';
  const n = (mapa[key]||0) + 1;
  mapa[key] = n;
  await DB.save(KEYS.seqPorSBN, mapa);
  return n;
}
// MIGRACIÓN (una sola vez): recalcula el Código Patrimonial de TODOS los bienes
// ya registrados con el nuevo formato SBN+correlativo(4), en vez del código
// provisional anterior (entidad+año+correlativo de 6). Se agrupan por Código
// SBN y se numeran en orden de fecha de registro, para que el bien más antiguo
// de cada denominación quede como 0001. También se actualiza el kardex
// (movimientos), los préstamos activos y los mantenimientos, que guardan una
// copia del código para mostrarlo sin tener que volver a buscar el bien.
// Los snapshots del comparativo interanual NO se tocan: son la fotografía
// histórica de cada año y deben quedar tal como se guardaron entonces.
async function migrarCodigoPatrimonialPorSBN(){
  const cfg = DB.get(KEYS.config);
  if(cfg.migradoCodigoPatrimonialV2) return;
  const items = DB.get(KEYS.items) || [];
  if(items.length===0){ cfg.migradoCodigoPatrimonialV2 = true; await DB.save(KEYS.config, cfg); return; }
  const porSBN = new Map();
  [...items].sort((a,b)=>(a.fechaRegistro||'').localeCompare(b.fechaRegistro||'') || String(a.id).localeCompare(String(b.id)))
    .forEach(it=>{
      const key = String(it.codigoSBN||'').trim() || 'SINCODIGO';
      if(!porSBN.has(key)) porSBN.set(key, []);
      porSBN.get(key).push(it);
    });
  const nuevoCodigo = new Map(); // id -> código nuevo
  const seqFinal = {};
  porSBN.forEach((grupo, key)=>{
    grupo.forEach((it, idx)=>{
      const correlativo = idx+1;
      nuevoCodigo.set(it.id, buildCodigoPatrimonial(key==='SINCODIGO'?'':key, correlativo));
      seqFinal[key] = correlativo;
    });
  });
  items.forEach(it=>{ if(nuevoCodigo.has(it.id)) it.codigoInterno = nuevoCodigo.get(it.id); });
  await DB.save(KEYS.items, items);
  await DB.save(KEYS.seqPorSBN, seqFinal);
  const movs = DB.get(KEYS.movs) || [];
  movs.forEach(m=>{ if(nuevoCodigo.has(m.itemId)) m.codigoInterno = nuevoCodigo.get(m.itemId); });
  await DB.save(KEYS.movs, movs);
  const prestamos = DB.get(KEYS.prestamos) || [];
  prestamos.forEach(p=>{ (p.detalleEntrega||[]).forEach(d=>{ if(nuevoCodigo.has(d.itemId)) d.codigoInterno = nuevoCodigo.get(d.itemId); }); });
  await DB.save(KEYS.prestamos, prestamos);
  const mants = DB.get(KEYS.mantenimientos) || [];
  mants.forEach(m=>{ if(nuevoCodigo.has(m.itemId)) m.codigoInterno = nuevoCodigo.get(m.itemId); });
  await DB.save(KEYS.mantenimientos, mants);
  cfg.migradoCodigoPatrimonialV2 = true;
  await DB.save(KEYS.config, cfg);
}
// NORMALIZACIÓN (una sola vez): a los bienes que se registraron con una
// variante distinta a la denominación oficial del catálogo SBN para "laptop"
// (LAPTOP, NOTEBOOK, COMPUTADORA PORTATIL, PC PORTATIL, etc.) les corrige el
// nombre a "COMPUTADORA PERSONAL PORTATIL" y el código SBN a 74080500, y
// vuelve a numerar el Código Patrimonial SOLO de los grupos que cambiaron
// (el grupo de laptops y el grupo "sin código SBN" del que salieron), para
// que ahora compartan un único correlativo. Igual que la migración anterior,
// también actualiza el kardex, préstamos y mantenimientos, y no toca los
// snapshots del comparativo interanual.
async function normalizarDenominacionesPortatiles(){
  const cfg = DB.get(KEYS.config);
  if(cfg.normalizadoLaptopsV1) return;
  const items = DB.get(KEYS.items) || [];
  const CODIGO_LAPTOP = '74080500';
  const NOMBRE_OFICIAL = 'COMPUTADORA PERSONAL PORTATIL';
  const gruposAfectados = new Set();
  let huboCambios = false;
  items.forEach(it=>{
    const dNorm = normalizaBusqueda(it.denominacion||'');
    const esVariante = SINONIMOS_SBN[dNorm] === CODIGO_LAPTOP;
    const yaEsOficialPeroSinCodigo = dNorm === NOMBRE_OFICIAL && it.codigoSBN !== CODIGO_LAPTOP;
    if(esVariante || yaEsOficialPeroSinCodigo){
      gruposAfectados.add(String(it.codigoSBN||'').trim() || 'SINCODIGO');
      it.denominacion = NOMBRE_OFICIAL;
      it.codigoSBN = CODIGO_LAPTOP;
      gruposAfectados.add(CODIGO_LAPTOP);
      huboCambios = true;
    }
  });
  if(!huboCambios){ cfg.normalizadoLaptopsV1 = true; await DB.save(KEYS.config, cfg); return; }
  await renumerarGruposPorSBN(items, gruposAfectados);
  cfg.normalizadoLaptopsV1 = true;
  await DB.save(KEYS.config, cfg);
}
// Recalcula el correlativo del Código Patrimonial SOLO para los grupos de
// Código SBN indicados (los que perdieron o ganaron bienes por una
// normalización de denominación), y propaga el código nuevo al kardex,
// préstamos y mantenimientos. Reutilizada por cada normalización puntual
// (laptops, cargadores, etc.) para no repetir esta lógica en cada una.
async function renumerarGruposPorSBN(items, gruposAfectados){
  const seqMapa = { ...(DB.get(KEYS.seqPorSBN)||{}) };
  const nuevoCodigo = new Map();
  gruposAfectados.forEach(key=>{
    const grupo = items.filter(it=> (String(it.codigoSBN||'').trim() || 'SINCODIGO') === key)
      .sort((a,b)=>(a.fechaRegistro||'').localeCompare(b.fechaRegistro||'') || String(a.id).localeCompare(String(b.id)));
    grupo.forEach((it,idx)=>{ nuevoCodigo.set(it.id, buildCodigoPatrimonial(key==='SINCODIGO'?'':key, idx+1)); });
    seqMapa[key] = grupo.length;
  });
  items.forEach(it=>{ if(nuevoCodigo.has(it.id)) it.codigoInterno = nuevoCodigo.get(it.id); });
  await DB.save(KEYS.items, items);
  await DB.save(KEYS.seqPorSBN, seqMapa);
  const movs = DB.get(KEYS.movs) || [];
  movs.forEach(m=>{ if(nuevoCodigo.has(m.itemId)) m.codigoInterno = nuevoCodigo.get(m.itemId); });
  await DB.save(KEYS.movs, movs);
  const prestamos = DB.get(KEYS.prestamos) || [];
  prestamos.forEach(p=>{ (p.detalleEntrega||[]).forEach(d=>{ if(nuevoCodigo.has(d.itemId)) d.codigoInterno = nuevoCodigo.get(d.itemId); }); });
  await DB.save(KEYS.prestamos, prestamos);
  const mants = DB.get(KEYS.mantenimientos) || [];
  mants.forEach(m=>{ if(nuevoCodigo.has(m.itemId)) m.codigoInterno = nuevoCodigo.get(m.itemId); });
  await DB.save(KEYS.mantenimientos, mants);
}
// Palabras que, si aparecen junto con "CARGADOR", indican que NO es un cargador
// de batería/pila sino otro tipo de equipo del catálogo SBN (cargador frontal,
// cargador telescópico, cargador de dosímetro, etc.), para no confundirlos.
const PALABRAS_EXCLUIDAS_CARGADOR = ['FRONTAL','TELESCOPICO','APILADOR','DOSIMETRO','ELEVADOR','MINICARGADOR','STACKER'];
function esCargadorDeBateria(denominacion){
  const d = normalizaBusqueda(denominacion);
  if(!d.includes('CARGADOR')) return false;
  return !PALABRAS_EXCLUIDAS_CARGADOR.some(p=>d.includes(p));
}
// NORMALIZACIÓN (una sola vez): cualquier bien cuya denominación contenga la
// palabra "CARGADOR" (cargador de laptop, cargador de computadora portátil,
// cargador USB, etc., excluyendo equipos como cargador frontal/telescópico)
// se registra bajo el clasificador oficial del SBN, código 46221341
// ("CARGADOR DE BATERIA EN GENERAL"). Para que en la ficha impresa se siga
// viendo a qué equipo corresponde, se agrega "PARA COMPUTADORA PORTATIL" en
// el campo Observaciones (sin pisar una observación que ya tuviera el bien).
async function normalizarCargadores(){
  const cfg = DB.get(KEYS.config);
  if(cfg.normalizadoCargadoresV1) return;
  const items = DB.get(KEYS.items) || [];
  const CODIGO_CARGADOR = '46221341';
  const NOMBRE_OFICIAL = 'CARGADOR DE BATERIA EN GENERAL';
  const ACLARACION = 'PARA COMPUTADORA PORTATIL';
  const gruposAfectados = new Set();
  let huboCambios = false;
  items.forEach(it=>{
    if(!esCargadorDeBateria(it.denominacion)) return;
    const yaListo = normalizaBusqueda(it.denominacion)===NOMBRE_OFICIAL && it.codigoSBN===CODIGO_CARGADOR && (it.observaciones||'').includes(ACLARACION);
    if(yaListo) return;
    gruposAfectados.add(String(it.codigoSBN||'').trim() || 'SINCODIGO');
    it.denominacion = NOMBRE_OFICIAL;
    it.codigoSBN = CODIGO_CARGADOR;
    if(!(it.observaciones||'').includes(ACLARACION)){
      it.observaciones = (it.observaciones||'').trim() ? (it.observaciones.trim()+' — '+ACLARACION) : ACLARACION;
    }
    gruposAfectados.add(CODIGO_CARGADOR);
    huboCambios = true;
  });
  if(!huboCambios){ cfg.normalizadoCargadoresV1 = true; await DB.save(KEYS.config, cfg); return; }
  await renumerarGruposPorSBN(items, gruposAfectados);
  cfg.normalizadoCargadoresV1 = true;
  await DB.save(KEYS.config, cfg);
}
// NORMALIZACIÓN (una sola vez): cualquier bien cuya denominación empiece con
// "TABLET" (Surface, iPad, etc. — el catálogo SBN no tiene un código para
// cada marca/modelo) se registra bajo el clasificador oficial 74089493
// "TABLETA PAD". El modelo comercial (ej. "SURFACE RT 64") no se pierde:
// queda en Observaciones para no confundirlo con el campo "Modelo" de
// fábrica que ya usa el bien (ej. "1516").
async function normalizarTabletas(){
  const cfg = DB.get(KEYS.config);
  if(cfg.normalizadoTabletasV1) return;
  const items = DB.get(KEYS.items) || [];
  const CODIGO_TABLET = '74089493';
  const NOMBRE_OFICIAL = 'TABLETA PAD';
  const gruposAfectados = new Set();
  let huboCambios = false;
  items.forEach(it=>{
    const dNorm = normalizaBusqueda(it.denominacion||'');
    if(!dNorm.startsWith('TABLET') || dNorm===NOMBRE_OFICIAL) return;
    if(it.codigoSBN===CODIGO_TABLET && dNorm===NOMBRE_OFICIAL) return;
    const modeloComercial = it.denominacion.trim();
    gruposAfectados.add(String(it.codigoSBN||'').trim() || 'SINCODIGO');
    it.denominacion = NOMBRE_OFICIAL;
    it.codigoSBN = CODIGO_TABLET;
    if(!(it.observaciones||'').includes(modeloComercial)){
      it.observaciones = (it.observaciones||'').trim() ? (it.observaciones.trim()+' — Modelo comercial: '+modeloComercial) : ('Modelo comercial: '+modeloComercial);
    }
    gruposAfectados.add(CODIGO_TABLET);
    huboCambios = true;
  });
  if(!huboCambios){ cfg.normalizadoTabletasV1 = true; await DB.save(KEYS.config, cfg); return; }
  await renumerarGruposPorSBN(items, gruposAfectados);
  cfg.normalizadoTabletasV1 = true;
  await DB.save(KEYS.config, cfg);
}
// BACKFILL (una sola vez): a los bienes que quedaron con el Código SBN vacío
// porque el detector anterior no supo resolver la ambigüedad (ej. escribiste
// "MESA DE METAL Y MELAMINA" con alguna palabra de más, o cualquier otra
// denominación con varios prefijos parecidos en el catálogo) se les vuelve a
// intentar detectar el código con la versión mejorada de lookupSBN, y se les
// renumera el Código Patrimonial en los grupos que cambiaron. Los bienes que
// YA tenían un código SBN asignado no se tocan.
async function backfillCodigoSBNPorMejoraDeteccion(){
  const cfg = DB.get(KEYS.config);
  if(cfg.backfillDeteccionSBNv1) return;
  const items = DB.get(KEYS.items) || [];
  const gruposAfectados = new Set();
  let huboCambios = false;
  items.forEach(it=>{
    if((it.codigoSBN||'').trim()) return;
    const nuevo = lookupSBN(it.denominacion);
    if(!nuevo) return;
    gruposAfectados.add('SINCODIGO');
    it.codigoSBN = nuevo;
    gruposAfectados.add(nuevo);
    huboCambios = true;
  });
  if(!huboCambios){ cfg.backfillDeteccionSBNv1 = true; await DB.save(KEYS.config, cfg); return; }
  await renumerarGruposPorSBN(items, gruposAfectados);
  cfg.backfillDeteccionSBNv1 = true;
  await DB.save(KEYS.config, cfg);
}

/* ---------------------------------------------------------------------
   6. NAVEGACIÓN (filtrada por rol)
   --------------------------------------------------------------------- */
function buildNav(){
  const admin = isAdmin();
  const nVencidos = DB.get(KEYS.prestamos).filter(p=>p.estado==='Prestado' && p.fechaDevolucionProgramada && p.fechaDevolucionProgramada<today()).length;
  const nPapelera = DB.get(KEYS.papelera).length;
  const idsVisiblesNav = new Set(scopedItems().map(i=>i.id));
  const nMantAbiertos = DB.get(KEYS.mantenimientos).filter(m=>m.estado!=='Resuelto' && (isAdmin()||idsVisiblesNav.has(m.itemId))).length;
  const nReqPendientes = DB.get(KEYS.requerimientos).filter(r=>r.estado==='Solicitado').length;
  const nBajasEnTramite = DB.get(KEYS.bajas).filter(b=>!['Con disposición final','Rechazada'].includes(b.estado)).length;
  const nConsumiblesBajos = DB.get(KEYS.consumibles).filter(c=>Number(c.stockActual)<=Number(c.stockMinimo)).length;
  const nav = [
    {grp:'General', items:[{id:'dashboard', ic:'◆', label:'Panel general'}]},
    {grp:'Inventario', items:[
      {id:'items', ic:'▤', label:'Bienes patrimoniales'},
      {id:'plano', ic:'🗺️', label:'Plano del colegio'},
      {id:'qrlab', ic:'▦', label:'Generador de QR'},
      {id:'prestamos', ic:'⇄', label:'Préstamos de bienes', badge:nVencidos||null},
      {id:'requerimientos', ic:'🛒', label:'Requerimientos / compras', badge:(admin&&nReqPendientes)||null},
      {id:'bajas', ic:'🗑️', label:'Bajas de bienes', badge:(admin&&nBajasEnTramite)||null},
      {id:'almacen', ic:'📦', label:'Almacén de consumibles', badge:nConsumiblesBajos||null},
      {id:'tomas', ic:'☑', label:'Toma de inventario'},
      {id:'comparativo', ic:'⇔', label:'Comparativo interanual'},
      {id:'verifSBN', ic:'⚖', label:'Verificación SBN', badge:contarDiscrepanciasSBN()||null},
      {id:'mantenimientos', ic:'⚒', label:'Mantenimientos / calibraciones', badge:nMantAbiertos||null},
      ...(canEdit()?[{id:'masiva', ic:'⇧', label:'Carga masiva'}]:[]),
      {id:'movs', ic:'↻', label:'Movimientos / kardex'},
      {id:'verificaracta', ic:'✔', label:'Verificar acta'},
    ]},
  ];
  nav.splice(1,0,bibNav());
  if(typeof bibNavLectometro==='function') nav.splice(2,0,bibNavLectometro());
  if(admin){
    nav.push({grp:'Mantenedores', items:[
      {id:'aulas', ic:'▢', label:'Aulas y ambientes'},
      {id:'custodios', ic:'◎', label:'Personal / bibliotecarios'},
      {id:'cargos', ic:'⚏', label:'Cargos del personal'},
      {id:'comision', ic:'👥', label:'Comisión de Inventario'},
      {id:'catalogo', ic:'≡', label:'Catálogo SBN'},
      {id:'categoriasDeprec', ic:'▽', label:'Vida útil (depreciación)'},
    ]});
    nav.push({grp:'Gestión', items:[
      {id:'planillas', ic:'▥', label:'Planillas de verificación'},
      {id:'reportes', ic:'▣', label:'Reportes y exportación'},
      {id:'conciliacion', ic:'🧮', label:'Conciliación contable'},
      {id:'presupuesto', ic:'💰', label:'Presupuesto por fuente'},
      ...(puedeGestionarUsuarios()?[{id:'usuarios', ic:'☺', label:'Usuarios y accesos'}]:[]),
      {id:'papelera', ic:'⌫', label:'Papelera de reciclaje', badge:nPapelera||null},
      {id:'bitacora', ic:'📜', label:'Bitácora de auditoría'},
      {id:'polizas', ic:'🛡', label:'Pólizas de seguro'},
      {id:'config', ic:'⚙', label:'Datos de la IE'},
    ]});
  }else{
    nav.push({grp:'Gestión', items:[
      {id:'planillas', ic:'▥', label:'Planillas de verificación'},
      {id:'reportes', ic:'▣', label:'Reportes y exportación'},
    ]});
  }
  const PERMITIDOS=['custodios','usuarios','papelera','bitacora','config','reportes'];
  // Los grupos de biblioteca (incluido el del Lectómetro y diplomas) se muestran completos; los de inventario patrimonial, filtrados.
  const GRUPOS_BIBLIOTECA=['Biblioteca','Lectómetro y diplomas'];
  return nav.map(g=>GRUPOS_BIBLIOTECA.includes(g.grp)?g:{...g,items:g.items.filter(i=>PERMITIDOS.includes(i.id))}).filter(g=>g.items.length);
}

/* ---------------------------------------------------------------------
   7. RENDER PRINCIPAL / LOGIN
   --------------------------------------------------------------------- */
function render(){
  const app = document.getElementById('app');
  if(!STATE.loaded){ app.innerHTML = '<div style="padding:60px;text-align:center;color:#4d5c6b;">Cargando inventario…</div>'; return; }
  if(!STATE.session){ window.location.href = 'login.html'; return; }
  // El menú lateral (.nav) se vuelve a construir desde cero en cada render() de
  // toda la página, lo que reiniciaba su scroll a 0 y "hacía subir" la lista de
  // módulos al elegir uno que estaba más abajo. Guardamos la posición actual acá
  // y la restauramos después de reconstruir el HTML, para que no se note el salto.
  const navScrollPrevio = document.querySelector('.sidebar .nav')?.scrollTop || 0;
  const cfg = DB.get(KEYS.config);
  const NAV = buildNav();
  app.innerHTML = `
    <div class="sidebar noprint${STATE.sidebarOpen?' open':''}${navColapsado()?' collapsed':''}" id="sidebarEl">
      <div class="brand"><div class="tag">SIGIE · BIBLIOTECA</div><h1>Biblioteca Escolar</h1></div>
      <div class="school">
        ${logoDeConfig(cfg)?`<img src="${logoDeConfig(cfg)}">`:`<div class="noimg">${esc((cfg.siglas||'IE').slice(0,3))}</div>`}
        <div><div class="name">${esc(cfg.nombreIE||'Institución Educativa')}</div><div class="year">Año fiscal ${esc(cfg.anioFiscal)}</div></div>
      </div>
      <div class="whoami">
        <div><div class="u"><b>${esc(STATE.session.nombre||STATE.session.usuario)}</b></div><div class="r">${esc(STATE.session.rol)}</div></div>
        <button id="btnLogout">Salir</button>
      </div>
      <div class="nav">
        ${NAV.map(g=>`<div class="grp-label">${g.grp}</div>${g.items.map(it=>`<button data-nav="${it.id}" class="${STATE.view===it.id?'active':''}"><span class="ic">${typeof iconoNav==='function'?iconoNav(it.id,it.ic):it.ic}</span>${it.label}${it.badge?`<span class="navbadge">${it.badge}</span>`:''}</button>`).join('')}`).join('')}
      </div>
      <div class="foot">${STORAGE_MODE==='servidor' ? '💽 Base de datos guardada en la carpeta del sistema (data/sigie.db) — viaja si llevas la carpeta a otra PC.' : STORAGE_MODE==='claude' ? 'Guardado en tu almacenamiento persistente de Claude.' : STORAGE_MODE==='firebase' ? '🔥 Conectado a Firebase — inventario compartido en la nube.' : '💾 Guardado localmente en este navegador (modo independiente).'} No se pierde al recargar.<div id="pendingIndicator" style="color:var(--warn,#8a6d1a);margin-top:4px;"></div><div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08);color:#69809a;">© ${new Date().getFullYear()} Luis Hider Manco Berrocal — CIST</div></div>
    </div>
    <div class="sidebar-overlay noprint${STATE.sidebarOpen?' open':''}" id="sidebarOverlay"></div>
    <div class="main">
      <div class="topbar noprint">
        <div style="display:flex;align-items:center;gap:10px;">
          <button class="hamburger" id="btnHamburger">☰</button>
          <div><h2>${viewTitle(STATE.view)}</h2><div class="sub">${viewSub(STATE.view)}</div></div>
        </div>
        <div class="actions">
          <div class="gsearch">
            <input id="gsearch" placeholder="Buscar libro, autor, ISBN, lector…">
            <div class="res" id="gsearchRes" style="display:none;"></div>
          </div>
          <button class="btn btn-sm" id="btnScanQR" title="Escanear QR con la cámara">📷</button>
          <button class="btn btn-sm" data-nav="bibMost" title="Prestar y devolver escaneando el carné y el libro">⌨ Mostrador</button>
          <div class="notif-wrap">
            <button class="btn btn-sm notif-btn" id="btnNotif" title="Notificaciones">🔔${(()=>{ const n=calcularNotificaciones().reduce((a,x)=>a+x.n,0); return n>0?`<span class="navbadge">${n}</span>`:''; })()}</button>
            <div class="notif-panel" id="notifPanel" style="display:none;"></div>
          </div>
          ${viewActions(STATE.view)}
        </div>
      </div>
      <div class="content" id="content"></div>
    </div>
  `;
  const navEl = document.querySelector('.sidebar .nav'); if(navEl) navEl.scrollTop = navScrollPrevio;
  document.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click', ()=>{ STATE.view=b.dataset.nav; STATE.sidebarOpen=false; render(); }));
  document.getElementById('btnLogout').addEventListener('click', async ()=>{ if(STORAGE_MODE==='servidor'){ await cerrarSesionServidor(); } else { await registrarBitacora('Cierre de sesión', ''); } STATE.session=null; try{ window.localStorage.removeItem('sigie:sesion_actual'); }catch(e){} window.location.href='login.html'; });
  document.getElementById('btnHamburger').addEventListener('click', ()=>{
    if(window.innerWidth>860){ STATE.navCollapsed=!navColapsado(); try{ localStorage.setItem('sigie:nav_colapsado', STATE.navCollapsed?'1':'0'); }catch(e){} render(); return; }
    STATE.sidebarOpen=!STATE.sidebarOpen; render();
  });
  document.getElementById('sidebarOverlay').addEventListener('click', ()=>{ STATE.sidebarOpen=false; render(); });
  wireGlobalSearch();
  wireTopbarActions();
  wireNotificaciones();
  document.getElementById('btnScanQR')?.addEventListener('click', abrirEscanerQR);
  actualizarIndicadorPendientes();
  renderContent();
}

const BIB_TITULOS={bibLect:['Lectores y carnés','Registro de alumnos y docentes con carné QR para préstamos'],bibQR:['Etiquetas QR de libros','Genera e imprime la etiqueta QR de cada libro'],bibToma:['Inventario por estante','Verifica los libros de cada estante escaneando su QR'],bibLibros:['Libros (catálogo)','Registro de libros por categoría: código, Dewey, autor, estado, ISBN, editorial y ubicación'],bibPrest:['Préstamos de libros','Préstamos a alumnos y docentes con fecha de devolución'],bibCats:['Cartelera lectora / lista de cotejo','Categorías con prefijo, color, ubicaciones y total de libros'],bibReporte:['Reporte general','Total general de ejemplares por categoría']};
Object.assign(BIB_TITULOS, BIB_TITULOS2, BIB_TITULOS3, typeof BIB_TITULOS5!=='undefined'?BIB_TITULOS5:{}, typeof BIB_TITULOS6!=='undefined'?BIB_TITULOS6:{}, typeof BIB_TITULOS7!=='undefined'?BIB_TITULOS7:{}, typeof BIB_TITULOS8!=='undefined'?BIB_TITULOS8:{}, typeof BIB_TITULOS9!=='undefined'?BIB_TITULOS9:{});
function viewTitle(v){ if(BIB_TITULOS[v]) return BIB_TITULOS[v][0];
  return {
    dashboard:'Panel general', items:'Bienes patrimoniales', qrlab:'Generador de códigos QR',
    movs:'Movimientos y kardex', aulas:'Aulas y ambientes', custodios:'Personal / bibliotecarios asignados',
    catalogo:'Catálogo de denominaciones SBN', cargos:'Cargos del personal', comision:'Comisión de Inventario', reportes:'Reportes y exportación', config:'Datos de la institución educativa',
    prestamos:'Préstamos de bienes', masiva:'Carga masiva de bienes', usuarios:'Usuarios y accesos',
    papelera:'Papelera de reciclaje', planillas:'Planillas de verificación física',
    tomas:'Toma de inventario por aula', mantenimientos:'Mantenimientos, incidencias y calibraciones', plano:'Plano del colegio',
    categoriasDeprec:'Vida útil (depreciación NICSP)', comparativo:'Comparativo interanual por aula',
    verifSBN:'Verificación de denominaciones SBN', bitacora:'Bitácora de auditoría', polizas:'Pólizas de seguro',
    conciliacion:'Conciliación patrimonial-contable', requerimientos:'Requerimientos y órdenes de compra',
    bajas:'Bajas de bienes', verificaracta:'Verificar acta', almacen:'Almacén de consumibles',
    presupuesto:'Presupuesto por fuente de financiamiento'
  }[v] || '';
}
function viewSub(v){ if(BIB_TITULOS[v]) return BIB_TITULOS[v][1];
  return {
    dashboard:'Resumen patrimonial de la institución educativa',
    items:'Registro de bienes muebles según los campos exigidos por SBN / SIGA',
    qrlab:'Etiquetas QR para pegar en cada bien, con logo, aula, año y código',
    movs:'Historial de altas, bajas, traslados, préstamos y mantenimientos',
    aulas:'Ambientes, secciones y pabellones de la IE',
    custodios:'Docentes y personal responsable de los bienes asignados',
    catalogo:'Denominaciones estandarizadas (editable / referencial)',
    cargos:'Catálogo de cargos disponibles para el combo de "Nuevo responsable / custodio"',
    comision:'Integrantes habituales de la Comisión de Inventario, para no volver a tipearlos en cada acta',
    reportes:'Exporta el inventario en los formatos que exige la Comisión de Inventario',
    config:'Estos datos aparecen en la barra lateral y en las etiquetas QR',
    prestamos:'Registro y devolución de bienes prestados temporalmente, con acta',
    masiva:'Registra varios bienes a la vez pegando texto o subiendo un CSV',
    usuarios:'Cuentas de acceso con rol y aulas asignadas',
    papelera:'Bienes eliminados: puedes restaurarlos o borrarlos definitivamente',
    planillas:'Fichas imprimibles para la verificación física por aula',
    tomas:'Checklist interactivo para verificar físicamente los bienes de un aula, bien por bien',
    plano:'Ubica cada aula/ambiente en el croquis del colegio y haz clic para ir directo a su inventario',
    mantenimientos:'Registro y seguimiento de mantenimientos programados, calibraciones periódicas e incidencias reportadas',
    categoriasDeprec:'Categorías y años de vida útil usados para calcular la depreciación (línea recta, NICSP)',
    comparativo:'Contrasta el inventario guardado de un año contra otro (o contra el actual), aula por aula',
    verifSBN:'Compara la denominación de cada bien contra el Catálogo SBN oficial, aula por aula, para corregir textos que no coinciden antes de presentar el inventario',
    bitacora:'Quién hizo qué y cuándo: creación, edición, baja, restauración y eliminación de bienes, gestión de usuarios e inicios de sesión',
    polizas:'Registro de pólizas de seguro que cubren bienes de alto valor, con aviso cuando estén por vencer',
    conciliacion:'Compara el valor total del inventario (SIGIE) contra lo registrado en contabilidad/SIAF, para sustentar auditorías de la Contraloría',
    requerimientos:'Solicita bienes, apruébalos, genera la orden de compra y registra la recepción — que da de alta los bienes automáticamente en almacén',
    bajas:'Expediente formal de baja: solicitud, informe técnico, resolución y disposición final, con su documento imprimible en cada etapa',
    verificaracta:'Comprueba, con el código o QR impreso en un acta, que el documento coincide con lo registrado en el sistema al momento de emitirse',
    almacen:'Bienes fungibles/consumibles (papel, tóner, útiles de limpieza, materiales de laboratorio) — separado del patrimonio de activo fijo, con entradas, salidas y alerta de stock mínimo',
    presupuesto:'Techo presupuestal anual por fuente (RO, RDR, APAFA, Donaciones) y cuánto se ha comprometido/ejecutado contra ese techo en los Requerimientos'
  }[v] || '';
}
function viewActions(v){
  if(!canEdit()) return '';
  if(v==='items') return `<button class="btn btn-primary" id="btnNewItem">+ Nuevo bien</button>`;
  if(v==='aulas') return `<button class="btn btn-primary" id="btnNewAula">+ Nueva aula</button>`;
  if(v==='custodios') return `<button class="btn btn-primary" id="btnNewCustodio">+ Nuevo responsable</button>`;
  if(v==='catalogo') return `<button class="btn btn-primary" id="btnNewCat">+ Nueva denominación</button>`;
  if(v==='cargos') return `<button class="btn btn-primary" id="btnNewCargo">+ Nuevo cargo</button>`;
  if(v==='comision') return `<button class="btn btn-primary" id="btnNewComision">+ Nuevo integrante</button>`;
  if(v==='almacen' && isAdmin()) return `<button class="btn btn-primary" id="btnNewConsumible">+ Nuevo consumible</button>`;
  if(v==='categoriasDeprec') return `<button class="btn btn-primary" id="btnNewCategoriaDeprec">+ Nueva categoría</button>`;
  if(v==='usuarios') return puedeGestionarUsuarios() ? `<button class="btn btn-primary" id="btnNewUser">+ Nuevo usuario</button>` : '';
  if(v==='prestamos') return `<button class="btn btn-primary" id="btnNewPrestamo">+ Nuevo préstamo</button>${isAdmin()?' <button class="btn btn-danger" id="btnClearPrestamos">🗑️ Limpiar historial</button>':''}`;
  if(v==='mantenimientos') return `<button class="btn btn-sm" id="btnMantVista">${STATE.mantVista==='calendario'?'📋 Ver lista':'📅 Ver calendario'}</button> <button class="btn btn-primary" id="btnNewMant">+ Nuevo mantenimiento / incidencia</button>`;
  if(v==='tomas' && !STATE.tomaEnCurso) return `<a class="btn" href="modo-rapido.html" target="_blank" rel="noopener" title="Verificar por aula escaneando QR, ideal para el celular">🏃 Modo rápido (celular)</a> <button class="btn btn-primary" id="btnNewToma">+ Nueva toma de inventario</button>`;
  if(v==='movs' && isAdmin()) return `<button class="btn btn-danger" id="btnClearMovs">🗑️ Limpiar historial</button>`;
  if(v==='comparativo' && isAdmin()) return `<button class="btn btn-primary" id="btnGuardarSnapshot">💾 Guardar inventario de este año</button>`;
  if(v==='verifSBN') return `<button class="btn btn-primary" id="btnActualizarVisiblesSBN">✓ Actualizar denominación oficial (visibles)</button>`;
  if(v==='bitacora') return isAdmin() ? `<button class="btn btn-sm" id="btnExportBitacoraCSV">⬇️ Exportar CSV</button>` : '';
  if(v==='polizas') return isAdmin() ? `<button class="btn btn-primary" id="btnNewPoliza">+ Nueva póliza</button>` : '';
  if(v==='conciliacion') return isAdmin() ? `<button class="btn btn-primary" id="btnNewConciliacion">+ Nueva conciliación</button>` : '';
  if(v==='requerimientos') return canEdit() ? `<button class="btn btn-primary" id="btnNewReq">+ Nuevo requerimiento</button>` : '';
  if(v==='bajas') return canEdit() ? `<button class="btn btn-primary" id="btnNewBaja">+ Nueva solicitud de baja</button>` : '';
  return '';
}
function wireTopbarActions(){
  const map = {btnNewItem:()=>openItemModal(null), btnNewAula:()=>openAulaModal(null), btnNewCustodio:()=>openCustodioModal(null),
    btnNewCat:()=>openCatModal(null), btnNewUser:()=>openUserModal(null), btnNewPrestamo:()=>openPrestamoModal(),
    btnNewCargo:()=>openCargoModal(null), btnNewMant:()=>openMantenimientoModal(null), btnNewToma:()=>openTomaSetupModal(),
    btnNewCategoriaDeprec:()=>openCategoriaDeprecModal(null), btnClearMovs:limpiarHistorialMovimientos,
    btnGuardarSnapshot:()=>abrirModalGuardarSnapshot(),
    btnClearPrestamos:limpiarHistorialPrestamos, btnExportBitacoraCSV:exportBitacoraCSV,
    btnNewPoliza:()=>openPolizaModal(null), btnNewConciliacion:()=>abrirModalNuevaConciliacion(), btnNewReq:()=>openRequerimientoModal(null),
    btnNewBaja:()=>abrirSelectorBienParaBaja(), btnNewComision:()=>openComisionModal(null),
    btnNewConsumible:()=>abrirModalConsumible(null)};
  Object.keys(map).forEach(id=>{ const b=document.getElementById(id); if(b) b.addEventListener('click', map[id]); });
}
// Pensado para pruebas piloto: borra por completo el kardex de movimientos
// (altas, bajas, préstamos, mantenimientos, etc.) sin tocar los bienes,
// aulas, custodios ni préstamos en sí. Es irreversible, por eso pide
// confirmación doble y ofrece descargar un respaldo antes de borrar.
async function limpiarHistorialMovimientos(){
  const movs = DB.get(KEYS.movs);
  if(movs.length===0){ toast('El historial de movimientos ya está vacío.'); return; }
  if(!confirm('Esto borrará PERMANENTEMENTE los '+movs.length+' movimiento(s) del kardex (altas, bajas, préstamos, mantenimientos, etc.). Los bienes, aulas, custodios y préstamos NO se verán afectados. ¿Deseas continuar?')) return;
  if(confirm('¿Quieres descargar primero un respaldo (CSV) del historial actual, por si acaso?')){
    const headers=[{key:'fecha',label:'Fecha'},{key:'codigoInterno',label:'Código interno'},{key:'tipo',label:'Tipo'},{key:'detalle',label:'Detalle'}];
    downloadFile('respaldo_kardex_movimientos_'+today()+'.csv','\uFEFF'+toCSV(movs, headers),'text/csv;charset=utf-8;');
  }
  const texto = prompt('Para confirmar, escribe BORRAR (en mayúsculas) y presiona Aceptar:');
  if(texto!=='BORRAR'){ toast('Cancelado: no se escribió "BORRAR". El historial no se modificó.'); return; }
  await DB.save(KEYS.movs, []);
  toast('Historial de movimientos eliminado.','ok');
  renderContent();
}
// Igual que arriba pero para el módulo de Préstamos de bienes: pensado para
// limpiar los préstamos de una prueba piloto. Borra los registros de
// préstamos (y deja los bienes involucrados como disponibles de nuevo),
// pero NO borra sus entradas de "Préstamo"/"Devolución" en el kardex de
// movimientos — para eso está el botón de Movimientos / kardex.
async function limpiarHistorialPrestamos(){
  const prestamos = DB.get(KEYS.prestamos);
  if(prestamos.length===0){ toast('El historial de préstamos ya está vacío.'); return; }
  const activos = prestamos.filter(p=>p.estado==='Prestado').length;
  const avisoActivos = activos>0 ? '\n\nOJO: '+activos+' de ellos siguen figurando como "Prestado" (no devueltos); esos bienes quedarán disponibles nuevamente al borrar.' : '';
  if(!confirm('Esto borrará PERMANENTEMENTE los '+prestamos.length+' registro(s) de préstamos de bienes.'+avisoActivos+'\n\nLas entradas correspondientes en el kardex de Movimientos NO se borran con esto. ¿Deseas continuar?')) return;
  if(confirm('¿Quieres descargar primero un respaldo (CSV) del historial actual, por si acaso?')){
    const headers=[{key:'numero',label:'N° préstamo'},{key:'docente',label:'Solicitante'},{key:'cargo',label:'Cargo'},{key:'motivo',label:'Motivo'},{key:'fechaPrestamo',label:'Fecha de préstamo'},{key:'fechaDevolucionProgramada',label:'Devolución programada'},{key:'fechaDevolucionReal',label:'Devolución real'},{key:'estado',label:'Estado'}];
    downloadFile('respaldo_prestamos_'+today()+'.csv','\uFEFF'+toCSV(prestamos, headers),'text/csv;charset=utf-8;');
  }
  const texto = prompt('Para confirmar, escribe BORRAR (en mayúsculas) y presiona Aceptar:');
  if(texto!=='BORRAR'){ toast('Cancelado: no se escribió "BORRAR". El historial no se modificó.'); return; }
  await DB.save(KEYS.prestamos, []);
  toast('Historial de préstamos eliminado.','ok');
  renderContent();
}
// Deja el sistema como recién instalado, para reutilizarlo en otra
// institución educativa: borra todos los bienes, aulas, custodios,
// préstamos, mantenimientos, kardex, papelera y usuarios; y restaura los
// catálogos de referencia (cargos, denominaciones SBN, vida útil) y los
// datos de la IE a sus valores por defecto. Al terminar cierra la sesión;
// en el siguiente ingreso el sistema volverá a crear el usuario
// "admin" / "admin123" (ver seedAdminIfNeeded en core.js), listo para que
// el nuevo colegio configure todo de cero.
async function reiniciarSistemaCompleto(){
  const totalBienes = DB.get(KEYS.items).length;
  if(!confirm('Esto BORRARÁ POR COMPLETO: bienes, aulas, custodios, integrantes de la Comisión de Inventario, préstamos, mantenimientos, kardex, papelera, inventarios guardados por año, consumibles del almacén, requerimientos/compras, bajas, pólizas, conciliaciones, actas firmadas, planos del colegio, bitácora de actividad, fotos/imágenes guardadas y usuarios ('+totalBienes+' bien(es) registrados actualmente). Los catálogos de referencia (cargos, denominaciones SBN, vida útil) y los datos de la IE volverán a sus valores por defecto.\n\nEsta acción es IRREVERSIBLE. ¿Deseas continuar?')) return;
  if(confirm('¿Quieres descargar primero un respaldo completo (.json) del sistema actual, por si acaso?')){
    const backup = {}; Object.entries(KEYS).forEach(([k,key])=>{ backup[k]=DB.get(key); });
    backup._meta = { exportadoEl:new Date().toISOString(), sistema:'SIGIE' };
    downloadFile('respaldo_sigie_antes_de_reiniciar_'+today()+'.json', JSON.stringify(backup, null, 2), 'application/json;charset=utf-8;');
  }
  const texto = prompt('Para confirmar, escribe REINICIAR (en mayúsculas) y presiona Aceptar:');
  if(texto!=='REINICIAR'){ toast('Cancelado: no se escribió "REINICIAR". No se modificó ningún dato.'); return; }
  toast('Reiniciando sistema, espera un momento…','ok');
  // Todas las colecciones de datos (una por cada clave declarada en KEYS),
  // para no volver a olvidar ningún módulo nuevo que se agregue a futuro:
  // los catálogos/config de referencia se restauran aparte, más abajo, a
  // sus valores por defecto en vez de dejarlos vacíos.
  const CLAVES_A_VACIAR_ARRAY = ['aulas','custodios','items','movs','papelera','prestamos','tomas','mantenimientos','snapshots','bitacora','polizas','conciliaciones','requerimientos','planos','bajas','comision','actasFirmadas','consumibles','movsConsumibles','presupuestos','usuarios'];
  const CLAVES_A_VACIAR_NUMERO = ['seq','seqInterno','seqReq','seqBaja'];
  // 'usuarios' va al final: con el servidor local, vaciarla cierra la sesión actual.
  const REEMPLAZAR = { reemplazar:true };
  for(const k of CLAVES_A_VACIAR_ARRAY){ if(k!=='usuarios' && KEYS[k]) await DB.save(KEYS[k], [], REEMPLAZAR); }
  for(const k of CLAVES_A_VACIAR_NUMERO){ if(KEYS[k]) await DB.save(KEYS[k], 0, REEMPLAZAR); }
  await DB.save(KEYS.seqPorSBN, {}, REEMPLAZAR);
  await DB.save(KEYS.cargos, SEED_CARGOS, REEMPLAZAR);
  await DB.save(KEYS.catalogo, SEED_CATALOGO, REEMPLAZAR);
  await DB.save(KEYS.categoriasDeprec, SEED_CATEGORIAS_DEPREC, REEMPLAZAR);
  await DB.save(KEYS.config, DEFAULT_CONFIG, REEMPLAZAR);
  // Las fotos de bienes, el logo de la IE y las imágenes de planos se guardan
  // cada una en su propia clave (carpeta "sigie:imagenes:<id>"), separadas de
  // los registros de arriba; hay que borrarlas también una por una o quedan
  // huérfanas en el almacenamiento aunque ya no las referencie ningún bien.
  try{
    const r = await STORAGE.list(CARPETA_IMAGENES);
    const keys = (r && r.keys) || [];
    for(const k of keys){ await DB.delete(k); }
  }catch(e){}
  // Usuarios: solo un ADMIN puede vaciarlos. En el siguiente ingreso el servidor vuelve a crear "admin" / "admin123".
  if(STORAGE_MODE!=='servidor' || puedeGestionarUsuarios()){ await DB.save(KEYS.usuarios, [], REEMPLAZAR); }
  toast('Sistema reiniciado. Cerrando sesión…','ok');
  if(STORAGE_MODE==='servidor'){ await cerrarSesionServidor(); }
  setTimeout(()=>{ try{ window.localStorage.removeItem('sigie:sesion_actual'); window.localStorage.removeItem('sigie:intentos_login'); }catch(e){} window.location.href='login.html'; }, 1200);
}

// Búsqueda global: antes solo buscaba en bienes patrimoniales; ahora también
// busca en personal/custodios, préstamos y mantenimientos/incidencias, agrupado
// por sección, para no tener que adivinar en qué módulo está lo que se busca.
function wireGlobalSearch(){
  const inp = document.getElementById('gsearch');
  const res = document.getElementById('gsearchRes');
  if(!inp) return;
  inp.addEventListener('input', ()=>{
    const q = inp.value.trim().toLowerCase();
    if(!q){ res.style.display='none'; res.innerHTML=''; return; }

    const items = DB.get(KEYS.items).filter(i=>puedoVerAula(i.aulaId));
    const bienes = items.filter(i=>(i.codigoInterno+' '+i.codigoSBN+' '+i.denominacion+' '+(i.numeroSerie||'')+' '+(i.marca||'')+' '+(i.codigoUsoInterno||'')).toLowerCase().includes(q)).slice(0,8);

    const custodios = isAdmin() ? DB.get(KEYS.custodios).filter(c=>((c.nombre||'')+' '+(c.dni||'')+' '+(c.cargo||'')).toLowerCase().includes(q)).slice(0,6) : [];

    const prestamos = DB.get(KEYS.prestamos).filter(p=>isAdmin()||(p.bienesAula||[]).some(a=>puedoVerAula(a)))
      .filter(p=>((p.numero||'')+' '+(p.docente||'')+' '+(p.motivo||'')).toLowerCase().includes(q)).slice(0,6);

    const idsVisibles = new Set(items.map(i=>i.id));
    const mants = DB.get(KEYS.mantenimientos).filter(m=>isAdmin()||idsVisibles.has(m.itemId))
      .filter(m=>((m.codigoInterno||'')+' '+(m.denominacion||'')+' '+(m.descripcion||'')).toLowerCase().includes(q)).slice(0,6);

    const bib = bibBuscar(q);
    const total = bib.total+bienes.length+custodios.length+prestamos.length+mants.length;
    if(total===0){ res.innerHTML = '<div class="ri" style="color:var(--ink-soft);">Sin resultados.</div>'; res.style.display='block'; return; }

    const grp = (titulo, html) => html ? `<div class="gsearch-grp">${titulo}</div>`+html : '';
    res.innerHTML = bib.html +
      grp('Bienes', bienes.map(i=>`<div class="ri" data-gobien="${i.id}"><b>${esc(i.codigoInterno)}</b> — ${esc(i.denominacion)}<br><span style="color:var(--ink-soft);">${esc(i.aulaNombre||'—')}</span></div>`).join('')) +
      grp('Personal / bibliotecarios', custodios.map(c=>`<div class="ri" data-gocustodio="1"><b>${esc(c.nombre)}</b><br><span style="color:var(--ink-soft);">${esc(c.cargo||'—')} ${c.dni?('· DNI '+esc(c.dni)):''}</span></div>`).join('')) +
      grp('Préstamos', prestamos.map(p=>`<div class="ri" data-goprestamo="1"><b>${esc(p.numero)}</b> — ${esc(p.docente)}<br><span style="color:var(--ink-soft);">${esc(p.motivo||'—')}</span></div>`).join('')) +
      grp('Mantenimientos / incidencias', mants.map(m=>`<div class="ri" data-gomant2="1"><b>${esc(m.codigoInterno)}</b> — ${esc(m.denominacion)}<br><span style="color:var(--ink-soft);">${esc(m.descripcion||'—')}</span></div>`).join(''));
    res.style.display='block';
    bib.wire(res, inp);

    res.querySelectorAll('[data-gobien]').forEach(el=>el.addEventListener('click', ()=>{ res.style.display='none'; inp.value=''; STATE.view='items'; STATE.filters={q:'',aula:'',estado:'',situacion:'',deprec:''}; render(); setTimeout(()=>openItemView(el.dataset.gobien), 50); }));
    res.querySelectorAll('[data-gocustodio]').forEach(el=>el.addEventListener('click', ()=>{ res.style.display='none'; inp.value=''; STATE.view='custodios'; render(); }));
    res.querySelectorAll('[data-goprestamo]').forEach(el=>el.addEventListener('click', ()=>{ res.style.display='none'; inp.value=''; STATE.view='prestamos'; render(); }));
    res.querySelectorAll('[data-gomant2]').forEach(el=>el.addEventListener('click', ()=>{ res.style.display='none'; inp.value=''; STATE.view='mantenimientos'; render(); }));
  });
  document.addEventListener('click', e=>{ if(!e.target.closest('.gsearch')) res.style.display='none'; }, {once:true});
}

function navColapsado(){
  if(STATE.navCollapsed===undefined){ try{ STATE.navCollapsed = localStorage.getItem('sigie:nav_colapsado')==='1'; }catch(e){ STATE.navCollapsed=false; } }
  return !!STATE.navCollapsed;
}
// Esc cierra el modal que está arriba de todo (igual que la ×).
document.addEventListener('keydown', e=>{
  if(e.key!=='Escape') return;
  const m=[...document.querySelectorAll('.modal-bg')].pop(); if(!m) return;
  const x=m.querySelector('.close-x')||m.querySelector('#cancel')||m.querySelector('[id^=cancel]');
  if(x) x.click(); else m.remove();
});

// Cualquier modal cuyo cuerpo tenga campos sueltos se organiza en cuadrícula.
function organizarModal(mb){ if(mb && !mb.classList.contains('fgrid') && mb.querySelector(':scope > .field')) mb.classList.add('fgrid'); }
new MutationObserver(ms=>{
  for(const m of ms) for(const n of m.addedNodes){
    if(n.nodeType!==1) continue;
    if(n.classList.contains('modal-bg')) n.querySelectorAll('.m-b').forEach(organizarModal);
  }
}).observe(document.body,{childList:true});

function renderContent(){
  const c = document.getElementById('content');
  const fns = {
    dashboard:renderDashboard, items:renderItems, qrlab:renderQrLab, movs:renderMovs,
    aulas:renderAulas, custodios:renderCustodios, catalogo:renderCatalogo, cargos:renderCargos,
    reportes:renderReportes, config:renderConfig, prestamos:renderPrestamos,
    masiva:renderMasiva, usuarios:renderUsuarios, papelera:renderPapelera, planillas:renderPlanillas,
    tomas:renderTomas, mantenimientos:renderMantenimientos, categoriasDeprec:renderCategoriasDeprec,
    comparativo:renderComparativo, verifSBN:renderVerifSBN, bitacora:renderBitacora, polizas:renderPolizas,
    conciliacion:renderConciliacion, requerimientos:renderRequerimientos, plano:renderPlano, bajas:renderBajas,
    comision:renderComision, verificaracta:renderVerificarActa, almacen:renderAlmacen,
    presupuesto:renderPresupuesto
  };
  if(!isAdmin() && ['aulas','custodios','catalogo','cargos','comision','papelera','config','categoriasDeprec','bitacora','polizas','conciliacion','presupuesto'].includes(STATE.view)){ STATE.view='bibInicio'; }
  if(!puedeGestionarUsuarios() && STATE.view==='usuarios'){ STATE.view='bibInicio'; }
  if(!canEdit() && STATE.view==='masiva'){ STATE.view='bibInicio'; }
  if(BIB_RENDER[STATE.view]){ c.innerHTML = BIB_RENDER[STATE.view](); bibWire(); return; }
  c.innerHTML = fns[STATE.view] ? fns[STATE.view]() : '';
  wireContentEvents();
  if(STATE.view==='dashboard'){ renderDashboardCharts(); wireDescargaGraficos(); }
  if(STATE.view==='qrlab'){ renderQrPreview(); }
}

/* ---------------------------------------------------------------------
   8. DASHBOARD + GRÁFICOS (Chart.js)
   --------------------------------------------------------------------- */
function scopedItems(){ const mis=misAulaIds(); const items=DB.get(KEYS.items); return mis===null?items:items.filter(i=>mis.includes(i.aulaId)); }
function scopedAulas(){ const mis=misAulaIds(); const aulas=DB.get(KEYS.aulas); return mis===null?aulas:aulas.filter(a=>mis.includes(a.id)); }

function renderDashboard(){
  const items = scopedItems();
  const aulas = scopedAulas();
  const total = items.length;
  const valorTotal = items.reduce((a,i)=>a+(Number(i.valorAdquisicion)||0),0);
  const valorNetoLibrosTotal = items.reduce((a,i)=>{ const c=calcularDepreciacionItem(i); return a+(c?c.valorNetoLibros:(Number(i.valorAdquisicion)||0)); },0);
  const activos = items.filter(i=>i.situacion==='Activo'||i.situacion==='Asignado').length;
  const bajas = items.filter(i=>i.situacion==='De baja').length;
  const prestados = DB.get(KEYS.prestamos).filter(p=>p.estado==='Prestado').reduce((a,p)=>a+p.bienesIds.length,0);
  const prestamosVencidos = DB.get(KEYS.prestamos).filter(p=>p.estado==='Prestado' && p.fechaDevolucionProgramada && p.fechaDevolucionProgramada<today()).length;
  const recientes = [...items].sort((a,b)=>(b.fechaRegistro||'').localeCompare(a.fechaRegistro||'')).slice(0,6);
  const malos = items.filter(i=>i.estadoConservacion==='Malo').slice(0,8);
  const totalmenteDeprec = items.filter(i=>{ const c=calcularDepreciacionItem(i); return c && c.totalmenteDepreciado; }).slice(0,8);
  const totalmenteDeprecTotal = items.filter(i=>{ const c=calcularDepreciacionItem(i); return c && c.totalmenteDepreciado; }).length;
  const { vencidos, incidenciasAltas, mantProximos, porDepreciarPronto, enAlmacen, porSanear, reqPendientes } = alertasActivas();

  return `
  <div class="grid g4" style="margin-bottom:18px;">
    <div class="card kpi"><div class="lbl">Total de bienes</div><div class="val">${total}</div><div class="delta">${aulas.length} aulas/ambientes visibles${enAlmacen.length?(' · 📦 '+enAlmacen.length+' en almacén'):''}</div></div>
    <div class="card kpi"><div class="lbl">Valor patrimonial</div><div class="val">${money(valorTotal)}</div><div class="delta">Valor neto en libros (NICSP): ${money(valorNetoLibrosTotal)}</div></div>
    <div class="card kpi"><div class="lbl">Activos / asignados</div><div class="val">${activos}</div><div class="delta">${total?Math.round(activos/total*100):0}% del inventario</div></div>
    <div class="card kpi"><div class="lbl">En préstamo / de baja</div><div class="val">${prestados} / ${bajas}</div><div class="delta" style="${prestamosVencidos>0?'color:var(--bad);font-weight:600;':''}">${prestamosVencidos>0?('⚠ '+prestamosVencidos+' préstamo(s) atrasado(s)'):'Bienes fuera de su ambiente o dados de baja'}</div></div>
  </div>
  ${(vencidos.length>0 || incidenciasAltas.length>0 || mantProximos.length>0 || porDepreciarPronto.length>0 || enAlmacen.length>0 || porSanear.length>0 || reqPendientes.length>0) ? `
  <div class="card" style="margin-bottom:16px;">
    <div class="card-h"><h3>⚠ Alertas activas</h3></div>
    <div class="card-b">
      ${(()=>{
        if(!isAdmin()) return '';
        const f = DB.get(KEYS.config).fechaUltimoResumenSemanal;
        const dias = f ? -diasHasta(f) : null;
        if(dias!==null && dias<7) return '';
        return `<div class="note-banner" style="background:var(--warn-soft,#fff3cd);border-color:#e6d3a3;color:#8a6d1a;">📧 ${f?('Han pasado '+dias+' día(s) desde el último resumen de alertas enviado.'):'Aún no has enviado un resumen semanal de alertas.'} <button class="btn btn-sm btn-ghost" data-goresumen="1" style="margin-left:8px;">Ir a Reportes</button></div>`;
      })()}
      ${reqPendientes.length>0?`
      <div class="note-banner" style="background:var(--warn-soft,#fff3cd);border-color:#e6d3a3;color:#8a6d1a;">🛒 ${reqPendientes.length} requerimiento(s) de compra esperando tu aprobación. <button class="btn btn-sm btn-ghost" data-goreq="1" style="margin-left:8px;">Ver</button></div>`:''}
      ${enAlmacen.length>0?`
      <div class="note-banner" style="background:var(--warn-soft,#fff3cd);border-color:#e6d3a3;color:#8a6d1a;">📦 ${enAlmacen.length} bien(es) registrado(s) en almacén, todavía sin asignar a un aula/ambiente. <button class="btn btn-sm btn-ghost" data-goalmacen="1" style="margin-left:8px;">Ver</button></div>`:''}
      ${porSanear.length>0?`
      <div class="note-banner" style="background:var(--warn-soft,#fff3cd);border-color:#e6d3a3;color:#8a6d1a;">🧾 ${porSanear.length} bien(es) marcado(s) "Por sanear" (hallados en una toma de inventario sin registro previo). <button class="btn btn-sm btn-ghost" data-gosanear="1" style="margin-left:8px;">Ver</button></div>`:''}
      ${vencidos.length>0?`
      <div class="note-banner" style="background:var(--bad-soft);border-color:#e6b3ba;color:var(--bad);">${vencidos.length} préstamo(s) con devolución vencida.</div>
      <div class="tbl-wrap" style="margin-bottom:14px;"><table>
        <thead><tr><th>N° préstamo</th><th>Solicitante</th><th>F. dev. programada</th><th class="num">Días de atraso</th><th></th></tr></thead>
        <tbody>${vencidos.map(p=>`<tr><td class="mono">${esc(p.numero)}</td><td>${esc(p.docente)}</td><td>${esc(p.fechaDevolucionProgramada)}</td><td class="num">${Math.round((new Date(today())-new Date(p.fechaDevolucionProgramada))/86400000)}</td><td><button class="btn btn-sm btn-ghost" data-goprestamos="1">Ver</button></td></tr>`).join('')}</tbody>
      </table></div>`:''}
      ${incidenciasAltas.length>0?`
      <div class="note-banner" style="background:var(--bad-soft);border-color:#e6b3ba;color:var(--bad);">${incidenciasAltas.length} incidencia(s) de prioridad Alta sin resolver.</div>
      <div class="tbl-wrap" style="margin-bottom:14px;"><table>
        <thead><tr><th>Bien</th><th>Descripción</th><th>Fecha</th><th></th></tr></thead>
        <tbody>${incidenciasAltas.map(m=>`<tr><td class="mono">${esc(m.codigoInterno)}<div class="hint">${esc(m.denominacion)}</div></td><td>${esc(m.descripcion)}</td><td>${esc(m.fechaReporte)}</td><td><button class="btn btn-sm btn-ghost" data-gomant="1">Ver</button></td></tr>`).join('')}</tbody>
      </table></div>`:''}
      ${mantProximos.length>0?`
      <div class="note-banner" style="background:var(--warn-soft,#fff3cd);border-color:#e6d3a3;color:#8a6d1a;">${mantProximos.length} mantenimiento(s)/calibración(es) programado(s) por vencer o ya vencido(s) (próximos 7 días).</div>
      <div class="tbl-wrap" style="margin-bottom:14px;"><table>
        <thead><tr><th>Bien</th><th>Descripción</th><th>F. programada</th><th></th></tr></thead>
        <tbody>${mantProximos.map(m=>`<tr><td class="mono">${esc(m.codigoInterno)}<div class="hint">${esc(m.denominacion)}</div></td><td>${esc(m.descripcion)}</td><td>${esc(m.fechaProgramada)}</td><td><button class="btn btn-sm btn-ghost" data-gomant="1">Ver</button></td></tr>`).join('')}</tbody>
      </table></div>`:''}
      ${porDepreciarPronto.length>0?`
      <div class="note-banner" style="background:var(--warn-soft,#fff3cd);border-color:#e6d3a3;color:#8a6d1a;">${porDepreciarPronto.length} bien(es) alcanzarán su vida útil (depreciación NICSP total) en los próximos 6 meses. Conviene planificar su renovación.</div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Código</th><th>Denominación</th><th>Aula</th><th></th></tr></thead>
        <tbody>${porDepreciarPronto.slice(0,8).map(i=>`<tr><td class="mono">${esc(i.codigoInterno)}</td><td>${esc(i.denominacion)}</td><td>${esc(i.aulaNombre||'—')}</td><td><button class="btn btn-sm btn-ghost" data-goitem="${i.id}">Ver</button></td></tr>`).join('')}</tbody>
      </table></div>
      ${porDepreciarPronto.length>8?`<div class="hint" style="padding:8px 0 0;">Mostrando 8 de ${porDepreciarPronto.length}.</div>`:''}`:''}
    </div>
  </div>`:''}
  ${renderComparativoInteranual(items)}
  ${renderCalidadDatos(items)}
  <div class="grid g2" style="margin-bottom:16px;">
    <div class="chartbox"><h4>Bienes por estado de conservación <button class="btn btn-sm btn-ghost" style="float:right;padding:2px 8px;" data-chart-download="chEstado" title="Descargar como imagen PNG">⬇️</button></h4><canvas id="chEstado"></canvas></div>
    <div class="chartbox"><h4>Bienes por aula / ambiente (top 8) <button class="btn btn-sm btn-ghost" style="float:right;padding:2px 8px;" data-chart-download="chAula" title="Descargar como imagen PNG">⬇️</button></h4><canvas id="chAula"></canvas></div>
  </div>
  <div class="grid g2" style="margin-bottom:16px;">
    <div class="chartbox"><h4>Denominaciones más frecuentes <button class="btn btn-sm btn-ghost" style="float:right;padding:2px 8px;" data-chart-download="chDenom" title="Descargar como imagen PNG">⬇️</button></h4><canvas id="chDenom"></canvas></div>
    <div class="chartbox"><h4>Registros por mes (tendencia) <button class="btn btn-sm btn-ghost" style="float:right;padding:2px 8px;" data-chart-download="chTendencia" title="Descargar como imagen PNG">⬇️</button></h4><canvas id="chTendencia"></canvas></div>
  </div>
  <div style="margin-bottom:16px;">
    <div class="chartbox"><h4>Valorización por categoría — Adquisición vs. Valor Neto en Libros (NICSP) <button class="btn btn-sm btn-ghost" style="float:right;padding:2px 8px;" data-chart-download="chDeprec" title="Descargar como imagen PNG">⬇️</button></h4><canvas id="chDeprec"></canvas></div>
  </div>
  <div class="grid g2">
    <div class="card">
      <div class="card-h"><h3>Últimos bienes registrados</h3></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Código interno</th><th>Denominación</th><th>Aula</th><th>Estado</th><th>Situación</th><th>Fecha</th></tr></thead>
        <tbody>
          ${recientes.map(i=>`<tr class="rowclick" data-goitem="${i.id}"><td class="mono">${esc(i.codigoInterno)}</td><td>${esc(i.denominacion)}</td><td>${esc(i.aulaNombre||'—')}</td><td>${estadoBadge(i.estadoConservacion)}</td><td>${situacionBadge(i.situacion)}</td><td>${esc(i.fechaRegistro)}</td></tr>`).join('')}
          ${recientes.length===0?'<tr><td colspan="6" class="empty">Sin registros todavía.</td></tr>':''}
        </tbody>
      </table></div>
    </div>
    <div class="card">
      <div class="card-h"><h3>Bienes que requieren atención (estado Malo)</h3></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Código</th><th>Denominación</th><th>Aula</th><th></th></tr></thead>
        <tbody>
          ${malos.map(i=>`<tr><td class="mono">${esc(i.codigoInterno)}</td><td>${esc(i.denominacion)}</td><td>${esc(i.aulaNombre||'—')}</td><td><button class="btn btn-sm btn-ghost" data-goitem="${i.id}">Ver</button></td></tr>`).join('')}
          ${malos.length===0?'<tr><td colspan="4" class="empty">Ningún bien está marcado en estado Malo. 👍</td></tr>':''}
        </tbody>
      </table></div>
    </div>
  </div>
  <div style="margin-top:16px;">
    <div class="card">
      <div class="card-h"><h3>Bienes totalmente depreciados (NICSP) — candidatos a evaluar renovación</h3></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Código</th><th>Denominación</th><th>Aula</th><th>F. registro</th><th></th></tr></thead>
        <tbody>
          ${totalmenteDeprec.map(i=>`<tr><td class="mono">${esc(i.codigoInterno)}</td><td>${esc(i.denominacion)}</td><td>${esc(i.aulaNombre||'—')}</td><td>${esc(i.fechaRegistro||'—')}</td><td><button class="btn btn-sm btn-ghost" data-goitem="${i.id}">Ver</button></td></tr>`).join('')}
          ${totalmenteDeprec.length===0?'<tr><td colspan="5" class="empty">Ningún bien alcanzó su vida útil todavía. 👍</td></tr>':''}
        </tbody>
      </table></div>
      ${totalmenteDeprecTotal>totalmenteDeprec.length?`<div class="hint" style="padding:8px 14px;">Mostrando 8 de ${totalmenteDeprecTotal}. Usa el filtro "Totalmente depreciado" en Bienes patrimoniales para ver todos.</div>`:''}
    </div>
  </div>`;
}
// Calidad de datos: bienes activos (no dados de baja) a los que les falta foto
// o valor de adquisición. No bloquea nada, solo ayuda a completar el inventario
// antes de que haga falta para un reporte o auditoría.
function renderCalidadDatos(items){
  const activos = items.filter(i=>i.situacion!=='De baja');
  const sinFoto = activos.filter(i=>!fotoDelBien(i));
  const sinValor = activos.filter(i=>i.valorAdquisicion==null || i.valorAdquisicion==='');
  if(sinFoto.length===0 && sinValor.length===0) return '';
  return `
  <div class="card" style="margin-bottom:16px;">
    <div class="card-h"><h3>📋 Calidad de datos del inventario</h3></div>
    <div class="card-b">
      <div class="grid g2">
        ${sinFoto.length>0?`<div><b>${sinFoto.length}</b> bien(es) activo(s) sin fotografía registrada.</div>`:''}
        ${sinValor.length>0?`<div><b>${sinValor.length}</b> bien(es) activo(s) sin valor de adquisición registrado (no entran en los reportes de valorización ni depreciación).</div>`:''}
      </div>
      <div class="hint" style="margin-top:8px;">Completar estos datos ayuda a que los reportes de valorización, depreciación y las etiquetas queden más completos. Ve a "Bienes patrimoniales" para editarlos.</div>
    </div>
  </div>`;
}
// Comparativo interanual: compara el año fiscal configurado contra el anterior,
// usando la fecha de registro de cada bien y los movimientos de tipo "Baja".
// Es solo informativo (vista de trabajo interna); no reemplaza ningún reporte oficial.
function renderComparativoInteranual(items){
  const cfg = DB.get(KEYS.config);
  const anioActual = Number(cfg.anioFiscal) || new Date().getFullYear();
  const anioAnterior = anioActual - 1;
  const movs = DB.get(KEYS.movs);
  function metricasDelAnio(anio){
    const registrados = items.filter(i=>(i.fechaRegistro||'').slice(0,4)===String(anio));
    const valorRegistrado = registrados.reduce((a,i)=>a+(Number(i.valorAdquisicion)||0),0);
    const bajas = movs.filter(m=>m.tipo==='Baja' && (m.fecha||'').slice(0,4)===String(anio)).length;
    return { registrados: registrados.length, valorRegistrado, bajas };
  }
  const act = metricasDelAnio(anioActual);
  const ant = metricasDelAnio(anioAnterior);
  function delta(a,b){
    if(b===0) return a>0 ? '<span style="color:var(--good,#2f6f4e);">▲ nuevo</span>' : '<span class="hint">—</span>';
    const pct = ((a-b)/b*100);
    const cls = pct>=0 ? 'color:var(--good,#2f6f4e);' : 'color:var(--bad);';
    return `<span style="${cls}">${pct>=0?'▲':'▼'} ${Math.abs(pct).toFixed(0)}%</span>`;
  }
  return `
  <div class="card" style="margin-bottom:16px;">
    <div class="card-h"><h3>Comparativo interanual — ${anioActual} vs. ${anioAnterior}</h3></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Indicador</th><th class="num">${anioAnterior}</th><th class="num">${anioActual}</th><th class="num">Variación</th></tr></thead>
      <tbody>
        <tr><td>Bienes registrados en el año</td><td class="num">${ant.registrados}</td><td class="num">${act.registrados}</td><td class="num">${delta(act.registrados,ant.registrados)}</td></tr>
        <tr><td>Valor de adquisición registrado</td><td class="num">${money(ant.valorRegistrado)}</td><td class="num">${money(act.valorRegistrado)}</td><td class="num">${delta(act.valorRegistrado,ant.valorRegistrado)}</td></tr>
        <tr><td>Bienes dados de baja en el año</td><td class="num">${ant.bajas}</td><td class="num">${act.bajas}</td><td class="num">${delta(act.bajas,ant.bajas)}</td></tr>
      </tbody>
    </table></div>
    <div class="hint" style="padding:8px 14px;">Basado en la fecha de registro de cada bien y en el kardex de movimientos tipo "Baja". Vista de trabajo interna, no sustituye el Informe Técnico de Baja de "Reportes".</div>
  </div>`;
}
function destroyCharts(){ Object.values(STATE.charts).forEach(ch=>{ try{ ch.destroy(); }catch(e){} }); STATE.charts={}; }
// Los gráficos de Chart.js se dibujan con fondo transparente; para que la
// imagen descargada se vea bien al pegarla en un oficio/informe (no quede
// "flotando" sobre un fondo oscuro), se compone sobre un fondo blanco antes
// de exportar a PNG.
function wireDescargaGraficos(){
  document.querySelectorAll('[data-chart-download]').forEach(btn=>btn.addEventListener('click', e=>{
    e.stopPropagation();
    const canvas = document.getElementById(btn.dataset.chartDownload);
    if(!canvas) return;
    const out = document.createElement('canvas'); out.width=canvas.width; out.height=canvas.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,out.width,out.height); ctx.drawImage(canvas,0,0);
    const a = document.createElement('a');
    a.href = out.toDataURL('image/png'); a.download = 'sigie_'+btn.dataset.chartDownload+'_'+today()+'.png';
    document.body.appendChild(a); a.click(); a.remove();
  }));
}
function renderDashboardCharts(){
  if(typeof Chart==='undefined'){
    // Chart.js se descarga la primera vez que se abre el panel; al terminar se vuelve a dibujar.
    cargarLibreria('chart').then(()=>{ if(document.getElementById('chEstado')) renderDashboardCharts(); }).catch(e=>toast(e.message,'err'));
    return;
  }
  destroyCharts();
  const items = scopedItems();
  const palette = ['#14304d','#b3122a','#a9822f','#2f6f4e','#2c5a8c','#8c5a9e','#c76b2f','#4d5c6b'];

  const porEstado = {}; ESTADOS_CONSERVACION.forEach(e=>porEstado[e]=0);
  items.forEach(i=>{ if(porEstado[i.estadoConservacion]!==undefined) porEstado[i.estadoConservacion]++; });
  const elEstado = document.getElementById('chEstado');
  if(elEstado) STATE.charts.estado = new Chart(elEstado, { type:'doughnut',
    data:{ labels:Object.keys(porEstado), datasets:[{ data:Object.values(porEstado), backgroundColor:['#2f6f4e','#2c5a8c','#a9682f','#8c1023'] }] },
    options:{ plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:11}}}}, maintainAspectRatio:false }
  });

  const porAula = {}; items.forEach(i=>{ const a=i.aulaNombre||'Sin asignar'; porAula[a]=(porAula[a]||0)+1; });
  const aulaEntries = Object.entries(porAula).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const elAula = document.getElementById('chAula');
  if(elAula) STATE.charts.aula = new Chart(elAula, { type:'bar',
    data:{ labels:aulaEntries.map(e=>e[0]), datasets:[{ label:'Bienes', data:aulaEntries.map(e=>e[1]), backgroundColor:'#14304d', borderRadius:4 }] },
    options:{ indexAxis:'y', plugins:{legend:{display:false}}, maintainAspectRatio:false, scales:{x:{ticks:{precision:0}}} }
  });

  const porDenom = {}; items.forEach(i=>{ porDenom[i.denominacion]=(porDenom[i.denominacion]||0)+1; });
  const denomEntries = Object.entries(porDenom).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const elDenom = document.getElementById('chDenom');
  if(elDenom) STATE.charts.denom = new Chart(elDenom, { type:'pie',
    data:{ labels:denomEntries.map(e=>e[0]), datasets:[{ data:denomEntries.map(e=>e[1]), backgroundColor:palette }] },
    options:{ plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:10}}}}, maintainAspectRatio:false }
  });

  const porMes = {};
  items.forEach(i=>{ const m=(i.fechaRegistro||'').slice(0,7); if(m) porMes[m]=(porMes[m]||0)+1; });
  const meses = Object.keys(porMes).sort();
  const elTend = document.getElementById('chTendencia');
  if(elTend) STATE.charts.tend = new Chart(elTend, { type:'line',
    data:{ labels:meses, datasets:[{ label:'Bienes registrados', data:meses.map(m=>porMes[m]), borderColor:'#b3122a', backgroundColor:'rgba(179,18,42,.12)', fill:true, tension:.25 }] },
    options:{ plugins:{legend:{display:false}}, maintainAspectRatio:false, scales:{y:{ticks:{precision:0}}} }
  });

  // Valorización por categoría de depreciación: compara el valor de adquisición
  // contra el valor neto en libros actual (NICSP), para ver de un vistazo qué
  // categorías concentran el mayor desgaste patrimonial.
  const categorias = DB.get(KEYS.categoriasDeprec);
  const porCategoria = {};
  categorias.forEach(c=>{ porCategoria[c.nombre] = { adquis:0, vnl:0 }; });
  items.forEach(i=>{
    const calc = calcularDepreciacionItem(i, categorias);
    if(!calc) return;
    const bucket = porCategoria[calc.categoria] || (porCategoria[calc.categoria]={adquis:0, vnl:0});
    bucket.adquis += Number(i.valorAdquisicion)||0;
    bucket.vnl += calc.valorNetoLibros;
  });
  const catEntries = Object.entries(porCategoria).filter(([,v])=>v.adquis>0);
  const elDeprec = document.getElementById('chDeprec');
  if(elDeprec) STATE.charts.deprec = new Chart(elDeprec, { type:'bar',
    data:{ labels:catEntries.map(e=>e[0]), datasets:[
      { label:'Valor de adquisición', data:catEntries.map(e=>e[1].adquis), backgroundColor:'#c9d3dc', borderRadius:4 },
      { label:'Valor neto en libros', data:catEntries.map(e=>e[1].vnl), backgroundColor:'#14304d', borderRadius:4 }
    ]},
    options:{ plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:11}}}}, maintainAspectRatio:false, scales:{y:{ticks:{callback:v=>'S/ '+v}}} }
  });
}
function estadoBadge(e){ const cls = e==='Muy Bueno'||e==='Bueno'?'badge-good':e==='Regular'?'badge-warn':'badge-bad'; return `<span class="badge ${cls}">${esc(e||'—')}</span>`; }
// Ficha corta de identificación del bien (marca, modelo, N° de serie, color)
// usada en los selectores de bienes de Préstamos y Mantenimientos/incidencias,
// para saber exactamente qué equipo se está por prestar o intervenir.
function fichaBienHTML(i){
  const campo = (v,ph)=> v? `<span class="mono">${esc(v)}</span>` : `<span class="hint">${ph}</span>`;
  return `${campo(i.marca,'Sin marca')} ${campo(i.modelo,'Sin modelo')} — ${campo(i.numeroSerie,'Sin serie')} — ${campo(i.color,'Sin color')}`;
}
function situacionBadge(s){ const cls=(s==='Activo'||s==='Asignado')?'badge-good':s==='De baja'?'badge-bad':(s==='En mantenimiento'||s==='Por sanear'||s==='En trámite de baja')?'badge-warn':'badge-info'; return `<span class="badge ${cls}">${esc(s||'—')}</span>`; }
// Muestra el aula de un bien, o una etiqueta clara cuando el bien todavía
// está "en almacén" (registrado pero sin asignar a un aula/ambiente todavía).
function aulaDisplay(it){ return it && it.aulaId ? esc(it.aulaNombre||'—') : '<span class="badge badge-info">📦 Almacén</span>'; }

/* ---------------------------------------------------------------------
   ALERTAS — reúne en un solo lugar los préstamos vencidos y las
   incidencias de prioridad Alta sin resolver, filtrados según lo que el
   usuario actual puede ver (rol DOCENTE solo ve sus aulas asignadas).
   Se usa tanto en el panel general como en el aviso al iniciar sesión.
   --------------------------------------------------------------------- */
// Días entre hoy y una fecha ISO futura (negativo si ya pasó).
function diasHasta(fechaISO){
  if(!fechaISO) return null;
  const f = new Date(fechaISO+'T00:00:00'); if(isNaN(f)) return null;
  return Math.round((f.getTime()-new Date(today()+'T00:00:00').getTime())/86400000);
}
function alertasActivas(){
  const prestamos = DB.get(KEYS.prestamos).filter(p=>isAdmin()||(p.bienesAula||[]).some(a=>puedoVerAula(a)));
  const vencidos = prestamos.filter(p=>p.estado==='Prestado' && p.fechaDevolucionProgramada && p.fechaDevolucionProgramada<today());
  const idsVisibles = new Set(scopedItems().map(i=>i.id));
  const mant = DB.get(KEYS.mantenimientos).filter(m=>isAdmin()||idsVisibles.has(m.itemId));
  const incidenciasAltas = mant.filter(m=>m.estado!=='Resuelto' && m.prioridad==='Alta');
  // Mantenimientos preventivos con fecha programada dentro de los próximos 7 días
  // (o ya vencidos sin resolver), para anticiparse en vez de enterarse recién con la falla.
  const mantProximos = mant.filter(m=>{
    if(m.estado==='Resuelto' || !m.fechaProgramada) return false;
    const d = diasHasta(m.fechaProgramada);
    return d!==null && d<=7;
  }).sort((a,b)=>(a.fechaProgramada||'').localeCompare(b.fechaProgramada||''));
  // Bienes que llegarán a su depreciación total (fin de vida útil NICSP) dentro de
  // los próximos 6 meses: sirve como aviso temprano para planificar su renovación.
  const items = scopedItems();
  const categorias = DB.get(KEYS.categoriasDeprec);
  const porDepreciarPronto = items.filter(i=>{
    const c = calcularDepreciacionItem(i, categorias);
    if(!c || c.totalmenteDepreciado) return false;
    const aniosRestantes = c.vidaUtilAnios - c.aniosTranscurridos;
    return aniosRestantes>0 && aniosRestantes<=0.5;
  });
  // Bienes recién comprados que aún no se asignaron a un aula/ambiente ("almacén"),
  // y bienes hallados sin registro previo durante una toma de inventario, pendientes
  // de saneamiento (sin fecha/valor de adquisición forzados).
  const enAlmacen = items.filter(i=>!i.aulaId && i.situacion!=='De baja');
  const porSanear = items.filter(i=>i.situacion==='Por sanear');
  // Requerimientos de compra esperando aprobación (solo relevante para el
  // Administrador/responsable de patrimonio, que es quien puede aprobarlos).
  const reqPendientes = isAdmin() ? (DB.get(KEYS.requerimientos)||[]).filter(r=>r.estado==='Solicitado') : [];
  // Expedientes de baja que llevan más de PLAZO_DIAS_RESOLUCION_BAJA días sin
  // Resolución (aprobada o rechazada): sirve de alerta para no dejarlos vencer.
  const bajasPlazoVencido = (DB.get(KEYS.bajas)||[]).filter(b=>{
    if(!['Solicitada','Con informe técnico'].includes(b.estado)) return false;
    const d = diasHasta(b.fechaSolicitud);
    return d!==null && (-d)>=PLAZO_DIAS_RESOLUCION_BAJA;
  });
  return { vencidos, incidenciasAltas, mantProximos, porDepreciarPronto, enAlmacen, porSanear, reqPendientes, bajasPlazoVencido };
}

/* ---------------------------------------------------------------------
   CENTRO DE NOTIFICACIONES (campanita en la barra superior) — consolida en
   un solo lugar, visible desde cualquier pantalla, las mismas alertas que
   ya se calculaban para el Dashboard (alertasActivas) más las discrepancias
   de Verificación SBN, para no tener que entrar a cada módulo a revisar.
   --------------------------------------------------------------------- */
function calcularNotificaciones(){
  const bibG = bibNotificaciones();
  // Las alertas patrimoniales (bienes, mantenimientos, pólizas…) solo aparecen si ese módulo tiene datos.
  if(!(DB.get(KEYS.items)||[]).length) return bibG;
  const { vencidos, incidenciasAltas, mantProximos, porDepreciarPronto, enAlmacen, porSanear, reqPendientes, bajasPlazoVencido } = alertasActivas();
  const discrepanciasSBN = contarDiscrepanciasSBN();
  const garantiasPorVencer = DB.get(KEYS.items).filter(i=>i.situacion!=='De baja' && i.garantiaHasta && diasHasta(i.garantiaHasta)<=30);
  const polizasPorVencer = (DB.get(KEYS.polizas)||[]).filter(p=>p.vigenciaHasta && diasHasta(p.vigenciaHasta)<=30);
  const grupos = [];
  if(vencidos.length) grupos.push({ic:'⇄', n:vencidos.length, texto:vencidos.length+' préstamo(s) con devolución vencida.', view:'prestamos', nivel:'bad'});
  if(incidenciasAltas.length) grupos.push({ic:'⚒', n:incidenciasAltas.length, texto:incidenciasAltas.length+' incidencia(s) de prioridad Alta sin resolver.', view:'mantenimientos', nivel:'bad'});
  if(mantProximos.length) grupos.push({ic:'⚒', n:mantProximos.length, texto:mantProximos.length+' mantenimiento(s)/calibración(es) programado(s) por vencer o ya vencido(s).', view:'mantenimientos', nivel:'warn'});
  if(reqPendientes.length) grupos.push({ic:'🛒', n:reqPendientes.length, texto:reqPendientes.length+' requerimiento(s) de compra esperando tu aprobación.', view:'requerimientos', nivel:'warn'});
  if(bajasPlazoVencido.length) grupos.push({ic:'🗑️', n:bajasPlazoVencido.length, texto:bajasPlazoVencido.length+' expediente(s) de baja sin Resolución, con el plazo referencial de '+PLAZO_DIAS_RESOLUCION_BAJA+' días vencido.', view:'bajas', nivel:'bad'});
  if(porDepreciarPronto.length) grupos.push({ic:'▽', n:porDepreciarPronto.length, texto:porDepreciarPronto.length+' bien(es) alcanzarán su vida útil (depreciación total) en los próximos 6 meses.', view:'items', nivel:'warn'});
  if(discrepanciasSBN>0) grupos.push({ic:'⚖', n:discrepanciasSBN, texto:discrepanciasSBN+' bien(es) con denominación pendiente de verificar contra el Catálogo SBN.', view:'verifSBN', nivel:'warn'});
  if(garantiasPorVencer.length) grupos.push({ic:'🛡', n:garantiasPorVencer.length, texto:garantiasPorVencer.length+' bien(es) con garantía de fábrica por vencer o vencida.', view:'items', nivel:'warn'});
  if(polizasPorVencer.length) grupos.push({ic:'🛡', n:polizasPorVencer.length, texto:polizasPorVencer.length+' póliza(s) de seguro por vencer o vencida(s).', view:'polizas', nivel:'warn'});
  if(enAlmacen.length) grupos.push({ic:'📦', n:enAlmacen.length, texto:enAlmacen.length+' bien(es) en almacén, sin asignar a un aula/ambiente.', view:'items', nivel:'warn'});
  if(porSanear.length) grupos.push({ic:'🧾', n:porSanear.length, texto:porSanear.length+' bien(es) "Por sanear" (hallados sin registro previo).', view:'items', nivel:'warn'});
  return [...bibG, ...grupos];
}
function renderNotifPanel(){
  const grupos = calcularNotificaciones();
  if(grupos.length===0) return '<div class="ri" style="color:var(--ink-soft);cursor:default;">Sin notificaciones pendientes. 👍</div>';
  return `<div class="gsearch-grp">Notificaciones</div>` + grupos.map(g=>`<div class="ri" data-notifgo="${g.view}"><b style="color:${g.nivel==='bad'?'var(--bad)':'var(--warn)'};">${g.ic} ${g.n}</b> — ${esc(g.texto)}</div>`).join('');
}

/* ---------------------------------------------------------------------
   RESUMEN SEMANAL DE ALERTAS: reutiliza exactamente el mismo cálculo del
   centro de notificaciones (calcularNotificaciones) para armar un texto
   listo para enviar por correo. Como el sistema corre en la computadora
   del colegio (sin servidor de correo propio), en vez de intentar enviar
   el correo automáticamente, se arma el borrador y se abre el programa
   de correo habitual del equipo (mailto:) con el texto ya redactado, o
   se ofrece copiarlo para pegarlo donde el usuario prefiera.
   --------------------------------------------------------------------- */
function construirResumenSemanalTexto(){
  const cfg = DB.get(KEYS.config);
  const grupos = calcularNotificaciones();
  const fecha = new Date().toLocaleDateString('es-PE', {day:'2-digit', month:'long', year:'numeric'});
  let txt = `Resumen semanal de alertas patrimoniales — ${cfg.nombreIE}\nFecha: ${fecha}\n\n`;
  if(grupos.length===0){
    txt += 'No hay alertas pendientes esta semana. 👍\n';
  }else{
    grupos.forEach(g=>{ txt += `• ${g.texto}\n`; });
  }
  txt += `\n—\nGenerado automáticamente por SIGIE (Sistema de Gestión de Inventario Escolar). Este resumen no reemplaza la revisión periódica del módulo de Notificaciones dentro del sistema.`;
  return txt;
}
function abrirBorradorResumenSemanal(){
  const cfg = DB.get(KEYS.config);
  const texto = construirResumenSemanalTexto();
  const asunto = 'Resumen semanal de alertas patrimoniales — '+cfg.nombreIE;
  const destinatarios = (cfg.emailNotificaciones||'').split(',').map(s=>s.trim()).filter(Boolean).join(',');
  const mailtoUrl = 'mailto:'+destinatarios+'?subject='+encodeURIComponent(asunto)+'&body='+encodeURIComponent(texto);
  if(!destinatarios){ toast('No hay un correo configurado. Puedes agregarlo en Configuración, o escribirlo directamente en tu programa de correo — el borrador se abrirá igual.'); }
  window.open(mailtoUrl, '_blank');
  DB.save(KEYS.config, {...DB.get(KEYS.config), fechaUltimoResumenSemanal: today()}).then(()=>renderContent());
}
async function copiarResumenSemanal(){
  const texto = construirResumenSemanalTexto();
  try{
    await navigator.clipboard.writeText(texto);
    toast('Resumen copiado al portapapeles. Ya puedes pegarlo en un correo, Whatsapp, etc.', 'ok');
  }catch(e){
    toast('No se pudo copiar automáticamente. Selecciona y copia el texto manualmente.', 'err');
  }
  await DB.save(KEYS.config, {...DB.get(KEYS.config), fechaUltimoResumenSemanal: today()});
  renderContent();
}

function wireNotificaciones(){
  const btn = document.getElementById('btnNotif');
  const panel = document.getElementById('notifPanel');
  if(!btn || !panel) return;
  btn.addEventListener('click', e=>{
    e.stopPropagation();
    const abrir = panel.style.display==='none';
    panel.style.display = abrir ? 'block' : 'none';
    if(abrir) panel.innerHTML = renderNotifPanel();
  });
  panel.addEventListener('click', e=>{
    const item = e.target.closest('[data-notifgo]');
    if(!item) return;
    panel.style.display='none';
    STATE.view = item.dataset.notifgo; STATE.sidebarOpen=false;
    render();
  });
  document.addEventListener('click', e=>{ if(!e.target.closest('.notif-wrap')) panel.style.display='none'; }, {once:true});
}

/* ---------------------------------------------------------------------
   LECTURA DE QR POR CÁMARA — complementa al "Generador de QR": ese módulo
   solo imprimía etiquetas; esto permite apuntar la cámara del celular/laptop
   a la etiqueta de un bien ya impreso y abrir su ficha al instante (muy útil
   durante una Toma de inventario física). El texto del QR es la ficha en
   texto plano (ver makeQrDataUrl/qrPayload); se extrae la línea "Código: …"
   para ubicar el bien por su código patrimonial.
   --------------------------------------------------------------------- */
function abrirEscanerQR(){
  if(typeof QrScanner==='undefined'){
    toast('No se pudo cargar el lector de QR. Verifica tu conexión a internet e inténtalo de nuevo.', 'err');
    return;
  }
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML = `<div class="modal" style="max-width:420px;">
    <div class="m-h"><h3>Escanear QR de un bien</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <video id="qrVideo" playsinline style="width:100%;border-radius:8px;background:#000;display:block;"></video>
      <div class="hint" id="qrScanHint" style="margin-top:10px;">Apunta la cámara a la etiqueta QR impresa del bien.</div>
    </div>
  </div>`;
  document.body.appendChild(bg);
  const videoEl = bg.querySelector('#qrVideo');
  const hint = bg.querySelector('#qrScanHint');
  let scanner = null;
  const close=()=>{ if(scanner){ try{scanner.stop();}catch(e){} try{scanner.destroy();}catch(e){} scanner=null; } bg.remove(); };
  bg.querySelector('.close-x').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  try{ QrScanner.WORKER_PATH = 'https://cdnjs.cloudflare.com/ajax/libs/qr-scanner/1.4.2/qr-scanner-worker.min.js'; }catch(e){}
  scanner = new QrScanner(videoEl, result=>{
    const texto = (typeof result==='string') ? result : (result && result.data) || '';
    if(!texto) return;
    const m = texto.match(/C[oó]digo:\s*(\S+)/i);
    const codigo = (m ? m[1] : texto.trim());
    const item = DB.get(KEYS.items).find(i=>i.codigoInterno===codigo || i.codigoUsoInterno===codigo);
    if(item){
      hint.textContent = '✓ Bien encontrado: '+item.codigoInterno+' — abriendo…';
      close();
      STATE.view='items'; STATE.filters={q:'',aula:'',estado:'',situacion:'',deprec:''};
      render();
      setTimeout(()=>openItemView(item.id), 60);
    }else{
      hint.textContent = 'No se encontró ningún bien con el código "'+codigo+'". Sigue apuntando la cámara…';
    }
  }, { highlightScanRegion:true, highlightCodeOutline:true, preferredCamera:'environment' });
  scanner.start().catch(err=>{
    hint.textContent = 'No se pudo acceder a la cámara ('+((err&&err.message)||err)+'). Revisa que el navegador tenga permiso de cámara y que estés usando https o localhost.';
  });
}

/* ---------------------------------------------------------------------
   LECTOR FÍSICO DE CÓDIGO DE BARRAS Y QR (pistola USB/Bluetooth) — este tipo
   de lector no usa la cámara del sistema: funciona como si fuera un teclado,
   "tipeando" el contenido a toda velocidad. Para el código de barras (Code128)
   ese contenido es solo el código patrimonial; para el QR es la ficha
   completa en texto plano de varias líneas (ver qrPayload en makeQrDataUrl),
   y esas líneas internas también llegan como pulsaciones de Enter — por eso
   NO se puede usar "Enter = fin del escaneo" como con el código de barras.
   En su lugar, se acumulan todas las teclas que llegan en una ráfaga muy
   rápida (propia de un lector, no de una persona escribiendo) y se procesa
   el resultado recién cuando hay una pausa breve, señal de que el escaneo
   terminó. Funciona en cualquier pantalla, siempre que el foco no esté sobre
   un campo de texto común (para no interferir con lo que la persona esté
   escribiendo a mano).
   --------------------------------------------------------------------- */
let _scanBuffer = '', _scanUltimaTecla = 0, _scanTimer = null;
const SCAN_GAP_MS = 35;   // separación máxima entre teclas para considerarlo un lector, no tecleo humano
const SCAN_IDLE_MS = 150; // pausa que indica que el escaneo (con todas sus líneas, si es QR) ya terminó
function procesarPosibleEscaneo(textoCrudo){
  const activo = document.activeElement;
  const enCampoTexto = activo && (activo.tagName==='INPUT' || activo.tagName==='TEXTAREA' || activo.isContentEditable);
  if(enCampoTexto || !STATE.session) return;
  const texto = textoCrudo.trim();
  if(texto.length<4) return;
  // Caso QR: la ficha trae una línea "Código: XXXX" (ver qrPayload). Si no
  // aparece, es probable que sea un código de barras (una sola línea, el
  // código patrimonial solo) — ahí se usa el texto completo tal cual.
  const m = texto.match(/C[oó]digo:\s*(\S+)/i);
  const esFichaQR = !!m;
  const codigo = esFichaQR ? m[1] : texto.split('\n')[0].trim();
  if(!codigo) return;
  const item = DB.get(KEYS.items).find(i=>i.codigoInterno===codigo || i.codigoUsoInterno===codigo);
  if(item){
    STATE.view='items'; STATE.filters={q:'',aula:'',estado:'',situacion:'',deprec:''};
    render(); setTimeout(()=>openItemView(item.id), 60);
  }else if(esFichaQR || !texto.includes('\n')){
    // Solo se avisa del "no encontrado" cuando hay señales claras de que sí
    // fue un intento de escaneo real (ficha QR reconocida, o una sola línea
    // como las que produce un lector de código de barras) — así se evita
    // molestar con avisos falsos por una ráfaga de tecleo humano rápido.
    toast('Ningún bien con el código "'+codigo+'" (lector físico).', 'err');
  }
}
document.addEventListener('keydown', e=>{
  const ahora = Date.now();
  if(ahora - _scanUltimaTecla > SCAN_GAP_MS) _scanBuffer=''; // pausa larga = no es un lector, se reinicia
  _scanUltimaTecla = ahora;
  if(e.key==='Enter'){ _scanBuffer += '\n'; }
  else if(e.key && e.key.length===1){ _scanBuffer += e.key; }
  else { return; } // teclas de control (Shift, Tab, flechas…) no interrumpen ni cuentan
  clearTimeout(_scanTimer);
  const bufferAlCerrar = _scanBuffer;
  _scanTimer = setTimeout(()=>{ procesarPosibleEscaneo(bufferAlCerrar); _scanBuffer=''; }, SCAN_IDLE_MS);
});
// Aviso emergente al abrir sesión / recargar el sistema, para que las alertas
// no dependan de que el usuario entre por su cuenta al panel general.
function mostrarAlertaSesion(){
  const { vencidos, incidenciasAltas, mantProximos, reqPendientes } = alertasActivas();
  if(vencidos.length===0 && incidenciasAltas.length===0 && mantProximos.length===0 && reqPendientes.length===0) return;
  const partes = [];
  if(vencidos.length>0) partes.push(vencidos.length+' préstamo(s) vencido(s)');
  if(incidenciasAltas.length>0) partes.push(incidenciasAltas.length+' incidencia(s) de prioridad alta sin resolver');
  if(mantProximos.length>0) partes.push(mantProximos.length+' mantenimiento(s)/calibración(es) programado(s) por vencer');
  if(reqPendientes.length>0) partes.push(reqPendientes.length+' requerimiento(s) de compra esperando aprobación');
  toast('⚠ Tienes '+partes.join(', ')+'.', 'err');
}

/* ---------------------------------------------------------------------
   9. BIENES / ITEMS
   --------------------------------------------------------------------- */
function renderItems(){
  const items = scopedItems();
  const aulas = scopedAulas();
  const prestadosIds = new Set(DB.get(KEYS.prestamos).filter(p=>p.estado==='Prestado').flatMap(p=>p.bienesIds));
  const f = STATE.filters;
  const filtered = items.filter(i=>{
    if(f.q){ const hay=(i.denominacion+' '+i.codigoInterno+' '+(i.marca||'')+' '+(i.numeroSerie||'')+' '+(i.codigoUsoInterno||'')).toLowerCase(); if(!hay.includes(f.q.toLowerCase())) return false; }
    if(f.aula){ if(f.aula==='__ALMACEN__'){ if(i.aulaId) return false; } else if(i.aulaId!==f.aula) return false; }
    if(f.estado && i.estadoConservacion!==f.estado) return false;
    if(f.situacion && i.situacion!==f.situacion) return false;
    if(f.deprec){
      const calc = calcularDepreciacionItem(i);
      if(f.deprec==='total' && !(calc && calc.totalmenteDepreciado)) return false;
      if(f.deprec==='vigente' && !(calc && !calc.totalmenteDepreciado)) return false;
      if(f.deprec==='noaplica' && calc) return false;
    }
    return true;
  });
  return `
  <div class="card"><div class="card-b">
    <div class="toolbar">
      <input class="search" id="fq" placeholder="Buscar por código, denominación, marca o serie…" value="${esc(f.q)}">
      <select id="faula"><option value="">Todas las aulas</option><option value="__ALMACEN__" ${f.aula==='__ALMACEN__'?'selected':''}>📦 Almacén (sin asignar)</option>${aulas.map(a=>`<option value="${a.id}" ${f.aula===a.id?'selected':''}>${esc(a.aulaLabel||a.nombre)}</option>`).join('')}</select>
      <select id="festado"><option value="">Todo estado</option>${ESTADOS_CONSERVACION.map(e=>`<option ${f.estado===e?'selected':''}>${ESTADO_ABREV[e]} - ${e}</option>`).join('')}</select>
      <select id="fsituacion"><option value="">Toda situación</option>${SITUACIONES.map(s=>`<option ${f.situacion===s?'selected':''}>${s}</option>`).join('')}</select>
      <select id="fdeprec"><option value="">Toda depreciación</option><option value="vigente" ${f.deprec==='vigente'?'selected':''}>Depreciándose</option><option value="total" ${f.deprec==='total'?'selected':''}>Totalmente depreciado</option><option value="noaplica" ${f.deprec==='noaplica'?'selected':''}>No depreciable (sin valor/categoría)</option></select>
      ${(f.q||f.aula||f.estado||f.situacion||f.deprec)?'<button class="btn btn-sm" id="fclear">Limpiar filtros</button>':''}
      <span style="flex:1"></span><span class="hint">${filtered.length} de ${items.length} bienes</span>
    </div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Cód. Patrimonial</th><th>Denominación</th><th>Marca / Modelo</th><th>Serie</th><th>Color</th><th>Estado</th><th>Aula</th><th>Fecha</th><th></th></tr></thead>
      <tbody>
      ${filtered.map(i=>`<tr>
        <td class="mono">${esc(i.codigoInterno)}</td>
        <td>${esc(i.denominacion)}</td>
        <td>${esc(i.marca||'—')} ${esc(i.modelo||'')}</td>
        <td class="mono">${esc(i.numeroSerie||'—')}</td>
        <td>${esc(i.color||'—')}</td>
        <td>${estadoBadge(i.estadoConservacion)} ${prestadosIds.has(i.id)?'<span class="badge badge-gold">En préstamo</span>':''}</td>
        <td>${aulaDisplay(i)}</td>
        <td>${esc(i.fechaRegistro||'—')}</td>
        <td style="white-space:nowrap;"><button class="btn btn-sm btn-ghost" data-view="${i.id}">Ver</button>${canEdit()?`<button class="btn btn-sm btn-ghost" data-edit="${i.id}">Editar</button>`:''}</td>
      </tr>`).join('')}
      ${filtered.length===0?`<tr><td colspan="9" class="empty"><div class="big">▤</div>No se encontraron bienes con esos filtros.</td></tr>`:''}
      </tbody>
    </table></div>
  </div></div>`;
}

// Formulario reducido al formato que exige MINEDU/UGEL para el registro de bienes:
// Denominación, Marca, Modelo, N° de Serie, Color y Estado (MB/B/R/M) — más el aula
// (para saber dónde está el bien) y el código patrimonial (editable, por si ya tienes
// el código oficial asignado). El código SBN y el responsable se completan solos.
function itemFormFields(it, aulas){
  it = it || {};
  return `
  <div class="grid g2">
    <div class="field"><label>Aula / ambiente</label><select id="f_aulaId"><option value="">📦 Almacén (todavía sin asignar a un aula)</option>${aulas.map(a=>`<option value="${a.id}" ${it.aulaId===a.id?'selected':''}>${esc(a.aulaLabel||a.nombre)}</option>`).join('')}</select>
      <div class="hint">Si el bien acaba de llegar y aún no sabes a qué aula va, déjalo en "Almacén" y asígnalo después editando el registro.</div>
    </div>
    <div class="field"><label>Código patrimonial</label><input id="f_codigoInterno" class="mono" value="${esc(it.codigoInterno||'Se generará al guardar')}" placeholder="Escribe el código oficial cuando lo tengas">
      <div class="hint">Se genera automático; puedes reemplazarlo por el código oficial cuando UGEL/SIGA lo asigne.</div>
    </div>
  </div>
  <div class="field"><label>Código de inventario del año anterior</label><input id="f_codigoAnioAnterior" value="${esc(it.codigoAnioAnterior||'')}" placeholder="S/C si es la primera vez"></div>
  <div class="field"><label>Código interno del colegio</label><input id="f_codigoUsoInterno" class="mono" value="${esc(it.codigoUsoInterno||'Se generará al guardar')}" readonly>
    <div class="hint">Se autogenera de forma correlativa (000001, 000002…) al registrar cada bien; es de uso exclusivo de la IE y no reemplaza el código patrimonial oficial.</div>
  </div>
  <div class="field"><label>Denominación *</label>
    <div class="denom-ac">
      <input id="f_denominacion" required autocomplete="off" value="${esc(it.denominacion||'')}" placeholder="Ej. COMPUTADORA PERSONAL PORTATIL" data-sbn="${esc(it.codigoSBN||'')}">
      <div class="res" id="denomRes"></div>
    </div>
    <div class="hint" id="denomHint">${it.codigoSBN?('Código SBN: '+esc(it.codigoSBN)):'Escribe para ver sugerencias del catálogo SBN (código y denominación oficial).'}</div>
  </div>
  <div class="grid g4">
    <div class="field"><label>Marca</label><input id="f_marca" value="${esc(it.marca||'')}"></div>
    <div class="field"><label>Modelo</label><input id="f_modelo" value="${esc(it.modelo||'')}"></div>
    <div class="field"><label>N° de Serie / Dimensiones</label><input id="f_numeroSerie" value="${esc(it.numeroSerie||'')}"></div>
    <div class="field"><label>Color</label><input id="f_color" value="${esc(it.color||'')}"></div>
  </div>
  <div class="grid g2">
    <div class="field"><label>Estado *</label><select id="f_estadoConservacion">${ESTADOS_CONSERVACION.map(e=>`<option value="${e}" ${it.estadoConservacion===e?'selected':''}>${ESTADO_ABREV[e]} - ${e}</option>`).join('')}</select></div>
    <div class="field"><label>Fecha de registro</label><input id="f_fechaRegistro" type="date" value="${esc(it.fechaRegistro||today())}"></div>
  </div>
  <div class="grid g2">
    <div class="field"><label>Garantía de fábrica hasta (opcional)</label><input id="f_garantiaHasta" type="date" value="${esc(it.garantiaHasta||'')}">
      <div class="hint">Si la dejas en blanco, no se generará ninguna alerta. Avisa en Notificaciones 30 días antes de vencer.</div>
    </div>
  </div>
  <div class="grid g2">
    <div class="field"><label>Forma de adquisición</label><select id="f_formaAdquisicion">${FORMAS_ADQUISICION.map(f=>`<option value="${esc(f)}" ${(it.formaAdquisicion||'Compra')===f?'selected':''}>${esc(f)}</option>`).join('')}</select>
      <div class="hint">Si es "Donación", completa abajo los datos del donante.</div>
    </div>
    <div class="field"><label>Valor de adquisición (S/.)</label><input id="f_valorAdquisicion" type="number" step="0.01" min="0" value="${it.valorAdquisicion!=null?esc(it.valorAdquisicion):''}" placeholder="Ej. 1850.00">
      <div class="hint" id="f_valorAdquisicionHint">Opcional. Se usa para los reportes de valorización, el KPI del panel general y la depreciación (NICSP).</div>
    </div>
  </div>
  <div class="grid g2" id="f_donacionFields" style="display:none;">
    <div class="field"><label>Donante (persona/entidad)</label><input id="f_donante" value="${esc(it.donante||'')}" placeholder="Ej. APAFA, empresa, persona natural…"></div>
    <div class="field"><label>Documento de donación (Acta/Resolución N°)</label><input id="f_documentoDonacion" value="${esc(it.documentoDonacion||'')}" placeholder="Ej. Acta de donación N° 001-2026"></div>
  </div>
  <div class="grid g2">
    <div class="field"><label>Responsable / custodio</label><select id="f_custodioId"><option value="">— Usar el de la aula (${esc((DB.get(KEYS.aulas).find(a=>a.id===it.aulaId)||{}).responsable||'sin asignar')}) —</option>${DB.get(KEYS.custodios).map(c=>`<option value="${c.id}" ${it.custodioId===c.id?'selected':''}>${esc(c.nombre)} — ${esc(c.cargo||'')}</option>`).join('')}</select>
      <div class="hint">Opcional. Si no eliges a nadie, se usa el responsable del aula.</div>
    </div>
  </div>
  <div class="field f-12"><label>Categoría de depreciación (NICSP)</label>
    <select id="f_categoriaDeprecId">${DB.get(KEYS.categoriasDeprec).map(c=>`<option value="${c.id}" ${(it.categoriaDeprecId?it.categoriaDeprecId===c.id:lookupCategoriaDeprec(it.denominacion)===c.id)?'selected':''}>${esc(c.nombre)} — vida útil: ${c.vidaUtilAnios} año(s)</option>`).join('')}</select>
    <div class="hint">Se sugiere sola según la denominación; puedes cambiarla. Define la vida útil usada en el reporte de depreciación. Editar la tabla en "Vida útil (depreciación)".</div>
  </div>
  <div class="grid g2">
    <div class="field"><label>Fotografía del bien</label><div class="imgpick"><div class="prev" id="fotoPrev">${fotoDelBien(it)?`<img src="${fotoDelBien(it)}">`:'Sin foto'}</div><input type="file" id="f_foto" accept="image/*"></div></div>
    <div class="field"><label>Observaciones</label><textarea id="f_observaciones" rows="2">${esc(it.observaciones||'')}</textarea></div>
  </div>
  <div class="field f-12"><label>Fotos adicionales (opcional)</label>
    <div class="hint" style="margin-bottom:6px;">Útil para guardar, por ejemplo, la placa/serie o el detalle de un daño, sin reemplazar la foto principal.</div>
    <div id="fotosExtraGrid" class="fotos-extra-grid"></div>
    <input type="file" id="f_fotoExtra" accept="image/*">
  </div>`;
}

function openItemModal(id){
  if(!guardEdit()) return;
  const items = DB.get(KEYS.items);
  const aulas = scopedAulas();
  const it = id ? items.find(x=>x.id===id) : null;
  if(aulas.length===0 && !isAdmin()){ toast('No tienes aulas asignadas. Contacta al administrador.', 'err'); return; }

  const bg = document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML = `<div class="modal">
    <div class="m-h"><h3>${it?'Editar bien patrimonial':'Registrar nuevo bien'}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">${itemFormFields(it, aulas)}</div>
    <div class="m-f"><button class="btn" id="cancelItem">Cancelar</button><button class="btn btn-primary" id="saveItem">${it?'Guardar cambios':'Registrar bien'}</button></div>
  </div>`;
  document.body.appendChild(bg);
  let fotoId = it?(it.fotoId||''):'';
  let fotoIdAnterior = fotoId; // para borrar el archivo viejo de la carpeta si se reemplaza
  let fotosExtraIds = it && Array.isArray(it.fotosIds) ? [...it.fotosIds] : [];
  const idsFotosExtraEliminadas = [];
  function renderFotosExtra(){
    const grid = bg.querySelector('#fotosExtraGrid');
    grid.innerHTML = fotosExtraIds.map((fid,idx)=>`<div class="fotex"><img src="${imagenSrc(fid)}"><button type="button" class="fotex-del" data-delfotex="${idx}" title="Quitar">&times;</button></div>`).join('') || '<div class="hint">Sin fotos adicionales.</div>';
    grid.querySelectorAll('[data-delfotex]').forEach(b=>b.addEventListener('click', ()=>{
      const idx = Number(b.dataset.delfotex);
      idsFotosExtraEliminadas.push(fotosExtraIds[idx]);
      fotosExtraIds.splice(idx,1);
      renderFotosExtra();
    }));
  }
  renderFotosExtra();
  bg.querySelector('#f_fotoExtra').addEventListener('change', async e=>{
    const file = e.target.files[0]; if(!file) return;
    try{
      const dataUrl = await comprimirImagen(file, 900, 0.72);
      const fid = await guardarImagen(dataUrl);
      fotosExtraIds.push(fid);
      renderFotosExtra();
      e.target.value = '';
    }catch(err){ toast('No se pudo procesar la imagen: '+err.message, 'err'); }
  });
  bg.querySelector('#f_foto').addEventListener('change', async e=>{
    const file = e.target.files[0]; if(!file) return;
    try{
      const dataUrl = await comprimirImagen(file, 900, 0.72);
      bg.querySelector('#fotoPrev').innerHTML = `<img src="${dataUrl}">`;
      fotoId = await guardarImagen(dataUrl); // se guarda ya mismo como archivo independiente
    }catch(err){ toast('No se pudo procesar la imagen: '+err.message, 'err'); }
  });
  const close = ()=>{ document.removeEventListener('click', cerrarDenomResAlSalir); bg.remove(); };
  bg.querySelector('.close-x').addEventListener('click', close);
  bg.querySelector('#cancelItem').addEventListener('click', close);
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });

  // Autocompletado de Denominación contra el catálogo SBN (reemplaza el
  // <datalist> nativo, que con ~4700 opciones es lento en equipos modestos).
  // Muestra como máximo 20 coincidencias mientras se escribe; al elegir una,
  // fija el código SBN exacto en data-sbn para que el guardado no dependa de
  // una adivinanza por texto parcial.
  const denomInput = bg.querySelector('#f_denominacion');
  const denomRes = bg.querySelector('#denomRes');
  const denomHint = bg.querySelector('#denomHint');
  function actualizarSugerenciasDenom(){
    const q = normalizaBusqueda(denomInput.value);
    if(!q){ denomRes.style.display='none'; denomRes.innerHTML=''; return; }
    const cat = DB.get(KEYS.catalogo);
    const empiezan = [], contienen = [];
    for(const c of cat){
      const cn = normalizaBusqueda(c.denominacion);
      if(cn.startsWith(q)) empiezan.push(c); else if(cn.includes(q)) contienen.push(c);
      if(empiezan.length>=20) break;
    }
    const sugerencias = empiezan.concat(contienen).slice(0,20);
    if(sugerencias.length===0){ denomRes.style.display='none'; denomRes.innerHTML=''; return; }
    denomRes.innerHTML = sugerencias.map(c=>`<div class="ri" data-denom="${esc(c.denominacion)}" data-cod="${esc(c.codigoSBN)}"><span class="cod">${esc(c.codigoSBN)}</span> — ${esc(c.denominacion)}</div>`).join('');
    denomRes.style.display='block';
    denomRes.querySelectorAll('[data-denom]').forEach(el=>el.addEventListener('click', ()=>{
      denomInput.value = el.dataset.denom;
      denomInput.dataset.sbn = el.dataset.cod;
      denomHint.textContent = 'Código SBN: '+el.dataset.cod;
      denomRes.style.display='none'; denomRes.innerHTML='';
      if(!categoriaTocadaManualmente) bg.querySelector('#f_categoriaDeprecId').value = lookupCategoriaDeprec(denomInput.value);
    }));
  }
  function cerrarDenomResAlSalir(e){ if(!e.target.closest('.denom-ac')) { denomRes.style.display='none'; } }
  document.addEventListener('click', cerrarDenomResAlSalir);
  denomInput.addEventListener('focus', actualizarSugerenciasDenom);

  // Mientras el usuario no haya elegido manualmente una categoría de
  // depreciación, la vamos re-sugiriendo automáticamente según lo que
  // va escribiendo en la denominación.
  let categoriaTocadaManualmente = !!(it && it.categoriaDeprecId);
  bg.querySelector('#f_categoriaDeprecId').addEventListener('change', ()=>{ categoriaTocadaManualmente = true; });

  // Muestra los campos de donante/documento de donación solo cuando la forma
  // de adquisición elegida es "Donación", y ajusta la etiqueta de ayuda del
  // valor de adquisición para dejar claro que en ese caso es un valor referencial.
  const formaAdqSel = bg.querySelector('#f_formaAdquisicion');
  const donacionFields = bg.querySelector('#f_donacionFields');
  const valorHint = bg.querySelector('#f_valorAdquisicionHint');
  function actualizarCamposDonacion(){
    const esDonacion = formaAdqSel.value === 'Donación';
    donacionFields.style.display = esDonacion ? '' : 'none';
    valorHint.textContent = esDonacion
      ? 'Valor referencial del bien donado (según acta/tasación), no un precio de compra.'
      : 'Opcional. Se usa para los reportes de valorización, el KPI del panel general y la depreciación (NICSP).';
  }
  formaAdqSel.addEventListener('change', actualizarCamposDonacion);
  actualizarCamposDonacion();
  bg.querySelector('#f_denominacion').addEventListener('input', e=>{
    e.target.dataset.sbn = ''; // el texto ya no corresponde a la sugerencia elegida antes
    actualizarSugerenciasDenom();
    const codigoDetectado = lookupSBN(e.target.value.trim());
    denomHint.textContent = codigoDetectado
      ? 'Código SBN detectado: '+codigoDetectado+' (verifícalo o elige otra sugerencia de la lista).'
      : 'Escribe para ver sugerencias del catálogo SBN (código y denominación oficial).';
    if(categoriaTocadaManualmente) return;
    bg.querySelector('#f_categoriaDeprecId').value = lookupCategoriaDeprec(e.target.value);
  });

  bg.querySelector('#saveItem').addEventListener('click', async ()=>{
    const denominacion = bg.querySelector('#f_denominacion').value.trim();
    const aulaId = bg.querySelector('#f_aulaId').value;
    if(!denominacion){ toast('Completa la denominación.', 'err'); return; }
    const aula = aulas.find(a=>a.id===aulaId);
    const cfg = DB.get(KEYS.config);
    const codigoSBN = (bg.querySelector('#f_denominacion').dataset.sbn || '').trim() || lookupSBN(denominacion) || (it?it.codigoSBN:'') || '';
    let codigoInterno = bg.querySelector('#f_codigoInterno').value.trim();
    if(!codigoInterno || codigoInterno==='Se generará al guardar'){
      const correlativoSBN = await nextCorrelativoPorSBN(codigoSBN);
      codigoInterno = buildCodigoPatrimonial(codigoSBN, correlativoSBN);
    }else{
      const dup = DB.get(KEYS.items).find(x=>x.codigoInterno && x.codigoInterno.trim().toUpperCase()===codigoInterno.toUpperCase() && (!it || x.id!==it.id));
      if(dup){ toast('Ese código patrimonial ya está asignado a "'+dup.denominacion+'" ('+dup.aulaNombre+'). Usa uno distinto.', 'err'); return; }
    }
    // Aviso (no bloqueante) de posible duplicado por número de serie: muchos bienes
    // escolares no tienen serie única, así que se deja continuar si el usuario confirma.
    const numeroSerieVal = bg.querySelector('#f_numeroSerie').value.trim();
    if(numeroSerieVal){
      const dupSerie = DB.get(KEYS.items).find(x=>x.numeroSerie && x.numeroSerie.trim().toUpperCase()===numeroSerieVal.toUpperCase() && (!it || x.id!==it.id));
      if(dupSerie && !confirm('El N° de Serie "'+numeroSerieVal+'" ya está registrado en "'+dupSerie.denominacion+'" ('+esc(dupSerie.codigoInterno)+', '+(dupSerie.aulaNombre||'—')+'). ¿Seguro que quieres continuar de todos modos?')) return;
    }
    const data = {
      id: it?it.id:uid('item'), codigoInterno,
      codigoAnioAnterior: bg.querySelector('#f_codigoAnioAnterior').value.trim(),
      codigoUsoInterno: it && it.codigoUsoInterno ? it.codigoUsoInterno : buildCodigoUsoInterno(await nextCorrelativoInterno()),
      denominacion, codigoSBN,
      marca: bg.querySelector('#f_marca').value.trim(), modelo: bg.querySelector('#f_modelo').value.trim(),
      numeroSerie: bg.querySelector('#f_numeroSerie').value.trim(), color: bg.querySelector('#f_color').value.trim(),
      estadoConservacion: bg.querySelector('#f_estadoConservacion').value,
      aulaId, aulaNombre: aula?(aula.aulaLabel||aula.nombre):'📦 Almacén (sin asignar)',
      valorAdquisicion: bg.querySelector('#f_valorAdquisicion').value.trim()!=='' ? Number(bg.querySelector('#f_valorAdquisicion').value) : null,
      formaAdquisicion: bg.querySelector('#f_formaAdquisicion').value,
      donante: bg.querySelector('#f_formaAdquisicion').value==='Donación' ? bg.querySelector('#f_donante').value.trim() : '',
      documentoDonacion: bg.querySelector('#f_formaAdquisicion').value==='Donación' ? bg.querySelector('#f_documentoDonacion').value.trim() : '',
      categoriaDeprecId: bg.querySelector('#f_categoriaDeprecId').value,
      ...(()=>{
        const custId = bg.querySelector('#f_custodioId').value;
        const cust = custId ? DB.get(KEYS.custodios).find(c=>c.id===custId) : null;
        return cust ? { custodioId: cust.id, custodioNombre: cust.nombre } : { custodioId:'', custodioNombre: aula?(aula.responsable||''):'' };
      })(),
      situacion: it?it.situacion:'Activo', fotoId, fotosIds: fotosExtraIds,
      fotosHistorial: (()=>{
        const historialPrevio = it && Array.isArray(it.fotosHistorial) ? [...it.fotosHistorial] : [];
        // Si se reemplaza (o se quita) la foto principal al editar, la foto anterior
        // NO se borra: se archiva con la fecha del cambio para poder comparar el
        // estado del bien en distintos momentos ("Línea de tiempo fotográfica").
        if(it && fotoIdAnterior && fotoIdAnterior!==fotoId){
          return [...historialPrevio, { id:uid('foto'), fotoId:fotoIdAnterior, fecha:today(), nota:'Foto anterior a la edición del bien.' }];
        }
        return historialPrevio;
      })(),
      observaciones: bg.querySelector('#f_observaciones').value.trim(),
      fechaRegistro: bg.querySelector('#f_fechaRegistro').value || today(), anio: cfg.anioFiscal,
      garantiaHasta: bg.querySelector('#f_garantiaHasta').value || '',
      registradoPor: it?(it.registradoPor||currentUser().usuario):currentUser().usuario
    };
    let list = DB.get(KEYS.items);
    let movTipo, movDetalle;
    if(it){
      list = list.map(x=>x.id===it.id?data:x);
      movTipo='Observación'; movDetalle='Actualización de datos del bien por '+currentUser().usuario+'.';
    }else{
      list = [...list, data];
      movTipo='Alta';
      movDetalle = data.formaAdquisicion==='Donación'
        ? 'Registro inicial del bien en el inventario por '+currentUser().usuario+'. Ingresa por donación de '+(data.donante||'donante no especificado')+(data.documentoDonacion?' ('+data.documentoDonacion+')':'')+'.'
        : 'Registro inicial del bien en el inventario por '+currentUser().usuario+'.';
    }
    await DB.save(KEYS.items, list);
    // La foto anterior ya no se borra: si cambió, queda archivada en fotosHistorial
    // (ver más arriba) para la Línea de tiempo fotográfica.
    for(const fid of idsFotosExtraEliminadas){ await eliminarImagen(fid); }
    await addMovimiento(data.id, data.codigoInterno, movTipo, movDetalle);
    await registrarBitacora(it?'Editar bien':'Crear bien', data.denominacion+' ('+data.codigoInterno+')');
    toast(it?'Bien actualizado correctamente.':'Bien registrado correctamente.', 'ok');
    close(); renderContent();
  });
}

/* ---------------------------------------------------------------------
   14-B. LÍNEA DE TIEMPO FOTOGRÁFICA — permite comparar el estado físico
   de un bien en distintas fechas. Se alimenta de dos formas: automática
   (cada vez que se reemplaza la foto principal al editar el bien, la
   anterior se archiva aquí en vez de borrarse) y manual (agregar una foto
   fechada sin tocar la foto principal, ej. antes/después de un
   mantenimiento o evidencia de un daño).
   --------------------------------------------------------------------- */
function bloqueLineaTiempoFotografica(it){
  const historial = [...(it.fotosHistorial||[])].sort((a,b)=>(a.fecha||'').localeCompare(b.fecha||''));
  const puntos = historial.map(h=>({...h, actual:false}));
  if(it.fotoId) puntos.push({id:null, fotoId:it.fotoId, fecha:'Foto actual', nota:'', actual:true});
  return `<div style="margin-top:14px;">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <h4 style="font-size:13.5px;margin:0;">Línea de tiempo fotográfica</h4>
      ${canEdit()?`<button class="btn btn-sm btn-ghost" id="btnAddFotoHist">+ Agregar foto</button>`:''}
    </div>
    ${puntos.length===0
      ? '<div class="hint">Aún no hay fotos con fecha registradas para comparar el estado del bien a lo largo del tiempo.</div>'
      : `<div style="display:flex;gap:8px;overflow-x:auto;padding:8px 0;">
        ${puntos.map(p=>`<div style="flex:0 0 100px;text-align:center;">
          <img src="${imagenSrc(p.fotoId)}" style="width:100px;height:100px;object-fit:cover;border-radius:6px;border:1px solid var(--line);">
          <div style="font-size:10px;margin-top:4px;">${esc(p.fecha)}</div>
          ${p.nota?`<div class="hint" style="font-size:9px;">${esc(p.nota)}</div>`:''}
          ${(!p.actual && canEdit())?`<button class="btn btn-sm btn-ghost" data-delfotohist="${esc(p.id)}" style="font-size:9px;padding:2px 6px;">Quitar</button>`:''}
        </div>`).join('')}
      </div>`}
  </div>`;
}
function abrirModalFotoHistorial(itemId){
  if(!guardEdit()) return;
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal" style="max-width:420px;">
    <div class="m-h"><h3>Agregar foto a la línea de tiempo</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="hint" style="margin-bottom:8px;">Útil para dejar constancia del estado físico del bien en una fecha concreta (ej. antes/después de un mantenimiento, evidencia de un daño), sin reemplazar la foto principal de la ficha.</div>
      <div class="field"><label>Foto *</label><input type="file" id="fh_foto" accept="image/*"></div>
      <div class="field"><label>Fecha</label><input type="date" id="fh_fecha" value="${today()}"></div>
      <div class="field"><label>Nota (opcional)</label><input id="fh_nota" placeholder="Ej. Antes del mantenimiento, daño en pantalla, etc."></div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Guardar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  let fotoId='';
  bg.querySelector('#fh_foto').addEventListener('change', async e=>{
    const file=e.target.files[0]; if(!file) return;
    try{ const dataUrl = await comprimirImagen(file, 900, 0.72); fotoId = await guardarImagen(dataUrl); toast('Foto cargada.','ok'); }
    catch(err){ toast('No se pudo procesar la imagen: '+err.message,'err'); }
  });
  bg.querySelector('#save').addEventListener('click', async ()=>{
    if(!fotoId){ toast('Selecciona una foto.','err'); return; }
    const fecha = bg.querySelector('#fh_fecha').value || today();
    const nota = bg.querySelector('#fh_nota').value.trim();
    const items = DB.get(KEYS.items);
    const it = items.find(x=>x.id===itemId); if(!it) return;
    const historial = [...(it.fotosHistorial||[]), {id:uid('foto'), fotoId, fecha, nota}];
    const list = items.map(x=>x.id===itemId?{...x, fotosHistorial:historial}:x);
    await DB.save(KEYS.items, list);
    await addMovimiento(itemId, it.codigoInterno, 'Observación', 'Foto agregada a la línea de tiempo fotográfica ('+fecha+')'+(nota?': '+nota:'')+' por '+currentUser().usuario+'.');
    toast('Foto agregada a la línea de tiempo.','ok');
    close(); openItemView(itemId);
  });
}
async function eliminarFotoHistorial(itemId, fotoHistId){
  if(!guardEdit()) return false;
  if(!confirm('¿Quitar esta foto de la línea de tiempo? Esta acción no se puede deshacer.')) return false;
  const items = DB.get(KEYS.items);
  const it = items.find(x=>x.id===itemId); if(!it) return false;
  const entry = (it.fotosHistorial||[]).find(f=>f.id===fotoHistId);
  const historial = (it.fotosHistorial||[]).filter(f=>f.id!==fotoHistId);
  const list = items.map(x=>x.id===itemId?{...x, fotosHistorial:historial}:x);
  await DB.save(KEYS.items, list);
  if(entry) await eliminarImagen(entry.fotoId);
  toast('Foto eliminada de la línea de tiempo.','ok');
  return true;
}

// Cierra el ciclo de saneamiento: permite completar, cuando se logren ubicar,
// la fecha y el valor de adquisición de un bien que se dio de alta como
// "Por sanear" (hallado sin documentación durante una toma de inventario).
// Ambos campos siguen siendo opcionales: si nunca aparece la documentación,
// el bien puede quedar saneado igual, solo actualizando su situación.
function abrirModalCompletarSaneamiento(id){
  if(!guardEdit()) return;
  const it = DB.get(KEYS.items).find(x=>x.id===id);
  if(!it) return;
  const bg = document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML = `<div class="modal" style="max-width:480px;">
    <div class="m-h"><h3>Completar saneamiento</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="hint" style="margin-bottom:10px;">${esc(it.motivoSaneamiento||'Este bien fue hallado sin registro previo.')} Completa los datos que hayas logrado sustentar (opcional) y confirma para cerrar el saneamiento.</div>
      <div class="field"><label>Fecha de adquisición (si se pudo determinar)</label><input id="sn_fecha" type="date" value="${esc(it.fechaRegistro||'')}"></div>
      <div class="field"><label>Valor de adquisición (S/.), si se pudo sustentar</label><input id="sn_valor" type="number" step="0.01" min="0" value="${it.valorAdquisicion!=null?esc(it.valorAdquisicion):''}" placeholder="Déjalo vacío si no se pudo sustentar"></div>
      <div class="field"><label>Nota de saneamiento</label><textarea id="sn_nota" rows="2" placeholder="Ej. Se verificó con el custodio, sin comprobante de compra disponible."></textarea></div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="confirmar">Confirmar saneamiento</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  bg.querySelector('#confirmar').addEventListener('click', async ()=>{
    const fecha = bg.querySelector('#sn_fecha').value || it.fechaRegistro;
    const valorStr = bg.querySelector('#sn_valor').value.trim();
    const nota = bg.querySelector('#sn_nota').value.trim();
    const cambios = {
      pendienteSaneamiento: false, situacion: 'Activo',
      fechaRegistro: fecha, valorAdquisicion: valorStr!=='' ? Number(valorStr) : it.valorAdquisicion,
      observaciones: (it.observaciones?it.observaciones+' — ':'')+'Saneado el '+today()+' por '+currentUser().usuario+(nota?(': '+nota):'.')
    };
    const list = DB.get(KEYS.items).map(x=>x.id===id?{...x, ...cambios}:x);
    await DB.save(KEYS.items, list);
    await addMovimiento(id, it.codigoInterno, 'Observación', 'Saneamiento completado por '+currentUser().usuario+(nota?(' — '+nota):'.'));
    await registrarBitacora('Completar saneamiento', it.denominacion+' ('+it.codigoInterno+')');
    toast('Saneamiento completado.', 'ok');
    close(); openItemView(id);
  });
}
function openItemView(id){
  const it = DB.get(KEYS.items).find(x=>x.id===id);
  if(!it) return;
  const movs = DB.get(KEYS.movs).filter(m=>m.itemId===id).sort((a,b)=>b.fecha.localeCompare(a.fecha));
  const bg = document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML = `<div class="modal">
    <div class="m-h"><h3>${esc(it.denominacion)}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
    ${it.pendienteSaneamiento?`<div class="note-banner" style="background:var(--warn-soft,#fff3cd);border-color:#e6d3a3;color:#8a6d1a;margin-bottom:12px;">🧾 Este bien está <b>pendiente de saneamiento</b>: ${esc(it.motivoSaneamiento||'fue hallado sin registro previo.')} No tiene fecha ni valor de adquisición forzados.${canEdit()?' Usa el botón "Completar saneamiento" cuando tengas esos datos.':''}</div>`:''}
    <div class="grid g2">
      <div>
        ${fotoDelBien(it)?`<img src="${fotoDelBien(it)}" style="width:100%;border-radius:8px;margin-bottom:12px;border:1px solid var(--line);">`:''}
        ${(it.fotosIds&&it.fotosIds.length)?`<div class="fotos-extra-grid" style="margin-bottom:12px;">${it.fotosIds.map(fid=>`<div class="fotex"><img src="${imagenSrc(fid)}"></div>`).join('')}</div>`:''}
        ${bloqueLineaTiempoFotografica(it)}
        <table>
          <tr><td class="hint">Código patrimonial</td><td class="mono">${esc(it.codigoInterno)}</td></tr>
          <tr><td class="hint">Código interno (colegio)</td><td class="mono">${esc(it.codigoUsoInterno||'—')}</td></tr>
          <tr><td class="hint">Cód. año anterior</td><td class="mono">${esc(it.codigoAnioAnterior||'S/C')}</td></tr>
          <tr><td class="hint">Código SBN</td><td class="mono">${esc(it.codigoSBN||'—')}</td></tr>
          <tr><td class="hint">Marca / Modelo</td><td>${esc(it.marca||'—')} ${esc(it.modelo||'')}</td></tr>
          <tr><td class="hint">N° de serie</td><td>${esc(it.numeroSerie||'—')}</td></tr>
          <tr><td class="hint">Color</td><td>${esc(it.color||'—')}</td></tr>
          <tr><td class="hint">Forma de adquisición</td><td>${esc(it.formaAdquisicion||'Compra')}</td></tr>
          ${it.formaAdquisicion==='Donación'?`
          <tr><td class="hint">Donante</td><td>${esc(it.donante||'—')}</td></tr>
          <tr><td class="hint">Documento de donación</td><td>${esc(it.documentoDonacion||'—')}</td></tr>`:''}
          <tr><td class="hint">Valor de adquisición${it.formaAdquisicion==='Donación'?' (referencial)':''}</td><td>${it.valorAdquisicion!=null?money(Number(it.valorAdquisicion)):'—'}</td></tr>
          ${(()=>{ const calc = calcularDepreciacionItem(it); if(!calc) return ''; return `
          <tr><td class="hint">Categoría depreciación</td><td>${esc(calc.categoria)} (vida útil: ${calc.vidaUtilAnios} año(s))</td></tr>
          <tr><td class="hint">Depreciación acumulada</td><td>${money(calc.depreciacionAcumulada)} (${calc.pctDepreciado.toFixed(1)}%)</td></tr>
          <tr><td class="hint">Valor neto en libros</td><td><b>${money(calc.valorNetoLibros)}</b>${calc.totalmenteDepreciado?' <span class="badge badge-warn">Totalmente depreciado</span>':''}</td></tr>`; })()}
          <tr><td class="hint">Estado</td><td>${estadoBadge(it.estadoConservacion)}</td></tr>
          <tr><td class="hint">Situación</td><td>${situacionBadge(it.situacion)}</td></tr>
          <tr><td class="hint">Aula</td><td>${aulaDisplay(it)}</td></tr>
          <tr><td class="hint">Responsable</td><td>${esc(it.custodioNombre||'—')}</td></tr>
          <tr><td class="hint">Fecha de registro</td><td>${esc(it.fechaRegistro||'—')}</td></tr>
          ${it.garantiaHasta?`<tr><td class="hint">Garantía de fábrica hasta</td><td>${esc(it.garantiaHasta)} ${(()=>{ const d=diasHasta(it.garantiaHasta); return d<0?'<span class="badge badge-bad">Vencida</span>':(d<=30?'<span class="badge badge-warn">Vence en '+d+' día(s)</span>':''); })()}</td></tr>`:''}
          <tr><td class="hint">Registrado por</td><td>${esc(it.registradoPor||'—')}</td></tr>
          <tr><td class="hint">Observaciones</td><td>${esc(it.observaciones||'—')}</td></tr>
        </table>
      </div>
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <h4 style="font-size:13.5px;margin:0;">Historial (kardex)</h4>
          ${movs.length>0?`<button class="btn btn-sm btn-ghost" id="btnImprimirKardex">Imprimir PDF</button>`:''}
        </div>
        ${movs.map(m=>`<div class="hist-item"><div class="d">${esc(m.fecha)} · ${esc(m.tipo)}</div><div class="t">${esc(m.detalle)}</div></div>`).join('') || '<div class="hint">Sin movimientos registrados.</div>'}
        ${canEdit()?`<div style="margin-top:14px;"><button class="btn btn-primary btn-sm" id="mv_open">+ Registrar movimiento</button></div>`:''}
      </div>
    </div></div>
    <div class="m-f">
      ${canEdit()?`<button class="btn btn-danger" id="delItem">Enviar a papelera</button>${it.situacion==='En trámite de baja'?` <button class="btn" id="btnVerExpedienteBaja">Ver expediente de baja</button>`:(it.situacion!=='De baja'?` <button class="btn btn-danger" id="btnDarBaja">Solicitar baja</button>`:'')}${it.pendienteSaneamiento?` <button class="btn" id="btnCompletarSaneo">Completar saneamiento</button>`:''}`:'<span></span>'}
      <span style="flex:1"></span>
      <button class="btn" id="closeView">Cerrar</button>
      ${canEdit()?`<button class="btn btn-primary" id="editFromView">Editar</button>`:''}
    </div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').addEventListener('click', close);
  bg.querySelector('#closeView').addEventListener('click', close);
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  const editBtn = bg.querySelector('#editFromView'); if(editBtn) editBtn.addEventListener('click', ()=>{ close(); openItemModal(id); });
  const delBtn = bg.querySelector('#delItem'); if(delBtn) delBtn.addEventListener('click', async ()=>{
    if(!confirm('¿Enviar este bien a la papelera de reciclaje? Podrás restaurarlo luego desde "Papelera".')) return;
    const list = DB.get(KEYS.items).filter(x=>x.id!==id);
    await DB.save(KEYS.items, list);
    const pap = DB.get(KEYS.papelera);
    await DB.save(KEYS.papelera, [...pap, {...it, eliminadoPor:currentUser().usuario, fechaEliminacion:today()}]);
    await addMovimiento(it.id, it.codigoInterno, 'Observación', 'Bien enviado a la papelera por '+currentUser().usuario+'.');
    await registrarBitacora('Eliminar bien (a papelera)', it.denominacion+' ('+it.codigoInterno+')');
    toast('Bien movido a la papelera.', 'ok');
    close(); renderContent();
  });
  const kardexBtn = bg.querySelector('#btnImprimirKardex'); if(kardexBtn) kardexBtn.addEventListener('click', ()=>imprimirKardexBien(it, movs));
  const bajaBtn = bg.querySelector('#btnDarBaja'); if(bajaBtn) bajaBtn.addEventListener('click', ()=>{ close(); openSolicitudBajaModal(it.id); });
  const verExpBtn = bg.querySelector('#btnVerExpedienteBaja'); if(verExpBtn) verExpBtn.addEventListener('click', ()=>{
    const baja = (DB.get(KEYS.bajas)||[]).find(b=>b.itemId===it.id && !['Con disposición final','Rechazada'].includes(b.estado));
    close();
    if(baja) verBajaDetalle(baja.id); else { STATE.view='bajas'; render(); }
  });
  const saneoBtn = bg.querySelector('#btnCompletarSaneo'); if(saneoBtn) saneoBtn.addEventListener('click', ()=>{ close(); abrirModalCompletarSaneamiento(id); });
  const addFotoHistBtn = bg.querySelector('#btnAddFotoHist'); if(addFotoHistBtn) addFotoHistBtn.addEventListener('click', ()=>{ close(); abrirModalFotoHistorial(id); });
  bg.querySelectorAll('[data-delfotohist]').forEach(b=>b.addEventListener('click', async ()=>{
    const ok = await eliminarFotoHistorial(id, b.dataset.delfotohist);
    if(ok){ close(); openItemView(id); }
  }));
  const mvBtn = bg.querySelector('#mv_open'); if(mvBtn) mvBtn.addEventListener('click', ()=>abrirModalMovimientoBien(it, ()=>{ close(); openItemView(id); }));
}
// Registrar un movimiento en el kardex de un bien (modal independiente).
function abrirModalMovimientoBien(it, onDone){
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal" style="max-width:520px;">
    <div class="m-h"><h3>Registrar movimiento</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="hint" style="margin-bottom:10px;"><b>${esc(it.codigoInterno)}</b> — ${esc(it.denominacion)}</div>
      <div class="field"><label>Tipo de movimiento</label><select id="mv_tipo">${TIPOS_MOV.filter(t=>t!=='Baja').map(t=>`<option>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Detalle *</label><textarea id="mv_detalle" rows="3" placeholder="Detalle del movimiento…"></textarea>
      <div class="hint">Para dar de baja un bien usa el botón "Solicitar baja", que abre el expediente formal (informe técnico, resolución y disposición final).</div></div>
    </div>
    <div class="m-f"><button class="btn" id="cancelMv">Cancelar</button><button class="btn btn-primary" id="mv_save">Agregar al kardex</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancelMv').onclick=close;
  bg.addEventListener('click',e=>{ if(e.target===bg) close(); });
  setTimeout(()=>bg.querySelector('#mv_detalle').focus(),30);
  bg.querySelector('#mv_save').addEventListener('click', async ()=>{
    const tipo = bg.querySelector('#mv_tipo').value;
    const detalle = bg.querySelector('#mv_detalle').value.trim();
    if(!detalle){ toast('Escribe el detalle del movimiento.', 'err'); return; }
    await addMovimiento(it.id, it.codigoInterno, tipo, detalle+' ('+currentUser().usuario+')');
    toast('Movimiento registrado.', 'ok');
    close(); if(onDone) onDone();
  });
}
// Historial (kardex) imprimible de UN bien: documento de trabajo interno para
// sustentar auditorías propias del colegio; no reemplaza ni modifica ninguno
// de los formatos oficiales que exige la UGEL (esos siguen en "Reportes").
function imprimirKardexBien(it, movs){
  const cfg = DB.get(KEYS.config);
  const movsOrdenados = [...movs].sort((a,b)=>a.fecha.localeCompare(b.fecha));
  const body = `
  <h2>HISTORIAL DE MOVIMIENTOS (KARDEX) — DOCUMENTO INTERNO</h2>
  <p><b>I.E.:</b> ${esc(cfg.nombreIE||'—')} &nbsp;&nbsp; <b>Año fiscal:</b> ${esc(cfg.anioFiscal||'—')}</p>
  <table><tr>
    <td><b>Código patrimonial:</b> ${esc(it.codigoInterno)}</td>
    <td><b>Código interno:</b> ${esc(it.codigoUsoInterno||'—')}</td>
  </tr><tr>
    <td colspan="2"><b>Denominación:</b> ${esc(it.denominacion)}</td>
  </tr><tr>
    <td><b>Aula/ambiente:</b> ${esc(it.aulaNombre||'—')}</td>
    <td><b>Responsable:</b> ${esc(it.custodioNombre||'—')}</td>
  </tr></table>
  <table><thead><tr><th>Fecha</th><th>Tipo de movimiento</th><th>Detalle</th></tr></thead>
  <tbody>${movsOrdenados.map(m=>`<tr><td>${esc(m.fecha)}</td><td>${esc(m.tipo)}</td><td>${esc(m.detalle)}</td></tr>`).join('') || '<tr><td colspan="3" style="text-align:center;">Sin movimientos registrados.</td></tr>'}</tbody></table>
  <p style="font-size:10px;color:#555;margin-top:14px;">Documento generado automáticamente por SIGIE como respaldo interno de trazabilidad. No sustituye los formatos oficiales de la UGEL.</p>`;
  abrirVentanaImpresion('Kardex '+it.codigoInterno, body);
}
async function addMovimiento(itemId, codigoInterno, tipo, detalle){
  const movs = DB.get(KEYS.movs);
  await DB.save(KEYS.movs, [...movs, { id:uid('mov'), itemId, codigoInterno, tipo, detalle, fecha:today() }]);
}

/* ---------------------------------------------------------------------
   10. MOVIMIENTOS / KARDEX GLOBAL
   --------------------------------------------------------------------- */
function renderMovs(){
  const idsVisibles = new Set(scopedItems().map(i=>i.id));
  const movs = [...DB.get(KEYS.movs)].filter(m=>isAdmin()||idsVisibles.has(m.itemId)).sort((a,b)=>b.fecha.localeCompare(a.fecha));
  return `<div class="card"><div class="tbl-wrap"><table>
    <thead><tr><th>Fecha</th><th>Código interno</th><th>Tipo</th><th>Detalle</th></tr></thead>
    <tbody>${movs.map(m=>`<tr><td>${esc(m.fecha)}</td><td class="mono">${esc(m.codigoInterno)}</td><td>${tipoMovBadge(m.tipo)}</td><td>${esc(m.detalle)}</td></tr>`).join('')}
    ${movs.length===0?'<tr><td colspan="4" class="empty">Aún no hay movimientos registrados.</td></tr>':''}</tbody>
  </table></div></div>`;
}
function tipoMovBadge(t){
  const map={Alta:'badge-good', Baja:'badge-bad', 'Traslado de ambiente':'badge-info','Cambio de custodio':'badge-info','Mantenimiento':'badge-warn','Préstamo':'badge-gold','Devolución':'badge-good','Observación':'badge-gold'};
  return `<span class="badge ${map[t]||'badge-info'}">${esc(t)}</span>`;
}

/* ---------------------------------------------------------------------
   11. AULAS (solo admin)
   --------------------------------------------------------------------- */
function renderAulas(){
  const aulas = DB.get(KEYS.aulas); const items = DB.get(KEYS.items);
  return `<div class="card"><div class="tbl-wrap"><table>
    <thead><tr><th>Nivel</th><th>Grado</th><th>Sección</th><th>Responsable</th><th class="num">N° bienes</th><th></th></tr></thead>
    <tbody>${aulas.map(a=>`<tr>
      <td>${esc(a.nivel||'—')}</td><td>${esc(a.grado||'—')}</td><td>${esc(a.seccion||'—')}</td><td>${esc(a.responsable||'—')}</td>
      <td class="num">${items.filter(i=>i.aulaId===a.id).length}</td>
      <td style="white-space:nowrap;"><button class="btn btn-sm btn-ghost" data-editaula="${a.id}">Editar</button><button class="btn btn-sm btn-danger" data-delaula="${a.id}">Eliminar</button></td>
    </tr>`).join('')}
    ${aulas.length===0?'<tr><td colspan="6" class="empty"><div class="big">▢</div>Registra tu primera aula o ambiente: solo necesitas Nivel, Grado, Sección y Responsable.</td></tr>':''}
    </tbody></table></div></div>`;
}
// Solo se pide lo esencial: Nivel, Grado (o nombre del ambiente si no es un aula de
// grado, ej. "Laboratorio"), Sección y Responsable. El código y nombre interno del
// aula se arman solos a partir de estos datos.
function openAulaModal(id){
  if(!isAdmin()){ toast('Solo un administrador puede gestionar aulas.','err'); return; }
  const aulas = DB.get(KEYS.aulas); const a = id?aulas.find(x=>x.id===id):null;
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal" style="max-width:480px;">
    <div class="m-h"><h3>${a?'Editar aula/ambiente':'Nueva aula / ambiente'}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="field"><label>Nivel *</label><select id="a_nivel">${NIVELES.map(n=>`<option ${a&&a.nivel===n?'selected':''}>${n}</option>`).join('')}</select></div>
      <div class="grid g2">
        <div class="field"><label>Grado *</label><input id="a_grado" value="${esc(a?a.grado:'')}" placeholder="Ej. 3° o Laboratorio"></div>
        <div class="field"><label>Sección</label><input id="a_seccion" value="${esc(a?a.seccion:'')}" placeholder="Ej. A (déjalo vacío si no aplica)"></div>
      </div>
      <div class="field"><label>Responsable *</label><input id="a_responsable" value="${esc(a?a.responsable:'')}" placeholder="Nombre del docente o encargado"></div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Guardar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click',e=>{if(e.target===bg)close();});
  bg.querySelector('#save').addEventListener('click', async ()=>{
    const nivel=bg.querySelector('#a_nivel').value, grado=bg.querySelector('#a_grado').value.trim(), seccion=bg.querySelector('#a_seccion').value.trim(), responsable=bg.querySelector('#a_responsable').value.trim();
    if(!grado||!responsable){toast('Completa al menos el grado/ambiente y el responsable.','err');return;}
    let list = DB.get(KEYS.aulas);
    const dup = list.find(x=>(!a||x.id!==a.id) && x.nivel===nivel && x.grado.trim().toLowerCase()===grado.toLowerCase() && (x.seccion||'').trim().toLowerCase()===seccion.toLowerCase());
    if(dup && !confirm('Ya existe un aula/ambiente con el mismo Nivel, Grado y Sección ("'+(dup.aulaLabel||dup.nombre)+'"). ¿Deseas registrarla igual?')) return;
    const nombre = [grado, seccion].filter(Boolean).join(' ');
    const aulaLabel = [nivel, nombre].filter(Boolean).join(' · ');
    const codigo = a?a.codigo:('AUL-'+String(list.length+1).padStart(3,'0'));
    const data={ id:a?a.id:uid('aula'), codigo, nivel, grado, seccion, nombre, aulaLabel, responsable };
    list = a? list.map(x=>x.id===a.id?data:x) : [...list, data];
    await DB.save(KEYS.aulas, list);
    // Si el aula ya tenía bienes registrados, actualizamos su nombre visible y responsable.
    const items = DB.get(KEYS.items).map(it=>it.aulaId===data.id?{...it, aulaNombre:aulaLabel, custodioNombre:responsable}:it);
    await DB.save(KEYS.items, items);
    toast('Aula guardada.','ok'); close(); renderContent();
  });
}

/* ---------------------------------------------------------------------
   12. CUSTODIOS (solo admin)
   --------------------------------------------------------------------- */
function renderCustodios(){
  const cs = DB.get(KEYS.custodios); const items = DB.get(KEYS.items);
  return `<div class="card"><div class="tbl-wrap"><table>
    <thead><tr><th>Nombre</th><th>Cargo</th><th>DNI</th><th>Aula principal</th><th class="num">Bienes a cargo</th><th></th></tr></thead>
    <tbody>${cs.map(c=>`<tr><td>${esc(c.nombre)}</td><td>${esc(c.cargo)}</td><td class="mono">${esc(c.dni||'—')}</td><td>${esc(c.aulaNombre||'—')}</td>
      <td class="num">${items.filter(i=>i.custodioId===c.id).length}</td>
      <td style="white-space:nowrap;"><button class="btn btn-sm btn-ghost" data-editcust="${c.id}">Editar</button><button class="btn btn-sm btn-danger" data-delcust="${c.id}">Eliminar</button></td>
    </tr>`).join('')}
    ${cs.length===0?'<tr><td colspan="6" class="empty"><div class="big">◎</div>Registra al personal responsable de los bienes.</td></tr>':''}
    </tbody></table></div></div>`;
}
function openCustodioModal(id){
  if(!isAdmin()){ toast('Solo un administrador puede gestionar responsables.','err'); return; }
  const cargosDisponibles = DB.get(KEYS.cargos);
  if(cargosDisponibles.length===0){
    toast('Registra primero al menos un cargo en "Cargos del personal" para poder elegirlo aquí.','err');
    return;
  }
  const cs = DB.get(KEYS.custodios); const aulas=DB.get(KEYS.aulas); const c = id?cs.find(x=>x.id===id):null;
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal" style="max-width:520px;">
    <div class="m-h"><h3>${c?'Editar responsable':'Nuevo responsable / custodio'}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="field"><label>Nombre completo *</label><input id="c_nombre" value="${esc(c?c.nombre:'')}"></div>
      <div class="grid g2"><div class="field"><label>Cargo *</label>
        <select id="c_cargo"><option value="">— Selecciona —</option>${cargosDisponibles.map(cg=>`<option value="${esc(cg)}" ${c&&c.cargo===cg?'selected':''}>${esc(cg)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>DNI</label><input id="c_dni" value="${esc(c?c.dni:'')}"></div></div>
      <div class="field"><label>Aula / ambiente principal</label><select id="c_aulaId"><option value="">— Ninguna —</option>${aulas.map(a=>`<option value="${a.id}" ${c&&c.aulaId===a.id?'selected':''}>${esc(a.aulaLabel||a.nombre)}</option>`).join('')}</select></div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Guardar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click',e=>{if(e.target===bg)close();});
  bg.querySelector('#save').addEventListener('click', async ()=>{
    const nombre=bg.querySelector('#c_nombre').value.trim(), cargo=bg.querySelector('#c_cargo').value.trim();
    if(!nombre||!cargo){toast('Completa nombre y cargo.','err');return;}
    const aulaId=bg.querySelector('#c_aulaId').value; const aula=aulas.find(a=>a.id===aulaId);
    const data={ id:c?c.id:uid('cust'), nombre, cargo, dni:bg.querySelector('#c_dni').value.trim(), aulaId, aulaNombre:aula?(aula.aulaLabel||aula.nombre):'' };
    let list=DB.get(KEYS.custodios);
    list = c? list.map(x=>x.id===c.id?data:x) : [...list, data];
    await DB.save(KEYS.custodios, list);
    toast('Responsable guardado.','ok'); close(); renderContent();
  });
}

/* ---------------------------------------------------------------------
   13. CATÁLOGO SBN (solo admin)
   --------------------------------------------------------------------- */
// Quita tildes/diéresis para que la búsqueda encuentre "ACRILICA" al escribir
// "ACRÍLICA" y viceversa (muy útil porque el catálogo oficial mezcla ambos).
function normalizaBusqueda(s){
  return (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
}
const CATALOGO_MAX_FILAS = 300; // límite de filas pintadas a la vez, por rendimiento
// Devuelve el catálogo filtrado según STATE.filtersCat.q (texto) y .grupo, cada
// ítem con su índice original (_idx) para que Editar/Eliminar sigan apuntando
// al registro correcto aunque la lista mostrada esté filtrada.
function catalogoFiltrado(){
  const cat = DB.get(KEYS.catalogo);
  const qn = normalizaBusqueda(STATE.filtersCat.q);
  const grupoF = STATE.filtersCat.grupo;
  let conIndice = cat.map((c,idx)=>({...c, _idx: idx}));
  if(grupoF) conIndice = conIndice.filter(c=>(c.grupo||'')===grupoF);
  const filtrado = qn ? conIndice.filter(c=>{
    const hay = normalizaBusqueda(c.codigoSBN) + ' ' + normalizaBusqueda(c.denominacion);
    return hay.includes(qn);
  }) : conIndice;
  return { total: cat.length, filtrado };
}
// Lista de Grupos Genéricos presentes en el catálogo actual, para el combo de
// filtro. Se recalcula cada vez (el catálogo puede cambiar tras editar/importar).
function catalogoGruposDisponibles(){
  const cat = DB.get(KEYS.catalogo);
  return [...new Set(cat.map(c=>c.grupo).filter(Boolean))].sort();
}
function catalogoFilasHTML(filtrado){
  return filtrado.slice(0, CATALOGO_MAX_FILAS).map(c=>`<tr><td class="mono">${esc(c.codigoSBN)}</td><td>${esc(c.denominacion)}</td>
    <td class="hint">${esc(c.grupo||'—')}${c.clase?' · '+esc(c.clase):''}</td>
    <td style="white-space:nowrap;"><button class="btn btn-sm btn-ghost" data-editcat="${c._idx}">Editar</button><button class="btn btn-sm btn-danger" data-delcat="${c._idx}">Eliminar</button></td></tr>`).join('');
}
function catalogoContadorHTML(total, cantFiltrada){
  const base = cantFiltrada===total ? cantFiltrada+' denominaciones en total' : cantFiltrada+' de '+total+' denominaciones';
  return cantFiltrada>CATALOGO_MAX_FILAS ? base+' (mostrando las primeras '+CATALOGO_MAX_FILAS+')' : base;
}
function renderCatalogo(){
  const { total, filtrado } = catalogoFiltrado();
  const f = STATE.filtersCat;
  const grupos = catalogoGruposDisponibles();
  return `<div class="note-banner">Estas denominaciones y códigos son una referencia editable. Verifícalos contra el Catálogo Único de Bienes Muebles del Estado (SBN/SIGA) antes de la presentación oficial del inventario.</div>
  <div class="card"><div class="card-b">
    <div class="toolbar">
      <input class="search" id="fcatq" placeholder="Buscar por código SBN o denominación (ej. COMPUTADORA, 43211501)…" value="${esc(f.q)}" autocomplete="off">
      <select id="fcatgrupo"><option value="">Todos los grupos genéricos</option>${grupos.map(g=>`<option value="${esc(g)}" ${f.grupo===g?'selected':''}>${esc(g)}</option>`).join('')}</select>
      ${(f.q||f.grupo)?'<button class="btn btn-sm" id="fcatclear">Limpiar filtros</button>':''}
      <span style="flex:1"></span>
      <span class="hint" id="catalogoCount">${catalogoContadorHTML(total, filtrado.length)}</span>
    </div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Código SBN</th><th>Denominación estandarizada</th><th>Grupo / Clase</th><th></th></tr></thead>
      <tbody id="catalogoTbody">${catalogoFilasHTML(filtrado)}</tbody>
    </table></div>
    <div class="toolbar" style="margin-top:12px; border-top:1px solid var(--line-soft); padding-top:12px;">
      <button class="btn btn-sm" id="btnExportarCatalogo">Exportar catálogo actual (.csv)</button>
      <button class="btn btn-sm btn-primary" id="btnImportarCatalogo">Importar catálogo desde Excel/CSV</button>
      <span class="hint">Útil cuando SBN publique una actualización del catálogo oficial: puedes cargarla aquí en vez de esperar a que se edite el código del sistema.</span>
    </div>
  </div></div>`;
}
// Actualiza solo la tabla y el contador del Catálogo SBN mientras el usuario
// escribe en el buscador, SIN volver a pintar el <input>: así el cursor y el
// foco del campo de búsqueda no se pierden en cada letra (a diferencia de un
// renderContent() completo, que reemplaza todo el HTML de la vista).
function actualizarTablaCatalogo(){
  const tbody = document.getElementById('catalogoTbody');
  const contador = document.getElementById('catalogoCount');
  const clearBtn = document.getElementById('fcatclear');
  if(!tbody) return;
  const { total, filtrado } = catalogoFiltrado();
  tbody.innerHTML = catalogoFilasHTML(filtrado);
  if(contador) contador.textContent = catalogoContadorHTML(total, filtrado.length);
  if(STATE.filtersCat.q && !clearBtn){
    // Si recién se escribió el primer carácter, el botón "Limpiar" aún no
    // existe en el DOM: lo agregamos sin tocar el input para no robarle el foco.
    const toolbar = document.querySelector('#fcatq')?.parentElement;
    if(toolbar){
      const btn = document.createElement('button');
      btn.className='btn btn-sm'; btn.id='fcatclear'; btn.textContent='Limpiar filtros';
      btn.addEventListener('click', ()=>{ STATE.filtersCat={q:'',grupo:''}; renderContent(); });
      document.getElementById('fcatq').insertAdjacentElement('afterend', btn);
    }
  } else if(!STATE.filtersCat.q && !STATE.filtersCat.grupo && clearBtn){
    clearBtn.remove();
  }
  wireBotonesCatalogo();
}
function wireBotonesCatalogo(){
  const c = document.getElementById('content'); if(!c) return;
  c.querySelectorAll('[data-editcat]').forEach(b=>b.addEventListener('click',()=>openCatModal(parseInt(b.dataset.editcat))));
  c.querySelectorAll('[data-delcat]').forEach(b=>b.addEventListener('click', async ()=>{
    const idx=parseInt(b.dataset.delcat);
    if(!confirm('¿Eliminar esta denominación del catálogo?')) return;
    const list=[...DB.get(KEYS.catalogo)]; list.splice(idx,1);
    await DB.save(KEYS.catalogo, list); toast('Eliminado.','ok');
    if(STATE.filtersCat.q) actualizarTablaCatalogo(); else renderContent();
  }));
}
function openCatModal(idx){
  if(!isAdmin()){ toast('Solo un administrador puede editar el catálogo SBN.','err'); return; }
  const cat = DB.get(KEYS.catalogo); const c = (idx!==null&&idx!==undefined)?cat[idx]:null;
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal" style="max-width:460px;">
    <div class="m-h"><h3>${c?'Editar denominación':'Nueva denominación SBN'}</h3><button class="close-x">&times;</button></div>
    <div class="m-b"><div class="field"><label>Código SBN *</label><input id="k_codigo" value="${esc(c?c.codigoSBN:'')}"></div>
    <div class="field"><label>Denominación *</label><input id="k_denom" value="${esc(c?c.denominacion:'')}"></div>
    <div class="grid g2">
      <div class="field"><label>Grupo genérico</label><input id="k_grupo" value="${esc(c&&c.grupo?c.grupo:'')}" placeholder="Opcional, ej. 74: OFICINA"></div>
      <div class="field"><label>Clase</label><input id="k_clase" value="${esc(c&&c.clase?c.clase:'')}" placeholder="Opcional, ej. 17: EQUIPO"></div>
    </div></div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Guardar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click',e=>{if(e.target===bg)close();});
  bg.querySelector('#save').addEventListener('click', async ()=>{
    const codigoSBN=bg.querySelector('#k_codigo').value.trim(), denominacion=bg.querySelector('#k_denom').value.trim().toUpperCase();
    const grupo=bg.querySelector('#k_grupo').value.trim(), clase=bg.querySelector('#k_clase').value.trim();
    if(!codigoSBN||!denominacion){toast('Completa código y denominación.','err');return;}
    let list=[...DB.get(KEYS.catalogo)];
    const nuevo={codigoSBN,denominacion,grupo,clase};
    if(c!==null && idx!==undefined && cat[idx]){ list[idx]=nuevo; } else { list.push(nuevo); }
    await DB.save(KEYS.catalogo, list);
    toast('Catálogo actualizado.','ok'); close(); renderContent();
  });
}

/* ---------------------------------------------------------------------
   13-B. CARGOS DEL PERSONAL (solo admin) — alimenta el combo "Cargo" en
   Nuevo responsable / custodio y en Nuevo préstamo.
   --------------------------------------------------------------------- */
function renderCargos(){
  const cargos = DB.get(KEYS.cargos);
  const custodios = DB.get(KEYS.custodios);
  return `<div class="note-banner">Estos son los cargos que aparecerán en el combo al registrar un responsable/custodio o un préstamo. Agrega aquí los que falten en tu institución.</div>
  <div class="card"><div class="tbl-wrap"><table>
    <thead><tr><th>Cargo</th><th class="num">Personal con este cargo</th><th></th></tr></thead>
    <tbody>${cargos.map((cg,idx)=>`<tr><td>${esc(cg)}</td>
      <td class="num">${custodios.filter(c=>c.cargo===cg).length}</td>
      <td style="white-space:nowrap;"><button class="btn btn-sm btn-ghost" data-editcargo="${idx}">Editar</button><button class="btn btn-sm btn-danger" data-delcargo="${idx}">Eliminar</button></td></tr>`).join('')}
    ${cargos.length===0?'<tr><td colspan="3" class="empty"><div class="big">⚏</div>Aún no hay cargos registrados.</td></tr>':''}
    </tbody></table></div></div>`;
}
function openCargoModal(idx){
  if(!isAdmin()){ toast('Solo un administrador puede gestionar los cargos.','err'); return; }
  const cargos = DB.get(KEYS.cargos); const valorActual = (idx!==null&&idx!==undefined)?cargos[idx]:'';
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal" style="max-width:420px;">
    <div class="m-h"><h3>${valorActual?'Editar cargo':'Nuevo cargo'}</h3><button class="close-x">&times;</button></div>
    <div class="m-b"><div class="field"><label>Nombre del cargo *</label><input id="cg_nombre" value="${esc(valorActual)}" placeholder="Ej. Docente de Secundaria"></div></div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Guardar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click',e=>{if(e.target===bg)close();});
  bg.querySelector('#save').addEventListener('click', async ()=>{
    const nombre=bg.querySelector('#cg_nombre').value.trim();
    if(!nombre){ toast('Escribe el nombre del cargo.','err'); return; }
    let list=[...DB.get(KEYS.cargos)];
    const dup = list.some((cg,i)=>cg.toLowerCase()===nombre.toLowerCase() && i!==idx);
    if(dup){ toast('Ese cargo ya existe.','err'); return; }
    if(idx!==null && idx!==undefined && list[idx]!==undefined){
      const anterior = list[idx]; list[idx]=nombre;
      // Si se renombra un cargo, actualizamos también a quienes ya lo tenían asignado.
      if(anterior!==nombre){ await DB.save(KEYS.custodios, DB.get(KEYS.custodios).map(c=>c.cargo===anterior?{...c,cargo:nombre}:c)); }
    } else { list.push(nombre); }
    await DB.save(KEYS.cargos, list);
    toast('Cargo guardado.','ok'); close(); renderContent();
  });
}

/* ---------------------------------------------------------------------
   13-B2. COMISIÓN DE INVENTARIO (solo admin) — catálogo de integrantes
   habituales (nombre + cargo en la comisión) para no volver a tipearlos
   cada vez que se genera un Acta de Toma de Inventario u otra acta que
   requiera firmas de comisión. Cada integrante puede marcarse "Activo"
   para que aparezca preseleccionado al generar una nueva acta, sin
   necesidad de borrarlo del catálogo si solo está de licencia temporal.
   --------------------------------------------------------------------- */
function renderComision(){
  const comision = DB.get(KEYS.comision);
  return `<div class="note-banner">Registra aquí a quienes suelen integrar la Comisión de Inventario (o de Baja, Conciliación, etc.) para elegirlos con un clic al generar un acta, en vez de escribir sus nombres cada vez. Desmarca "Activo" para alguien que ya no participa, sin perder su registro histórico.</div>
  <div class="card"><div class="tbl-wrap"><table>
    <thead><tr><th>Nombre</th><th>Cargo en la comisión</th><th>Activo</th><th></th></tr></thead>
    <tbody>${comision.map((p,idx)=>`<tr>
      <td>${esc(p.nombre)}</td>
      <td>${esc(p.cargo||'—')}</td>
      <td><label class="switch-mini"><input type="checkbox" data-toggleactivocomision="${idx}" ${p.activo!==false?'checked':''}></label></td>
      <td style="white-space:nowrap;"><button class="btn btn-sm btn-ghost" data-editcomision="${idx}">Editar</button><button class="btn btn-sm btn-danger" data-delcomision="${idx}">Eliminar</button></td></tr>`).join('')}
    ${comision.length===0?'<tr><td colspan="4" class="empty"><div class="big">👥</div>Aún no hay integrantes registrados en el catálogo de Comisión de Inventario.</td></tr>':''}
    </tbody></table></div></div>`;
}
function openComisionModal(idx){
  if(!isAdmin()){ toast('Solo un administrador puede gestionar la Comisión de Inventario.','err'); return; }
  const comision = DB.get(KEYS.comision);
  const actual = (idx!==null&&idx!==undefined)?comision[idx]:null;
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal" style="max-width:460px;">
    <div class="m-h"><h3>${actual?'Editar integrante':'Nuevo integrante de la Comisión'}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="field"><label>Nombre completo *</label><input id="co_nombre" value="${esc(actual?.nombre||'')}" placeholder="Ej. Juan Pérez Ramos"></div>
      <div class="field"><label>Cargo en la comisión *</label><input id="co_cargo" value="${esc(actual?.cargo||'')}" placeholder="Ej. Presidente, Secretario(a), Miembro"></div>
      <div class="field"><label><input type="checkbox" id="co_activo" ${actual?.activo!==false?'checked':''}> Activo (aparece preseleccionado al generar una nueva acta)</label></div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Guardar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click',e=>{if(e.target===bg)close();});
  bg.querySelector('#save').addEventListener('click', async ()=>{
    const nombre=bg.querySelector('#co_nombre').value.trim();
    const cargo=bg.querySelector('#co_cargo').value.trim();
    const activo=bg.querySelector('#co_activo').checked;
    if(!nombre||!cargo){ toast('Completa nombre y cargo.','err'); return; }
    let list=[...DB.get(KEYS.comision)];
    const nuevo = {id: actual?.id || ('com_'+Date.now()+'_'+Math.random().toString(36).slice(2,7)), nombre, cargo, activo};
    if(idx!==null && idx!==undefined && list[idx]!==undefined){ list[idx]=nuevo; } else { list.push(nuevo); }
    await DB.save(KEYS.comision, list);
    toast('Integrante guardado.','ok'); close(); renderContent();
  });
}

/* ---------------------------------------------------------------------
   13-C. VIDA ÚTIL / CATEGORÍAS DE DEPRECIACIÓN (solo admin) — tabla usada
   para el cálculo de depreciación por línea recta (NICSP). Son valores
   referenciales editables: cada IE debe ajustarlos a la directiva contable
   vigente de su entidad.
   --------------------------------------------------------------------- */
function renderCategoriasDeprec(){
  const cats = DB.get(KEYS.categoriasDeprec);
  const items = DB.get(KEYS.items);
  return `<div class="note-banner">Estos años de vida útil se usan para calcular la depreciación de los bienes por el método de línea recta (NICSP), a partir de su fecha de registro. Son valores referenciales: verifícalos contra la directiva contable vigente de tu entidad y ajústalos aquí si corresponde.</div>
  <div class="card"><div class="tbl-wrap"><table>
    <thead><tr><th>Categoría</th><th class="num">Vida útil</th><th class="num">Bienes con esta categoría</th><th></th></tr></thead>
    <tbody>${cats.map((c,idx)=>`<tr><td>${esc(c.nombre)}</td>
      <td class="num">${c.vidaUtilAnios} año(s)</td>
      <td class="num">${items.filter(i=>i.categoriaDeprecId===c.id).length}</td>
      <td style="white-space:nowrap;"><button class="btn btn-sm btn-ghost" data-editcatdep="${idx}">Editar</button>${c.id!=='otros'?`<button class="btn btn-sm btn-danger" data-delcatdep="${idx}">Eliminar</button>`:''}</td></tr>`).join('')}
    ${cats.length===0?'<tr><td colspan="4" class="empty"><div class="big">▽</div>Aún no hay categorías registradas.</td></tr>':''}
    </tbody></table></div></div>`;
}
function openCategoriaDeprecModal(idx){
  if(!isAdmin()){ toast('Solo un administrador puede gestionar la vida útil.','err'); return; }
  const cats = DB.get(KEYS.categoriasDeprec); const actual = (idx!==null&&idx!==undefined)?cats[idx]:null;
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal" style="max-width:460px;">
    <div class="m-h"><h3>${actual?'Editar categoría':'Nueva categoría de depreciación'}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="field"><label>Nombre de la categoría *</label><input id="cd_nombre" value="${esc(actual?actual.nombre:'')}" placeholder="Ej. Equipos de cómputo"></div>
      <div class="field"><label>Vida útil (años) *</label><input id="cd_vidaUtil" type="number" min="1" step="1" value="${actual?actual.vidaUtilAnios:''}" placeholder="Ej. 4"></div>
      <div class="hint">Los bienes ya registrados con esta categoría recalculan su depreciación automáticamente al cambiar este valor.</div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Guardar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click',e=>{if(e.target===bg)close();});
  bg.querySelector('#save').addEventListener('click', async ()=>{
    const nombre = bg.querySelector('#cd_nombre').value.trim();
    const vidaUtilAnios = Number(bg.querySelector('#cd_vidaUtil').value);
    if(!nombre || !vidaUtilAnios || vidaUtilAnios<=0){ toast('Completa el nombre y una vida útil válida (mayor a 0).','err'); return; }
    let list = [...DB.get(KEYS.categoriasDeprec)];
    if(actual){ list[idx] = {...actual, nombre, vidaUtilAnios}; }
    else{ list.push({ id: uid('catdep'), nombre, vidaUtilAnios, palabras:[] }); }
    await DB.save(KEYS.categoriasDeprec, list);
    toast('Categoría guardada.','ok'); close(); renderContent();
  });
}

/* ---------------------------------------------------------------------
   14. GENERADOR DE QR
   --------------------------------------------------------------------- */
function renderQrLab(){
  const items = scopedItems(); const aulas = scopedAulas();
  return `<div class="card noprint" style="margin-bottom:16px;"><div class="card-b">
    <div class="toolbar">
      <select id="qr_tipo">
        <option value="qr" ${STATE.qrTipoEtiqueta==='qr'?'selected':''}>Código QR (ficha completa del bien)</option>
        <option value="barcode" ${STATE.qrTipoEtiqueta==='barcode'?'selected':''}>Código de barras (Code128, solo código patrimonial)</option>
      </select>
      <select id="qr_aula"><option value="">Todas las aulas</option>${aulas.map(a=>`<option value="${a.id}">${esc(a.aulaLabel||a.nombre)}</option>`).join('')}</select>
      <input id="qr_buscar" placeholder="Buscar por código, denominación, marca, modelo, serie o color…" style="flex:1;min-width:200px;">
      <button class="btn btn-sm" id="qr_selectall">Seleccionar todos</button>
      <button class="btn btn-sm" id="qr_clear">Limpiar selección</button>
      <span style="flex:1"></span><span class="hint" id="qr_count">0 etiquetas seleccionadas</span>
      <button class="btn btn-primary" id="qr_print">Imprimir hoja de etiquetas</button>
    </div>
    <div class="hint">Cada etiqueta incluye: logo y nombre de la IE, año, aula, código patrimonial y denominación SBN — según la Directiva 001-2015/SBN sobre etiquetado de bienes muebles. El código de barras es útil si ya cuentas con un lector físico (pistola) en control patrimonial; el QR sirve para leer la ficha completa con la cámara de un celular.</div>
  </div></div>
  <div class="tbl-wrap card noprint"><table>
    <thead><tr><th style="width:34px;"></th><th>Código</th><th>Denominación</th><th>Marca</th><th>Modelo</th><th>N° Serie</th><th>Color</th><th>Estado</th><th>Aula</th></tr></thead>
    <tbody id="qr_bienes_tbody">${items.map(i=>{
      const buscable = (i.codigoInterno+' '+i.denominacion+' '+(i.marca||'')+' '+(i.modelo||'')+' '+(i.numeroSerie||'')+' '+(i.color||'')).toLowerCase();
      return `<tr data-aula="${esc(i.aulaId)}" data-search="${esc(buscable)}"><td><input type="checkbox" class="qrchk" data-id="${i.id}" data-aula="${esc(i.aulaId)}"></td>
      <td class="mono">${esc(i.codigoInterno)}</td><td>${esc(i.denominacion)}</td>
      <td>${esc(i.marca||'—')}</td><td>${esc(i.modelo||'—')}</td><td class="mono">${esc(i.numeroSerie||'—')}</td><td>${esc(i.color||'—')}</td>
      <td>${estadoBadge(i.estadoConservacion)}</td><td>${esc(i.aulaNombre||'—')}</td></tr>`;
    }).join('')}
      ${items.length===0?'<tr><td colspan="9" class="empty">Registra bienes primero para poder generar sus códigos QR.</td></tr>':''}
    </tbody></table></div>
  <div id="qr_preview_wrap" style="margin-top:18px;"></div>`;
}
function drawLabel(canvas, item, cfg){
  const ctx = canvas.getContext('2d'); const W=560, H=280; canvas.width=W; canvas.height=H;
  ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='#33404a'; ctx.lineWidth=2; ctx.strokeRect(1,1,W-2,H-2);
  ctx.strokeStyle='#c7ccd1'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(W-172,8); ctx.lineTo(W-172,H-8); ctx.stroke();
  const contentW = W-190; // ancho disponible a la izquierda del QR
  let y=26;
  ctx.fillStyle='#14304d'; ctx.font='700 15px "IBM Plex Sans", sans-serif';
  const _logoDrawUrl = logoDeConfig(cfg);
  wrapText(ctx, cfg.nombreIE||'INSTITUCIÓN EDUCATIVA', _logoDrawUrl?68:16, y, W-190-(_logoDrawUrl?68:16), 17, 2);
  ctx.fillStyle='#556270'; ctx.font='500 10.5px "IBM Plex Sans", sans-serif';
  ctx.fillText(`Año ${cfg.anioFiscal}  ·  UGEL ${cfg.ugel||'—'}`, _logoDrawUrl?68:16, 60);
  ctx.fillStyle='#8c1023'; ctx.font='700 15px "IBM Plex Mono", monospace';
  ctx.fillText(item.codigoInterno, 16, 88);
  // Código interno propio del colegio (uso exclusivo de la IE), en línea aparte
  // y bien visible justo debajo del código patrimonial oficial.
  ctx.fillStyle='#14304d'; ctx.font='700 12.5px "IBM Plex Mono", monospace';
  ctx.fillText('Cód. interno IE: '+ (item.codigoUsoInterno || '—'), 16, 104);
  ctx.fillStyle='#111'; ctx.font='700 12.5px "IBM Plex Sans", sans-serif';
  wrapText(ctx, item.denominacion, 16, 124, contentW, 15, 2);
  // Detalle del equipo: marca/modelo y N° de serie, resaltados en un color
  // distinto y con letra más grande porque son los datos que más ayudan a
  // identificar el bien exacto (no solo el tipo) al mirar la etiqueta física,
  // y el ancho de la etiqueta permite un poco más de tamaño sin desbordar.
  ctx.fillStyle='#0b6e4f'; ctx.font='700 12.5px "IBM Plex Sans", sans-serif';
  const marcaModelo = [item.marca, item.modelo].filter(Boolean).join(' / ');
  ctx.fillText('Marca/Modelo: '+ (marcaModelo || '—'), 16, 163);
  ctx.font='700 12.5px "IBM Plex Mono", monospace';
  ctx.fillText('N° de Serie: '+ (item.numeroSerie || '—'), 16, 182);
  ctx.fillStyle='#444'; ctx.font='500 10.5px "IBM Plex Sans", sans-serif';
  ctx.fillText('Cód. SBN: '+ (item.codigoSBN||'—'), 16, 201);
  // Aula también resaltada (color ámbar), porque es el dato clave para ubicar
  // físicamente dónde debería estar el bien durante la toma de inventario.
  ctx.fillStyle='#a15c00'; ctx.font='700 12.5px "IBM Plex Sans", sans-serif';
  ctx.fillText('Aula: '+ (item.aulaNombre||'—'), 16, 217);
  ctx.fillStyle='#444'; ctx.font='500 10.5px "IBM Plex Sans", sans-serif';
  ctx.fillText('Color: '+ (item.color||'—') + '   ·   Estado: '+ (ESTADO_ABREV[item.estadoConservacion]||item.estadoConservacion||'—'), 16, 233);
  ctx.fillText('Bien patrimonial del Estado — prohibido su retiro sin autorización', 16, H-14);
  return ctx;
}
function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines){
  const words=(text||'').split(' '); let line=''; let ln=0;
  for(let n=0;n<words.length;n++){
    const test=line+words[n]+' ';
    if(ctx.measureText(test).width>maxWidth && n>0){
      ctx.fillText(line, x, y); line=words[n]+' '; y+=lineHeight; ln++;
      if(ln>=maxLines){ return; }
    } else { line=test; }
  }
  ctx.fillText(line, x, y);
}
// qrcode-generator dibuja el código QR con puro cálculo (sin <canvas>, sin
// <img>, sin tocar el DOM): es 100% síncrono e inmediato, así que no hay
// ninguna espera que se pueda "quedar colgada" como pasaba con la librería
// anterior. Se activa la codificación UTF-8 para que tildes y "ñ" del texto
// del QR (nombre de la IE, denominación, etc.) se lean bien al escanear.
if(typeof qrcode!=='undefined' && qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']){
  qrcode.stringToBytesFuncs.default = qrcode.stringToBytesFuncs['UTF-8'];
}
function makeQrDataUrl(text){
  try{
    const qr = qrcode(0, 'M'); // 0 = elige automáticamente el tamaño mínimo que entra el texto
    qr.addData(text);
    qr.make();
    return qr.createDataURL(6, 8);
  }catch(err){
    console.error('No se pudo generar el código QR:', err);
    return null;
  }
}
/* ---------------------------------------------------------------------
   16-Z. VERIFICACIÓN DE ACTAS (hash + QR) — al generar un acta formal
   (préstamo, toma de inventario, expediente de baja, conciliación) se
   calcula un hash SHA-256 del contenido que se está imprimiendo y se
   guarda un registro local con fecha, usuario y un resumen legible. El
   documento impreso lleva un QR + código corto con ese hash; cualquiera
   con acceso al sistema puede luego ir a "Verificar acta" y comprobar
   que el papel que tiene en la mano coincide con lo que quedó grabado
   en el sistema al momento de emitirse. Esto NO es una firma electrónica
   con validez legal externa (no involucra una entidad certificadora ni
   al RENIEC/PKI del Estado): es un sello de integridad interno, pensado
   para detectar si un acta impresa fue alterada después de emitida.
   --------------------------------------------------------------------- */
async function registrarActaFirmada(tipo, datosCanonicos, resumen, refId){
  const hash = await sha256Hex(JSON.stringify(datosCanonicos));
  const record = {
    id: uid('acta'), tipo, refId: refId||null,
    fecha: new Date().toISOString(),
    generadoPor: (STATE.session && (STATE.session.nombre||STATE.session.usuario)) || '—',
    resumen: resumen||'', hash
  };
  const list = [...DB.get(KEYS.actasFirmadas), record];
  await DB.save(KEYS.actasFirmadas, list);
  return record;
}
function codigoVerifCorto(record){ return record.hash.slice(0,16).toUpperCase(); }
function bloqueVerificacionHTML(record){
  if(!record) return '';
  const payload = `SIGIE-VERIF|${record.id}|${record.hash.slice(0,16)}`;
  const qrUrl = makeQrDataUrl(payload);
  return `<div class="noprint-verif" style="margin-top:14px;border-top:1px dashed #999;padding-top:8px;display:flex;align-items:center;gap:10px;">
    ${qrUrl?`<img src="${qrUrl}" style="width:64px;height:64px;flex:0 0 64px;">`:''}
    <div style="font-size:8.5px;color:#555;line-height:1.35;">
      <b>Código de verificación:</b> ${esc(codigoVerifCorto(record))}<br>
      Generado el ${esc(new Date(record.fecha).toLocaleString('es-PE'))} por ${esc(record.generadoPor)}.<br>
      Este código permite comprobar en el propio sistema SIGIE (menú "Verificar acta") que este documento no ha sido alterado desde su emisión. No constituye una firma electrónica con validez legal externa.
    </div>
  </div>`;
}
function parseCodigoVerificacion(raw){
  raw = (raw||'').trim();
  const m = raw.match(/SIGIE-VERIF\|([^|]+)\|([0-9a-fA-F]+)/i);
  if(m) return { id:m[1], codigo:m[2].toUpperCase() };
  // Si pegan solo el código corto mostrado en el acta (sin el ID), se busca por coincidencia de hash.
  return { id:null, codigo: raw.replace(/\s+/g,'').toUpperCase() };
}
function buscarActaFirmadaPorCodigo(raw){
  const { id, codigo } = parseCodigoVerificacion(raw);
  const lista = DB.get(KEYS.actasFirmadas);
  let record = id ? lista.find(r=>r.id===id) : null;
  if(!record && codigo) record = lista.find(r=>codigoVerifCorto(r)===codigo || r.hash.toUpperCase().startsWith(codigo));
  if(!record) return { estado:'no_encontrado' };
  const coincide = codigo ? (codigoVerifCorto(record)===codigo || record.hash.toUpperCase().startsWith(codigo)) : true;
  return { estado: coincide?'ok':'no_coincide', record };
}
function renderVerificarActa(){
  return `<div class="note-banner">Escanea o pega el código de verificación impreso al pie de un Acta de Préstamo, Acta de Toma de Inventario, Expediente de Baja o Acta de Conciliación, para comprobar que el documento coincide con lo registrado en el sistema al momento de emitirse.</div>
  <div class="card"><div class="card-b">
    <div class="field"><label>Código de verificación</label><input id="va_codigo" placeholder="Pega aquí el código impreso, ej. A1B2C3D4E5F60708"></div>
    <button class="btn btn-primary btn-sm" id="va_verificar">Verificar</button>
    <button class="btn btn-sm" id="va_escanear" style="margin-left:6px;">📷 Escanear QR del acta</button>
    <div id="va_resultado" style="margin-top:14px;"></div>
  </div></div>`;
}
function pintarResultadoVerificacion(resultado){
  const el = document.getElementById('va_resultado'); if(!el) return;
  if(resultado.estado==='no_encontrado'){
    el.innerHTML = `<div class="note-banner" style="border-color:#c0392b;color:#c0392b;">❌ No se encontró ningún acta con ese código en este sistema. Puede que el código esté mal escrito, o que el acta se haya generado en otra instalación/copia de SIGIE.</div>`;
  } else if(resultado.estado==='no_coincide'){
    const r = resultado.record;
    el.innerHTML = `<div class="note-banner" style="border-color:#c0392b;color:#c0392b;">⚠️ Se encontró un acta con ese identificador (<b>${esc(r.tipo)}</b>, generada el ${esc(new Date(r.fecha).toLocaleString('es-PE'))}), pero el código no coincide exactamente. Revisa que lo hayas copiado completo — si el código impreso es correcto y aun así no coincide, el documento podría haber sido alterado después de emitido.</div>`;
  } else {
    const r = resultado.record;
    el.innerHTML = `<div class="note-banner" style="border-color:#1e8449;color:#1e8449;">✅ Verificado: este código coincide con el registro interno del sistema.<br>
      <b>Tipo de documento:</b> ${esc(r.tipo)}<br>
      <b>Generado el:</b> ${esc(new Date(r.fecha).toLocaleString('es-PE'))} por ${esc(r.generadoPor)}<br>
      ${r.resumen?('<b>Detalle:</b> '+esc(r.resumen)):''}</div>`;
  }
}
function abrirEscanerVerificacionActa(){
  if(typeof QrScanner==='undefined'){ toast('No se pudo cargar el lector de QR. Verifica tu conexión a internet e inténtalo de nuevo.', 'err'); return; }
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML = `<div class="modal" style="max-width:420px;">
    <div class="m-h"><h3>Escanear QR del acta</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <video id="qrVideoActa" playsinline style="width:100%;border-radius:8px;background:#000;display:block;"></video>
      <div class="hint" id="qrScanHintActa" style="margin-top:10px;">Apunta la cámara al código QR impreso al pie del acta.</div>
    </div>
  </div>`;
  document.body.appendChild(bg);
  const videoEl = bg.querySelector('#qrVideoActa');
  const hint = bg.querySelector('#qrScanHintActa');
  let scanner = null;
  const close=()=>{ if(scanner){ try{scanner.stop();}catch(e){} try{scanner.destroy();}catch(e){} scanner=null; } bg.remove(); };
  bg.querySelector('.close-x').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  try{ QrScanner.WORKER_PATH = 'https://cdnjs.cloudflare.com/ajax/libs/qr-scanner/1.4.2/qr-scanner-worker.min.js'; }catch(e){}
  scanner = new QrScanner(videoEl, result=>{
    const texto = (typeof result==='string') ? result : (result && result.data) || '';
    if(!texto || !/SIGIE-VERIF/i.test(texto)) return;
    hint.textContent = '✓ Código leído — verificando…';
    close();
    const codInput = document.getElementById('va_codigo');
    if(codInput) codInput.value = texto;
    pintarResultadoVerificacion(buscarActaFirmadaPorCodigo(texto));
  }, { highlightScanRegion:true, highlightCodeOutline:true, preferredCamera:'environment' });
  scanner.start().catch(err=>{
    hint.textContent = 'No se pudo acceder a la cámara ('+((err&&err.message)||err)+'). Revisa que el navegador tenga permiso de cámara y que estés usando https o localhost.';
  });
}

/* ---------------------------------------------------------------------
   16-Y. ALMACÉN DE BIENES FUNGIBLES / CONSUMIBLES — papel, tóner, útiles
   de limpieza, materiales de laboratorio, etc. Es un módulo aparte del
   patrimonio de activo fijo (los bienes de "Inventario > Bienes
   patrimoniales" no se consumen ni pasan por acá): aquí solo se lleva un
   catálogo con stock actual/mínimo, y un kardex de entradas y salidas.
   --------------------------------------------------------------------- */
const CATEGORIAS_CONSUMIBLE = ['Papelería','Limpieza','Laboratorio','Cómputo','Salud/Botiquín','Otro'];
function consumibleEstaBajo(c){ return Number(c.stockActual)<=Number(c.stockMinimo); }
function renderAlmacen(){
  const f = STATE.filtersConsumible;
  let lista = [...(DB.get(KEYS.consumibles)||[])].sort((a,b)=>a.nombre.localeCompare(b.nombre));
  const nBajos = lista.filter(consumibleEstaBajo).length;
  lista = lista.filter(c=>{
    if(f.q){ const hay=(c.nombre+' '+(c.categoria||'')+' '+(c.ubicacion||'')).toLowerCase(); if(!hay.includes(f.q.toLowerCase())) return false; }
    if(f.categoria && c.categoria!==f.categoria) return false;
    if(f.soloBajos && !consumibleEstaBajo(c)) return false;
    return true;
  });
  return `
  ${nBajos>0?`<div class="note-banner" style="background:var(--warn-soft,#fff3cd);border-color:#e6d3a3;color:#8a6d1a;">📦 <b>${nBajos}</b> consumible(s) están en o por debajo de su stock mínimo.</div>`:''}
  <div class="card"><div class="card-b" style="padding-bottom:0;">
    <div class="grid g3">
      <input class="search" id="cfq" placeholder="Buscar por nombre, categoría o ubicación…" value="${esc(f.q)}">
      <select id="cfcategoria"><option value="">— Todas las categorías —</option>${CATEGORIAS_CONSUMIBLE.map(cat=>`<option value="${esc(cat)}" ${f.categoria===cat?'selected':''}>${esc(cat)}</option>`).join('')}</select>
      <label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="cfbajos" ${f.soloBajos?'checked':''}> Solo stock bajo</label>
    </div>
    <div style="margin:8px 0 4px;"><button class="btn btn-sm" id="cfclear">Limpiar filtros</button></div>
  </div></div>
  <div class="tbl-wrap"><table>
    <thead><tr><th>Nombre</th><th>Categoría</th><th>Unidad</th><th>Stock actual</th><th>Stock mínimo</th><th>Ubicación</th><th></th></tr></thead>
    <tbody>${lista.map(c=>`<tr>
      <td>${esc(c.nombre)}</td><td>${esc(c.categoria||'—')}</td><td>${esc(c.unidad)}</td>
      <td class="num">${Number(c.stockActual)} ${consumibleEstaBajo(c)?'<span class="badge badge-bad">Bajo</span>':''}</td>
      <td class="num">${Number(c.stockMinimo)}</td><td>${esc(c.ubicacion||'—')}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-sm btn-ghost" data-entradacons="${c.id}">Entrada</button>
        <button class="btn btn-sm btn-ghost" data-salidacons="${c.id}">Salida</button>
        <button class="btn btn-sm btn-ghost" data-kardexcons="${c.id}">Kardex</button>
        ${isAdmin()?`<button class="btn btn-sm btn-ghost" data-editcons="${c.id}">Editar</button><button class="btn btn-sm btn-danger" data-delcons="${c.id}">Eliminar</button>`:''}
      </td></tr>`).join('')}
    ${lista.length===0?'<tr><td colspan="7" class="empty"><div class="big">📦</div>Aún no hay consumibles registrados en el almacén.</td></tr>':''}
    </tbody></table></div>`;
}
function abrirModalConsumible(id){
  if(!isAdmin()){ toast('Solo un administrador puede gestionar el catálogo de consumibles.','err'); return; }
  const c = id ? (DB.get(KEYS.consumibles)||[]).find(x=>x.id===id) : null;
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal" style="max-width:460px;">
    <div class="m-h"><h3>${c?'Editar consumible':'Nuevo consumible'}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="field"><label>Nombre *</label><input id="co_nombre" value="${esc(c?.nombre||'')}" placeholder="Ej. Papel bond A4, Tóner HP 85A, Lejía"></div>
      <div class="grid g2">
        <div class="field"><label>Categoría</label><select id="co_categoria">${CATEGORIAS_CONSUMIBLE.map(cat=>`<option value="${esc(cat)}" ${c?.categoria===cat?'selected':''}>${esc(cat)}</option>`).join('')}</select></div>
        <div class="field"><label>Unidad de medida *</label><input id="co_unidad" value="${esc(c?.unidad||'')}" placeholder="Ej. unidad, caja, galón, paquete"></div>
      </div>
      <div class="grid g2">
        <div class="field"><label>Stock ${c?'actual':'inicial'}</label><input id="co_stock" type="number" min="0" step="0.01" value="${c?Number(c.stockActual):0}" ${c?'disabled':''}></div>
        <div class="field"><label>Stock mínimo (alerta)</label><input id="co_stockmin" type="number" min="0" step="0.01" value="${c?Number(c.stockMinimo):0}"></div>
      </div>
      ${c?'<div class="hint">Para ajustar el stock actual, usa "Entrada" o "Salida" — así queda registrado en el kardex.</div>':''}
      <div class="field"><label>Ubicación (opcional)</label><input id="co_ubicacion" value="${esc(c?.ubicacion||'')}" placeholder="Ej. Almacén general, Depósito de limpieza"></div>
      <div class="field"><label>Observaciones (opcional)</label><textarea id="co_obs" rows="2">${esc(c?.observaciones||'')}</textarea></div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Guardar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  bg.querySelector('#save').addEventListener('click', async ()=>{
    const nombre = bg.querySelector('#co_nombre').value.trim();
    const unidad = bg.querySelector('#co_unidad').value.trim();
    if(!nombre||!unidad){ toast('Completa el nombre y la unidad de medida.','err'); return; }
    const categoria = bg.querySelector('#co_categoria').value;
    const stockMinimo = Number(bg.querySelector('#co_stockmin').value)||0;
    const ubicacion = bg.querySelector('#co_ubicacion').value.trim();
    const observaciones = bg.querySelector('#co_obs').value.trim();
    let list = [...(DB.get(KEYS.consumibles)||[])];
    if(c){
      list = list.map(x=>x.id===c.id?{...x, nombre, categoria, unidad, stockMinimo, ubicacion, observaciones}:x);
    } else {
      const stockActual = Number(bg.querySelector('#co_stock').value)||0;
      const nuevo = { id: uid('cons'), nombre, categoria, unidad, stockActual, stockMinimo, ubicacion, observaciones };
      list = [...list, nuevo];
      if(stockActual>0){
        const movs = [...(DB.get(KEYS.movsConsumibles)||[]), { id:uid('movc'), consumibleId:nuevo.id, tipo:'Entrada', cantidad:stockActual, fecha:today(), motivo:'Stock inicial al crear el consumible', registradoPor:currentUser().usuario, saldoResultante:stockActual }];
        await DB.save(KEYS.movsConsumibles, movs);
      }
    }
    await DB.save(KEYS.consumibles, list);
    toast('Consumible guardado.','ok'); close(); renderContent();
  });
}
async function eliminarConsumible(id){
  if(!isAdmin()) return;
  if(!confirm('¿Eliminar este consumible del catálogo? Se perderá también su historial de kardex. Esta acción no se puede deshacer.')) return;
  const list = (DB.get(KEYS.consumibles)||[]).filter(x=>x.id!==id);
  await DB.save(KEYS.consumibles, list);
  const movs = (DB.get(KEYS.movsConsumibles)||[]).filter(m=>m.consumibleId!==id);
  await DB.save(KEYS.movsConsumibles, movs);
  toast('Consumible eliminado.','ok'); renderContent();
}
function abrirModalMovimientoConsumible(id, tipo){
  if(!guardEdit()) return;
  const c = (DB.get(KEYS.consumibles)||[]).find(x=>x.id===id); if(!c) return;
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal" style="max-width:440px;">
    <div class="m-h"><h3>${tipo==='Entrada'?'Registrar entrada':'Registrar salida'} — ${esc(c.nombre)}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="hint" style="margin-bottom:8px;">Stock actual: <b>${Number(c.stockActual)} ${esc(c.unidad)}</b></div>
      <div class="grid g2">
        <div class="field"><label>Cantidad *</label><input id="mc_cant" type="number" min="0.01" step="0.01" ${tipo==='Salida'?('max="'+Number(c.stockActual)+'"'):''}></div>
        <div class="field"><label>Fecha</label><input id="mc_fecha" type="date" value="${today()}"></div>
      </div>
      <div class="field"><label>${tipo==='Entrada'?'Proveedor / procedencia (ej. N° de guía o compra)':'Área, aula o persona que retira'}</label><input id="mc_motivo" placeholder="${tipo==='Entrada'?'Ej. Compra directa, Requerimiento REQ-2026-003':'Ej. Aula 3° B — Prof. Ana Quispe'}"></div>
      <div class="field"><label>Observación (opcional)</label><input id="mc_obs"></div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Guardar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  bg.querySelector('#save').addEventListener('click', async ()=>{
    const cantidad = Number(bg.querySelector('#mc_cant').value)||0;
    if(cantidad<=0){ toast('Ingresa una cantidad mayor a cero.','err'); return; }
    if(tipo==='Salida' && cantidad>Number(c.stockActual)){ toast('No puedes retirar más de lo que hay en stock ('+Number(c.stockActual)+' '+c.unidad+').','err'); return; }
    const fecha = bg.querySelector('#mc_fecha').value||today();
    const motivo = bg.querySelector('#mc_motivo').value.trim();
    const obs = bg.querySelector('#mc_obs').value.trim();
    const nuevoStock = tipo==='Entrada' ? (Number(c.stockActual)+cantidad) : (Number(c.stockActual)-cantidad);
    const list = (DB.get(KEYS.consumibles)||[]).map(x=>x.id===id?{...x, stockActual:nuevoStock}:x);
    await DB.save(KEYS.consumibles, list);
    const movs = [...(DB.get(KEYS.movsConsumibles)||[]), { id:uid('movc'), consumibleId:id, tipo, cantidad, fecha, motivo, observacion:obs, registradoPor:currentUser().usuario, saldoResultante:nuevoStock }];
    await DB.save(KEYS.movsConsumibles, movs);
    toast(tipo+' registrada.','ok'); close(); renderContent();
  });
}
function abrirKardexConsumible(id){
  const c = (DB.get(KEYS.consumibles)||[]).find(x=>x.id===id); if(!c) return;
  const movs = [...(DB.get(KEYS.movsConsumibles)||[])].filter(m=>m.consumibleId===id).sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''));
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal wide">
    <div class="m-h"><h3>Kardex — ${esc(c.nombre)}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="hint" style="margin-bottom:8px;">Stock actual: <b>${Number(c.stockActual)} ${esc(c.unidad)}</b> · Stock mínimo: ${Number(c.stockMinimo)} ${esc(c.unidad)}</div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Cantidad</th><th>Saldo resultante</th><th>Motivo</th><th>Registrado por</th></tr></thead>
        <tbody>${movs.map(m=>`<tr>
          <td>${esc(m.fecha)}</td><td>${m.tipo==='Entrada'?'<span class="badge badge-good">Entrada</span>':'<span class="badge badge-warn">Salida</span>'}</td>
          <td class="num">${m.tipo==='Entrada'?'+':'-'}${Number(m.cantidad)}</td><td class="num">${Number(m.saldoResultante)}</td>
          <td>${esc(m.motivo||'—')}${m.observacion?(' — '+esc(m.observacion)):''}</td><td>${esc(m.registradoPor||'—')}</td>
        </tr>`).join('')}
        ${movs.length===0?'<tr><td colspan="6" class="empty">Aún no hay movimientos registrados para este consumible.</td></tr>':''}
        </tbody></table></div>
    </div>
    <div class="m-f"><button class="btn" id="cerrar">Cerrar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cerrar').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
}

function conTiempoLimite(promesa, ms, mensaje){
  return new Promise((resolve,reject)=>{
    const t = setTimeout(()=>reject(new Error(mensaje||'Tiempo de espera agotado')), ms);
    promesa.then(v=>{clearTimeout(t); resolve(v);}, e=>{clearTimeout(t); reject(e);});
  });
}
let _logoImgCache = null, _logoImgCacheUrl = null;
function getCachedLogoImg(url){
  if(!url) return Promise.resolve(null);
  if(_logoImgCacheUrl===url && _logoImgCache) return Promise.resolve(_logoImgCache);
  return conTiempoLimite(new Promise(res=>{
    const img=new Image();
    img.onload=()=>{ _logoImgCache=img; _logoImgCacheUrl=url; res(img); };
    img.onerror=()=>res(null);
    img.src=url;
  }), 5000, 'El logo institucional tardó demasiado en cargar').catch(()=>null);
}
// Código de barras (Code128) con JsBarcode: alternativa al QR para colegios que
// ya cuentan con un lector físico (pistola) en control patrimonial. Solo
// codifica el código patrimonial (no la ficha completa, como sí hace el QR),
// porque un lector de barras común solo necesita el identificador del bien.
function makeBarcodeDataUrl(text){
  try{
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, text || ' ', { format:'CODE128', displayValue:true, fontSize:16, height:58, margin:6, background:'#ffffff' });
    return canvas.toDataURL('image/png');
  }catch(err){
    console.error('No se pudo generar el código de barras:', err);
    return null;
  }
}
// Dibuja una imagen ya cargada dentro de una caja, conservando su proporción
// y centrándola (se usa tanto para el QR como para el código de barras).
function drawImgFitCentered(ctx, img, boxX, boxY, boxW, boxH){
  const scale = Math.min(boxW/img.width, boxH/img.height);
  const w = img.width*scale, h = img.height*scale;
  ctx.drawImage(img, boxX+(boxW-w)/2, boxY+(boxH-h)/2, w, h);
}
async function buildFullLabelCanvas(item, cfg){
  const canvas = document.createElement('canvas'); const W=560, H=280; canvas.width=W; canvas.height=H;
  const ctx = drawLabel(canvas, item, cfg);
  const logoParaCanvas = logoDeConfig(cfg);
  if(logoParaCanvas){
    const img = await getCachedLogoImg(logoParaCanvas);
    if(img){ ctx.save(); roundRectPath(ctx,14,13,44,44,6); ctx.clip(); ctx.drawImage(img,14,13,44,44); ctx.restore(); }
  }
  if(STATE.qrTipoEtiqueta==='barcode'){
    if(typeof JsBarcode==='undefined'){ try{ await cargarLibreria('jsbarcode'); }catch(e){ /* sin conexión: la etiqueta sale sin código de barras */ } }
    const barUrl = makeBarcodeDataUrl(item.codigoInterno);
    if(barUrl){
      await conTiempoLimite(new Promise(res=>{
        const img=new Image();
        img.onload=()=>{ drawImgFitCentered(ctx, img, W-166, (H-140)/2, 158, 140); res(); };
        img.onerror=res; img.src=barUrl;
      }), 5000, 'La imagen del código de barras tardó demasiado en dibujarse').catch(err=>console.error(err));
    }
    return canvas.toDataURL('image/png');
  }
  // Texto plano y legible (no JSON) para que, si alguien escanea el QR con la cámara
  // del celular, vea directamente la ficha del bien en vez de un bloque de código.
  // Se incluyen los datos que identifican el equipo (marca, modelo, serie, color,
  // estado, responsable) aunque no quepan impresos en la etiqueta física.
  const marcaModelo = [item.marca, item.modelo].filter(Boolean).join(' / ') || '—';
  const qrPayload = `${cfg.nombreIE}
BIEN PATRIMONIAL DEL ESTADO
Código: ${item.codigoInterno}
Código SBN: ${item.codigoSBN||'—'}
Código interno IE: ${item.codigoUsoInterno||'—'}
Denominación: ${item.denominacion}
Marca/Modelo: ${marcaModelo}
N° de Serie: ${item.numeroSerie||'—'}
Color: ${item.color||'—'}
Estado de conservación: ${item.estadoConservacion||'—'}
Aula/ambiente: ${item.aulaNombre||'—'}
Responsable: ${item.custodioNombre||'—'}
Año: ${cfg.anioFiscal}
Prohibido su retiro sin autorización.`;
  const qrUrl = makeQrDataUrl(qrPayload);
  if(qrUrl){
    await conTiempoLimite(new Promise(res=>{
      const img=new Image();
      img.onload=()=>{ ctx.drawImage(img, W-160, (H-152)/2, 152,152); res(); };
      img.onerror=res; img.src=qrUrl;
    }), 5000, 'La imagen del QR tardó demasiado en dibujarse').catch(err=>console.error(err));
  }
  return canvas.toDataURL('image/png');
}
function roundRectPath(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
async function renderQrPreview(){
  const ids = [...STATE.qrSelection]; const wrap = document.getElementById('qr_preview_wrap');
  const countEl = document.getElementById('qr_count'); if(countEl) countEl.textContent = ids.length+' etiquetas seleccionadas';
  if(!wrap) return;
  if(ids.length===0){ wrap.innerHTML=''; return; }
  wrap.innerHTML = `<div class="card noprint"><div class="card-h"><h3>Vista previa de etiquetas</h3></div><div class="card-b"><div class="label-sheet" id="labelSheet">Generando…</div></div></div>`;
  const items = DB.get(KEYS.items); const cfg = DB.get(KEYS.config);
  const sheet = document.getElementById('labelSheet'); const htmls = []; const errores = [];
  for(const id of ids){
    const it = items.find(x=>x.id===id); if(!it) continue;
    try{
      const url = await conTiempoLimite(buildFullLabelCanvas(it, cfg), 8000, 'Tiempo de espera agotado');
      htmls.push(`<div class="qr-label" style="flex-direction:column;"><img src="${url}" style="width:100%;height:auto;border-radius:4px;"></div>`);
    }catch(err){
      console.error('Error generando la etiqueta de', it.codigoInterno, err);
      errores.push(esc(it.codigoInterno)+': no se pudo generar ('+esc(err&&err.message?err.message:'error desconocido')+')');
    }
    // Se va mostrando el avance real en vez de esperar a que termine todo el lote.
    if(sheet) sheet.innerHTML = htmls.join('') + (errores.length?`<div class="hint" style="color:var(--bad);width:100%;">${errores.join('<br>')}</div>`:'');
  }
  if(sheet && htmls.length===0 && errores.length===0) sheet.innerHTML = '<div class="hint">No se pudieron generar etiquetas.</div>';
}

/* ---------------------------------------------------------------------
   15. PRÉSTAMOS DE BIENES
   --------------------------------------------------------------------- */
function bienesEnPrestamo(){ return new Set(DB.get(KEYS.prestamos).filter(p=>p.estado==='Prestado').flatMap(p=>p.bienesIds)); }
function renderPrestamos(){
  const prestamos = [...DB.get(KEYS.prestamos)].filter(p=>isAdmin()|| (p.bienesAula||[]).some(a=>puedoVerAula(a))).sort((a,b)=>b.fechaPrestamo.localeCompare(a.fechaPrestamo));
  const vencidos = prestamos.filter(p=>p.estado==='Prestado' && p.fechaDevolucionProgramada && p.fechaDevolucionProgramada<today()).length;
  return `
  ${vencidos>0?`<div class="note-banner" style="background:var(--bad-soft);border-color:#e6b3ba;color:var(--bad);">⚠ Tienes <b>${vencidos}</b> préstamo(s) con la devolución vencida. Revisa la columna "Estado" para ubicarlos.</div>`:''}
  <div class="card"><div class="tbl-wrap"><table>
    <thead><tr><th>N° préstamo</th><th>Solicitante</th><th>Motivo</th><th>N° bienes</th><th>F. préstamo</th><th>F. dev. programada</th><th>Estado</th><th></th></tr></thead>
    <tbody>${prestamos.map(p=>{
      const vencido = p.estado==='Prestado' && p.fechaDevolucionProgramada && p.fechaDevolucionProgramada<today();
      return `<tr>
      <td class="mono">${esc(p.numero)}</td><td>${esc(p.docente)}<div class="hint">${esc(p.cargo||'')}</div></td><td>${esc(p.motivo)}</td>
      <td class="num">${p.bienesIds.length}</td><td>${esc(p.fechaPrestamo)}</td><td>${esc(p.fechaDevolucionProgramada)}</td>
      <td>${p.estado==='Prestado'?'<span class="badge badge-warn">Prestado</span>':'<span class="badge badge-good">Devuelto</span>'} ${vencido?'<span class="badge badge-bad">Atrasado</span>':''}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-sm btn-ghost" data-actaprestamo="${p.id}">Acta</button>
        ${p.estado==='Prestado'&&canEdit()?`<button class="btn btn-sm btn-primary" data-devolver="${p.id}">Devolución</button><button class="btn btn-sm btn-danger" data-cancelarprestamo="${p.id}">Cancelar</button>`:''}
      </td>
    </tr>`;}).join('')}
    ${prestamos.length===0?'<tr><td colspan="8" class="empty"><div class="big">⇄</div>Aún no hay préstamos registrados.</td></tr>':''}
    </tbody></table></div></div>`;
}
function generarNumeroPrestamo(){
  const anio = DB.get(KEYS.config).anioFiscal;
  const n = DB.get(KEYS.prestamos).length + 1;
  return 'PR-'+anio+'-'+String(n).padStart(4,'0');
}
function openPrestamoModal(){
  if(!guardEdit()) return;
  const items = scopedItems().filter(i=>!bienesEnPrestamo().has(i.id) && i.situacion!=='De baja' && i.situacion!=='En trámite de baja');
  const custodios = DB.get(KEYS.custodios);
  const usuariosAutoriza = DB.get(KEYS.usuarios).filter(u=>u.rol==='ADMIN'||u.rol==='ADMIN2');
  if(custodios.length===0){
    toast('Registra primero al personal / docentes en "Personal / bibliotecarios" para poder generar préstamos con combos.','err');
    return;
  }
  // Todo por combo, nada de texto libre: cargos únicos de los responsables ya
  // registrados, y nombres de bien (denominación) únicos para poder filtrar
  // el listado de bienes en vez de desplazarse por más de mil ítems.
  const cargosUnicos = DB.get(KEYS.cargos);
  const aulasConBienes = [...new Map(items.map(i=>[i.aulaId, i.aulaNombre||'—'])).entries()];
  const denominacionesUnicas = [...new Set(items.map(i=>i.denominacion))].sort((a,b)=>a.localeCompare(b));
  const autorizaDefault = currentUser().nombre || currentUser().usuario;
  const selectedIds = new Set();
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal wide">
    <div class="m-h"><h3>Nuevo préstamo de bienes</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="grid g2">
        <div class="field"><label>Nombre del docente / solicitante *</label>
          <select id="p_docente"><option value="">— Selecciona —</option>${custodios.map(c=>`<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>DNI</label><input id="p_dni" disabled placeholder="Se completa solo"></div>
      </div>
      <div class="grid g2">
        <div class="field"><label>Cargo / área del solicitante *</label>
          <select id="p_cargo"><option value="">— Selecciona —</option>${cargosUnicos.map(cg=>`<option value="${esc(cg)}">${esc(cg)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Autorizado por *</label>
          <select id="p_autoriza">${usuariosAutoriza.length? usuariosAutoriza.map(u=>`<option value="${esc(u.nombre||u.usuario)}" ${((u.nombre||u.usuario)===autorizaDefault)?'selected':''}>${esc(u.nombre||u.usuario)}</option>`).join('') : `<option value="${esc(autorizaDefault)}">${esc(autorizaDefault)}</option>`}</select>
        </div>
      </div>
      <div class="field"><label>Motivo del préstamo *</label><input id="p_motivo" placeholder="Ej. Actuación por aniversario"></div>
      <div class="field"><label>Lugar / evento (opcional)</label><input id="p_lugar"></div>
      <div class="grid g2">
        <div class="field"><label>Fecha de préstamo</label><input id="p_fecha" type="date" value="${today()}"></div>
        <div class="field"><label>Fecha de devolución programada *</label><input id="p_fechadev" type="date" value="${today()}"></div>
      </div>
      <div class="field"><label>Bienes a prestar *</label>
        <div class="grid g2">
          <div class="field"><label>Filtrar por nombre de bien</label>
            <select id="p_filtro_nombre"><option value="">— Todos los tipos de bien —</option>${denominacionesUnicas.map(d=>`<option value="${esc(d)}">${esc(d)} (${items.filter(i=>i.denominacion===d).length})</option>`).join('')}</select>
          </div>
          <div class="field"><label>Filtrar por aula / ambiente</label>
            <select id="p_filtro_aula"><option value="">— Todas las aulas —</option>${aulasConBienes.map(([id,nom])=>`<option value="${esc(id)}">${esc(nom)}</option>`).join('')}</select>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
          <button type="button" class="btn btn-sm" id="p_sel_filtrados">Seleccionar los filtrados</button>
          <button type="button" class="btn btn-sm" id="p_clear_sel">Limpiar selección</button>
          <span style="flex:1"></span>
          <span class="hint" id="p_sel_count">0 bien(es) seleccionado(s) en total</span>
        </div>
        <div class="checklist" id="p_bienes_list"></div>
      </div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Registrar préstamo</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click',e=>{if(e.target===bg)close();});
  function itemsFiltrados(){
    const nombreF = bg.querySelector('#p_filtro_nombre').value;
    const aulaF = bg.querySelector('#p_filtro_aula').value;
    return items.filter(i=>(!nombreF||i.denominacion===nombreF) && (!aulaF||i.aulaId===aulaF));
  }
  function updateCount(){ bg.querySelector('#p_sel_count').textContent = selectedIds.size+' bien(es) seleccionado(s) en total'; }
  function renderChecklist(){
    const filtrados = itemsFiltrados();
    const list = bg.querySelector('#p_bienes_list');
    list.innerHTML = filtrados.map(i=>{
      const esMalo = i.estadoConservacion==='Malo';
      return `<label class="${esMalo?'pchk-warn':''}"><input type="checkbox" class="pchk" value="${i.id}" ${selectedIds.has(i.id)?'checked':''}> <span class="mono">${esc(i.codigoInterno)}</span> — ${esc(i.denominacion)} (${esc(i.aulaNombre||'—')}) — ${fichaBienHTML(i)} — ${estadoBadge(i.estadoConservacion)}${esMalo?' <span class="hint" style="color:var(--bad);">⚠ No recomendado para préstamo</span>':''}</label>`;
    }).join('') || '<div class="hint">No hay bienes disponibles que coincidan con el filtro.</div>';
    list.querySelectorAll('.pchk').forEach(chk=>chk.addEventListener('change', e=>{
      if(e.target.checked) selectedIds.add(e.target.value); else selectedIds.delete(e.target.value);
      updateCount();
    }));
  }
  renderChecklist(); updateCount();
  bg.querySelector('#p_filtro_nombre').addEventListener('change', renderChecklist);
  bg.querySelector('#p_filtro_aula').addEventListener('change', renderChecklist);
  bg.querySelector('#p_sel_filtrados').addEventListener('click', ()=>{ itemsFiltrados().forEach(i=>selectedIds.add(i.id)); renderChecklist(); updateCount(); });
  bg.querySelector('#p_clear_sel').addEventListener('click', ()=>{ selectedIds.clear(); renderChecklist(); updateCount(); });
  bg.querySelector('#p_docente').addEventListener('change', e=>{
    const c = custodios.find(x=>x.id===e.target.value);
    bg.querySelector('#p_dni').value = c?(c.dni||''):'';
    const cargoSel = bg.querySelector('#p_cargo');
    if(c && c.cargo && [...cargoSel.options].some(o=>o.value===c.cargo)) cargoSel.value = c.cargo;
  });
  bg.querySelector('#save').addEventListener('click', async ()=>{
    const custodioId = bg.querySelector('#p_docente').value;
    const custodio = custodios.find(c=>c.id===custodioId);
    const cargo = bg.querySelector('#p_cargo').value;
    const autoriza = bg.querySelector('#p_autoriza').value;
    const motivo=bg.querySelector('#p_motivo').value.trim();
    const fechadev=bg.querySelector('#p_fechadev').value;
    const seleccion=[...selectedIds];
    if(!custodio||!cargo||!autoriza||!motivo||!fechadev||seleccion.length===0){ toast('Selecciona solicitante, cargo, autorizado por, completa motivo, fecha de devolución y al menos un bien.','err'); return; }
    const docente = custodio.nombre;
    const allItems = DB.get(KEYS.items);
    const enMalEstado = seleccion.map(id=>allItems.find(x=>x.id===id)).filter(it=>it&&it.estadoConservacion==='Malo');
    if(enMalEstado.length>0){
      const nombres = enMalEstado.map(it=>it.codigoInterno+' — '+it.denominacion).join('\n');
      if(!confirm('Estás por prestar '+enMalEstado.length+' bien(es) en estado MALO:\n\n'+nombres+'\n\n¿Deseas continuar de todos modos?')) return;
    }
    const detalleEntrega = seleccion.map(id=>{ const it=allItems.find(x=>x.id===id); return { itemId:id, codigoInterno:it.codigoInterno, denominacion:it.denominacion, marca:it.marca||'', modelo:it.modelo||'', numeroSerie:it.numeroSerie||'', color:it.color||'', estadoEntrega:it.estadoConservacion }; });
    const data = {
      id:uid('pres'), numero:generarNumeroPrestamo(), docente, dni:custodio.dni||'',
      cargo, motivo, lugar:bg.querySelector('#p_lugar').value.trim(),
      autoriza, fechaPrestamo:bg.querySelector('#p_fecha').value,
      fechaDevolucionProgramada:fechadev, fechaDevolucionReal:'', estado:'Prestado',
      bienesIds:seleccion, bienesAula: seleccion.map(id=>{ const it=allItems.find(x=>x.id===id); return it.aulaId; }),
      detalleEntrega, detalleDevolucion:[], registradoPor: currentUser().usuario
    };
    await DB.save(KEYS.prestamos, [...DB.get(KEYS.prestamos), data]);
    for(const id of seleccion){ const it=allItems.find(x=>x.id===id); await addMovimiento(id, it.codigoInterno, 'Préstamo', 'Prestado a '+docente+' — '+motivo+' ('+currentUser().usuario+').'); }
    toast('Préstamo registrado.','ok'); close(); renderContent();
  });
}
function openDevolucionModal(prestamoId){
  if(!guardEdit()) return;
  const p = DB.get(KEYS.prestamos).find(x=>x.id===prestamoId); if(!p) return;
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal wide">
    <div class="m-h"><h3>Devolución — ${esc(p.numero)}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="field"><label>Fecha real de devolución</label><input id="d_fecha" type="date" value="${today()}"></div>
      <div class="tbl-wrap"><table><thead><tr><th>Código</th><th>Denominación</th><th>Marca/Modelo</th><th>Serie</th><th>Color</th><th>Estado al entregar</th><th>Estado al devolver</th><th>Observación</th></tr></thead>
      <tbody>${p.detalleEntrega.map((d,i)=>`<tr>
        <td class="mono">${esc(d.codigoInterno)}</td><td>${esc(d.denominacion)}</td>
        <td>${esc(d.marca||'—')} ${esc(d.modelo||'')}</td><td>${esc(d.numeroSerie||'—')}</td><td>${esc(d.color||'—')}</td>
        <td>${estadoBadge(d.estadoEntrega)}</td>
        <td><select id="d_estado_${i}">${ESTADOS_CONSERVACION.map(e=>`<option ${e===d.estadoEntrega?'selected':''}>${e}</option>`).join('')}</select></td>
        <td><input id="d_obs_${i}" placeholder="Opcional"></td>
      </tr>`).join('')}</tbody></table></div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Confirmar devolución</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click',e=>{if(e.target===bg)close();});
  bg.querySelector('#save').addEventListener('click', async ()=>{
    const detalleDevolucion = p.detalleEntrega.map((d,i)=>({ itemId:d.itemId, estadoDevolucion: bg.querySelector('#d_estado_'+i).value, observacion: bg.querySelector('#d_obs_'+i).value.trim() }));
    const fecha = bg.querySelector('#d_fecha').value;
    const prestamos = DB.get(KEYS.prestamos).map(x=>x.id===p.id?{...x, estado:'Devuelto', fechaDevolucionReal:fecha, detalleDevolucion}:x);
    await DB.save(KEYS.prestamos, prestamos);
    let items = DB.get(KEYS.items);
    for(const d of detalleDevolucion){
      items = items.map(it=>it.id===d.itemId?{...it, estadoConservacion:d.estadoDevolucion}:it);
      const it = items.find(x=>x.id===d.itemId);
      await addMovimiento(d.itemId, it?it.codigoInterno:'', 'Devolución', 'Devuelto por '+p.docente+'. Estado: '+d.estadoDevolucion+(d.observacion?' — '+d.observacion:'')+' ('+currentUser().usuario+').');
    }
    await DB.save(KEYS.items, items);
    toast('Devolución registrada.','ok'); close(); renderContent();
  });
}
// Ventana de impresión AISLADA: solo el contenido del documento, sin sidebar,
// botones ni tarjetas de la app — así cada reporte ocupa exactamente las hojas
// que su contenido necesita (ni una hoja en blanco de más, ni datos cortadas
// entre "página 1 vacía" y "página 2 con la información").
// Reduce el tamaño de letra de las celdas ".cellfit" (p. ej. Denominación en
// las planillas de verificación) hasta que el texto entre en una sola línea
// sin ensanchar la fila, en vez de dejar que el navegador la envuelva en
// 2-3 líneas. "win" es la ventana donde viven esos elementos (la propia app
// o la ventana aislada de impresión), para usar su getComputedStyle.
function ajustarCellfit(root, win){
  win = win || window;
  root.querySelectorAll('.cellfit').forEach(td=>{
    if(!td.textContent.trim()) return;
    td.style.fontSize = '';
    let fontSize = parseFloat(win.getComputedStyle(td).fontSize) || 10;
    const minSize = 6;
    let guard = 0;
    while(td.scrollWidth > td.clientWidth && fontSize > minSize && guard < 40){
      fontSize -= 0.5;
      td.style.fontSize = fontSize + 'px';
      guard++;
    }
  });
}
function abrirVentanaImpresion(titulo, innerHtml, orientacion){
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title>
  <style>
    @page{ size:${orientacion==='landscape'?'landscape':'auto'}; margin:10mm; }
    *{ box-sizing:border-box; }
    html,body{ margin:0; padding:0; }
    body{ font-family:'Times New Roman', Georgia, serif; color:#000; }
    h2,h3{ text-align:center !important; text-transform:uppercase !important; margin:1px 0 !important; font-size:9px !important; line-height:1.2 !important; }
    table{ width:100%; border-collapse:collapse; margin-top:10px; }
    th,td{ border:1px solid #000; padding:4px 6px; font-size:11px; }
    th{ background:#eee; }
    .ficha{ padding:0; margin:0 0 0 0; }
    .ficha-header{ display:flex; align-items:center; gap:16px; margin-bottom:10px; }
    .ficha-header .logo-slot{ width:70px; height:70px; flex:0 0 70px; display:flex; align-items:center; justify-content:center; overflow:hidden; }
    .ficha-header .logo-slot img{ max-width:100%; max-height:100%; object-fit:contain; }
    .ficha-header .meta-center{ flex:1; text-align:center; }
    .meta-table{ width:auto; margin:0 auto; border-collapse:collapse; }
    .meta-table td{ border:none; padding:0 4px; font-size:12px; line-height:1.15; white-space:nowrap; }
    .meta-blocks{ display:flex; justify-content:center; align-items:flex-start; gap:176px; }
    .meta-blocks .meta-table{ margin:0; text-align:left; }
    .meta-table-planilla{ border-left:1px solid #000; padding-left:72px; }
    .ficha-header-planilla{ position:relative; min-height:70px; }
    .ficha-header-planilla .logo-slot{ position:absolute; left:0; top:-14px; }
    .ficha-header-planilla .meta-center{ width:100%; }
    .bienes-table th,.bienes-table td{ font-size:10px; padding:3px 4px; word-wrap:break-word; overflow-wrap:break-word; }
    .bienes-table th:nth-child(1),.bienes-table td:nth-child(1){ width:3%; }
    .bienes-table th:nth-child(2),.bienes-table td:nth-child(2){ width:11%; }
    .bienes-table th:nth-child(3),.bienes-table td:nth-child(3){ width:9%; }
    .bienes-table th:nth-child(4),.bienes-table td:nth-child(4){ width:20%; }
    .bienes-table th:nth-child(5),.bienes-table td:nth-child(5){ width:9%; }
    .firma{ margin-top:50px; display:flex; justify-content:space-around; text-align:center; font-size:11.5px; }
    .firma div{ border-top:1px solid #000; padding-top:6px; width:220px; }
    /* CSS Grid no respeta bien los saltos de página en impresión (Chrome corta
       las filas a la mitad en vez de pasarlas completas a la hoja siguiente).
       Por eso la hoja de etiquetas usa flexbox con flex-wrap: cada etiqueta es
       un bloque independiente con "avoid" en los tres saltos de página
       equivalentes, así el navegador la mueve entera a la siguiente hoja si no
       entra completa en la actual. */
    .qrsheet{ display:flex; flex-wrap:wrap; gap:8px; align-content:flex-start; }
    .qrsheet img{
      flex:0 0 calc(33.333% - 6px);
      max-width:calc(33.333% - 6px);
      width:calc(33.333% - 6px);
      border:1px solid #444;
      border-radius:4px;
      display:block;
      break-inside:avoid;
      page-break-inside:avoid;
      -webkit-column-break-inside:avoid;
    }
    .doc-page{ page-break-after:always; }
    .doc-page:last-of-type{ page-break-after:auto !important; }
    /* Celdas que deben quedarse en una sola línea (p. ej. Denominación en las
       planillas de verificación): el ancho de columna no crece, y el texto se
       recorta en altura solo si hiciera falta — el ajuste real de tamaño de
       letra para que quepa completo se hace por script justo antes de imprimir. */
    .cellfit{ white-space:nowrap; overflow:hidden; }
  </style>
  </head><body>${innerHtml}</body></html>`);
  w.document.close();
  // Espera a que carguen las imágenes (logos/QR) antes de imprimir, para que ninguna
  // hoja se corte a medio cargar ni se generen páginas de más por reflow tardío.
  let yaImprimio = false;
  const imprimirUnaVez = ()=>{ if(yaImprimio) return; yaImprimio=true; ajustarCellfit(w.document, w); w.focus(); w.print(); };
  const imgs = w.document.images;
  if(imgs.length===0){ setTimeout(imprimirUnaVez, 150); }
  else{
    let cargadas = 0;
    Array.from(imgs).forEach(img=>{
      if(img.complete){ cargadas++; } else { img.addEventListener('load', ()=>{ cargadas++; if(cargadas>=imgs.length) imprimirUnaVez(); }); img.addEventListener('error', ()=>{ cargadas++; if(cargadas>=imgs.length) imprimirUnaVez(); }); }
    });
    if(cargadas>=imgs.length) setTimeout(imprimirUnaVez, 150);
    setTimeout(imprimirUnaVez, 1500); // resguardo por si alguna imagen nunca dispara load/error
  }
}
// Firma digital simple (trazo a mano en canvas) para actas INTERNAS (préstamo/
// devolución). No es una firma electrónica con validez legal ni reemplaza la
// firma física en los documentos oficiales de UGEL — es solo un respaldo visual
// adicional para el acta de trabajo del colegio. Devuelve un dataURL o null si
// el usuario prefiere omitirla.
function capturarFirma(titulo){
  return new Promise(resolve=>{
    const bg = document.createElement('div'); bg.className='modal-bg';
    bg.innerHTML = `<div class="modal">
      <div class="m-h"><h3>${esc(titulo)}</h3><button class="close-x">&times;</button></div>
      <div class="m-b">
        <div class="hint" style="margin-bottom:8px;">Firma opcional en el recuadro (con el dedo o el mouse). No es una firma electrónica con validez legal, solo un respaldo visual para el acta interna.</div>
        <canvas id="firmaCanvas" width="500" height="180" style="width:100%;max-width:500px;border:1px dashed var(--line);border-radius:8px;touch-action:none;background:#fff;"></canvas>
      </div>
      <div class="m-f"><button class="btn" id="firmaOmitir">Omitir firma</button><button class="btn" id="firmaLimpiar">Limpiar</button><button class="btn btn-primary" id="firmaUsar">Usar esta firma</button></div>
    </div>`;
    document.body.appendChild(bg);
    const canvas = bg.querySelector('#firmaCanvas');
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#14304d';
    let dibujando = false, huboTrazo = false;
    function pos(e){ const r = canvas.getBoundingClientRect(); const scaleX = canvas.width/r.width, scaleY = canvas.height/r.height; const p = e.touches ? e.touches[0] : e; return { x:(p.clientX-r.left)*scaleX, y:(p.clientY-r.top)*scaleY }; }
    function start(e){ e.preventDefault(); dibujando = true; huboTrazo = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x,p.y); }
    function move(e){ if(!dibujando) return; e.preventDefault(); const p = pos(e); ctx.lineTo(p.x,p.y); ctx.stroke(); }
    function end(){ dibujando = false; }
    ['mousedown','touchstart'].forEach(ev=>canvas.addEventListener(ev,start));
    ['mousemove','touchmove'].forEach(ev=>canvas.addEventListener(ev,move));
    ['mouseup','mouseleave','touchend'].forEach(ev=>canvas.addEventListener(ev,end));
    const close = (result)=>{ bg.remove(); resolve(result); };
    bg.querySelector('.close-x').addEventListener('click', ()=>close(null));
    bg.querySelector('#firmaOmitir').addEventListener('click', ()=>close(null));
    bg.querySelector('#firmaLimpiar').addEventListener('click', ()=>{ ctx.clearRect(0,0,canvas.width,canvas.height); huboTrazo=false; });
    bg.querySelector('#firmaUsar').addEventListener('click', ()=>close(huboTrazo?canvas.toDataURL('image/png'):null));
    bg.addEventListener('click', e=>{ if(e.target===bg) close(null); });
  });
}
async function imprimirActaPrestamo(prestamoId){
  const p = DB.get(KEYS.prestamos).find(x=>x.id===prestamoId); if(!p) return;
  const cfg = DB.get(KEYS.config);
  const allItems = DB.get(KEYS.items);
  // Los préstamos creados antes de guardar estos campos en el detalle no los
  // tendrán; en ese caso se recurre al bien actual (si aún existe) como respaldo.
  const datoBien = d=>{
    const it = allItems.find(x=>x.id===d.itemId);
    return { marca:d.marca||(it&&it.marca)||'', modelo:d.modelo||(it&&it.modelo)||'', numeroSerie:d.numeroSerie||(it&&it.numeroSerie)||'', color:d.color||(it&&it.color)||'' };
  };
  const firma = await capturarFirma('Firma de conformidad — '+esc(p.docente));
  const registro = await registrarActaFirmada('Acta de Préstamo', {
    numero:p.numero, docente:p.docente, dni:p.dni||'', fechaPrestamo:p.fechaPrestamo,
    fechaDevolucionProgramada:p.fechaDevolucionProgramada, autoriza:p.autoriza,
    bienes:p.detalleEntrega.map(d=>({codigoInterno:d.codigoInterno, estadoEntrega:d.estadoEntrega}))
  }, `Préstamo N° ${p.numero} — ${p.docente} (${p.detalleEntrega.length} bien(es))`, p.id);
  const body = `
  <h2>ACTA DE PRÉSTAMO DE BIENES PATRIMONIALES</h2>
  <p><b>I.E.:</b> ${esc(cfg.nombreIE)} &nbsp;&nbsp; <b>N° de préstamo:</b> ${esc(p.numero)}</p>
  <p><b>Solicitante:</b> ${esc(p.docente)} ${p.dni?('— DNI '+esc(p.dni)):''} ${p.cargo?('— '+esc(p.cargo)):''}</p>
  <p><b>Motivo:</b> ${esc(p.motivo)} ${p.lugar?('— Lugar: '+esc(p.lugar)):''}</p>
  <p><b>Fecha de préstamo:</b> ${esc(p.fechaPrestamo)} &nbsp;&nbsp; <b>Devolución programada:</b> ${esc(p.fechaDevolucionProgramada)}</p>
  <p><b>Autorizado por:</b> ${esc(p.autoriza)}</p>
  <table><thead><tr><th>N°</th><th>Código</th><th>Denominación</th><th>Marca</th><th>Modelo</th><th>N° Serie</th><th>Color</th><th>Estado de entrega</th></tr></thead>
  <tbody>${p.detalleEntrega.map((d,i)=>{ const b=datoBien(d); return `<tr><td>${i+1}</td><td>${esc(d.codigoInterno)}</td><td>${esc(d.denominacion)}</td><td>${esc(b.marca||'—')}</td><td>${esc(b.modelo||'—')}</td><td>${esc(b.numeroSerie||'—')}</td><td>${esc(b.color||'—')}</td><td>${esc(d.estadoEntrega)}</td></tr>`;}).join('')}</tbody></table>
  <div class="firma">
    <div>Entrega (Control patrimonial)</div>
    <div>${firma?`<img src="${firma}" style="height:50px;display:block;margin:0 auto 4px;">`:''}Recibe (${esc(p.docente)})</div>
  </div>
  <p style="font-size:9.5px;color:#777;margin-top:6px;">${firma?'Firma trazada digitalmente en pantalla al momento de generar el acta — respaldo visual interno, no constituye firma electrónica con validez legal.':''}</p>
  ${bloqueVerificacionHTML(registro)}`;
  abrirVentanaImpresion('Acta de préstamo '+p.numero, body);
}

/* ---------------------------------------------------------------------
   16-B. TOMA DE INVENTARIO POR AULA (checklist interactivo)
   Flujo: se elige el aula y la fecha (openTomaSetupModal); mientras dura la
   verificación, el checklist vive en STATE.tomaEnCurso (solo en memoria);
   al finalizar (finalizarToma) se guarda el registro histórico en
   KEYS.tomas, se actualiza el kardex de cada bien y, si algún bien no fue
   encontrado, se marca como "Perdido/Sustraído" en el inventario.
   --------------------------------------------------------------------- */
function renderTomas(){
  if(STATE.tomaEnCurso) return renderTomaChecklistForm();
  const tomas = [...DB.get(KEYS.tomas)].filter(t=>isAdmin()||puedoVerAula(t.aulaId)).sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''));
  return `<div class="card"><div class="tbl-wrap"><table>
    <thead><tr><th>Fecha</th><th>Aula / ambiente</th><th>Responsable del aula</th><th>Verificado por</th><th class="num">N° bienes</th><th class="num">Encontrados</th><th class="num">Faltantes</th><th>Resultado</th><th></th></tr></thead>
    <tbody>${tomas.map(t=>{
      const faltantes = t.items.filter(i=>!i.encontrado).length;
      return `<tr>
      <td>${esc(t.fecha)}</td><td>${esc(t.aulaNombre)}</td><td>${esc(t.responsable||'—')}</td><td>${esc(t.verificadoPor||'—')}</td>
      <td class="num">${t.items.length}</td><td class="num">${t.items.length-faltantes}</td><td class="num">${faltantes}</td>
      <td>${faltantes>0?'<span class="badge badge-bad">Con faltantes</span>':'<span class="badge badge-good">Completa</span>'}</td>
      <td><button class="btn btn-sm btn-ghost" data-vertoma="${t.id}">Ver / imprimir</button></td>
    </tr>`;}).join('')}
    ${tomas.length===0?'<tr><td colspan="9" class="empty"><div class="big">☑</div>Aún no se ha registrado ninguna toma de inventario física por aula.</td></tr>':''}
    </tbody></table></div></div>`;
}
function openTomaSetupModal(){
  if(!guardEdit()) return;
  const aulas = scopedAulas();
  if(aulas.length===0){ toast('No hay aulas disponibles para hacer la toma de inventario.','err'); return; }
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal" style="max-width:480px;">
    <div class="m-h"><h3>Nueva toma de inventario</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="field"><label>Aula / ambiente a verificar *</label><select id="t_aula"><option value="">— Seleccionar —</option>${aulas.map(a=>`<option value="${a.id}">${esc(a.aulaLabel||a.nombre)} (${esc(a.responsable||'sin responsable')})</option>`).join('')}</select></div>
      <div class="field"><label>Fecha de verificación</label><input id="t_fecha" type="date" value="${today()}"></div>
      <div class="hint">Se listarán todos los bienes activos registrados en esta aula para marcarlos uno por uno.</div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="iniciar">Iniciar checklist</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click',e=>{if(e.target===bg)close();});
  bg.querySelector('#iniciar').addEventListener('click', ()=>{
    const aulaId = bg.querySelector('#t_aula').value;
    if(!aulaId){ toast('Selecciona un aula.','err'); return; }
    const aula = aulas.find(a=>a.id===aulaId);
    const items = DB.get(KEYS.items).filter(i=>i.aulaId===aulaId && i.situacion!=='De baja');
    if(items.length===0){ toast('Esta aula no tiene bienes activos registrados.','err'); return; }
    STATE.tomaEnCurso = {
      aulaId, aulaNombre: aula.aulaLabel||aula.nombre, responsable: aula.responsable||'',
      fecha: bg.querySelector('#t_fecha').value || today(),
      registros: items.map(i=>({ itemId:i.id, codigoInterno:i.codigoInterno, denominacion:i.denominacion, estadoRegistrado:i.estadoConservacion, encontrado:true, estadoEncontrado:i.estadoConservacion, observacion:'' })),
      // Bienes hallados físicamente en el aula durante esta verificación pero que
      // nunca fueron registrados (sin documentación de compra). En vez de forzar una
      // fecha/valor de adquisición inventados, se guardan aquí y al finalizar la toma
      // se dan de alta con situación "Por sanear" (ver renderTomaChecklistForm).
      noRegistrados: []
    };
    close(); render();
  });
}
function renderTomaChecklistForm(){
  const t = STATE.tomaEnCurso;
  const encontrados = t.registros.filter(r=>r.encontrado).length;
  return `
  <div class="note-banner">Marca cada bien como <b>encontrado</b> o <b>no encontrado</b> durante la verificación física del aula <b>${esc(t.aulaNombre)}</b>. Si el estado de conservación cambió, actualízalo. Al finalizar se actualizará el kardex de cada bien y quedará guardado el resultado de esta toma de inventario.</div>
  <div class="card"><div class="card-b">
    <div class="toolbar">
      <span class="hint">${encontrados} de ${t.registros.length} bien(es) marcados como encontrados</span>
      <span style="flex:1"></span>
      <button class="btn btn-sm" id="tk_marcar_todos">Marcar todos como encontrados</button>
    </div>
    <div class="tbl-wrap"><table>
      <thead><tr><th style="width:36px;"></th><th>Código</th><th>Denominación</th><th>Estado registrado</th><th>Estado encontrado</th><th>Observación</th></tr></thead>
      <tbody>${t.registros.map((r,idx)=>`<tr>
        <td><input type="checkbox" class="tk_enc" data-idx="${idx}" ${r.encontrado?'checked':''}></td>
        <td class="mono">${esc(r.codigoInterno)}</td>
        <td>${esc(r.denominacion)}</td>
        <td>${estadoBadge(r.estadoRegistrado)}</td>
        <td><select class="tk_estado" data-idx="${idx}" ${r.encontrado?'':'disabled'}>${ESTADOS_CONSERVACION.map(e=>`<option value="${e}" ${r.estadoEncontrado===e?'selected':''}>${ESTADO_ABREV[e]} - ${e}</option>`).join('')}</select></td>
        <td><input type="text" class="tk_obs" data-idx="${idx}" value="${esc(r.observacion)}" placeholder="${r.encontrado?'Opcional':'Ej. No se ubicó en el aula'}"></td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div></div>
  <div class="card" style="margin-top:16px;">
    <div class="card-h"><h3>🧾 Bienes encontrados sin registrar (saneamiento)</h3></div>
    <div class="card-b">
      <div class="hint" style="margin-bottom:10px;">Si durante la verificación física encuentras un bien en esta aula que <b>no aparece en el inventario</b> (típico en inventarios heredados de años anteriores), agrégalo aquí. Al finalizar la toma se registrará con situación <b>"Por sanear"</b>, sin forzar una fecha ni un valor de adquisición inventados.</div>
      ${t.noRegistrados.length>0?`<div class="tbl-wrap" style="margin-bottom:12px;"><table>
        <thead><tr><th>Denominación</th><th>Marca/Modelo</th><th>Estado</th><th>Observación</th><th></th></tr></thead>
        <tbody>${t.noRegistrados.map((r,idx)=>`<tr>
          <td>${esc(r.denominacion)}</td><td>${esc(r.marca||'—')} ${esc(r.modelo||'')}</td><td>${estadoBadge(r.estadoConservacion)}</td><td>${esc(r.observacion||'—')}</td>
          <td><button class="btn btn-sm btn-ghost" data-delsanear="${idx}">Quitar</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`:''}
      <button class="btn btn-primary" id="tk_ns_agregar">+ Agregar bien encontrado sin registrar</button>
    </div>
  </div>
  <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
    <button class="btn" id="tk_cancelar">Cancelar toma</button>
    <button class="btn btn-primary" id="tk_finalizar">Finalizar toma de inventario</button>
  </div>`;
}
function abrirModalBienSinRegistrar(){
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal" style="max-width:620px;">
    <div class="m-h"><h3>Bien encontrado sin registrar</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="hint" style="margin-bottom:10px;">Se registrará con situación <b>"Por sanear"</b> al finalizar la toma.</div>
      <div class="field"><label>Denominación *</label><input id="tk_ns_denom" placeholder="Ej. SILLA DE MADERA"></div>
      <div class="grid g2">
        <div class="field"><label>Marca</label><input id="tk_ns_marca"></div>
        <div class="field"><label>Modelo</label><input id="tk_ns_modelo"></div>
      </div>
      <div class="field"><label>Estado</label><select id="tk_ns_estado">${ESTADOS_CONSERVACION.map(e=>`<option value="${e}">${ESTADO_ABREV[e]} - ${e}</option>`).join('')}</select></div>
      <div class="field"><label>Observación</label><input id="tk_ns_obs" placeholder="Ej. Encontrado en el depósito del aula"></div>
    </div>
    <div class="m-f"><button class="btn" id="cancelNs">Cancelar</button><button class="btn btn-primary" id="saveNs">Agregar a saneamiento</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancelNs').onclick=close;
  bg.addEventListener('click',e=>{ if(e.target===bg) close(); });
  setTimeout(()=>bg.querySelector('#tk_ns_denom').focus(),30);
  bg.querySelector('#saveNs').addEventListener('click', ()=>{
    const denominacion = bg.querySelector('#tk_ns_denom').value.trim();
    if(!denominacion){ toast('Escribe al menos la denominación del bien encontrado.', 'err'); return; }
    STATE.tomaEnCurso.noRegistrados.push({
      denominacion: denominacion.toUpperCase(),
      marca: bg.querySelector('#tk_ns_marca').value.trim(),
      modelo: bg.querySelector('#tk_ns_modelo').value.trim(),
      estadoConservacion: bg.querySelector('#tk_ns_estado').value,
      observacion: bg.querySelector('#tk_ns_obs').value.trim()
    });
    close(); renderContent();
  });
}
async function finalizarToma(){
  const t = STATE.tomaEnCurso;
  const faltantes = t.registros.filter(r=>!r.encontrado);
  const nuevosSanear = t.noRegistrados || [];
  let mensajeConfirm = '';
  if(faltantes.length>0) mensajeConfirm += `Hay ${faltantes.length} bien(es) marcados como NO encontrados. Al finalizar, esos bienes quedarán marcados como "Perdido/Sustraído" en el inventario.\n`;
  if(nuevosSanear.length>0) mensajeConfirm += `Se dará de alta ${nuevosSanear.length} bien(es) hallado(s) sin registro previo, con situación "Por sanear".\n`;
  if(mensajeConfirm && !confirm(mensajeConfirm+'¿Deseas continuar?')) return;

  let items = DB.get(KEYS.items);
  const cfg = DB.get(KEYS.config);

  // Da de alta los bienes hallados sin registro previo, con situación "Por
  // sanear": sin forzar fecha ni valor de adquisición (quedan en null/hoy hasta
  // que se complete el saneamiento desde la ficha del bien).
  const itemsSaneadosCreados = [];
  for(const r of nuevosSanear){
    const codigoSBN = lookupSBN(r.denominacion) || '';
    const correlativoSBN = await nextCorrelativoPorSBN(codigoSBN);
    const codigoInterno = buildCodigoPatrimonial(codigoSBN, correlativoSBN);
    const codigoUsoInterno = buildCodigoUsoInterno(await nextCorrelativoInterno());
    const nuevoItem = {
      id: uid('item'), codigoInterno, codigoAnioAnterior:'', codigoUsoInterno,
      denominacion: r.denominacion, codigoSBN,
      marca: r.marca||'', modelo: r.modelo||'', numeroSerie:'', color:'',
      estadoConservacion: r.estadoConservacion||'Bueno',
      aulaId: t.aulaId, aulaNombre: t.aulaNombre,
      valorAdquisicion: null, categoriaDeprecId: lookupCategoriaDeprec(r.denominacion),
      custodioId:'', custodioNombre: t.responsable||'',
      situacion:'Por sanear', pendienteSaneamiento:true,
      motivoSaneamiento: 'Hallado físicamente en el aula "'+t.aulaNombre+'" durante la toma de inventario del '+t.fecha+', sin registro previo (sin documentación de compra).',
      fotoId:'', fotosIds:[], fotosHistorial:[],
      observaciones: r.observacion||'',
      fechaRegistro: t.fecha, anio: cfg.anioFiscal, garantiaHasta:'',
      registradoPor: currentUser().usuario
    };
    items.push(nuevoItem);
    itemsSaneadosCreados.push(nuevoItem);
    await addMovimiento(nuevoItem.id, nuevoItem.codigoInterno, 'Alta', 'Hallado sin registro previo en toma de inventario del '+t.fecha+' — dado de alta como "Por sanear" por '+currentUser().usuario+'.');
  }

  const record = {
    id:uid('toma'), aulaId:t.aulaId, aulaNombre:t.aulaNombre, responsable:t.responsable,
    fecha:t.fecha, verificadoPor: currentUser().nombre||currentUser().usuario,
    items: t.registros.map(r=>({ itemId:r.itemId, codigoInterno:r.codigoInterno, denominacion:r.denominacion, encontrado:r.encontrado, estadoEncontrado:r.estadoEncontrado, observacion:r.observacion })),
    noRegistrados: itemsSaneadosCreados.map(i=>({ itemId:i.id, codigoInterno:i.codigoInterno, denominacion:i.denominacion, observacion:i.observaciones }))
  };
  await DB.save(KEYS.tomas, [...DB.get(KEYS.tomas), record]);

  for(const r of t.registros){
    const cambios = {};
    if(r.encontrado){ if(r.estadoEncontrado !== r.estadoRegistrado) cambios.estadoConservacion = r.estadoEncontrado; }
    else { cambios.situacion = 'Perdido/Sustraído'; }
    if(Object.keys(cambios).length>0){ items = items.map(it=>it.id===r.itemId?{...it, ...cambios}:it); }
    const detalle = r.encontrado
      ? ('Verificado en toma de inventario del '+t.fecha+' — presente'+(r.estadoEncontrado!==r.estadoRegistrado?(', estado actualizado a '+r.estadoEncontrado):'')+(r.observacion?(' — '+r.observacion):'')+' ('+currentUser().usuario+').')
      : ('Verificado en toma de inventario del '+t.fecha+' — NO encontrado'+(r.observacion?(' — '+r.observacion):'')+' ('+currentUser().usuario+').');
    await addMovimiento(r.itemId, r.codigoInterno, 'Observación', detalle);
  }
  await DB.save(KEYS.items, items);
  if(itemsSaneadosCreados.length) await registrarBitacora('Saneamiento (toma de inventario)', itemsSaneadosCreados.length+' bien(es) hallado(s) sin registro previo en "'+t.aulaNombre+'".');
  STATE.tomaEnCurso = null;
  let msgFinal = 'Toma de inventario registrada.';
  if(faltantes.length) msgFinal += ' '+faltantes.length+' bien(es) marcados como faltantes.';
  if(itemsSaneadosCreados.length) msgFinal += ' '+itemsSaneadosCreados.length+' bien(es) dado(s) de alta como "Por sanear".';
  toast(msgFinal, (faltantes.length||itemsSaneadosCreados.length)?'err':'ok');
  render();
  verTomaDetalle(record.id);
}
function verTomaDetalle(id){
  const t = DB.get(KEYS.tomas).find(x=>x.id===id); if(!t) return;
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal wide">
    <div class="m-h"><h3>Toma de inventario — ${esc(t.aulaNombre)}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <p><b>Fecha:</b> ${esc(t.fecha)} &nbsp;&nbsp; <b>Responsable del aula:</b> ${esc(t.responsable||'—')} &nbsp;&nbsp; <b>Verificado por:</b> ${esc(t.verificadoPor||'—')}</p>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Código</th><th>Denominación</th><th>Resultado</th><th>Estado encontrado</th><th>Observación</th></tr></thead>
        <tbody>${t.items.map(i=>`<tr><td class="mono">${esc(i.codigoInterno)}</td><td>${esc(i.denominacion)}</td>
          <td>${i.encontrado?'<span class="badge badge-good">Encontrado</span>':'<span class="badge badge-bad">No encontrado</span>'}</td>
          <td>${i.encontrado?estadoBadge(i.estadoEncontrado):'—'}</td><td>${esc(i.observacion||'—')}</td></tr>`).join('')}
        </tbody>
      </table></div>
      ${(t.noRegistrados&&t.noRegistrados.length>0)?`
      <h3 style="margin-top:16px;">🧾 Bienes hallados sin registro previo (saneamiento)</h3>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Código</th><th>Denominación</th><th>Observación</th><th></th></tr></thead>
        <tbody>${t.noRegistrados.map(i=>`<tr><td class="mono">${esc(i.codigoInterno)}</td><td>${esc(i.denominacion)}</td><td>${esc(i.observacion||'—')}</td><td><button class="btn btn-sm btn-ghost" data-goitem="${i.itemId}">Ver</button></td></tr>`).join('')}</tbody>
      </table></div>`:''}
    </div>
    <div class="m-f"><button class="btn" id="close">Cerrar</button><button class="btn btn-primary" id="print">Imprimir resultado</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#close').onclick=close;
  bg.addEventListener('click',e=>{if(e.target===bg)close();});
  bg.querySelectorAll('[data-goitem]').forEach(b=>b.addEventListener('click', ()=>{ close(); openItemView(b.dataset.goitem); }));
  bg.querySelector('#print').addEventListener('click', ()=>{
    const cfg = DB.get(KEYS.config);
    const body = `<h2>Resultado de Toma de Inventario Físico</h2>
    <p><b>I.E.:</b> ${esc(cfg.nombreIE)} &nbsp;&nbsp; <b>Aula/ambiente:</b> ${esc(t.aulaNombre)}</p>
    <p><b>Fecha:</b> ${esc(t.fecha)} &nbsp;&nbsp; <b>Responsable del aula:</b> ${esc(t.responsable||'—')} &nbsp;&nbsp; <b>Verificado por:</b> ${esc(t.verificadoPor||'—')}</p>
    <table><thead><tr><th>N°</th><th>Código</th><th>Denominación</th><th>Resultado</th><th>Estado</th><th>Observación</th></tr></thead>
    <tbody>${t.items.map((i,idx)=>`<tr><td>${idx+1}</td><td>${esc(i.codigoInterno)}</td><td>${esc(i.denominacion)}</td><td>${i.encontrado?'Encontrado':'NO ENCONTRADO'}</td><td>${esc(i.estadoEncontrado||'—')}</td><td>${esc(i.observacion||'')}</td></tr>`).join('')}</tbody></table>
    <div class="firma"><div>Verificado por</div><div>Responsable del aula</div></div>`;
    abrirVentanaImpresion('Resultado de toma de inventario', body);
  });
}

/* ---------------------------------------------------------------------
   16-B. COMPARATIVO INTERANUAL POR AULA
   Guarda "fotos" (snapshots) del inventario completo tal como está en un
   momento dado, y permite contrastar dos de esos momentos (o uno de ellos
   contra el inventario actual en vivo) para un aula o para todas: qué
   bienes siguen igual, cuáles cambiaron de estado o de aula (traslado),
   cuáles ya no aparecen (baja, pérdida, papelera) y cuáles son nuevos.
   No modifica ni depende de los bienes actuales: solo los lee y los
   compara contra la copia guardada. Requiere rol ADMIN para crear
   snapshots (afecta a todas las aulas), pero cualquiera con acceso al
   módulo puede consultar el comparativo.
   --------------------------------------------------------------------- */
function snapshotDeItemsActual(){
  // Copia liviana: solo los campos relevantes para comparar (sin fotos, para
  // no depender de archivos de imagen que podrían reemplazarse/borrarse luego).
  return DB.get(KEYS.items).map(i=>({
    id:i.id, codigoInterno:i.codigoInterno, codigoUsoInterno:i.codigoUsoInterno,
    codigoAnioAnterior:i.codigoAnioAnterior||'', denominacion:i.denominacion, codigoSBN:i.codigoSBN,
    marca:i.marca||'', modelo:i.modelo||'', numeroSerie:i.numeroSerie||'', color:i.color||'',
    estadoConservacion:i.estadoConservacion, situacion:i.situacion, aulaId:i.aulaId, aulaNombre:i.aulaNombre,
    custodioNombre:i.custodioNombre||'', valorAdquisicion:i.valorAdquisicion, fechaRegistro:i.fechaRegistro
  }));
}
async function abrirModalGuardarSnapshot(){
  if(!isAdmin()){ toast('Solo un administrador puede guardar el inventario del año.','err'); return; }
  const cfg = DB.get(KEYS.config);
  const items = DB.get(KEYS.items);
  const snaps = DB.get(KEYS.snapshots);
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal" style="max-width:480px;">
    <div class="m-h"><h3>Guardar inventario de este año</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="field"><label>Año / etiqueta *</label><input id="sn_anio" value="${esc(cfg.anioFiscal)}" placeholder="Ej. 2026"></div>
      <div class="field"><label>Nota (opcional)</label><input id="sn_nota" placeholder="Ej. Inventario de cierre de año, tomado en diciembre"></div>
      <div class="hint">Se guardará una copia de los <b>${items.length}</b> bien(es) registrados actualmente (aula, estado, situación, etc.), tal como están hoy. Esta copia queda fija y no cambia aunque luego edites los bienes; sirve como punto de comparación para años futuros.</div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="guardar">Guardar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click',e=>{if(e.target===bg)close();});
  bg.querySelector('#guardar').addEventListener('click', async ()=>{
    const anio = bg.querySelector('#sn_anio').value.trim();
    if(!anio){ toast('Indica el año o etiqueta del inventario.','err'); return; }
    const existente = snaps.find(s=>s.anio===anio);
    if(existente && !confirm(`Ya existe un inventario guardado con la etiqueta "${anio}" (del ${existente.fecha}, ${existente.items.length} bien(es)). ¿Deseas reemplazarlo por el estado actual?`)) return;
    const registro = {
      id: existente?existente.id:uid('snap'), anio, fecha:today(), nota: bg.querySelector('#sn_nota').value.trim(),
      creadoPor: currentUser().nombre||currentUser().usuario, items: snapshotDeItemsActual()
    };
    const lista = existente ? snaps.map(s=>s.id===existente.id?registro:s) : [...snaps, registro];
    await DB.save(KEYS.snapshots, lista);
    toast('Inventario del año "'+anio+'" guardado ('+registro.items.length+' bien(es)).','ok');
    close(); renderContent();
  });
}
// Devuelve la lista de bienes (formato snapshot) de una "fuente": 'actual' usa
// el inventario en vivo, o el id de un snapshot guardado.
function itemsDeFuente(fuenteId){
  if(fuenteId==='actual') return snapshotDeItemsActual();
  const snap = DB.get(KEYS.snapshots).find(s=>s.id===fuenteId);
  return snap ? snap.items : [];
}
// Igual que itemsDeFuente, pero respeta el alcance de aulas del usuario (un
// DOCENTE con aulas asignadas solo debe ver y comparar sus propias aulas,
// igual que en el resto del sistema).
function itemsDeFuenteScoped(fuenteId){
  const items = itemsDeFuente(fuenteId);
  const mis = misAulaIds();
  return mis===null ? items : items.filter(i=>mis.includes(i.aulaId));
}
function etiquetaDeFuente(fuenteId){
  if(fuenteId==='actual') return 'Inventario actual (en vivo)';
  const snap = DB.get(KEYS.snapshots).find(s=>s.id===fuenteId);
  return snap ? ('Inventario '+snap.anio+' (guardado el '+snap.fecha+')') : '—';
}
// Compara los bienes de la fuente A contra la fuente B, emparejando por el
// mismo id de bien (así detecta traslados, cambios de estado y bajas aunque
// el bien se haya editado, no solo si desaparece). Si el id ya no existe ni
// en items ni en snapshot, revisa la papelera para explicar el porqué.
function construirDiffInteranual(itemsA, itemsB){
  const itemsActuales = DB.get(KEYS.items);
  const papelera = DB.get(KEYS.papelera);
  const mapaB = new Map(itemsB.map(i=>[i.id,i]));
  const mapaAVisto = new Set();
  const filas = [];
  itemsA.forEach(a=>{
    mapaAVisto.add(a.id);
    const b = mapaB.get(a.id);
    if(b){
      const cambios = [];
      if(a.aulaId!==b.aulaId) cambios.push('Trasladado de "'+(a.aulaNombre||'—')+'" a "'+(b.aulaNombre||'—')+'"');
      if(a.estadoConservacion!==b.estadoConservacion) cambios.push('Estado: '+(a.estadoConservacion||'—')+' → '+(b.estadoConservacion||'—'));
      if(a.situacion!==b.situacion) cambios.push('Situación: '+(a.situacion||'—')+' → '+(b.situacion||'—'));
      if(a.custodioNombre!==b.custodioNombre) cambios.push('Responsable: '+(a.custodioNombre||'—')+' → '+(b.custodioNombre||'—'));
      filas.push({ tipo: cambios.length? 'cambio':'igual', a, b, detalle: cambios.join(' · ') });
    }else{
      const enPapelera = papelera.find(p=>p.id===a.id);
      const detalle = enPapelera
        ? 'Enviado a la papelera'+(enPapelera.fechaEliminacion?(' el '+enPapelera.fechaEliminacion):'')+(enPapelera.eliminadoPor?(' por '+enPapelera.eliminadoPor):'')
        : 'Ya no figura en el inventario (eliminado definitivamente o no incluido en la fuente comparada)';
      filas.push({ tipo:'baja', a, b:null, detalle });
    }
  });
  itemsB.forEach(b=>{
    if(!mapaAVisto.has(b.id)){
      filas.push({ tipo:'nuevo', a:null, b, detalle:'No existía en el inventario comparado (adquisición o registro nuevo)' });
    }
  });
  return filas;
}
function diffBadge(tipo){
  const map = { igual:'<span class="badge badge-good">Sin cambios</span>', cambio:'<span class="badge badge-warn">Cambió</span>',
    baja:'<span class="badge badge-bad">Ya no aparece</span>', nuevo:'<span class="badge badge-info">Nuevo</span>' };
  return map[tipo]||'';
}
function renderComparativo(){
  const snaps = [...DB.get(KEYS.snapshots)].sort((a,b)=>String(b.anio).localeCompare(String(a.anio)));
  const aulas = scopedAulas();
  if(snaps.length===0){
    return `<div class="card"><div class="card-b empty"><div class="big">⇔</div>
      Aún no has guardado ningún inventario de años anteriores.<br>
      ${isAdmin()?'Usa el botón "💾 Guardar inventario de este año" (arriba) para tomar la primera foto del inventario actual. El próximo año, guarda otra y ya podrás compararlas aquí.':'Pide a un administrador que guarde el inventario de este año para poder compararlo más adelante.'}
    </div></div>`;
  }
  const cmp = STATE.comparativo;
  if(!cmp.snapA) cmp.snapA = snaps[0].id; // por defecto, el más reciente guardado
  const opcionesFuente = (seleccion)=>[
    ...snaps.map(s=>`<option value="${s.id}" ${seleccion===s.id?'selected':''}>${esc(s.anio)} — guardado ${esc(s.fecha)} (${s.items.length} bien(es))</option>`),
    `<option value="actual" ${seleccion==='actual'?'selected':''}>Inventario actual (en vivo)</option>`
  ].join('');
  const itemsA = itemsDeFuenteScoped(cmp.snapA).filter(i=>!cmp.aulaA || i.aulaId===cmp.aulaA);
  const itemsB = itemsDeFuenteScoped(cmp.snapB).filter(i=>!cmp.aulaB || i.aulaId===cmp.aulaB);
  // El diff se calcula sobre el universo (ya acotado a las aulas visibles del
  // usuario) de ambas fuentes, sin filtrar por aula todavía, para poder avisar
  // si un bien se trasladó fuera del aula filtrada; luego se muestra solo lo
  // relevante a lo que el usuario está viendo.
  const diffCompleto = construirDiffInteranual(itemsDeFuenteScoped(cmp.snapA), itemsDeFuenteScoped(cmp.snapB));
  const idsRelevantes = new Set([...itemsA.map(i=>i.id), ...itemsB.map(i=>i.id)]);
  const diff = diffCompleto.filter(f=>(f.a&&idsRelevantes.has(f.a.id))||(f.b&&idsRelevantes.has(f.b.id)));
  const resumen = { igual:diff.filter(f=>f.tipo==='igual').length, cambio:diff.filter(f=>f.tipo==='cambio').length,
    baja:diff.filter(f=>f.tipo==='baja').length, nuevo:diff.filter(f=>f.tipo==='nuevo').length };
  const filaHTML = (it, esA)=>{
    if(!it) return `<tr class="diff-vacio"><td colspan="5" class="hint">— no está en este lado —</td></tr>`;
    const f = diff.find(x=> esA ? (x.a&&x.a.id===it.id) : (x.b&&x.b.id===it.id));
    return `<tr>
      <td class="mono">${esc(it.codigoInterno)}</td><td>${esc(it.denominacion)}</td>
      <td>${esc([it.marca,it.modelo].filter(Boolean).join(' / ')||'—')}</td>
      <td>${esc(it.aulaNombre||'—')}</td><td>${f?diffBadge(f.tipo):''}</td>
    </tr>`;
  };
  return `
  <div class="card" style="margin-bottom:16px;"><div class="card-b">
    <div class="grid g4">
      <div class="field"><label>Año / fuente A (izquierda)</label><select id="cmp_snapA">${opcionesFuente(cmp.snapA)}</select></div>
      <div class="field"><label>Aula — filtro lado A</label><select id="cmp_aulaA"><option value="">Todas las aulas</option>${aulas.map(a=>`<option value="${a.id}" ${cmp.aulaA===a.id?'selected':''}>${esc(a.aulaLabel||a.nombre)}</option>`).join('')}</select></div>
      <div class="field"><label>Año / fuente B (derecha)</label><select id="cmp_snapB">${opcionesFuente(cmp.snapB)}</select></div>
      <div class="field"><label>Aula — filtro lado B</label><select id="cmp_aulaB"><option value="">Todas las aulas</option>${aulas.map(a=>`<option value="${a.id}" ${cmp.aulaB===a.id?'selected':''}>${esc(a.aulaLabel||a.nombre)}</option>`).join('')}</select></div>
    </div>
    <div class="hint" style="margin-top:6px;">Los bienes se emparejan por su identidad interna (aunque cambien de estado o de aula), así que un traslado o una baja se detecta aunque el bien siga existiendo en el sistema. Si un bien fue eliminado por completo, se revisa la papelera para explicar qué pasó con él.</div>
  </div></div>

  <div class="grid g4" style="margin-bottom:16px;">
    <div class="card kpi"><div class="lbl">Sin cambios</div><div class="val">${resumen.igual}</div></div>
    <div class="card kpi"><div class="lbl">Cambiaron (estado/aula/resp.)</div><div class="val">${resumen.cambio}</div></div>
    <div class="card kpi"><div class="lbl">Ya no aparecen</div><div class="val">${resumen.baja}</div></div>
    <div class="card kpi"><div class="lbl">Nuevos</div><div class="val">${resumen.nuevo}</div></div>
  </div>

  <div class="grid g2" style="margin-bottom:16px;align-items:start;">
    <div class="card">
      <div class="card-h"><h3>${esc(etiquetaDeFuente(cmp.snapA))}${cmp.aulaA?(' — '+esc((aulas.find(a=>a.id===cmp.aulaA)||{}).aulaLabel||'')):''}</h3></div>
      <div class="tbl-wrap"><table><thead><tr><th>Código</th><th>Denominación</th><th>Marca/Modelo</th><th>Aula</th><th>Resultado</th></tr></thead>
      <tbody>${itemsA.map(it=>filaHTML(it,true)).join('') || '<tr><td colspan="5" class="empty">Sin bienes con este filtro.</td></tr>'}</tbody></table></div>
    </div>
    <div class="card">
      <div class="card-h"><h3>${esc(etiquetaDeFuente(cmp.snapB))}${cmp.aulaB?(' — '+esc((aulas.find(a=>a.id===cmp.aulaB)||{}).aulaLabel||'')):''}</h3></div>
      <div class="tbl-wrap"><table><thead><tr><th>Código</th><th>Denominación</th><th>Marca/Modelo</th><th>Aula</th><th>Resultado</th></tr></thead>
      <tbody>${itemsB.map(it=>filaHTML(it,false)).join('') || '<tr><td colspan="5" class="empty">Sin bienes con este filtro.</td></tr>'}</tbody></table></div>
    </div>
  </div>

  <div class="card">
    <div class="card-h" style="display:flex;align-items:center;gap:10px;"><h3>Detalle de diferencias encontradas</h3><span style="flex:1"></span>
      <button class="btn btn-primary" id="cmp_exportar">🖨️ Exportar PDF de diferencias</button></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Resultado</th><th>Código</th><th>Denominación</th><th>Aula (A)</th><th>Aula (B)</th><th>Detalle</th></tr></thead>
      <tbody>${diff.filter(f=>f.tipo!=='igual').sort((x,y)=>x.tipo.localeCompare(y.tipo)).map(f=>{
        const ref = f.a||f.b;
        return `<tr><td>${diffBadge(f.tipo)}</td><td class="mono">${esc(ref.codigoInterno)}</td><td>${esc(ref.denominacion)}</td>
        <td>${esc(f.a?(f.a.aulaNombre||'—'):'—')}</td><td>${esc(f.b?(f.b.aulaNombre||'—'):'—')}</td><td>${esc(f.detalle)}</td></tr>`;
      }).join('') || '<tr><td colspan="6" class="empty">No se encontraron diferencias con los filtros actuales: el inventario se mantiene igual.</td></tr>'}
      </tbody>
    </table></div>
  </div>`;
}
function imprimirComparativoInteranual(){
  const cfg = DB.get(KEYS.config);
  const cmp = STATE.comparativo;
  const aulas = DB.get(KEYS.aulas);
  const diffCompleto = construirDiffInteranual(itemsDeFuenteScoped(cmp.snapA), itemsDeFuenteScoped(cmp.snapB));
  const itemsA = itemsDeFuenteScoped(cmp.snapA).filter(i=>!cmp.aulaA || i.aulaId===cmp.aulaA);
  const itemsB = itemsDeFuenteScoped(cmp.snapB).filter(i=>!cmp.aulaB || i.aulaId===cmp.aulaB);
  const idsRelevantes = new Set([...itemsA.map(i=>i.id), ...itemsB.map(i=>i.id)]);
  const diff = diffCompleto.filter(f=>(f.a&&idsRelevantes.has(f.a.id))||(f.b&&idsRelevantes.has(f.b.id)));
  const resumen = { igual:diff.filter(f=>f.tipo==='igual').length, cambio:diff.filter(f=>f.tipo==='cambio').length,
    baja:diff.filter(f=>f.tipo==='baja').length, nuevo:diff.filter(f=>f.tipo==='nuevo').length };
  const aulaLabelA = cmp.aulaA ? ((aulas.find(a=>a.id===cmp.aulaA)||{}).aulaLabel||'—') : 'Todas las aulas';
  const aulaLabelB = cmp.aulaB ? ((aulas.find(a=>a.id===cmp.aulaB)||{}).aulaLabel||'—') : 'Todas las aulas';
  const filasNoIguales = diff.filter(f=>f.tipo!=='igual').sort((x,y)=>x.tipo.localeCompare(y.tipo));
  const resultadoTexto = { cambio:'Cambió', baja:'Ya no aparece', nuevo:'Nuevo' };
  const body = `
    <div class="ficha">
      <div class="ficha-header"><div class="logo-slot">${logoDeConfig(cfg)?`<img src="${logoDeConfig(cfg)}">`:''}</div>
        <div class="meta-center"><h3>Comparativo Interanual de Inventario Patrimonial</h3><div>${esc(cfg.nombreIE)} — UGEL ${esc(cfg.ugel||'—')}</div></div></div>
      <table class="meta-table" style="margin:0 auto 10px;"><tr>
        <td><b>Comparado A:</b> ${esc(etiquetaDeFuente(cmp.snapA))} (${esc(aulaLabelA)})</td>
        <td style="padding-left:24px;"><b>Comparado B:</b> ${esc(etiquetaDeFuente(cmp.snapB))} (${esc(aulaLabelB)})</td>
      </tr></table>
      <table class="meta-table" style="margin:0 auto 10px;"><tr>
        <td><b>Sin cambios:</b> ${resumen.igual}</td><td style="padding-left:18px;"><b>Cambiaron:</b> ${resumen.cambio}</td>
        <td style="padding-left:18px;"><b>Ya no aparecen:</b> ${resumen.baja}</td><td style="padding-left:18px;"><b>Nuevos:</b> ${resumen.nuevo}</td>
      </tr></table>
      <table class="bienes-table"><thead><tr><th>N°</th><th>Resultado</th><th>Código</th><th>Denominación</th><th>Aula (A)</th><th>Aula (B)</th><th>Detalle</th></tr></thead>
      <tbody>${filasNoIguales.map((f,idx)=>{ const ref=f.a||f.b; return `<tr><td>${idx+1}</td><td>${resultadoTexto[f.tipo]||f.tipo}</td><td>${esc(ref.codigoInterno)}</td>
        <td>${esc(ref.denominacion)}</td><td>${esc(f.a?(f.a.aulaNombre||'—'):'—')}</td><td>${esc(f.b?(f.b.aulaNombre||'—'):'—')}</td><td>${esc(f.detalle)}</td></tr>`; }).join('')
        || '<tr><td colspan="7">No se encontraron diferencias: el inventario comparado se mantiene igual.</td></tr>'}</tbody></table>
      <div class="firma"><div>Elaborado por</div><div>Visto bueno — Comisión de Inventario</div></div>
    </div>`;
  abrirVentanaImpresion('Comparativo interanual de inventario', body, 'landscape');
}

/* ---------------------------------------------------------------------
   16-C. MANTENIMIENTOS E INCIDENCIAS
   Un mismo registro cubre tanto el mantenimiento programado (preventivo)
   como una incidencia reportada (falla, avería, etc). Mientras el registro
   no está "Resuelto", el bien queda marcado con la situación
   "En mantenimiento" (la misma que ya usa el resto del sistema); al
   resolverse, vuelve a "Activo".
   --------------------------------------------------------------------- */
function mantEstadoBadge(e){ const cls = e==='Resuelto'?'badge-good':e==='En proceso'?'badge-warn':'badge-bad'; return `<span class="badge ${cls}">${esc(e)}</span>`; }
function mantPrioridadBadge(p){ const cls = p==='Alta'?'badge-bad':p==='Media'?'badge-warn':'badge-info'; return `<span class="badge ${cls}">${esc(p||'—')}</span>`; }
// Vista de "Calendario" de mantenimientos: agrupa por mes los registros que
// tienen "Próxima fecha programada" (mantenimiento preventivo) y siguen sin
// resolver, para planificar en vez de enterarse recién con la falla. Los
// registros con recurrencia mensual configurada siguen reapareciendo aquí
// automáticamente cada vez que se resuelve el anterior (ver openMantenimientoModal).
function renderMantenimientosCalendario(){
  const idsVisibles = new Set(scopedItems().map(i=>i.id));
  const regs = [...DB.get(KEYS.mantenimientos)]
    .filter(m=>(isAdmin()||idsVisibles.has(m.itemId)) && m.fechaProgramada && m.estado!=='Resuelto')
    .sort((a,b)=>(a.fechaProgramada||'').localeCompare(b.fechaProgramada||''));
  const grupos = new Map();
  regs.forEach(m=>{ const clave=(m.fechaProgramada||'').slice(0,7); if(!grupos.has(clave)) grupos.set(clave, []); grupos.get(clave).push(m); });
  const claves = [...grupos.keys()].sort();
  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const etiquetaMes = clave=>{ const [y,m]=clave.split('-'); return MESES[Number(m)-1]+' de '+y; };
  if(claves.length===0){
    return `<div class="card"><div class="card-b"><div class="empty"><div class="big">📅</div>No hay mantenimientos con fecha programada pendientes.<br>Marca "Repetir automáticamente" o agrega una "Próxima fecha programada" al registrar un mantenimiento para que aparezca en este calendario.</div></div></div>`;
  }
  return claves.map(clave=>{
    const items = grupos.get(clave);
    return `<div class="card" style="margin-bottom:14px;"><div class="card-h"><h3 style="text-transform:capitalize;">${esc(etiquetaMes(clave))}</h3><span class="hint">${items.length} pendiente(s)</span></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Fecha</th><th>Urgencia</th><th>Bien</th><th>Descripción</th><th>Aula</th><th></th></tr></thead>
      <tbody>${items.map(m=>{
        const d = diasHasta(m.fechaProgramada);
        const urgCls = d<0 ? 'badge-bad' : (d<=15 ? 'badge-warn' : 'badge-info');
        const urgTxt = d<0 ? ('Vencido hace '+Math.abs(d)+' día(s)') : (d===0?'Hoy':('En '+d+' día(s)'));
        return `<tr><td class="mono">${esc(m.fechaProgramada)}</td><td><span class="badge ${urgCls}">${urgTxt}</span></td>
        <td class="mono">${esc(m.codigoInterno)}<div class="hint">${esc(m.denominacion)}</div></td>
        <td>${esc(m.descripcion)}${m.recurrenciaMeses?` <span class="badge badge-info" title="Se repite cada ${m.recurrenciaMeses} mes(es)">🔁 c/${m.recurrenciaMeses}m</span>`:''}</td>
        <td>${esc(m.aulaNombre||'—')}</td>
        <td><button class="btn btn-sm btn-ghost" data-gomantid="${m.id}">${canEdit()?'Editar':'Ver'}</button></td></tr>`;
      }).join('')}</tbody>
    </table></div></div>`;
  }).join('');
}
function renderMantenimientos(){
  if(STATE.mantVista==='calendario') return renderMantenimientosCalendario();
  const idsVisibles = new Set(scopedItems().map(i=>i.id));
  let regs = [...DB.get(KEYS.mantenimientos)].filter(m=>isAdmin()||idsVisibles.has(m.itemId)).sort((a,b)=>(b.fechaReporte||'').localeCompare(a.fechaReporte||''));
  const altaAbiertos = regs.filter(m=>m.estado!=='Resuelto' && m.prioridad==='Alta').length;
  const anioFiscal = String(DB.get(KEYS.config).anioFiscal);
  const regsDelAnio = regs.filter(m=>(m.fechaReporte||'').slice(0,4)===anioFiscal);
  const costoTotalAnio = regsDelAnio.reduce((a,m)=>a+(Number(m.costo)||0),0);
  const conCosto = regsDelAnio.filter(m=>m.costo!=null).length;
  // Datos del bien (marca, modelo, estado de conservación) para mostrarlos
  // junto a cada registro, igual que se hace al elegir bienes para un préstamo.
  const itemsById = new Map(DB.get(KEYS.items).map(i=>[i.id,i]));
  const aulasConRegs = [...new Map(regs.map(m=>[m.aulaNombre||'—', m.aulaNombre||'—']).map(([k,v])=>[k,v])).values()].sort((a,b)=>a.localeCompare(b));
  const f = STATE.filtersMant;
  regs = regs.filter(m=>{
    const it = itemsById.get(m.itemId);
    if(f.q){ const hay=(m.codigoInterno+' '+m.denominacion+' '+(it&&it.marca||'')+' '+(it&&it.modelo||'')+' '+(it&&it.numeroSerie||'')+' '+(it&&it.color||'')).toLowerCase(); if(!hay.includes(f.q.toLowerCase())) return false; }
    if(f.aula && (m.aulaNombre||'—')!==f.aula) return false;
    if(f.tipo && m.tipo!==f.tipo) return false;
    if(f.prioridad && m.prioridad!==f.prioridad) return false;
    if(f.estado && m.estado!==f.estado) return false;
    return true;
  });
  return `
  ${altaAbiertos>0?`<div class="note-banner" style="background:var(--bad-soft);border-color:#e6b3ba;color:var(--bad);">⚠ Tienes <b>${altaAbiertos}</b> incidencia(s) de prioridad <b>Alta</b> sin resolver.</div>`:''}
  ${conCosto>0?`<div class="note-banner" style="background:var(--primary-soft);border-color:#c7d3de;color:var(--primary);">💰 Costo total de mantenimientos/incidencias registrado en ${anioFiscal}: <b>${money(costoTotalAnio)}</b> (${conCosto} registro(s) con costo).</div>`:''}
  <div class="card"><div class="card-b" style="padding-bottom:0;">
    <div class="grid g2">
      <input class="search" id="mfq" placeholder="Buscar por código, denominación, marca o modelo…" value="${esc(f.q)}">
      <select id="mfaula"><option value="">— Todas las aulas —</option>${aulasConRegs.map(a=>`<option value="${esc(a)}" ${f.aula===a?'selected':''}>${esc(a)}</option>`).join('')}</select>
    </div>
    <div class="grid g3">
      <select id="mftipo"><option value="">— Todos los tipos —</option>${TIPOS_MANT.map(t=>`<option value="${esc(t)}" ${f.tipo===t?'selected':''}>${esc(t)}</option>`).join('')}</select>
      <select id="mfprioridad"><option value="">— Todas las prioridades —</option>${PRIORIDADES_MANT.map(p=>`<option value="${esc(p)}" ${f.prioridad===p?'selected':''}>${esc(p)}</option>`).join('')}</select>
      <select id="mfestado"><option value="">— Todos los estados —</option>${ESTADOS_MANT.map(e=>`<option value="${esc(e)}" ${f.estado===e?'selected':''}>${esc(e)}</option>`).join('')}</select>
    </div>
    <div style="margin:8px 0 4px;"><button class="btn btn-sm" id="mfclear">Limpiar filtros</button></div>
  </div>
  <div class="tbl-wrap"><table>
    <thead><tr><th>Fecha</th><th>Bien</th><th>Marca / Modelo</th><th>Serie</th><th>Color</th><th>Estado del bien</th><th>Aula</th><th>Tipo</th><th>Prioridad</th><th>Descripción</th><th>Estado</th><th></th></tr></thead>
    <tbody>${regs.map(m=>{ const it=itemsById.get(m.itemId); return `<tr>
      <td>${esc(m.fechaReporte)}</td><td class="mono">${esc(m.codigoInterno)}<div class="hint">${esc(m.denominacion)}</div></td>
      <td>${esc((it&&it.marca)||'—')} ${esc((it&&it.modelo)||'')}</td>
      <td>${esc((it&&it.numeroSerie)||'—')}</td>
      <td>${esc((it&&it.color)||'—')}</td>
      <td>${it?estadoBadge(it.estadoConservacion):'<span class="hint">—</span>'}</td>
      <td>${esc(m.aulaNombre||'—')}</td><td>${esc(m.tipo)}${m.recurrenciaMeses?` <span class="badge badge-info" title="Se repite cada ${m.recurrenciaMeses} mes(es)">🔁 c/${m.recurrenciaMeses}m</span>`:''}</td><td>${mantPrioridadBadge(m.prioridad)}</td>
      <td>${esc(m.descripcion)}</td><td>${mantEstadoBadge(m.estado)}</td>
      <td><button class="btn btn-sm btn-ghost" data-editmant="${m.id}">${canEdit()?'Editar':'Ver'}</button></td>
    </tr>`;}).join('')}
    ${regs.length===0?'<tr><td colspan="12" class="empty"><div class="big">⚒</div>Aún no hay mantenimientos ni incidencias registradas.</td></tr>':''}
    </tbody></table></div></div>`;
}
function openMantenimientoModal(id){
  if(!guardEdit()) return;
  const regs = DB.get(KEYS.mantenimientos);
  const m = id?regs.find(x=>x.id===id):null;
  const items = scopedItems().filter(i=>i.situacion!=='De baja');
  if(items.length===0){ toast('No hay bienes disponibles para registrar.','err'); return; }
  const denominacionesUnicas = [...new Set(items.map(i=>i.denominacion))].sort((a,b)=>a.localeCompare(b));
  const aulasConBienes = [...new Map(items.map(i=>[i.aulaId, i.aulaNombre||'—'])).entries()];
  let selectedItemId = m ? m.itemId : (items.length===1?items[0].id:'');
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal">
    <div class="m-h"><h3>${m?'Editar registro':'Nuevo mantenimiento / incidencia'}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="field"><label>Bien *</label>
        <div class="grid g2">
          <div class="field"><label>Filtrar por nombre de bien</label>
            <select id="mt_filtro_nombre"><option value="">— Todos los tipos de bien —</option>${denominacionesUnicas.map(d=>`<option value="${esc(d)}">${esc(d)} (${items.filter(i=>i.denominacion===d).length})</option>`).join('')}</select>
          </div>
          <div class="field"><label>Filtrar por aula / ambiente</label>
            <select id="mt_filtro_aula"><option value="">— Todas las aulas —</option>${aulasConBienes.map(([id,nom])=>`<option value="${esc(id)}">${esc(nom)}</option>`).join('')}</select>
          </div>
        </div>
        <input id="mt_filtro" placeholder="Buscar por código, marca o N° de serie…" style="margin-bottom:6px;">
        <div class="checklist" id="mt_bienes_list" style="max-height:220px;"></div>
      </div>
      <div class="grid g2">
        <div class="field"><label>Tipo *</label><select id="mt_tipo">${TIPOS_MANT.map(t=>`<option ${m&&m.tipo===t?'selected':''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label>Prioridad</label><select id="mt_prioridad">${PRIORIDADES_MANT.map(p=>`<option ${(m?m.prioridad===p:p==='Media')?'selected':''}>${p}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Descripción del problema / trabajo *</label><textarea id="mt_desc" rows="2">${esc(m?m.descripcion:'')}</textarea></div>
      <div class="grid g2">
        <div class="field"><label>Fecha de reporte</label><input id="mt_fecha" type="date" value="${esc(m?m.fechaReporte:today())}"></div>
        <div class="field"><label>Estado *</label><select id="mt_estado">${ESTADOS_MANT.map(e=>`<option ${m&&m.estado===e?'selected':''}>${e}</option>`).join('')}</select></div>
      </div>
      <div class="field" id="mt_fp_wrap" style="display:${['Mantenimiento programado','Calibración'].includes(m?m.tipo:'')?'block':'none'};">
        <label id="mt_fp_label">Próxima fecha programada (opcional)</label>
        <input id="mt_fechaprog" type="date" value="${esc(m&&m.fechaProgramada?m.fechaProgramada:'')}">
        <div class="hint">Si la dejas llena, el sistema te avisará en el Panel general cuando esté por vencer.</div>
        <label style="display:flex;align-items:center;gap:6px;margin-top:8px;font-weight:400;">
          <input type="checkbox" id="mt_recurrente" ${m&&m.recurrenciaMeses?'checked':''}> Repetir automáticamente al marcar como "Resuelto"
        </label>
        <div id="mt_recurrente_wrap" style="display:${m&&m.recurrenciaMeses?'block':'none'};margin-top:6px;">
          <label>Repetir cada (meses)</label>
          <input id="mt_recurrenciaMeses" type="number" min="1" max="36" value="${m&&m.recurrenciaMeses?esc(m.recurrenciaMeses):(m&&m.tipo==='Calibración'?12:6)}">
        </div>
      </div>
      <div class="field" id="mt_siniestro_wrap" style="display:${(m?m.tipo:'')==='Siniestro / Pérdida'?'block':'none'};">
        <label>N° de denuncia policial (opcional)</label>
        <input id="mt_denuncia" value="${esc(m?(m.numeroDenuncia||''):'')}" placeholder="Ej. DENUNCIA N° 123-2026-COMISARÍA...">
        <div class="hint">Mientras este registro no esté "Resuelto", el bien quedará marcado como <b>Perdido/Sustraído</b> en el inventario. Al marcarlo "Resuelto" (bien recuperado), vuelve a quedar Activo.</div>
      </div>
      <div class="field" id="mt_calib_wrap" style="display:${(m?m.tipo:'')==='Calibración'?'block':'none'};">
        <div class="grid g2">
          <div class="field"><label>Entidad / laboratorio calibrador</label><input id="mt_entidadcalib" value="${esc(m?(m.entidadCalibradora||''):'')}" placeholder="Ej. Laboratorio acreditado INACAL N°..."></div>
          <div class="field"><label>N° de certificado de calibración</label><input id="mt_certcalib" value="${esc(m?(m.numeroCertificado||''):'')}" placeholder="Ej. CERT-2026-00123"></div>
        </div>
        <div class="field"><label>Resultado de la calibración</label><select id="mt_resultadocalib"><option value="">— Sin resultado aún —</option>${RESULTADOS_CALIB.map(r=>`<option ${m&&m.resultadoCalibracion===r?'selected':''}>${r}</option>`).join('')}</select></div>
        <div class="hint">Registra aquí el instrumento de precisión (balanza, tensiómetro, equipo de laboratorio, etc.) elegido arriba como "Bien". La fecha de próxima calibración se define abajo, y si activas "Repetir automáticamente" el sistema generará el siguiente recordatorio solo al cerrar este registro como "Resuelto".</div>
      </div>
      <div class="grid g2">
        <div class="field"><label>Costo estimado / final (S/., opcional)</label><input id="mt_costo" type="number" step="0.01" min="0" value="${m&&m.costo!=null?esc(m.costo):''}"></div>
        <div class="field"><label>Proveedor / técnico (opcional)</label><input id="mt_proveedor" value="${esc(m?(m.proveedor||''):'')}"></div>
      </div>
      <div class="field"><label>Solución / observaciones de cierre</label><textarea id="mt_solucion" rows="2">${esc(m?(m.solucion||''):'')}</textarea></div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Guardar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click',e=>{if(e.target===bg)close();});
  bg.querySelector('#mt_filtro').addEventListener('input', renderBienesList);
  bg.querySelector('#mt_filtro_nombre').addEventListener('change', renderBienesList);
  bg.querySelector('#mt_filtro_aula').addEventListener('change', renderBienesList);
  function itemsFiltradosMant(){
    const q = bg.querySelector('#mt_filtro').value.trim().toLowerCase();
    const nombreF = bg.querySelector('#mt_filtro_nombre').value;
    const aulaF = bg.querySelector('#mt_filtro_aula').value;
    return items.filter(i=>{
      if(nombreF && i.denominacion!==nombreF) return false;
      if(aulaF && i.aulaId!==aulaF) return false;
      if(q && !((i.codigoInterno+' '+i.denominacion+' '+(i.marca||'')+' '+(i.modelo||'')+' '+(i.numeroSerie||'')+' '+(i.color||'')).toLowerCase().includes(q))) return false;
      return true;
    });
  }
  function renderBienesList(){
    const filtrados = itemsFiltradosMant();
    const list = bg.querySelector('#mt_bienes_list');
    list.innerHTML = filtrados.map(i=>{
      return `<label><input type="radio" name="mt_item_radio" value="${i.id}" ${selectedItemId===i.id?'checked':''}> <span class="mono">${esc(i.codigoInterno)}</span> — ${esc(i.denominacion)} (${esc(i.aulaNombre||'—')}) — ${fichaBienHTML(i)} — ${estadoBadge(i.estadoConservacion)}</label>`;
    }).join('') || '<div class="hint">No hay bienes disponibles que coincidan con el filtro.</div>';
    list.querySelectorAll('input[name="mt_item_radio"]').forEach(r=>r.addEventListener('change', e=>{ selectedItemId = e.target.value; }));
  }
  renderBienesList();
  bg.querySelector('#mt_tipo').addEventListener('change', e=>{
    const esCalib = e.target.value==='Calibración';
    bg.querySelector('#mt_fp_wrap').style.display = (e.target.value==='Mantenimiento programado'||esCalib) ? 'block' : 'none';
    bg.querySelector('#mt_fp_label').textContent = esCalib ? 'Próxima fecha de calibración (opcional)' : 'Próxima fecha programada (opcional)';
    bg.querySelector('#mt_siniestro_wrap').style.display = e.target.value==='Siniestro / Pérdida' ? 'block' : 'none';
    bg.querySelector('#mt_calib_wrap').style.display = esCalib ? 'block' : 'none';
  });
  const recChk = bg.querySelector('#mt_recurrente');
  if(recChk) recChk.addEventListener('change', e=>{ bg.querySelector('#mt_recurrente_wrap').style.display = e.target.checked ? 'block' : 'none'; });
  bg.querySelector('#save').addEventListener('click', async ()=>{
    const itemId = selectedItemId;
    const descripcion = bg.querySelector('#mt_desc').value.trim();
    const estado = bg.querySelector('#mt_estado').value;
    if(!itemId||!descripcion){ toast('Selecciona el bien y escribe la descripción.','err'); return; }
    const it = DB.get(KEYS.items).find(x=>x.id===itemId);
    const data = {
      id: m?m.id:uid('mant'), itemId, codigoInterno:it.codigoInterno, denominacion:it.denominacion, aulaNombre:it.aulaNombre,
      tipo: bg.querySelector('#mt_tipo').value, prioridad: bg.querySelector('#mt_prioridad').value,
      descripcion, fechaReporte: bg.querySelector('#mt_fecha').value || today(),
      fechaProgramada: bg.querySelector('#mt_fechaprog') ? (bg.querySelector('#mt_fechaprog').value || '') : '',
      recurrenciaMeses: (bg.querySelector('#mt_recurrente') && bg.querySelector('#mt_recurrente').checked) ? (Number(bg.querySelector('#mt_recurrenciaMeses').value)||6) : null,
      estado, costo: bg.querySelector('#mt_costo').value.trim()!==''?Number(bg.querySelector('#mt_costo').value):null,
      proveedor: bg.querySelector('#mt_proveedor').value.trim(), solucion: bg.querySelector('#mt_solucion').value.trim(),
      numeroDenuncia: bg.querySelector('#mt_denuncia') ? bg.querySelector('#mt_denuncia').value.trim() : '',
      entidadCalibradora: bg.querySelector('#mt_entidadcalib') ? bg.querySelector('#mt_entidadcalib').value.trim() : '',
      numeroCertificado: bg.querySelector('#mt_certcalib') ? bg.querySelector('#mt_certcalib').value.trim() : '',
      resultadoCalibracion: bg.querySelector('#mt_resultadocalib') ? bg.querySelector('#mt_resultadocalib').value : '',
      fechaCierre: estado==='Resuelto' ? ((m&&m.fechaCierre)?m.fechaCierre:today()) : '',
      reportadoPor: m?(m.reportadoPor||currentUser().usuario):currentUser().usuario
    };
    let list = DB.get(KEYS.mantenimientos);
    const yaEstabaResuelto = m && m.estado==='Resuelto';
    list = m? list.map(x=>x.id===m.id?data:x) : [...list, data];
    if(estado==='Resuelto' && data.recurrenciaMeses && data.fechaProgramada && !yaEstabaResuelto){
      const siguienteFecha = sumarMesesISO(data.fechaProgramada, data.recurrenciaMeses);
      list = [...list, {
        id: uid('mant'), itemId, codigoInterno: it.codigoInterno, denominacion: it.denominacion, aulaNombre: it.aulaNombre,
        tipo: 'Mantenimiento programado', prioridad: data.prioridad, descripcion: data.descripcion,
        fechaReporte: today(), fechaProgramada: siguienteFecha, recurrenciaMeses: data.recurrenciaMeses,
        estado: 'Abierto', costo: null, proveedor: data.proveedor, solucion: '', fechaCierre: '',
        reportadoPor: currentUser().usuario
      }];
      toast('Se generó automáticamente el siguiente mantenimiento programado para el '+siguienteFecha+'.', 'ok');
    }
    await DB.save(KEYS.mantenimientos, list);
    let itemsList = DB.get(KEYS.items);
    // La calibración no saca al bien de servicio (a diferencia de una incidencia,
    // mantenimiento o siniestro): un instrumento normalmente sigue en uso mientras
    // se coordina o espera el resultado de su calibración periódica.
    if(data.tipo!=='Calibración'){
      if(estado==='Resuelto'){
        if(it.situacion==='En mantenimiento' || it.situacion==='Perdido/Sustraído') itemsList = itemsList.map(x=>x.id===itemId?{...x, situacion:'Activo'}:x);
      } else {
        const nuevaSituacion = data.tipo==='Siniestro / Pérdida' ? 'Perdido/Sustraído' : 'En mantenimiento';
        itemsList = itemsList.map(x=>x.id===itemId?{...x, situacion:nuevaSituacion}:x);
      }
    }
    await DB.save(KEYS.items, itemsList);
    const detalleCalib = data.tipo==='Calibración' ? (' — '+(data.entidadCalibradora?('Entidad: '+data.entidadCalibradora+'. '):'')+(data.numeroCertificado?('Certificado: '+data.numeroCertificado+'. '):'')+(data.resultadoCalibracion?('Resultado: '+data.resultadoCalibracion+'.'):'')) : '';
    await addMovimiento(itemId, it.codigoInterno, 'Mantenimiento', data.tipo+' — '+descripcion+' ('+estado+')'+(data.numeroDenuncia?(' — Denuncia: '+data.numeroDenuncia):'')+detalleCalib+' registrado por '+currentUser().usuario+'.');
    if(data.tipo==='Siniestro / Pérdida'){ await registrarBitacora(m?'Editar siniestro/pérdida':'Registrar siniestro/pérdida', it.codigoInterno+' — '+it.denominacion+' ('+estado+')'+(data.numeroDenuncia?(' — Denuncia: '+data.numeroDenuncia):'')); }
    toast(m?'Registro actualizado.':'Registro guardado.','ok');
    close(); renderContent();
  });
}

/* ---------------------------------------------------------------------
   16. CARGA MASIVA
   --------------------------------------------------------------------- */
function renderMasiva(){
  return `<div class="card"><div class="card-b">
    <h3 style="margin-bottom:6px;">Carga masiva de bienes</h3>
    <div class="hint" style="margin-bottom:14px;">Registra muchos bienes de una sola vez, pegando una lista o subiendo un archivo CSV. El código SBN se detecta automáticamente si la denominación coincide con el catálogo.</div>
    <button class="btn btn-primary" id="cm_abrir">+ Nueva carga masiva</button>
    <button class="btn" id="cm_plantilla">Descargar plantilla CSV</button>
  </div></div>`;
}
function abrirModalMasiva(){
  const aulas = scopedAulas();
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal wide">
    <div class="m-h"><h3>Carga masiva de bienes</h3><button class="close-x">&times;</button></div>
    <div class="m-b"><fieldset><legend>1. Elige el aula destino</legend>
      <select id="cm_aula"><option value="">— Seleccionar —</option>${aulas.map(a=>`<option value="${a.id}">${esc(a.aulaLabel||a.nombre)}</option>`).join('')}</select>
    </fieldset>
    <fieldset><legend>2. Pega una lista (una línea por bien)</legend>
      <div class="hint" style="margin-bottom:6px;">Formato: <span class="mono">Denominación, Marca, Modelo, N° de Serie, Color, Estado (MB/B/R/M)</span> — el <b>código SBN se detecta automáticamente</b> si la denominación coincide con el catálogo (puedes agregar una 7ª columna con el código SBN para forzarlo manualmente). Si algún valor trae una coma, enciérralo entre comillas dobles, ej. <span class="mono">"ESTANTE, TIPO LIBRERO"</span>.</div>
      <textarea id="cm_texto" rows="6" placeholder="COMPUTADORA PERSONAL PORTATIL, HP, HP 340 G1, 5CG4482Q8D, PLOMO, B
CARPETA UNIPERSONAL,,,,, MB"></textarea>
      <button class="btn btn-sm" id="cm_plantilla" style="margin-top:8px;">Descargar plantilla CSV</button>
      <button class="btn btn-primary btn-sm" id="cm_procesar_texto" style="margin-top:8px;">Registrar bienes desde texto</button>
    </fieldset>
    <fieldset><legend>3. O sube un archivo CSV</legend>
      <input type="file" id="cm_archivo" accept=".csv">
    </fieldset>
    <div id="cm_msg"></div></div>
    <div class="m-f"><button class="btn" id="cancelCm">Cerrar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancelCm').onclick=close;
  bg.addEventListener('click',e=>{ if(e.target===bg) close(); });
      bg.querySelector('#cm_plantilla').addEventListener('click', ()=>{
      downloadFile('plantilla_carga_masiva.csv', '\uFEFFDenominacion,Marca,Modelo,NumeroSerie,Color,Estado(MB/B/R/M),CodigoSBN(opcional)\nCOMPUTADORA PERSONAL PORTATIL,HP,HP 340 G1,5CG4482Q8D,PLOMO,B,\nCARPETA UNIPERSONAL,,,,,MB,\n', 'text/csv;charset=utf-8;');
    });
    bg.querySelector('#cm_procesar_texto').addEventListener('click', async ()=>{
      const aulaId = bg.querySelector('#cm_aula').value; const texto = bg.querySelector('#cm_texto').value;
      if(!aulaId){ document.getElementById('cm_msg').innerHTML='<div class="msgbox err">Selecciona un aula destino.</div>'; return; }
      const lineas = texto.split('\n').filter(l=>l.trim());
      if(lineas.length===0){ document.getElementById('cm_msg').innerHTML='<div class="msgbox err">Pega al menos una línea.</div>'; return; }
      const r = await insertarBienesMasivo(aulaId, lineas);
      document.getElementById('cm_msg').innerHTML = `<div class="msgbox ok">${r.ok} bien(es) registrados correctamente.${r.sinSBN?(' '+r.sinSBN+' sin código SBN detectado — complétalo manualmente en "Bienes patrimoniales".'):''}</div>`;
      toast(r.ok+' bienes registrados por carga masiva.','ok');
    });
    bg.querySelector('#cm_archivo').addEventListener('change', e=>{
      const file = e.target.files[0]; if(!file) return;
      const reader = new FileReader();
      reader.onload = async ()=>{
        const aulaId = bg.querySelector('#cm_aula').value;
        if(!aulaId){ document.getElementById('cm_msg').innerHTML='<div class="msgbox err">Selecciona un aula destino antes de subir el archivo.</div>'; return; }
        const lineas = String(reader.result).split('\n').slice(1).filter(l=>l.trim());
        const r = await insertarBienesMasivo(aulaId, lineas);
        document.getElementById('cm_msg').innerHTML = `<div class="msgbox ok">${r.ok} bien(es) registrados desde el archivo CSV.${r.sinSBN?(' '+r.sinSBN+' sin código SBN detectado.'):''}</div>`;
        toast(r.ok+' bienes registrados desde CSV.','ok');
      };
      reader.readAsText(file);
    });

}
// Parser CSV robusto para una sola línea (los saltos de línea ya se separaron
// antes de llegar aquí). A diferencia de un simple split(','), respeta los
// campos entre comillas dobles: así, si una denominación, marca o color trae
// una coma (ej. "ESTANTE, TIPO LIBRERO"), no se corta en un campo de más.
// También soporta comillas dobles escapadas como "" dentro de un campo.
function parseCSVLine(line){
  const campos = [];
  let actual = '';
  let entreComillas = false;
  for(let i=0; i<line.length; i++){
    const ch = line[i];
    if(entreComillas){
      if(ch==='"'){
        if(line[i+1]==='"'){ actual+='"'; i++; } // comilla escapada -> comilla literal
        else { entreComillas=false; }
      } else { actual += ch; }
    } else {
      if(ch==='"'){ entreComillas = true; }
      else if(ch===','){ campos.push(actual.trim()); actual=''; }
      else { actual += ch; }
    }
  }
  campos.push(actual.trim());
  return campos;
}
// Busca el código SBN en el catálogo a partir de la denominación: coincidencia
// exacta primero (ignorando tildes/mayúsculas). Si no hay exacta, solo se acepta
// una coincidencia parcial cuando es ÚNICA: con miles de denominaciones parecidas
// en el catálogo oficial (p.ej. "IMPRESORA" vs "IMPRESORA MULTIFUNCIONAL" vs
// "IMPRESORA 3D"), adivinar entre varias candidatas puede asignar un código
// incorrecto. Si hay más de una posible, se deja en blanco (se cuenta como
// "sinSBN" en la carga masiva) para que el usuario la revise y la elija a mano
// desde el buscador del formulario o desde "Catálogo SBN".
// Variantes de nombre que el personal usa comúnmente para la "COMPUTADORA
// PERSONAL PORTATIL" (código SBN 74080500) y que la búsqueda normal NO
// reconoce, porque no coinciden palabra por palabra con el nombre oficial del
// catálogo (ej. "LAPTOP" no contiene "COMPUTADORA", y "COMPUTADORA PORTATIL"
// no contiene "PERSONAL"). Sin esto, cada variante quedaba registrada como
// bien "sin código SBN detectado", con lo cual no comparte correlativo con el
// resto de laptops del colegio en el Código Patrimonial.
const SINONIMOS_SBN = {
  'LAPTOP':'74080500', 'LAP TOP':'74080500', 'NOTEBOOK':'74080500', 'NOTE BOOK':'74080500',
  'COMPUTADORA PORTATIL':'74080500', 'COMPUTADORA PORTATIL PERSONAL':'74080500',
  'COMPUTADORA LAPTOP':'74080500', 'LAPTOP PORTATIL':'74080500', 'COMPUTADORA NOTEBOOK':'74080500',
  'PC PORTATIL':'74080500', 'PC LAPTOP':'74080500', 'COMPUTADORA PERSONAL LAPTOP':'74080500'
};
function lookupSBN(denominacion){
  if(!denominacion) return '';
  const cat = DB.get(KEYS.catalogo);
  if(esCargadorDeBateria(denominacion) && cat.some(c=>c.codigoSBN==='46221341')) return '46221341';
  const d = normalizaBusqueda(denominacion);
  const sinonimo = SINONIMOS_SBN[d];
  if(sinonimo && cat.some(c=>c.codigoSBN===sinonimo)) return sinonimo;
  const hit = cat.find(c => normalizaBusqueda(c.denominacion) === d);
  if(hit) return hit.codigoSBN;
  // Si lo escrito trae texto de más (ej. "MESA DE METAL Y MELAMINA PARA AULA DE
  // INNOVACIÓN"), puede contener varias denominaciones oficiales como substring
  // a la vez ("MESA DE METAL" y "MESA DE METAL Y MELAMINA"). Antes esto se
  // trataba como ambiguo y se descartaba (sin código SBN); ahora se prefiere la
  // denominación del catálogo más larga/específica contenida en el texto, en
  // vez de rendirse.
  const contenidos = cat.filter(c => d.includes(normalizaBusqueda(c.denominacion)));
  if(contenidos.length>0){
    contenidos.sort((a,b)=> normalizaBusqueda(b.denominacion).length - normalizaBusqueda(a.denominacion).length);
    return contenidos[0].codigoSBN;
  }
  // Si en cambio lo escrito es más corto que el nombre oficial (faltan
  // palabras), solo se acepta cuando hay una única denominación del catálogo
  // que lo contenga; si hay varias, no se adivina.
  const queLoContienen = cat.filter(c => normalizaBusqueda(c.denominacion).includes(d));
  return queLoContienen.length===1 ? queLoContienen[0].codigoSBN : '';
}

/* ---------------------------------------------------------------------
   13-D. VERIFICACIÓN DE DENOMINACIONES SBN
   Compara, bien por bien, la denominación registrada contra la denominación
   oficial del Catálogo SBN (según el código SBN que tiene asignado el bien),
   agrupado por aula/grado y sección. Tres estados posibles:
     'ok'      -> tiene código SBN y el texto coincide exacto con el catálogo
     'diverge' -> tiene código SBN pero el texto no coincide (ej. errores de
                  tipeo, palabras de más, variantes como "MELAMINE"/"MELAMINA")
     'sinCodigo' -> no tiene ningún código SBN asignado; se intenta sugerir uno
                  con lookupSBN() (la misma función que usa la carga masiva)
   --------------------------------------------------------------------- */
function catalogoPorCodigoMap(){
  const cat = DB.get(KEYS.catalogo);
  const m = new Map();
  cat.forEach(c=>{ if(c.codigoSBN) m.set(c.codigoSBN, c); });
  return m;
}
// Devuelve el estado de verificación de UN bien contra el catálogo.
function estadoVerificacionItem(item, catPorCodigo){
  if(item.codigoSBN){
    const oficial = catPorCodigo.get(item.codigoSBN);
    if(!oficial){
      // Tiene un código que ya no existe en el catálogo actual (por ejemplo,
      // se borró o se reemplazó desde "Catálogo SBN").
      return { estado:'codigoInexistente', denominacionOficial:'', sugerido:'' };
    }
    const coincide = normalizaBusqueda(oficial.denominacion) === normalizaBusqueda(item.denominacion);
    return { estado: coincide?'ok':'diverge', denominacionOficial: oficial.denominacion, sugerido:'' };
  }
  const sugerido = lookupSBN(item.denominacion);
  return { estado:'sinCodigo', denominacionOficial:'', sugerido };
}
// Cuenta cuántos bienes (visibles según el alcance del usuario) NO están en
// estado 'ok', para el badge del menú lateral.
function contarDiscrepanciasSBN(){
  try{
    const cat = catalogoPorCodigoMap();
    return scopedItems().filter(i=>estadoVerificacionItem(i, cat).estado!=='ok').length;
  }catch(e){ return 0; }
}
function verifAulasDisponibles(){ return scopedAulas().slice().sort((a,b)=>(a.aulaLabel||'').localeCompare(b.aulaLabel||'')); }
// Arma la lista de filas ya filtradas según STATE.filtersVerif (texto, aula,
// estado) — reutilizado tanto para pintar la tabla como para la actualización
// masiva, así ambas ven exactamente el mismo conjunto de bienes.
function verifFilasFiltradas(){
  const cat = catalogoPorCodigoMap();
  const f = STATE.filtersVerif;
  const qn = normalizaBusqueda(f.q);
  let filas = scopedItems().map(i=>({ item:i, ...estadoVerificacionItem(i, cat) }));
  if(f.aula) filas = filas.filter(x=>x.item.aulaId===f.aula);
  if(f.estado) filas = filas.filter(x=>x.estado===f.estado);
  if(qn) filas = filas.filter(x=>{
    const hay = normalizaBusqueda(x.item.denominacion)+' '+normalizaBusqueda(x.item.codigoSBN)+' '+normalizaBusqueda(x.item.codigoInterno);
    return hay.includes(qn);
  });
  filas.sort((a,b)=> (a.item.aulaNombre||'').localeCompare(b.item.aulaNombre||'') || a.item.denominacion.localeCompare(b.item.denominacion));
  return filas;
}
function verifEstadoBadge(estado){
  const map = {
    ok: ['🟢','Coincide con catálogo','badge-good'],
    diverge: ['🟡','Código OK, texto distinto','badge-warn'],
    sinCodigo: ['🔴','Sin código SBN','badge-bad'],
    codigoInexistente: ['🔴','Código no está en el catálogo','badge-bad']
  };
  const [ic,label,cls] = map[estado]||['—','',''];
  return `<span class="badge ${cls}">${ic} ${esc(label)}</span>`;
}
const VERIF_MAX_FILAS = 400; // límite de filas pintadas a la vez, por rendimiento
function renderVerifSBNFilas(filas){
  if(filas.length===0) return '<tr><td colspan="6" class="empty">Ningún bien coincide con el filtro actual.</td></tr>';
  return filas.slice(0, VERIF_MAX_FILAS).map(({item,estado,denominacionOficial,sugerido})=>{
    let accion = '';
    if(estado==='diverge'){
      accion = `<button class="btn btn-sm btn-primary" data-fixverif="${item.id}">Usar oficial</button>`;
    }
    if(estado==='codigoInexistente'){
      accion = `<button class="btn btn-sm btn-ghost" data-goitem="${item.id}">Corregir manualmente</button>`;
    }
    if(estado==='sinCodigo'){
      accion = sugerido
        ? `<button class="btn btn-sm btn-primary" data-sugverif="${item.id}" data-sugcodigo="${esc(sugerido)}">Asignar sugerido</button>`
        : `<button class="btn btn-sm btn-ghost" data-goitem="${item.id}">Elegir manualmente</button>`;
    }
    const oficialTxt = estado==='diverge' ? `<div class="hint">Oficial: ${esc(denominacionOficial)}</div>`
      : estado==='sinCodigo' && sugerido ? `<div class="hint">Sugerido: ${esc(sugerido)}</div>`
      : '';
    return `<tr>
      <td class="mono">${esc(item.codigoInterno)}</td>
      <td>${esc(item.denominacion)}${oficialTxt}</td>
      <td class="mono">${esc(item.codigoSBN||'—')}</td>
      <td>${esc(item.aulaNombre||'—')}</td>
      <td>${verifEstadoBadge(estado)}</td>
      <td style="white-space:nowrap;">${accion}<button class="btn btn-sm btn-ghost" data-goitem="${item.id}">Ver</button></td>
    </tr>`;
  }).join('');
}
function verifCatFilasHTML(catFiltrado){
  return catFiltrado.slice(0,200).map(c=>`<tr class="rowclick" data-verifporcod="${esc(c.codigoSBN)}"><td class="mono">${esc(c.codigoSBN)}</td><td>${esc(c.denominacion)}</td></tr>`).join('')||'<tr><td colspan="2" class="empty">Sin resultados.</td></tr>';
}
// Igual que actualizarTablaCatalogo(): actualiza SOLO la tabla y el contador
// del catálogo (bloque izquierdo de Verificación SBN) mientras el usuario
// escribe, sin volver a pintar el <input> — así no se pierde el foco ni el
// cursor en cada letra. Vuelve a enganchar el clic de cada fila, porque el
// innerHTML de la tabla se reemplaza por completo.
function actualizarTablaVerifCat(){
  const tbody = document.getElementById('verifCatTbody');
  const contador = document.getElementById('verifCatCount');
  if(!tbody) return;
  const { total, filtrado } = catalogoFiltrado();
  tbody.innerHTML = verifCatFilasHTML(filtrado);
  if(contador) contador.textContent = catalogoContadorHTML(total, filtrado.length);
  tbody.querySelectorAll('[data-verifporcod]').forEach(row=>row.addEventListener('click', ()=>{
    const codigo = row.dataset.verifporcod;
    const cat = DB.get(KEYS.catalogo); const hit = cat.find(x=>x.codigoSBN===codigo);
    STATE.filtersVerif.q = codigo;
    renderContent();
    toast(hit?('Filtrando inventario por código '+codigo+' ('+hit.denominacion+').'):('Filtrando inventario por código '+codigo+'.'), 'ok');
  }));
}
function renderVerifSBN(){
  const f = STATE.filtersVerif;
  const aulas = verifAulasDisponibles();
  const filas = verifFilasFiltradas();
  const nOk = filas.filter(x=>x.estado==='ok').length;
  const nDiverge = filas.filter(x=>x.estado==='diverge').length;
  const nSin = filas.filter(x=>x.estado==='sinCodigo'||x.estado==='codigoInexistente').length;
  // Catálogo (bloque izquierdo): mismo buscador que "Catálogo SBN", pero de
  // solo lectura aquí — su única función es servir de referencia mientras se
  // revisa el inventario del lado derecho.
  const { total: totalCat, filtrado: catFiltrado } = catalogoFiltrado();
  return `<div class="note-banner">Compara la denominación de cada bien contra el Catálogo SBN oficial. 🟢 coincide, 🟡 tiene código pero el texto no coincide (revísalo), 🔴 no tiene código SBN asignado (usa el sugerido o elígelo a mano).</div>
  <div class="grid g2" style="align-items:start;">
    <div class="card">
      <div class="card-h"><h3>Catálogo SBN oficial</h3></div>
      <div class="card-b">
        <div class="toolbar">
          <input class="search" id="fcatq" placeholder="Buscar por código o denominación…" value="${esc(STATE.filtersCat.q)}" autocomplete="off">
          <span style="flex:1"></span>
          <span class="hint" id="verifCatCount">${catalogoContadorHTML(totalCat, catFiltrado.length)}</span>
        </div>
        <div class="tbl-wrap" style="max-height:520px; overflow:auto;"><table>
          <thead><tr><th>Código SBN</th><th>Denominación estandarizada</th></tr></thead>
          <tbody id="verifCatTbody">${verifCatFilasHTML(catFiltrado)}</tbody>
        </table></div>
        <div class="hint" style="padding-top:8px;">Haz clic en una fila para filtrar, en el bloque de la derecha, los bienes que usan ese código.</div>
      </div>
    </div>
    <div class="card">
      <div class="card-h"><h3>Tu inventario (por aula / grado y sección)</h3></div>
      <div class="card-b">
        <div class="toolbar">
          <select id="fverifaula"><option value="">Todas las aulas</option>${aulas.map(a=>`<option value="${esc(a.id)}" ${f.aula===a.id?'selected':''}>${esc(a.aulaLabel||a.nombre)}</option>`).join('')}</select>
          <select id="fverifestado">
            <option value="">Todos los estados</option>
            <option value="ok" ${f.estado==='ok'?'selected':''}>🟢 Coincide</option>
            <option value="diverge" ${f.estado==='diverge'?'selected':''}>🟡 Texto distinto</option>
            <option value="sinCodigo" ${f.estado==='sinCodigo'?'selected':''}>🔴 Sin código</option>
          </select>
          ${(f.q||f.aula||f.estado)?'<button class="btn btn-sm" id="fverifclear">Limpiar filtros</button>':''}
        </div>
        ${f.q?`<div class="hint" style="padding:6px 0;">Filtrando por código SBN <b>${esc(f.q)}</b> (clic en el catálogo de la izquierda) — usa "Limpiar filtros" para quitarlo.</div>`:''}
        <div class="grid g4" style="margin:10px 0;">
          <div class="card kpi" style="padding:10px;"><div class="lbl">🟢 Coinciden</div><div class="val">${nOk}</div></div>
          <div class="card kpi" style="padding:10px;"><div class="lbl">🟡 Texto distinto</div><div class="val">${nDiverge}</div></div>
          <div class="card kpi" style="padding:10px;"><div class="lbl">🔴 Sin código</div><div class="val">${nSin}</div></div>
        </div>
        <div class="tbl-wrap" style="max-height:420px; overflow:auto;"><table>
          <thead><tr><th>Código interno</th><th>Denominación registrada</th><th>Código SBN</th><th>Aula</th><th>Estado</th><th></th></tr></thead>
          <tbody id="verifTbody">${renderVerifSBNFilas(filas)}</tbody>
        </table></div>
        ${filas.length>VERIF_MAX_FILAS?`<div class="hint" style="padding:8px 0 0;">Mostrando ${VERIF_MAX_FILAS} de ${filas.length}. Usa los filtros para acotar.</div>`:''}
      </div>
    </div>
  </div>`;
}
// Reemplaza la denominación del bien por la oficial del catálogo (según su
// codigoSBN), conservando el texto anterior en Observaciones para no perder
// el detalle que el personal ya había anotado (ej. "fija, unipersonal").
async function aplicarDenominacionOficial(item, denominacionOficial){
  const items = DB.get(KEYS.items);
  const idx = items.findIndex(i=>i.id===item.id);
  if(idx===-1) return;
  const anterior = items[idx].denominacion;
  const obsAnteriores = (items[idx].observaciones||'').trim();
  const notaAnterior = (obsAnteriores && obsAnteriores!=='Registrado por carga masiva.') ? (' Nota previa (denominación original: "'+anterior+'"): '+obsAnteriores) : (' (denominación original: "'+anterior+'")');
  items[idx] = { ...items[idx], denominacion: denominacionOficial, observaciones: 'Ajustado a denominación oficial SBN.'+notaAnterior };
  await DB.save(KEYS.items, items);
}
async function fixVerifItem(itemId){
  if(!guardEdit()) return;
  const items = DB.get(KEYS.items); const item = items.find(i=>i.id===itemId); if(!item) return;
  const cat = catalogoPorCodigoMap(); const oficial = cat.get(item.codigoSBN);
  if(!oficial){ toast('Ese código ya no existe en el catálogo.','err'); return; }
  await aplicarDenominacionOficial(item, oficial.denominacion);
  toast('Denominación actualizada a la oficial del catálogo.','ok');
  renderContent();
}
async function asignarCodigoSugeridoVerif(itemId, codigoSugerido){
  if(!guardEdit()) return;
  const items = DB.get(KEYS.items); const idx = items.findIndex(i=>i.id===itemId); if(idx===-1) return;
  const cat = catalogoPorCodigoMap(); const oficial = cat.get(codigoSugerido);
  if(!oficial){ toast('El código sugerido ya no existe en el catálogo.','err'); return; }
  items[idx] = { ...items[idx], codigoSBN: codigoSugerido };
  await DB.save(KEYS.items, items);
  await aplicarDenominacionOficial(items[idx], oficial.denominacion);
  toast('Código SBN asignado y denominación actualizada.','ok');
  renderContent();
}
// Actualización masiva: aplica la denominación oficial a TODOS los bienes que
// están en estado 'diverge' dentro del conjunto actualmente filtrado (aula /
// estado / búsqueda). Los 'sinCodigo' sin sugerencia única no se tocan, para
// no asignar un código a ciegas.
async function actualizarVisiblesSBN(){
  if(!guardEdit()) return;
  const filas = verifFilasFiltradas().filter(x=>x.estado==='diverge' || (x.estado==='sinCodigo' && x.sugerido));
  if(filas.length===0){ toast('No hay bienes pendientes de actualizar en el filtro actual.','ok'); return; }
  if(!confirm('Se actualizará la denominación de '+filas.length+' bien(es) visible(s) a la oficial del catálogo (o se les asignará el código sugerido). El texto anterior de cada uno se guardará en Observaciones. ¿Continuar?')) return;
  const cat = catalogoPorCodigoMap();
  let items = DB.get(KEYS.items);
  for(const fila of filas){
    const idx = items.findIndex(i=>i.id===fila.item.id); if(idx===-1) continue;
    let codigo = items[idx].codigoSBN || fila.sugerido;
    const oficial = cat.get(codigo); if(!oficial) continue;
    const anterior = items[idx].denominacion;
    const obsAnteriores = (items[idx].observaciones||'').trim();
    const notaAnterior = (obsAnteriores && obsAnteriores!=='Registrado por carga masiva.') ? (' Nota previa (denominación original: "'+anterior+'"): '+obsAnteriores) : (' (denominación original: "'+anterior+'")');
    items[idx] = { ...items[idx], codigoSBN: codigo, denominacion: oficial.denominacion, observaciones: 'Ajustado a denominación oficial SBN (actualización masiva).'+notaAnterior };
  }
  await DB.save(KEYS.items, items);
  toast(filas.length+' bien(es) actualizado(s) a la denominación oficial.','ok');
  renderContent();
}

/* ---------------------------------------------------------------------
   13-C. IMPORTAR / EXPORTAR CATÁLOGO SBN — para actualizarlo cuando SBN
   publique una nueva versión del CNBME, sin tener que editar el código
   fuente del sistema. Soporta el Excel oficial (con las filas "GRUPO
   GENÉRICO" / "CLASE" tal como lo publica SBN) y un CSV simple con
   columnas Código/Denominación/Grupo/Clase (por ejemplo, el que genera
   el propio botón "Exportar catálogo actual").
   --------------------------------------------------------------------- */
function exportarCatalogoCSV(){
  const headers = [{key:'codigoSBN',label:'CodigoSBN'},{key:'denominacion',label:'Denominacion'},{key:'grupo',label:'Grupo'},{key:'clase',label:'Clase'}];
  downloadFile('catalogo_sbn_'+today()+'.csv', '\uFEFF'+toCSV(DB.get(KEYS.catalogo), headers), 'text/csv;charset=utf-8;');
}
// Normaliza un código a 8 dígitos (rellenando ceros a la izquierda). Devuelve
// '' si no son solo dígitos, para descartar filas basura al importar.
function normalizaCodigoSBN(v){
  const s = String(v==null?'':v).trim().replace(/\.0$/,'');
  return /^\d+$/.test(s) ? s.padStart(8,'0') : '';
}
// Interpreta las filas crudas de la hoja del Excel oficial del CNBME: trae
// bloques "GRUPO GENÉRICO" / "CLASE" seguidos de una tabla con columnas
// N°, CÓDIGO, DENOMINACIÓN, UNIDAD. Es el mismo formato del archivo que
// publica la SBN (ver hoja TBL_MUEBLES_CATALOGO).
function parseCatalogoDesdeFilasXLSX(rows){
  const items = []; const vistos = new Set();
  let grupoActual = '', claseActual = '';
  for(const row of rows){
    if(!row || row.length===0) continue;
    const c0 = row[0];
    if(typeof c0 === 'string' && c0.trim().toUpperCase().startsWith('GRUPO GEN')){ grupoActual = String(row[2]||'').trim(); continue; }
    if(typeof c0 === 'string' && c0.trim().toUpperCase()==='CLASE'){ claseActual = String(row[2]||'').trim(); continue; }
    if(row.length<3) continue;
    const codigo = normalizaCodigoSBN(row[1]);
    const denom = String(row[2]==null?'':row[2]).trim();
    if(!codigo || !denom) continue;
    if(vistos.has(codigo)) continue;
    vistos.add(codigo);
    items.push({ codigoSBN:codigo, denominacion:denom.toUpperCase(), grupo:grupoActual, clase:claseActual });
  }
  return items;
}
// Interpreta un CSV simple con fila de encabezado. Detecta las columnas por
// nombre (sin importar tildes/mayúsculas/orden): Codigo(SBN), Denominacion,
// Grupo, Clase. Solo Código y Denominación son obligatorias.
function parseCatalogoDesdeCSV(texto){
  const lineas = texto.split(/\r?\n/).filter(l=>l.trim());
  if(lineas.length<2) return [];
  const headers = parseCSVLine(lineas[0]).map(h=>normalizaBusqueda(h));
  const idx = campo => headers.findIndex(h=>h.includes(campo));
  const iCod = idx('CODIGO'), iDenom = idx('DENOMINA'), iGrupo = idx('GRUPO'), iClase = idx('CLASE');
  if(iCod===-1 || iDenom===-1) return null; // no se reconoce el formato
  const items = []; const vistos = new Set();
  for(let i=1;i<lineas.length;i++){
    const cols = parseCSVLine(lineas[i]);
    const codigo = normalizaCodigoSBN(cols[iCod]);
    const denom = String(cols[iDenom]||'').trim();
    if(!codigo || !denom || vistos.has(codigo)) continue;
    vistos.add(codigo);
    items.push({ codigoSBN:codigo, denominacion:denom.toUpperCase(), grupo: iGrupo>=0?(cols[iGrupo]||'').trim():'', clase: iClase>=0?(cols[iClase]||'').trim():'' });
  }
  return items;
}
function openImportarCatalogoModal(){
  if(!isAdmin()){ toast('Solo un administrador puede importar el catálogo SBN.','err'); return; }
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal" style="max-width:560px;">
    <div class="m-h"><h3>Importar catálogo SBN</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="hint" style="margin-bottom:10px;">Sube el Excel oficial del Catálogo Nacional de Bienes Muebles del Estado (CNBME) tal como lo publica SBN, o un CSV con columnas Código/Denominación (y opcionalmente Grupo/Clase) — por ejemplo, el que descargas con "Exportar catálogo actual".</div>
      <input type="file" id="imp_archivo" accept=".xlsx,.xls,.csv">
      <div id="imp_msg" style="margin-top:12px;"></div>
      <div id="imp_opciones" style="display:none; margin-top:12px;">
        <div class="field"><label id="imp_label_modo">¿Cómo aplicar los códigos leídos?</label>
          <div style="display:flex; flex-direction:column; gap:6px; margin-top:4px;">
            <label><input type="radio" name="imp_modo" value="merge" checked> Agregar / actualizar sin borrar las denominaciones existentes que no vengan en el archivo</label>
            <label><input type="radio" name="imp_modo" value="reemplazar"> Reemplazar TODO el catálogo actual por el del archivo</label>
          </div>
        </div>
      </div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="aplicar" disabled>Aplicar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click',e=>{if(e.target===bg)close();});
  let itemsLeidos = null;
  const msg = bg.querySelector('#imp_msg');
  const opciones = bg.querySelector('#imp_opciones');
  const btnAplicar = bg.querySelector('#aplicar');
  bg.querySelector('#imp_archivo').addEventListener('change', e=>{
    const file = e.target.files[0]; if(!file) return;
    itemsLeidos = null; opciones.style.display='none'; btnAplicar.disabled=true;
    msg.innerHTML = '<div class="hint">Leyendo archivo…</div>';
    const esCSV = /\.csv$/i.test(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try{
        let items;
        if(esCSV){
          items = parseCatalogoDesdeCSV(String(reader.result));
          if(items===null){ msg.innerHTML = '<div class="msgbox err">No se reconocen las columnas del CSV. Debe incluir al menos "Código" y "Denominación" en el encabezado.</div>'; return; }
        } else {
          const wb = XLSX.read(reader.result, {type:'array'});
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:null});
          items = parseCatalogoDesdeFilasXLSX(rows);
        }
        if(!items || items.length===0){ msg.innerHTML = '<div class="msgbox err">No se encontraron códigos válidos en el archivo.</div>'; return; }
        itemsLeidos = items;
        const catActual = DB.get(KEYS.catalogo);
        const codigosActuales = new Set(catActual.map(c=>c.codigoSBN));
        const nuevos = items.filter(i=>!codigosActuales.has(i.codigoSBN)).length;
        msg.innerHTML = `<div class="msgbox ok">Se leyeron ${items.length} código(s) válido(s): ${nuevos} nuevo(s) y ${items.length-nuevos} que ya existen en tu catálogo (se actualizarían con los datos del archivo).</div>`;
        opciones.style.display='block';
        bg.querySelector('#imp_label_modo').textContent = '¿Cómo aplicar los '+items.length+' códigos leídos?';
        btnAplicar.disabled=false;
      }catch(err){
        msg.innerHTML = '<div class="msgbox err">No se pudo leer el archivo: '+esc(err.message)+'</div>';
      }
    };
    reader.onerror = () => { msg.innerHTML = '<div class="msgbox err">No se pudo leer el archivo.</div>'; };
    if(esCSV) reader.readAsText(file); else reader.readAsArrayBuffer(file);
  });
  btnAplicar.addEventListener('click', async ()=>{
    if(!itemsLeidos) return;
    const modo = bg.querySelector('input[name="imp_modo"]:checked').value;
    if(modo==='reemplazar' && !confirm('Esto reemplazará TODO el catálogo SBN actual ('+DB.get(KEYS.catalogo).length+' denominaciones) por las '+itemsLeidos.length+' del archivo. ¿Continuar?')) return;
    let listaFinal;
    if(modo==='reemplazar'){
      listaFinal = itemsLeidos;
    } else {
      const actual = DB.get(KEYS.catalogo);
      const porCodigo = new Map(actual.map(c=>[c.codigoSBN, c]));
      for(const it of itemsLeidos) porCodigo.set(it.codigoSBN, it);
      listaFinal = [...porCodigo.values()];
    }
    await DB.save(KEYS.catalogo, listaFinal);
    toast('Catálogo actualizado: ahora tiene '+listaFinal.length+' denominación(es).','ok');
    close(); renderContent();
  });
}

async function insertarBienesMasivo(aulaId, lineas){
  if(!guardEdit()) return 0;
  const aulas = DB.get(KEYS.aulas); const aula = aulas.find(a=>a.id===aulaId);
  const cfg = DB.get(KEYS.config);
  let items = DB.get(KEYS.items); let ok=0, movsNuevos=[], sinSBN=0;
  for(const linea of lineas){
    if(!linea.trim()) continue;
    const [denominacion, marca, modelo, numeroSerie, color, estadoAbrev, codigoSBNManual] = parseCSVLine(linea);
    if(!denominacion) continue;
    const estadoMap = {MB:'Muy Bueno', B:'Bueno', R:'Regular', M:'Malo'};
    const estadoConservacion = estadoMap[(estadoAbrev||'B').toUpperCase()] || 'Bueno';
    const codigoSBN = (codigoSBNManual && codigoSBNManual.trim()) || lookupSBN(denominacion);
    if(!codigoSBN) sinSBN++;
    const correlativoSBN = await nextCorrelativoPorSBN(codigoSBN);
    const codigoInterno = buildCodigoPatrimonial(codigoSBN, correlativoSBN);
    const codigoUsoInterno = buildCodigoUsoInterno(await nextCorrelativoInterno());
    const data = {
      id:uid('item'), codigoInterno, codigoAnioAnterior:'', codigoUsoInterno,
      denominacion:denominacion.toUpperCase(), codigoSBN, marca:marca||'', modelo:modelo||'',
      numeroSerie:numeroSerie||'', color:color||'', estadoConservacion,
      aulaId, aulaNombre: aula?(aula.aulaLabel||aula.nombre):'', custodioId:'', custodioNombre: aula?(aula.responsable||''):'',
      situacion:'Activo', foto:'', observaciones:'Registrado por carga masiva.', fechaRegistro:today(), anio:cfg.anioFiscal,
      registradoPor: currentUser().usuario
    };
    items.push(data); ok++;
    movsNuevos.push({ id:uid('mov'), itemId:data.id, codigoInterno, tipo:'Alta', detalle:'Alta por carga masiva ('+currentUser().usuario+').', fecha:today() });
  }
  await DB.save(KEYS.items, items);
  await DB.save(KEYS.movs, [...DB.get(KEYS.movs), ...movsNuevos]);
  return { ok, sinSBN };
}

/* ---------------------------------------------------------------------
   17. USUARIOS Y ACCESOS (solo admin)
   --------------------------------------------------------------------- */
function renderUsuarios(){
  const users = DB.get(KEYS.usuarios);
  return `<div class="card"><div class="tbl-wrap"><table>
    <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Aulas asignadas</th><th></th></tr></thead>
    <tbody>${users.map(u=>`<tr><td class="mono">${esc(u.usuario)}</td><td>${esc(u.nombre)}</td><td><span class="badge ${(u.rol==='ADMIN'||u.rol==='ADMIN2')?'badge-info':'badge-gold'}">${esc(u.rol)}</span></td>
      <td>${(u.aulaIds||[]).length} aula(s)</td>
      <td style="white-space:nowrap;"><button class="btn btn-sm btn-ghost" data-edituser="${u.id}">Editar</button>${u.usuario!=='admin'?`<button class="btn btn-sm btn-danger" data-deluser="${u.id}">Eliminar</button>`:''}</td>
    </tr>`).join('')}</tbody></table></div></div>`;
}
function openUserModal(id){
  if(!puedeGestionarUsuarios()){ toast('Solo un administrador puede gestionar usuarios.','err'); return; }
  const users = DB.get(KEYS.usuarios); const aulas = DB.get(KEYS.aulas); const u = id?users.find(x=>x.id===id):null;
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal">
    <div class="m-h"><h3>${u?'Editar usuario':'Nuevo usuario'}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="grid g2">
        <div class="field"><label>Usuario (login) *</label><input id="u_user" value="${esc(u?u.usuario:'')}" ${u?'disabled':''}></div>
        <div class="field"><label>Nombre completo *</label><input id="u_nombre" value="${esc(u?u.nombre:'')}"></div>
      </div>
      <div class="grid g2">
        <div class="field"><label>Contraseña ${u?'(dejar vacío para no cambiar)':'*'}</label>
          <div style="display:flex;gap:6px;">
            <input id="u_pass" type="password" autocomplete="new-password" style="flex:1;" placeholder="${u?'••••••••':'Ej. colegio2026'}">
            <button type="button" class="btn btn-sm" id="u_pass_toggle" title="Mostrar/ocultar contraseña">👁️</button>
          </div>
        </div>
        <div class="field"><label>Rol *</label><select id="u_rol" onchange="document.getElementById('u_aulas_wrap').style.display=this.value==='DOCENTE'?'block':'none'; document.getElementById('u_rol_desc').textContent=({ADMIN:'${ROL_LABEL.ADMIN}',ADMIN2:'${ROL_LABEL.ADMIN2}',DOCENTE:'${ROL_LABEL.DOCENTE}',CONSULTA:'${ROL_LABEL.CONSULTA}'})[this.value]||'';">${ROLES.map(r=>`<option ${u&&u.rol===r?'selected':''}>${r}</option>`).join('')}</select>
          <div class="hint" id="u_rol_desc">${esc(ROL_LABEL[u?u.rol:'DOCENTE'])}</div>
        </div>
      </div>
      <div class="field" id="u_aulas_wrap" style="display:${u&&u.rol==='DOCENTE'?'block':'none'};">
        <label>Aulas que puede gestionar (solo aplica al rol DOCENTE)</label>
        <div class="checklist">${aulas.map(a=>`<label><input type="checkbox" class="uachk" value="${a.id}" ${u&&(u.aulaIds||[]).includes(a.id)?'checked':''}> ${esc(a.aulaLabel||a.nombre)}</label>`).join('') || '<div class="hint">No hay aulas registradas aún.</div>'}</div>
      </div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Guardar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click',e=>{if(e.target===bg)close();});
  bg.querySelector('#u_pass_toggle').addEventListener('click', ()=>{
    const inp = bg.querySelector('#u_pass');
    inp.type = inp.type==='password' ? 'text' : 'password';
  });
  bg.querySelector('#save').addEventListener('click', async ()=>{
    const usuario=bg.querySelector('#u_user').value.trim(); const nombre=bg.querySelector('#u_nombre').value.trim();
    const pass=bg.querySelector('#u_pass').value; const rol=bg.querySelector('#u_rol').value;
    const aulaIds=[...bg.querySelectorAll('.uachk:checked')].map(x=>x.value);
    if(!usuario||!nombre||(!u&&!pass)){ toast('Completa usuario, nombre y contraseña.','err'); return; }
    if(pass){ const errPass = validarPasswordNueva(pass); if(errPass){ toast(errPass,'err'); return; } }
    let list = DB.get(KEYS.usuarios);
    if(u){
      let cred={ debeCambiarPass:u.debeCambiarPass };
      // Si el admin restablece la clave de OTRA persona, esa persona debe cambiarla al entrar.
      // (Con el servidor local solo se envía la clave nueva; el servidor la hashea y conserva el hash anterior si no se cambia.)
      if(pass){ cred={ ...(await prepararCredencialUsuario(pass)), debeCambiarPass:(u.id!==(currentUser()||{}).id) }; }
      else if(STORAGE_MODE!=='servidor'){ cred={ salt:u.salt, hash:u.hash, algo:u.algo, debeCambiarPass:u.debeCambiarPass }; }
      list = list.map(x=>x.id===u.id?{...x, nombre, rol, aulaIds, ...cred}:x);
      await registrarBitacora('Editar usuario', 'Usuario: '+u.usuario+(pass?' (incluye cambio de contraseña)':''));
    }else{
      if(list.find(x=>x.usuario.toLowerCase()===usuario.toLowerCase())){ toast('Ese usuario ya existe.','err'); return; }
      const cred = await prepararCredencialUsuario(pass);
      list = [...list, { id:uid('usr'), usuario, nombre, rol, aulaIds, ...cred, debeCambiarPass:true }];
      await registrarBitacora('Crear usuario', 'Usuario: '+usuario+' ('+rol+')');
    }
    await DB.save(KEYS.usuarios, list);
    toast('Usuario guardado.','ok'); close(); renderContent();
  });
}

/* ---------------------------------------------------------------------
   18. PAPELERA DE RECICLAJE (solo admin)
   --------------------------------------------------------------------- */
function renderPapelera(){
  const pap = DB.get(KEYS.papelera);
  return `<div class="card"><div class="tbl-wrap"><table>
    <thead><tr><th>Código</th><th>Denominación</th><th>Aula</th><th>Eliminado por</th><th>Fecha</th><th></th></tr></thead>
    <tbody>${pap.map(p=>`<tr><td class="mono">${esc(p.codigoInterno)}</td><td>${esc(p.denominacion)}</td><td>${esc(p.aulaNombre||'—')}</td><td>${esc(p.eliminadoPor||'—')}</td><td>${esc(p.fechaEliminacion||'—')}</td>
      <td style="white-space:nowrap;"><button class="btn btn-sm btn-primary" data-restaurar="${p.id}">Restaurar</button><button class="btn btn-sm btn-danger" data-purgar="${p.id}">Eliminar definitivo</button></td>
    </tr>`).join('')}
    ${pap.length===0?'<tr><td colspan="6" class="empty"><div class="big">⌫</div>La papelera está vacía.</td></tr>':''}
    </tbody></table></div></div>`;
}

/* ---------------------------------------------------------------------
   18-B. BITÁCORA DE AUDITORÍA (solo ADMIN)
   Historial de "quién hizo qué y cuándo": creación/edición/baja de bienes,
   gestión de usuarios, cambios de contraseña e inicios de sesión (exitosos
   y fallidos). Pensada como respaldo interno para rendir cuentas ante la
   UGEL o una auditoría, no reemplaza ningún libro oficial.
   --------------------------------------------------------------------- */
const BITACORA_ACCIONES = [
  'Inicio de sesión','Cierre de sesión','Intento de acceso fallido',
  'Crear bien','Editar bien','Eliminar bien (a papelera)','Restaurar bien (desde papelera)','Eliminar bien (definitivo)','Dar de baja',
  'Crear usuario','Editar usuario','Eliminar usuario'
];
function bitacoraAccionBadge(a){
  const cls = a==='Intento de acceso fallido' ? 'badge-bad'
    : (a==='Eliminar bien (a papelera)'||a==='Eliminar bien (definitivo)'||a==='Eliminar usuario'||a==='Dar de baja') ? 'badge-warn'
    : (a==='Inicio de sesión'||a==='Crear bien'||a==='Crear usuario') ? 'badge-good' : 'badge-info';
  return `<span class="badge ${cls}">${esc(a)}</span>`;
}
function renderBitacora(){
  let log = [...(DB.get(KEYS.bitacora)||[])].sort((a,b)=>b.fecha.localeCompare(a.fecha));
  const usuariosUnicos = [...new Set(log.map(l=>l.usuario))].sort((a,b)=>a.localeCompare(b));
  const f = STATE.filtersBitacora;
  log = log.filter(l=>{
    if(f.q){ const hay=(l.usuario+' '+l.accion+' '+l.detalle).toLowerCase(); if(!hay.includes(f.q.toLowerCase())) return false; }
    if(f.usuario && l.usuario!==f.usuario) return false;
    if(f.accion && l.accion!==f.accion) return false;
    if(f.desde && l.fecha.slice(0,10)<f.desde) return false;
    if(f.hasta && l.fecha.slice(0,10)>f.hasta) return false;
    return true;
  });
  return `
  <div class="hint" style="margin-bottom:10px;">Registro interno de auditoría: quién hizo qué y cuándo. Se conservan los últimos 3000 movimientos. No reemplaza ningún libro contable/patrimonial oficial.</div>
  <div class="card"><div class="card-b" style="padding-bottom:0;">
    <div class="grid g2">
      <input class="search" id="bfq" placeholder="Buscar por usuario, acción o detalle…" value="${esc(f.q)}">
      <select id="bfusuario"><option value="">— Todos los usuarios —</option>${usuariosUnicos.map(u=>`<option value="${esc(u)}" ${f.usuario===u?'selected':''}>${esc(u)}</option>`).join('')}</select>
    </div>
    <div class="grid g3">
      <select id="bfaccion"><option value="">— Todas las acciones —</option>${BITACORA_ACCIONES.map(a=>`<option value="${esc(a)}" ${f.accion===a?'selected':''}>${esc(a)}</option>`).join('')}</select>
      <input id="bfdesde" type="date" title="Desde" value="${esc(f.desde)}">
      <input id="bfhasta" type="date" title="Hasta" value="${esc(f.hasta)}">
    </div>
    <div style="margin:8px 0 4px;"><button class="btn btn-sm" id="bfclear">Limpiar filtros</button></div>
  </div></div>
  <div class="tbl-wrap"><table>
    <thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Rol</th><th>Acción</th><th>Detalle</th></tr></thead>
    <tbody>${log.slice(0,500).map(l=>`<tr>
      <td class="mono">${esc(new Date(l.fecha).toLocaleString('es-PE'))}</td>
      <td>${esc(l.usuario)}</td><td>${esc(l.rol)}</td>
      <td>${bitacoraAccionBadge(l.accion)}</td><td>${esc(l.detalle)}</td>
    </tr>`).join('')}
    ${log.length===0?'<tr><td colspan="5" class="empty"><div class="big">📜</div>Sin registros que coincidan con el filtro.</td></tr>':''}
    </tbody></table></div>
  ${log.length>500?`<div class="hint" style="margin-top:8px;">Mostrando 500 de ${log.length} registro(s). Usa los filtros o exporta a CSV para ver el resto.</div>`:''}`;
}
function exportBitacoraCSV(){
  const log = [...(DB.get(KEYS.bitacora)||[])].sort((a,b)=>b.fecha.localeCompare(a.fecha));
  const headers=[{key:'fecha',label:'Fecha y hora'},{key:'usuario',label:'Usuario'},{key:'rol',label:'Rol'},{key:'accion',label:'Acción'},{key:'detalle',label:'Detalle'}];
  downloadFile('bitacora_auditoria_'+today()+'.csv','\uFEFF'+toCSV(log,headers),'text/csv;charset=utf-8;');
}

/* ---------------------------------------------------------------------
   18-C. PÓLIZAS DE SEGURO (solo ADMIN)
   Bienes de alto valor (proyectores, laptops, equipos de laboratorio…)
   asegurados con una aseguradora externa: aseguradora, N° de póliza,
   vigencia y qué bienes cubre. Avisa en el centro de notificaciones
   cuando una póliza está por vencer (30 días o menos).
   --------------------------------------------------------------------- */
function polizaEstado(p){
  if(!p.vigenciaHasta) return {texto:'Sin fecha de fin', cls:'badge-info'};
  const d = diasHasta(p.vigenciaHasta);
  if(d<0) return {texto:'Vencida', cls:'badge-bad'};
  if(d<=30) return {texto:'Vence en '+d+' día(s)', cls:'badge-warn'};
  return {texto:'Vigente', cls:'badge-good'};
}
function renderPolizas(){
  const polizas = [...(DB.get(KEYS.polizas)||[])].sort((a,b)=>(b.vigenciaHasta||'').localeCompare(a.vigenciaHasta||''));
  const items = DB.get(KEYS.items);
  return `
  <div class="hint" style="margin-bottom:10px;">Pólizas de seguro contratadas para bienes de alto valor (equipos de cómputo, laboratorio, etc.). Esto es solo un registro interno de control — no reemplaza la póliza física ni gestiona pagos.</div>
  <div class="tbl-wrap"><table>
    <thead><tr><th>Aseguradora</th><th>N° de póliza</th><th>Cobertura</th><th>Vigencia</th><th>Bienes cubiertos</th><th>Estado</th><th></th></tr></thead>
    <tbody>${polizas.map(p=>{
      const est = polizaEstado(p);
      const nBienes = (p.bienesIds||[]).length;
      return `<tr>
        <td>${esc(p.aseguradora)}</td><td class="mono">${esc(p.numeroPoliza||'—')}</td><td>${esc(p.tipoCobertura||'—')}</td>
        <td class="mono">${esc(p.vigenciaDesde||'—')} → ${esc(p.vigenciaHasta||'—')}</td>
        <td>${nBienes} bien(es)</td><td><span class="badge ${est.cls}">${est.texto}</span></td>
        <td style="white-space:nowrap;">${isAdmin()?`<button class="btn btn-sm btn-ghost" data-editpoliza="${p.id}">Editar</button> <button class="btn btn-sm btn-danger" data-delpoliza="${p.id}">Eliminar</button>`:''}</td>
      </tr>`;
    }).join('')}
    ${polizas.length===0?'<tr><td colspan="7" class="empty"><div class="big">🛡</div>Aún no has registrado ninguna póliza de seguro.</td></tr>':''}
    </tbody></table></div>`;
}
function openPolizaModal(id){
  const p = id ? (DB.get(KEYS.polizas)||[]).find(x=>x.id===id) : null;
  const items = DB.get(KEYS.items).filter(i=>i.situacion!=='De baja').sort((a,b)=>(a.codigoInterno||'').localeCompare(b.codigoInterno||''));
  const seleccionados = new Set(p ? (p.bienesIds||[]) : []);
  const bg = document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML = `<div class="modal">
    <div class="m-h"><h3>${p?'Editar póliza de seguro':'Nueva póliza de seguro'}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="grid g2">
        <div class="field"><label>Aseguradora *</label><input id="pz_aseguradora" value="${esc(p?p.aseguradora:'')}" placeholder="Ej. Rímac, Pacífico, La Positiva…"></div>
        <div class="field"><label>N° de póliza</label><input id="pz_numero" class="mono" value="${esc(p?p.numeroPoliza:'')}"></div>
      </div>
      <div class="field"><label>Tipo de cobertura</label><input id="pz_cobertura" value="${esc(p?p.tipoCobertura:'')}" placeholder="Ej. Todo riesgo — equipos de cómputo y laboratorio"></div>
      <div class="grid g2">
        <div class="field"><label>Vigencia desde</label><input id="pz_desde" type="date" value="${esc(p?p.vigenciaDesde:today())}"></div>
        <div class="field"><label>Vigencia hasta</label><input id="pz_hasta" type="date" value="${esc(p?p.vigenciaHasta:'')}"></div>
      </div>
      <div class="field"><label>Prima anual (S/., opcional)</label><input id="pz_prima" type="number" step="0.01" min="0" value="${p&&p.primaAnual!=null?esc(p.primaAnual):''}"></div>
      <div class="field"><label>Bienes cubiertos</label>
        <input id="pz_buscarBien" placeholder="Buscar por código o denominación…" style="margin-bottom:6px;">
        <div id="pz_bienes_list" style="max-height:220px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:6px;">
          ${items.map(i=>`<label style="display:flex;gap:8px;align-items:center;padding:4px 2px;font-size:12.5px;" data-search="${esc((i.codigoInterno+' '+i.denominacion).toLowerCase())}">
            <input type="checkbox" class="pz_bien_chk" value="${i.id}" ${seleccionados.has(i.id)?'checked':''}>
            <span class="mono">${esc(i.codigoInterno)}</span> — ${esc(i.denominacion)}
          </label>`).join('') || '<div class="hint">No hay bienes activos registrados.</div>'}
        </div>
        <div class="hint"><span id="pz_count">${seleccionados.size}</span> bien(es) seleccionado(s)</div>
      </div>
      <div class="field"><label>Observaciones</label><textarea id="pz_obs" rows="2">${esc(p?p.observaciones:'')}</textarea></div>
    </div>
    <div class="m-f"><button class="btn" id="cancelPz">Cancelar</button><button class="btn btn-primary" id="savePz">${p?'Guardar cambios':'Registrar póliza'}</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancelPz').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  const contador = ()=>{ bg.querySelector('#pz_count').textContent = bg.querySelectorAll('.pz_bien_chk:checked').length; };
  bg.querySelectorAll('.pz_bien_chk').forEach(chk=>chk.addEventListener('change', contador));
  bg.querySelector('#pz_buscarBien').addEventListener('input', e=>{
    const q = e.target.value.trim().toLowerCase();
    bg.querySelectorAll('#pz_bienes_list label').forEach(lab=>{ lab.style.display = (!q || lab.dataset.search.includes(q)) ? 'flex' : 'none'; });
  });
  bg.querySelector('#savePz').addEventListener('click', async ()=>{
    const aseguradora = bg.querySelector('#pz_aseguradora').value.trim();
    if(!aseguradora){ toast('Escribe el nombre de la aseguradora.','err'); return; }
    const bienesIds = [...bg.querySelectorAll('.pz_bien_chk:checked')].map(c=>c.value);
    const data = {
      id: p?p.id:uid('poliza'), aseguradora,
      numeroPoliza: bg.querySelector('#pz_numero').value.trim(),
      tipoCobertura: bg.querySelector('#pz_cobertura').value.trim(),
      vigenciaDesde: bg.querySelector('#pz_desde').value || '',
      vigenciaHasta: bg.querySelector('#pz_hasta').value || '',
      primaAnual: bg.querySelector('#pz_prima').value.trim()!=='' ? Number(bg.querySelector('#pz_prima').value) : null,
      bienesIds, observaciones: bg.querySelector('#pz_obs').value.trim(),
      registradoPor: p?(p.registradoPor||currentUser().usuario):currentUser().usuario
    };
    let list = [...(DB.get(KEYS.polizas)||[])];
    list = p ? list.map(x=>x.id===p.id?data:x) : [...list, data];
    await DB.save(KEYS.polizas, list);
    await registrarBitacora(p?'Editar póliza de seguro':'Crear póliza de seguro', aseguradora+(data.numeroPoliza?(' — N° '+data.numeroPoliza):'')+' ('+bienesIds.length+' bien(es))');
    toast('Póliza guardada.','ok'); close(); renderContent();
  });
}


/* ---------------------------------------------------------------------
   18-B. CONCILIACIÓN PATRIMONIAL-CONTABLE
   Cruza el valor total del inventario físico (SIGIE) contra lo que indica
   contabilidad/SIAF a una fecha de corte, mostrando la diferencia. Es
   justamente lo que piden las auditorías de la Contraloría (conciliación
   entre el área de Control Patrimonial y el área contable). El valor
   contable se ingresa manualmente (SIGIE no tiene acceso al SIAF), y cada
   conciliación que se guarda queda como registro histórico para sustento.
   --------------------------------------------------------------------- */
const UMBRAL_CONCILIACION_PCT = 1; // % de diferencia tolerado para considerarla "Conciliado"
function calcularTotalesSIGIE(){
  const items = DB.get(KEYS.items).filter(i=>i.situacion!=='De baja');
  const categorias = DB.get(KEYS.categoriasDeprec);
  const valorAdquisicionTotal = items.reduce((a,i)=>a+(Number(i.valorAdquisicion)||0),0);
  const valorNetoLibrosTotal = items.reduce((a,i)=>{ const c=calcularDepreciacionItem(i,categorias); return a+(c?c.valorNetoLibros:(Number(i.valorAdquisicion)||0)); },0);
  const porCategoria = categorias.map(cat=>{
    const deCat = items.filter(i=>(i.categoriaDeprecId||lookupCategoriaDeprec(i.denominacion,categorias))===cat.id);
    const valorAdq = deCat.reduce((a,i)=>a+(Number(i.valorAdquisicion)||0),0);
    const valorNeto = deCat.reduce((a,i)=>{ const c=calcularDepreciacionItem(i,categorias); return a+(c?c.valorNetoLibros:(Number(i.valorAdquisicion)||0)); },0);
    return { id:cat.id, nombre:cat.nombre, cantidad:deCat.length, valorAdq, valorNeto };
  }).filter(c=>c.cantidad>0);
  return { totalItems:items.length, valorAdquisicionTotal, valorNetoLibrosTotal, porCategoria };
}
function estadoConciliacion(diffPct){
  return Math.abs(diffPct)<=UMBRAL_CONCILIACION_PCT ? 'Conciliado' : 'Con diferencia';
}
function badgeConciliacion(estado){
  return estado==='Conciliado' ? '<span class="badge badge-good">Conciliado</span>' : '<span class="badge badge-bad">Con diferencia</span>';
}
function renderConciliacion(){
  const actual = calcularTotalesSIGIE();
  const historial = [...(DB.get(KEYS.conciliaciones)||[])].sort((a,b)=>(b.fechaCorte||'').localeCompare(a.fechaCorte||''));
  return `
  <div class="card" style="margin-bottom:16px;">
    <div class="card-h"><h3>Valor actual del inventario en SIGIE (en vivo)</h3></div>
    <div class="card-b">
      <div class="grid g4">
        <div class="card kpi"><div class="lbl">Bienes activos</div><div class="val">${actual.totalItems}</div></div>
        <div class="card kpi"><div class="lbl">Valor de adquisición</div><div class="val">${money(actual.valorAdquisicionTotal)}</div></div>
        <div class="card kpi"><div class="lbl">Valor neto en libros (NICSP)</div><div class="val">${money(actual.valorNetoLibrosTotal)}</div></div>
      </div>
      ${actual.porCategoria.length>0?`<div class="tbl-wrap" style="margin-top:14px;"><table>
        <thead><tr><th>Categoría (clase NICSP)</th><th class="num">N° bienes</th><th class="num">Valor de adquisición</th><th class="num">Valor neto en libros</th></tr></thead>
        <tbody>${actual.porCategoria.map(c=>`<tr><td>${esc(c.nombre)}</td><td class="num">${c.cantidad}</td><td class="num">${money(c.valorAdq)}</td><td class="num">${money(c.valorNeto)}</td></tr>`).join('')}</tbody>
      </table></div>`:''}
      <div class="hint" style="margin-top:8px;">Estos son los valores que usará SIGIE al crear una nueva conciliación. Este módulo no se conecta al SIAF: el valor contable se ingresa manualmente, según el reporte que entregue el área de contabilidad de la UGEL/DRE.</div>
    </div>
  </div>
  <div class="card"><div class="card-h"><h3>Historial de conciliaciones</h3></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Fecha de corte</th><th class="num">Valor SIGIE (adquisición)</th><th class="num">Valor contable</th><th class="num">Diferencia</th><th class="num">Dif. %</th><th>Estado</th><th></th></tr></thead>
      <tbody>${historial.map(c=>{
        const diff = c.sigie.valorAdquisicionTotal - c.valorContable;
        const diffPct = c.valorContable ? (diff/c.valorContable*100) : (c.sigie.valorAdquisicionTotal?100:0);
        const estado = estadoConciliacion(diffPct);
        return `<tr><td>${esc(c.fechaCorte)}</td><td class="num">${money(c.sigie.valorAdquisicionTotal)}</td><td class="num">${money(c.valorContable)}</td>
        <td class="num" style="${Math.abs(diffPct)>UMBRAL_CONCILIACION_PCT?'color:var(--bad);font-weight:600;':''}">${money(diff)}</td>
        <td class="num">${diffPct.toFixed(2)}%</td><td>${badgeConciliacion(estado)}</td>
        <td style="white-space:nowrap;"><button class="btn btn-sm btn-ghost" data-verconc="${c.id}">Ver / imprimir</button>${isAdmin()?` <button class="btn btn-sm btn-ghost" data-delconc="${c.id}">Eliminar</button>`:''}</td></tr>`;
      }).join('')}
      ${historial.length===0?'<tr><td colspan="7" class="empty"><div class="big">🧮</div>Aún no se ha guardado ninguna conciliación patrimonial-contable.</td></tr>':''}
      </tbody>
    </table></div>
  </div>`;
}
function abrirModalNuevaConciliacion(){
  if(!isAdmin()){ toast('Solo un administrador puede registrar una conciliación.','err'); return; }
  const actual = calcularTotalesSIGIE();
  const bg = document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML = `<div class="modal" style="max-width:520px;">
    <div class="m-h"><h3>Nueva conciliación patrimonial-contable</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="hint" style="margin-bottom:10px;">SIGIE calculará automáticamente el valor de adquisición y el valor neto en libros según el inventario activo actual (${actual.totalItems} bien(es)). Solo ingresa lo que indique el área de contabilidad/SIAF a esta misma fecha de corte.</div>
      <div class="field"><label>Fecha de corte *</label><input id="cc_fecha" type="date" value="${today()}"></div>
      <div class="field"><label>Valor de adquisición según contabilidad/SIAF (S/.) *</label><input id="cc_valorContable" type="number" step="0.01" min="0" placeholder="Ej. 185320.00"></div>
      <div class="field"><label>Valor neto en libros según contabilidad/SIAF (S/.), opcional</label><input id="cc_valorNetoContable" type="number" step="0.01" min="0" placeholder="Déjalo vacío si no lo tienes"></div>
      <div class="field"><label>Fuente / sustento</label><input id="cc_fuente" placeholder="Ej. Estado de Situación Financiera al 31/12, reporte SIAF"></div>
      <div class="field"><label>Observaciones (sustento de la diferencia, si la hay)</label><textarea id="cc_obs" rows="3" placeholder="Ej. Diferencia por bienes pendientes de saneamiento aún no valorizados contablemente."></textarea></div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="guardar">Guardar conciliación</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  bg.querySelector('#guardar').addEventListener('click', async ()=>{
    const fechaCorte = bg.querySelector('#cc_fecha').value;
    const valorContableStr = bg.querySelector('#cc_valorContable').value.trim();
    if(!fechaCorte || valorContableStr===''){ toast('Completa la fecha de corte y el valor contable.', 'err'); return; }
    const valorContable = Number(valorContableStr);
    const valorNetoContableStr = bg.querySelector('#cc_valorNetoContable').value.trim();
    const registro = {
      id: uid('conc'), fechaCorte, sigie: calcularTotalesSIGIE(),
      valorContable, valorNetoContable: valorNetoContableStr!=='' ? Number(valorNetoContableStr) : null,
      fuente: bg.querySelector('#cc_fuente').value.trim(), observaciones: bg.querySelector('#cc_obs').value.trim(),
      creadoPor: currentUser().nombre||currentUser().usuario, fechaCreacion: today()
    };
    await DB.save(KEYS.conciliaciones, [...(DB.get(KEYS.conciliaciones)||[]), registro]);
    await registrarBitacora('Registrar conciliación patrimonial-contable', 'Fecha de corte '+fechaCorte+' — Valor SIGIE: '+money(registro.sigie.valorAdquisicionTotal)+' vs. contable: '+money(valorContable));
    toast('Conciliación registrada.','ok');
    close(); renderContent();
  });
}
function generarConciliacionHTML(c){
  const cfg = DB.get(KEYS.config);
  const diff = c.sigie.valorAdquisicionTotal - c.valorContable;
  const diffPct = c.valorContable ? (diff/c.valorContable*100) : (c.sigie.valorAdquisicionTotal?100:0);
  const estado = estadoConciliacion(diffPct);
  const diffNeto = c.valorNetoContable!=null ? (c.sigie.valorNetoLibrosTotal - c.valorNetoContable) : null;
  return `
  <div class="ficha">
    <div class="ficha-header">
      <div class="logo-slot">${logoDeConfig(cfg)?`<img src="${logoDeConfig(cfg)}">`:''}</div>
      <div class="meta-center">
        <h2>Conciliación Patrimonial-Contable</h2>
        <h3 style="font-weight:normal;">${esc(cfg.nombreIE)} — UGEL ${esc(cfg.ugel||'—')}</h3>
      </div>
    </div>
    <p style="font-size:11.5px;">Fecha de corte: <b>${esc(fechaLarga(c.fechaCorte))}</b> &nbsp;&nbsp; Fuente/sustento del valor contable: <b>${esc(c.fuente||'—')}</b></p>
    <table><thead><tr><th>Indicador</th><th>Control Patrimonial (SIGIE)</th><th>Contabilidad / SIAF</th><th>Diferencia</th></tr></thead>
      <tbody>
        <tr><td>Valor de adquisición</td><td class="num">${money(c.sigie.valorAdquisicionTotal)}</td><td class="num">${money(c.valorContable)}</td><td class="num">${money(diff)} (${diffPct.toFixed(2)}%)</td></tr>
        ${c.valorNetoContable!=null?`<tr><td>Valor neto en libros (NICSP)</td><td class="num">${money(c.sigie.valorNetoLibrosTotal)}</td><td class="num">${money(c.valorNetoContable)}</td><td class="num">${money(diffNeto)}</td></tr>`:''}
      </tbody></table>
    <p style="font-size:11.5px;margin-top:8px;"><b>Resultado:</b> ${estado==='Conciliado'?'Las cifras se consideran conciliadas (diferencia dentro del umbral de '+UMBRAL_CONCILIACION_PCT+'%).':'Se encontró una diferencia que debe sustentarse.'}</p>
    ${c.sigie.porCategoria.length>0?`<table style="margin-top:8px;"><thead><tr><th>Categoría (clase NICSP)</th><th>N° bienes</th><th>Valor de adquisición (SIGIE)</th></tr></thead>
      <tbody>${c.sigie.porCategoria.map(cat=>`<tr><td>${esc(cat.nombre)}</td><td class="num">${cat.cantidad}</td><td class="num">${money(cat.valorAdq)}</td></tr>`).join('')}</tbody></table>`:''}
    ${c.observaciones?`<p style="font-size:11.5px;margin-top:8px;"><b>Observaciones / sustento de la diferencia:</b><br>${esc(c.observaciones)}</p>`:''}
    <div style="display:flex;justify-content:space-around;margin-top:60px;font-size:11px;text-align:center;">
      <div>_____________________________<br>Responsable de Control Patrimonial</div>
      <div>_____________________________<br>Responsable de Contabilidad</div>
    </div>
    <p style="font-size:10px;margin-top:20px;">Generado por SIGIE el ${esc(fechaLarga(today()))} — Registrado por ${esc(c.creadoPor)} el ${esc(c.fechaCreacion)}.</p>
  </div>`;
}
function verConciliacionDetalle(id){
  const c = (DB.get(KEYS.conciliaciones)||[]).find(x=>x.id===id); if(!c) return;
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal wide">
    <div class="m-h"><h3>Conciliación — ${esc(c.fechaCorte)}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">${generarConciliacionHTML(c)}</div>
    <div class="m-f"><button class="btn" id="close">Cerrar</button><button class="btn btn-primary" id="print">Imprimir / PDF</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#close').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  bg.querySelector('#print').addEventListener('click', ()=>abrirVentanaImpresion('Conciliación Patrimonial-Contable — '+c.fechaCorte, generarConciliacionHTML(c)));
}
async function eliminarConciliacion(id){
  if(!isAdmin()) return;
  if(!confirm('¿Eliminar esta conciliación del historial? Esta acción no se puede deshacer.')) return;
  const list = (DB.get(KEYS.conciliaciones)||[]).filter(x=>x.id!==id);
  await DB.save(KEYS.conciliaciones, list);
  await registrarBitacora('Eliminar conciliación patrimonial-contable', id);
  toast('Conciliación eliminada.','ok');
  renderContent();
}

/* ---------------------------------------------------------------------
   15-B. REQUERIMIENTOS Y ÓRDENES DE COMPRA
   Flujo: Solicitado -> (Aprobado | Rechazado) -> En compra (con datos de la
   orden: proveedor, N° de orden, fecha de entrega) -> Recibido parcial/total.
   Al registrar cada recepción se dan de alta automáticamente los bienes
   correspondientes en el inventario, en "Almacén" (sin aula asignada todavía),
   reutilizando la misma numeración patrimonial (SBN + correlativo) que usa el
   resto del sistema, para no duplicar trabajo de digitación.
   --------------------------------------------------------------------- */
async function nextCorrelativoReq(){
  let seq = (DB.get(KEYS.seqReq)||0) + 1;
  await DB.save(KEYS.seqReq, seq);
  return seq;
}
function reqEstadoBadge(e){
  const cls = e==='Recibido total' ? 'badge-good' : e==='Rechazado'||e==='Cancelado' ? 'badge-bad'
    : e==='Solicitado' ? 'badge-info' : 'badge-warn';
  return `<span class="badge ${cls}">${esc(e)}</span>`;
}
function reqTotalEstimado(r){ return (r.lineas||[]).reduce((a,l)=>a+(Number(l.cantidad)||0)*(Number(l.precioUnitario)||0),0); }
/* ---------------------------------------------------------------------
   16-X. PRESUPUESTO POR FUENTE DE FINANCIAMIENTO — permite asignar un
   techo presupuestal anual por cada fuente (Recursos Ordinarios, RDR,
   APAFA, Donaciones, etc.) y ver cuánto se ha comprometido (requerimientos
   aprobados en adelante) y ejecutado (lo efectivamente recibido) contra
   ese techo. Se apoya en el campo "Fuente de financiamiento" que ahora
   tiene cada Requerimiento de compra.
   --------------------------------------------------------------------- */
const FUENTES_FINANCIAMIENTO = ['Recursos Ordinarios (RO)','Recursos Directamente Recaudados (RDR)','APAFA','Donaciones','Otro'];
function reqComprometido(r){ return ['Aprobado','En compra','Recibido parcial','Recibido total'].includes(r.estado) ? reqTotalEstimado(r) : 0; }
function reqEjecutado(r){ return (r.lineas||[]).reduce((a,l)=>a+(Number(l.cantidadRecibida)||0)*(Number(l.precioUnitario)||0),0); }
function resumenPresupuestoFuente(anio, fuente){
  const pres = (DB.get(KEYS.presupuestos)||[]).find(p=>String(p.anio)===String(anio) && p.fuente===fuente);
  const asignado = pres ? Number(pres.montoAsignado) : 0;
  const reqs = (DB.get(KEYS.requerimientos)||[]).filter(r=>(r.fuenteFinanciamiento||'Sin especificar')===fuente && (r.fecha||'').slice(0,4)===String(anio));
  const comprometido = reqs.reduce((a,r)=>a+reqComprometido(r),0);
  const ejecutado = reqs.reduce((a,r)=>a+reqEjecutado(r),0);
  return { asignado, comprometido, ejecutado, disponible: asignado-comprometido, reqs };
}
function barraPresupuesto(pct, color){
  const w = Math.max(0, Math.min(100, pct));
  return `<div style="background:#e5e9ee;border-radius:6px;height:8px;overflow:hidden;margin:6px 0;"><div style="width:${w}%;height:100%;background:${color};"></div></div>`;
}
function renderPresupuesto(){
  const cfg = DB.get(KEYS.config);
  const anio = STATE.presupuestoAnio || cfg.anioFiscal;
  const aniosConDatos = new Set([cfg.anioFiscal, ...(DB.get(KEYS.requerimientos)||[]).map(r=>(r.fecha||'').slice(0,4)).filter(Boolean), ...(DB.get(KEYS.presupuestos)||[]).map(p=>String(p.anio))]);
  const anios = [...aniosConDatos].sort().reverse();
  const hayNoEspecificado = (DB.get(KEYS.requerimientos)||[]).some(r=>!r.fuenteFinanciamiento && (r.fecha||'').slice(0,4)===String(anio));
  const fuentes = hayNoEspecificado ? [...FUENTES_FINANCIAMIENTO, 'Sin especificar'] : FUENTES_FINANCIAMIENTO;
  const tarjetas = fuentes.map(fuente=>{
    const r = resumenPresupuestoFuente(anio, fuente);
    const pctComprometido = r.asignado>0 ? (r.comprometido/r.asignado*100) : 0;
    const pctEjecutado = r.asignado>0 ? (r.ejecutado/r.asignado*100) : 0;
    const excedido = r.asignado>0 && r.comprometido>r.asignado;
    return `<div class="card"><div class="card-b">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h4 style="margin:0;">${esc(fuente)}</h4>
        ${(isAdmin() && fuente!=='Sin especificar')?`<button class="btn btn-sm btn-ghost" data-editpresu="${esc(fuente)}">${r.asignado>0?'Editar techo':'Asignar techo'}</button>`:''}
      </div>
      ${r.asignado>0?`
        <div class="hint" style="margin-top:6px;">Asignado: <b>${money(r.asignado)}</b></div>
        <div class="hint">Comprometido: <b>${money(r.comprometido)}</b> (${pctComprometido.toFixed(0)}%)</div>
        ${barraPresupuesto(pctComprometido, excedido?'#c0392b':'#2f6fb0')}
        <div class="hint">Ejecutado (recibido): <b>${money(r.ejecutado)}</b> (${pctEjecutado.toFixed(0)}%)</div>
        ${barraPresupuesto(pctEjecutado, '#1e8449')}
        <div style="margin-top:6px;"><b>Disponible: <span style="color:${r.disponible<0?'#c0392b':'#1e8449'};">${money(r.disponible)}</span></b></div>
        ${excedido?'<div class="note-banner" style="background:var(--bad-soft);border-color:#e6b3ba;color:var(--bad);margin-top:6px;padding:6px;font-size:11px;">⚠️ Lo comprometido supera el techo asignado.</div>':''}
      `:`<div class="hint" style="margin-top:6px;">${fuente==='Sin especificar'?'Requerimientos de años anteriores sin fuente asignada.':'Aún no se ha asignado un techo presupuestal para esta fuente en '+esc(anio)+'.'}</div>
        ${r.comprometido>0?`<div class="hint">Comprometido de todos modos (sin techo definido): <b>${money(r.comprometido)}</b></div>`:''}`}
    </div></div>`;
  }).join('');
  return `
  <div class="card"><div class="card-b" style="padding-bottom:0;">
    <div class="field" style="max-width:200px;"><label>Año</label><select id="pf_anio">${anios.map(a=>`<option value="${esc(a)}" ${String(anio)===String(a)?'selected':''}>${esc(a)}</option>`).join('')}</select></div>
  </div></div>
  <div class="cards-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-top:10px;">${tarjetas}</div>`;
}
function abrirModalPresupuesto(anio, fuente){
  if(!isAdmin()) return;
  const existente = (DB.get(KEYS.presupuestos)||[]).find(p=>String(p.anio)===String(anio) && p.fuente===fuente);
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal" style="max-width:420px;">
    <div class="m-h"><h3>${existente?'Editar techo presupuestal':'Asignar techo presupuestal'}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="hint" style="margin-bottom:8px;"><b>Fuente:</b> ${esc(fuente)} &nbsp; <b>Año:</b> ${esc(anio)}</div>
      <div class="field"><label>Monto asignado (S/.) *</label><input id="pf_monto" type="number" min="0" step="0.01" value="${existente?Number(existente.montoAsignado):''}"></div>
      <div class="field"><label>Observaciones (opcional)</label><textarea id="pf_obs" rows="2">${esc(existente?.observaciones||'')}</textarea></div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Guardar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  bg.querySelector('#save').addEventListener('click', async ()=>{
    const montoAsignado = Number(bg.querySelector('#pf_monto').value);
    if(!(montoAsignado>=0)){ toast('Ingresa un monto válido.','err'); return; }
    const observaciones = bg.querySelector('#pf_obs').value.trim();
    let list = [...(DB.get(KEYS.presupuestos)||[])];
    if(existente){ list = list.map(x=>x.id===existente.id?{...x, montoAsignado, observaciones}:x); }
    else{ list = [...list, { id:uid('presu'), anio:String(anio), fuente, montoAsignado, observaciones }]; }
    await DB.save(KEYS.presupuestos, list);
    await registrarBitacora('Asignar techo presupuestal', fuente+' — '+anio+' — '+money(montoAsignado));
    toast('Techo presupuestal guardado.','ok'); close(); renderContent();
  });
}
function reqCantidadPedida(r){ return (r.lineas||[]).reduce((a,l)=>a+(Number(l.cantidad)||0),0); }
function reqCantidadRecibida(r){ return (r.lineas||[]).reduce((a,l)=>a+(Number(l.cantidadRecibida)||0),0); }
function renderRequerimientos(){
  let regs = [...(DB.get(KEYS.requerimientos)||[])].sort((a,b)=>(b.numero||'').localeCompare(a.numero||''));
  const f = STATE.filtersReq;
  regs = regs.filter(r=>{
    if(f.q){ const hay=(r.numero+' '+r.solicitante+' '+(r.lineas||[]).map(l=>l.denominacion).join(' ')).toLowerCase(); if(!hay.includes(f.q.toLowerCase())) return false; }
    if(f.estado && r.estado!==f.estado) return false;
    return true;
  });
  const pendientesAprobacion = (DB.get(KEYS.requerimientos)||[]).filter(r=>r.estado==='Solicitado').length;
  return `
  ${isAdmin()&&pendientesAprobacion>0?`<div class="note-banner" style="background:var(--warn-soft,#fff3cd);border-color:#e6d3a3;color:#8a6d1a;">🛒 Tienes <b>${pendientesAprobacion}</b> requerimiento(s) esperando aprobación.</div>`:''}
  <div class="card"><div class="card-b" style="padding-bottom:0;">
    <div class="grid g2">
      <input class="search" id="rfq" placeholder="Buscar por N°, solicitante o denominación…" value="${esc(f.q)}">
      <select id="rfestado"><option value="">— Todos los estados —</option>${ESTADOS_REQ.map(e=>`<option value="${esc(e)}" ${f.estado===e?'selected':''}>${esc(e)}</option>`).join('')}</select>
    </div>
    <div style="margin:8px 0 4px;"><button class="btn btn-sm" id="rfclear">Limpiar filtros</button></div>
  </div>
  <div class="tbl-wrap"><table>
    <thead><tr><th>N°</th><th>Fecha</th><th>Solicitante</th><th>Fuente</th><th>Ítems</th><th>Total estimado</th><th>Estado</th><th></th></tr></thead>
    <tbody>${regs.map(r=>{
      const resumenItems = (r.lineas||[]).map(l=>l.denominacion+' ('+l.cantidad+')').join(', ');
      return `<tr>
      <td class="mono">${esc(r.numero)}</td><td>${esc(r.fecha)}</td><td>${esc(r.solicitante)}</td>
      <td>${esc(r.fuenteFinanciamiento||'—')}</td>
      <td style="max-width:280px;">${esc(resumenItems)}</td>
      <td class="num">${money(reqTotalEstimado(r))}</td>
      <td>${reqEstadoBadge(r.estado)}</td>
      <td><button class="btn btn-sm btn-ghost" data-verreq="${r.id}">Ver</button></td>
    </tr>`;}).join('')}
    ${regs.length===0?'<tr><td colspan="8" class="empty"><div class="big">🛒</div>Aún no hay requerimientos registrados.</td></tr>':''}
    </tbody></table></div>`;
}
function openRequerimientoModal(id){
  if(!guardEdit()) return;
  const regs = DB.get(KEYS.requerimientos)||[];
  const r = id?regs.find(x=>x.id===id):null;
  if(r && r.estado!=='Solicitado'){ toast('Este requerimiento ya fue procesado y no se puede editar; solo puede cancelarse.','err'); return; }
  const aulas = scopedAulas();
  let lineas = r ? JSON.parse(JSON.stringify(r.lineas)) : [{id:uid('rl'), denominacion:'', cantidad:1, precioUnitario:''}];
  const bg=document.createElement('div'); bg.className='modal-bg';
  function filaHTML(l){
    return `<tr data-lid="${l.id}">
      <td><input class="rl_denom" value="${esc(l.denominacion)}" placeholder="Ej. LAPTOP EDUCATIVA"></td>
      <td><input class="rl_cant" type="number" min="1" step="1" value="${esc(l.cantidad)}" style="width:70px;"></td>
      <td><input class="rl_precio" type="number" min="0" step="0.01" value="${l.precioUnitario!==''?esc(l.precioUnitario):''}" placeholder="0.00" style="width:100px;"></td>
      <td><button type="button" class="btn btn-sm btn-danger rl_del">✕</button></td>
    </tr>`;
  }
  bg.innerHTML=`<div class="modal wide">
    <div class="m-h"><h3>${r?'Editar requerimiento':'Nuevo requerimiento de compra'}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="grid g2">
        <div class="field"><label>Fecha</label><input id="rq_fecha" type="date" value="${esc(r?r.fecha:today())}"></div>
        <div class="field"><label>Solicitante</label><input id="rq_solicitante" value="${esc(r?r.solicitante:(currentUser().nombre||currentUser().usuario))}"></div>
      </div>
      <div class="grid g2">
        <div class="field"><label>Área / aula relacionada (opcional)</label><select id="rq_aula"><option value="">— No aplica / uso general —</option>${aulas.map(a=>`<option value="${a.id}" ${r&&r.aulaId===a.id?'selected':''}>${esc(a.aulaLabel||a.nombre)}</option>`).join('')}</select></div>
        <div class="field"><label>Fuente de financiamiento</label><select id="rq_fuente">${FUENTES_FINANCIAMIENTO.map(f=>`<option value="${esc(f)}" ${(r?r.fuenteFinanciamiento:FUENTES_FINANCIAMIENTO[0])===f?'selected':''}>${esc(f)}</option>`).join('')}</select></div>
      </div>
      <div class="hint" id="rq_presu_hint"></div>
      <div class="field"><label>Justificación / motivo *</label><textarea id="rq_justificacion" rows="2" placeholder="Ej. Se requiere reemplazar equipos obsoletos del aula de cómputo.">${esc(r?r.justificacion:'')}</textarea></div>
      <div class="field"><label>Bienes solicitados *</label>
        <div class="tbl-wrap"><table>
          <thead><tr><th>Denominación</th><th>Cantidad</th><th>Precio unitario est. (S/.)</th><th></th></tr></thead>
          <tbody id="rq_lineas">${lineas.map(filaHTML).join('')}</tbody>
        </table></div>
        <button type="button" class="btn btn-sm" id="rq_addlinea" style="margin-top:6px;">+ Agregar ítem</button>
        <div class="hint">El código SBN de cada denominación se detectará automáticamente contra el Catálogo SBN al momento de recibir el bien.</div>
      </div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Guardar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  function wireFila(tr){ tr.querySelector('.rl_del').addEventListener('click', ()=>{ if(bg.querySelectorAll('#rq_lineas tr').length<=1){ toast('Debe haber al menos un ítem.','err'); return; } tr.remove(); }); }
  bg.querySelectorAll('#rq_lineas tr').forEach(wireFila);
  bg.querySelector('#rq_addlinea').addEventListener('click', ()=>{
    const tbody = bg.querySelector('#rq_lineas');
    const div = document.createElement('tbody'); div.innerHTML = filaHTML({id:uid('rl'), denominacion:'', cantidad:1, precioUnitario:''});
    const tr = div.firstElementChild; tbody.appendChild(tr); wireFila(tr);
  });
  const actualizarHintPresu = ()=>{
    const fuente = bg.querySelector('#rq_fuente').value;
    const resumen = resumenPresupuestoFuente(DB.get(KEYS.config).anioFiscal, fuente);
    bg.querySelector('#rq_presu_hint').innerHTML = resumen.asignado>0
      ? `Presupuesto ${esc(fuente)} ${esc(DB.get(KEYS.config).anioFiscal)}: asignado ${money(resumen.asignado)} · comprometido ${money(resumen.comprometido)} · disponible <b>${money(resumen.disponible)}</b>`
      : `Aún no se ha asignado un techo presupuestal para "${esc(fuente)}" este año (Gestión &gt; Presupuesto).`;
  };
  bg.querySelector('#rq_fuente').addEventListener('change', actualizarHintPresu);
  actualizarHintPresu();
  bg.querySelector('#save').addEventListener('click', async ()=>{
    const fecha = bg.querySelector('#rq_fecha').value || today();
    const solicitante = bg.querySelector('#rq_solicitante').value.trim();
    const justificacion = bg.querySelector('#rq_justificacion').value.trim();
    const aulaId = bg.querySelector('#rq_aula').value;
    const aula = aulaId ? aulas.find(a=>a.id===aulaId) : null;
    const fuenteFinanciamiento = bg.querySelector('#rq_fuente').value;
    const filas = [...bg.querySelectorAll('#rq_lineas tr')];
    const nuevasLineas = [];
    for(const tr of filas){
      const denominacion = tr.querySelector('.rl_denom').value.trim().toUpperCase();
      const cantidad = Number(tr.querySelector('.rl_cant').value)||0;
      const precioStr = tr.querySelector('.rl_precio').value.trim();
      if(!denominacion || cantidad<=0) continue;
      const lidPrev = tr.dataset.lid;
      const lineaPrev = r ? (r.lineas||[]).find(l=>l.id===lidPrev) : null;
      nuevasLineas.push({ id: lidPrev, denominacion, cantidad, precioUnitario: precioStr!==''?Number(precioStr):0, cantidadRecibida: lineaPrev?(lineaPrev.cantidadRecibida||0):0 });
    }
    if(!solicitante || !justificacion || nuevasLineas.length===0){ toast('Completa el solicitante, la justificación y al menos un ítem válido (denominación y cantidad).','err'); return; }
    let list = DB.get(KEYS.requerimientos)||[];
    if(r){
      const data = { ...r, fecha, solicitante, aulaId, aulaNombre: aula?(aula.aulaLabel||aula.nombre):'', justificacion, lineas:nuevasLineas, fuenteFinanciamiento };
      list = list.map(x=>x.id===r.id?data:x);
      await registrarBitacora('Editar requerimiento de compra', data.numero);
    }else{
      const numero = 'REQ-'+DB.get(KEYS.config).anioFiscal+'-'+String(await nextCorrelativoReq()).padStart(4,'0');
      const data = {
        id: uid('req'), numero, fecha, solicitante, aulaId, aulaNombre: aula?(aula.aulaLabel||aula.nombre):'',
        justificacion, lineas:nuevasLineas, estado:'Solicitado', fuenteFinanciamiento,
        aprobadoPor:'', fechaAprobacion:'', motivoRechazo:'', ordenCompra:null, historialRecepciones:[],
        creadoPor: currentUser().usuario, fechaCreacion: today()
      };
      list = [...list, data];
      await registrarBitacora('Registrar requerimiento de compra', numero+' — '+nuevasLineas.length+' ítem(s)');
    }
    await DB.save(KEYS.requerimientos, list);
    toast(r?'Requerimiento actualizado.':'Requerimiento registrado. Queda pendiente de aprobación.','ok');
    close(); renderContent();
  });
}
function verRequerimientoDetalle(id){
  const r = (DB.get(KEYS.requerimientos)||[]).find(x=>x.id===id); if(!r) return;
  const totalEstimado = reqTotalEstimado(r);
  const bg=document.createElement('div'); bg.className='modal-bg';
  const filasLineas = (r.lineas||[]).map(l=>`<tr>
    <td>${esc(l.denominacion)}</td><td class="num">${l.cantidad}</td>
    <td class="num">${money(l.precioUnitario)}</td><td class="num">${money(l.cantidad*l.precioUnitario)}</td>
    <td class="num">${l.cantidadRecibida||0} / ${l.cantidad}</td>
  </tr>`).join('');
  const botones = [];
  if(isAdmin() && r.estado==='Solicitado'){
    botones.push(`<button class="btn btn-primary" id="rq_aprobar">✓ Aprobar</button>`);
    botones.push(`<button class="btn btn-danger" id="rq_rechazar">✕ Rechazar</button>`);
  }
  if(canEdit() && r.estado==='Solicitado'){ botones.push(`<button class="btn" id="rq_editar">Editar</button>`); }
  if(isAdmin() && r.estado==='Aprobado'){ botones.push(`<button class="btn btn-primary" id="rq_ordencompra">🧾 Generar orden de compra</button>`); }
  if(isAdmin() && (r.estado==='En compra' || r.estado==='Recibido parcial')){ botones.push(`<button class="btn btn-primary" id="rq_recepcion">📦 Registrar recepción</button>`); }
  if(r.ordenCompra){ botones.push(`<button class="btn" id="rq_imprimir">🖨 Imprimir orden de compra</button>`); }
  if(isAdmin() && !['Recibido total','Cancelado'].includes(r.estado)){ botones.push(`<button class="btn btn-danger" id="rq_cancelar">Cancelar requerimiento</button>`); }
  bg.innerHTML=`<div class="modal wide">
    <div class="m-h"><h3>${esc(r.numero)} ${reqEstadoBadge(r.estado)}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="grid g2">
        <div><b>Fecha:</b> ${esc(r.fecha)}</div>
        <div><b>Solicitante:</b> ${esc(r.solicitante)}</div>
      </div>
      <div style="margin-top:4px;"><b>Fuente de financiamiento:</b> ${esc(r.fuenteFinanciamiento||'—')}</div>
      ${r.aulaNombre?`<div style="margin-top:4px;"><b>Área / aula:</b> ${esc(r.aulaNombre)}</div>`:''}
      <div style="margin-top:4px;"><b>Justificación:</b> ${esc(r.justificacion)}</div>
      <div class="tbl-wrap" style="margin-top:10px;"><table>
        <thead><tr><th>Denominación</th><th>Cant.</th><th>P. unitario</th><th>Subtotal</th><th>Recibido</th></tr></thead>
        <tbody>${filasLineas}</tbody>
        <tfoot><tr><td colspan="3" style="text-align:right;"><b>Total estimado</b></td><td class="num"><b>${money(totalEstimado)}</b></td><td></td></tr></tfoot>
      </table></div>
      ${r.estado==='Rechazado'&&r.motivoRechazo?`<div class="note-banner" style="background:var(--bad-soft);border-color:#e6b3ba;color:var(--bad);margin-top:10px;">Motivo del rechazo: ${esc(r.motivoRechazo)}</div>`:''}
      ${r.aprobadoPor?`<div class="hint" style="margin-top:6px;">Aprobado por ${esc(r.aprobadoPor)} el ${esc(r.fechaAprobacion)}.</div>`:''}
      ${r.ordenCompra?`<div class="card" style="margin-top:10px;"><div class="card-b">
        <h4 style="margin:0 0 6px;">🧾 Orden de compra</h4>
        <div class="grid g2">
          <div><b>N° de orden:</b> ${esc(r.ordenCompra.numero)}</div>
          <div><b>Proveedor:</b> ${esc(r.ordenCompra.proveedor)}</div>
          <div><b>RUC:</b> ${esc(r.ordenCompra.ruc||'—')}</div>
          <div><b>Fecha de emisión:</b> ${esc(r.ordenCompra.fechaEmision)}</div>
          <div><b>Entrega estimada:</b> ${esc(r.ordenCompra.fechaEntregaEstimada||'—')}</div>
        </div>
      </div></div>`:''}
      ${(r.historialRecepciones||[]).length>0?`<div style="margin-top:10px;"><b>Historial de recepciones</b>
        <div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Recibido por</th><th>Ítems recibidos</th><th>Observación</th></tr></thead>
        <tbody>${r.historialRecepciones.map(h=>`<tr><td>${esc(h.fecha)}</td><td>${esc(h.recibidoPor)}</td><td>${h.lineas.map(x=>{ const l=(r.lineas||[]).find(y=>y.id===x.lineaId); return (l?l.denominacion:'')+' ('+x.cantidad+')'; }).join(', ')}</td><td>${esc(h.observacion||'—')}</td></tr>`).join('')}</tbody>
        </table></div></div>`:''}
    </div>
    <div class="m-f" style="flex-wrap:wrap;gap:6px;">${botones.join('')}<button class="btn" id="close">Cerrar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#close').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  bg.querySelector('#rq_editar')?.addEventListener('click', ()=>{ close(); openRequerimientoModal(r.id); });
  bg.querySelector('#rq_aprobar')?.addEventListener('click', ()=>aprobarRequerimiento(r.id, close));
  bg.querySelector('#rq_rechazar')?.addEventListener('click', ()=>rechazarRequerimiento(r.id, close));
  bg.querySelector('#rq_ordencompra')?.addEventListener('click', ()=>{ close(); abrirModalOrdenCompra(r.id); });
  bg.querySelector('#rq_recepcion')?.addEventListener('click', ()=>{ close(); abrirModalRecepcion(r.id); });
  bg.querySelector('#rq_imprimir')?.addEventListener('click', ()=>abrirVentanaImpresion('Orden de compra — '+r.ordenCompra.numero, generarOrdenCompraHTML(r)));
  bg.querySelector('#rq_cancelar')?.addEventListener('click', async ()=>{
    if(!confirm('¿Cancelar este requerimiento? Esta acción no se puede deshacer.')) return;
    const list = (DB.get(KEYS.requerimientos)||[]).map(x=>x.id===r.id?{...x, estado:'Cancelado'}:x);
    await DB.save(KEYS.requerimientos, list);
    await registrarBitacora('Cancelar requerimiento de compra', r.numero);
    toast('Requerimiento cancelado.','ok'); close(); renderContent();
  });
}
async function aprobarRequerimiento(id, cerrarPadre){
  if(!isAdmin()) return;
  if(!confirm('¿Aprobar este requerimiento? Podrás generar la orden de compra a continuación.')) return;
  const list = (DB.get(KEYS.requerimientos)||[]).map(x=>x.id===id?{...x, estado:'Aprobado', aprobadoPor:currentUser().nombre||currentUser().usuario, fechaAprobacion:today()}:x);
  await DB.save(KEYS.requerimientos, list);
  const r = list.find(x=>x.id===id);
  await registrarBitacora('Aprobar requerimiento de compra', r.numero);
  toast('Requerimiento aprobado.','ok');
  if(cerrarPadre) cerrarPadre();
  renderContent();
}
async function rechazarRequerimiento(id, cerrarPadre){
  if(!isAdmin()) return;
  const motivo = prompt('Motivo del rechazo:');
  if(motivo===null) return;
  const list = (DB.get(KEYS.requerimientos)||[]).map(x=>x.id===id?{...x, estado:'Rechazado', motivoRechazo:motivo.trim()}:x);
  await DB.save(KEYS.requerimientos, list);
  const r = list.find(x=>x.id===id);
  await registrarBitacora('Rechazar requerimiento de compra', r.numero+(motivo.trim()?(' — '+motivo.trim()):''));
  toast('Requerimiento rechazado.','ok');
  if(cerrarPadre) cerrarPadre();
  renderContent();
}
function abrirModalOrdenCompra(id){
  if(!isAdmin()) return;
  const r = (DB.get(KEYS.requerimientos)||[]).find(x=>x.id===id); if(!r) return;
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal">
    <div class="m-h"><h3>Generar orden de compra — ${esc(r.numero)}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="grid g2">
        <div class="field"><label>N° de orden de compra</label><input id="oc_numero" value="OC-${DB.get(KEYS.config).anioFiscal}-${String((DB.get(KEYS.requerimientos)||[]).filter(x=>x.ordenCompra).length+1).padStart(4,'0')}"></div>
        <div class="field"><label>Fecha de emisión</label><input id="oc_fecha" type="date" value="${today()}"></div>
      </div>
      <div class="grid g2">
        <div class="field"><label>Proveedor *</label><input id="oc_proveedor" placeholder="Razón social del proveedor"></div>
        <div class="field"><label>RUC</label><input id="oc_ruc" placeholder="Opcional"></div>
      </div>
      <div class="field"><label>Fecha de entrega estimada (opcional)</label><input id="oc_entrega" type="date"></div>
      <div class="hint">Total estimado de la orden: <b>${money(reqTotalEstimado(r))}</b> (${reqCantidadPedida(r)} unidad(es) en ${r.lineas.length} ítem(s)).</div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Generar orden</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  bg.querySelector('#save').addEventListener('click', async ()=>{
    const proveedor = bg.querySelector('#oc_proveedor').value.trim();
    const numero = bg.querySelector('#oc_numero').value.trim();
    if(!proveedor || !numero){ toast('Completa al menos el N° de orden y el proveedor.','err'); return; }
    const ordenCompra = { numero, proveedor, ruc: bg.querySelector('#oc_ruc').value.trim(), fechaEmision: bg.querySelector('#oc_fecha').value||today(), fechaEntregaEstimada: bg.querySelector('#oc_entrega').value||'' };
    const list = (DB.get(KEYS.requerimientos)||[]).map(x=>x.id===id?{...x, estado:'En compra', ordenCompra}:x);
    await DB.save(KEYS.requerimientos, list);
    await registrarBitacora('Generar orden de compra', r.numero+' — OC '+numero+' — '+proveedor);
    toast('Orden de compra generada.','ok');
    close(); verRequerimientoDetalle(id);
  });
}
function generarOrdenCompraHTML(r){
  const cfg = DB.get(KEYS.config);
  const oc = r.ordenCompra;
  return `<div class="ficha">
    <div class="ficha-header">
      <div class="logo-slot">${logoDeConfig(cfg)?`<img src="${logoDeConfig(cfg)}">`:''}</div>
      <div class="meta-center"><h2>Orden de Compra</h2><div>${esc(cfg.nombreIE)} — Año ${esc(cfg.anioFiscal)}</div></div>
    </div>
    <table style="margin-top:6px;"><tbody>
      <tr><td><b>N° de orden</b></td><td>${esc(oc.numero)}</td><td><b>Requerimiento</b></td><td>${esc(r.numero)}</td></tr>
      <tr><td><b>Proveedor</b></td><td>${esc(oc.proveedor)}</td><td><b>RUC</b></td><td>${esc(oc.ruc||'—')}</td></tr>
      <tr><td><b>Fecha de emisión</b></td><td>${esc(oc.fechaEmision)}</td><td><b>Entrega estimada</b></td><td>${esc(oc.fechaEntregaEstimada||'—')}</td></tr>
    </tbody></table>
    <table style="margin-top:10px;"><thead><tr><th>Denominación</th><th>Cantidad</th><th>P. unitario</th><th>Subtotal</th></tr></thead>
      <tbody>${(r.lineas||[]).map(l=>`<tr><td>${esc(l.denominacion)}</td><td class="num">${l.cantidad}</td><td class="num">${money(l.precioUnitario)}</td><td class="num">${money(l.cantidad*l.precioUnitario)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="3" style="text-align:right;"><b>Total</b></td><td class="num"><b>${money(reqTotalEstimado(r))}</b></td></tr></tfoot>
    </table>
    <div style="display:flex;justify-content:space-around;margin-top:60px;font-size:11px;text-align:center;">
      <div>_____________________________<br>Responsable de Control Patrimonial</div>
      <div>_____________________________<br>Proveedor</div>
    </div>
    <p style="font-size:10px;margin-top:20px;">Generado por SIGIE el ${esc(fechaLarga(today()))}.</p>
  </div>`;
}
/* ---------------------------------------------------------------------
   14-C. OCR DE FACTURAS/GUÍAS — al registrar la recepción de una compra,
   permite fotografiar/adjuntar la factura o guía de remisión y que el
   sistema intente leer automáticamente la fecha, el N° de documento y el
   monto total, para no tipearlos a mano. Es un reconocimiento heurístico
   (no infalible): el usuario siempre debe revisar los datos detectados
   antes de confirmar la recepción. Requiere conexión a internet la
   primera vez que se usa (para descargar el modelo de lectura en
   español); luego el navegador lo guarda en caché y funciona offline.
   --------------------------------------------------------------------- */
async function ocrLeerImagen(file, onProgress){
  if(typeof Tesseract==='undefined') await cargarLibreria('tesseract');
  const worker = await Tesseract.createWorker('spa', 1, { logger:onProgress });
  try{
    const { data:{ text } } = await worker.recognize(file);
    return text;
  } finally {
    try{ await worker.terminate(); }catch(e){}
  }
}
function parseFacturaTexto(texto){
  const t = (texto||'').replace(/\r/g,'');
  const out = {};
  const mFecha = t.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if(mFecha){ out.fecha = `${mFecha[3]}-${mFecha[2].padStart(2,'0')}-${mFecha[1].padStart(2,'0')}`; }
  const mDoc = t.match(/(FACTURA|BOLETA|GU[IÍ]A\s*DE\s*REMISI[OÓ]N|GUIA)[^\n]{0,25}?([A-Z]{1,4}\s?0*\d{1,4}\s*[-–]\s*0*\d{1,10})/i)
            || t.match(/\b([BFTE]\s?0*\d{1,3}\s*[-–]\s*0*\d{4,10})\b/);
  if(mDoc){ out.numeroDocumento = mDoc[0].replace(/\s+/g,' ').trim(); }
  const mTotal = t.match(/TOTAL\s*(?:A\s*PAGAR|GENERAL|VENTA)?\s*[:\-\s]*S?\/?\.?\s*([\d,]+\.\d{2})/i);
  if(mTotal){ out.total = Number(mTotal[1].replace(/,/g,'')); }
  const mRuc = t.match(/RUC\s*[:\-]?\s*(\d{11})/i);
  if(mRuc){ out.ruc = mRuc[1]; }
  return out;
}
function abrirModalRecepcion(id){
  if(!isAdmin()) return;
  const r = (DB.get(KEYS.requerimientos)||[]).find(x=>x.id===id); if(!r) return;
  const pendientes = (r.lineas||[]).filter(l=>(l.cantidadRecibida||0)<l.cantidad);
  if(pendientes.length===0){ toast('Ya se recibieron todos los ítems de este requerimiento.','err'); return; }
  const aulas = scopedAulas();
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal wide">
    <div class="m-h"><h3>Registrar recepción — ${esc(r.numero)}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="hint" style="margin-bottom:8px;">Por cada ítem recibido, indica la cantidad que llegó realmente. Se creará automáticamente un bien por cada unidad recibida, con su código patrimonial, en <b>Almacén</b> (sin aula asignada) salvo que elijas un aula destino abajo.</div>
      <div class="field"><label>Escanear factura/guía (OCR, opcional)</label>
        <input type="file" id="rc_ocr_file" accept="image/*">
        <div class="hint" id="rc_ocr_status" style="margin-top:4px;">Sube una foto o escaneo del documento y el sistema intentará completar la fecha y el N° de documento por ti. Requiere internet la primera vez (descarga el modelo de lectura); luego funciona sin conexión. Siempre revisa los datos detectados.</div>
      </div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Denominación</th><th>Pedido</th><th>Ya recibido</th><th>Recibir ahora</th><th>P. unitario real (S/.)</th></tr></thead>
        <tbody id="rc_lineas">${pendientes.map(l=>`<tr data-lid="${l.id}">
          <td>${esc(l.denominacion)}</td><td class="num">${l.cantidad}</td><td class="num">${l.cantidadRecibida||0}</td>
          <td><input class="rc_cant" type="number" min="0" max="${l.cantidad-(l.cantidadRecibida||0)}" value="${l.cantidad-(l.cantidadRecibida||0)}" style="width:80px;"></td>
          <td><input class="rc_precio" type="number" min="0" step="0.01" value="${l.precioUnitario}" style="width:100px;"></td>
        </tr>`).join('')}</tbody>
      </table></div>
      <div class="grid g2" style="margin-top:10px;">
        <div class="field"><label>Fecha de recepción</label><input id="rc_fecha" type="date" value="${today()}"></div>
        <div class="field"><label>Aula / ambiente destino (opcional)</label><select id="rc_aula"><option value="">📦 Dejar en Almacén (sin asignar)</option>${aulas.map(a=>`<option value="${a.id}">${esc(a.aulaLabel||a.nombre)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Garantía hasta (opcional, aplica a todos los bienes de esta recepción)</label><input id="rc_garantia" type="date"></div>
      <div class="field"><label>Observación (N° de guía/factura, etc.)</label><input id="rc_obs" placeholder="Ej. Guía de remisión N° 001-00123"></div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Confirmar recepción y dar de alta los bienes</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  bg.querySelector('#rc_ocr_file').addEventListener('change', async e=>{
    const file = e.target.files[0]; if(!file) return;
    const statusEl = bg.querySelector('#rc_ocr_status');
    statusEl.textContent = 'Leyendo documento… 0%';
    try{
      const texto = await ocrLeerImagen(file, m=>{
        if(m && m.status && typeof m.progress==='number'){ statusEl.textContent = 'Leyendo documento… '+Math.round(m.progress*100)+'% ('+m.status+')'; }
      });
      const datos = parseFacturaTexto(texto);
      const detectados = [];
      if(datos.fecha){ bg.querySelector('#rc_fecha').value = datos.fecha; detectados.push('fecha'); }
      if(datos.numeroDocumento){
        const obsEl = bg.querySelector('#rc_obs');
        obsEl.value = obsEl.value.trim() ? (obsEl.value.trim()+' — '+datos.numeroDocumento) : datos.numeroDocumento;
        detectados.push('N° de documento');
      }
      if(datos.total!=null) detectados.push('total del documento: S/ '+datos.total.toFixed(2));
      statusEl.textContent = detectados.length
        ? ('✓ Se detectó '+detectados.join(', ')+'. Revisa que sea correcto antes de confirmar.')
        : 'No se pudo detectar información reconocible en la imagen. Completa los datos a mano.';
    }catch(err){
      statusEl.textContent = 'No se pudo leer el documento: '+((err&&err.message)||err)+'. Completa los datos a mano.';
    }
  });
  bg.querySelector('#save').addEventListener('click', async ()=>{
    const fecha = bg.querySelector('#rc_fecha').value||today();
    const aulaId = bg.querySelector('#rc_aula').value;
    const aula = aulaId ? aulas.find(a=>a.id===aulaId) : null;
    const garantiaHasta = bg.querySelector('#rc_garantia').value||'';
    const observacion = bg.querySelector('#rc_obs').value.trim();
    const filas = [...bg.querySelectorAll('#rc_lineas tr')].filter(tr=>tr.dataset.lid);
    const cfg = DB.get(KEYS.config);
    let items = DB.get(KEYS.items);
    const lineasRecibidasResumen = [];
    let totalCreados = 0;
    for(const tr of filas){
      const lineaId = tr.dataset.lid;
      const linea = (r.lineas||[]).find(l=>l.id===lineaId); if(!linea) continue;
      const cant = Math.max(0, Math.min(Number(tr.querySelector('.rc_cant').value)||0, linea.cantidad-(linea.cantidadRecibida||0)));
      if(cant<=0) continue;
      const precioReal = Number(tr.querySelector('.rc_precio').value)||0;
      const codigoSBN = lookupSBN(linea.denominacion) || '';
      for(let i=0;i<cant;i++){
        const correlativoSBN = await nextCorrelativoPorSBN(codigoSBN);
        const codigoInterno = buildCodigoPatrimonial(codigoSBN, correlativoSBN);
        const codigoUsoInterno = buildCodigoUsoInterno(await nextCorrelativoInterno());
        const nuevoItem = {
          id: uid('item'), codigoInterno, codigoAnioAnterior:'', codigoUsoInterno,
          denominacion: linea.denominacion, codigoSBN,
          marca:'', modelo:'', numeroSerie:'', color:'',
          estadoConservacion:'Muy Bueno',
          aulaId: aulaId||'', aulaNombre: aula?(aula.aulaLabel||aula.nombre):'',
          valorAdquisicion: precioReal||null, categoriaDeprecId: lookupCategoriaDeprec(linea.denominacion),
          custodioId:'', custodioNombre: aula?(aula.responsable||''):'',
          situacion:'Activo', fotoId:'', fotosIds:[], fotosHistorial:[],
          observaciones: 'Ingresado por recepción de compra '+r.numero+(r.ordenCompra?(' — OC '+r.ordenCompra.numero+(r.ordenCompra.proveedor?(' — '+r.ordenCompra.proveedor):'')):'')+(observacion?(' — '+observacion):'')+'.',
          fechaRegistro: fecha, anio: cfg.anioFiscal, garantiaHasta,
          registradoPor: currentUser().usuario
        };
        items.push(nuevoItem); totalCreados++;
        await addMovimiento(nuevoItem.id, nuevoItem.codigoInterno, 'Alta', 'Alta por recepción del requerimiento '+r.numero+(r.ordenCompra?(' (OC '+r.ordenCompra.numero+')'):'')+', registrado por '+currentUser().usuario+'.');
      }
      linea.cantidadRecibida = (linea.cantidadRecibida||0) + cant;
      lineasRecibidasResumen.push({ lineaId, cantidad: cant });
    }
    if(totalCreados===0){ toast('No indicaste ninguna cantidad a recibir.','err'); return; }
    await DB.save(KEYS.items, items);
    const totalPedido = reqCantidadPedida(r);
    const totalRecibidoAhora = reqCantidadRecibida(r);
    const nuevoEstado = totalRecibidoAhora>=totalPedido ? 'Recibido total' : 'Recibido parcial';
    const historialRecepciones = [...(r.historialRecepciones||[]), { id:uid('rec'), fecha, recibidoPor: currentUser().nombre||currentUser().usuario, lineas: lineasRecibidasResumen, observacion }];
    const list = (DB.get(KEYS.requerimientos)||[]).map(x=>x.id===id?{...x, lineas:r.lineas, estado:nuevoEstado, historialRecepciones}:x);
    await DB.save(KEYS.requerimientos, list);
    await registrarBitacora('Registrar recepción de compra', r.numero+' — '+totalCreados+' bien(es) dado(s) de alta en Almacén.');
    toast(totalCreados+' bien(es) dado(s) de alta en el inventario (Almacén).','ok');
    close(); renderContent();
  });
}


/* ---------------------------------------------------------------------
   BAJAS DE BIENES — expediente formal de baja conforme a la Directiva N°
   001-2015/SBN y a la Directiva N° 0006-2021-EF/54.01 (MEF). A diferencia
   del antiguo botón "Dar de baja" (que solo cambiaba la situación del bien
   con un motivo en texto libre), este módulo exige recorrer las 4 etapas
   del procedimiento antes de que el bien quede formalmente "De baja":
     1) Solicitud de baja (causal tipificada + sustento) — cualquiera con
        permiso de edición puede iniciarla; el bien pasa a "En trámite de
        baja" (deja de estar disponible para préstamos, pero sigue siendo
        parte del patrimonio activo mientras se resuelve).
     2) Informe técnico (responsable + descripción técnica) — administrador.
     3) Resolución (N°, fecha, quién la emite; Aprobada o Rechazada) — si
        se rechaza, el bien vuelve a "Activo" y el expediente se cierra ahí.
     4) Disposición final (destino: RAEE, venta, transferencia, donación,
        incineración, etc.) — solo al registrarla el bien queda "De baja".
   Cada expediente tiene su propio documento imprimible con las 4 etapas.
   --------------------------------------------------------------------- */
async function nextCorrelativoBaja(){
  let seq = (DB.get(KEYS.seqBaja)||0) + 1;
  await DB.save(KEYS.seqBaja, seq);
  return seq;
}
function bajaEstadoBadge(e){
  const cls = e==='Con disposición final' ? 'badge-good' : e==='Rechazada' ? 'badge-bad' : e==='Solicitada' ? 'badge-info' : 'badge-warn';
  return `<span class="badge ${cls}">${esc(e)}</span>`;
}
function renderBajas(){
  let regs = [...(DB.get(KEYS.bajas)||[])].sort((a,b)=>(b.numero||'').localeCompare(a.numero||''));
  const f = STATE.filtersBaja;
  regs = regs.filter(b=>{
    if(f.q){ const hay=(b.numero+' '+b.itemDenominacion+' '+b.itemCodigoInterno+' '+b.causal).toLowerCase(); if(!hay.includes(f.q.toLowerCase())) return false; }
    if(f.estado && b.estado!==f.estado) return false;
    return true;
  });
  const pendientes = (DB.get(KEYS.bajas)||[]).filter(b=>['Solicitada','Con informe técnico'].includes(b.estado)).length;
  const aprobadasSinCerrar = (DB.get(KEYS.bajas)||[]).filter(b=>b.estado==='Con resolución').length;
  return `
  ${isAdmin()&&pendientes>0?`<div class="note-banner" style="background:var(--warn-soft,#fff3cd);border-color:#e6d3a3;color:#8a6d1a;">🗑️ Tienes <b>${pendientes}</b> expediente(s) esperando informe técnico o resolución.</div>`:''}
  ${isAdmin()&&aprobadasSinCerrar>0?`<div class="note-banner" style="background:var(--warn-soft,#fff3cd);border-color:#e6d3a3;color:#8a6d1a;">📦 Tienes <b>${aprobadasSinCerrar}</b> expediente(s) con Resolución aprobada, pendientes de registrar la disposición final.</div>`:''}
  <div class="card"><div class="card-b" style="padding-bottom:0;">
    <div class="grid g2">
      <input class="search" id="bfq" placeholder="Buscar por N°, bien o causal…" value="${esc(f.q)}">
      <select id="bfestado"><option value="">— Todos los estados —</option>${ESTADOS_BAJA.map(e=>`<option value="${esc(e)}" ${f.estado===e?'selected':''}>${esc(e)}</option>`).join('')}</select>
    </div>
    <div style="margin:8px 0 4px;"><button class="btn btn-sm" id="bfclear">Limpiar filtros</button></div>
  </div>
  <div class="tbl-wrap"><table>
    <thead><tr><th>N°</th><th>Fecha solicitud</th><th>Bien</th><th>Causal</th><th>Estado</th><th></th></tr></thead>
    <tbody>${regs.map(b=>{
      const diasTranscurridos = -diasHasta(b.fechaSolicitud);
      const plazoVencido = ['Solicitada','Con informe técnico'].includes(b.estado) && diasTranscurridos>=PLAZO_DIAS_RESOLUCION_BAJA;
      return `<tr>
      <td class="mono">${esc(b.numero)}</td><td>${esc(b.fechaSolicitud)}</td>
      <td>${esc(b.itemDenominacion)}<br><span class="hint">${esc(b.itemCodigoInterno)}</span></td>
      <td>${esc(b.causal)}</td>
      <td>${bajaEstadoBadge(b.estado)}${plazoVencido?' <span class="badge badge-bad">Plazo vencido</span>':''}</td>
      <td><button class="btn btn-sm btn-ghost" data-verbaja="${b.id}">Ver</button></td>
    </tr>`;}).join('')}
    ${regs.length===0?'<tr><td colspan="6" class="empty"><div class="big">🗑️</div>Aún no hay expedientes de baja registrados.</td></tr>':''}
    </tbody></table></div>`;
}
// Punto de entrada desde el botón "+ Nueva solicitud de baja" del propio
// módulo (a diferencia de iniciarla desde la ficha de un bien concreto).
function abrirSelectorBienParaBaja(){
  if(!guardEdit()) return;
  const items = scopedItems().filter(i=>i.situacion!=='De baja' && i.situacion!=='En trámite de baja').sort((a,b)=>(a.codigoInterno||'').localeCompare(b.codigoInterno||''));
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal">
    <div class="m-h"><h3>Nueva solicitud de baja</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="field"><label>Bien a dar de baja *</label>
        <select id="sb_item"><option value="">— Selecciona un bien —</option>${items.map(i=>`<option value="${i.id}">${esc(i.codigoInterno)} — ${esc(i.denominacion)}${i.aulaNombre?(' ('+esc(i.aulaNombre)+')'):' (Almacén)'}</option>`).join('')}</select>
      </div>
      <div class="hint">También puedes iniciar una solicitud de baja desde la ficha del bien, en "Bienes patrimoniales".</div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="continuar">Continuar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  bg.querySelector('#continuar').addEventListener('click', ()=>{
    const itemId = bg.querySelector('#sb_item').value;
    if(!itemId){ toast('Selecciona un bien.','err'); return; }
    close(); openSolicitudBajaModal(itemId);
  });
}
// Etapa 1: Solicitud de baja. Reemplaza al antiguo prompt() de "Dar de baja":
// exige una causal tipificada y un sustento, y no marca el bien como "De baja"
// de inmediato, sino "En trámite de baja" hasta que se cierre el expediente.
function openSolicitudBajaModal(itemId){
  if(!guardEdit()) return;
  const it = DB.get(KEYS.items).find(x=>x.id===itemId);
  if(!it){ toast('No se encontró el bien.','err'); return; }
  if(it.situacion==='De baja'){ toast('Este bien ya está dado de baja.','err'); return; }
  if(it.situacion==='En trámite de baja'){ toast('Este bien ya tiene un expediente de baja en trámite.','err'); return; }
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal wide">
    <div class="m-h"><h3>Solicitud de baja — ${esc(it.codigoInterno)}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <table class="meta-table" style="margin-bottom:10px;">
        <tr><td><b>Bien</b></td><td>${esc(it.denominacion)}</td><td><b>Cód. SBN</b></td><td>${esc(it.codigoSBN||'—')}</td></tr>
        <tr><td><b>Ubicación</b></td><td>${it.aulaNombre?esc(it.aulaNombre):'Almacén'}</td><td><b>Valor de adquisición</b></td><td>${it.valorAdquisicion!=null?money(it.valorAdquisicion):'—'}</td></tr>
      </table>
      <div class="grid g2">
        <div class="field"><label>Fecha de solicitud</label><input id="sb_fecha" type="date" value="${today()}"></div>
        <div class="field"><label>Solicitado por</label><input id="sb_solicitante" value="${esc(currentUser().nombre||currentUser().usuario)}"></div>
      </div>
      <div class="field"><label>Causal de baja *</label><select id="sb_causal">${CAUSALES_BAJA.map(cs=>`<option>${esc(cs)}</option>`).join('')}</select></div>
      <div class="field"><label>Sustento / descripción de los hechos *</label><textarea id="sb_sustento" rows="3" placeholder="Describe por qué corresponde dar de baja este bien…"></textarea></div>
      <div class="hint">Al guardar, el bien quedará marcado como <b>"En trámite de baja"</b> (deja de estar disponible para préstamos) y se abrirá el expediente. Luego se agrega el Informe Técnico, la Resolución y la Disposición final; solo al cerrar esta última el bien queda formalmente "De baja".</div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Guardar solicitud</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  bg.querySelector('#save').addEventListener('click', async ()=>{
    const fecha = bg.querySelector('#sb_fecha').value || today();
    const solicitante = bg.querySelector('#sb_solicitante').value.trim();
    const causal = bg.querySelector('#sb_causal').value;
    const sustento = bg.querySelector('#sb_sustento').value.trim();
    if(!sustento){ toast('Describe el sustento de la baja.','err'); return; }
    const numero = 'BAJA-'+DB.get(KEYS.config).anioFiscal+'-'+String(await nextCorrelativoBaja()).padStart(4,'0');
    const nuevaBaja = {
      id: uid('baja'), numero,
      itemId: it.id, itemCodigoInterno: it.codigoInterno, itemDenominacion: it.denominacion,
      itemCodigoSBN: it.codigoSBN||'', itemValorAdquisicion: it.valorAdquisicion!=null?it.valorAdquisicion:null, itemAulaNombre: it.aulaNombre||'',
      fechaSolicitud: fecha, solicitante, causal, sustento,
      estado:'Solicitada', informeTecnico:null, resolucion:null, disposicionFinal:null,
      registradoPor: currentUser().usuario
    };
    await DB.save(KEYS.bajas, [...(DB.get(KEYS.bajas)||[]), nuevaBaja]);
    const items = DB.get(KEYS.items).map(x=>x.id===it.id?{...x, situacion:'En trámite de baja'}:x);
    await DB.save(KEYS.items, items);
    await addMovimiento(it.id, it.codigoInterno, 'Observación', 'Solicitud de baja '+numero+' iniciada — causal: '+causal+' ('+currentUser().usuario+').');
    await registrarBitacora('Solicitar baja de bien', it.denominacion+' ('+it.codigoInterno+') — Expediente '+numero+' — Causal: '+causal);
    toast('Solicitud de baja '+numero+' registrada.','ok');
    close(); STATE.view='bajas'; render();
    setTimeout(()=>verBajaDetalle(nuevaBaja.id), 50);
  });
}
// Vista de detalle del expediente: muestra las 4 etapas y, según el estado
// actual y el rol de quien mira, los botones para avanzar a la siguiente.
function verBajaDetalle(id){
  const b = (DB.get(KEYS.bajas)||[]).find(x=>x.id===id); if(!b) return;
  const plazoDias = ['Solicitada','Con informe técnico'].includes(b.estado) ? Math.max(0, -diasHasta(b.fechaSolicitud)) : null;
  const plazoVencido = plazoDias!==null && plazoDias>=PLAZO_DIAS_RESOLUCION_BAJA;
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal wide">
    <div class="m-h"><h3>Expediente de baja — ${esc(b.numero)}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">${bajaEstadoBadge(b.estado)}${plazoVencido?`<span class="badge badge-bad">Plazo referencial de ${PLAZO_DIAS_RESOLUCION_BAJA} días vencido</span>`:(plazoDias!==null?`<span class="hint">Día ${plazoDias} de ${PLAZO_DIAS_RESOLUCION_BAJA} del plazo referencial para resolver</span>`:'')}</div>
      <table class="meta-table" style="margin-bottom:14px;">
        <tr><td><b>Bien</b></td><td>${esc(b.itemDenominacion)} (${esc(b.itemCodigoInterno)})</td><td><b>Cód. SBN</b></td><td>${esc(b.itemCodigoSBN||'—')}</td></tr>
        <tr><td><b>Ubicación al solicitar</b></td><td>${esc(b.itemAulaNombre||'Almacén')}</td><td><b>Valor de adquisición</b></td><td>${b.itemValorAdquisicion!=null?money(b.itemValorAdquisicion):'—'}</td></tr>
        <tr><td><b>Fecha de solicitud</b></td><td>${esc(b.fechaSolicitud)}</td><td><b>Solicitado por</b></td><td>${esc(b.solicitante)}</td></tr>
      </table>
      <p style="margin:4px 0;"><b>Causal:</b> ${esc(b.causal)}</p>
      <p style="margin:4px 0 14px;"><b>Sustento:</b> ${esc(b.sustento)}</p>

      <h4 style="font-size:13.5px;margin:14px 0 6px;">1. Informe técnico</h4>
      ${b.informeTecnico ? `<table class="meta-table" style="margin-bottom:6px;"><tr><td><b>Fecha</b></td><td>${esc(b.informeTecnico.fecha)}</td><td><b>Responsable</b></td><td>${esc(b.informeTecnico.responsable)}</td></tr></table><p style="margin:4px 0;">${esc(b.informeTecnico.descripcion)}</p>` : `<p class="hint">Aún no se ha registrado el informe técnico.</p>`}
      ${(isAdmin() && b.estado==='Solicitada')?`<button class="btn btn-sm" id="btnAgregarInforme">+ Agregar informe técnico</button>`:''}

      <h4 style="font-size:13.5px;margin:16px 0 6px;">2. Resolución</h4>
      ${b.resolucion ? `<table class="meta-table" style="margin-bottom:6px;">
        <tr><td><b>N° de Resolución</b></td><td>${esc(b.resolucion.numero)}</td><td><b>Fecha</b></td><td>${esc(b.resolucion.fecha)}</td></tr>
        <tr><td><b>Emitida por</b></td><td>${esc(b.resolucion.emitidaPor)}</td><td><b>Resultado</b></td><td>${b.resolucion.tipo==='Aprobada'?'<span class="badge badge-good">Aprobada</span>':'<span class="badge badge-bad">Rechazada</span>'}</td></tr>
      </table>${b.resolucion.tipo==='Rechazada'?`<p style="margin:4px 0;"><b>Motivo del rechazo:</b> ${esc(b.resolucion.motivoRechazo||'—')}</p>`:''}` : `<p class="hint">Aún no se ha registrado la resolución.</p>`}
      ${(isAdmin() && b.estado==='Con informe técnico')?`<button class="btn btn-sm" id="btnAgregarResolucion">+ Registrar resolución</button>`:''}

      <h4 style="font-size:13.5px;margin:16px 0 6px;">3. Disposición final</h4>
      ${b.disposicionFinal ? `<table class="meta-table" style="margin-bottom:6px;">
        <tr><td><b>Destino</b></td><td>${esc(b.disposicionFinal.tipo)}</td><td><b>Fecha</b></td><td>${esc(b.disposicionFinal.fecha)}</td></tr>
      </table><p style="margin:4px 0;"><b>Destinatario / operador:</b> ${esc(b.disposicionFinal.destinatario||'—')}</p>${b.disposicionFinal.observaciones?`<p style="margin:4px 0;"><b>Observaciones:</b> ${esc(b.disposicionFinal.observaciones)}</p>`:''}` : `<p class="hint">Aún no se ha registrado la disposición final.</p>`}
      ${(isAdmin() && b.estado==='Con resolución')?`<button class="btn btn-sm" id="btnAgregarDisposicion">+ Registrar disposición final</button>`:''}
    </div>
    <div class="m-f">
      ${(canEdit() && b.estado==='Solicitada')?`<button class="btn btn-danger" id="btnCancelarBaja">Cancelar solicitud</button>`:''}
      <span style="flex:1"></span>
      <button class="btn btn-primary" id="btnImprimirExp">Imprimir expediente</button>
      <button class="btn" id="closeView">Cerrar</button>
    </div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#closeView').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  bg.querySelector('#btnImprimirExp').addEventListener('click', ()=>exportActaBajaPDF(b.id));
  const btnInf = bg.querySelector('#btnAgregarInforme'); if(btnInf) btnInf.addEventListener('click', ()=>{ close(); abrirModalInformeTecnicoBaja(b.id); });
  const btnRes = bg.querySelector('#btnAgregarResolucion'); if(btnRes) btnRes.addEventListener('click', ()=>{ close(); abrirModalResolucionBaja(b.id); });
  const btnDisp = bg.querySelector('#btnAgregarDisposicion'); if(btnDisp) btnDisp.addEventListener('click', ()=>{ close(); abrirModalDisposicionFinalBaja(b.id); });
  const btnCancel = bg.querySelector('#btnCancelarBaja'); if(btnCancel) btnCancel.addEventListener('click', async ()=>{
    if(!confirm('¿Cancelar esta solicitud de baja? El bien volverá a situación "Activo".')) return;
    const list = (DB.get(KEYS.bajas)||[]).filter(x=>x.id!==b.id);
    await DB.save(KEYS.bajas, list);
    const items = DB.get(KEYS.items).map(x=>x.id===b.itemId?{...x, situacion:'Activo'}:x);
    await DB.save(KEYS.items, items);
    await addMovimiento(b.itemId, b.itemCodigoInterno, 'Observación', 'Solicitud de baja '+b.numero+' cancelada por '+currentUser().usuario+'.');
    await registrarBitacora('Cancelar solicitud de baja', b.itemDenominacion+' ('+b.itemCodigoInterno+') — Expediente '+b.numero);
    toast('Solicitud de baja cancelada.','ok');
    close(); renderContent();
  });
}
// Etapa 2: Informe técnico (solo administrador / responsable de patrimonio).
function abrirModalInformeTecnicoBaja(id){
  if(!isAdmin()) return;
  const b = (DB.get(KEYS.bajas)||[]).find(x=>x.id===id); if(!b) return;
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal">
    <div class="m-h"><h3>Informe técnico — ${esc(b.numero)}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="grid g2">
        <div class="field"><label>Fecha del informe</label><input id="it_fecha" type="date" value="${today()}"></div>
        <div class="field"><label>Responsable</label><input id="it_responsable" value="${esc(currentUser().nombre||currentUser().usuario)}"></div>
      </div>
      <div class="field"><label>Descripción técnica *</label><textarea id="it_descripcion" rows="4" placeholder="Evaluación técnica que sustenta la baja: estado del bien, verificación de la causal, recomendación…"></textarea></div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Guardar informe</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  bg.querySelector('#save').addEventListener('click', async ()=>{
    const fecha = bg.querySelector('#it_fecha').value||today();
    const responsable = bg.querySelector('#it_responsable').value.trim();
    const descripcion = bg.querySelector('#it_descripcion').value.trim();
    if(!descripcion){ toast('Escribe la descripción técnica.','err'); return; }
    const list = (DB.get(KEYS.bajas)||[]).map(x=>x.id===id?{...x, informeTecnico:{fecha,responsable,descripcion}, estado:'Con informe técnico'}:x);
    await DB.save(KEYS.bajas, list);
    await addMovimiento(b.itemId, b.itemCodigoInterno, 'Observación', 'Informe técnico agregado al expediente de baja '+b.numero+' por '+currentUser().usuario+'.');
    await registrarBitacora('Agregar informe técnico de baja', b.itemDenominacion+' ('+b.itemCodigoInterno+') — Expediente '+b.numero);
    toast('Informe técnico guardado.','ok');
    close(); verBajaDetalle(id);
  });
}
// Etapa 3: Resolución (aprueba o rechaza). Si rechaza, el bien vuelve a
// "Activo" de inmediato y el expediente queda cerrado ahí.
function abrirModalResolucionBaja(id){
  if(!isAdmin()) return;
  const b = (DB.get(KEYS.bajas)||[]).find(x=>x.id===id); if(!b) return;
  const cfg = DB.get(KEYS.config);
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal">
    <div class="m-h"><h3>Resolución — ${esc(b.numero)}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="grid g2">
        <div class="field"><label>N° de Resolución *</label><input id="rs_numero" placeholder="Ej. R.D. N° 0123-2026-UGEL..."></div>
        <div class="field"><label>Fecha</label><input id="rs_fecha" type="date" value="${today()}"></div>
      </div>
      <div class="field"><label>Emitida por *</label><input id="rs_emitida" placeholder="Ej. Dirección de la I.E. / UGEL..." value="${esc(cfg.director||'')}"></div>
      <div class="field"><label>Resultado *</label><select id="rs_tipo"><option value="Aprobada">Aprobada — procede la baja</option><option value="Rechazada">Rechazada — el bien continúa activo</option></select></div>
      <div class="field" id="rs_motivo_wrap" style="display:none;"><label>Motivo del rechazo</label><textarea id="rs_motivo" rows="2"></textarea></div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Guardar resolución</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  bg.querySelector('#rs_tipo').addEventListener('change', e=>{ bg.querySelector('#rs_motivo_wrap').style.display = e.target.value==='Rechazada'?'block':'none'; });
  bg.querySelector('#save').addEventListener('click', async ()=>{
    const numero = bg.querySelector('#rs_numero').value.trim();
    const fecha = bg.querySelector('#rs_fecha').value||today();
    const emitidaPor = bg.querySelector('#rs_emitida').value.trim();
    const tipo = bg.querySelector('#rs_tipo').value;
    const motivoRechazo = bg.querySelector('#rs_motivo').value.trim();
    if(!numero){ toast('Ingresa el número de Resolución.','err'); return; }
    if(!emitidaPor){ toast('Indica quién emite la Resolución.','err'); return; }
    if(tipo==='Rechazada' && !motivoRechazo){ toast('Escribe el motivo del rechazo.','err'); return; }
    const resolucion = {numero, fecha, emitidaPor, tipo, motivoRechazo: tipo==='Rechazada'?motivoRechazo:''};
    const nuevoEstado = tipo==='Aprobada' ? 'Con resolución' : 'Rechazada';
    const list = (DB.get(KEYS.bajas)||[]).map(x=>x.id===id?{...x, resolucion, estado:nuevoEstado}:x);
    await DB.save(KEYS.bajas, list);
    if(tipo==='Rechazada'){
      const items = DB.get(KEYS.items).map(x=>x.id===b.itemId?{...x, situacion:'Activo'}:x);
      await DB.save(KEYS.items, items);
      await addMovimiento(b.itemId, b.itemCodigoInterno, 'Observación', 'Resolución '+numero+' RECHAZA la baja (expediente '+b.numero+'); el bien vuelve a situación Activo.');
    } else {
      await addMovimiento(b.itemId, b.itemCodigoInterno, 'Observación', 'Resolución '+numero+' APRUEBA la baja (expediente '+b.numero+'); pendiente registrar la disposición final.');
    }
    await registrarBitacora('Registrar resolución de baja', b.itemDenominacion+' ('+b.itemCodigoInterno+') — Expediente '+b.numero+' — '+tipo);
    toast('Resolución registrada.','ok');
    close(); verBajaDetalle(id);
  });
}
// Etapa 4: Disposición final. Solo aquí el bien queda formalmente "De baja".
function abrirModalDisposicionFinalBaja(id){
  if(!isAdmin()) return;
  const b = (DB.get(KEYS.bajas)||[]).find(x=>x.id===id); if(!b) return;
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal">
    <div class="m-h"><h3>Disposición final — ${esc(b.numero)}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="field"><label>Destino final *</label><select id="df_tipo">${DESTINOS_BAJA.map(d=>`<option>${esc(d)}</option>`).join('')}</select></div>
      <div class="grid g2">
        <div class="field"><label>Fecha</label><input id="df_fecha" type="date" value="${today()}"></div>
        <div class="field"><label>Destinatario / operador</label><input id="df_destinatario" placeholder="Ej. Empresa Operadora RAEE, comprador, entidad receptora…"></div>
      </div>
      <div class="field"><label>Observaciones</label><textarea id="df_obs" rows="2"></textarea></div>
      <div class="hint">Al guardar, el bien quedará formalmente marcado como <b>"De baja"</b> en el inventario y el expediente se dará por cerrado.</div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Cerrar expediente y dar de baja el bien</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  bg.querySelector('#save').addEventListener('click', async ()=>{
    const tipo = bg.querySelector('#df_tipo').value;
    const fecha = bg.querySelector('#df_fecha').value||today();
    const destinatario = bg.querySelector('#df_destinatario').value.trim();
    const observaciones = bg.querySelector('#df_obs').value.trim();
    if(!confirm('¿Confirmas registrar la disposición final y dar de baja este bien de forma definitiva?')) return;
    const disposicionFinal = {tipo, fecha, destinatario, observaciones};
    const list = (DB.get(KEYS.bajas)||[]).map(x=>x.id===id?{...x, disposicionFinal, estado:'Con disposición final'}:x);
    await DB.save(KEYS.bajas, list);
    const items = DB.get(KEYS.items).map(x=>x.id===b.itemId?{...x, situacion:'De baja'}:x);
    await DB.save(KEYS.items, items);
    await addMovimiento(b.itemId, b.itemCodigoInterno, 'Baja', 'Baja formalizada — Expediente '+b.numero+', Resolución '+(b.resolucion?b.resolucion.numero:'—')+', destino: '+tipo+(destinatario?(' ('+destinatario+')'):'')+' ('+currentUser().usuario+').');
    await registrarBitacora('Cerrar expediente de baja', b.itemDenominacion+' ('+b.itemCodigoInterno+') — Expediente '+b.numero+' — Destino: '+tipo);
    toast('Bien dado de baja formalmente.','ok');
    close(); verBajaDetalle(id);
  });
}
// Documento imprimible del expediente completo (las 4 etapas, con lo que
// se haya registrado hasta el momento). Sirve tanto de constancia parcial
// (mientras está en trámite) como de acta final una vez cerrado.
function construirActaBajaHTML(b){
  const cfg = DB.get(KEYS.config);
  const html = `
  <div class="ficha doc-page">
    <div class="ficha-header">
      <div class="logo-slot">${logoDeConfig(cfg)?`<img src="${logoDeConfig(cfg)}">`:''}</div>
      <div class="meta-center">
        <h2>Expediente de Baja de Bien Mueble Patrimonial</h2>
        <h3 style="font-weight:normal;">N° ${esc(b.numero)} — Base: Directiva N° 001-2015/SBN y Directiva N° 0006-2021-EF/54.01</h3>
        <table class="meta-table" style="margin:0 auto;">
          <tr><td><b>I.E.:</b> ${esc(cfg.nombreIE||'—')}</td><td><b>UGEL:</b> ${esc(cfg.ugel||'—')}</td><td><b>Año fiscal:</b> ${esc(cfg.anioFiscal||'—')}</td></tr>
          <tr><td colspan="3"><b>Fecha de emisión del documento:</b> ${esc(fechaLarga(today()))}</td></tr>
        </table>
      </div>
    </div>
    <p style="font-size:12px;"><b>Datos del bien</b></p>
    <table><tbody>
      <tr><td><b>Denominación</b></td><td>${esc(b.itemDenominacion)}</td><td><b>Cód. patrimonial</b></td><td>${esc(b.itemCodigoInterno)}</td></tr>
      <tr><td><b>Cód. SBN</b></td><td>${esc(b.itemCodigoSBN||'—')}</td><td><b>Valor de adquisición</b></td><td>${b.itemValorAdquisicion!=null?money(b.itemValorAdquisicion):'—'}</td></tr>
      <tr><td><b>Ubicación al solicitar</b></td><td colspan="3">${esc(b.itemAulaNombre||'Almacén')}</td></tr>
    </tbody></table>
    <p style="font-size:12px;margin-top:14px;"><b>1. Solicitud de baja</b></p>
    <table><tbody>
      <tr><td><b>Fecha</b></td><td>${esc(b.fechaSolicitud)}</td><td><b>Solicitado por</b></td><td>${esc(b.solicitante)}</td></tr>
      <tr><td><b>Causal</b></td><td colspan="3">${esc(b.causal)}</td></tr>
      <tr><td><b>Sustento</b></td><td colspan="3">${esc(b.sustento)}</td></tr>
    </tbody></table>
    <p style="font-size:12px;margin-top:14px;"><b>2. Informe técnico</b></p>
    ${b.informeTecnico ? `<table><tbody>
      <tr><td><b>Fecha</b></td><td>${esc(b.informeTecnico.fecha)}</td><td><b>Responsable</b></td><td>${esc(b.informeTecnico.responsable)}</td></tr>
      <tr><td><b>Descripción</b></td><td colspan="3">${esc(b.informeTecnico.descripcion)}</td></tr>
    </tbody></table>` : `<p style="font-size:11px;">Pendiente de registrar.</p>`}
    <p style="font-size:12px;margin-top:14px;"><b>3. Resolución</b></p>
    ${b.resolucion ? `<table><tbody>
      <tr><td><b>N°</b></td><td>${esc(b.resolucion.numero)}</td><td><b>Fecha</b></td><td>${esc(b.resolucion.fecha)}</td></tr>
      <tr><td><b>Emitida por</b></td><td>${esc(b.resolucion.emitidaPor)}</td><td><b>Resultado</b></td><td>${esc(b.resolucion.tipo)}</td></tr>
      ${b.resolucion.tipo==='Rechazada'?`<tr><td><b>Motivo</b></td><td colspan="3">${esc(b.resolucion.motivoRechazo||'—')}</td></tr>`:''}
    </tbody></table>` : `<p style="font-size:11px;">Pendiente de registrar.</p>`}
    <p style="font-size:12px;margin-top:14px;"><b>4. Disposición final</b></p>
    ${b.disposicionFinal ? `<table><tbody>
      <tr><td><b>Destino</b></td><td>${esc(b.disposicionFinal.tipo)}</td><td><b>Fecha</b></td><td>${esc(b.disposicionFinal.fecha)}</td></tr>
      <tr><td><b>Destinatario / operador</b></td><td colspan="3">${esc(b.disposicionFinal.destinatario||'—')}</td></tr>
      ${b.disposicionFinal.observaciones?`<tr><td><b>Observaciones</b></td><td colspan="3">${esc(b.disposicionFinal.observaciones)}</td></tr>`:''}
    </tbody></table>` : `<p style="font-size:11px;">Pendiente de registrar.</p>`}
    <div class="firma" style="margin-top:50px;"><div>Responsable de Control Patrimonial</div><div>Director(a) de la I.E.</div></div>
    <p style="font-size:10px;margin-top:20px;">Generado por SIGIE el ${esc(fechaLarga(today()))}. Estado actual del expediente: ${esc(b.estado)}. Este documento refleja lo registrado en el sistema hasta la fecha de emisión; no reemplaza los documentos originales (Resolución, actas) que deben conservarse en el legajo físico.</p>
  </div>`;
  return html;
}
async function exportActaBajaPDF(id){
  const b = (DB.get(KEYS.bajas)||[]).find(x=>x.id===id); if(!b) return;
  const registro = await registrarActaFirmada('Expediente de Baja de Bienes', {
    numero:b.numero, itemCodigoInterno:b.itemCodigoInterno, estado:b.estado,
    solicitud:{fecha:b.fechaSolicitud, solicitante:b.solicitante, causal:b.causal, sustento:b.sustento},
    informeTecnico:b.informeTecnico||null, resolucion:b.resolucion||null, disposicionFinal:b.disposicionFinal||null
  }, `Expediente ${b.numero} — ${b.itemDenominacion} (${b.itemCodigoInterno}) — estado: ${b.estado}`, b.id);
  abrirVentanaImpresion('Expediente de Baja — '+b.numero, construirActaBajaHTML(b) + bloqueVerificacionHTML(registro));
}


/* ---------------------------------------------------------------------
   PLANO DEL COLEGIO (mapa clickeable) — permite subir una o más imágenes
   del plano/croquis de la IE (por pabellón, piso, etc.) y ubicar sobre ellas
   un marcador por cada aula/ambiente. Al hacer clic en un marcador (fuera
   del modo edición) se navega directo al listado de bienes de esa aula.
   Solo el Administrador puede crear/editar planos y colocar, mover o
   reasignar marcadores; el resto de roles solo puede verlos y usarlos para
   navegar más rápido que buscando el aula manualmente en los filtros.
   --------------------------------------------------------------------- */
function renderPlano(){
  const planos = DB.get(KEYS.planos)||[];
  if(planos.length===0){
    return `<div class="card"><div class="card-b"><div class="empty"><div class="big">🗺️</div>Aún no se ha subido ningún plano del colegio.
      ${isAdmin()?'<div style="margin-top:10px;"><button class="btn btn-primary" id="pln_nuevo">+ Subir plano</button></div>':'<div class="hint" style="margin-top:6px;">Pide a un administrador que suba el plano/croquis de la institución.</div>'}
    </div></div></div>`;
  }
  if(!STATE.planoActivoId || !planos.find(p=>p.id===STATE.planoActivoId)){ STATE.planoActivoId = planos[0].id; STATE.planoModoEdicion=false; STATE.planoMoviendoId=''; }
  const activo = planos.find(p=>p.id===STATE.planoActivoId);
  const aulas = DB.get(KEYS.aulas)||[];
  const marcadores = activo.marcadores||[];
  const edicion = isAdmin() && STATE.planoModoEdicion;
  const pines = marcadores.map(m=>{
    const aula = aulas.find(a=>a.id===m.aulaId);
    const label = aula ? (aula.aulaLabel||aula.nombre) : '(aula eliminada)';
    const moviendo = STATE.planoMoviendoId===m.id;
    return `<button type="button" class="plano-pin${moviendo?' moviendo':''}" data-pin="${m.id}" style="left:${m.x}%;top:${m.y}%;">📍<span class="plano-pin-label">${esc(label)}</span></button>`;
  }).join('');
  return `
  <div class="card noprint"><div class="card-b" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;">
    <div class="toolbar" style="flex-wrap:wrap;">
      ${planos.length>1?`<select id="pln_select">${planos.map(p=>`<option value="${p.id}" ${p.id===activo.id?'selected':''}>${esc(p.nombre)}</option>`).join('')}</select>`:`<b>${esc(activo.nombre)}</b>`}
      ${isAdmin()?`<button class="btn btn-sm" id="pln_nuevo">+ Nuevo plano</button>
      <button class="btn btn-sm" id="pln_editarplano">✏️ Editar plano</button>
      <button class="btn btn-sm btn-danger" id="pln_eliminarplano">🗑️ Eliminar plano</button>`:''}
    </div>
    ${isAdmin()?`<button class="btn ${edicion?'btn-primary':'btn-sm'}" id="pln_modoedicion">${edicion?'✓ Salir del modo edición':'✏️ Modo edición (marcadores)'}</button>`:''}
  </div></div>
  <div class="hint" style="margin:8px 2px;">${STATE.planoMoviendoId?'Haz clic en el plano en la nueva posición del marcador que estás moviendo.':edicion?'Modo edición activo: haz clic en un punto vacío del plano para agregar el marcador de un aula/ambiente, o haz clic en un marcador existente para moverlo, reasignarlo o eliminarlo.':'Haz clic en un marcador para ir directo al listado de bienes de esa aula/ambiente.'}</div>
  <div class="plano-wrap${edicion?' edicion':''}" id="pln_lienzo">
    <img src="${imagenSrc(activo.imagenId)}" draggable="false">
    ${pines}
  </div>`;
}
function abrirModalPlano(id){
  if(!isAdmin()) return;
  const planos = DB.get(KEYS.planos)||[];
  const p = id?planos.find(x=>x.id===id):null;
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal">
    <div class="m-h"><h3>${p?'Editar plano':'Nuevo plano del colegio'}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="field"><label>Nombre del plano *</label><input id="pl_nombre" value="${esc(p?p.nombre:'')}" placeholder="Ej. Pabellón A - Primer piso"></div>
      <div class="field"><label>Imagen del plano / croquis ${p?'(deja vacío para no cambiarla)':'*'}</label><input id="pl_imagen" type="file" accept="image/*"></div>
      ${p&&imagenSrc(p.imagenId)?`<img src="${imagenSrc(p.imagenId)}" style="max-width:100%;margin-top:8px;border:1px solid var(--line);border-radius:6px;">`:''}
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Guardar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  let nuevaImagenId = '';
  bg.querySelector('#pl_imagen').addEventListener('change', async e=>{
    const file = e.target.files[0]; if(!file) return;
    try{
      const dataUrl = await comprimirImagen(file, 1600, 0.82);
      nuevaImagenId = await guardarImagen(dataUrl);
      toast('Imagen cargada.','ok');
    }catch(err){ toast(err.message||'No se pudo procesar la imagen.','err'); }
  });
  bg.querySelector('#save').addEventListener('click', async ()=>{
    const nombre = bg.querySelector('#pl_nombre').value.trim();
    if(!nombre){ toast('Ponle un nombre al plano.','err'); return; }
    if(!p && !nuevaImagenId){ toast('Sube la imagen del plano.','err'); return; }
    let list = DB.get(KEYS.planos)||[];
    const imagenIdAnterior = p?p.imagenId:'';
    if(p){
      const data = { ...p, nombre, imagenId: nuevaImagenId||p.imagenId };
      list = list.map(x=>x.id===p.id?data:x);
      await registrarBitacora('Editar plano del colegio', nombre);
    }else{
      const data = { id:uid('plano'), nombre, imagenId:nuevaImagenId, marcadores:[] };
      list = [...list, data];
      STATE.planoActivoId = data.id;
      await registrarBitacora('Subir plano del colegio', nombre);
    }
    await DB.save(KEYS.planos, list);
    if(nuevaImagenId && imagenIdAnterior && imagenIdAnterior!==nuevaImagenId){ await eliminarImagen(imagenIdAnterior); }
    toast('Plano guardado.','ok');
    close(); renderContent();
  });
}
async function eliminarPlano(id){
  if(!isAdmin()) return;
  const planos = DB.get(KEYS.planos)||[];
  const p = planos.find(x=>x.id===id); if(!p) return;
  if(!confirm('¿Eliminar el plano "'+p.nombre+'" junto con todos sus marcadores? Esta acción no se puede deshacer.')) return;
  const list = planos.filter(x=>x.id!==id);
  await DB.save(KEYS.planos, list);
  if(p.imagenId) await eliminarImagen(p.imagenId);
  await registrarBitacora('Eliminar plano del colegio', p.nombre);
  STATE.planoActivoId = list[0] ? list[0].id : '';
  toast('Plano eliminado.','ok'); renderContent();
}
function irAAulaDesdeMarcador(marcadorId){
  const activo = (DB.get(KEYS.planos)||[]).find(p=>p.id===STATE.planoActivoId); if(!activo) return;
  const m = (activo.marcadores||[]).find(x=>x.id===marcadorId); if(!m) return;
  const aula = DB.get(KEYS.aulas).find(a=>a.id===m.aulaId);
  if(!aula){ toast('El aula de este marcador ya no existe.','err'); return; }
  STATE.view='items'; STATE.filters={q:'',aula:aula.id,estado:'',situacion:'',deprec:''}; render();
}
function abrirModalNuevoMarcador(x, y){
  const activo = (DB.get(KEYS.planos)||[]).find(p=>p.id===STATE.planoActivoId); if(!activo) return;
  const yaUsadas = new Set((activo.marcadores||[]).map(m=>m.aulaId));
  const disponibles = DB.get(KEYS.aulas).filter(a=>!yaUsadas.has(a.id));
  if(disponibles.length===0){ toast('Todas las aulas ya tienen un marcador en este plano.','err'); return; }
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal" style="max-width:420px;">
    <div class="m-h"><h3>Agregar marcador</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="field"><label>Aula / ambiente *</label><select id="mk_aula">${disponibles.map(a=>`<option value="${a.id}">${esc(a.aulaLabel||a.nombre)}</option>`).join('')}</select></div>
    </div>
    <div class="m-f"><button class="btn" id="cancel">Cancelar</button><button class="btn btn-primary" id="save">Agregar</button></div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  bg.querySelector('#save').addEventListener('click', async ()=>{
    const aulaId = bg.querySelector('#mk_aula').value;
    const list = (DB.get(KEYS.planos)||[]).map(p=>p.id===activo.id?{...p, marcadores:[...(p.marcadores||[]), {id:uid('mk'), aulaId, x:Number(x), y:Number(y)}]}:p);
    await DB.save(KEYS.planos, list);
    toast('Marcador agregado.','ok');
    close(); renderContent();
  });
}
function abrirOpcionesMarcador(marcadorId){
  const activo = (DB.get(KEYS.planos)||[]).find(p=>p.id===STATE.planoActivoId); if(!activo) return;
  const m = (activo.marcadores||[]).find(x=>x.id===marcadorId); if(!m) return;
  const aula = DB.get(KEYS.aulas).find(a=>a.id===m.aulaId);
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal" style="max-width:440px;">
    <div class="m-h"><h3>Marcador — ${esc(aula?(aula.aulaLabel||aula.nombre):'(aula eliminada)')}</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="field"><label>Reasignar a otra aula</label><select id="mk_reasignar"><option value="">— Elegir —</option>${DB.get(KEYS.aulas).filter(a=>a.id!==m.aulaId).map(a=>`<option value="${a.id}">${esc(a.aulaLabel||a.nombre)}</option>`).join('')}</select></div>
      <div class="hint">O usa los botones de abajo para moverlo de posición o eliminarlo del plano.</div>
    </div>
    <div class="m-f" style="flex-wrap:wrap;">
      <button class="btn btn-danger" id="mk_eliminar">🗑️ Eliminar</button>
      <button class="btn" id="mk_mover">📍 Mover</button>
      <button class="btn btn-primary" id="mk_reasignarbtn">Reasignar</button>
      <button class="btn" id="cancel">Cerrar</button>
    </div>
  </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.querySelector('.close-x').onclick=close; bg.querySelector('#cancel').onclick=close;
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  bg.querySelector('#mk_eliminar').addEventListener('click', async ()=>{
    if(!confirm('¿Eliminar este marcador del plano?')) return;
    const list = (DB.get(KEYS.planos)||[]).map(p=>p.id===activo.id?{...p, marcadores:(p.marcadores||[]).filter(x=>x.id!==m.id)}:p);
    await DB.save(KEYS.planos, list);
    toast('Marcador eliminado.','ok'); close(); renderContent();
  });
  bg.querySelector('#mk_mover').addEventListener('click', ()=>{
    STATE.planoMoviendoId = m.id;
    close();
    toast('Haz clic en el plano en la nueva posición del marcador.','ok');
    renderContent();
  });
  bg.querySelector('#mk_reasignarbtn').addEventListener('click', async ()=>{
    const nuevaAulaId = bg.querySelector('#mk_reasignar').value;
    if(!nuevaAulaId){ toast('Elige el aula a la que quieres reasignar el marcador.','err'); return; }
    const list = (DB.get(KEYS.planos)||[]).map(p=>p.id===activo.id?{...p, marcadores:(p.marcadores||[]).map(x=>x.id===m.id?{...x, aulaId:nuevaAulaId}:x)}:p);
    await DB.save(KEYS.planos, list);
    toast('Marcador reasignado.','ok'); close(); renderContent();
  });
}
async function moverMarcador(marcadorId, x, y){
  const planos = DB.get(KEYS.planos)||[];
  const activo = planos.find(p=>p.id===STATE.planoActivoId); if(!activo) return;
  const list = planos.map(p=>p.id===activo.id?{...p, marcadores:(p.marcadores||[]).map(m=>m.id===marcadorId?{...m, x:Number(x), y:Number(y)}:m)}:p);
  await DB.save(KEYS.planos, list);
  STATE.planoMoviendoId='';
  toast('Marcador movido.','ok');
  renderContent();
}

/* ---------------------------------------------------------------------
   19. PLANILLAS DE VERIFICACIÓN FÍSICA (imprimibles, por aula)
   --------------------------------------------------------------------- */
function renderPlanillas(){
  const aulas = scopedAulas();
  return `<div class="card noprint"><div class="card-b">
    <div class="toolbar"><select id="pl_aula"><option value="">— Selecciona un aula / ambiente —</option>${aulas.map(a=>`<option value="${a.id}">${esc(a.aulaLabel||a.nombre)}</option>`).join('')}</select>
    <button class="btn btn-primary" id="pl_generar">Generar planilla</button></div>
    <div class="hint">Genera la "Ficha de Levantamiento de Información" del inventario patrimonial del aula seleccionada, en el mismo formato de una sola hoja por cada 20 bienes (con espacio para observaciones y firmas), lista para imprimir y usar en la verificación física.</div>
  </div></div>
  <div id="pl_preview"></div>`;
}
// Arma las fichas (una por cada grupo de hasta 20 bienes) como HTML "puro", sin
// tarjetas ni botones de la app — este mismo HTML se usa para la vista previa en
// pantalla y para la ventana de impresión aislada, así ambas coinciden exactamente
// y la hoja impresa nunca trae contenido de la interfaz mezclado.
// Construye UNA ficha (hoja) con hasta 20 bienes, en el formato exacto exigido por la
// UGEL ("Ficha de Levantamiento de Información"). Se usa tanto para la planilla de una
// sola aula como para el reporte de TODO el colegio (una ficha por cada bloque de 20
// bienes, agrupados por aula/ambiente, en orientación horizontal).
function fichaBienesHTML(cfg, grupo, numPlanilla, ubicacion, responsable, esUltima){
  const numFmt = String(numPlanilla).padStart(4,'0');
  const filas = [];
  for(let i=0;i<20;i++){
    const it = grupo[i];
    filas.push(`<tr>
      <td>${i+1}</td>
      <td>${it?esc(it.codigoInterno):''}</td>
      <td>${it?esc(it.codigoAnioAnterior||'S/C'):''}</td>
      <td class="cellfit">${it?esc(it.denominacion):''}</td>
      <td>${it?esc(it.marca):''}</td>
      <td>${it?esc(it.modelo):''}</td>
      <td>${it?esc(it.numeroSerie||''):''}</td>
      <td>${it?esc(it.color):''}</td>
      <td>${it?esc(ESTADO_ABREV[it.estadoConservacion]||''):''}</td>
      <td></td>
    </tr>`);
  }
  return `
  <div class="ficha${esUltima?'':' doc-page'}">
    <h3>Ficha de Levantamiento de Información</h3>
    <h3>Inventario Patrimonial ${esc(cfg.anioFiscal||'')}</h3>
    <div class="ficha-header ficha-header-planilla">
      <div class="logo-slot">${logoDeConfig(cfg)?`<img src="${logoDeConfig(cfg)}">`:''}</div>
      <div class="meta-center">
        <div class="meta-blocks">
          <table class="meta-table meta-table-ie">
            <tr><td><b>I.E.:</b> ${esc(cfg.nombreIE)}</td></tr>
            <tr><td><b>Nivel:</b> ${esc(cfg.nivelIE||'—')}</td></tr>
            <tr><td><b>Usuario responsable:</b> ${esc(responsable || '_____________________')}</td></tr>
            <tr><td><b>Ubicación / Área:</b> ${esc(ubicacion)}</td></tr>
          </table>
          <table class="meta-table meta-table-planilla">
            <tr><td><b>Planilla N°:</b> ${numFmt}</td></tr>
            <tr><td><b>Fecha:</b> ${new Date().toLocaleDateString('es-PE')}</td></tr>
            <tr><td><b>Personal inventariador:</b> ${esc(cfg.personalInventariador||'—')}</td></tr>
          </table>
        </div>
      </div>
    </div>
    <table class="bienes-table" style="table-layout:fixed;">
      <thead><tr><th>N°</th><th>Cód. Patrimonial</th><th>Código Anterior</th><th>Denominación</th><th>Marca</th><th>Modelo</th><th>Serie/Dim.</th><th>Color</th><th>Estado</th><th>Observaciones</th></tr></thead>
      <tbody>${filas.join('')}</tbody>
    </table>
    <p style="font-size:11px;margin-top:6px;">Estado del Bien: Muy Bueno (MB), Bueno (B), Regular (R), Malo (M)</p>
    <p style="font-size:10px;">El usuario declara haber mostrado todos los bienes que se encuentran bajo su responsabilidad y no contar con más bienes materia de inventario. El usuario es responsable de la permanencia y conservación de cada uno de los bienes descritos.</p>
    <div class="firma"><div>Firma Usuario Responsable</div><div>Firma Personal Inventariador</div></div>
  </div>`;
}
function construirFichasHTML(aulaId){
  const aula = DB.get(KEYS.aulas).find(a=>a.id===aulaId); if(!aula) return {html:'', total:0, numPlanillas:0};
  const items = DB.get(KEYS.items).filter(i=>i.aulaId===aulaId);
  const cfg = DB.get(KEYS.config);
  const grupos = paginar(items, 20);
  const html = grupos.map((g,idx)=>fichaBienesHTML(cfg, g, idx+1, aula.aulaLabel||aula.nombre, aula.responsable, idx===grupos.length-1)).join('');
  return { html, total: items.length, numPlanillas: grupos.length };
}
// Reporte de TODO el colegio: concatena las fichas de CADA aula/ambiente (20 bienes por
// hoja, numeración de planilla correlativa a lo largo de todo el documento), en el mismo
// formato oficial de "Ficha de Levantamiento de Información" que exige la UGEL para la
// presentación del inventario patrimonial completo a fin de año.
function construirInventarioCompletoFichasHTML(){
  const cfg = DB.get(KEYS.config);
  const aulas = [...DB.get(KEYS.aulas)].sort((a,b)=>(a.aulaLabel||a.nombre||'').localeCompare(b.aulaLabel||b.nombre||''));
  const itemsTodos = DB.get(KEYS.items);
  const bloques = [];
  aulas.forEach(a=>{
    const items = itemsTodos.filter(i=>i.aulaId===a.id);
    if(items.length>0) bloques.push({ ubicacion: a.aulaLabel||a.nombre, responsable: a.responsable||'', items });
  });
  const idsConAula = new Set(aulas.map(a=>a.id));
  const sinAula = itemsTodos.filter(i=>!i.aulaId || !idsConAula.has(i.aulaId));
  if(sinAula.length>0) bloques.push({ ubicacion:'SIN AULA / AMBIENTE ASIGNADO', responsable:'', items:sinAula });

  const gruposPorBloque = bloques.map(b=>paginar(b.items, 20));
  const totalFichas = gruposPorBloque.reduce((a,gs)=>a+gs.length, 0);
  let numPlanilla = 0;
  const partes = [];
  bloques.forEach((b,bi)=>{
    gruposPorBloque[bi].forEach(grupo=>{
      numPlanilla++;
      partes.push(fichaBienesHTML(cfg, grupo, numPlanilla, b.ubicacion, b.responsable, numPlanilla===totalFichas));
    });
  });
  return { html: partes.join(''), totalFichas, totalBienes: itemsTodos.length, totalAmbientes: bloques.length };
}

/* ---------------------------------------------------------------------
   19-B. REPORTES PDF PAGINADOS (formato UGEL, 20 ítems por hoja)
   Reutiliza el mismo mecanismo que las planillas de verificación
   (abrirVentanaImpresion): abre una ventana aislada con el documento y
   dispara el diálogo de impresión del navegador, donde el usuario elige
   "Guardar como PDF". Así no dependemos de ninguna librería externa.
   --------------------------------------------------------------------- */
function paginar(arr, porHoja){
  const g=[]; for(let i=0;i<arr.length;i+=porHoja) g.push(arr.slice(i,i+porHoja));
  if(g.length===0) g.push([]);
  return g;
}
function construirReportePaginadoHTML(titulo, subtitulo, headers, rows, porHoja){
  const cfg = DB.get(KEYS.config);
  const grupos = paginar(rows, porHoja);
  const totalPaginas = grupos.length;
  const pagHTML = (grupo, numPagina, esUltima)=>{
    const filas = grupo.map(r=>`<tr>${headers.map(h=>`<td>${esc(h.render?h.render(r):r[h.key])}</td>`).join('')}</tr>`).join('');
    return `
    <div class="ficha${esUltima?'':' doc-page'}">
      <div class="ficha-header">
        <div class="logo-slot">${logoDeConfig(cfg)?`<img src="${logoDeConfig(cfg)}">`:''}</div>
        <div class="meta-center">
          <h2>${esc(titulo)}</h2>
          <h3 style="font-weight:normal;">${esc(subtitulo)}</h3>
          <table class="meta-table" style="margin:0 auto;">
            <tr><td><b>I.E.:</b> ${esc(cfg.nombreIE||'—')}</td><td><b>UGEL:</b> ${esc(cfg.ugel||'—')}</td><td><b>Año fiscal:</b> ${esc(cfg.anioFiscal||'—')}</td></tr>
            <tr><td><b>Hoja:</b> ${numPagina} de ${totalPaginas}</td><td colspan="2"><b>Fecha de emisión:</b> ${new Date().toLocaleDateString('es-PE')}</td></tr>
          </table>
        </div>
      </div>
      <table class="bienes-table" style="table-layout:fixed;">
        <thead><tr>${headers.map(h=>`<th>${esc(h.label)}</th>`).join('')}</tr></thead>
        <tbody>${filas || `<tr><td colspan="${headers.length}" style="text-align:center;">Sin registros</td></tr>`}</tbody>
      </table>
      <p style="font-size:10px;margin-top:4px;">Hoja ${numPagina}/${totalPaginas} — ${grupo.length} de ${rows.length} registro(s) totales.</p>
    </div>`;
  };
  return grupos.map((g,idx)=>pagHTML(g, idx+1, idx===grupos.length-1)).join('');
}
function exportInventarioPDF(){
  const r = construirInventarioCompletoFichasHTML();
  if(r.totalBienes===0){ toast('No hay bienes registrados todavía.', 'err'); return; }
  abrirVentanaImpresion('Inventario Patrimonial Completo', r.html, 'landscape');
}
function exportPorAulaPDF(){
  const items = [...DB.get(KEYS.items)].sort((a,b)=>(a.aulaNombre||'').localeCompare(b.aulaNombre||''));
  const headers = [
    {key:'n', label:'N°'},
    {key:'aulaNombre', label:'Aula/Ambiente'},
    {key:'codigoInterno', label:'Código'},
    {key:'denominacion', label:'Denominación'},
    {key:'estadoConservacion', label:'Estado', render:r=>ESTADO_ABREV[r.estadoConservacion]||r.estadoConservacion||''},
    {key:'custodioNombre', label:'Custodio'}
  ];
  const rows = items.map((it,idx)=>({...it, n: idx+1}));
  const html = construirReportePaginadoHTML('Relación de Bienes por Aula / Ambiente', 'Listado agrupado para verificación física', headers, rows, 20);
  abrirVentanaImpresion('Bienes por Aula', html);
}
function exportMovsPDF(){
  const movs = DB.get(KEYS.movs);
  const headers = [
    {key:'n', label:'N°'},
    {key:'fecha', label:'Fecha'},
    {key:'codigoInterno', label:'Código'},
    {key:'tipo', label:'Tipo'},
    {key:'detalle', label:'Detalle'}
  ];
  const rows = movs.map((m,idx)=>({...m, n: idx+1}));
  const html = construirReportePaginadoHTML('Kardex de Movimientos Patrimoniales', 'Altas, bajas, traslados, préstamos y mantenimientos', headers, rows, 20);
  abrirVentanaImpresion('Kardex de Movimientos', html);
}

/* ---------------------------------------------------------------------
   19-C. DOCUMENTOS NORMATIVOS SBN: ACTA DE INVENTARIO FÍSICO
   E INFORME TÉCNICO DE BAJA (con anexo RAEE)
   --------------------------------------------------------------------- */
// Palabras clave para reconocer bienes calificados como Residuos de Aparatos
// Eléctricos y Electrónicos (RAEE), según D.S. N° 001-2012-MINAM, dentro de los
// bienes dados de baja. Es una detección referencial por denominación: el
// responsable de patrimonio debe validar cada caso antes de disponer el bien.
const PALABRAS_RAEE = ['COMPUTADORA','LAPTOP','PORTATIL','PORTÁTIL','IMPRESORA','MONITOR','TELEVISOR','TELEVISION','TELEVISIÓN',
  'PROYECTOR','TABLET','ESTABILIZADOR','UPS','CPU','TECLADO','MOUSE','PARLANTE','RADIO','EQUIPO DE SONIDO','FOTOCOPIADORA',
  'SCANNER','ESCÁNER','ESCANER','CÁMARA','CAMARA','CARGADOR','ROUTER','SWITCH','DVR','VIDEOGRABADOR','MICROONDAS','REFRIGERADOR',
  'VENTILADOR','AIRE ACONDICIONADO','EXTRACTOR'];
function esRAEE(denominacion){
  const d = (denominacion||'').toUpperCase();
  return PALABRAS_RAEE.some(p=>d.includes(p));
}
// Busca en el kardex el último movimiento de tipo "Baja" registrado para un bien,
// para poder mostrar el motivo y la fecha en el informe técnico de baja.
function ultimaBaja(itemId){
  const movs = DB.get(KEYS.movs).filter(m=>m.itemId===itemId && m.tipo==='Baja').sort((a,b)=>b.fecha.localeCompare(a.fecha));
  return movs[0] || null;
}
function filaBajaHTML(it, idx){
  const mov = ultimaBaja(it.id);
  return `<tr>
    <td>${idx+1}</td><td>${esc(it.codigoInterno)}</td><td>${esc(it.codigoSBN||'—')}</td>
    <td>${esc(it.denominacion)}</td><td>${esc([it.marca,it.modelo].filter(Boolean).join(' / ')||'—')}</td>
    <td>${esc(it.numeroSerie||'—')}</td><td>${esc(ESTADO_ABREV[it.estadoConservacion]||it.estadoConservacion||'—')}</td>
    <td>${esc(it.aulaNombre||'—')}</td><td>${esc(mov?mov.fecha:'—')}</td><td>${esc(mov?mov.detalle:'Sin detalle registrado en el kardex')}</td>
  </tr>`;
}
// Arma el Informe Técnico de Baja de Bienes: la relación general de todos los bienes
// con situación "De baja", más un anexo aparte solo con los que corresponden a RAEE,
// tal como exige tratarlos por separado la normativa ambiental (D.S. N° 001-2012-MINAM)
// dentro del proceso de baja de bienes muebles estatales (Directiva N° 001-2015/SBN).
function construirInformeBajaHTML(){
  const cfg = DB.get(KEYS.config);
  const bajas = DB.get(KEYS.items).filter(i=>i.situacion==='De baja');
  const raee = bajas.filter(i=>esRAEE(i.denominacion));
  const filasBaja = bajas.map((it,idx)=>filaBajaHTML(it, idx)).join('') || `<tr><td colspan="10" style="text-align:center;">No hay bienes dados de baja registrados en el sistema.</td></tr>`;
  const filasRAEE = raee.map((it,idx)=>filaBajaHTML(it, idx)).join('') || `<tr><td colspan="10" style="text-align:center;">No se identificaron bienes RAEE entre los dados de baja.</td></tr>`;
  const cols = `<th>N°</th><th>Cód. Patrimonial</th><th>Cód. SBN</th><th>Denominación</th><th>Marca/Modelo</th><th>Serie</th><th>Estado</th><th>Aula de procedencia</th><th>Fecha de baja</th><th>Motivo</th>`;
  const html = `
  <div class="ficha doc-page">
    <div class="ficha-header">
      <div class="logo-slot">${logoDeConfig(cfg)?`<img src="${logoDeConfig(cfg)}">`:''}</div>
      <div class="meta-center">
        <h2>Informe Técnico de Baja de Bienes Muebles Patrimoniales</h2>
        <h3 style="font-weight:normal;">Base: Directiva N° 001-2015/SBN, numeral sobre actos de baja</h3>
        <table class="meta-table" style="margin:0 auto;">
          <tr><td><b>I.E.:</b> ${esc(cfg.nombreIE||'—')}</td><td><b>UGEL:</b> ${esc(cfg.ugel||'—')}</td><td><b>Año fiscal:</b> ${esc(cfg.anioFiscal||'—')}</td></tr>
          <tr><td colspan="3"><b>Fecha de emisión:</b> ${new Date().toLocaleDateString('es-PE')}</td></tr>
        </table>
      </div>
    </div>
    <p style="font-size:11.5px;">Mediante el presente informe se pone en conocimiento la relación de bienes muebles patrimoniales cuya situación en el sistema figura como <b>"De baja"</b>, para que la Comisión de Baja y la Dirección de la Institución Educativa evalúen y tramiten el procedimiento de baja formal ante la UGEL, conforme a la Directiva N° 001-2015/SBN y demás normas del Sistema Nacional de Abastecimiento.</p>
    <table class="bienes-table" style="table-layout:fixed;">
      <thead><tr>${cols}</tr></thead>
      <tbody>${filasBaja}</tbody>
    </table>
    <p style="font-size:11px;margin-top:6px;"><b>Total de bienes dados de baja:</b> ${bajas.length}</p>
  </div>
  <div class="ficha doc-page">
    <div class="ficha-header">
      <div class="logo-slot">${logoDeConfig(cfg)?`<img src="${logoDeConfig(cfg)}">`:''}</div>
      <div class="meta-center">
        <h2>Anexo RAEE</h2>
        <h3 style="font-weight:normal;">Residuos de Aparatos Eléctricos y Electrónicos — D.S. N° 001-2012-MINAM</h3>
      </div>
    </div>
    <p style="font-size:11.5px;">De los bienes dados de baja, los siguientes corresponden a equipos eléctricos o electrónicos y deben ser dispuestos a través de una Empresa Operadora de RAEE (EO-RAEE) autorizada, sin mezclarse con residuos comunes. Esta identificación es referencial (por denominación) y debe ser validada antes de la disposición final.</p>
    <table class="bienes-table" style="table-layout:fixed;">
      <thead><tr>${cols}</tr></thead>
      <tbody>${filasRAEE}</tbody>
    </table>
    <p style="font-size:11px;margin-top:6px;"><b>Total de bienes RAEE identificados:</b> ${raee.length}</p>
  </div>
  <div class="ficha">
    <p style="font-size:11px;margin-top:30px;">Elaborado en base a la información registrada en el sistema patrimonial de la I.E. Este informe no reemplaza la Resolución de baja ni el Acta de Baja que debe tramitarse ante la instancia correspondiente.</p>
    <div class="firma"><div>Responsable de Control Patrimonial</div><div>Director(a) de la I.E.</div></div>
  </div>`;
  return { html, totalBaja: bajas.length, totalRAEE: raee.length };
}
function exportInformeBajaPDF(){
  const r = construirInformeBajaHTML();
  if(r.totalBaja===0){ toast('No hay bienes con situación "De baja" registrados.', 'err'); return; }
  abrirVentanaImpresion('Informe Técnico de Baja de Bienes', r.html);
}
// ACTA DE TOMA DE INVENTARIO FÍSICO: se arma con los datos de la comisión que el
// usuario ingresa en un modal (fecha, hora, lugar e integrantes con su cargo), más
// el resumen consolidado del inventario tal como está en el sistema al momento de
// emitir el acta (Directiva N° 001-2015/SBN, D.S. N° 007-2008-VIVIENDA).
function resumenInventarioParaActa(){
  const items = DB.get(KEYS.items).filter(i=>i.situacion!=='De baja');
  const aulas = DB.get(KEYS.aulas);
  const porAula = aulas.map(a=>({ nombre:a.aulaLabel||a.nombre, n: items.filter(i=>i.aulaId===a.id).length })).filter(x=>x.n>0);
  const idsConAula = new Set(aulas.map(a=>a.id));
  const sinAula = items.filter(i=>!i.aulaId || !idsConAula.has(i.aulaId)).length;
  if(sinAula>0) porAula.push({ nombre:'Sin aula/ambiente asignado', n:sinAula });
  const porEstado = {};
  items.forEach(i=>{ const e=i.estadoConservacion||'Sin estado'; porEstado[e]=(porEstado[e]||0)+1; });
  return { total: items.length, porAula, porEstado, bajas: DB.get(KEYS.items).filter(i=>i.situacion==='De baja').length };
}
function generarActaInventarioHTML(datos){
  const cfg = DB.get(KEYS.config);
  const r = resumenInventarioParaActa();
  const integrantesFila = datos.integrantes.map(p=>`<tr><td>${esc(p.nombre||'—')}</td><td>${esc(p.cargo||'—')}</td></tr>`).join('');
  const firmas = datos.integrantes.map(p=>`<div>${esc(p.nombre||'_____________________')}<br><span style="font-weight:normal;font-size:10px;">${esc(p.cargo||'')}</span></div>`).join('');
  return `
  <div class="ficha">
    <div class="ficha-header">
      <div class="logo-slot">${logoDeConfig(cfg)?`<img src="${logoDeConfig(cfg)}">`:''}</div>
      <div class="meta-center">
        <h2>Acta de Toma de Inventario Físico</h2>
        <h3 style="font-weight:normal;">de Bienes Muebles Patrimoniales</h3>
      </div>
    </div>
    <p style="font-size:11.5px;">En ${esc(datos.lugar||cfg.nombreIE)}, siendo las <b>${esc(datos.hora||'____')}</b> horas del <b>${esc(fechaLarga(datos.fecha))}</b>, se constituyó la Comisión de Inventario de Bienes Patrimoniales de la Institución Educativa <b>${esc(cfg.nombreIE)}</b> (UGEL ${esc(cfg.ugel||'—')}), integrada por:</p>
    <table><thead><tr><th>Nombre</th><th>Cargo / Rol en la comisión</th></tr></thead><tbody>${integrantesFila}</tbody></table>
    <p style="font-size:11.5px;margin-top:10px;">Con el fin de dar cumplimiento a la Directiva N° 001-2015/SBN "Procedimientos de Gestión de los Bienes Muebles Estatales" y el Artículo 121° del D.S. N° 007-2008-VIVIENDA, la Comisión procedió a verificar físicamente, codificar y contrastar los bienes muebles patrimoniales registrados en el sistema de la Institución Educativa, con el siguiente resultado consolidado:</p>
    <table><thead><tr><th>Aula / Ambiente</th><th>N° de bienes</th></tr></thead>
      <tbody>${r.porAula.map(a=>`<tr><td>${esc(a.nombre)}</td><td class="num">${a.n}</td></tr>`).join('')}
      <tr><td><b>TOTAL BIENES ACTIVOS VERIFICADOS</b></td><td class="num"><b>${r.total}</b></td></tr></tbody></table>
    <table style="margin-top:10px;"><thead><tr><th>Estado de conservación</th><th>N° de bienes</th></tr></thead>
      <tbody>${Object.entries(r.porEstado).map(([e,n])=>`<tr><td>${esc(e)}</td><td class="num">${n}</td></tr>`).join('')}</tbody></table>
    <p style="font-size:11px;margin-top:6px;">Adicionalmente, figuran <b>${r.bajas}</b> bien(es) con situación "De baja" a la fecha, no incluido(s) en el total verificado.</p>
    <p style="font-size:11.5px;margin-top:10px;">Las diferencias, faltantes u observaciones encontradas durante la verificación física se detallan en las Planillas de Verificación por aula/ambiente que se adjuntan como anexo a la presente acta.</p>
    <p style="font-size:11.5px;margin-top:10px;">${datos.observaciones? esc(datos.observaciones) : 'No se registraron observaciones adicionales.'}</p>
    <p style="font-size:11.5px;margin-top:16px;">En señal de conformidad, se suscribe la presente acta en la fecha indicada.</p>
    <div class="firma">${firmas}</div>
  </div>`;
}
function fechaLarga(iso){
  if(!iso) return '____________';
  const [y,m,d] = iso.split('-');
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return `${Number(d)} de ${meses[Number(m)-1]||'—'} de ${y}`;
}
function abrirModalActaInventario(){
  const cfg = DB.get(KEYS.config);
  const catalogoComision = DB.get(KEYS.comision);
  const bg = document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML = `<div class="modal">
    <div class="m-h"><h3>Generar Acta de Inventario Físico</h3><button class="close-x">&times;</button></div>
    <div class="m-b">
      <div class="grid g3">
        <div class="field"><label>Fecha del acta</label><input id="ai_fecha" type="date" value="${today()}"></div>
        <div class="field"><label>Hora</label><input id="ai_hora" value="09:00"></div>
        <div class="field"><label>Lugar</label><input id="ai_lugar" value="${esc(cfg.nombreIE||'')}"></div>
      </div>
      <div class="field"><label>Integrantes de la Comisión de Inventario</label>
        ${catalogoComision.length>0?`<div class="hint" style="margin-bottom:4px;">Marca a quienes participan en esta acta (del catálogo de <b>Comisión de Inventario</b>) o agrega uno nuevo abajo.</div>
        <div id="ai_catalogo" style="margin-bottom:8px;">${catalogoComision.map(p=>`<label style="display:flex;align-items:center;gap:6px;margin-bottom:4px;"><input type="checkbox" class="ai_catchk" data-nombre="${esc(p.nombre)}" data-cargo="${esc(p.cargo)}" ${p.activo!==false?'checked':''}> ${esc(p.nombre)} — <span class="hint">${esc(p.cargo)}</span></label>`).join('')}</div>`
        :`<div class="hint" style="margin-bottom:4px;">Aún no tienes integrantes guardados en el catálogo de <b>Comisión de Inventario</b> (Mantenedores) — puedes agregarlos ahí para no volver a tipearlos la próxima vez.</div>`}
        <div id="ai_integrantes"></div>
        <button class="btn btn-sm" id="ai_addRow" type="button" style="margin-top:6px;">+ Agregar integrante manual</button>
      </div>
      <div class="field"><label>Observaciones (opcional)</label><textarea id="ai_obs" rows="2" placeholder="Ej. discrepancias generales, bienes pendientes de codificar, etc."></textarea></div>
    </div>
    <div class="m-f"><button class="btn" id="ai_cancel">Cancelar</button><button class="btn btn-primary" id="ai_generar">Generar e imprimir</button></div>
  </div>`;
  document.body.appendChild(bg);
  const filas = bg.querySelector('#ai_integrantes');
  const addRow = (nombre='', cargo='')=>{
    const row = document.createElement('div');
    row.className = 'grid g3'; row.style.marginBottom='6px';
    row.innerHTML = `<input class="ai_nombre" placeholder="Nombre completo" value="${esc(nombre)}"><input class="ai_cargo" placeholder="Cargo (Presidente, Secretario, Miembro…)" value="${esc(cargo)}"><button class="btn btn-sm btn-ghost ai_del" type="button">Quitar</button>`;
    row.querySelector('.ai_del').addEventListener('click', ()=>row.remove());
    filas.appendChild(row);
  };
  // Si no hay catálogo de Comisión guardado, se mantiene el comportamiento
  // anterior (precarga Director/Responsable de patrimonio como antes).
  if(catalogoComision.length===0){
    addRow(cfg.director||'', 'Presidente (Director/a)');
    addRow(cfg.responsablePatrimonio||'', 'Secretario(a) (Control Patrimonial)');
    addRow('', 'Miembro');
  }
  bg.querySelector('#ai_addRow').addEventListener('click', ()=>addRow());
  const close = ()=>bg.remove();
  bg.querySelector('.close-x').addEventListener('click', close);
  bg.querySelector('#ai_cancel').addEventListener('click', close);
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  bg.querySelector('#ai_generar').addEventListener('click', async ()=>{
    const delCatalogo = [...bg.querySelectorAll('.ai_catchk:checked')].map(chk=>({
      nombre: chk.dataset.nombre, cargo: chk.dataset.cargo
    }));
    const manuales = [...filas.querySelectorAll('.grid')].map(row=>({
      nombre: row.querySelector('.ai_nombre').value.trim(),
      cargo: row.querySelector('.ai_cargo').value.trim()
    })).filter(p=>p.nombre || p.cargo);
    const integrantes = [...delCatalogo, ...manuales];
    if(integrantes.length===0){ toast('Agrega al menos un integrante de la comisión.', 'err'); return; }
    const datos = {
      fecha: bg.querySelector('#ai_fecha').value || today(),
      hora: bg.querySelector('#ai_hora').value.trim(),
      lugar: bg.querySelector('#ai_lugar').value.trim(),
      observaciones: bg.querySelector('#ai_obs').value.trim(),
      integrantes
    };
    const resumenInv = resumenInventarioParaActa();
    const registro = await registrarActaFirmada('Acta de Toma de Inventario Físico', {
      ...datos, totalVerificado:resumenInv.total, porEstado:resumenInv.porEstado
    }, `Total verificado: ${resumenInv.total} bien(es), comisión de ${integrantes.length} integrante(s)`);
    const html = generarActaInventarioHTML(datos) + bloqueVerificacionHTML(registro);
    abrirVentanaImpresion('Acta de Toma de Inventario Físico', html);
    close();
  });
}

/* ---------------------------------------------------------------------
   20. REPORTES Y EXPORTACIÓN
   --------------------------------------------------------------------- */
function renderReportes(){
  const items = DB.get(KEYS.items);
  return `<div class="grid g3 noprint">
    <div class="card"><div class="card-b"><h3 style="font-size:15px;">Inventario completo</h3>
      <p class="hint">Ficha de Levantamiento de Información oficial (una hoja por cada 20 bienes, agrupados por aula/ambiente, orientación horizontal) — lista para presentar a la UGEL a fin de año.</p>
      <button class="btn btn-primary btn-sm" id="expInventarioPDF">PDF oficial UGEL (20/hoja)</button>
      <button class="btn btn-sm" id="expInventarioCSV">CSV</button>
      <button class="btn btn-sm" id="expInventarioXLSX" ${isAdmin()?'':''}>Excel (.xlsx)</button>
    </div></div>
    <div class="card"><div class="card-b"><h3 style="font-size:15px;">Relación por aula</h3>
      <p class="hint">Listado agrupado por ambiente para la verificación física.</p>
      <button class="btn btn-primary btn-sm" id="expPorAulaPDF">PDF (20/hoja)</button>
      <button class="btn btn-sm" id="expPorAulaCSV">Descargar CSV</button>
    </div></div>
    <div class="card"><div class="card-b"><h3 style="font-size:15px;">Kardex de movimientos</h3>
      <p class="hint">Historial de altas, bajas, traslados, préstamos y mantenimientos.</p>
      <button class="btn btn-primary btn-sm" id="expMovsPDF">PDF (20/hoja)</button>
      <button class="btn btn-sm" id="expMovsCSV">Descargar CSV</button>
    </div></div>
    <div class="card"><div class="card-b"><h3 style="font-size:15px;">Registro de calibraciones</h3>
      <p class="hint">Historial de calibraciones periódicas de instrumentos de precisión (entidad calibradora, N° de certificado, resultado y próxima fecha).</p>
      <button class="btn btn-primary btn-sm" id="expCalibracionesPDF">PDF (20/hoja)</button>
      <button class="btn btn-sm" id="expCalibracionesCSV">Descargar CSV</button>
    </div></div>
  </div>
  <div class="grid g3 noprint" style="margin-top:16px;">
    <div class="card"><div class="card-b"><h3 style="font-size:15px;">Bienes por responsable</h3>
      <p class="hint">Agrupado por la persona/custodio a cargo de cada bien (Personal / bibliotecarios).</p>
      <button class="btn btn-primary btn-sm" id="expPorResponsablePDF">PDF (20/hoja)</button>
      <button class="btn btn-sm" id="expPorResponsableCSV">Descargar CSV</button>
    </div></div>
    <div class="card"><div class="card-b"><h3 style="font-size:15px;">Bienes por monto</h3>
      <p class="hint">Ordenado de mayor a menor valor de adquisición, con el total valorizado.</p>
      <button class="btn btn-primary btn-sm" id="expPorMontoPDF">PDF (20/hoja)</button>
      <button class="btn btn-sm" id="expPorMontoCSV">Descargar CSV</button>
    </div></div>
    <div class="card"><div class="card-b"><h3 style="font-size:15px;">Bienes por antigüedad</h3>
      <p class="hint">De más antiguo a más reciente, según su fecha de registro.</p>
      <button class="btn btn-primary btn-sm" id="expPorAntiguedadPDF">PDF (20/hoja)</button>
      <button class="btn btn-sm" id="expPorAntiguedadCSV">Descargar CSV</button>
    </div></div>
    <div class="card"><div class="card-b"><h3 style="font-size:15px;">Depreciación de bienes (NICSP)</h3>
      <p class="hint">Depreciación acumulada y valor neto en libros por bien, método de línea recta según la vida útil configurada por categoría.</p>
      <button class="btn btn-primary btn-sm" id="expDepreciacionPDF">PDF (20/hoja)</button>
      <button class="btn btn-sm" id="expDepreciacionCSV">Descargar CSV</button>
    </div></div>
  </div>
  <div class="grid g2 noprint" style="margin-top:16px;">
    <div class="card"><div class="card-b"><h3 style="font-size:15px;">Acta de Toma de Inventario Físico</h3>
      <p class="hint">Documento formal con la comisión, fecha, lugar y el resumen consolidado del inventario, conforme a la Directiva N° 001-2015/SBN. Se completa con un pequeño formulario antes de imprimir.</p>
      <button class="btn btn-primary btn-sm" id="expActaInventario">Generar acta (PDF)</button>
    </div></div>
    <div class="card"><div class="card-b"><h3 style="font-size:15px;">Informe Técnico de Baja + Anexo RAEE</h3>
      <p class="hint">Relación general de todos los bienes con situación "De baja" en el sistema, más un anexo aparte solo con los que corresponden a equipos eléctricos/electrónicos (RAEE), según D.S. N° 001-2012-MINAM. Para tramitar la baja de un bien concreto (solicitud, informe técnico, resolución y disposición final) usa el módulo <b>"Bajas de bienes"</b> del menú Inventario.</p>
      <button class="btn btn-primary btn-sm" id="expInformeBaja">Generar informe (PDF)</button>
      <button class="btn btn-sm" id="irABajas" style="margin-left:6px;">Ir a Bajas de bienes</button>
    </div></div>
  </div>
  <div class="grid g2 noprint" style="margin-top:16px;">
    <div class="card"><div class="card-b"><h3 style="font-size:15px;">Resumen semanal de alertas</h3>
      <p class="hint">Junta en un solo texto todas las alertas activas ahora mismo (préstamos vencidos, mantenimientos/calibraciones por vencer, requerimientos pendientes, expedientes de baja sin resolver, garantías y pólizas por vencer, bienes en almacén o por sanear). Como el sistema corre en esta computadora sin servidor de correo propio, el botón abre un borrador en tu programa de correo habitual — configura el/los destinatarios en <b>Configuración</b>.</p>
      <button class="btn btn-primary btn-sm" id="btnEnviarResumenSemanal">Enviar resumen por correo</button>
      <button class="btn btn-sm" id="btnCopiarResumenSemanal" style="margin-left:6px;">Copiar texto</button>
      ${(()=>{ const f = DB.get(KEYS.config).fechaUltimoResumenSemanal; return f ? `<div class="hint" style="margin-top:6px;">Último resumen generado: ${esc(f)}.</div>` : ''; })()}
    </div></div>
  </div>
  <div class="grid g2 noprint" style="margin-top:16px;">
    <div class="card"><div class="card-b"><h3 style="font-size:15px;">Exportación SBN / SIGA-Patrimonio</h3>
      <p class="hint">Exporta el inventario activo en columnas equivalentes a las que usan los sistemas del Estado (SINABIP/SIGA-Patrimonio): código de entidad, código patrimonial, código y grupo SBN, estado codificado (MB/B/R/M), ubicación y custodio — útil si en algún momento necesitas trasladar los datos a otro sistema.</p>
      <button class="btn btn-primary btn-sm" id="expSBNCSV">Descargar CSV (formato SBN/SIGA)</button>
    </div></div>
    ${isAdmin()?`<div class="card"><div class="card-b"><h3 style="font-size:15px;">Conciliación patrimonial-contable</h3>
      <p class="hint">Cruza el valor de adquisición del inventario (SIGIE) contra lo que indica contabilidad/SIAF a una fecha de corte, mostrando la diferencia — lo que piden las auditorías de la Contraloría.</p>
      <button class="btn btn-primary btn-sm" id="irAConciliacion">Ir a Conciliación contable</button>
    </div></div>`:''}
    <div class="card"><div class="card-b"><h3 style="font-size:15px;">Informe Ejecutivo Anual</h3>
      <p class="hint">Resumen de una sola vista para el Director/UGEL: KPIs patrimoniales, depreciación, mantenimientos, préstamos, verificación SBN y evolución interanual (si has guardado inventarios de años anteriores en "Comparativo interanual").</p>
      <button class="btn btn-primary btn-sm" id="expInformeEjecutivo">Generar informe (PDF)</button>
    </div></div>
  </div>
  <div class="grid g2 noprint" style="margin-top:16px;">
    <div class="card"><div class="card-b"><h3 style="font-size:15px;">Acta resumen de conciliación patrimonial</h3>
      <p class="hint">Base para el Informe Final / Acta de Conciliación Patrimonio-Contable (Directiva 001-2015/SBN).</p>
      <button class="btn btn-primary btn-sm" id="expActa">Generar acta (TXT)</button>
      <button class="btn btn-sm" id="expActaPrint">Ver e imprimir acta</button>
    </div></div>
    ${isAdmin()?`<div class="card"><div class="card-b"><h3 style="font-size:15px;">Respaldo completo del sistema</h3>
      <p class="hint">Exporta o restaura TODA la base de datos (bienes, aulas, usuarios, préstamos, catálogo) en un solo archivo JSON. Úsalo como copia de seguridad periódica.</p>
      <button class="btn btn-primary btn-sm" id="expBackup">Descargar respaldo (.json)</button>
      <label class="btn btn-sm" style="margin-left:6px;">Restaurar respaldo<input type="file" id="impBackup" accept=".json" style="display:none;"></label>
    </div></div>`:''}
    ${isAdmin()?`<div class="card"><div class="card-b"><h3 style="font-size:15px;">Datos de ejemplo (demostración)</h3>
      <p class="hint">Rellena TODOS los módulos con información simulada y coherente entre sí (biblioteca, bienes, aulas, préstamos, mantenimientos, compras, bajas, almacén, bitácora…). Reemplaza los datos actuales; antes te ofrece descargar un respaldo.</p>
      <button class="btn btn-primary btn-sm" id="btnGenEjemplo">🧪 Generar datos de ejemplo</button>
    </div></div>`:''}
    ${isAdmin()?`<div class="card"><div class="card-b"><h3 style="font-size:15px;">Reiniciar sistema para otra institución</h3>
      <p class="hint">Borra bienes, aulas, custodios, préstamos, mantenimientos, kardex, papelera y usuarios, dejando el sistema como recién instalado. Útil si vas a reutilizar SIGIE en otro colegio partiendo de cero. Se recomienda descargar antes un respaldo (arriba).</p>
      <button class="btn btn-danger btn-sm" id="btnResetSistema">🗑️ Reiniciar sistema por completo</button>
    </div></div>`:''}
  </div>
  <div class="hint noprint" style="margin-top:10px;">Total de bienes en el sistema: ${items.length}</div>
  <div id="actaPreview"></div>`;
}
function downloadFile(filename, content, mime){
  const blob = new Blob([content], {type:mime}); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
}
function csvEscape(v){ v = (v===undefined||v===null)?'':String(v); if(/[",\n]/.test(v)) return '"'+v.replace(/"/g,'""')+'"'; return v; }
function toCSV(rows, headers){ return headers.map(h=>csvEscape(h.label)).join(',')+'\n' + rows.map(r=>headers.map(h=>csvEscape(r[h.key])).join(',')).join('\n'); }
const INV_HEADERS = [
  {key:'codigoInterno',label:'Código Patrimonial'},{key:'codigoUsoInterno',label:'Código Interno (colegio)'},{key:'codigoAnioAnterior',label:'Cód. Inv. Año Anterior'},{key:'codigoSBN',label:'Código SBN'},
  {key:'denominacion',label:'Denominación'},{key:'marca',label:'Marca'},{key:'modelo',label:'Modelo'},{key:'numeroSerie',label:'N° de Serie'},
  {key:'color',label:'Color'},{key:'estadoConservacion',label:'Estado'},{key:'valorAdquisicion',label:'Valor de Adquisición (S/.)'},{key:'formaAdquisicion',label:'Forma de Adquisición'},{key:'donante',label:'Donante'},{key:'documentoDonacion',label:'Documento de Donación'},{key:'aulaNombre',label:'Aula/Ambiente'},{key:'custodioNombre',label:'Responsable'},
  {key:'situacion',label:'Situación'},{key:'observaciones',label:'Observaciones'},{key:'fechaRegistro',label:'Fecha de registro'},{key:'registradoPor',label:'Registrado por'}
];
function exportInventarioCSV(){ downloadFile('inventario_patrimonial.csv', '\uFEFF'+toCSV(DB.get(KEYS.items), INV_HEADERS), 'text/csv;charset=utf-8;'); }
function exportInventarioXLSX(){
  // Todo el inventario en UNA sola hoja (una fila por bien, con numeración correlativa
  // y todas las columnas patrimoniales), tal como se exige para presentar el reporte.
  const items = DB.get(KEYS.items);
  const wb = XLSX.utils.book_new();
  const filas = items.map((i,idx)=>{
    const o = { 'N°': idx+1 };
    INV_HEADERS.forEach(h=>o[h.label]=i[h.key]);
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(filas);
  ws['!cols'] = [{wch:4}].concat(INV_HEADERS.map(()=>({wch:16})));
  XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
  XLSX.writeFile(wb, 'inventario_patrimonial.xlsx');
}
function exportPorAulaCSV(){
  const items = [...DB.get(KEYS.items)].sort((a,b)=>(a.aulaNombre||'').localeCompare(b.aulaNombre||''));
  const headers=[{key:'aulaNombre',label:'Aula'},{key:'codigoInterno',label:'Código'},{key:'denominacion',label:'Denominación'},{key:'estadoConservacion',label:'Estado'},{key:'custodioNombre',label:'Custodio'}];
  downloadFile('bienes_por_aula.csv','\uFEFF'+toCSV(items,headers),'text/csv;charset=utf-8;');
}
function exportMovsCSV(){
  const headers=[{key:'fecha',label:'Fecha'},{key:'codigoInterno',label:'Código'},{key:'tipo',label:'Tipo'},{key:'detalle',label:'Detalle'}];
  downloadFile('kardex_movimientos.csv','\uFEFF'+toCSV(DB.get(KEYS.movs),headers),'text/csv;charset=utf-8;');
}
// Registro / historial de calibraciones periódicas de instrumentos de precisión
// (balanzas, tensiómetros, equipos de laboratorio, etc.): reúne TODOS los
// registros de tipo "Calibración" del módulo de Mantenimientos, ordenados por
// fecha de próxima calibración, para sustentar ante la UGEL/Contraloría que
// los instrumentos se calibran periódicamente y con quién.
function calibracionesParaReporte(){
  const itemsById = new Map(DB.get(KEYS.items).map(i=>[i.id,i]));
  return DB.get(KEYS.mantenimientos).filter(m=>m.tipo==='Calibración').map(m=>{
    const it = itemsById.get(m.itemId);
    return { ...m, marca: it?it.marca:'', modelo: it?it.modelo:'', numeroSerie: it?it.numeroSerie:'' };
  }).sort((a,b)=>(a.fechaProgramada||'9999').localeCompare(b.fechaProgramada||'9999'));
}
function exportCalibracionesPDF(){
  const rows = calibracionesParaReporte();
  if(rows.length===0){ toast('Aún no hay registros de calibración (Mantenimientos / calibraciones → Tipo "Calibración").','err'); return; }
  const headers = [
    {key:'n', label:'N°'},
    {key:'codigoInterno', label:'Código'},
    {key:'denominacion', label:'Instrumento'},
    {key:'aulaNombre', label:'Aula/Ambiente', render:r=>r.aulaNombre||'—'},
    {key:'entidadCalibradora', label:'Entidad calibradora', render:r=>r.entidadCalibradora||'—'},
    {key:'numeroCertificado', label:'N° certificado', render:r=>r.numeroCertificado||'—'},
    {key:'resultadoCalibracion', label:'Resultado', render:r=>r.resultadoCalibracion||'—'},
    {key:'fechaProgramada', label:'Próxima calibración', render:r=>r.fechaProgramada||'—'},
    {key:'estado', label:'Estado'}
  ];
  const rowsN = rows.map((r,idx)=>({...r, n: idx+1}));
  const html = construirReportePaginadoHTML('Registro de Calibraciones Periódicas', 'Instrumentos de precisión — historial y próxima calibración programada', headers, rowsN, 20);
  abrirVentanaImpresion('Registro de Calibraciones', html);
}
function exportCalibracionesCSV(){
  const rows = calibracionesParaReporte();
  if(rows.length===0){ toast('Aún no hay registros de calibración (Mantenimientos / calibraciones → Tipo "Calibración").','err'); return; }
  const headers=[
    {key:'codigoInterno',label:'Código'},{key:'denominacion',label:'Instrumento'},{key:'marca',label:'Marca'},{key:'modelo',label:'Modelo'},{key:'numeroSerie',label:'N° de Serie'},
    {key:'aulaNombre',label:'Aula/Ambiente'},{key:'entidadCalibradora',label:'Entidad calibradora'},{key:'numeroCertificado',label:'N° de certificado'},
    {key:'resultadoCalibracion',label:'Resultado'},{key:'fechaReporte',label:'Fecha de registro'},{key:'fechaProgramada',label:'Próxima calibración'},
    {key:'recurrenciaMeses',label:'Repetir cada (meses)'},{key:'estado',label:'Estado'},{key:'fechaCierre',label:'Fecha de cierre'}
  ];
  downloadFile('registro_calibraciones.csv','\uFEFF'+toCSV(rows,headers),'text/csv;charset=utf-8;');
}

/* ---------------------------------------------------------------------
   19-D. REPORTES GERENCIALES: POR RESPONSABLE, POR MONTO Y POR ANTIGÜEDAD
   --------------------------------------------------------------------- */
function exportPorResponsablePDF(){
  const items = [...DB.get(KEYS.items)].filter(i=>i.situacion!=='De baja')
    .sort((a,b)=>(a.custodioNombre||'').localeCompare(b.custodioNombre||''));
  const headers = [
    {key:'n', label:'N°'},
    {key:'custodioNombre', label:'Responsable', render:r=>r.custodioNombre||'Sin responsable asignado'},
    {key:'codigoInterno', label:'Código'},
    {key:'denominacion', label:'Denominación'},
    {key:'aulaNombre', label:'Aula/Ambiente'},
    {key:'estadoConservacion', label:'Estado', render:r=>ESTADO_ABREV[r.estadoConservacion]||r.estadoConservacion||''}
  ];
  const rows = items.map((it,idx)=>({...it, n: idx+1}));
  const html = construirReportePaginadoHTML('Relación de Bienes por Responsable / Custodio', 'Bienes activos agrupados por la persona a cargo', headers, rows, 20);
  abrirVentanaImpresion('Bienes por Responsable', html);
}
function exportPorResponsableCSV(){
  const items = [...DB.get(KEYS.items)].filter(i=>i.situacion!=='De baja').sort((a,b)=>(a.custodioNombre||'').localeCompare(b.custodioNombre||''));
  const headers=[{key:'custodioNombre',label:'Responsable'},{key:'codigoInterno',label:'Código'},{key:'denominacion',label:'Denominación'},{key:'aulaNombre',label:'Aula'},{key:'estadoConservacion',label:'Estado'}];
  downloadFile('bienes_por_responsable.csv','\uFEFF'+toCSV(items,headers),'text/csv;charset=utf-8;');
}
function exportPorMontoPDF(){
  const items = [...DB.get(KEYS.items)].filter(i=>i.situacion!=='De baja')
    .sort((a,b)=>(Number(b.valorAdquisicion)||0)-(Number(a.valorAdquisicion)||0));
  const headers = [
    {key:'n', label:'N°'},
    {key:'codigoInterno', label:'Código'},
    {key:'denominacion', label:'Denominación'},
    {key:'aulaNombre', label:'Aula/Ambiente'},
    {key:'custodioNombre', label:'Responsable'},
    {key:'valorAdquisicion', label:'Valor Adquis. (S/.)', render:r=>r.valorAdquisicion!=null?Number(r.valorAdquisicion).toFixed(2):'—'},
    {key:'vnl', label:'Val. Neto Libros (S/.)', render:r=>{ const c=calcularDepreciacionItem(r); return c?c.valorNetoLibros.toFixed(2):(r.valorAdquisicion!=null?Number(r.valorAdquisicion).toFixed(2):'—'); }}
  ];
  const rows = items.map((it,idx)=>({...it, n: idx+1}));
  const valorTotal = items.reduce((a,i)=>a+(Number(i.valorAdquisicion)||0),0);
  const vnlTotal = items.reduce((a,i)=>{ const c=calcularDepreciacionItem(i); return a+(c?c.valorNetoLibros:(Number(i.valorAdquisicion)||0)); },0);
  let html = construirReportePaginadoHTML('Relación de Bienes por Valor de Adquisición', 'Ordenado de mayor a menor monto', headers, rows, 20);
  html += `<div class="ficha"><p style="font-size:11.5px;"><b>Valor total de adquisición (bienes activos):</b> ${money(valorTotal)} &nbsp;|&nbsp; <b>Valor neto en libros total (NICSP):</b> ${money(vnlTotal)}</p>
  <p style="font-size:10.5px;color:#555;">Nota: solo se contabilizan los bienes que tienen registrado un valor de adquisición. Los que no lo tienen figuran con "—" y no se pueden sumar.</p></div>`;
  abrirVentanaImpresion('Bienes por Monto', html);
}
function exportPorMontoCSV(){
  const items = [...DB.get(KEYS.items)].filter(i=>i.situacion!=='De baja').sort((a,b)=>(Number(b.valorAdquisicion)||0)-(Number(a.valorAdquisicion)||0))
    .map(it=>{ const c=calcularDepreciacionItem(it); return {...it, vnl: (c?c.valorNetoLibros:(Number(it.valorAdquisicion)||0)).toFixed(2)}; });
  const headers=[{key:'codigoInterno',label:'Código'},{key:'denominacion',label:'Denominación'},{key:'aulaNombre',label:'Aula'},{key:'custodioNombre',label:'Responsable'},{key:'valorAdquisicion',label:'Valor de Adquisición (S/.)'},{key:'vnl',label:'Valor Neto en Libros (S/.)'}];
  downloadFile('bienes_por_monto.csv','\uFEFF'+toCSV(items,headers),'text/csv;charset=utf-8;');
}
// Antigüedad: años transcurridos desde la fecha de registro, útil como base para
// planificar reposición y, más adelante, para el cálculo de depreciación.
function aniosTranscurridos(fechaISO){
  if(!fechaISO) return null;
  const f = new Date(fechaISO+'T00:00:00'); if(isNaN(f)) return null;
  const ms = Date.now() - f.getTime();
  return ms/(1000*60*60*24*365.25);
}
function exportPorAntiguedadPDF(){
  const items = [...DB.get(KEYS.items)].filter(i=>i.situacion!=='De baja')
    .sort((a,b)=>(a.fechaRegistro||'').localeCompare(b.fechaRegistro||''));
  const headers = [
    {key:'n', label:'N°'},
    {key:'codigoInterno', label:'Código'},
    {key:'denominacion', label:'Denominación'},
    {key:'fechaRegistro', label:'Fecha de registro'},
    {key:'antiguedad', label:'Antigüedad', render:r=>{ const a=aniosTranscurridos(r.fechaRegistro); return a==null?'—':(a<1?Math.round(a*12)+' mes(es)':a.toFixed(1)+' año(s)'); }},
    {key:'estadoConservacion', label:'Estado', render:r=>ESTADO_ABREV[r.estadoConservacion]||r.estadoConservacion||''},
    {key:'aulaNombre', label:'Aula/Ambiente'}
  ];
  const rows = items.map((it,idx)=>({...it, n: idx+1}));
  const html = construirReportePaginadoHTML('Relación de Bienes por Antigüedad', 'De más antiguo a más reciente, según fecha de registro', headers, rows, 20);
  abrirVentanaImpresion('Bienes por Antigüedad', html);
}
function exportPorAntiguedadCSV(){
  const items = [...DB.get(KEYS.items)].filter(i=>i.situacion!=='De baja').sort((a,b)=>(a.fechaRegistro||'').localeCompare(b.fechaRegistro||''));
  const headers=[{key:'codigoInterno',label:'Código'},{key:'denominacion',label:'Denominación'},{key:'fechaRegistro',label:'Fecha de registro'},{key:'estadoConservacion',label:'Estado'},{key:'aulaNombre',label:'Aula'}];
  downloadFile('bienes_por_antiguedad.csv','\uFEFF'+toCSV(items,headers),'text/csv;charset=utf-8;');
}
// Reporte de depreciación (NICSP, línea recta, sin valor residual). Solo incluye
// bienes activos (no dados de baja) que tienen tanto valor de adquisición como
// categoría de depreciación asignada; los demás no son depreciables aún.
function filasDepreciacion(){
  const categorias = DB.get(KEYS.categoriasDeprec);
  const items = [...DB.get(KEYS.items)]
    .filter(i=>i.situacion!=='De baja' && i.valorAdquisicion!=null && i.categoriaDeprecId)
    .sort((a,b)=>(a.aulaNombre||'').localeCompare(b.aulaNombre||''));
  return items.map((it,idx)=>{
    const calc = calcularDepreciacionItem(it, categorias);
    return { ...it, n: idx+1,
      categoriaNombre: calc ? calc.categoria : '—',
      vidaUtilTxto: calc ? calc.vidaUtilAnios+' año(s)' : '—',
      depAcum: calc ? calc.depreciacionAcumulada : 0,
      vnl: calc ? calc.valorNetoLibros : Number(it.valorAdquisicion)
    };
  });
}
function exportDepreciacionPDF(){
  const rows = filasDepreciacion();
  const headers = [
    {key:'n', label:'N°'}, {key:'codigoInterno', label:'Código'}, {key:'denominacion', label:'Denominación'},
    {key:'categoriaNombre', label:'Categoría'}, {key:'fechaRegistro', label:'F. registro'}, {key:'vidaUtilTxto', label:'Vida útil'},
    {key:'valorAdquisicion', label:'Val. Adquis. (S/.)', render:r=>Number(r.valorAdquisicion).toFixed(2)},
    {key:'depAcum', label:'Dep. Acum. (S/.)', render:r=>r.depAcum.toFixed(2)},
    {key:'vnl', label:'Val. Neto Libros (S/.)', render:r=>r.vnl.toFixed(2)}
  ];
  const valorTotal = rows.reduce((a,r)=>a+(Number(r.valorAdquisicion)||0),0);
  const depTotal = rows.reduce((a,r)=>a+r.depAcum,0);
  const vnlTotal = rows.reduce((a,r)=>a+r.vnl,0);
  let html = construirReportePaginadoHTML('Reporte de Depreciación de Bienes (NICSP)', 'Método de línea recta, sin valor residual, desde la fecha de registro de cada bien', headers, rows, 20);
  html += `<div class="ficha"><p style="font-size:11.5px;"><b>Valor de adquisición total:</b> ${money(valorTotal)} &nbsp;|&nbsp; <b>Depreciación acumulada total:</b> ${money(depTotal)} &nbsp;|&nbsp; <b>Valor neto en libros total:</b> ${money(vnlTotal)}</p>
  <p style="font-size:10.5px;color:#555;">Nota: cálculo referencial por línea recta (NICSP), sin valor residual, a partir de la fecha de registro del bien en el sistema y la vida útil configurada por categoría en "Vida útil (depreciación)". Verifique la vida útil de cada categoría contra la directiva contable vigente de su entidad antes de usar estas cifras en estados financieros oficiales. Solo se incluyen bienes activos (no dados de baja) con valor de adquisición y categoría de depreciación asignados.</p></div>`;
  abrirVentanaImpresion('Depreciación NICSP', html);
}
function exportDepreciacionCSV(){
  const rows = filasDepreciacion();
  const headers=[
    {key:'codigoInterno',label:'Código'},{key:'denominacion',label:'Denominación'},{key:'categoriaNombre',label:'Categoría'},
    {key:'fechaRegistro',label:'F. registro'},{key:'vidaUtilTxto',label:'Vida útil'},
    {key:'valorAdquisicion',label:'Valor Adquisición (S/.)'},{key:'depAcum',label:'Depreciación Acumulada (S/.)'},{key:'vnl',label:'Valor Neto en Libros (S/.)'}
  ];
  const rowsFmt = rows.map(r=>({...r, valorAdquisicion:Number(r.valorAdquisicion).toFixed(2), depAcum:r.depAcum.toFixed(2), vnl:r.vnl.toFixed(2)}));
  downloadFile('depreciacion_nicsp.csv','\uFEFF'+toCSV(rowsFmt,headers),'text/csv;charset=utf-8;');
}
function exportActa(){
  const cfg = DB.get(KEYS.config); const items = DB.get(KEYS.items);
  const valorTotal = items.reduce((a,i)=>a+(Number(i.valorAdquisicion)||0),0);
  const txt = `ACTA RESUMEN DE CONCILIACIÓN PATRIMONIO - CONTABLE
Institución Educativa: ${cfg.nombreIE}
Código modular: ${cfg.codigoModular||'—'}   Código de local: ${cfg.codigoLocal||'—'}
UGEL: ${cfg.ugel||'—'}   DRE: ${cfg.dre||'—'}
Director(a): ${cfg.director||'—'}
Responsable de Control Patrimonial: ${cfg.responsablePatrimonio||'—'}
Año fiscal: ${cfg.anioFiscal}
Fecha de emisión: ${today()}

Elaborado en el marco de la Directiva N° 001-2015/SBN "Procedimientos para la Gestión de los
Bienes Muebles Estatales" y en concordancia con la presentación del Inventario de Bienes
Muebles Patrimoniales ante la Comisión de Inventario de la institución.

RESUMEN GENERAL
Total de bienes inventariados: ${items.length}
Valor total de adquisición: ${money(valorTotal)}
${ESTADOS_CONSERVACION.map(e=>'Bienes en estado '+e+': '+items.filter(i=>i.estadoConservacion===e).length).join('\n')}
Bienes dados de baja formalmente: ${items.filter(i=>i.situacion==='De baja').length}

Este documento es un resumen generado automáticamente por el Sistema de Gestión de
Inventario Escolar (SIGIE) y debe adjuntarse como sustento al Informe Final firmado por
la Comisión de Inventario, según lo dispuesto por la normativa vigente.

_______________________________          _______________________________
       Director(a) de la IE                  Responsable de Control Patrimonial
`;
  downloadFile('acta_resumen_inventario.txt', txt, 'text/plain;charset=utf-8;');
}
function actaPrintableHTML(){
  const cfg = DB.get(KEYS.config); const items = DB.get(KEYS.items); const aulas = DB.get(KEYS.aulas);
  const valorTotal = items.reduce((a,i)=>a+(Number(i.valorAdquisicion)||0),0);
  return `<div class="ficha" id="fichaActa" style="margin-top:16px;">
    <div class="ficha-header"><div class="logo-slot">${logoDeConfig(cfg)?`<img src="${logoDeConfig(cfg)}">`:''}</div>
      <div class="meta-center"><h3>Acta de Conciliación Patrimonio-Contable</h3><div>${esc(cfg.nombreIE)} — Año ${esc(cfg.anioFiscal)}</div></div></div>
    <table><tr><td><b>Código modular:</b> ${esc(cfg.codigoModular||'—')}</td><td><b>UGEL:</b> ${esc(cfg.ugel||'—')}</td><td><b>DRE:</b> ${esc(cfg.dre||'—')}</td></tr>
    <tr><td><b>Director(a):</b> ${esc(cfg.director||'—')}</td><td colspan="2"><b>Responsable de Control Patrimonial:</b> ${esc(cfg.responsablePatrimonio||'—')}</td></tr></table>
    <table><thead><tr><th>Aula / ambiente</th><th>N° de bienes</th><th>Valor total (S/)</th></tr></thead>
    <tbody>${aulas.map(a=>{ const its=items.filter(i=>i.aulaId===a.id); return `<tr><td>${esc(a.aulaLabel||a.nombre)}</td><td>${its.length}</td><td>${its.reduce((s,i)=>s+(Number(i.valorAdquisicion)||0),0).toFixed(2)}</td></tr>`; }).join('')}
    <tr><td><b>TOTAL</b></td><td><b>${items.length}</b></td><td><b>${valorTotal.toFixed(2)}</b></td></tr></tbody></table>
    <div class="firma"><div>Director(a) de la IE</div><div>Responsable de Control Patrimonial</div></div>
  </div>`;
}

/* ---------------------------------------------------------------------
   20-B. EXPORTACIÓN SBN / SIGA-PATRIMONIO E INFORME EJECUTIVO ANUAL
   --------------------------------------------------------------------- */
// Arma cada fila con columnas equivalentes a las que usan los sistemas del
// Estado para el control patrimonial (SINABIP/SIGA-Patrimonio): no es una
// integración directa (no sube datos a ningún sistema externo), sino un
// archivo con la misma estructura de columnas, por si en algún momento hay
// que trasladar la información a otro sistema.
function filasFormatoSBN(){
  const cfg = DB.get(KEYS.config);
  const cat = catalogoPorCodigoMap();
  const items = [...DB.get(KEYS.items)].filter(i=>i.situacion!=='De baja').sort((a,b)=>(a.codigoInterno||'').localeCompare(b.codigoInterno||''));
  return items.map(it=>{
    const c = cat.get(it.codigoSBN) || {};
    return {
      entidad: cfg.entidadCodigoSIGA || '01',
      codigoPatrimonial: it.codigoInterno || '',
      codigoSBN: it.codigoSBN || '',
      grupoGenerico: c.grupo || '',
      clase: c.clase || '',
      denominacion: it.denominacion || '',
      marca: it.marca || '', modelo: it.modelo || '', serie: it.numeroSerie || '', color: it.color || '',
      estado: ESTADO_ABREV[it.estadoConservacion] || '',
      ubicacion: it.aulaNombre || '', custodio: it.custodioNombre || '',
      valorAdquisicion: it.valorAdquisicion!=null ? Number(it.valorAdquisicion).toFixed(2) : '',
      fechaAdquisicion: it.fechaRegistro || '', situacion: it.situacion || ''
    };
  });
}
function exportFormatoSBNCSV(){
  const rows = filasFormatoSBN();
  if(rows.length===0){ toast('No hay bienes activos para exportar.','err'); return; }
  const headers = [
    {key:'entidad',label:'Cód. Entidad (SIGA)'},{key:'codigoPatrimonial',label:'Código Patrimonial'},{key:'codigoSBN',label:'Código SBN'},
    {key:'grupoGenerico',label:'Grupo Genérico SBN'},{key:'clase',label:'Clase'},{key:'denominacion',label:'Denominación'},
    {key:'marca',label:'Marca'},{key:'modelo',label:'Modelo'},{key:'serie',label:'N° Serie'},{key:'color',label:'Color'},
    {key:'estado',label:'Estado (MB/B/R/M)'},{key:'ubicacion',label:'Ubicación'},{key:'custodio',label:'Custodio'},
    {key:'valorAdquisicion',label:'Valor de Adquisición (S/.)'},{key:'fechaAdquisicion',label:'Fecha de Adquisición'},{key:'situacion',label:'Situación'}
  ];
  downloadFile('sigie_formato_sbn_siga_'+today()+'.csv', '\uFEFF'+toCSV(rows,headers), 'text/csv;charset=utf-8;');
}
// Informe de una sola vista, pensado para el Director o para sustentar ante
// la UGEL: KPIs patrimoniales, depreciación, mantenimientos, préstamos,
// verificación SBN y (si hay inventarios guardados) la evolución interanual.
// Se genera con la misma ventana de impresión (PDF) que usa el resto del
// sistema, sin librerías adicionales.
function imprimirInformeEjecutivoAnual(){
  const cfg = DB.get(KEYS.config);
  const items = DB.get(KEYS.items).filter(i=>i.situacion!=='De baja');
  const todos = DB.get(KEYS.items);
  const valorTotal = items.reduce((a,i)=>a+(Number(i.valorAdquisicion)||0),0);
  const vnlTotal = items.reduce((a,i)=>{ const c=calcularDepreciacionItem(i); return a+(c?c.valorNetoLibros:(Number(i.valorAdquisicion)||0)); },0);
  const depTotal = valorTotal - vnlTotal;
  const totalmenteDeprec = items.filter(i=>{ const c=calcularDepreciacionItem(i); return c && c.totalmenteDepreciado; }).length;
  const porEstado = ESTADOS_CONSERVACION.map(e=>({estado:e, n:items.filter(i=>i.estadoConservacion===e).length}));
  const conteoDenom = {}; items.forEach(i=>{ conteoDenom[i.denominacion]=(conteoDenom[i.denominacion]||0)+1; });
  const topCategorias = Object.entries(conteoDenom).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const mant = DB.get(KEYS.mantenimientos);
  const anioFiscal = String(cfg.anioFiscal);
  const mantDelAnio = mant.filter(m=>(m.fechaReporte||'').slice(0,4)===anioFiscal);
  const costoMantAnio = mantDelAnio.reduce((a,m)=>a+(Number(m.costo)||0),0);
  const mantAbiertosAlta = mant.filter(m=>m.estado!=='Resuelto' && m.prioridad==='Alta').length;
  const prestamosVencidos = DB.get(KEYS.prestamos).filter(p=>p.estado==='Prestado' && p.fechaDevolucionProgramada && p.fechaDevolucionProgramada<today()).length;
  const discrepanciasSBN = contarDiscrepanciasSBN();
  const snaps = [...DB.get(KEYS.snapshots)].sort((a,b)=>String(a.anio).localeCompare(String(b.anio)));
  const bajas = todos.filter(i=>i.situacion==='De baja').length;
  const body = `
  <div class="ficha">
    <div class="ficha-header"><div class="logo-slot">${logoDeConfig(cfg)?`<img src="${logoDeConfig(cfg)}">`:''}</div>
      <div class="meta-center"><h2>Informe Ejecutivo Anual — Gestión Patrimonial</h2>
      <div>${esc(cfg.nombreIE||'—')} — UGEL ${esc(cfg.ugel||'—')} — Año fiscal ${esc(cfg.anioFiscal)}</div></div></div>
    <table class="meta-table" style="margin:0 auto 12px;"><tr>
      <td><b>Director(a):</b> ${esc(cfg.director||'—')}</td><td style="padding-left:24px;"><b>Responsable de Control Patrimonial:</b> ${esc(cfg.responsablePatrimonio||'—')}</td>
    </tr><tr><td colspan="2"><b>Fecha de emisión:</b> ${new Date().toLocaleDateString('es-PE')}</td></tr></table>

    <h3>1. Resumen patrimonial</h3>
    <table ><tbody>
      <tr><td><b>Total de bienes activos</b></td><td>${items.length}</td><td><b>Bienes dados de baja</b></td><td>${bajas}</td></tr>
      <tr><td><b>Valor de adquisición total</b></td><td>${money(valorTotal)}</td><td><b>Valor neto en libros (NICSP)</b></td><td>${money(vnlTotal)}</td></tr>
      <tr><td><b>Depreciación acumulada</b></td><td>${money(depTotal)}</td><td><b>Bienes totalmente depreciados</b></td><td>${totalmenteDeprec}</td></tr>
    </tbody></table>

    <h3>2. Distribución por estado de conservación</h3>
    <table ><thead><tr><th>Estado</th><th>Cantidad</th><th>% del total</th></tr></thead>
    <tbody>${porEstado.map(e=>`<tr><td>${esc(e.estado)}</td><td>${e.n}</td><td>${items.length?Math.round(e.n/items.length*100):0}%</td></tr>`).join('')}</tbody></table>

    <h3>3. Categorías de bienes más numerosas</h3>
    <table ><thead><tr><th>#</th><th>Denominación</th><th>Cantidad</th></tr></thead>
    <tbody>${topCategorias.map(([d,n],idx)=>`<tr><td>${idx+1}</td><td>${esc(d)}</td><td>${n}</td></tr>`).join('') || '<tr><td colspan="3">Sin datos.</td></tr>'}</tbody></table>

    <h3>4. Mantenimientos, préstamos y verificación</h3>
    <table ><tbody>
      <tr><td><b>Costo total de mantenimientos/incidencias en ${esc(anioFiscal)}</b></td><td>${money(costoMantAnio)}</td></tr>
      <tr><td><b>Incidencias de prioridad Alta sin resolver</b></td><td>${mantAbiertosAlta}</td></tr>
      <tr><td><b>Préstamos de bienes vencidos (sin devolver)</b></td><td>${prestamosVencidos}</td></tr>
      <tr><td><b>Bienes con denominación pendiente de verificar contra el Catálogo SBN</b></td><td>${discrepanciasSBN}</td></tr>
    </tbody></table>

    ${snaps.length>0?`<h3>5. Evolución interanual (inventarios guardados)</h3>
    <table ><thead><tr><th>Año / etiqueta</th><th>Fecha guardado</th><th>N° de bienes</th><th>Valor total (S/.)</th></tr></thead>
    <tbody>${snaps.map(s=>`<tr><td>${esc(s.anio)}</td><td>${esc(s.fecha)}</td><td>${s.items.length}</td><td>${s.items.reduce((a,i)=>a+(Number(i.valorAdquisicion)||0),0).toFixed(2)}</td></tr>`).join('')}
    <tr><td><b>${esc(anioFiscal)} (actual)</b></td><td>${new Date().toLocaleDateString('es-PE')}</td><td><b>${items.length}</b></td><td><b>${valorTotal.toFixed(2)}</b></td></tr></tbody></table>
    <p style="font-size:10.5px;color:#555;">Para el detalle bien por bien de qué cambió entre dos inventarios guardados, usa el módulo "Comparativo interanual por aula".</p>`
    :'<h3>5. Evolución interanual</h3><p style="font-size:11.5px;">Aún no se ha guardado ningún inventario de años anteriores. Usa el botón "Guardar inventario de este año" en el módulo "Comparativo interanual por aula" para poder mostrar aquí la evolución año a año.</p>'}

    <p style="font-size:10px;color:#555;margin-top:14px;">Informe generado automáticamente por SIGIE a partir de los datos registrados en el sistema a la fecha de emisión. Las cifras de depreciación son referenciales (línea recta, NICSP, sin valor residual); verifíquelas contra la directiva contable vigente antes de usarlas en estados financieros oficiales.</p>
    <div class="firma"><div>Director(a) de la IE</div><div>Responsable de Control Patrimonial</div></div>
  </div>`;
  abrirVentanaImpresion('Informe Ejecutivo Anual', body);
}

/* ---------------------------------------------------------------------
   21. CONFIGURACIÓN DE LA IE (solo admin)
   --------------------------------------------------------------------- */
function renderConfig(){
  const cfg = DB.get(KEYS.config);
  return `<div class="card"><div class="card-b">
    <fieldset><legend>Identidad institucional</legend>
      <div class="grid g2"><div class="field"><label>Nombre de la I.E. *</label><input id="cfg_nombreIE" value="${esc(cfg.nombreIE)}"></div>
      <div class="field"><label>Siglas (para avatar sin logo)</label><input id="cfg_siglas" maxlength="4" value="${esc(cfg.siglas)}"></div></div>
      <div class="grid g3"><div class="field"><label>Código modular</label><input id="cfg_codigoModular" value="${esc(cfg.codigoModular)}"></div>
      <div class="field"><label>Código de local escolar</label><input id="cfg_codigoLocal" value="${esc(cfg.codigoLocal)}"></div>
      <div class="field"><label>Año fiscal / lectivo *</label><input id="cfg_anioFiscal" type="number" value="${esc(cfg.anioFiscal)}"></div></div>
      <div class="grid g2"><div class="field"><label>UGEL</label><input id="cfg_ugel" value="${esc(cfg.ugel)}"></div>
      <div class="field"><label>DRE</label><input id="cfg_dre" value="${esc(cfg.dre)}"></div></div>
      <div class="grid g2"><div class="field"><label>Director(a)</label><input id="cfg_director" value="${esc(cfg.director)}"></div>
      <div class="field"><label>Responsable de Control Patrimonial</label><input id="cfg_responsablePatrimonio" value="${esc(cfg.responsablePatrimonio)}"></div></div>
      <div class="grid g2"><div class="field"><label>Nivel(es) de la IE</label><input id="cfg_nivelIE" value="${esc(cfg.nivelIE)}" placeholder="Ej. PRIMARIA - SECUNDARIA"></div>
      <div class="field"><label>Personal inventariador (quien hace el conteo físico)</label><input id="cfg_personalInventariador" value="${esc(cfg.personalInventariador)}"></div></div>
      <div class="field"><label>Código de entidad para correlativo interno (2 díg.)</label><input id="cfg_entidadCodigoSIGA" maxlength="2" value="${esc(cfg.entidadCodigoSIGA)}">
        <div class="hint">Se usa solo para construir el código interno provisional. No es el código oficial SIGA.</div></div>
      <div class="field"><label>Logo institucional</label><div class="imgpick"><div class="prev" id="logoPrev">${logoDeConfig(cfg)?`<img src="${logoDeConfig(cfg)}">`:'Sin logo'}</div><input type="file" id="cfg_logo" accept="image/*"></div></div>
    </fieldset>
    <fieldset><legend>Notificaciones por correo</legend>
      <div class="field"><label>Correo(s) para el resumen semanal de alertas</label><input id="cfg_emailNotificaciones" value="${esc(cfg.emailNotificaciones)}" placeholder="patrimonio@colegio.edu.pe, director@colegio.edu.pe">
        <div class="hint">Separa varios correos con coma. Se usan para prellenar el botón "Enviar resumen por correo" en Reportes (abre tu programa de correo habitual; el sistema no envía nada por sí solo, ya que corre en esta misma computadora).</div>
      </div>
    </fieldset>
    <button class="btn btn-primary" id="cfg_save">Guardar datos de la institución</button>
  </div></div>
  <div class="note-banner" style="margin-top:16px;"><strong>Sobre el código patrimonial:</strong> el código oficial de 12 dígitos es asignado por el módulo Patrimonio del SIGA al momento del registro oficial del bien. Este sistema genera un <em>código interno provisional</em> mientras se realiza el registro definitivo en SIGA/SINABIP.</div>
  <div class="note-banner" style="${STORAGE_MODE==='local'?'':'background:var(--good-soft);border-color:#bfe0cd;color:var(--good);'}margin-top:12px;">
    <strong>Sobre el almacenamiento de datos:</strong> ${
      STORAGE_MODE==='servidor'
      ? '💽 el sistema está corriendo con el <b>servidor local</b> (server.js) y guardando todo en el archivo <code>data/sigie-datos.json</code>, dentro de esta misma carpeta del proyecto. Si copias TODA la carpeta (incluida la subcarpeta "data") a otra computadora e inicias el servidor ahí, el inventario completo viaja con ella. También se guardan copias de seguridad automáticas diarias en <code>data/backups/</code>.'
      : STORAGE_MODE==='firebase'
      ? '🔥 conectado correctamente a <b>Firebase</b> (proyecto "'+esc(FIREBASE_CONFIG.projectId)+'"). Todo lo que registres se guarda en la nube y estará disponible en tiempo real desde cualquier computadora o celular que abra este mismo archivo, sin importar dónde esté publicado.'
      : STORAGE_MODE==='claude'
      ? 'ahora mismo el sistema está guardando todo en tu almacenamiento persistente de Claude (no logró conectarse a Firebase desde aquí, algo normal dentro de la vista previa de Claude por restricciones de red del sandbox). Cuando publiques este archivo en un hosting real (GitHub Pages u otro), ábrelo y debería conectarse solo a Firebase.'
      : 'el sistema está guardando todo en el navegador de este equipo (localStorage) como respaldo, porque no encontró el servidor local ni Firebase. Para que los datos queden en un archivo dentro de la carpeta del proyecto (y viajen si la copias a otra PC), inicia el sistema con el servidor local (server.js / el instalador de Windows) en vez de abrir el .html directamente con doble clic. Mientras tanto, usa seguido el botón <b>"Descargar respaldo (.json)"</b> en Reportes.'
    }
  </div>`;
}

/* ---------------------------------------------------------------------
   22. WIRING DE EVENTOS DE CONTENIDO
   --------------------------------------------------------------------- */
function wireContentEvents(){
  const c = document.getElementById('content'); if(!c) return;

  if(STATE.view==='comparativo'){
    c.querySelector('#cmp_snapA')?.addEventListener('change', e=>{ STATE.comparativo.snapA=e.target.value; renderContent(); });
    c.querySelector('#cmp_snapB')?.addEventListener('change', e=>{ STATE.comparativo.snapB=e.target.value; renderContent(); });
    c.querySelector('#cmp_aulaA')?.addEventListener('change', e=>{ STATE.comparativo.aulaA=e.target.value; renderContent(); });
    c.querySelector('#cmp_aulaB')?.addEventListener('change', e=>{ STATE.comparativo.aulaB=e.target.value; renderContent(); });
    c.querySelector('#cmp_exportar')?.addEventListener('click', imprimirComparativoInteranual);
  }
  if(STATE.view==='dashboard'){
    c.querySelectorAll('[data-goitem]').forEach(el=>el.addEventListener('click', ()=>openItemView(el.dataset.goitem)));
    c.querySelectorAll('[data-goprestamos]').forEach(el=>el.addEventListener('click', ()=>{ STATE.view='prestamos'; render(); }));
    c.querySelectorAll('[data-gomant]').forEach(el=>el.addEventListener('click', ()=>{ STATE.view='mantenimientos'; render(); }));
    c.querySelectorAll('[data-goalmacen]').forEach(el=>el.addEventListener('click', ()=>{ STATE.view='items'; STATE.filters={q:'',aula:'__ALMACEN__',estado:'',situacion:'',deprec:''}; render(); }));
    c.querySelectorAll('[data-goreq]').forEach(el=>el.addEventListener('click', ()=>{ STATE.view='requerimientos'; STATE.filtersReq={q:'',estado:'Solicitado'}; render(); }));
    c.querySelectorAll('[data-gosanear]').forEach(el=>el.addEventListener('click', ()=>{ STATE.view='items'; STATE.filters={q:'',aula:'',estado:'',situacion:'Por sanear',deprec:''}; render(); }));
    c.querySelectorAll('[data-goresumen]').forEach(el=>el.addEventListener('click', ()=>{ STATE.view='reportes'; render(); }));
  }
  if(STATE.view==='plano'){
    c.querySelector('#pln_select')?.addEventListener('change', e=>{ STATE.planoActivoId=e.target.value; STATE.planoModoEdicion=false; STATE.planoMoviendoId=''; renderContent(); });
    c.querySelector('#pln_nuevo')?.addEventListener('click', ()=>abrirModalPlano(null));
    c.querySelector('#pln_editarplano')?.addEventListener('click', ()=>abrirModalPlano(STATE.planoActivoId));
    c.querySelector('#pln_eliminarplano')?.addEventListener('click', ()=>eliminarPlano(STATE.planoActivoId));
    c.querySelector('#pln_modoedicion')?.addEventListener('click', ()=>{ STATE.planoModoEdicion=!STATE.planoModoEdicion; STATE.planoMoviendoId=''; renderContent(); });
    const lienzo = c.querySelector('#pln_lienzo');
    if(lienzo){
      lienzo.querySelectorAll('[data-pin]').forEach(pin=>{
        pin.addEventListener('click', e=>{
          e.stopPropagation();
          const id = pin.dataset.pin;
          if(isAdmin() && STATE.planoModoEdicion && !STATE.planoMoviendoId){ abrirOpcionesMarcador(id); }
          else if(!STATE.planoMoviendoId){ irAAulaDesdeMarcador(id); }
        });
      });
      lienzo.addEventListener('click', e=>{
        if(!isAdmin() || !STATE.planoModoEdicion) return;
        if(e.target.closest('[data-pin]')) return;
        const rect = lienzo.getBoundingClientRect();
        const x = ((e.clientX-rect.left)/rect.width*100).toFixed(2);
        const y = ((e.clientY-rect.top)/rect.height*100).toFixed(2);
        if(STATE.planoMoviendoId){ moverMarcador(STATE.planoMoviendoId, x, y); }
        else{ abrirModalNuevoMarcador(x, y); }
      });
    }
  }
  if(STATE.view==='items'){
    c.querySelector('#fq').addEventListener('input', e=>{
      STATE.filters.q=e.target.value;
      const cursor=e.target.selectionStart;
      renderContent();
      const nuevo=document.querySelector('#fq');
      if(nuevo){ nuevo.focus(); nuevo.setSelectionRange(cursor,cursor); }
    });
    c.querySelector('#faula').addEventListener('change', e=>{ STATE.filters.aula=e.target.value; renderContent(); });
    c.querySelector('#festado').addEventListener('change', e=>{ STATE.filters.estado=e.target.value; renderContent(); });
    c.querySelector('#fdeprec')?.addEventListener('change', e=>{ STATE.filters.deprec=e.target.value; renderContent(); });
    c.querySelector('#fclear')?.addEventListener('click', ()=>{ STATE.filters={q:'',aula:'',estado:'',situacion:'',deprec:''}; renderContent(); });
    c.querySelector('#fsituacion')?.addEventListener('change', e=>{ STATE.filters.situacion=e.target.value; renderContent(); });
    c.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>openItemView(b.dataset.view)));
    c.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>openItemModal(b.dataset.edit)));
  }
  if(STATE.view==='aulas'){
    c.querySelectorAll('[data-editaula]').forEach(b=>b.addEventListener('click',()=>openAulaModal(b.dataset.editaula)));
    c.querySelectorAll('[data-delaula]').forEach(b=>b.addEventListener('click', async ()=>{
      if(!confirm('¿Eliminar esta aula? Los bienes asignados quedarán sin aula.')) return;
      await DB.save(KEYS.aulas, DB.get(KEYS.aulas).filter(x=>x.id!==b.dataset.delaula));
      toast('Aula eliminada.','ok'); renderContent();
    }));
  }
  if(STATE.view==='custodios'){
    c.querySelectorAll('[data-editcust]').forEach(b=>b.addEventListener('click',()=>openCustodioModal(b.dataset.editcust)));
    c.querySelectorAll('[data-delcust]').forEach(b=>b.addEventListener('click', async ()=>{
      if(!confirm('¿Eliminar este responsable?')) return;
      await DB.save(KEYS.custodios, DB.get(KEYS.custodios).filter(x=>x.id!==b.dataset.delcust));
      toast('Responsable eliminado.','ok'); renderContent();
    }));
  }
  if(STATE.view==='catalogo'){
    c.querySelector('#fcatq')?.addEventListener('input', e=>{ STATE.filtersCat.q=e.target.value; actualizarTablaCatalogo(); });
    c.querySelector('#fcatgrupo')?.addEventListener('change', e=>{ STATE.filtersCat.grupo=e.target.value; renderContent(); });
    c.querySelector('#fcatclear')?.addEventListener('click', ()=>{ STATE.filtersCat={q:'',grupo:''}; renderContent(); });
    c.querySelector('#btnExportarCatalogo')?.addEventListener('click', exportarCatalogoCSV);
    c.querySelector('#btnImportarCatalogo')?.addEventListener('click', openImportarCatalogoModal);
    wireBotonesCatalogo();
  }
  if(STATE.view==='verifSBN'){
    c.querySelector('#fcatq')?.addEventListener('input', e=>{ STATE.filtersCat.q=e.target.value; actualizarTablaVerifCat(); });
    c.querySelector('#fverifaula')?.addEventListener('change', e=>{ STATE.filtersVerif.aula=e.target.value; renderContent(); });
    c.querySelector('#fverifestado')?.addEventListener('change', e=>{ STATE.filtersVerif.estado=e.target.value; renderContent(); });
    c.querySelector('#fverifclear')?.addEventListener('click', ()=>{ STATE.filtersCat={q:'',grupo:''}; STATE.filtersVerif={q:'',aula:'',estado:''}; renderContent(); });
    c.querySelectorAll('[data-verifporcod]').forEach(row=>row.addEventListener('click', ()=>{
      // Filtrar el bloque derecho por el código SBN de la fila del catálogo
      // que se acaba de tocar: como el inventario no se filtra por código
      // directamente, buscamos su denominación oficial y la usamos como texto
      // de búsqueda (coincide con el campo "Denominación registrada" cuando
      // el bien ya está bien puesto, y de todas formas ayuda a ubicarlo).
      const codigo = row.dataset.verifporcod;
      const cat = DB.get(KEYS.catalogo); const hit = cat.find(x=>x.codigoSBN===codigo);
      STATE.filtersVerif.q = codigo;
      renderContent();
      toast(hit?('Filtrando inventario por código '+codigo+' ('+hit.denominacion+').'):('Filtrando inventario por código '+codigo+'.'), 'ok');
    }));
    c.querySelectorAll('[data-fixverif]').forEach(b=>b.addEventListener('click', ()=>fixVerifItem(b.dataset.fixverif)));
    c.querySelectorAll('[data-sugverif]').forEach(b=>b.addEventListener('click', ()=>asignarCodigoSugeridoVerif(b.dataset.sugverif, b.dataset.sugcodigo)));
    c.querySelectorAll('[data-goitem]').forEach(b=>b.addEventListener('click', ()=>openItemView(b.dataset.goitem)));
    c.querySelector('#btnActualizarVisiblesSBN')?.addEventListener('click', actualizarVisiblesSBN);
  }
  if(STATE.view==='cargos'){
    c.querySelectorAll('[data-editcargo]').forEach(b=>b.addEventListener('click',()=>openCargoModal(parseInt(b.dataset.editcargo))));
    c.querySelectorAll('[data-delcargo]').forEach(b=>b.addEventListener('click', async ()=>{
      const idx=parseInt(b.dataset.delcargo);
      const cargos=DB.get(KEYS.cargos); const nombre=cargos[idx];
      const enUso = DB.get(KEYS.custodios).filter(x=>x.cargo===nombre).length;
      if(enUso>0 && !confirm(`${enUso} persona(s) tienen asignado el cargo "${nombre}". Si lo eliminas, seguirán mostrando ese texto pero ya no aparecerá en el combo. ¿Eliminar de todos modos?`)) return;
      if(enUso===0 && !confirm('¿Eliminar este cargo?')) return;
      const list=[...cargos]; list.splice(idx,1);
      await DB.save(KEYS.cargos, list); toast('Cargo eliminado.','ok'); renderContent();
    }));
  }
  if(STATE.view==='comision'){
    c.querySelectorAll('[data-editcomision]').forEach(b=>b.addEventListener('click',()=>openComisionModal(parseInt(b.dataset.editcomision))));
    c.querySelectorAll('[data-toggleactivocomision]').forEach(b=>b.addEventListener('change', async ()=>{
      const idx=parseInt(b.dataset.toggleactivocomision);
      const list=[...DB.get(KEYS.comision)]; list[idx]={...list[idx], activo:b.checked};
      await DB.save(KEYS.comision, list); toast(b.checked?'Integrante marcado como activo.':'Integrante marcado como inactivo.','ok');
    }));
    c.querySelectorAll('[data-delcomision]').forEach(b=>b.addEventListener('click', async ()=>{
      const idx=parseInt(b.dataset.delcomision);
      if(!confirm('¿Eliminar este integrante del catálogo de Comisión de Inventario? Las actas ya generadas no se ven afectadas.')) return;
      const list=[...DB.get(KEYS.comision)]; list.splice(idx,1);
      await DB.save(KEYS.comision, list); toast('Integrante eliminado.','ok'); renderContent();
    }));
  }
  if(STATE.view==='verificaracta'){
    c.querySelector('#va_verificar')?.addEventListener('click', ()=>{
      const codigo = c.querySelector('#va_codigo').value;
      if(!codigo.trim()){ toast('Pega o escribe el código de verificación.', 'err'); return; }
      pintarResultadoVerificacion(buscarActaFirmadaPorCodigo(codigo));
    });
    c.querySelector('#va_escanear')?.addEventListener('click', abrirEscanerVerificacionActa);
  }
  if(STATE.view==='almacen'){
    c.querySelector('#cfq')?.addEventListener('input', e=>{ STATE.filtersConsumible.q=e.target.value; renderContent(); });
    c.querySelector('#cfcategoria')?.addEventListener('change', e=>{ STATE.filtersConsumible.categoria=e.target.value; renderContent(); });
    c.querySelector('#cfbajos')?.addEventListener('change', e=>{ STATE.filtersConsumible.soloBajos=e.target.checked; renderContent(); });
    c.querySelector('#cfclear')?.addEventListener('click', ()=>{ STATE.filtersConsumible={q:'',categoria:'',soloBajos:false}; renderContent(); });
    c.querySelectorAll('[data-entradacons]').forEach(b=>b.addEventListener('click', ()=>abrirModalMovimientoConsumible(b.dataset.entradacons, 'Entrada')));
    c.querySelectorAll('[data-salidacons]').forEach(b=>b.addEventListener('click', ()=>abrirModalMovimientoConsumible(b.dataset.salidacons, 'Salida')));
    c.querySelectorAll('[data-kardexcons]').forEach(b=>b.addEventListener('click', ()=>abrirKardexConsumible(b.dataset.kardexcons)));
    c.querySelectorAll('[data-editcons]').forEach(b=>b.addEventListener('click', ()=>abrirModalConsumible(b.dataset.editcons)));
    c.querySelectorAll('[data-delcons]').forEach(b=>b.addEventListener('click', ()=>eliminarConsumible(b.dataset.delcons)));
  }
  if(STATE.view==='presupuesto'){
    c.querySelector('#pf_anio')?.addEventListener('change', e=>{ STATE.presupuestoAnio=e.target.value; renderContent(); });
    c.querySelectorAll('[data-editpresu]').forEach(b=>b.addEventListener('click', ()=>{
      const cfg = DB.get(KEYS.config);
      abrirModalPresupuesto(STATE.presupuestoAnio||cfg.anioFiscal, b.dataset.editpresu);
    }));
  }
  if(STATE.view==='categoriasDeprec'){
    c.querySelectorAll('[data-editcatdep]').forEach(b=>b.addEventListener('click',()=>openCategoriaDeprecModal(parseInt(b.dataset.editcatdep))));
    c.querySelectorAll('[data-delcatdep]').forEach(b=>b.addEventListener('click', async ()=>{
      const idx=parseInt(b.dataset.delcatdep);
      const cats=DB.get(KEYS.categoriasDeprec); const cat=cats[idx];
      const enUso = DB.get(KEYS.items).filter(x=>x.categoriaDeprecId===cat.id).length;
      if(enUso>0 && !confirm(`${enUso} bien(es) tienen asignada la categoría "${cat.nombre}". Si la eliminas, dejarán de depreciarse hasta que les asignes otra categoría. ¿Eliminar de todos modos?`)) return;
      if(enUso===0 && !confirm('¿Eliminar esta categoría?')) return;
      const list=[...cats]; list.splice(idx,1);
      await DB.save(KEYS.categoriasDeprec, list); toast('Categoría eliminada.','ok'); renderContent();
    }));
  }
  if(STATE.view==='qrlab'){
    c.querySelector('#qr_tipo').addEventListener('change', e=>{ STATE.qrTipoEtiqueta = e.target.value; renderQrPreview(); });
    c.querySelectorAll('.qrchk').forEach(chk=>chk.addEventListener('change', e=>{
      if(e.target.checked) STATE.qrSelection.add(e.target.dataset.id); else STATE.qrSelection.delete(e.target.dataset.id);
      renderQrPreview();
    }));
    function filtrarQrTabla(){
      const aulaVal = c.querySelector('#qr_aula').value;
      const q = c.querySelector('#qr_buscar').value.trim().toLowerCase();
      c.querySelectorAll('#qr_bienes_tbody tr[data-search]').forEach(tr=>{
        const aulaOK = !aulaVal || tr.dataset.aula===aulaVal;
        const textOK = !q || tr.dataset.search.includes(q);
        tr.style.display = (aulaOK && textOK) ? '' : 'none';
      });
    }
    c.querySelector('#qr_selectall').addEventListener('click', ()=>{
      c.querySelectorAll('#qr_bienes_tbody tr[data-search]').forEach(tr=>{
        if(tr.style.display!=='none'){ const chk=tr.querySelector('.qrchk'); chk.checked=true; STATE.qrSelection.add(chk.dataset.id); }
      });
      renderQrPreview();
    });
    c.querySelector('#qr_clear').addEventListener('click', ()=>{ STATE.qrSelection.clear(); c.querySelectorAll('.qrchk').forEach(x=>x.checked=false); renderQrPreview(); });
    c.querySelector('#qr_aula').addEventListener('change', filtrarQrTabla);
    c.querySelector('#qr_buscar').addEventListener('input', filtrarQrTabla);
    c.querySelector('#qr_print').addEventListener('click', ()=>{
      if(STATE.qrSelection.size===0){ toast('Selecciona al menos un bien.','err'); return; }
      const imgs = [...document.querySelectorAll('#labelSheet img')].map(img=>img.src);
      if(imgs.length===0){ toast('Espera a que se generen las etiquetas.','err'); return; }
      // Se arma cada hoja a mano con un máximo fijo de 8 filas x 3 columnas
      // (24 etiquetas) en vez de dejar que el navegador decida dónde cortar:
      // así cada hoja impresa sale siempre completa, sin filas a medias.
      const COLS = 3, ROWS_POR_HOJA = 8, POR_HOJA = COLS*ROWS_POR_HOJA;
      const hojas = [];
      for(let i=0;i<imgs.length;i+=POR_HOJA) hojas.push(imgs.slice(i,i+POR_HOJA));
      const body = hojas.map(grupo=>
        `<div class="doc-page"><div class="qrsheet">${grupo.map(src=>`<img src="${src}">`).join('')}</div></div>`
      ).join('');
      abrirVentanaImpresion(STATE.qrTipoEtiqueta==='barcode' ? 'Etiquetas con código de barras de bienes patrimoniales' : 'Etiquetas QR de bienes patrimoniales', body);
    });
  }
  if(STATE.view==='prestamos'){
    c.querySelectorAll('[data-devolver]').forEach(b=>b.addEventListener('click',()=>openDevolucionModal(b.dataset.devolver)));
    c.querySelectorAll('[data-actaprestamo]').forEach(b=>b.addEventListener('click',()=>imprimirActaPrestamo(b.dataset.actaprestamo)));
    c.querySelectorAll('[data-cancelarprestamo]').forEach(b=>b.addEventListener('click', async ()=>{
      if(!confirm('¿Cancelar este préstamo? Los bienes quedarán disponibles nuevamente y se anotará en su kardex.')) return;
      const id = b.dataset.cancelarprestamo;
      const p = DB.get(KEYS.prestamos).find(x=>x.id===id); if(!p) return;
      await DB.save(KEYS.prestamos, DB.get(KEYS.prestamos).filter(x=>x.id!==id));
      const items = DB.get(KEYS.items);
      for(const bid of p.bienesIds){ const it=items.find(x=>x.id===bid); if(it) await addMovimiento(bid, it.codigoInterno, 'Observación', 'Préstamo '+p.numero+' cancelado por '+currentUser().usuario+'.'); }
      toast('Préstamo cancelado.','ok'); renderContent();
    }));
  }
  if(STATE.view==='tomas'){
    if(STATE.tomaEnCurso){
      c.querySelectorAll('.tk_enc').forEach(chk=>chk.addEventListener('change', e=>{
        const idx=+e.target.dataset.idx; STATE.tomaEnCurso.registros[idx].encontrado = e.target.checked;
        renderContent();
      }));
      c.querySelectorAll('.tk_estado').forEach(sel=>sel.addEventListener('change', e=>{
        const idx=+e.target.dataset.idx; STATE.tomaEnCurso.registros[idx].estadoEncontrado = e.target.value;
      }));
      c.querySelectorAll('.tk_obs').forEach(inp=>inp.addEventListener('input', e=>{
        const idx=+e.target.dataset.idx; STATE.tomaEnCurso.registros[idx].observacion = e.target.value;
      }));
      const btnTodos = c.querySelector('#tk_marcar_todos'); if(btnTodos) btnTodos.addEventListener('click', ()=>{ STATE.tomaEnCurso.registros.forEach(r=>r.encontrado=true); renderContent(); });
      const btnAgregarSanear = c.querySelector('#tk_ns_agregar'); if(btnAgregarSanear) btnAgregarSanear.addEventListener('click', abrirModalBienSinRegistrar);
      c.querySelectorAll('[data-delsanear]').forEach(b=>b.addEventListener('click', ()=>{
        STATE.tomaEnCurso.noRegistrados.splice(+b.dataset.delsanear, 1);
        renderContent();
      }));
      const btnCancelar = c.querySelector('#tk_cancelar'); if(btnCancelar) btnCancelar.addEventListener('click', ()=>{
        if(!confirm('¿Cancelar esta toma de inventario? Se perderán los datos marcados.')) return;
        STATE.tomaEnCurso=null; render();
      });
      const btnFinalizar = c.querySelector('#tk_finalizar'); if(btnFinalizar) btnFinalizar.addEventListener('click', finalizarToma);
    } else {
      c.querySelectorAll('[data-vertoma]').forEach(b=>b.addEventListener('click', ()=>verTomaDetalle(b.dataset.vertoma)));
    }
  }
  if(STATE.view==='mantenimientos'){
    c.querySelectorAll('[data-editmant]').forEach(b=>b.addEventListener('click',()=>openMantenimientoModal(b.dataset.editmant)));
    c.querySelector('#mfq')?.addEventListener('input', e=>{
      STATE.filtersMant.q=e.target.value;
      const cursor=e.target.selectionStart;
      renderContent();
      const nuevo=document.querySelector('#mfq');
      if(nuevo){ nuevo.focus(); nuevo.setSelectionRange(cursor,cursor); }
    });
    c.querySelector('#mfaula')?.addEventListener('change', e=>{ STATE.filtersMant.aula=e.target.value; renderContent(); });
    c.querySelector('#mftipo')?.addEventListener('change', e=>{ STATE.filtersMant.tipo=e.target.value; renderContent(); });
    c.querySelector('#mfprioridad')?.addEventListener('change', e=>{ STATE.filtersMant.prioridad=e.target.value; renderContent(); });
    c.querySelector('#mfestado')?.addEventListener('change', e=>{ STATE.filtersMant.estado=e.target.value; renderContent(); });
    c.querySelector('#mfclear')?.addEventListener('click', ()=>{ STATE.filtersMant={q:'',aula:'',tipo:'',prioridad:'',estado:''}; renderContent(); });
    c.querySelector('#btnMantVista')?.addEventListener('click', ()=>{ STATE.mantVista = STATE.mantVista==='calendario'?'lista':'calendario'; renderContent(); });
    c.querySelectorAll('[data-gomantid]').forEach(b=>b.addEventListener('click',()=>openMantenimientoModal(b.dataset.gomantid)));
  }
  if(STATE.view==='bitacora'){
    c.querySelector('#bfq')?.addEventListener('input', e=>{
      STATE.filtersBitacora.q=e.target.value;
      const cursor=e.target.selectionStart;
      renderContent();
      const nuevo=document.querySelector('#bfq');
      if(nuevo){ nuevo.focus(); nuevo.setSelectionRange(cursor,cursor); }
    });
    c.querySelector('#bfusuario')?.addEventListener('change', e=>{ STATE.filtersBitacora.usuario=e.target.value; renderContent(); });
    c.querySelector('#bfaccion')?.addEventListener('change', e=>{ STATE.filtersBitacora.accion=e.target.value; renderContent(); });
    c.querySelector('#bfdesde')?.addEventListener('change', e=>{ STATE.filtersBitacora.desde=e.target.value; renderContent(); });
    c.querySelector('#bfhasta')?.addEventListener('change', e=>{ STATE.filtersBitacora.hasta=e.target.value; renderContent(); });
    c.querySelector('#bfclear')?.addEventListener('click', ()=>{ STATE.filtersBitacora={q:'',usuario:'',accion:'',desde:'',hasta:''}; renderContent(); });
  }
  if(STATE.view==='polizas'){
    c.querySelectorAll('[data-editpoliza]').forEach(b=>b.addEventListener('click', ()=>openPolizaModal(b.dataset.editpoliza)));
    c.querySelectorAll('[data-delpoliza]').forEach(b=>b.addEventListener('click', async ()=>{
      if(!confirm('¿Eliminar esta póliza de seguro?')) return;
      const pz = (DB.get(KEYS.polizas)||[]).find(x=>x.id===b.dataset.delpoliza);
      await DB.save(KEYS.polizas, (DB.get(KEYS.polizas)||[]).filter(x=>x.id!==b.dataset.delpoliza));
      if(pz){ await registrarBitacora('Eliminar póliza de seguro', pz.aseguradora+(pz.numeroPoliza?(' — N° '+pz.numeroPoliza):'')); }
      toast('Póliza eliminada.','ok'); renderContent();
    }));
  }
  if(STATE.view==='conciliacion'){
    c.querySelectorAll('[data-verconc]').forEach(b=>b.addEventListener('click', ()=>verConciliacionDetalle(b.dataset.verconc)));
    c.querySelectorAll('[data-delconc]').forEach(b=>b.addEventListener('click', ()=>eliminarConciliacion(b.dataset.delconc)));
  }
  if(STATE.view==='requerimientos'){
    c.querySelectorAll('[data-verreq]').forEach(b=>b.addEventListener('click', ()=>verRequerimientoDetalle(b.dataset.verreq)));
    c.querySelector('#rfq')?.addEventListener('input', e=>{
      STATE.filtersReq.q=e.target.value;
      const cursor=e.target.selectionStart;
      renderContent();
      const nuevo=document.querySelector('#rfq');
      if(nuevo){ nuevo.focus(); nuevo.setSelectionRange(cursor,cursor); }
    });
    c.querySelector('#rfestado')?.addEventListener('change', e=>{ STATE.filtersReq.estado=e.target.value; renderContent(); });
    c.querySelector('#rfclear')?.addEventListener('click', ()=>{ STATE.filtersReq={q:'',estado:''}; renderContent(); });
  }
  if(STATE.view==='bajas'){
    c.querySelectorAll('[data-verbaja]').forEach(b=>b.addEventListener('click', ()=>verBajaDetalle(b.dataset.verbaja)));
    c.querySelector('#bfq')?.addEventListener('input', e=>{
      STATE.filtersBaja.q=e.target.value;
      const cursor=e.target.selectionStart;
      renderContent();
      const nuevo=document.querySelector('#bfq');
      if(nuevo){ nuevo.focus(); nuevo.setSelectionRange(cursor,cursor); }
    });
    c.querySelector('#bfestado')?.addEventListener('change', e=>{ STATE.filtersBaja.estado=e.target.value; renderContent(); });
    c.querySelector('#bfclear')?.addEventListener('click', ()=>{ STATE.filtersBaja={q:'',estado:''}; renderContent(); });
  }
  if(STATE.view==='masiva'){
    c.querySelector('#cm_abrir').addEventListener('click', abrirModalMasiva);
    c.querySelector('#cm_plantilla').addEventListener('click', ()=>{
      downloadFile('plantilla_carga_masiva.csv', '\uFEFFDenominacion,Marca,Modelo,NumeroSerie,Color,Estado(MB/B/R/M),CodigoSBN(opcional)\nCOMPUTADORA PERSONAL PORTATIL,HP,HP 340 G1,5CG4482Q8D,PLOMO,B,\nCARPETA UNIPERSONAL,,,,,MB,\n', 'text/csv;charset=utf-8;');
    });
  }
  if(STATE.view==='usuarios'){
    c.querySelectorAll('[data-edituser]').forEach(b=>b.addEventListener('click',()=>openUserModal(b.dataset.edituser)));
    c.querySelectorAll('[data-deluser]').forEach(b=>b.addEventListener('click', async ()=>{
      if(!confirm('¿Eliminar este usuario?')) return;
      const userEliminado = DB.get(KEYS.usuarios).find(x=>x.id===b.dataset.deluser);
      await DB.save(KEYS.usuarios, DB.get(KEYS.usuarios).filter(x=>x.id!==b.dataset.deluser));
      if(userEliminado){ await registrarBitacora('Eliminar usuario', 'Usuario: '+userEliminado.usuario); }
      toast('Usuario eliminado.','ok'); renderContent();
    }));
  }
  if(STATE.view==='papelera'){
    c.querySelectorAll('[data-restaurar]').forEach(b=>b.addEventListener('click', async ()=>{
      const id = b.dataset.restaurar; const pap = DB.get(KEYS.papelera); const bien = pap.find(x=>x.id===id);
      if(!bien) return;
      await DB.save(KEYS.papelera, pap.filter(x=>x.id!==id));
      await DB.save(KEYS.items, [...DB.get(KEYS.items), bien]);
      await addMovimiento(bien.id, bien.codigoInterno, 'Observación', 'Bien restaurado desde la papelera por '+currentUser().usuario+'.');
      await registrarBitacora('Restaurar bien (desde papelera)', bien.denominacion+' ('+bien.codigoInterno+')');
      toast('Bien restaurado.','ok'); renderContent();
    }));
    c.querySelectorAll('[data-purgar]').forEach(b=>b.addEventListener('click', async ()=>{
      if(!confirm('Esta acción eliminará el bien de forma DEFINITIVA y no podrá recuperarse. ¿Continuar?')) return;
      const id = b.dataset.purgar;
      const bien = DB.get(KEYS.papelera).find(x=>x.id===id);
      await DB.save(KEYS.papelera, DB.get(KEYS.papelera).filter(x=>x.id!==id));
      if(bien && bien.fotoId){ await eliminarImagen(bien.fotoId); }
      if(bien && Array.isArray(bien.fotosIds)){ for(const fid of bien.fotosIds){ await eliminarImagen(fid); } }
      if(bien && Array.isArray(bien.fotosHistorial)){ for(const f of bien.fotosHistorial){ if(f.fotoId) await eliminarImagen(f.fotoId); } }
      if(bien){ await registrarBitacora('Eliminar bien (definitivo)', bien.denominacion+' ('+bien.codigoInterno+')'); }
      toast('Bien eliminado definitivamente.','ok'); renderContent();
    }));
  }
  if(STATE.view==='planillas'){
    c.querySelector('#pl_generar').addEventListener('click', ()=>{
      const aulaId = c.querySelector('#pl_aula').value;
      if(!aulaId){ toast('Selecciona un aula.','err'); return; }
      const r = construirFichasHTML(aulaId);
      const prev = document.getElementById('pl_preview');
      prev.innerHTML = `
        <div class="card noprint" style="margin-bottom:16px;"><div class="card-h"><h3>Vista previa — ${r.total} bien(es), ${r.numPlanillas} planilla(s)</h3><button class="btn btn-primary btn-sm" id="pl_print">Imprimir planilla(s)</button></div></div>
        ${r.html}`;
      ajustarCellfit(prev, window);
      document.getElementById('pl_print').addEventListener('click', ()=>{
        abrirVentanaImpresion('Planilla de verificación física', r.html, 'landscape');
      });
    });
  }
  if(STATE.view==='reportes'){
    c.querySelector('#expInventarioPDF').addEventListener('click', exportInventarioPDF);
    c.querySelector('#expInventarioCSV').addEventListener('click', exportInventarioCSV);
    c.querySelector('#expInventarioXLSX').addEventListener('click', exportInventarioXLSX);
    c.querySelector('#expPorAulaPDF').addEventListener('click', exportPorAulaPDF);
    c.querySelector('#expPorAulaCSV').addEventListener('click', exportPorAulaCSV);
    c.querySelector('#expMovsPDF').addEventListener('click', exportMovsPDF);
    c.querySelector('#expMovsCSV').addEventListener('click', exportMovsCSV);
    c.querySelector('#expCalibracionesPDF').addEventListener('click', exportCalibracionesPDF);
    c.querySelector('#expCalibracionesCSV').addEventListener('click', exportCalibracionesCSV);
    c.querySelector('#expActaInventario').addEventListener('click', abrirModalActaInventario);
    c.querySelector('#expInformeBaja').addEventListener('click', exportInformeBajaPDF);
    c.querySelector('#expPorResponsablePDF').addEventListener('click', exportPorResponsablePDF);
    c.querySelector('#expPorResponsableCSV').addEventListener('click', exportPorResponsableCSV);
    c.querySelector('#expPorMontoPDF').addEventListener('click', exportPorMontoPDF);
    c.querySelector('#expPorMontoCSV').addEventListener('click', exportPorMontoCSV);
    c.querySelector('#expPorAntiguedadPDF').addEventListener('click', exportPorAntiguedadPDF);
    c.querySelector('#expPorAntiguedadCSV').addEventListener('click', exportPorAntiguedadCSV);
    c.querySelector('#expDepreciacionPDF').addEventListener('click', exportDepreciacionPDF);
    c.querySelector('#expDepreciacionCSV').addEventListener('click', exportDepreciacionCSV);
    c.querySelector('#expActa').addEventListener('click', exportActa);
    c.querySelector('#expSBNCSV').addEventListener('click', exportFormatoSBNCSV);
    c.querySelector('#expInformeEjecutivo').addEventListener('click', imprimirInformeEjecutivoAnual);
    c.querySelector('#irAConciliacion')?.addEventListener('click', ()=>{ STATE.view='conciliacion'; render(); });
    c.querySelector('#irABajas')?.addEventListener('click', ()=>{ STATE.view='bajas'; render(); });
    c.querySelector('#btnEnviarResumenSemanal')?.addEventListener('click', abrirBorradorResumenSemanal);
    c.querySelector('#btnCopiarResumenSemanal')?.addEventListener('click', copiarResumenSemanal);
    c.querySelector('#expActaPrint').addEventListener('click', ()=>{
      const html = actaPrintableHTML();
      document.getElementById('actaPreview').innerHTML = `<div class="noprint" style="margin:12px 0;"><button class="btn btn-primary btn-sm" id="actaPrintBtn">Imprimir acta</button></div>` + html;
      document.getElementById('actaPrintBtn').addEventListener('click', async ()=>{
        const items = DB.get(KEYS.items);
        const registro = await registrarActaFirmada('Acta de Conciliación Patrimonio-Contable', {
          anioFiscal: DB.get(KEYS.config).anioFiscal, totalBienes: items.length,
          valorTotal: items.reduce((a,i)=>a+(Number(i.valorAdquisicion)||0),0)
        }, `Año fiscal ${DB.get(KEYS.config).anioFiscal} — ${items.length} bien(es)`);
        abrirVentanaImpresion('Acta de Conciliación Patrimonial', html + bloqueVerificacionHTML(registro));
      });
    });
    const expB = c.querySelector('#expBackup'); if(expB) expB.addEventListener('click', ()=>{
      const backup = {}; Object.entries(KEYS).forEach(([k,key])=>{ backup[k]=DB.get(key); });
      backup._meta = { exportadoEl:new Date().toISOString(), sistema:'SIGIE' };
      downloadFile('respaldo_sigie_'+today()+'.json', JSON.stringify(backup, null, 2), 'application/json;charset=utf-8;');
    });
    const impB = c.querySelector('#impBackup'); if(impB) impB.addEventListener('change', e=>{
      const file = e.target.files[0]; if(!file) return;
      if(!confirm('Restaurar un respaldo REEMPLAZARÁ todos los datos actuales del sistema. ¿Deseas continuar?')) return;
      const reader = new FileReader();
      reader.onload = async ()=>{
        try{
          const backup = JSON.parse(reader.result);
          // Los usuarios no se restauran: los respaldos ya no llevan contraseñas (ni hashes) y las cuentas se gestionan en "Usuarios y accesos".
          for(const [k,key] of Object.entries(KEYS)){ if(k==='usuarios') continue; if(backup[k]!==undefined){ await DB.save(key, backup[k], { reemplazar:true }); } }
          toast('Respaldo restaurado correctamente.','ok');
          render();
        }catch(err){ toast('El archivo no es un respaldo válido.','err'); }
      };
      reader.readAsText(file);
    });
    const btnReset = c.querySelector('#btnResetSistema'); if(btnReset) btnReset.addEventListener('click', reiniciarSistemaCompleto);
    const btnEj = c.querySelector('#btnGenEjemplo'); if(btnEj) btnEj.addEventListener('click', ()=>generarDatosEjemplo());
  }
  if(STATE.view==='config'){
    c.querySelector('#cfg_logo').addEventListener('change', async e=>{
      const file=e.target.files[0]; if(!file) return;
      try{
        const dataUrl = await comprimirImagen(file, 300, 0.85);
        c.querySelector('#logoPrev').innerHTML=`<img src="${dataUrl}">`;
        c.dataset.newLogoId = await guardarImagen(dataUrl); // ya queda guardado como archivo propio
      }catch(err){ toast('No se pudo procesar el logo: '+err.message, 'err'); }
    });
    c.querySelector('#cfg_save').addEventListener('click', async ()=>{
      const cfg = {...DB.get(KEYS.config)};
      cfg.nombreIE=c.querySelector('#cfg_nombreIE').value.trim()||cfg.nombreIE;
      cfg.siglas=c.querySelector('#cfg_siglas').value.trim()||cfg.siglas;
      cfg.codigoModular=c.querySelector('#cfg_codigoModular').value.trim();
      cfg.codigoLocal=c.querySelector('#cfg_codigoLocal').value.trim();
      cfg.anioFiscal=parseInt(c.querySelector('#cfg_anioFiscal').value)||cfg.anioFiscal;
      cfg.ugel=c.querySelector('#cfg_ugel').value.trim(); cfg.dre=c.querySelector('#cfg_dre').value.trim();
      cfg.director=c.querySelector('#cfg_director').value.trim();
      cfg.responsablePatrimonio=c.querySelector('#cfg_responsablePatrimonio').value.trim();
      cfg.nivelIE=c.querySelector('#cfg_nivelIE').value.trim();
      cfg.personalInventariador=c.querySelector('#cfg_personalInventariador').value.trim();
      cfg.entidadCodigoSIGA=c.querySelector('#cfg_entidadCodigoSIGA').value.trim()||cfg.entidadCodigoSIGA;
      cfg.emailNotificaciones=c.querySelector('#cfg_emailNotificaciones').value.trim();
      if(c.dataset.newLogoId){ if(cfg.logoId && cfg.logoId!==c.dataset.newLogoId){ await eliminarImagen(cfg.logoId); } cfg.logoId=c.dataset.newLogoId; }
      await DB.save(KEYS.config, cfg);
      toast('Datos de la institución guardados.','ok');
      render();
    });
  }
  if(STATE.view==='prestamos'){
    // el botón "+ Nuevo préstamo" ya está enganchado en wireTopbarActions
  }
}

/* ---------------------------------------------------------------------
   ARRANQUE
   --------------------------------------------------------------------- */
initApp();
