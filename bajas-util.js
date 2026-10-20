/* SIGIE v28 — Bajas y pérdidas: actas numeradas, reposición pendiente y reversión de una baja. Lógica pura (test/bajas.test.js).
   Una baja revertida NO se borra: queda en el historial con `revertida` y deja de contarse en los inventarios. */
(function(root){
  const MOTIVOS_REPOSICION = ['Perdido','Dañado'];   // el lector responsable debe reponerlo
  const fecha = f => f ? String(f).split('-').reverse().join('/') : '';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const vigentes = bajas => (bajas||[]).filter(b => !b.revertida);
  const pendienteReposicion = b => !b.revertida && !!b.lector && MOTIVOS_REPOSICION.includes(b.motivo);
  const suma = l => l.reduce((a, b) => a + (Number(b.cant) || 0), 0);
  function filtrar(bajas, f){
    f = f || {}; const q = String(f.q||'').trim().toLowerCase();
    return (bajas||[]).filter(b => (!f.anio || String(b.fecha).startsWith(f.anio)) && (!f.motivo || b.motivo === f.motivo)
      && (f.estado==='revertidas' ? !!b.revertida : !b.revertida && (f.estado==='sinActa' ? !b.acta : f.estado==='conActa' ? !!b.acta : f.estado==='reposicion' ? pendienteReposicion(b) : true))
      && (!q || [b.cod, b.titulo, b.lector, b.obs, b.acta].some(v => String(v||'').toLowerCase().includes(q))));
  }
  function resumen(bajas, anio){
    const v = vigentes(bajas).filter(b => !anio || String(b.fecha).startsWith(anio));
    return { ejemplares:suma(v), sinActa:suma(v.filter(b => !b.acta)), reposicion:v.filter(pendienteReposicion).length, revertidas:(bajas||[]).filter(b => b.revertida && (!anio || String(b.fecha).startsWith(anio))).length };
  }
  /* Sugiere el siguiente N° de acta del año: 001-2026, 002-2026… (solo cuenta los N° con ese formato). */
  function siguienteActa(bajas, anio){
    const n = (bajas||[]).map(b => /^(\d+)-(\d{4})$/.exec(String(b.acta||''))).filter(m => m && m[2] === String(anio)).map(m => +m[1]);
    return String((n.length ? Math.max(...n) : 0) + 1).padStart(3, '0') + '-' + anio;
  }
  /* Sella con N° y fecha de acta las bajas que aún no tienen (no pisa las que ya figuran en otra acta). */
  const sellar = (bajas, ids, nro, hoy) => (bajas||[]).map(b => ids.includes(b.id) && !b.acta && !b.revertida ? { ...b, acta:nro, actaFecha:hoy } : b);
  /* Qué pasa con el catálogo al revertir: sumar ejemplares al libro que sigue existiendo, o recrearlo si se retiró por completo. */
  function reingreso(baja, libros){
    const porId = (libros||[]).find(l => l.id === baja.libroId), porCod = (libros||[]).find(l => String(l.cod).toUpperCase() === String(baja.cod).toUpperCase());
    const ex = porId || porCod, n = Number(baja.cant) || 1;
    if(ex) return { accion:'sumar', libro:{ ...ex, cant:(Number(ex.cant) || 1) + n }, completo:true };
    const snap = baja.libro, base = snap ? { ...snap } : { id:baja.libroId, cod:baja.cod, titulo:baja.titulo, autor:baja.autor || '' };
    return { accion:'crear', libro:{ ...base, cant:n }, completo:!!snap };
  }
  const revertir = (baja, motivo, hoy, por) => ({ ...baja, revertida:{ fecha:hoy, motivo, por:por || '' } });
  const MOTIVOS_REVERSION = ['Apareció el libro', 'El lector repuso el libro', 'Baja registrada por error'];
  function actaHtml(lista, { nro, fecha:f, ie }){
    const tot = suma(lista);
    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Acta de baja${nro ? ' ' + esc(nro) : ''}</title><style>body{font-family:Arial;font-size:12px;margin:24px;color:#111}h1{font-size:16px;text-align:center;margin:4px}p{margin:6px 0}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border:1px solid #777;padding:4px 6px;text-align:left}th{background:#e8ecf3}.f{display:flex;justify-content:space-around;margin-top:70px}.f div{border-top:1px solid #000;padding-top:4px;width:28%;text-align:center}@media print{button{display:none}}</style></head><body><button onclick="window.print()">🖨 Imprimir / Guardar como PDF</button>
<h1>ACTA DE BAJA DE MATERIAL BIBLIOGRÁFICO${nro ? ' N° ' + esc(nro) : ''}</h1><p style="text-align:center">${esc(ie || '')}</p><p>En la fecha ${esc(fecha(f))}, se da de baja de la biblioteca escolar los siguientes materiales, por los motivos indicados (${tot} ejemplar(es)):</p>
<table><thead><tr><th>N°</th><th>Cód.</th><th>Título / autor</th><th>Cant.</th><th>Motivo</th><th>Responsable / observación</th></tr></thead><tbody>${lista.map((b, i) => `<tr><td>${i + 1}</td><td>${esc(b.cod)}</td><td>${esc(b.titulo)}${b.autor ? ' — ' + esc(b.autor) : ''}</td><td>${b.cant}</td><td>${esc(b.motivo)}</td><td>${esc([b.lector, b.grado, b.resolucion ? 'Res. ' + b.resolucion : '', b.obs].filter(Boolean).join(' · '))}</td></tr>`).join('')}</tbody></table>
<div class="f"><div>Responsable de biblioteca</div><div>Director(a)</div><div>Representante / comité</div></div></body></html>`;
  }
  const api = { MOTIVOS_REPOSICION, MOTIVOS_REVERSION, vigentes, pendienteReposicion, filtrar, resumen, siguienteActa, sellar, reingreso, revertir, actaHtml, fecha };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SigieBajas = api;
})(typeof window !== 'undefined' ? window : globalThis);
