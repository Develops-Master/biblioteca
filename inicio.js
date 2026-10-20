/* SIGIE v16 — Inicio rediseñado: 6 indicadores, alertas y 15 gráficos en una cuadrícula de 3 columnas.
   Reemplaza la pantalla «Inicio» de biblioteca.js. Si algo fallara al dibujarla, se muestra la
   pantalla anterior (nunca queda el Inicio en blanco). Se carga después de biblioteca.js. */
const renderBibInicioAnterior = BIB_RENDER.bibInicio;

function renderBibInicioNuevo(){
  const I = SigieInicio, C = I.C, E = I.esc;
  const s = bibStats(), cfg = DB.get(KEYS.config) || {}, hoy = today(), res = bibRes();
  const D = I.calcular({
    hoy, prest:bibPrest(), res, lect:bibLect(), libros:s.libros, cats:s.cats, estantes:s.porUbi,
    claveGrado:g => SigieBib.claveGrado(g, 'seccion')
  });
  const dResp = bibDiasDesdeRespaldo(), sinVerif = s.porUbi.filter(x => !x.toma || x.diasToma > 90).length;

  /* ---------- Alertas ---------- */
  const aviso = (ic, txt, ir, btn) => `<li class="hm-aviso"><span>${ic}</span><span class="hm-aviso-t">${txt}</span>${ir ? `<button class="btn btn-sm" data-bigo="${ir}">${btn || 'Ver'}</button>` : ''}</li>`;
  const avisos = [];
  if(s.vencidos.length) avisos.push(aviso('⏰', '<b>' + s.vencidos.length + '</b> préstamo(s) vencido(s). El más atrasado: ' + s.vencidos[0].atraso + ' día(s) (' + E(s.vencidos[0].p.lector) + ').', 'bibPrest', 'Reclamar'));
  if(D.listas) avisos.push(aviso('🔖', '<b>' + D.listas + '</b> reserva(s) lista(s) para recoger: avisa a los lectores.', 'bibRes', 'Avisar'));
  if(D.enEspera) avisos.push(aviso('⏳', '<b>' + D.enEspera + '</b> lector(es) en lista de espera.', 'bibRes'));
  if(dResp === null || dResp > 14) avisos.push(`<li class="hm-aviso"><span>💾</span><span class="hm-aviso-t">${dResp === null ? 'Todavía no has descargado un respaldo de la biblioteca.' : 'Tu último respaldo fue hace <b>' + dResp + '</b> días.'}</span><button class="btn btn-sm" id="biBackup">Descargar</button></li>`);
  if(sinVerif) avisos.push(aviso('☑', '<b>' + sinVerif + '</b> de ' + s.porUbi.length + ' estante(s) sin verificar o con inventario de más de 90 días.', 'bibToma', 'Verificar'));
  const nIn = typeof bibInactN === 'function' ? bibInactN() : 0;
  if(nIn) avisos.push(aviso('💤', '<b>' + nIn + '</b> alumno(s) sin leer hace más de ' + (bibCfg().diasInactivo || 30) + ' días.', 'bibInact', 'Ver aulas'));
  const nLa = typeof bibLecturasAtrasadasN === 'function' ? bibLecturasAtrasadasN() : 0;
  if(nLa) avisos.push(aviso('📖', '<b>' + nLa + '</b> alumno(s) con una lectura asignada atrasada.', 'bibLecturas', 'Ver lecturas'));
  if(s.malos.length) avisos.push(aviso('🩹', '<b>' + s.malos.length + '</b> libro(s) en mal estado para reparar o reponer.', 'bibRepExp', 'Reporte'));
  const nProb = isAdmin() && typeof bibSaludProblemas === 'function' ? bibSaludProblemas() : 0;
  if(nProb) avisos.push(aviso('🩺', 'La revisión de datos encontró <b>' + nProb + '</b> punto(s) por corregir.', 'bibSalud', 'Revisar'));

  /* ---------- Piezas ---------- */
  const go = (id, ic, t) => `<button class="btn" data-bigo="${id}">${ic} ${t}</button>`;
  const kpi = (lbl, val, sub, color, o) => { o = o || {};
    return `<div class="card hm-kpi" style="--c:${color}"><div class="hm-kpi-t"><div class="lbl">${lbl}</div><div class="val"${o.alerta ? ' style="color:var(--brick)"' : ''}>${val}</div>${sub ? `<div class="delta">${sub}</div>` : ''}</div>${o.spark || ''}</div>`; };
  const tarjeta = (titulo, sub, cuerpo, o) => { o = o || {};
    return `<div class="card hm-card${o.span2 ? ' span2' : ''}"><div class="card-b"><div class="hm-head"><div><h3 class="hm-h">${titulo}</h3>${sub ? `<div class="hm-sub">${sub}</div>` : ''}</div>${o.ir ? `<button class="btn btn-ghost btn-sm" data-bigo="${o.ir}">Abrir</button>` : ''}</div><div class="hm-body">${cuerpo}</div></div></div>`; };

  const vencTabla = s.vencidos.length
    ? `<div class="tbl-wrap"><table><thead><tr><th>Lector</th><th>Grado</th><th>Libro</th><th>Atraso</th></tr></thead><tbody>${s.vencidos.slice(0, 6).map(v => `<tr><td>${E(v.p.lector)}</td><td>${E(v.p.grado || '—')}</td><td>${E(v.l.titulo || '(libro eliminado)')}</td><td><span class="badge badge-bad">${v.atraso} día(s)</span></td></tr>`).join('')}</tbody></table></div>`
    : `<div class="msgbox ok" style="margin:0;">✅ No hay préstamos vencidos. ¡Todo al día!</div>`;

  const pulso = [
    ['Títulos en el catálogo', D.titulos, ''], ['Títulos que nunca se han prestado', D.nuncaPrestados, D.nuncaPrestados ? 'warn' : ''],
    ['Libros en mal estado', D.malos, D.malos ? 'bad' : ''], ['Préstamos renovados ahora', D.renovados, ''], ['Lectores en lista de espera', D.enEspera, '']
  ].map(r => `<li class="hm-pulso"><span>${r[0]}</span><b class="${r[2]}">${r[1]}</b></li>`).join('');

  const etqDia = D.dia30.fechas.map(f => f.slice(8, 10) + '/' + f.slice(5, 7));
  const cump = D.cumplimiento, colorCump = cump.pct >= 85 ? C.verde : cump.pct >= 60 ? C.ambar : C.rojo;
  const colorEst = D.estantes.pct >= 80 ? C.verde : D.estantes.pct >= 50 ? C.ambar : C.rojo;
  const sub90 = 'Últimos 90 días', sub30 = 'Últimos 30 días';

  return `<div class="hint" style="margin-bottom:12px;">${E(cfg.nombreIE || '')} · ${E(new Date().toLocaleDateString('es-PE', { weekday:'long', day:'numeric', month:'long', year:'numeric' }))}</div>
  <div class="toolbar noprint">${go('bibMost', '⌨', 'Mostrador (escáner)')}${go('bibPrest', '⇄', 'Préstamos')}${go('bibRes', '🔖', 'Reservas')}${go('bibLect', '🪪', 'Lectores')}${go('bibLibros', '📚', 'Catálogo')}${go('bibToma', '☑', 'Inventario por estante')}</div>

  <div class="hm-grid">
    ${kpi('Ejemplares en la biblioteca', s.totalEj, D.titulos + ' títulos en el catálogo', C.navy)}
    ${kpi('Prestados ahora', D.activos, D.disponibles + ' disponibles', C.ambar)}
    ${kpi('Préstamos vencidos', D.vencidos, D.vencidos ? 'Requieren reclamo' : 'Todo al día', C.rojo, { alerta:D.vencidos > 0 })}
    ${kpi('Reservas listas', D.listas, D.enEspera + ' en lista de espera', C.azul)}
    ${kpi('Prestados hoy', D.prestHoy, D.devHoy + ' devueltos hoy', C.verde, { spark:I.spark(D.spark.prestados, C.verde) })}
    ${kpi('Lectores activos', D.lectoresActivos, D.lectoresTipo.length + ' tipo(s) de lector', C.morado)}

    ${tarjeta('Requiere atención', avisos.length ? avisos.length + ' aviso(s) pendiente(s)' : '', avisos.length ? '<ul class="hm-avisos">' + avisos.join('') + '</ul>' : '<div class="msgbox ok" style="margin:0;">✅ Todo en orden: sin vencidos, reservas pendientes ni respaldos atrasados.</div>')}
    ${tarjeta('Vencidos más atrasados', 'Los 6 casos con más días de atraso', vencTabla, { span2:true, ir:'bibPrest' })}

    ${tarjeta('Movimiento de los últimos 6 meses', 'Libros prestados y devueltos por mes', I.columnas(D.meses.map(m => m.etiqueta), [{ nombre:'Prestados', color:C.navy, valores:D.meses.map(m => m.prestados) }, { nombre:'Devueltos', color:C.ambar, valores:D.meses.map(m => m.devueltos) }], { vacio:'Todavía no hay préstamos registrados.', W:640 }), { span2:true, ir:'bibReporte' })}
    ${tarjeta('Estado de los préstamos', 'Libros que están fuera ahora', I.donut(D.estadoPrest, String(D.activos), 'en préstamo'), { ir:'bibPrest' })}

    ${tarjeta('Actividad diaria', 'Préstamos y devoluciones · ' + sub30.toLowerCase(), I.linea(etqDia, [{ nombre:'Prestados', color:C.navy, valores:D.dia30.prestados }, { nombre:'Devueltos', color:C.verde, valores:D.dia30.devueltos }], { vacio:'Sin movimiento en los últimos 30 días.', W:640 }), { span2:true })}
    ${tarjeta('Devoluciones a tiempo', sub90, I.medidor(cump.pct, colorCump, 'devueltos dentro del plazo', cump.devueltos + ' devuelto(s) · promedio ' + (cump.promDias || '—') + ' día(s)' + (cump.perdidos ? ' · ' + cump.perdidos + ' perdido(s)' : '')))}

    ${tarjeta('Préstamos por día de la semana', sub90, I.columnas(['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'], [{ nombre:'Préstamos', color:C.azul, valores:D.semana }], { vacio:'Sin préstamos en los últimos 90 días.' }))}
    ${tarjeta('Libros por categoría', 'Ejemplares en la colección', I.barrasH(D.categorias, { vacio:'Aún no hay libros en el catálogo.' }), { ir:'bibLibros' })}
    ${tarjeta('Disponibilidad', 'Ejemplares en estante vs. prestados', I.donut([{ label:'Disponibles', valor:D.disponibles, color:C.verde }, { label:'Prestados', valor:D.activos, color:C.ambar }], D.totalEj ? Math.round(D.disponibles / D.totalEj * 100) + '%' : '—', 'disponible'))}

    ${tarjeta('Más prestados', sub30, I.barrasH(D.topTitulos, { rank:true, vacio:'Todavía no hay préstamos en los últimos 30 días.' }), { ir:'bibResenas' })}
    ${tarjeta('Préstamos por grado', sub90, I.barrasH(D.porGrado, { vacio:'Sin préstamos en los últimos 90 días.' }))}
    ${tarjeta('Lectores más activos', sub90, I.barrasH(D.topLectores, { rank:true, vacio:'Sin préstamos en los últimos 90 días.' }), { ir:'bibLect' })}

    ${tarjeta('Estado de conservación', 'Ejemplares según su estado', I.donut(D.conservacion, String(D.conservacion.reduce((a, c) => a + c.valor, 0)), 'ejemplares'), { ir:'bibRepExp' })}
    ${tarjeta('Reservas', 'Todas las reservas por estado', D.reservas.length ? I.donut(D.reservas, String(D.reservas.reduce((a, c) => a + c.valor, 0)), 'reservas') : I.vacio('Todavía no hay reservas.'), { ir:'bibRes' })}
    ${tarjeta('Lectores por tipo', 'Lectores registrados y activos', D.lectoresTipo.length ? I.donut(D.lectoresTipo, String(D.lectoresActivos), 'lectores') : I.vacio('Aún no hay lectores registrados.'), { ir:'bibLect' })}

    ${tarjeta('Rotación por categoría', 'Préstamos por ejemplar · últimos 12 meses', I.barrasH(D.rotacion, { vacio:'Aún no hay datos de rotación.', fmt:v => v.toFixed(2) }), { ir:'bibColec' })}
    ${tarjeta('Estantes verificados', 'Inventario hecho en los últimos 90 días', I.medidor(D.estantes.pct, colorEst, 'estantes al día', D.estantes.verificados + ' de ' + D.estantes.total + ' estante(s)'), { ir:'bibToma' })}
    ${tarjeta('Pulso de la colección', 'Lo que conviene mirar', '<ul class="hm-pulsos">' + pulso + '</ul>')}
  </div>`;
}

BIB_RENDER.bibInicio = function(){
  try{ return renderBibInicioNuevo(); }
  catch(e){ console.error('Inicio v16:', e); return renderBibInicioAnterior(); }
};
