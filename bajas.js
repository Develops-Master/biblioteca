/* SIGIE v28 — Pantalla «Bajas y pérdidas»: actas numeradas (sin repetir bajas), reposición pendiente, revertir una baja, filtros y Excel. */
(function(){
  const B = window.SigieBajas, S = { anio:'', motivo:'', estado:'', q:'', sel:new Set() };
  window.bibBajVig = () => B.vigentes(bibBaj());
  const ie = () => (DB.get(KEYS.config) || {}).nombreIE || '';
  const caja = (n, t, c, f) => `<div ${f ? `data-bxe="${f}" role="button" tabindex="0" style="cursor:pointer;` : 'style="'}flex:1;min-width:120px;border-left:5px solid ${c};background:#faf7f0;border-radius:8px;padding:8px 10px;color:#1d2a38"><div style="font-size:22px;font-weight:700">${n}</div><div class="hint">${t}</div></div>`;
  const vista = () => B.filtrar(bibBaj(), S).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

  BIB_RENDER.bibBajas = function(){
    const todas = bibBaj(), anios = [...new Set(todas.map(b => String(b.fecha).slice(0, 4)))].sort(), lista = vista(), r = B.resumen(todas, S.anio), ed = canEdit();
    const pendientes = lista.filter(b => !b.acta && !b.revertida), sel = lista.filter(b => S.sel.has(b.id) && !b.acta && !b.revertida), actas = [...new Set(todas.filter(b => b.acta).map(b => b.acta))].sort();
    const motivos = [...new Set([...BIB_MOTIVOS, ...todas.map(b => b.motivo)])];
    return `<div class="toolbar noprint"><select id="bxAnio"><option value="">Todos los años</option>${anios.map(a => `<option ${S.anio === a ? 'selected' : ''}>${a}</option>`).join('')}</select>
      <select id="bxMot"><option value="">Todos los motivos</option>${motivos.map(m => `<option ${S.motivo === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
      <select id="bxEst">${[['', 'Vigentes'], ['sinActa', 'Sin acta'], ['conActa', 'Con acta'], ['reposicion', 'Reposición pendiente'], ['revertidas', 'Revertidas']].map(o => `<option value="${o[0]}" ${S.estado === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>
      <input class="search" id="bxQ" placeholder="Buscar libro, lector, acta…" value="${esc(S.q)}">
      ${ed ? `<button class="btn btn-primary" id="bxActa" ${pendientes.length ? '' : 'disabled'} title="Genera el acta con lo marcado, o con todo lo que no tiene acta">🖨 Acta de baja (${sel.length || pendientes.length})</button>` : ''}
      ${actas.length ? `<select id="bxReimp"><option value="">Reimprimir acta…</option>${actas.map(a => `<option>${esc(a)}</option>`).join('')}</select>` : ''}<button class="btn" id="bxXls">⇩ Excel</button></div>
    <div class="noprint" style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">${caja(r.ejemplares, 'Ejemplares dados de baja', '#2c5a8c', '')}${caja(r.sinActa, 'Aún sin acta', r.sinActa ? '#C77D2E' : '#b9b4a8', 'sinActa')}${caja(r.reposicion, 'Reposición pendiente (lector responsable)', r.reposicion ? '#A63A3A' : '#b9b4a8', 'reposicion')}${caja(r.revertidas, 'Revertidas', '#8a8f98', 'revertidas')}</div>
    <div class="hint" style="margin:6px 0">Se da de baja desde Libros o con «Perdido» en Préstamos. Cada baja se incluye en <b>una sola acta numerada</b>. Si el libro aparece o el lector lo repone, usa «Revertir»: vuelve al catálogo y la baja queda en el historial.</div>
    <div class="tbl-wrap"><table><thead><tr>${ed ? '<th class="noprint"></th>' : ''}<th>Fecha</th><th>Cód.</th><th>Título</th><th>Cant.</th><th>Motivo</th><th>Lector</th><th>Resolución / obs.</th><th>Acta</th>${ed ? '<th class="noprint"></th>' : ''}</tr></thead><tbody>${lista.map(b => {
      const rev = b.revertida, libre = !b.acta && !rev;
      return `<tr ${rev ? 'style="opacity:.6"' : ''}>${ed ? `<td class="noprint">${libre ? `<input type="checkbox" data-bxsel="${b.id}" ${S.sel.has(b.id) ? 'checked' : ''} aria-label="Incluir en el acta">` : ''}</td>` : ''}<td>${esc(B.fecha(b.fecha))}</td><td class="mono">${esc(b.cod)}</td><td>${esc(b.titulo)}</td><td class="num">${b.cant}</td><td>${esc(b.motivo)}${B.pendienteReposicion(b) ? ' <span class="badge badge-warn" title="Falta que el lector reponga el libro">reponer</span>' : ''}</td><td>${esc(b.lector)} ${esc(b.grado)}</td><td>${esc([b.resolucion, b.obs].filter(Boolean).join(' · '))}</td>
        <td>${rev ? `<span class="badge">Revertida ${esc(B.fecha(rev.fecha))}</span><div class="hint">${esc(rev.motivo)}</div>` : b.acta ? `<span class="badge badge-good">N° ${esc(b.acta)}</span>` : '<span class="hint">sin acta</span>'}</td>${ed ? `<td class="noprint">${rev ? '' : `<button class="btn btn-sm" data-bxrev="${b.id}">↩ Revertir</button>`}</td>` : ''}</tr>`; }).join('') || `<tr><td colspan="10" class="empty">${S.estado || S.motivo || S.q || S.anio ? 'Nada coincide con los filtros.' : 'Sin bajas registradas.'}</td></tr>`}</tbody></table></div>`;
  };

  function imprimir(lista, nro, fecha){
    const w = window.open('', '_blank'); if(!w){ toast('Permite ventanas emergentes para imprimir.', 'err'); return; }
    w.document.write(B.actaHtml(lista.slice().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))), { nro, fecha, ie:ie() })); w.document.close();
  }
  function actaModal(lista){
    if(!guardEdit()) return; if(!lista.length){ toast('No hay bajas para el acta.', 'err'); return; }
    const anio = today().slice(0, 4), tot = lista.reduce((a, b) => a + (Number(b.cant) || 0), 0);
    bibModal('Acta de baja', `<div class="field f-12"><div class="hint">${lista.length} baja(s), ${tot} ejemplar(es). Al generar el acta, estas bajas quedan marcadas con su número y no podrán incluirse en otra.</div></div>
      <div class="field f-6"><label>N° de acta</label><input id="bx_nro" value="${esc(B.siguienteActa(bibBaj(), anio))}"></div><div class="field f-6"><label>Fecha del acta</label><input id="bx_fec" type="date" value="${today()}"></div>`,
      async bg => { const nro = bibV(bg, 'bx_nro').trim(), fec = bibV(bg, 'bx_fec') || today(); if(!nro){ toast('Indica el N° de acta.', 'err'); return false; }
        if(bibBaj().some(b => b.acta === nro)){ toast('Ya existe el acta N° ' + nro + '. Usa otro número (o «Reimprimir acta» para ver la anterior).', 'err'); return false; }
        await DB.save(B2.baj, B.sellar(bibBaj(), lista.map(b => b.id), nro, fec)); registrarBitacora('Acta de baja', 'N° ' + nro + ' · ' + tot + ' ejemplar(es)');
        S.sel.clear(); imprimir(lista, nro, fec); render(); }, 'Generar e imprimir');
  }
  // El «Reporte general → Acta de bajas» pasa por aquí: imprime lo vigente, y lo que no tenga acta pide su número.
  window.bibActa = function(lista){
    const v = B.vigentes(lista); if(!v.length){ toast('No hay bajas para el acta.', 'err'); return; }
    const sin = v.filter(b => !b.acta);
    if(!sin.length){ const nros = [...new Set(v.map(b => b.acta))]; imprimir(v, nros.join(' / '), today()); return; }
    actaModal(sin);
  };
  function revertirModal(id){
    if(!guardEdit()) return; const b = bibBaj().find(x => x.id === id); if(!b || b.revertida) return;
    const ri = B.reingreso(b, bibLibros());
    bibModal('Revertir baja: ' + esc(b.cod) + ' ' + esc(b.titulo), `<div class="field f-12"><label>¿Por qué se revierte?</label><select id="bx_why">${B.MOTIVOS_REVERSION.map(m => `<option>${m}</option>`).join('')}</select></div>
      <div class="field f-12"><div class="hint">${ri.accion === 'sumar' ? 'Se sumarán ' + b.cant + ' ejemplar(es) al libro del catálogo.' : 'El libro ya no está en el catálogo: se volverá a crear con ' + b.cant + ' ejemplar(es)' + (ri.completo ? ' y todos sus datos.' : '. <b>Esta baja es antigua y no guardó todos los datos</b>: se recreará con código, título y autor; completa el resto en Libros.')}${b.prestId ? ' El préstamo que figuraba como perdido quedará como devuelto.' : ''}</div>
      ${b.acta ? `<div class="hint" style="color:#A63A3A;margin-top:6px">Esta baja ya figura en el acta N° ${esc(b.acta)}: el acta impresa no cambia; la reversión queda registrada aquí.</div>` : ''}</div>`,
      async bg => { const motivo = bibV(bg, 'bx_why'), por = (STATE.session && (STATE.session.nombre || STATE.session.usuario)) || '';
        await DB.save(BKEYS.libros, ri.accion === 'sumar' ? bibLibros().map(l => l.id === ri.libro.id ? ri.libro : l) : [...bibLibros(), ri.libro]);
        if(b.prestId) await DB.save(BKEYS.prest, bibPrest().map(p => p.id === b.prestId && p.perdido ? { ...p, perdido:false } : p));
        await DB.save(B2.baj, bibBaj().map(x => x.id === id ? B.revertir(x, motivo, today(), por) : x)); registrarBitacora('Baja revertida', b.cod + ' · ' + motivo + ' x' + b.cant);
        toast('Baja revertida: ' + b.cant + ' ejemplar(es) de vuelta en el catálogo.', 'ok'); render(); }, 'Revertir baja');
  }
  function excel(){
    const l = vista(); if(!l.length){ toast('No hay bajas para exportar con estos filtros.', 'err'); return; }
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Fecha','Cód.','Título','Autor','Categoría','Cant.','Motivo','Lector','Grado','Resolución','Observación','Responsable','N° acta','Fecha acta','Estado'],
      ...l.map(b => [b.fecha, b.cod, b.titulo, b.autor, b.cat, b.cant, b.motivo, b.lector, b.grado, b.resolucion, b.obs, b.responsable, b.acta || '', b.actaFecha || '', b.revertida ? 'Revertida ' + b.revertida.fecha + ' (' + b.revertida.motivo + ')' : B.pendienteReposicion(b) ? 'Reposición pendiente' : 'Vigente'])]), 'Bajas');
    XLSX.writeFile(wb, 'biblioteca-bajas-' + today() + '.xlsx');
  }
  document.addEventListener('click', e => { const t = e.target; if(!t || !t.closest) return;
    const c = t.closest('[data-bxe]'); if(c){ S.estado = S.estado === c.dataset.bxe ? '' : c.dataset.bxe; render(); return; }
    const rv = t.closest('[data-bxrev]'); if(rv){ revertirModal(rv.dataset.bxrev); return; }
    if(t.closest('#bxActa')){ const l = vista().filter(b => !b.acta && !b.revertida), s = l.filter(b => S.sel.has(b.id)); actaModal(s.length ? s : l); return; }
    if(t.closest('#bxXls')) excel(); });
  document.addEventListener('keydown', e => { const f = e.target && e.target.closest && e.target.closest('[data-bxe]'); if(f && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); f.click(); } });
  document.addEventListener('change', e => { const t = e.target; if(!t || !t.id && !(t.dataset && t.dataset.bxsel)) return;
    if(t.dataset.bxsel){ t.checked ? S.sel.add(t.dataset.bxsel) : S.sel.delete(t.dataset.bxsel); render(); return; }
    if(t.id === 'bxAnio'){ S.anio = t.value; render(); } else if(t.id === 'bxMot'){ S.motivo = t.value; render(); } else if(t.id === 'bxEst'){ S.estado = t.value; render(); }
    else if(t.id === 'bxReimp' && t.value){ const l = bibBaj().filter(b => b.acta === t.value && !b.revertida); if(l.length) imprimir(l, t.value, l[0].actaFecha || today()); t.value = ''; } });
  document.addEventListener('input', e => { if(!e.target || e.target.id !== 'bxQ') return; S.q = e.target.value; const p = e.target.selectionStart; render(); const n = document.getElementById('bxQ'); if(n){ n.focus(); try{ n.setSelectionRange(p, p); }catch(x){} } });
})();
