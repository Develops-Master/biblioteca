/* SIGIE v25 — Pantalla «Reservas»: tarjetas de estado, avisos por WhatsApp con constancia, historial y aviso automático al siguiente. */
(function(){
  const R = window.SigieReservas, $ = id => document.getElementById(id), RV = { q:'', hist:false };
  const ie = () => (DB.get(KEYS.config) || {}).nombreIE || '';
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const avisos = () => R.avisos({ reservas:bibRes(), libros:bibLibros(), lectores:bibLect(), nombreIE:ie(), hoy:today(), normalizar:SigieBib.normalizarTelefono });
  const caja = (n, t, c) => `<div style="flex:1;min-width:120px;border-left:5px solid ${c};background:#faf7f0;border-radius:8px;padding:8px 10px;color:#1d2a38"><div style="font-size:22px;font-weight:700">${n}</div><div class="hint">${t}</div></div>`;
  const aviso = a => a.avisado ? `<span class="badge badge-good" title="Ya se le avisó">✔ avisado ${esc(R.fechaLarga(a.avisado))}</span>` : '<span class="badge badge-warn">sin avisar</span>';

  BIB_RENDER.bibRes = function(){
    const hoy = today(), lib = new Map(bibLibros().map(l => [l.id, l])), lec = new Map(bibLect().map(l => [l.id, l])), todas = bibRes(), s = R.resumen(todas, hoy), q = norm(RV.q);
    const txt = r => norm((lib.get(r.libroId) || {}).titulo + ' ' + (lib.get(r.libroId) || {}).cod + ' ' + r.lector);
    const vivas = R.ordenar(todas, hoy).filter(r => !q || txt(r).includes(q));
    const hist = RV.hist ? todas.filter(r => ['Atendida', 'Cancelada', 'Vencida'].includes(r.estado)).filter(r => !q || txt(r).includes(q)).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 60) : [];
    const ed = canEdit(), nl = r => `<span class="mono">${esc((lib.get(r.libroId) || {}).cod || '')}</span> ${esc((lib.get(r.libroId) || {}).titulo || '(libro eliminado)')}`;
    const estado = r => r.estado === 'Disponible' ? `<span class="badge badge-good">Listo · hasta ${esc(R.fechaLarga(r.hasta))}</span>` : `<span class="badge badge-warn">En espera · puesto ${R.puesto(todas, r)}</span>`;
    const tel = r => { const l = lec.get(r.lectorId), n = SigieBib.normalizarTelefono(l && l.tel); return n.ok ? '📱' : '<span title="Sin celular válido: se pedirá al avisar" style="opacity:.5">📵</span>'; };
    const acciones = r => !ed ? '' : `<td class="noprint">${R.esListo(r, hoy) ? `<button class="btn btn-sm" data-brpre="${r.id}">Prestar</button> <button class="btn btn-sm btn-primary" data-rvav="${r.id}">💬 Avisar</button> ` : ''}<button class="btn btn-sm btn-danger" data-brcan="${r.id}">Cancelar</button></td>`;
    return `<div class="toolbar noprint">${ed ? '<button class="btn btn-primary" id="brNueva">+ Nueva reserva</button>' : ''}${ed && s.porAvisar ? `<button class="btn btn-primary" id="rvTodos">💬 Avisar a los ${s.porAvisar} que ya pueden recoger</button>` : ''}<button class="btn" id="bibReglas">⚙ Reglas de préstamo</button>
      <input class="search" id="rvQ" placeholder="Buscar libro o lector…" value="${esc(RV.q)}"><label class="hint" style="display:flex;gap:4px;align-items:center"><input type="checkbox" id="rvHist" ${RV.hist ? 'checked' : ''}> Ver historial</label></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">${caja(s.listos, 'Listos para recoger', '#3E6B4F')}${caja(s.porAvisar, 'Por avisar', '#2c5a8c')}${caja(s.espera, 'En lista de espera', '#C77D2E')}</div>
    <div class="hint" style="margin:6px 0">Al devolverse un libro con lista de espera, se aparta para el primero de la fila durante ${bibCfg().reservaDias} día(s). Las que nadie recoge a tiempo se liberan solas al abrir esta pantalla. Al avisar por WhatsApp se abre el chat con el mensaje escrito y queda marcado como avisado.</div>
    <div class="tbl-wrap"><table><thead><tr><th>Libro</th><th>Lector</th><th>Grado</th><th>Pidió</th><th>Estado</th><th>Aviso</th>${ed ? '<th class="noprint"></th>' : ''}</tr></thead><tbody>${vivas.map(r => `<tr><td>${nl(r)}</td><td>${tel(r)} ${esc(r.lector)}</td><td>${esc(r.grado)}</td><td>${esc(R.fechaLarga(r.fecha))}${r.origen === 'OPAC' ? ' <span class="badge" title="Reservada por el lector desde el catálogo público">OPAC</span>' : ''}</td><td>${estado(r)}</td><td>${r.estado === 'Disponible' ? aviso({ avisado:r.avisado }) : '<span class="hint">—</span>'}</td>${acciones(r)}</tr>`).join('') || `<tr><td colspan="7" class="empty">${q ? 'Nada coincide con la búsqueda.' : 'No hay reservas pendientes.'}</td></tr>`}</tbody></table></div>
    ${RV.hist ? `<h3 style="margin:16px 0 6px">Historial reciente</h3><div class="tbl-wrap"><table><thead><tr><th>Libro</th><th>Lector</th><th>Pidió</th><th>Resultado</th></tr></thead><tbody>${hist.map(r => `<tr><td>${nl(r)}</td><td>${esc(r.lector)}</td><td>${esc(R.fechaLarga(r.fecha))}</td><td><span class="badge ${r.estado === 'Atendida' ? 'badge-good' : 'badge-warn'}">${r.estado === 'Atendida' ? 'Atendida (se prestó)' : r.estado === 'Vencida' ? 'Venció sin recoger' : 'Cancelada'}</span></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Sin historial.</td></tr>'}</tbody></table></div>` : ''}`;
  };

  const marcar = async ids => { await DB.save(B2.res, bibRes().map(r => ids.includes(r.id) ? { ...r, avisado:today() } : r)); };
  const abrir = async a => { window.open(a.url, '_blank', 'noopener'); await marcar([a.id]); registrarBitacora('Aviso de reserva', a.nombre + ' · ' + a.libro); };
  function pedirCelular(a, luego){
    bibModal('Celular para avisar', `<div class="field f-12"><label>Celular de ${esc(a.nombre)} (o de su familia)</label><input id="rv_tel" inputmode="tel" placeholder="987654321" value="${esc(a.telefonoOriginal)}">${a.problema ? `<div class="hint">Lo guardado no sirve: ${esc(a.problema)}</div>` : ''}<div class="hint">Se guarda en la ficha del lector.</div></div>`,
      async bg => { const n = SigieBib.normalizarTelefono(bibV(bg, 'rv_tel')); if(!n.ok){ toast('Ese celular no sirve para WhatsApp: ' + n.motivo + '.', 'err'); return false; }
        const corto = n.numero.startsWith('51') && n.numero.length === 11 ? n.numero.slice(2) : n.numero;
        await DB.save(BKEYS.lect, bibLect().map(l => l.id === a.lectorId ? { ...l, tel:corto } : l)); toast('Celular guardado.', 'ok'); luego && luego(); }, 'Guardar y avisar');
  }
  window.bibPedirCelular = pedirCelular; // lo reutiliza Préstamos (prestamos.js)
  async function avisarUno(id){
    const a = avisos().find(x => x.id === id); if(!a){ toast('Esa reserva ya no está lista (venció o se canceló).', 'err'); render(); return; }
    if(!a.url){ pedirCelular(a, async () => { const b = avisos().find(x => x.id === id); if(b && b.url) await abrir(b); render(); }); return; }
    await abrir(a); render();
  }
  function modalTodos(){
    const ui = { soloNuevos:true }, lista = () => avisos().filter(a => !ui.soloNuevos || !a.avisado);
    const cuerpo = l => `<div class="note-banner">WhatsApp no permite enviar a muchas personas de golpe desde una página. Se abre <b>un chat por reserva</b> con el mensaje ya escrito; solo pulsas Enviar. Cada aviso queda marcado.</div>
      <div class="toolbar noprint" style="margin:8px 0"><label class="hint"><input type="checkbox" id="rvSN" ${ui.soloNuevos ? 'checked' : ''}> Solo los que aún no tienen aviso</label></div>
      <div class="tbl-wrap"><table><thead><tr><th>Lector</th><th>Libro</th><th>Hasta</th><th>Celular</th><th>Aviso</th><th></th></tr></thead><tbody>${l.map((a, i) => `<tr><td><b>${esc(a.nombre)}</b><br><span class="hint">${esc(a.grado)}</span></td><td>${esc(a.libro)}</td><td>${esc(R.fechaLarga(a.hasta))}</td><td>${a.url ? '📱 +' + esc(a.telefono) : `<span class="hint">${esc(a.problema || 'sin celular')}</span>`}</td><td>${aviso(a)}</td><td>${a.url ? `<button class="btn btn-sm btn-primary" data-rvab="${i}">💬 WhatsApp</button>` : `<button class="btn btn-sm" data-rvcel="${i}">Escribir celular</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No hay avisos pendientes. 🎉</td></tr>'}</tbody></table></div>`;
    const bg = bibModal('Avisar a los que ya pueden recoger', cuerpo(lista()), () => true, 'Cerrar', '900px'); const c = bg.querySelector('#bmC'); if(c) c.style.display = 'none';
    const pintar = () => { const l = lista(), mb = bg.querySelector('.m-b'); mb.innerHTML = cuerpo(l);
      mb.querySelector('#rvSN').onchange = e => { ui.soloNuevos = e.target.checked; pintar(); };
      mb.querySelectorAll('[data-rvab]').forEach(b => b.onclick = async () => { await abrir(l[+b.dataset.rvab]); pintar(); });
      mb.querySelectorAll('[data-rvcel]').forEach(b => b.onclick = () => pedirCelular(l[+b.dataset.rvcel], pintar)); };
    pintar();
  }
  document.addEventListener('click', e => { const t = e.target; if(!t || !t.closest) return;
    const av = t.closest('[data-rvav]'); if(av){ if(guardEdit()) avisarUno(av.dataset.rvav); return; }
    if(t.closest('#rvTodos')){ if(guardEdit()) modalTodos(); return; } });
  document.addEventListener('change', e => { if(e.target && e.target.id === 'rvHist'){ RV.hist = e.target.checked; render(); } });
  document.addEventListener('input', e => { if(!e.target || e.target.id !== 'rvQ') return; RV.q = e.target.value; const p = e.target.selectionStart; render(); const n = $('rvQ'); if(n){ n.focus(); try{ n.setSelectionRange(p, p); }catch(x){} } });
})();
