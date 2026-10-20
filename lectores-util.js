/* SIGIE v17 — Lectores: lectura de archivos (JSON/Excel), validación y plan de importación.
   Lógica pura (se prueba en Node: test/lectores.test.js). La pantalla está en lectores.js. */
(function(root){
  const norm = s => String(s==null?'':s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase().replace(/\s+/g,' ');
  const TIPO_COD = { ALU:'Alumno', DOC:'Docente', ADM:'Otro', VIG:'Otro' };
  function tipoDe(v){
    const t = norm(v); if(!t) return 'Alumno'; if(TIPO_COD[t]) return TIPO_COD[t];
    if(/^(DOC|PROF)/.test(t)) return 'Docente'; if(/^(ALU|ESTUD)/.test(t)) return 'Alumno'; return 'Otro';
  }
  const ALIAS = {
    dni:['DNI','DOCUMENTO','NRO DOCUMENTO','NUMERO DE DOCUMENTO','CODIGO','D'],
    nombre:['NOMBRE','NOMBRES','APELLIDOS Y NOMBRES','ALUMNO','NOMBRE COMPLETO','N'],
    grado:['GRADO','GRADO Y SECCION','SECCION','AULA','X'],
    tipo:['TIPO','P'], tel:['CELULAR','TELEFONO','CEL','WHATSAPP','CELULAR APODERADO','TELEFONO APODERADO','CELULAR DEL APODERADO'],
    cargo:['CARGO','AREA']
  };
  function limpiar(r){
    const tipo = String(r.tipo==null?'':r.tipo).trim() ? tipoDe(r.tipo) : '';
    return { dni:String(r.dni==null?'':r.dni).replace(/\s+/g,''), nombre:String(r.nombre||'').trim().replace(/\s+/g,' ').toUpperCase(),
      tipo, grado:String(r.grado||'').trim(), cargo:String(r.cargo||'').trim(), tel:String(r.tel||'').replace(/[^\d+]/g,'') };
  }
  function desdeJSON(obj){
    const L = Array.isArray(obj) ? obj : (obj && Array.isArray(obj.personas) ? obj.personas : null);
    if(!L) throw new Error('El JSON no tiene la lista "personas".');
    return L.map(p => { const tipo = tipoDe(p.p||p.tipo);
      return limpiar({ dni:p.d||p.dni, nombre:p.n||p.nombre, tipo:p.p||p.tipo, grado:p.x||p.grado, cargo: tipo==='Alumno'?'':(p.x||p.cargo||''), tel:p.tel||p.celular }); });
  }
  function desdeFilas(filas){
    return filas.map(f => {
      const o = {}; Object.keys(f).forEach(k => { const nk = norm(k); for(const c in ALIAS) if(ALIAS[c].includes(nk) && o[c]===undefined) o[c] = f[k]; });
      return limpiar(o);
    }).filter(r => r.nombre || r.dni);
  }
  const telValido = t => /^(\+?51)?9\d{8}$/.test(String(t||'').replace(/[\s-]/g,''));
  function sigNum(lista, extra){ let m=0; [...lista,...extra].forEach(x=>{ const r=String(x.cod||'').match(/(\d+)$/); if(r) m=Math.max(m,+r[1]); }); return m+1; }
  /* Compara lo que llega con lo que ya hay: empareja por DNI y, si el registro viejo no tiene DNI, por nombre. */
  function planificar(existentes, entrantes){
    const porDni = new Map(), porNom = new Map();
    existentes.forEach(x => { if(x.dni) porDni.set(x.dni, x); porNom.set(norm(x.nombre), x); });
    const vistos = new Set(), plan = { nuevos:[], actualizar:[], iguales:0, errores:[], avisos:[] };
    entrantes.forEach((r0, i) => { let r = r0;
      const fila = i+1;
      if(!r.nombre && r.dni && porDni.has(r.dni)) r = { ...r, nombre: porDni.get(r.dni).nombre }; // archivo solo de celulares: basta el DNI
      if(!r.nombre){ plan.errores.push({ fila, dni:r.dni, motivo:'Falta el nombre' }); return; }
      if(r.dni && vistos.has(r.dni)){ plan.errores.push({ fila, dni:r.dni, nombre:r.nombre, motivo:'DNI repetido en el archivo' }); return; }
      if(r.dni) vistos.add(r.dni);
      if(r.dni && !/^\d{8}$/.test(r.dni)) plan.avisos.push({ fila, nombre:r.nombre, motivo:'Documento de '+r.dni.length+' caracteres (no es DNI de 8 dígitos)' });
      let ex = r.dni && porDni.get(r.dni);
      if(!ex){ const c = porNom.get(norm(r.nombre)); if(c && !c.dni) ex = c; }
      if(r.tel && !telValido(r.tel)) plan.avisos.push({ fila, nombre:r.nombre, motivo:'Celular \"'+r.tel+'\" no parece un celular peruano (9 dígitos que empiezan con 9)' });
      if(!ex){ plan.nuevos.push({ ...r, tipo:r.tipo||'Alumno' }); return; }
      const cambios = {};
      if(r.dni && ex.dni!==r.dni) cambios.dni = r.dni;
      if(r.grado && ex.grado!==r.grado) cambios.grado = r.grado;
      if(r.tipo && ex.tipo!==r.tipo) cambios.tipo = r.tipo;
      if(r.cargo && ex.cargo!==r.cargo) cambios.cargo = r.cargo;
      if(r.tel && ex.tel!==r.tel) cambios.tel = r.tel;
      if(Object.keys(cambios).length) plan.actualizar.push({ id:ex.id, nombre:ex.nombre, cambios }); else plan.iguales++;
    });
    return plan;
  }
  function aplicar(existentes, plan, uid){
    const cambios = new Map(plan.actualizar.map(a => [a.id, a.cambios]));
    const lista = existentes.map(x => cambios.has(x.id) ? { ...x, ...cambios.get(x.id) } : x);
    let n = sigNum(existentes, []);
    plan.nuevos.forEach(r => lista.push({ id:uid('lec'), cod:'LEC-'+String(n++).padStart(4,'0'), ...r }));
    return lista;
  }
  function plantilla(tipo, existentes){
    if(tipo==='celulares'){
      const orden = { Alumno:0, Docente:1, Otro:2 };
      const lista = (existentes||[]).filter(x => !x.baja).sort((a,b) => (orden[a.tipo||'Alumno']-orden[b.tipo||'Alumno']) || String(a.grado||'').localeCompare(String(b.grado||''),'es') || String(a.nombre).localeCompare(String(b.nombre),'es'));
      const filas = lista.map(x => [x.dni||'', x.nombre, x.tipo||'Alumno', (x.tipo||'Alumno')==='Alumno' ? (x.grado||'') : (x.cargo||x.grado||''), x.tel||'']);
      const ayuda = [['Cómo llenar esta lista'],[''],['1. Ya trae a todos los lectores activos. Solo completa la columna Celular (9 dígitos, empieza con 9).'],['2. No cambies el DNI: con él se empareja a cada persona.'],['3. Para alumnos, pon el celular del apoderado: es el que recibe los avisos por WhatsApp.'],['4. Súbelo en Lectores → Importar. Verás una vista previa; solo se actualizan los celulares que cambien.']];
      return { archivo:'lista-celulares.xlsx', hojas:[{ nombre:'Datos', filas:[['DNI','Apellidos y nombres','Tipo','Grado / cargo','Celular'],...filas] },{ nombre:'Instrucciones', filas:ayuda }] };
    }
    const pers = tipo==='personal';
    const cab = pers ? ['DNI','Apellidos y nombres','Tipo','Cargo / área','Celular'] : ['DNI','Apellidos y nombres','Tipo','Grado','Celular'];
    const ej = pers ? [['12345678','PEREZ LOPEZ, ANA MARIA','Docente','Secundaria','987654321']] : [['12345678','PEREZ LOPEZ, JUAN CARLOS','Alumno','Primaria · 3° A','987654321']];
    const ayuda = [['Cómo llenar esta plantilla'],[''],
      ['1. Escribe una persona por fila en la hoja "Datos"; borra la fila de ejemplo.'],
      ['2. DNI: 8 dígitos. Es lo que evita duplicados al importar otra vez.'],
      ['3. Apellidos y nombres: "APELLIDOS, NOMBRES".'],
      pers ? ['4. Tipo: Docente u Otro (administrativo, auxiliar, vigilante…). Cargo: texto libre.'] : ['4. Tipo: Alumno. Grado con el formato Nivel · Grado° Sección, ej.: Primaria · 3° A, Secundaria · 1° B.'],
      ['5. Celular: opcional (para avisos por WhatsApp).'],
      ['6. Guarda el archivo y súbelo en Lectores → Importar. Verás una vista previa antes de guardar.']];
    return { archivo: pers ? 'plantilla-lectores-personal.xlsx' : 'plantilla-lectores-alumnos.xlsx', hojas:[{ nombre:'Datos', filas:[cab,...ej] },{ nombre:'Instrucciones', filas:ayuda }] };
  }
  const COLORES = { Primaria:'#2c8c5a', Secundaria:'#2c5a8c', Inicial:'#8c5a9e', Personal:'#C77D2E', Otro:'#8a8f98' };
  function colorNivel(l, parsear){
    if((l.tipo||'Alumno')!=='Alumno') return { nivel:'Personal', color:COLORES.Personal };
    const n = (parsear && parsear(l.grado||'').nivel) || ''; const k = COLORES[n] ? n : 'Otro';
    return { nivel:k==='Otro'?'Sin nivel':k, color:COLORES[k] };
  }
  /* Calidad de los datos: cuántos lectores activos no tienen DNI, celular o nivel. */
  function calidad(lista, parsear){
    const act = (lista||[]).filter(x => !x.baja), alu = act.filter(x => (x.tipo||'Alumno')==='Alumno');
    return { total:act.length, sinDni:act.filter(x => !x.dni).length, sinCelular:act.filter(x => !x.tel).length,
      sinNivel:alu.filter(x => !((parsear && parsear(x.grado||'').nivel) || '')).length, dniRaro:act.filter(x => x.dni && !/^\d{8}$/.test(x.dni)).length };
  }
  const api = { telValido, calidad, COLORES, colorNivel, norm, tipoDe, desdeJSON, desdeFilas, planificar, aplicar, plantilla };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SigieLectores = api;
})(typeof window !== 'undefined' ? window : globalThis);
