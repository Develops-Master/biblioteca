/* SIGIE v27 — Mostrador: reconocer qué se escaneó (carné, libro, ISBN o DNI), ficha del lector con avisos y deshacer el último movimiento.
   Lógica pura (test/mostrador.test.js). La pantalla está en mostrador.js. */
(function(root){
  const soloDig = s => String(s == null ? '' : s).replace(/[^0-9Xx]/g, '').toUpperCase();
  const fecha = f => f ? String(f).split('-').reverse().join('/') : '';
  const dias = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
  /* Qué es lo escaneado: carné LEC-…, código del libro, ISBN, o el DNI/código del lector escrito a mano. Nunca por nombre. */
  function resolver(raw, { lectores, libros }){
    const c = String(raw == null ? '' : raw).trim().toUpperCase(); if(!c) return { tipo:'nada', texto:'' };
    if(/^LEC-/.test(c)){ const l = (lectores||[]).find(x => String(x.cod).toUpperCase() === c); return l ? { tipo:'lector', lector:l } : { tipo:'lector-no', texto:c }; }
    const lib = (libros||[]).find(x => String(x.cod).toUpperCase() === c); if(lib) return { tipo:'libro', libro:lib };
    const n = soloDig(c);
    if(n.length >= 10){ const b = (libros||[]).find(x => soloDig(x.isbn) === n); if(b) return { tipo:'libro', libro:b }; }
    if(/^\d{6,14}$/.test(c)){ const l = (lectores||[]).find(x => x.dni && String(x.dni).trim() === c); if(l) return { tipo:'lector', lector:l, porDni:true }; }
    return { tipo:'nada', texto:c };
  }
  /* Lo que el bibliotecario necesita ver al tener un carné delante. */
  function ficha(lector, { prestamos, reservas, libros, sanciones, cfg, hoy }){
    const L = new Map((libros||[]).map(l => [l.id, l])), c = cfg || {}, regla = c[(lector.tipo)||'Alumno'] || c.Alumno || { max:2, dias:7 };
    const enMano = (prestamos||[]).filter(p => !p.devuelto && p.lectorId === lector.id).map(p => { const l = L.get(p.libroId) || {}, d = p.vence ? dias(hoy, p.vence) : 99;
      return { id:p.id, cod:l.cod||'', titulo:l.titulo||'(libro eliminado)', vence:p.vence, estado:d < 0 ? 'Vencido' : d <= 2 ? 'Por vencer' : 'Prestado', dias:d < 0 ? -d : d }; })
      .sort((a, b) => String(a.vence).localeCompare(String(b.vence)));
    const vencidos = enMano.filter(x => x.estado==='Vencido').length;
    const listas = (reservas||[]).filter(r => r.lectorId === lector.id && r.estado==='Disponible' && (!r.hasta || r.hasta >= hoy)).map(r => (L.get(r.libroId) || {}).titulo || '(libro eliminado)');
    const san = (sanciones||[]).filter(s => !s.levantada && s.hasta > hoy && s.lectorId === lector.id).map(s => s.hasta).sort().pop() || '';
    const avisos = []; let puede = true;
    if(lector.baja){ avisos.push({ nivel:'mal', t:'Está dado de baja: no puede llevar libros.' }); puede = false; }
    if(vencidos){ avisos.push({ nivel:'mal', t:'Tiene ' + vencidos + ' libro(s) vencido(s)' + (c.bloquear ? ': debe devolverlos antes de llevar otro.' : '.') }); if(c.bloquear) puede = false; }
    if(enMano.length >= regla.max){ avisos.push({ nivel:'mal', t:'Ya tiene el máximo de libros (' + regla.max + ').' }); puede = false; }
    if(san){ avisos.push({ nivel:'mal', t:'Sancionado por atraso hasta el ' + fecha(san) + '.' }); puede = false; }
    if(listas.length) avisos.push({ nivel:'info', t:'Tiene ' + listas.length + ' reserva(s) lista(s) para recoger: ' + listas.join(', ') + '.' });
    return { enMano, vencidos, max:regla.max, quedan:Math.max(0, regla.max - enMano.length), dias:regla.dias, listas, sancionHasta:san, avisos, puede };
  }
  /* Deshacer: se guardan los préstamos y reservas de antes y de después del movimiento (como texto). Solo se revierte si nada más cambió. */
  const foto = (prestamos, reservas) => ({ p:JSON.stringify(prestamos||[]), r:JSON.stringify(reservas||[]) });
  const hayCambio = (a, b) => a.p !== b.p || a.r !== b.r;
  const puedeDeshacer = (accion, actual) => !!accion && accion.despues.p === actual.p && accion.despues.r === actual.r;
  /* Qué pasó entre dos fotos: préstamos nuevos y devoluciones. */
  function cambios(antes, despues){
    const A = new Map(JSON.parse(antes.p).map(p => [p.id, p])), D = JSON.parse(despues.p);
    return { prestados:D.filter(p => !A.has(p.id)), devueltos:D.filter(p => A.has(p.id) && !A.get(p.id).devuelto && p.devuelto) };
  }
  const api = { resolver, ficha, foto, hayCambio, puedeDeshacer, cambios, fecha };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SigieMostrador = Object.assign(root.SigieMostrador || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
