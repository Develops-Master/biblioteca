/* SIGIE v17 — Lectores: DNI, importación con vista previa (Excel/CSV/JSON) y plantillas descargables. */
(function(){
  const L = window.SigieLectores, $ = id => document.getElementById(id);
  const BTN = '<button class="btn" data-lxplant="alumnos" title="Excel listo para llenar con alumnos">⇩ Plantilla alumnos</button><button class="btn" data-lxplant="personal" title="Excel listo para llenar con docentes y personal">⇩ Plantilla personal</button><button class="btn" data-lxplant="celulares" title="Lista de todos tus lectores para completar solo el celular">⇩ Lista para celulares</button>';
  const orig = BIB_RENDER.bibLect; // (los colores y la búsqueda por DNI se envuelven más abajo)
  BIB_RENDER.bibLect = function(){
    return orig().replace('id="blImp">⇧ Importar Excel</button>', 'id="blImp">⇧ Importar (Excel / JSON)</button>' + BTN).replace('accept=".xlsx,.xls,.csv"', 'accept=".xlsx,.xls,.csv,.json"');
  };
  // Carnés con el color de su nivel y búsqueda por DNI exacto (el DNI no se imprime).
  const base = BIB_RENDER.bibLect;
  BIB_RENDER.bibLect = function(){
    const q = bibLf.q.trim(), hit = /^\d{6,}$/.test(q) && bibLect().find(x => x.dni === q);
    if(hit) bibLf.q = hit.cod;
    let h; try{ h = base(); } finally { if(hit) bibLf.q = q; }
    if(hit) h = h.replace('value="' + esc(hit.cod) + '"', 'value="' + esc(q) + '"');
    const por = new Map(bibLect().map(x => [x.cod, x])), parsear = g => SigieBib.parsearGrado(g);
    const k = L.calidad(bibLect(), parsear), fila = (n, t, c) => n ? `<span style="display:inline-block;margin:2px 6px 2px 0;padding:3px 10px;border-radius:999px;background:${c}22;border:1px solid ${c};font-size:12px"><b>${n}</b> ${t}</span>` : '';
    const cal = (k.sinDni||k.sinCelular||k.sinNivel||k.dniRaro) ? `<div class="noprint" style="margin:6px 0">${fila(k.sinDni,'sin DNI','#A63A3A')}${fila(k.sinNivel,'alumnos sin nivel (carné gris)','#C77D2E')}${fila(k.sinCelular,'sin celular (no recibirán avisos)','#2c5a8c')}${fila(k.dniRaro,'con documento de otro largo','#8a8f98')}</div>` : '<div class="noprint hint" style="margin:6px 0">✅ Datos completos: todos tienen DNI, nivel y celular.</div>';
    h = h.replace('<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px', cal + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px');
    return h.split('<div style="border:1px solid #888;').map((t, i) => {
      if(!i) return t; const m = t.match(/class="mono">(LEC-\d+)</), x = m && por.get(m[1]); if(!x) return '<div style="border:1px solid #888;' + t;
      const c = L.colorNivel(x, parsear);
      return `<div title="${esc(c.nivel)}" style="border:2px solid ${c.color};border-left:12px solid ${c.color};` + t;
    }).join('');
  };
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-lxplant]'); if(!b) return;
    if(typeof XLSX === 'undefined'){ toast('No se pudo cargar la librería de Excel (sin internet).', 'err'); return; }
    const p = L.plantilla(b.dataset.lxplant, bibLect()), wb = XLSX.utils.book_new();
    p.hojas.forEach(h => { const ws = XLSX.utils.aoa_to_sheet(h.filas); ws['!cols'] = h.filas[0].map(() => ({ wch:30 })); XLSX.utils.book_append_sheet(wb, ws, h.nombre); });
    XLSX.writeFile(wb, p.archivo);
  });
  async function leer(file){
    if(/\.json$/i.test(file.name)) return L.desdeJSON(JSON.parse(await file.text()));
    const wb = XLSX.read(await file.arrayBuffer(), { type:'array' });
    return L.desdeFilas(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval:'' }));
  }
  window.bibImportarLect = async function(file){
    if(!guardEdit()) return;
    let ent; try{ ent = await leer(file); }catch(e){ toast('No se pudo leer el archivo: ' + e.message, 'err'); return; }
    const plan = L.planificar(bibLect(), ent);
    const caja = (n, t, c) => `<div style="flex:1;min-width:110px;border-left:5px solid ${c};background:#faf7f0;border-radius:8px;padding:8px 10px"><div style="font-size:22px;font-weight:700">${n}</div><div class="hint">${t}</div></div>`;
    const lista = (t, a) => a.length ? `<details style="margin-top:8px"><summary><b>${t}</b> (${a.length})</summary><div style="max-height:150px;overflow:auto;font-size:12px">${a.slice(0,60).map(x => `<div>Fila ${x.fila}: ${esc(x.nombre||x.dni||'')} — ${esc(x.motivo)}</div>`).join('')}</div></details>` : '';
    bibModal('Vista previa de importación', `<div class="f-12"><div class="hint">Archivo: <b>${esc(file.name)}</b> · ${ent.length} filas leídas. Aún no se guardó nada.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">${caja(plan.nuevos.length,'Nuevos','#3E6B4F')}${caja(plan.actualizar.length,'Se actualizan','#2c5a8c')}${caja(plan.iguales,'Sin cambios','#b9b4a8')}${caja(plan.errores.length,'Con error (se omiten)','#A63A3A')}</div>
      ${lista('Errores', plan.errores)}${lista('Avisos', plan.avisos)}</div>`,
      async () => {
        if(!plan.nuevos.length && !plan.actualizar.length){ toast('No hay nada que guardar.', 'err'); return false; }
        await DB.save(BKEYS.lect, L.aplicar(bibLect(), plan, uid));
        toast(plan.nuevos.length + ' nuevos, ' + plan.actualizar.length + ' actualizados.', 'ok'); render();
      }, 'Importar ahora', '680px');
  };
  const campos = x => `<div class="field"><label>DNI / documento</label><input id="bn_dni" inputmode="numeric" value="${esc((x&&x.dni)||'')}"></div><div class="field"><label>Nombre completo</label><input id="bn_nom" value="${esc((x&&x.nombre)||'')}"></div><div class="field"><label>Grado (ej.: Primaria · 3° A) o área</label><input id="bn_gra" value="${esc((x&&x.grado)||'')}"></div><div class="field"><label>Tipo</label><select id="bn_tip">${['Alumno','Docente','Otro'].map(t => `<option ${x&&x.tipo===t?'selected':''}>${t}</option>`).join('')}</select></div><div class="field"><label>Cargo (personal)</label><input id="bn_car" value="${esc((x&&x.cargo)||'')}"></div><div class="field"><label>Celular (opcional, avisos por WhatsApp)</label><input id="bn_tel" inputmode="tel" value="${esc((x&&x.tel)||'')}"></div>`;
  const leerForm = bg => ({ dni:bibV(bg,'bn_dni'), nombre:bibV(bg,'bn_nom').toUpperCase(), grado:bibV(bg,'bn_gra'), tipo:bibV(bg,'bn_tip'), cargo:bibV(bg,'bn_car'), tel:bibV(bg,'bn_tel') });
  function validar(d, idPropio){
    if(!d.nombre){ toast('Escribe el nombre.', 'err'); return false; }
    if(d.dni && bibLect().some(l => l.id!==idPropio && l.dni===d.dni)){ toast('Ya existe un lector con ese DNI.', 'err'); return false; }
    return true;
  }
  window.bibLectModal = function(){ if(!guardEdit()) return;
    bibModal('Nuevo lector', campos(null), async bg => { const d = leerForm(bg); if(!validar(d)) return false;
      await DB.save(BKEYS.lect, [...bibLect(), { id:uid('lec'), cod:bibSigLec(), ...d }]); render(); }); };
  window.bibLectEditar = function(id){ if(!guardEdit()) return; const x = bibLect().find(l => l.id===id); if(!x) return;
    bibModal('Editar lector', campos(x), async bg => { const d = leerForm(bg); if(!validar(d, id)) return false;
      await DB.save(BKEYS.lect, bibLect().map(l => l.id===id ? { ...l, ...d } : l)); toast('Lector actualizado.', 'ok'); render(); }, 'Guardar cambios'); };
})();
