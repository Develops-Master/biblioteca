/* SIGIE v20 — Reportes en color: cálculos puros (se prueban en Node: test/reportes-color.test.js). */
(function(root){
  const ORDEN = ['Inicial','Primaria','Secundaria','Personal','Sin nivel'];
  const dias = (a, b) => Math.round((Date.UTC(+b.slice(0,4), +b.slice(5,7)-1, +b.slice(8,10)) - Date.UTC(+a.slice(0,4), +a.slice(5,7)-1, +a.slice(8,10))) / 864e5);
  function semaforo(d){ return d <= 7 ? { color:'#e0b324', txt:'1–7 días' } : d <= 15 ? { color:'#e8913a', txt:'8–15 días' } : { color:'#c0392b', txt:'más de 15 días' }; }
  // Color de celda tipo «mapa de calor»: más préstamos = más intenso.
  function calor(v, max, base){ const a = max ? Math.max(0.08, v / max) : 0; return v ? `color-mix(in srgb, ${base} ${Math.round(a*100)}%, #ffffff)` : 'transparent'; }
  /* ctx: { libros, cats, prest, lect, hoy, desde, nivelDe(lector|null, prestamo) } */
  function matrizNivelCategoria(c){
    const lib = new Map(c.libros.map(l => [l.id, l])), lec = new Map(c.lect.map(x => [x.id, x]));
    const mapa = new Map(c.cats.map(k => [k.id, { cat:k.nombre, color:k.color||'#8a8f98', v:{} }])), niveles = new Set();
    c.prest.filter(p => !c.desde || p.fecha >= c.desde).forEach(p => {
      const l = lib.get(p.libroId); if(!l) return; const f = mapa.get(l.catId); if(!f) return;
      const n = c.nivelDe(lec.get(p.lectorId) || null, p); niveles.add(n); f.v[n] = (f.v[n]||0) + 1;
    });
    const cols = ORDEN.filter(n => niveles.has(n)); let max = 0;
    const filas = [...mapa.values()].map(f => { const valores = cols.map(n => f.v[n]||0); valores.forEach(v => max = Math.max(max, v)); return { cat:f.cat, color:f.color, valores, total:valores.reduce((a,b)=>a+b,0) }; })
      .filter(f => f.total).sort((a,b) => b.total - a.total);
    return { niveles:cols, filas, max, total:filas.reduce((a,f)=>a+f.total,0) };
  }
  function vencidosPorAula(c){
    const lib = new Map(c.libros.map(l => [l.id, l])), g = new Map();
    c.prest.filter(p => !p.devuelto && p.vence && p.vence < c.hoy).forEach(p => {
      const d = dias(p.vence, c.hoy), aula = c.aulaDe(p) || 'Sin aula';
      if(!g.has(aula)) g.set(aula, []);
      g.get(aula).push({ lector:p.lector||'', libro:(lib.get(p.libroId)||{}).titulo||'(libro eliminado)', vence:p.vence, dias:d, ...semaforo(d) });
    });
    return [...g.entries()].map(([aula, items]) => ({ aula, items:items.sort((a,b) => b.dias - a.dias) })).sort((a,b) => b.items.length - a.items.length || a.aula.localeCompare(b.aula, 'es'));
  }
  function coleccionPorCategoria(c){
    const m = new Map(c.cats.map(k => [k.id, { cat:k.nombre, color:k.color||'#8a8f98', titulos:0, ejemplares:0 }]));
    c.libros.filter(l => !l.baja).forEach(l => { const f = m.get(l.catId); if(f){ f.titulos++; f.ejemplares += Math.max(1, Number(l.cant)||1); } });
    const filas = [...m.values()].filter(f => f.titulos).sort((a,b) => b.ejemplares - a.ejemplares);
    return { filas, max:filas.reduce((a,f) => Math.max(a, f.ejemplares), 0), total:filas.reduce((a,f) => a+f.ejemplares, 0) };
  }
  /* Resumen de UN aula: c.aulaLector(lector) da la clave del aula; el resto igual que en los demás reportes. */
  function resumenAula(c, aula){
    const lectores = c.lect.filter(x => !x.baja && c.aulaLector(x) === aula), ids = new Set(lectores.map(x => x.id));
    const lib = new Map(c.libros.map(l => [l.id, l])), cat = new Map(c.cats.map(k => [k.id, k]));
    const mios = c.prest.filter(p => ids.has(p.lectorId)), per = mios.filter(p => !c.desde || p.fecha >= c.desde);
    const porLector = new Map(); per.forEach(p => porLector.set(p.lectorId, (porLector.get(p.lectorId)||0) + 1));
    const porCat = new Map(); per.forEach(p => { const l = lib.get(p.libroId), k = l && cat.get(l.catId); if(k) porCat.set(k.id, (porCat.get(k.id)||0) + 1); });
    const vencidos = mios.filter(p => !p.devuelto && p.vence && p.vence < c.hoy);
    const nombre = new Map(lectores.map(x => [x.id, x.nombre]));
    return { aula, lectores:lectores.length, prestamos:per.length, activos:mios.filter(p => !p.devuelto).length, vencidos:vencidos.length,
      lectoresActivos:porLector.size, participacion:lectores.length ? Math.round(porLector.size / lectores.length * 100) : 0,
      topLectores:[...porLector.entries()].sort((a,b) => b[1]-a[1] || String(nombre.get(a[0])).localeCompare(String(nombre.get(b[0])), 'es')).slice(0, 5).map(([id, n]) => ({ nombre:nombre.get(id), n })),
      categorias:[...porCat.entries()].map(([id, n]) => ({ cat:cat.get(id).nombre, color:cat.get(id).color || '#8a8f98', n })).sort((a,b) => b.n - a.n),
      sinLectura:lectores.filter(x => !porLector.has(x.id)).map(x => x.nombre).sort((a,b) => a.localeCompare(b, 'es')) };
  }
  function csv(filas){ return filas.map(f => f.map(v => '"' + String(v==null?'':v).replace(/"/g,'""') + '"').join(';')).join('\r\n'); }
  const api = { ORDEN, dias, semaforo, calor, resumenAula, matrizNivelCategoria, vencidosPorAula, coleccionPorCategoria, csv };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SigieRepColor = api;
})(typeof window !== 'undefined' ? window : globalThis);
