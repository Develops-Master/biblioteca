/* =========================================================================
   SIGIE — Página de acceso (login.html)
   Usa el mismo core.js (Firebase/almacenamiento/DB/usuarios) que index.html,
   pero vive en su propio archivo: al iniciar sesión aquí, redirige a
   index.html; si ya había una sesión guardada, salta directo al sistema.

   © 2026 Luis Hider Manco Berrocal — CIST. Todos los derechos reservados.
   ========================================================================= */

// A dónde volver después de iniciar sesión. Por defecto el sistema completo,
// pero si vinimos redirigidos desde otra página propia (p. ej. modo-rapido.html,
// al intentar abrirla sin sesión activa), volvemos ahí en vez de index.html.
// Se valida contra una lista fija de páginas propias, para no poder usar este
// parámetro para redirigir a un sitio externo.
function proximaPagina(){
  const permitidas = ['index.html', 'modo-rapido.html'];
  const next = new URLSearchParams(window.location.search).get('next');
  return permitidas.includes(next) ? next : 'index.html';
}

async function initLogin(){
  await detectarAlmacenamiento();

  // Con el servidor local, la sesión vive en el servidor (cookie HttpOnly): preguntamos si ya hay una vigente.
  if(STORAGE_MODE==='servidor'){
    try{
      const r = await fetch('/api/session', { cache:'no-store' });
      if(r.ok){
        const d = await r.json();
        if(d.ok && d.debeCambiarPass){ renderCambioObligatorio(null); return; }
        if(d.ok){ window.location.href = proximaPagina(); return; }
      }
    }catch(e){}
    renderLoginForm();
    return;
  }

  // ---- Modos de respaldo (archivo abierto con doble clic, Claude, Firebase): flujo anterior, solo en el navegador ----
  await DB.load(KEYS.usuarios, []);
  await DB.load(KEYS.bitacora, []);
  await seedAdminIfNeeded();
  try{
    const raw = window.localStorage.getItem('sigie:sesion_actual');
    if(raw){
      const s = JSON.parse(raw);
      const u = DB.get(KEYS.usuarios).find(x=>x.id===s.id);
      if(u){ window.location.href = proximaPagina(); return; }
    }
  }catch(e){}

  renderLoginForm();
}

function renderLoginForm(){
  const app = document.getElementById('app');
  app.innerHTML = `
  <div class="login-wrap">
    <div class="login-card">
      <div class="tag">SIGIE · BIBLIOTECA</div>
      <h1>Biblioteca Escolar</h1>
      <div class="desc">Ingresa con tu usuario para registrar y consultar los libros, préstamos y lectores de la biblioteca.</div>
      <div style="text-align:center;margin-bottom:14px;"><span class="badge ${STORAGE_MODE==='servidor'?'badge-gold':STORAGE_MODE==='firebase'?'badge-warn':STORAGE_MODE==='claude'?'badge-info':'badge-gold'}">${STORAGE_MODE==='servidor'?'💽 Base de datos local (SQLite)':STORAGE_MODE==='firebase'?'🔥 Firebase conectado':STORAGE_MODE==='claude'?'Almacenamiento de Claude':'💾 Almacenamiento local del navegador'}</span></div>
      <div id="loginMsg">${STORAGE_MODE!=='servidor'?'<div class="msgbox err">⚠️ Estás usando el sistema <b>sin el servidor local</b> (por ejemplo, abriendo el archivo con doble clic o desde otra carpeta). Aún puedes ingresar, pero los datos se guardarían <b>solo en este navegador</b>. Para guardar en la base de datos de la carpeta, cierra esta ventana y abre <b>Iniciar_SIGIE_Windows.bat</b> (o <b>Iniciar_SIGIE_Mac.command</b>) y entra por <b>http://localhost:3000</b>.</div>':''}</div>
      <div class="field"><label>Usuario</label><input id="lg_user" placeholder="Usuario" onkeydown="if(event.key==='Enter')document.getElementById('lg_pass').focus()"></div>
      <div class="field"><label>Contraseña</label><input id="lg_pass" type="password" placeholder="••••••••" onkeydown="if(event.key==='Enter')document.getElementById('btnLogin').click()"></div>
      <button class="btn btn-primary" id="btnLogin" style="width:100%;justify-content:center;">Ingresar</button>
      <div class="login-copyright" style="text-align:center;margin-top:16px;font-size:11px;color:#8fa5bd;">© ${new Date().getFullYear()} Luis Hider Manco Berrocal — CIST. Todos los derechos reservados.</div>
    </div>
  </div>`;
  document.getElementById('btnLogin').addEventListener('click', doLogin);
}

/* ---------------------------------------------------------------------
   Freno ante intentos repetidos de acceso.
   (Solo modos de respaldo: con el servidor local el freno lo aplica el
   servidor, por IP y usuario, y no se puede saltar borrando localStorage.)
   Evita que alguien pruebe contraseñas una tras otra desde el mismo navegador. Se guarda en localStorage
   por nombre de usuario intentado, con bloqueo temporal creciente.
   --------------------------------------------------------------------- */
const LOGIN_MAX_INTENTOS = 5;
const LOGIN_BLOQUEO_MS = 60 * 1000; // 1 minuto

function claveIntentos(usuario){ return 'sigie:intentos_login:'+usuario.toLowerCase(); }

function leerIntentos(usuario){
  try{ return JSON.parse(window.localStorage.getItem(claveIntentos(usuario))) || {n:0, bloqueadoHasta:0}; }
  catch(e){ return {n:0, bloqueadoHasta:0}; }
}
function guardarIntentos(usuario, data){
  try{ window.localStorage.setItem(claveIntentos(usuario), JSON.stringify(data)); }catch(e){}
}
function segundosRestantesBloqueo(usuario){
  const data = leerIntentos(usuario);
  const restante = data.bloqueadoHasta - Date.now();
  return restante > 0 ? Math.ceil(restante / 1000) : 0;
}
function registrarIntentoFallido(usuario){
  const data = leerIntentos(usuario);
  data.n = (data.n || 0) + 1;
  if(data.n >= LOGIN_MAX_INTENTOS){
    data.bloqueadoHasta = Date.now() + LOGIN_BLOQUEO_MS;
    data.n = 0;
  }
  guardarIntentos(usuario, data);
}
function limpiarIntentos(usuario){
  try{ window.localStorage.removeItem(claveIntentos(usuario)); }catch(e){}
}

async function doLogin(){
  const usuario = document.getElementById('lg_user').value.trim();
  const pass = document.getElementById('lg_pass').value;
  const msg = document.getElementById('loginMsg');
  if(!usuario || !pass){ msg.innerHTML = '<div class="msgbox err">Ingresa usuario y contraseña.</div>'; return; }

  // Con el servidor local el login lo valida el servidor (hash, bloqueo por intentos y bitácora incluidos).
  if(STORAGE_MODE==='servidor') return loginServidor(usuario, pass, msg);

  const restante = segundosRestantesBloqueo(usuario);
  if(restante > 0){
    msg.innerHTML = '<div class="msgbox err">Demasiados intentos fallidos. Espera '+restante+' segundo(s) antes de volver a intentar.</div>';
    return;
  }

  // Mensaje de error genérico a propósito (no decimos si el usuario existe o
  // no): así no se puede usar el login para "adivinar" qué nombres de
  // usuario están registrados en el sistema.
  const MSG_GENERICO = '<div class="msgbox err">Usuario o contraseña incorrectos.</div>';

  const users = DB.get(KEYS.usuarios);
  const u = users.find(x=>x.usuario.toLowerCase()===usuario.toLowerCase());
  if(!u){
    msg.innerHTML = MSG_GENERICO;
    registrarIntentoFallido(usuario);
    await registrarBitacora('Intento de acceso fallido', 'Usuario no encontrado: '+usuario, {usuario, rol:'—'});
    return;
  }
  if(!(await verificarPassword(u, pass))){
    msg.innerHTML = MSG_GENERICO;
    registrarIntentoFallido(usuario);
    await registrarBitacora('Intento de acceso fallido', 'Contraseña incorrecta para: '+u.usuario, {usuario:u.usuario, rol:u.rol});
    return;
  }
  limpiarIntentos(usuario);

  // Migración silenciosa: cuentas con hash antiguo (SHA-256 simple) pasan a PBKDF2.
  if(u.algo !== 'pbkdf2'){
    try{
      const cred = await crearCredencial(pass);
      await DB.save(KEYS.usuarios, DB.get(KEYS.usuarios).map(x=>x.id===u.id?{...x, ...cred}:x));
    }catch(e){ /* si falla, seguirá funcionando con el hash antiguo */ }
  }

  // Contraseña provisional (cuenta nueva, restablecida o la 'admin123' de fábrica): obligar a cambiarla.
  if(u.debeCambiarPass || pass === 'admin123'){
    renderCambioObligatorio(u);
    return;
  }
  await completarInicioSesion(u);
}

async function loginServidor(usuario, pass, msg){
  const btn = document.getElementById('btnLogin');
  if(btn) btn.disabled = true;
  try{
    const r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ usuario, password:pass }) });
    let d = {}; try{ d = await r.json(); }catch(e){}
    if(r.ok && d.ok){
      if(d.debeCambiarPass){ renderCambioObligatorio(null); return; }
      window.location.href = proximaPagina();
      return;
    }
    msg.innerHTML = '<div class="msgbox err">'+esc(d.error || 'No se pudo iniciar sesión.')+'</div>';
  }catch(e){
    msg.innerHTML = '<div class="msgbox err">No se pudo conectar con el servidor. ¿Sigue abierta la ventana de SIGIE?</div>';
  }finally{ if(btn) btn.disabled = false; }
}

async function completarInicioSesion(u){
  try{ window.localStorage.setItem('sigie:sesion_actual', JSON.stringify({id:u.id})); }catch(e){}
  await registrarBitacora('Inicio de sesión', '', {usuario:u.nombre||u.usuario, rol:u.rol});
  window.location.href = proximaPagina();
}

function renderCambioObligatorio(u){
  const app = document.getElementById('app');
  app.innerHTML = `
  <div class="login-wrap">
    <div class="login-card">
      <div class="tag">SIGIE · BIBLIOTECA</div>
      <h1>Cambia tu contraseña</h1>
      <div class="desc">Estás usando una contraseña provisional. Por seguridad, elige una nueva (mínimo ${PASS_MIN_LARGO} caracteres) antes de continuar.</div>
      <div id="cpMsg"></div>
      <div class="field"><label>Nueva contraseña</label><input id="cp_pass1" type="password" placeholder="••••••••" autocomplete="new-password"></div>
      <div class="field"><label>Repite la nueva contraseña</label><input id="cp_pass2" type="password" placeholder="••••••••" autocomplete="new-password" onkeydown="if(event.key==='Enter')document.getElementById('btnCambiar').click()"></div>
      <button class="btn btn-primary" id="btnCambiar" style="width:100%;justify-content:center;">Guardar y entrar</button>
    </div>
  </div>`;
  document.getElementById('btnCambiar').addEventListener('click', async ()=>{
    const p1 = document.getElementById('cp_pass1').value;
    const p2 = document.getElementById('cp_pass2').value;
    const box = document.getElementById('cpMsg');
    const err = validarPasswordNueva(p1) || (p1!==p2 ? 'Las contraseñas no coinciden.' : '');
    if(err){ box.innerHTML = '<div class="msgbox err">'+esc(err)+'</div>'; return; }
    if(STORAGE_MODE==='servidor'){
      try{
        const r = await fetch('/api/password', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ nueva:p1 }) });
        const d = await r.json().catch(()=>({}));
        if(!r.ok){ box.innerHTML = '<div class="msgbox err">'+esc(d.error || 'No se pudo cambiar la contraseña.')+'</div>'; return; }
        window.location.href = proximaPagina();
      }catch(e){ box.innerHTML = '<div class="msgbox err">No se pudo conectar con el servidor.</div>'; }
      return;
    }
    const cred = await crearCredencial(p1);
    await DB.save(KEYS.usuarios, DB.get(KEYS.usuarios).map(x=>x.id===u.id?{...x, ...cred, debeCambiarPass:false}:x));
    await registrarBitacora('Cambio de contraseña', 'Cambio obligatorio de contraseña provisional: '+u.usuario, {usuario:u.nombre||u.usuario, rol:u.rol});
    await completarInicioSesion(u);
  });
}

initLogin();
