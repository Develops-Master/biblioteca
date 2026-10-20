/* SIGIE v26 — Préstamos: situación de cada préstamo (por vencer, atraso), prioridad, recordatorio por WhatsApp y CSV.
   Lógica pura (test/prestamos.test.js). La pantalla está en prestamos.js. */
(function(root){
  const POR_VENCER = 2; // «por vencer»: vence hoy o dentro de 2 días
  const dias = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
  const fecha = f => f ? String(f).split('-').reverse().join('/') : '';
  /* Estado de un préstamo hoy. `dias`: atraso (vencido) o días que faltan (por vencer). */
  function situacion(p, hoy){
    if(p.perdido) return { estado:'Perdido', dias:0 };
    if(p.devuelto) return { estado:'Devuelto', dias:0 };
    if(!p.vence) return { estado:'Prestado', dias:0 };
    const d = dias(hoy, p.vence);
    if(d < 0) return { estado:'Vencido', dias:-d };
    if(d <= POR_VENCER) return { estado:'Por vencer', dias:d };
    return { estado:'Prestado', dias:d };
  }
  function textoVence(s){
    if(s.estado==='Vencido') return 'hace ' + s.dias + (s.dias===1 ? ' día' : ' días');
    if(s.estado==='Por vencer') return s.dias===0 ? 'vence hoy' : s.dias===1 ? 'vence mañana' : 'en ' + s.dias + ' días';
    if(s.estado==='Prestado' && s.dias) return 'en ' + s.dias + ' días';
    return '';
  }
  function resumen(prestamos, hoy){
    const r = { activos:0, porVencer:0, vencidos:0, devueltosHoy:0 };
    (prestamos||[]).forEach(p => { const s = situacion(p, hoy);
      if(s.estado==='Vencido'){ r.vencidos++; r.activos++; } else if(s.estado==='Por vencer'){ r.porVencer++; r.activos++; } else if(s.estado==='Prestado') r.activos++;
      else if(s.estado==='Devuelto' && p.devuelto===hoy) r.devueltosHoy++; });
    return r;
  }
  /* Filtro de la pantalla: 'Prestado' = lo que está afuera sin atraso (incluye por vencer), como siempre; 'Por vencer' es un subconjunto. */
  const coincide = (s, filtro) => !filtro || s.estado===filtro || (filtro==='Prestado' && s.estado==='Por vencer');
  /* Lo urgente primero: más atrasados, luego los que vencen antes, luego lo ya cerrado (lo más reciente arriba). */
  function ordenar(prestamos, hoy){
    const peso = s => s.estado==='Vencido' ? 0 : s.estado==='Por vencer' ? 1 : s.estado==='Prestado' ? 2 : 3;
    return (prestamos||[]).map(p => ({ p, s:situacion(p, hoy) })).sort((a, b) => {
      const d = peso(a.s) - peso(b.s); if(d) return d;
      if(a.s.estado==='Vencido') return b.s.dias - a.s.dias || String(a.p.lector).localeCompare(String(b.p.lector), 'es');
      if(peso(a.s) < 3) return String(a.p.vence).localeCompare(String(b.p.vence));
      return String(b.p.devuelto||'').localeCompare(String(a.p.devuelto||''));
    });
  }
  function mensaje(p, libro, lector, nombreIE, hoy){
    const ie = nombreIE ? ' de ' + nombreIE : '', t = libro ? '"' + libro.titulo + '"' + (libro.cod ? ' (' + libro.cod + ')' : '') : 'el libro prestado';
    const alumno = !lector || (lector.tipo||'Alumno')==='Alumno', s = situacion(p, hoy || p.vence);
    const atraso = s.estado==='Vencido' ? ' (' + s.dias + (s.dias===1 ? ' día' : ' días') + ' de atraso)' : '';
    return (alumno ? 'Hola, familia de ' + p.lector + '. Les recordamos desde la biblioteca' + ie + ' que ' + p.lector + ' debe devolver el libro ' : 'Hola ' + p.lector + ', desde la biblioteca' + ie + ' te recordamos devolver el libro ')
      + t + ', prestado el ' + fecha(p.fecha) + ' y con vencimiento el ' + fecha(p.vence) + atraso + '. ¡Gracias!';
  }
  /* Recordatorio de un préstamo con el celular guardado en la ficha del lector. `normalizar` = SigieBib.normalizarTelefono. */
  function recordatorio(p, libro, lector, nombreIE, hoy, normalizar){
    const tel = normalizar ? normalizar(lector && lector.tel) : { ok:false, motivo:'vacío' }, msg = mensaje(p, libro, lector, nombreIE, hoy);
    return { id:p.id, lectorId:p.lectorId, nombre:p.lector, libro:libro ? libro.titulo : '', mensaje:msg, telefono:tel.ok ? tel.numero : '', telefonoOriginal:(lector && lector.tel) || '',
      problema:tel.ok || tel.motivo==='vacío' ? '' : tel.motivo, url:tel.ok ? 'https://wa.me/' + tel.numero + '?text=' + encodeURIComponent(msg) : '' };
  }
  const celda = v => { const t = String(v == null ? '' : v); return /[",;\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  function csv(filas, libros, hoy){
    const L = new Map((libros||[]).map(l => [l.id, l])), cab = ['Código libro','Título','Lector','Grado','Prestado','Vence','Estado','Días de atraso','Devuelto','Renovaciones','Último aviso'];
    return [cab, ...filas.map(({ p, s }) => { const l = L.get(p.libroId) || {};
      return [l.cod||'', l.titulo||'', p.lector||'', p.grado||'', p.fecha||'', p.vence||'', s.estado, s.estado==='Vencido' ? s.dias : '', p.devuelto||'', p.renov||0, p.avisado||'']; })]
      .map(f => f.map(celda).join(',')).join('\r\n');
  }
  const api = { POR_VENCER, situacion, textoVence, resumen, coincide, ordenar, mensaje, recordatorio, csv, fecha };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SigiePrestamos = api;
})(typeof window !== 'undefined' ? window : globalThis);
