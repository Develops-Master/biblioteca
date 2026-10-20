/* SIGIE v25 — Reservas: avisos por WhatsApp con constancia y orden de la pantalla (las vencidas ya se liberan solas al abrir Reservas: biblioteca.js). Lógica pura (test/reservas.test.js). */
(function(root){
  const VIVAS = ['Espera','Disponible'];
  const fechaLarga = f => f ? String(f).split('-').reverse().join('/') : '';
  const clave = r => String(r.fecha||'') + String(r.id||'');
  const esListo = (r, hoy) => r.estado==='Disponible' && (!r.hasta || r.hasta >= hoy);
  /* Cuántas reservas hay en cada situación. */
  function resumen(reservas, hoy){
    const v = (reservas||[]).filter(r => VIVAS.includes(r.estado));
    const listos = v.filter(r => esListo(r, hoy));
    return { listos:listos.length, porAvisar:listos.filter(r => !r.avisado).length, espera:v.filter(r => r.estado==='Espera').length };
  }
  /* Puesto en la fila de un libro (1 = el siguiente en recibirlo). 0 si no está esperando. */
  function puesto(reservas, r){
    if(r.estado!=='Espera') return 0;
    return (reservas||[]).filter(x => x.libroId===r.libroId && x.estado==='Espera' && clave(x) <= clave(r)).length;
  }
  /* Lista para la pantalla: primero lo que ya se puede recoger (la que vence antes, arriba), luego la fila por libro. */
  function ordenar(reservas, hoy){
    const peso = r => esListo(r, hoy) ? 0 : 1;
    return (reservas||[]).filter(r => VIVAS.includes(r.estado)).slice().sort((a,b) => peso(a)-peso(b) || (peso(a)<1 ? String(a.hasta).localeCompare(String(b.hasta)) : String(a.libroId).localeCompare(String(b.libroId)) || clave(a).localeCompare(clave(b))));
  }
  function mensaje(r, libro, lector, nombreIE){
    const ie = nombreIE ? ' de ' + nombreIE : '', t = libro ? '"' + libro.titulo + '"' + (libro.cod ? ' (' + libro.cod + ')' : '') : 'el libro que pediste';
    const alumno = !lector || (lector.tipo||'Alumno')==='Alumno';
    const quien = alumno ? 'Hola, familia de ' + r.lector + '. ' : 'Hola ' + r.lector + ', ';
    return quien + (alumno ? 'El libro ' : 'el libro ') + t + (alumno ? ' que reservó en la biblioteca' + ie + ' ya está listo para recoger.' : ' que reservaste en la biblioteca' + ie + ' ya está listo para recoger.') + (r.hasta ? ' Lo guardamos hasta el ' + fechaLarga(r.hasta) + '.' : '') + ' ¡Los esperamos!';
  }
  /* Un aviso por cada reserva lista (vigente) con su enlace de WhatsApp. `normalizar` = SigieBib.normalizarTelefono. */
  function avisos({ reservas, libros, lectores, nombreIE, hoy, normalizar }){
    const L = new Map((libros||[]).map(l => [l.id, l])), P = new Map((lectores||[]).map(l => [l.id, l]));
    return ordenar(reservas, hoy).filter(r => esListo(r, hoy)).map(r => {
      const lec = P.get(r.lectorId), libro = L.get(r.libroId), tel = normalizar ? normalizar(lec && lec.tel) : { ok:false, motivo:'vacío' }, msg = mensaje(r, libro, lec, nombreIE);
      return { id:r.id, lectorId:r.lectorId, nombre:r.lector, grado:r.grado||'', libro:libro ? libro.titulo : '', hasta:r.hasta, avisado:r.avisado||'', mensaje:msg,
        telefono:tel.ok ? tel.numero : '', telefonoOriginal:(lec && lec.tel) || '', problema:tel.ok || tel.motivo==='vacío' ? '' : tel.motivo,
        url:tel.ok ? 'https://wa.me/' + tel.numero + '?text=' + encodeURIComponent(msg) : '' };
    });
  }
  const api = { resumen, puesto, ordenar, mensaje, avisos, esListo, fechaLarga };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SigieReservas = api;
})(typeof window !== 'undefined' ? window : globalThis);
