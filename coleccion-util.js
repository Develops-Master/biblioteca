/* =========================================================================
   SIGIE — Uso de la colección: lógica pura (v14)
   Sin DOM ni acceso a datos: todo entra por parámetros, así se prueba en Node.
     analizar   rotación por libro y categoría, libros sin movimiento y de alta demanda
   Funciona igual en el navegador (<script>) y en Node (tests).
   ========================================================================= */
(function (global) {
  'use strict';
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const r2 = n => Math.round(n * 100) / 100;

  // libros: [{id,titulo,autor,cod,catId,cant,baja}] · prestamos: [{libroId,fecha}] · reservas: [{libroId,estado}]
  // desde: 'AAAA-MM-DD' o '' (todo el historial) · categorias: [{id,nombre}]
  function analizar({ libros, prestamos, reservas, categorias, desde }) {
    const ini = desde || '';
    const cats = new Map((categorias || []).map(c => [c.id, c.nombre || 'Sin categoría']));
    const activos = (libros || []).filter(l => !l.baja);
    const por = new Map(activos.map(l => [l.id, { libro: l, catId: l.catId || '', ejemplares: Math.max(1, Math.round(num(l.cant)) || 1), prestamosPeriodo: 0, prestamosTotal: 0, ultimo: '', enEspera: 0 }]));
    (prestamos || []).forEach(p => {
      const f = por.get(p.libroId); if (!f) return;
      const fecha = String(p.fecha || '').slice(0, 10);
      f.prestamosTotal++; if (!ini || fecha >= ini) f.prestamosPeriodo++;
      if (fecha > f.ultimo) f.ultimo = fecha;
    });
    (reservas || []).forEach(r => { const f = por.get(r.libroId); if (f && r.estado === 'Espera') f.enEspera++; });
    const filas = [...por.values()].map(f => ({ ...f, rotacion: r2(f.prestamosPeriodo / f.ejemplares) }));
    const conMov = filas.filter(f => f.prestamosPeriodo > 0).length, prest = filas.reduce((a, f) => a + f.prestamosPeriodo, 0), ejem = filas.reduce((a, f) => a + f.ejemplares, 0);
    const kpi = { titulos: filas.length, ejemplares: ejem, conMovimiento: conMov, pctUso: filas.length ? Math.round(conMov / filas.length * 100) : 0,
      nuncaPrestados: filas.filter(f => f.prestamosTotal === 0).length, prestamos: prest, rotacionMedia: ejem ? r2(prest / ejem) : 0 };
    const mapaCat = new Map();
    filas.forEach(f => {
      const k = f.catId; if (!mapaCat.has(k)) mapaCat.set(k, { catId: k, nombre: cats.get(k) || 'Sin categoría', titulos: 0, ejemplares: 0, prestamos: 0, conMov: 0 });
      const o = mapaCat.get(k); o.titulos++; o.ejemplares += f.ejemplares; o.prestamos += f.prestamosPeriodo; if (f.prestamosPeriodo) o.conMov++;
    });
    const porCat = [...mapaCat.values()].map(o => ({ catId: o.catId, nombre: o.nombre, titulos: o.titulos, ejemplares: o.ejemplares, prestamos: o.prestamos,
      rotacion: o.ejemplares ? r2(o.prestamos / o.ejemplares) : 0, pctUso: o.titulos ? Math.round(o.conMov / o.titulos * 100) : 0 }))
      .sort((a, b) => b.rotacion - a.rotacion || a.nombre.localeCompare(b.nombre, 'es'));
    // Alta demanda: hay lectores en lista de espera, o rota claramente más que el promedio (mínimo 2 préstamos por ejemplar).
    const umbral = Math.max(2, r2(kpi.rotacionMedia * 2));
    const demanda = filas.filter(f => f.enEspera > 0 || f.rotacion >= umbral)
      .sort((a, b) => b.enEspera - a.enEspera || b.rotacion - a.rotacion || String(a.libro.titulo).localeCompare(String(b.libro.titulo), 'es'));
    // Sin movimiento en el periodo: primero los que nunca salieron, luego los que llevan más tiempo quietos.
    const sinMovimiento = filas.filter(f => f.prestamosPeriodo === 0)
      .sort((a, b) => (a.ultimo || '').localeCompare(b.ultimo || '') || String(a.libro.titulo).localeCompare(String(b.libro.titulo), 'es'));
    return { filas, kpi, porCat, demanda, sinMovimiento, umbral };
  }
  const api = { analizar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SigieCol = api;
})(typeof window !== 'undefined' ? window : globalThis);
