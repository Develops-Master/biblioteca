/* SIGIE v27 — Pantalla «Mostrador (escáner)»: resultado grande y con sonido, ficha del lector con avisos, DNI, ubicación del libro devuelto,
   deshacer el último movimiento y cierre del lector por inactividad. Envuelve el escaneo existente (bibMostScan). */
(function(){
  const M = window.SigieMostrador, IDLE = 180000, S = { banner:null, accion:null, ultimo:Date.now(), sonido:true };
  try{ S.sonido = localStorage.getItem('sigie_bm_sonido') !== '0'; }catch(e){}
  const foto = () => M.foto(bibPrest(), bibRes()), hora = () => new Date().toLocaleTimeString('es-PE');
  const sancs = () => typeof bibSancVigentes === 'function' ? bibSancVigentes() : [];
  let audio = null;
  function pitido(ok){ if(!S.sonido) return; try{ const C = window.AudioContext || window.webkitAudioContext; if(!C) return; audio = audio || new C(); const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = ok ? 880 : 200; o.type = ok ? 'sine' : 'square'; g.gain.value = .12; o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? .09 : .3)); }catch(e){} }
  const ubicacion = p => { const l = p && bibLibros().find(x => x.id === p.libroId); return l && l.ubi ? 'Colócalo en el estante: ' + l.ubi : ''; };

  BIB_RENDER.bibMost = function(){
    const l = bibM.lec, ed = canEdit(), b = S.banner, hoy = today();
    const f = l ? M.ficha(l, { prestamos:bibPrest(), reservas:bibRes(), libros:bibLibros(), sanciones:sancs(), cfg:bibCfg(), hoy }) : null;
    const color = { mal:'#A63A3A', info:'#2c5a8c' }, insig = { Vencido:'badge-bad', 'Por vencer':'badge-warn', Prestado:'badge-info' };
    const aviso = b ? `<div role="status" aria-live="polite" style="margin:10px 0;padding:14px 16px;border-radius:12px;border:2px solid ${b.ok ? '#3E6B4F' : '#A63A3A'};background:${b.ok ? '#e6f2ea' : '#f8e3e3'};color:#1d2a38"><div style="font-size:20px;font-weight:700">${b.ok ? '✔' : '✖'} ${esc(b.t)}</div>${b.extra ? `<div style="font-size:16px;margin-top:4px">📍 ${esc(b.extra)}</div>` : ''}${ed && S.accion && M.puedeDeshacer(S.accion, foto()) ? '<div style="margin-top:8px"><button class="btn btn-sm" id="bmUndo">↩ Deshacer este movimiento</button></div>' : ''}</div>` : '';
    return `<div class="card" style="padding:14px"><div class="hint">1) Escanea el carné (LEC-…) o escribe el DNI  2) Escanea cada libro: si está libre se presta, si lo tiene este lector se devuelve. Sin carné, escanear un libro prestado lo devuelve. El lector se cierra solo tras 3 minutos sin actividad.</div>
      <input id="bmIn" autofocus autocomplete="off" placeholder="Escanea aquí (carné LEC-…, DNI, código del libro o ISBN) + Enter" style="width:100%;font-size:18px;padding:10px;margin:10px 0">
      <label class="hint" style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" id="bmSnd" ${S.sonido ? 'checked' : ''}> Sonido al escanear</label>${aviso}
      ${l ? `<div style="font-size:16px;margin-top:6px"><b>${esc(l.nombre)}</b> · ${esc(l.tipo)}${l.grado ? ' · ' + esc(l.grado) : ''} <button class="btn btn-sm" id="bmOtro">Siguiente lector</button></div>
        <div class="hint" style="margin:4px 0">${f.enMano.length} libro(s) en su poder · ${f.puede ? 'puede llevar ' + f.quedan + ' más (' + f.dias + ' días)' : '<b style="color:#A63A3A">no puede llevar más ahora</b>'}</div>
        ${f.avisos.map(a => `<div style="margin:3px 0;padding:6px 10px;border-left:5px solid ${color[a.nivel]};background:#faf7f0;border-radius:6px;color:#1d2a38">${esc(a.t)}</div>`).join('')}
        ${f.enMano.length ? `<div class="tbl-wrap" style="margin-top:6px"><table><thead><tr><th>En su poder</th><th>Vence</th><th></th><th></th></tr></thead><tbody>${f.enMano.map(x => `<tr><td><span class="mono">${esc(x.cod)}</span> ${esc(x.titulo)}</td><td>${esc(M.fecha(x.vence))}</td><td><span class="badge ${insig[x.estado]}">${x.estado === 'Vencido' ? 'Vencido hace ' + x.dias + ' d' : x.estado === 'Por vencer' ? (x.dias === 0 ? 'Vence hoy' : 'Vence en ' + x.dias + ' d') : 'Prestado'}</span></td><td>${ed ? `<button class="btn btn-sm" data-mdev="${x.id}">Devolver</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}`
      : '<div style="margin-top:6px" class="hint">Sin lector seleccionado.</div>'}</div>
      <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>Hora</th><th>Resultado</th></tr></thead><tbody>${bibM.log.map(x => `<tr><td>${x.h}</td><td style="color:${x.ok ? 'var(--good)' : 'var(--bad)'}">${x.ok ? '✔' : '✖'} ${esc(x.t)}</td></tr>`).join('') || '<tr><td colspan="2" class="empty">Aún sin movimientos.</td></tr>'}</tbody></table></div>`;
  };

  const previo = window.bibMostScan;
  window.bibMostScan = async function(raw){
    const r = M.resolver(raw, { lectores:bibLect(), libros:bibLibros() }); if(!String(raw || '').trim()) return;
    const antes = foto(), l0 = bibM.log[0]; S.ultimo = Date.now();
    await previo(r.tipo === 'lector' && r.porDni ? r.lector.cod : raw);
    const despues = foto(), msg = bibM.log[0] !== l0 ? bibM.log[0] : { ok:false, t:'No se pudo leer: ' + String(raw).trim() };
    let extra = ''; if(M.hayCambio(antes, despues)){ const c = M.cambios(antes, despues); extra = c.devueltos.length === 1 ? ubicacion(c.devueltos[0]) : ''; S.accion = { antes, despues, texto:msg.t }; }
    S.banner = { ok:msg.ok, t:msg.t, extra }; pitido(msg.ok); render();
  };
  async function devolverDesdeFicha(id){
    if(!guardEdit()) return; const antes = foto(), p = await bibDevolver(id); if(!p) return; S.ultimo = Date.now();
    const l = bibLibros().find(x => x.id === p.libroId) || {}, t = 'Devuelto: ' + (l.cod || '') + ' ' + (l.titulo || '') + ' (' + p.lector + ')';
    bibM.log.unshift({ ok:true, t, h:hora() }); bibM.log = bibM.log.slice(0, 15); S.accion = { antes, despues:foto(), texto:t }; S.banner = { ok:true, t, extra:ubicacion(p) }; pitido(true); render();
    if(typeof bibResenaPedir === 'function') bibResenaPedir(p.id);
  }
  async function deshacer(){
    if(!guardEdit()) return; const a = S.accion;
    if(!a || !M.puedeDeshacer(a, foto())){ toast('No se puede deshacer: ya hubo otros cambios después.', 'err'); S.accion = null; render(); return; }
    await DB.save(BKEYS.prest, JSON.parse(a.antes.p)); await DB.save(B2.res, JSON.parse(a.antes.r)); registrarBitacora('Mostrador: movimiento deshecho', a.texto);
    const t = 'Deshecho: ' + a.texto; bibM.log.unshift({ ok:true, t, h:hora() }); bibM.log = bibM.log.slice(0, 15); S.accion = null; S.banner = { ok:true, t, extra:'' }; S.ultimo = Date.now(); render();
  }
  function revisarInactividad(ahora){
    if(!bibM.lec || STATE.view !== 'bibMost' || (ahora || Date.now()) - S.ultimo <= IDLE) return false;
    bibM.lec = null; S.banner = { ok:true, t:'Lector cerrado por inactividad. Escanea un carné para continuar.', extra:'' }; render(); return true;
  }
  window.SigieMostrador.revisarInactividad = revisarInactividad;
  setInterval(() => revisarInactividad(Date.now()), 15000);
  document.addEventListener('click', e => { const t = e.target; if(!t || !t.closest) return;
    const d = t.closest('[data-mdev]'); if(d){ devolverDesdeFicha(d.dataset.mdev); return; } if(t.closest('#bmUndo')) deshacer(); });
  document.addEventListener('change', e => { if(e.target && e.target.id === 'bmSnd'){ S.sonido = e.target.checked; try{ localStorage.setItem('sigie_bm_sonido', S.sonido ? '1' : '0'); }catch(x){} } });
})();
