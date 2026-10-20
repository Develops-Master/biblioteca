/* SIGIE v18 — OPAC: pantalla pública de consulta (solo lectura). */
(function(){
  const O = window.SigieOpac, $ = id => document.getElementById(id), F = { q:'', cat:'', soloDisp:false, vista:'' };
  let D = { libros:[], categorias:[] };
  const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  const fecha = f => f ? f.split('-').reverse().join('/') : '';
  function chips(){
    $('chips').innerHTML = `<button class="chip ${!F.cat&&!F.vista?'on':''}" style="--c:#14304d" data-c="">Todos (${D.libros.length})</button>` +
      `<button class="chip ${F.vista==='nuevos'?'on':''}" style="--c:#c0392b" data-v="nuevos">✨ Últimos agregados</button><button class="chip ${F.vista==='top'?'on':''}" style="--c:#8c5a9e" data-v="top">🏆 Más leídos</button>` +
      D.categorias.filter(c => c.n).map(c => `<button class="chip ${F.cat===c.id?'on':''}" style="--c:${esc(c.color)}" data-c="${esc(c.id)}">${esc(c.nombre)} (${c.n})</button>`).join('');
  }
  function lista(){
    let r = O.filtrar(D.libros, F); r = F.vista==='nuevos' ? O.novedades(r, 12) : F.vista==='top' ? O.masLeidos(r, 12) : r.slice(0, 200);
    $('cuenta').textContent = r.length + (r.length===1 ? ' libro' : ' libros');
    $('grid').innerHTML = r.map(l => `<article class="libro" style="--c:${esc(l.color)}"><div class="lomo">${esc((l.titulo||'?').trim().charAt(0).toUpperCase())}${l.isbn?`<img loading="lazy" alt="" src="https://covers.openlibrary.org/b/isbn/${esc(l.isbn)}-M.jpg?default=false" onerror="this.remove()">`:''}</div><div class="info">
      <div class="t">${esc(l.titulo)}</div><div class="a">${esc(l.autor||'Autor no registrado')}</div>
      <div class="m"><span>${esc(l.cat)}</span>${l.ubi?`<span>Estante ${esc(l.ubi)}</span>`:''}${l.cod?`<span>${esc(l.cod)}</span>`:''}</div>
      ${l.disp>0 ? `<span class="est si">✔ Disponible (${l.disp} de ${l.total})</span>` : `<span class="est no">Prestado${l.devolucion?' · vuelve el '+fecha(l.devolucion):''}</span>${l.espera?`<div class="m" style="margin:6px 0 0"><span>${l.espera} en espera</span></div>`:''}${D.reservas?`<button class="res" data-res="${esc(l.id)}">🔖 Reservar</button>`:''}`}${F.vista==='top'?`<div class="m" style="margin:6px 0 0"><span>📖 prestado ${l.veces} ${l.veces===1?'vez':'veces'}</span></div>`:''}</div></article>`).join('')
      || '<div class="vacio">No encontramos libros con esa búsqueda. Prueba con otra palabra o quita los filtros.</div>';
  }
  // Reservar: código LEC + 4 últimos dígitos del DNI. No se guarda nada en el navegador (puede ser una PC compartida).
  function reservar(id){
    const l = D.libros.find(x => x.id === id); if(!l) return;
    const f = document.createElement('div'); f.className = 'fondo';
    f.innerHTML = `<div class="caja" role="dialog" aria-modal="true"><h2>Reservar libro</h2><div style="font-size:14px;color:var(--suave)">${esc(l.titulo)}</div>
      <label for="rCod">Tu código de carné (LEC-0001)</label><input id="rCod" autocomplete="off" autocapitalize="characters" placeholder="LEC-0000">
      <label for="rCla">Clave: últimos 4 dígitos de tu DNI</label><input id="rCla" inputmode="numeric" maxlength="4" autocomplete="off" type="password" placeholder="••••">
      <div class="msg" id="rMsg" aria-live="polite"></div><div class="fila"><button id="rNo">Cancelar</button><button class="ok" id="rSi">Reservar</button></div></div>`;
    document.body.appendChild(f); const msg = (t, c) => { $('rMsg').textContent = t; $('rMsg').className = 'msg ' + (c||''); };
    $('rNo').onclick = () => f.remove(); f.onclick = e => { if(e.target === f) f.remove(); }; $('rCod').focus();
    $('rSi').onclick = async () => {
      const cod = $('rCod').value.trim(), clave = $('rCla').value.trim(); if(!cod || clave.length < 4){ msg('Escribe tu código y los 4 dígitos.', 'e'); return; }
      $('rSi').disabled = true; msg('Reservando…');
      try{
        const r = await fetch('/api/opac/reservar', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ libroId:id, cod, clave }) }), j = await r.json().catch(() => ({}));
        if(r.ok && j.ok){ msg('✔ Reserva hecha. Eres el puesto ' + j.puesto + ' en la fila. Te avisarán en la biblioteca.', 'g'); $('rCla').value = ''; $('rSi').style.display = 'none'; $('rNo').textContent = 'Cerrar'; l.espera = (l.espera||0) + 1; lista(); }
        else { msg(j.error || 'No se pudo reservar.', 'e'); $('rSi').disabled = false; }
      }catch(x){ msg('Sin conexión. Intenta de nuevo.', 'e'); $('rSi').disabled = false; }
    };
  }
  document.addEventListener('click', e => { const r = e.target.closest('[data-res]'); if(r){ reservar(r.dataset.res); return; } const b = e.target.closest('[data-c],[data-v]'); if(!b) return;
    if(b.dataset.v !== undefined){ F.vista = F.vista===b.dataset.v ? '' : b.dataset.v; } else { F.cat = b.dataset.c; F.vista = ''; } chips(); lista(); });
  $('q').addEventListener('input', e => { F.q = e.target.value; lista(); });
  $('disp').addEventListener('change', e => { F.soloDisp = e.target.checked; lista(); });
  fetch('/api/opac', { cache:'no-store' }).then(r => r.ok ? r.json() : Promise.reject()).then(d => {
    D = d; if(d.reservas) $('pie').textContent = 'Si el libro está prestado, puedes reservarlo con tu código de carné.'; if(d.ie) { $('ie').textContent = d.ie; document.title = 'Catálogo · ' + d.ie; } chips(); lista();
  }).catch(() => { $('grid').innerHTML = '<div class="vacio">No se pudo cargar el catálogo. Avisa a la bibliotecaria.</div>'; });
})();
