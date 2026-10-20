/* SIGIE v15 — Íconos de línea incluidos en el propio sistema (sin internet, sin CDN).
   1) Reemplaza los símbolos/emojis del menú lateral por íconos consistentes.
   2) Agrega un ícono a los botones según su texto (Guardar, Nuevo, Eliminar, Excel...).
   Si algo no tiene ícono asignado, se deja el símbolo original: nunca se rompe una pantalla. */
(function(){
  const P = {
    home:'<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    book:'<path d="M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2z"/><path d="M22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8z"/>',
    grid:'<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    box:'<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
    map:'<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
    qr:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h3M20 17v4"/>',
    swap:'<path d="M4 8h16M16 4l4 4-4 4"/><path d="M20 16H4M8 12l-4 4 4 4"/>',
    cart:'<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 7H6"/>',
    trash:'<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
    clipcheck:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M9 14l2 2 4-4"/>',
    updown:'<path d="M7 4v16M7 4L3 8M7 4l4 4"/><path d="M17 20V4M17 20l-4-4M17 20l4-4"/>',
    scale:'<path d="M12 3v18M6 21h12M5 7h14"/><path d="M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
    wrench:'<path d="M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"/>',
    upload:'<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
    download:'<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
    history:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    check:'<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
    save:'<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    x:'<path d="M6 6l12 12M18 6L6 18"/>',
    pencil:'<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
    printer:'<path d="M7 9V3h10v6"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    back:'<path d="M19 12H5M11 6l-6 6 6 6"/>',
    building:'<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 21v-4h6v4M8 8h2M14 8h2M8 12h2M14 12h2"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users:'<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14a5 5 0 0 1 5 5"/>',
    idcard:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16a3 3 0 0 1 6 0M14 10h4M14 14h4"/>',
    list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    trenddown:'<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
    trendup:'<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    table:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
    bars:'<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    calc:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
    coins:'<circle cx="12" cy="12" r="9"/><path d="M14.5 9a2.5 2 0 0 0-2.5-1.5c-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2A2.5 2 0 0 1 9.5 15M12 6v1.5M12 16.5V18"/>',
    restore:'<path d="M3 6h18"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 12l3-3 3 3M12 9v8"/>',
    scroll:'<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    shield:'<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    scan:'<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M4 12h16"/>',
    bookmark:'<path d="M6 3h12v18l-6-4-6 4z"/>',
    palette:'<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2.2-.5-1.3.3-2.3 1.7-2.3H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3z"/><path d="M7.5 11h.01M10 7.5h.01M14.5 7.5h.01"/>',
    medal:'<circle cx="12" cy="9" r="6"/><path d="M8.5 14L7 21l5-3 5 3-1.5-7"/>',
    star:'<path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.3l1-6.2L3 9.7l6.2-.9z"/>',
    moon:'<path d="M20 14A8 8 0 1 1 10 4a7 7 0 0 0 10 10z"/>',
    cap:'<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5M22 9v6"/>',
    bulb:'<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
    hourglass:'<path d="M6 3h12M6 21h12"/><path d="M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/>',
    heart:'<path d="M20.8 5.6a5 5 0 0 0-7.8 0L12 6.7l-1-1.1a5 5 0 0 0-7.8 7L12 21l8.8-8.4a5 5 0 0 0 0-7z"/>',
    trophy:'<path d="M8 4h8v6a4 4 0 0 1-8 0z"/><path d="M8 6H4v2a3 3 0 0 0 4 3M16 6h4v2a3 3 0 0 1-4 3M12 14v4M8 21h8M10 18h4"/>',
    gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13"/><path d="M12 8c-3 0-4-4-1.5-4S12 8 12 8zM12 8c3 0 4-4 1.5-4S12 8 12 8z"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    triangle:'<path d="M3 5h18L12 20z"/>'
  };
  const NAV = {
    dashboard:'grid', items:'box', plano:'map', qrlab:'qr', prestamos:'swap', requerimientos:'cart', bajas:'trash', almacen:'box',
    tomas:'clipcheck', comparativo:'updown', verifSBN:'scale', mantenimientos:'wrench', masiva:'upload', movs:'history', verificaracta:'check',
    aulas:'building', custodios:'user', cargos:'idcard', comision:'users', catalogo:'list', categoriasDeprec:'trenddown',
    planillas:'table', reportes:'bars', conciliacion:'calc', presupuesto:'coins', usuarios:'users', papelera:'restore', bitacora:'scroll', polizas:'shield', config:'gear',
    bibInicio:'home', bibLibros:'book', bibMost:'scan', bibPrest:'swap', bibRes:'bookmark', bibLect:'idcard', bibQR:'qr', bibToma:'clipcheck', bibCats:'palette',
    bibRetos:'medal', bibResenas:'star', bibInact:'moon', bibCert:'cap', bibLecturas:'book', bibCompr:'pencil', bibSanc:'hourglass', bibBajas:'download',
    bibReporte:'bars', bibRepExp:'download', bibSalud:'heart', bibColec:'trenddown', bibMiLec:'book', bibOpac:'search', bibRepColor:'palette', bibSug:'bulb',
    bibLectom:'trendup', bibEval:'pencil', bibRank:'trophy', bibPremios:'gift', bibActiv:'calendar', bibDipl:'medal', bibDir:'bars', bibRepLec:'table'
  };
  function svg(nombre, clase){
    const p = P[nombre]; if(!p) return '';
    return '<svg class="'+(clase||'ico')+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+p+'</svg>';
  }
  /* Ícono del menú: el dibujo de línea si existe, o el símbolo original como respaldo. */
  function iconoNav(id, respaldo){ return NAV[id] ? svg(NAV[id], 'ico') : respaldo; }

  /* Reglas de botones: texto -> ícono. Se aplican al primer texto del botón. */
  const REGLAS = [
    [/^(guardar|registrar|crear|confirmar|aplicar|finalizar)/, 'save', true],
    [/^(nuevo|nueva|agregar|añadir|anadir)/, 'plus', true],
    [/^(eliminar|borrar|quitar|anular)/, 'trash', false],
    [/^(editar|modificar)/, 'pencil', false],
    [/^(cancelar|cerrar)/, 'x', false],
    [/(excel|exportar|descargar|respaldo)/, 'download', false],
    [/^(importar|subir|cargar)/, 'upload', false],
    [/(imprimir|pdf)/, 'printer', false],
    [/^(buscar|filtrar)/, 'search', false],
    [/^(volver|atr[aá]s)/, 'back', false],
    [/^(devolver|devoluci)/, 'swap', false],
    [/^(ver |abrir|detalle)/, 'search', false]
  ];
  function norm(s){ return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }
  function mejorarBoton(b){
    if(b.dataset.ico || b.closest('.nav,.pill-toggle,.sidebar,.mr-estado-row') || b.classList.contains('hamburger') || b.classList.contains('close-x')) return;
    b.dataset.ico = '1';
    if(b.querySelector('svg')) return;
    let texto = (b.textContent||'').replace(/^\s*[+＋]\s*/, '').trim();
    const t = norm(texto);
    if(!t) return;
    // Si ya empieza con un emoji o símbolo propio, se respeta tal cual.
    if(/^[^a-z0-9]/.test(t) && !/^\s*[+＋]/.test(b.textContent||'')) return;
    for(const [re, ico, principal] of REGLAS){
      if(re.test(t)){
        if(/^\s*[+＋]/.test(b.textContent||'')) b.textContent = texto;
        b.insertAdjacentHTML('afterbegin', svg(ico));
        if(principal && b.classList.contains('btn-primary')){ b.classList.remove('btn-primary'); b.classList.add('btn-accent'); }
        return;
      }
    }
  }
  function mejorarTodo(raiz){
    (raiz||document).querySelectorAll('button.btn:not([data-ico])').forEach(mejorarBoton);
  }
  const api = { svg, iconoNav, mejorarTodo };
  if(typeof window!=='undefined'){ window.UI_ICONOS = api; window.iconoNav = iconoNav; }
  if(typeof module!=='undefined' && module.exports) module.exports = api;

  if(typeof document!=='undefined' && typeof MutationObserver!=='undefined'){
    let pendiente = false;
    const obs = new MutationObserver(()=>{
      if(pendiente) return; pendiente = true;
      requestAnimationFrame(()=>{ pendiente = false; try{ mejorarTodo(); }catch(e){} });
    });
    const arrancar = ()=>{ mejorarTodo(); obs.observe(document.body, {childList:true, subtree:true}); };
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', arrancar); else arrancar();
  }
})();
