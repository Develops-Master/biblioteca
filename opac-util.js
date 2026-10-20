/* SIGIE v18 — OPAC (catálogo de consulta): lógica pura. Solo datos seguros: nunca nombres de lectores ni DNI. */
(function(root){
  const norm = s => String(s==null?'':s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  // Los ids se generan como prefijo_<hora en base36><5 letras>: de ahí sale la fecha de ingreso (si el id es de otro tipo, no hay fecha).
  function ingresoDe(id){
    const m = /^lib_([0-9a-z]+)$/.exec(String(id||'')); if(!m || m[1].length < 9) return '';
    const t = parseInt(m[1].slice(0, -5), 36); return t > 9e11 && t < 4e12 ? new Date(t).toISOString().slice(0, 10) : '';
  }
  const isbnLimpio = s => { const x = String(s||'').replace(/[^0-9Xx]/g, ''); return x.length === 10 || x.length === 13 ? x.toUpperCase() : ''; };
  function construir(d){
    const cats = (d.cats||[]).filter(c=>c), porCat = new Map(cats.map(c=>[c.id, c]));
    const activos = new Map();
    (d.prest||[]).filter(p=>!p.devuelto).forEach(p=>{ const a = activos.get(p.libroId) || { n:0, vence:'' }; a.n++; if(p.vence && (!a.vence || p.vence<a.vence)) a.vence = p.vence; activos.set(p.libroId, a); });
    const veces = new Map(); (d.prest||[]).forEach(p => veces.set(p.libroId, (veces.get(p.libroId)||0) + 1));
    const libros = (d.libros||[]).filter(l=>!l.baja).map(l=>{
      const c = porCat.get(l.catId) || {}, total = Math.max(1, Number(l.cant)||1), a = activos.get(l.id) || { n:0, vence:'' }, disp = Math.max(0, total-a.n);
      return { id:l.id, cod:l.cod||'', titulo:l.titulo||'', autor:l.autor||'', editorial:l.editorial||'', dewey:l.dewey||'', ubi:l.ubi==null?'':String(l.ubi),
        cat:c.nombre||'Sin categoría', catId:l.catId||'', color:c.color||'#8a8f98', total, disp, isbn:isbnLimpio(l.isbn), veces:veces.get(l.id)||0, ingreso:ingresoDe(l.id), devolucion: disp===0 ? a.vence : '' };
    });
    const espera = new Map(); (d.res||[]).filter(r=>r.estado==='Espera'||r.estado==='Disponible').forEach(r=>espera.set(r.libroId,(espera.get(r.libroId)||0)+1));
    libros.forEach(l => { l.espera = espera.get(l.id)||0; });
    return { reservas:!!(d.bcfg&&d.bcfg.opacReservas), ie:(d.cfg&&d.cfg.nombreIE)||'', categorias:cats.map(c=>({ id:c.id, nombre:c.nombre, color:c.color||'#8a8f98', n:libros.filter(l=>l.catId===c.id).length })), libros };
  }
  function filtrar(libros, f){
    const q = norm(f.q).trim();
    return libros.filter(l => (!f.cat || l.catId===f.cat) && (!f.soloDisp || l.disp>0) && (!q || [l.titulo,l.autor,l.cod,l.editorial,l.cat,l.dewey].some(v=>norm(v).includes(q))));
  }
  const novedades = (libros, n) => libros.filter(l => l.ingreso).sort((a,b) => b.ingreso.localeCompare(a.ingreso) || a.titulo.localeCompare(b.titulo, 'es')).slice(0, n || 12);
  const masLeidos = (libros, n) => libros.filter(l => l.veces > 0).sort((a,b) => b.veces - a.veces || a.titulo.localeCompare(b.titulo, 'es')).slice(0, n || 12);
  /* ---- Reservas desde el OPAC ----
     El lector se identifica con su código LEC-… y los últimos 4 dígitos de su DNI. Nada de lo que responde revela
     nombres ni DNI; un error de código o clave es siempre el mismo mensaje. */
  const ESTADOS_VIVOS = ['Espera','Disponible'];
  const dniClave = l => { const d = String((l&&l.dni)||'').replace(/\D/g,''); return d.length >= 6 ? d.slice(-4) : ''; };
  function reservar(d, p, hoy, nuevoId){
    const bc = d.bcfg || {}, err = (codigo, error) => ({ ok:false, codigo, error });
    if(!bc.opacReservas) return err('APAGADO', 'Las reservas desde el catálogo no están activadas. Pídelo en el mostrador.');
    const cod = String((p&&p.cod)||'').trim().toUpperCase(), clave = String((p&&p.clave)||'').replace(/\D/g,'');
    const lec = (d.lect||[]).find(x => String(x.cod).toUpperCase()===cod);
    if(!cod || !clave || !lec || lec.baja || !dniClave(lec) || dniClave(lec)!==clave) return err('CREDENCIALES', 'Código o clave incorrectos. La clave son los 4 últimos dígitos de tu DNI.');
    const libro = (d.libros||[]).find(x => x.id===(p&&p.libroId) && !x.baja); if(!libro) return err('LIBRO', 'Ese libro ya no está en el catálogo.');
    const act = (d.prest||[]).filter(x => !x.devuelto && x.libroId===libro.id), vivas = (d.res||[]).filter(r => ESTADOS_VIVOS.includes(r.estado));
    if(act.some(x => x.lectorId===lec.id)) return err('EN_MANO', 'Ya tienes este libro prestado.');
    if(vivas.some(r => r.libroId===libro.id && r.lectorId===lec.id)) return err('DUPLICADA', 'Ya reservaste este libro.');
    const max = Math.max(1, Number(bc.opacMaxReservas)||2); if(vivas.filter(r => r.lectorId===lec.id).length >= max) return err('MAXIMO', 'Ya tienes '+max+' reserva(s). Espera a que te avisen o cancélalas en el mostrador.');
    const libres = Math.max(1, Number(libro.cant)||1) - act.length - vivas.filter(r => r.libroId===libro.id && r.estado==='Disponible').length;
    if(libres > 0) return err('LIBRE', 'Este libro está disponible ahora: pásalo a recoger al mostrador.');
    const puesto = vivas.filter(r => r.libroId===libro.id && r.estado==='Espera').length + 1;
    return { ok:true, puesto, titulo:libro.titulo, reserva:{ id:nuevoId('rs'), libroId:libro.id, lectorId:lec.id, lector:lec.nombre, grado:lec.grado||'', fecha:hoy, estado:'Espera', origen:'OPAC' } };
  }
  /* Limitador de intentos fallidos: por código de lector y por IP. */
  function crearLimitador(o, ahora){
    const c = Object.assign({ fallosCod:5, fallosIp:12, ventanaMs:15*60*1000 }, o||{}), now = ahora || Date.now, porCod = new Map(), porIp = new Map();
    const vivos = (m, k) => { const h = (m.get(k)||[]).filter(t => now()-t < c.ventanaMs); m.set(k, h); return h; };
    const espera = (h, max) => h.length >= max ? Math.max(1, Math.ceil((h[h.length-max] + c.ventanaMs - now())/1000)) : 0;
    return {
      segundos(ip, cod){ return Math.max(espera(vivos(porIp, ip), c.fallosIp), cod ? espera(vivos(porCod, cod), c.fallosCod) : 0); },
      fallo(ip, cod){ vivos(porIp, ip).push(now()); if(cod) vivos(porCod, cod).push(now()); if(porIp.size > 5000) porIp.clear(); if(porCod.size > 5000) porCod.clear(); },
      acierto(ip, cod){ porCod.delete(cod); }
    };
  }
  const api = { reservar, crearLimitador, dniClave, construir, filtrar, novedades, masLeidos, ingresoDe, isbnLimpio };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SigieOpac = api;
})(typeof window !== 'undefined' ? window : globalThis);
