/* SIGIE v26 — Pantalla «Préstamos y devoluciones»: tarjetas por situación, atraso en días, orden por urgencia,
   recordatorio por WhatsApp con el celular de la ficha (y constancia) y CSV. */
(function(){
  const P = window.SigiePrestamos, TOPE = 300;
  const ie = () => (DB.get(KEYS.config) || {}).nombreIE || '';
  const caja = (n, t, c, f) => `<div data-pmf="${f}" role="button" tabindex="0" title="Ver solo: ${t}" style="cursor:pointer;flex:1;min-width:120px;border-left:5px solid ${c};background:#faf7f0;border-radius:8px;padding:8px 10px;color:#1d2a38"><div style="font-size:22px;font-weight:700">${n}</div><div class="hint">${t}</div></div>`;
  const filas = () => { const hoy = today(), q = bibPf.q.trim().toLowerCase(), L = new Map(bibLibros().map(l => [l.id, l]));
    return P.ordenar(bibPrest(), hoy).filter(x => P.coincide(x.s, bibPf.est) && (!q || (() => { const l = L.get(x.p.libroId) || {}; return [x.p.lector, x.p.grado, l.cod, l.titulo].some(v => String(v || '').toLowerCase().includes(q)); })())); };

  BIB_RENDER.bibPrest = function(){
    const hoy = today(), libros = new Map(bibLibros().map(l => [l.id, l])), todas = filas(), lista = todas.slice(0, TOPE), r = P.resumen(bibPrest(), hoy), ed = canEdit();
    const insignia = s => ({ Vencido:'badge-bad', 'Por vencer':'badge-warn', Prestado:'badge-info', Devuelto:'badge-good', Perdido:'badge-bad' })[s.estado];
    const borde = s => ({ Vencido:'#A63A3A', 'Por vencer':'#C77D2E', Prestado:'#2c5a8c' })[s.estado] || 'transparent';
    const ids = new Set(bibLect().filter(x => x.baja).map(x => x.id)), nb = bibPrest().filter(p => !p.devuelto && ids.has(p.lectorId)).length, u = (DB.get(B2.cfg) || {}).ultimoRespaldo;
    return `<div class="toolbar noprint"><input class="search" id="bpQ" placeholder="Buscar lector, grado, libro…" value="${esc(bibPf.q)}"><select id="bpEst"><option value="">Todos</option>${['Prestado','Por vencer','Vencido','Devuelto','Perdido'].map(e => `<option ${bibPf.est === e ? 'selected' : ''}>${e}</option>`).join('')}</select>${ed ? '<button class="btn btn-primary" id="bibNuevoPrest">+ Nuevo préstamo</button><button class="btn" id="bibAula">👥 Préstamo por aula</button><button class="btn" id="bibAulaDev">↩ Devolución por aula</button>' : ''}<button class="btn" id="bibMorosos">📋 Morosos por grado</button>${ed ? '<button class="btn" id="bibReglas">⚙ Reglas</button>' : ''}<button class="btn" id="pmCsv">⇩ CSV</button><button class="btn" onclick="window.print()">🖨 Imprimir</button></div>
    <div class="noprint" style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">${caja(r.vencidos, 'Vencidos', r.vencidos ? '#A63A3A' : '#b9b4a8', 'Vencido')}${caja(r.porVencer, 'Por vencer (hoy a 2 días)', '#C77D2E', 'Por vencer')}${caja(r.activos, 'Prestados ahora', '#2c5a8c', 'Prestado')}${caja(r.devueltosHoy, 'Devueltos hoy', '#3E6B4F', 'Devuelto')}</div>
    ${nb ? `<div class="note-banner">${nb} libro(s) siguen en manos de lectores dados de baja (egresados): búscalos por su nombre y reclámalos o márcalos como perdidos.</div>` : ''}${(!u || bibDias(u, hoy) > 14) ? '<div class="note-banner">Hace más de 14 días que no descargas un respaldo de la biblioteca (Reporte general → 💾 Respaldo).</div>' : ''}
    <div class="tbl-wrap"><table><thead><tr><th>Libro</th><th>Lector</th><th>Grado / sección</th><th>Prestado</th><th>Vence</th><th>Estado</th>${ed ? '<th class="noprint"></th>' : ''}</tr></thead><tbody>
    ${lista.map(({ p, s }) => { const l = libros.get(p.libroId) || {}, tv = P.textoVence(s), e = s.estado, abierto = e === 'Vencido' || e === 'Por vencer' || e === 'Prestado';
      return `<tr style="box-shadow:inset 4px 0 0 ${borde(s)}"><td><span class="mono">${esc(l.cod)}</span> ${esc(l.titulo)}</td><td>${esc(p.lector)}</td><td>${esc(p.grado)}</td><td>${esc(P.fecha(p.fecha))}</td><td>${esc(P.fecha(p.vence))}${tv ? `<div class="hint" style="${e === 'Vencido' ? 'color:#A63A3A;font-weight:700' : ''}">${tv}</div>` : ''}</td>
      <td><span class="badge ${insignia(s)}">${e === 'Devuelto' ? 'Devuelto ' + esc(P.fecha(p.devuelto)) : e}</span>${p.renov ? `<div class="hint">renovado ${p.renov}×</div>` : ''}${p.avisado && abierto ? `<div class="hint">✔ avisado ${esc(P.fecha(p.avisado))}</div>` : ''}</td>
      ${ed ? `<td class="noprint">${abierto ? `<button class="btn btn-sm" data-bibdev="${p.id}">Devolver</button> <button class="btn btn-sm" data-bibren="${p.id}" title="Renovar por los días que corresponden al tipo de lector">Renovar</button> <button class="btn btn-sm" data-bibper="${p.id}" title="Marcar como perdido">Perdido</button> ${e === 'Vencido' || e === 'Por vencer' ? `<button class="btn btn-sm ${e === 'Vencido' ? 'btn-primary' : ''}" data-pmrec="${p.id}">💬 Recordar</button>` : ''}` : ''}</td>` : ''}</tr>`; }).join('') || '<tr><td colspan="7" class="empty">Sin préstamos para mostrar.</td></tr>'}
    </tbody></table></div>${todas.length > TOPE ? `<div class="hint" style="margin:6px 0">Se muestran los ${TOPE} más urgentes de ${todas.length}. Usa el buscador o el filtro de estado para ver el resto, o descarga el CSV completo.</div>` : ''}`;
  };

  async function recordar(id){
    const p = bibPrest().find(x => x.id === id); if(!p) return;
    const a = P.recordatorio(p, bibLibros().find(l => l.id === p.libroId), bibLect().find(l => l.id === p.lectorId), ie(), today(), SigieBib.normalizarTelefono);
    const abrir = async x => { window.open(x.url, '_blank', 'noopener'); await DB.save(BKEYS.prest, bibPrest().map(q => q.id === id ? { ...q, avisado:today() } : q)); registrarBitacora('Recordatorio de devolución', x.nombre + ' · ' + x.libro); render(); };
    if(a.url) return abrir(a);
    window.bibPedirCelular({ ...a, lectorId:p.lectorId }, () => { const b = P.recordatorio(bibPrest().find(x => x.id === id), bibLibros().find(l => l.id === p.libroId), bibLect().find(l => l.id === p.lectorId), ie(), today(), SigieBib.normalizarTelefono); if(b.url) abrir(b); });
  }
  window.bibRecordar = recordar; // el modal «Morosos por grado» también usa el celular de la ficha y deja constancia
  document.addEventListener('click', e => { const t = e.target; if(!t || !t.closest) return;
    const f = t.closest('[data-pmf]'); if(f){ bibPf.est = bibPf.est === f.dataset.pmf ? '' : f.dataset.pmf; render(); return; }
    const r = t.closest('[data-pmrec]'); if(r){ if(guardEdit()) recordar(r.dataset.pmrec); return; }
    if(t.closest('#pmCsv')){ const x = filas(); if(!x.length){ toast('No hay préstamos para exportar con este filtro.', 'err'); return; } bibDescargar('prestamos_' + today() + '.csv', P.csv(x, bibLibros(), today()), 'text/csv;charset=utf-8'); } });
  document.addEventListener('keydown', e => { const f = e.target && e.target.closest && e.target.closest('[data-pmf]'); if(f && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); f.click(); } });
})();
