/* =========================================================================
   SIGIE — Diplomas de la biblioteca (lógica pura, con pruebas)
   -------------------------------------------------------------------------
   · Cada diploma tiene un CÓDIGO ÚNICO e irrepetible (D-XXXX-XXXX) y un folio
     correlativo por año. El código no depende del alumno ni del año en que
     se imprime: no cambia si se reimprime.
   · Verificación: dado un código, dice si el diploma es auténtico SIN mostrar
     datos personales completos (el nombre sale enmascarado: "MA*** PE***").
   · El mismo archivo lo usa el servidor (para /api/verificar) y el navegador.
   Funciona igual en el navegador (<script>) y en Node (pruebas y servidor).
   ========================================================================= */
(function (global) {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // Sin 0/O, 1/I/L: se pueden dictar por teléfono sin confundirse.
  const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const PATRON = /^D-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;

  function azar() {
    const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (c && c.getRandomValues) { const b = new Uint32Array(1); c.getRandomValues(b); return b[0] / 4294967296; }
    return Math.random();
  }

  // rnd() opcional (pruebas): devuelve un número en [0,1).
  function codigoDiploma(rnd) {
    const r = rnd || azar;
    let s = '';
    for (let i = 0; i < 8; i++) s += ALFABETO[Math.floor(r() * ALFABETO.length)];
    return 'D-' + s.slice(0, 4) + '-' + s.slice(4);
  }

  // Un código que no exista ya en el registro.
  function codigoNuevo(diplomas, rnd) {
    const usados = new Set((diplomas || []).map(d => d.codigo));
    for (let i = 0; i < 50; i++) { const c = codigoDiploma(rnd); if (!usados.has(c)) return c; }
    throw new Error('No se pudo generar un código único.');
  }

  // Acepta el código suelto, con espacios/minúsculas, o la URL completa del QR (…?c=D-XXXX-XXXX).
  // Devuelve el código en formato válido o '' si no lo es.
  function normalizarCodigo(texto) {
    let t = String(texto || '').trim();
    const m = /[?&]c=([^&#\s]+)/i.exec(t);
    if (m) { try { t = decodeURIComponent(m[1]); } catch (e) { t = m[1]; } }
    const mayus = t.toUpperCase();
    t = mayus.replace(/[^A-Z0-9]/g, '');
    // "D-" al inicio es el prefijo: entonces deben seguir 8 caracteres. Sin ese prefijo se aceptan los 8 sueltos.
    if (/^D[\s-]/.test(mayus) || t.length === 9) { if (t.length !== 9 || t[0] !== 'D') return ''; t = t.slice(1); }
    if (t.length !== 8) return '';
    const c = 'D-' + t.slice(0, 4) + '-' + t.slice(4);
    return PATRON.test(c) ? c : '';
  }

  // Siguiente folio del año: 1, 2, 3… (se cuentan también los anulados, para no reutilizar números).
  function siguienteFolio(diplomas, anio) {
    return (diplomas || []).filter(d => String(d.anio) === String(anio)).reduce((m, d) => Math.max(m, Number(d.folio) || 0), 0) + 1;
  }
  const folioTexto = (folio, anio) => 'N.° ' + String(folio).padStart(4, '0') + '-' + anio;

  // ¿Ya tiene este lector este diploma este año? (se ignoran los anulados)
  //   clave distingue variantes del mismo tipo (p. ej. el nivel 'AD' o la insignia de 6 libros).
  function diplomaDuplicado(diplomas, { lectorId, tipo, clave, anio }) {
    return (diplomas || []).find(d => !d.anulado && d.lectorId === lectorId && d.tipo === tipo && String(d.clave || '') === String(clave || '') && String(d.anio) === String(anio)) || null;
  }

  // "ROSAS DE LA CRUZ DAPHNE" → "RO*** DE LA CR*** DA***"  (palabras de 2 letras o menos se muestran)
  function enmascararNombre(nombre) {
    return String(nombre || '').trim().split(/\s+/).filter(Boolean).map(w => w.length <= 2 ? w : w.slice(0, 2) + '*'.repeat(Math.min(w.length - 2, 5))).join(' ');
  }

  // Resultado público de la verificación: nunca incluye DNI, celular, grado ni quién lo recibió.
  function verificarDiploma(diplomas, texto, { nombreIE } = {}) {
    const codigo = normalizarCodigo(texto);
    if (!codigo) return { valido: false, motivo: 'formato', mensaje: 'El código no tiene el formato correcto (D-XXXX-XXXX).' };
    const d = (diplomas || []).find(x => x.codigo === codigo);
    if (!d) return { valido: false, motivo: 'no_encontrado', mensaje: 'No existe ningún diploma con ese código.' };
    if (d.anulado) return { valido: false, motivo: 'anulado', codigo, mensaje: 'Este diploma fue anulado y ya no es válido.', institucion: nombreIE || '' };
    return { valido: true, codigo, institucion: nombreIE || '', titulo: d.titulo || '', nombre: enmascararNombre(d.nombre), fecha: d.fecha || '', folio: folioTexto(d.folio, d.anio) };
  }

  // Diplomas listos para imprimir (uno por hoja A4 horizontal).
  //   items: [{ nombre, grado, titulo, motivo, fecha, folio, codigo, duplicado }]
  //   opciones.qrImg(texto) → data URL del QR (lo da el navegador); urlBase p. ej. https://colegio.edu.pe
  function diplomasHTML(items, { nombreIE, firma1, firma2, ciudad, urlBase, qrImg } = {}) {
    const hoja = d => {
      const url = (urlBase ? String(urlBase).replace(/\/+$/, '') : '') + '/verificar.html?c=' + encodeURIComponent(d.codigo);
      const qr = qrImg ? qrImg(url) : '';
      return `<div class="dip"><div class="marco">${d.duplicado ? '<div class="marca">DUPLICADO</div>' : ''}<div class="ie">${esc(nombreIE || '')}</div><div class="bib">BIBLIOTECA ESCOLAR</div>
<div class="tit">DIPLOMA</div><div class="sub">${esc(d.titulo)}</div><div class="otg">Se otorga con orgullo a</div><div class="nom">${esc(d.nombre)}</div>${d.grado ? `<div class="gr">${esc(d.grado)}</div>` : ''}
<div class="txt">${esc(d.motivo)}</div><div class="fec">${esc(ciudad ? ciudad + ', ' : '')}${esc(d.fecha)}</div>
<div class="firmas"><div><div class="ln"></div>${esc(firma1 || 'Responsable de la biblioteca')}</div><div><div class="ln"></div>${esc(firma2 || 'Dirección')}</div></div>
<div class="ver">${qr ? `<img src="${esc(qr)}" alt="QR de verificación">` : ''}<div><b>${esc(d.folio)}</b><br>Código: <span class="cod">${esc(d.codigo)}</span><br><span class="peq">Verifica su autenticidad con el QR o en la biblioteca del colegio.</span></div></div></div></div>`;
    };
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Diplomas</title><style>
@page{size:A4 landscape;margin:0}
*{box-sizing:border-box} body{font-family:Georgia,'Times New Roman',serif;margin:0;color:#1a1a1a}
.barra{background:#14304d;color:#fff;padding:8px 12px;display:flex;gap:12px;align-items:center;font-family:Arial,sans-serif} .barra button{padding:5px 10px;cursor:pointer}
.dip{width:297mm;height:210mm;padding:10mm;page-break-after:always;break-after:page;display:flex}
.dip:last-of-type{page-break-after:auto;break-after:auto}
.marco{flex:1;position:relative;border:2.5mm double #8a6d1d;padding:9mm 18mm;text-align:center;display:flex;flex-direction:column;justify-content:center;gap:2.5mm}
.marca{position:absolute;top:38%;left:50%;transform:translate(-50%,-50%) rotate(-18deg);font-size:64pt;color:rgba(160,0,0,.12);font-weight:700;letter-spacing:3mm;pointer-events:none}
.ie{font-size:13pt;letter-spacing:.5mm;color:#14304d;font-weight:700} .bib{font-size:10pt;letter-spacing:1.2mm;color:#666}
.tit{font-size:38pt;font-weight:700;color:#8a6d1d;letter-spacing:2mm;margin:3mm 0 0} .sub{font-size:16pt;color:#14304d;font-style:italic}
.otg{font-size:12pt;font-style:italic;color:#555;margin-top:2mm}
.nom{font-size:28pt;font-weight:700;border-bottom:.4mm solid #999;padding:1mm 8mm;margin:1mm auto;align-self:center;min-width:140mm}
.gr{font-size:12pt;color:#444} .txt{font-size:13.5pt;line-height:1.5;margin:2mm auto;max-width:205mm} .fec{font-size:11pt;color:#555}
.firmas{display:flex;justify-content:space-around;margin-top:8mm;font-size:11pt} .ln{width:62mm;border-top:.3mm solid #333;margin:0 auto 1.5mm}
.ver{position:absolute;left:12mm;bottom:8mm;display:flex;gap:3mm;align-items:center;text-align:left;font-family:Arial,sans-serif;font-size:8.5pt;color:#444} .ver img{width:24mm;height:24mm}
.cod{font-family:'Courier New',monospace;font-weight:700;letter-spacing:.3mm} .peq{font-size:7pt;color:#777}
@media print{.barra{display:none}}
</style></head><body><div class="barra"><b>${items.length} diploma(s)</b><button onclick="window.print()">🖨 Imprimir</button><span style="font-size:12px">Papel A4 horizontal, sin márgenes ni ajuste a la página.</span></div>
${items.map(hoja).join('\n')}
</body></html>`;
  }

  const api = { codigoDiploma, codigoNuevo, normalizarCodigo, siguienteFolio, folioTexto, diplomaDuplicado, enmascararNombre, verificarDiploma, diplomasHTML, PATRON };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SigieDip = api;
})(typeof window !== 'undefined' ? window : globalThis);
