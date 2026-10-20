/* SIGIE v19 — Pantalla «Catálogo público (OPAC)» dentro del sistema: enlace, QR y cartel para imprimir. */
(function(){
  const nav0 = window.bibNav;
  window.bibNav = function(){ const g = nav0(); const i = g.items.findIndex(x => x.id==='bibLibros');
    g.items.splice(i < 0 ? g.items.length : i + 1, 0, { id:'bibOpac', ic:'🔎', label:'Catálogo público (OPAC)' }); return g; };
  window.BIB_TITULOS9 = { bibOpac:['Catálogo público (OPAC)', 'Página para que alumnos y docentes consulten los libros desde el celular'] };
  const url = () => location.origin + '/opac.html';
  BIB_RENDER.bibOpac = function(){
    const cfg = DB.get(KEYS.config) || {}, u = url(), srv = typeof STORAGE_MODE !== 'undefined' && STORAGE_MODE === 'servidor';
    const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
    return `<div class="toolbar noprint"><button class="btn btn-primary" id="opCopiar">Copiar enlace</button><a class="btn" href="${esc(u)}" target="_blank" rel="noopener">Abrir el catálogo</a><button class="btn" onclick="window.print()">🖨 Imprimir cartel con QR</button></div>
    ${srv ? '' : '<div class="note-banner noprint">El catálogo público solo funciona cuando el sistema corre con el servidor local (guardado en data/sigie.db). En este modo no está disponible.</div>'}
    ${local ? '<div class="note-banner noprint">Ahora estás en «localhost»: ese enlace solo sirve en esta computadora. Para usarlo en celulares, abre el sistema con la dirección de red (modo SIGIE_LAN=1, ver LEEME_INSTALACION.md) y vuelve a esta pantalla.</div>' : ''}
    ${(()=>{ const k = SigieLectores.calidad(bibLect(), g => SigieBib.parsearGrado(g)), on = !!bibCfg().opacReservas; return `<div class="noprint" style="max-width:520px;margin:12px auto;border:1px solid #bbb;border-radius:12px;padding:12px">
      <label style="display:flex;gap:8px;align-items:center;font-weight:700"><input type="checkbox" id="opRes" ${on?'checked':''} ${canEdit()?'':'disabled'}> Permitir reservar desde el catálogo</label>
      <div class="hint" style="margin-top:6px">El lector reserva libros <b>prestados</b> con su código de carné y los <b>4 últimos dígitos de su DNI</b>. La reserva entra a «Reservas» como <i>En espera</i> (etiqueta OPAC) y tú decides si la atiendes. Máximo 2 reservas por lector; 5 intentos fallidos bloquean ese código 15 minutos.</div>
      ${k.sinDni ? `<div class="hint" style="margin-top:6px;color:#A63A3A"><b>${k.sinDni}</b> lector(es) no tienen DNI: no podrán reservar desde el catálogo.</div>` : ''}</div>`; })()}
    <div style="max-width:520px;margin:16px auto;border:3px solid #14304d;border-radius:18px;padding:22px;text-align:center;break-inside:avoid">
      <div style="font-size:13px;letter-spacing:.12em;color:#5b6877">${esc(cfg.nombreIE || 'BIBLIOTECA ESCOLAR')}</div>
      <h2 style="margin:6px 0 2px;font-size:28px">¿Qué quieres leer hoy?</h2>
      <div style="margin-bottom:10px">Escanea y busca tu libro en el catálogo</div>
      <img src="${bibQrImg(u)}" style="width:220px;height:220px;image-rendering:pixelated" alt="QR del catálogo">
      <div class="mono" style="margin-top:8px;word-break:break-all;font-size:13px">${esc(u)}</div></div>
    <div class="hint noprint" style="text-align:center">El catálogo muestra solo los libros y si están disponibles; nunca datos de lectores.</div>`;
  };
  document.addEventListener('change', async e => { if(!e.target || e.target.id !== 'opRes') return; if(!guardEdit()){ e.target.checked = !e.target.checked; return; }
    await DB.save(B2.cfg, { ...bibCfg(), opacReservas:e.target.checked }); registrarBitacora('Reservas desde el OPAC', e.target.checked ? 'Activadas' : 'Desactivadas'); toast(e.target.checked ? 'Reservas desde el catálogo activadas.' : 'Reservas desde el catálogo desactivadas.', 'ok'); });
  document.addEventListener('click', e => { if(e.target && e.target.id === 'opCopiar'){
    (navigator.clipboard ? navigator.clipboard.writeText(url()) : Promise.reject()).then(() => toast('Enlace copiado.', 'ok'), () => toast(url(), 'ok')); } });
})();
