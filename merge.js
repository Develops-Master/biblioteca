/* =========================================================================
   SIGIE — Fusión de cambios simultáneos (merge de 3 vías)
   -------------------------------------------------------------------------
   Los datos se guardan como un arreglo grande por clave (por ejemplo, todos
   los préstamos en 'sigie:bib_prestamos'). Antes, si dos computadoras
   guardaban a la vez, la última pisaba a la primera y se perdía lo otro.

   Ahora el servidor rechaza (409) un guardado hecho sobre una versión vieja,
   y el navegador resuelve el choque con esta función:

       fusionar(base, mio, servidor)

     base     = el valor que ESTE navegador había leído por última vez
     mio      = el valor que este navegador quiere guardar
     servidor = el valor que hay ahora en el servidor (con lo de los demás)

   Reglas (por registro, identificado por su "id"):
     - Registro nuevo en cualquiera de los dos lados  → se conserva.
     - Registro que solo cambió uno de los lados      → gana el que cambió.
     - Registro que cambiaron los dos                 → se fusiona campo por
       campo; si ambos tocaron el MISMO campo, gana el mío (el último que guarda).
     - Registro borrado por uno y sin tocar por el otro → se borra.
     - Registro borrado por uno y EDITADO por el otro   → se conserva la edición
       (es más seguro no perder trabajo).
     - Contadores numéricos (secuencias) en conflicto → se toma el mayor.
   Si un arreglo no tiene "id" en sus elementos no se puede fusionar por
   registro: gana el valor que se está guardando.

   Este archivo funciona igual en el navegador (<script>) y en Node (tests).
   ========================================================================= */
(function (global) {
  'use strict';

  function iguales(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null || typeof a !== 'object') return false;
    return JSON.stringify(a) === JSON.stringify(b);
  }
  function esObjeto(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function tieneId(x) { return esObjeto(x) && (typeof x.id === 'string' || typeof x.id === 'number'); }
  function todosConId(arr) { return Array.isArray(arr) && arr.every(tieneId); }

  function indexar(arr) {
    const m = new Map();
    for (const x of arr) m.set(String(x.id), x);
    return m;
  }

  // Fusiona los campos de dos versiones de un mismo registro u objeto.
  // "contador" = true cuando los números en conflicto deben resolverse tomando el mayor.
  function fusionarObjeto(base, mio, srv, contador) {
    const b = esObjeto(base) ? base : {};
    const out = {};
    const claves = new Set([...Object.keys(mio), ...Object.keys(srv)]);
    for (const k of claves) {
      const enM = Object.prototype.hasOwnProperty.call(mio, k);
      const enS = Object.prototype.hasOwnProperty.call(srv, k);
      const enB = Object.prototype.hasOwnProperty.call(b, k);
      if (enM && enS) {
        const v = fusionarValor(b[k], mio[k], srv[k], contador);
        if (v !== undefined) out[k] = v;
      } else if (enM) {            // yo lo tengo, el servidor no
        if (!enB) out[k] = mio[k];                 // lo agregué yo
        else if (!iguales(mio[k], b[k])) out[k] = mio[k]; // lo edité yo, ellos lo quitaron: conservar edición
        // si no lo toqué y el servidor lo quitó: se quita
      } else if (enS) {            // el servidor lo tiene, yo no
        if (!enB) out[k] = srv[k];                 // lo agregaron ellos
        else if (!iguales(srv[k], b[k])) out[k] = srv[k]; // lo editaron ellos, yo lo quité: conservar edición
        // si ellos no lo tocaron y yo lo quité: se quita
      }
    }
    return out;
  }

  function fusionarArreglo(base, mio, srv) {
    const b = Array.isArray(base) ? base : [];
    if (!todosConId(mio) || !todosConId(srv) || !todosConId(b)) return mio;
    const mB = indexar(b), mM = indexar(mio), mS = indexar(srv);
    const out = [];
    const vistos = new Set();
    for (const s of srv) {
      const id = String(s.id);
      vistos.add(id);
      const enB = mB.has(id), enM = mM.has(id);
      if (!enM) {
        if (!enB) out.push(s);                                  // lo agregó otro
        else if (!iguales(s, mB.get(id))) out.push(s);          // yo lo borré, otro lo editó: se conserva
        // yo lo borré y otro no lo tocó: se borra
      } else if (!enB) {
        out.push(fusionarObjeto(undefined, mM.get(id), s, false)); // mismo id agregado en ambos lados
      } else {
        out.push(fusionarValor(mB.get(id), mM.get(id), s, false));
      }
    }
    for (const m of mio) {
      const id = String(m.id);
      if (vistos.has(id)) continue;
      // no está en el servidor
      if (mB.has(id)) {
        if (!iguales(m, mB.get(id))) out.push(m);   // otro lo borró, yo lo edité: se conserva
        // otro lo borró y yo no lo toqué: se borra
      } else out.push(m);                            // lo agregué yo
    }
    return out;
  }

  function fusionarValor(base, mio, srv, contador) {
    if (iguales(mio, base)) return srv;
    if (iguales(srv, base)) return mio;
    if (iguales(mio, srv)) return mio;
    if (Array.isArray(mio) && Array.isArray(srv)) return fusionarArreglo(base, mio, srv);
    if (esObjeto(mio) && esObjeto(srv)) return fusionarObjeto(base, mio, srv, contador);
    if (contador && typeof mio === 'number' && typeof srv === 'number') return Math.max(mio, srv);
    return mio;
  }

  // Punto de entrada: contadores numéricos (secuencias) se resuelven con "mayor".
  function fusionar(base, mio, srv) {
    return fusionarValor(base, mio, srv, true);
  }

  const api = { fusionar, iguales };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SigieMerge = api;
})(typeof window !== 'undefined' ? window : globalThis);
