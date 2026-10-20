// Lectómetro integrado + diplomas con verificación: lógica pura (sin navegador ni servidor).
const test = require('node:test');
const assert = require('node:assert');
const L = require('../lectometro-util.js');
const D = require('../diplomas-util.js');

/* ---------------- Lectómetro ---------------- */
test('puntos: 2 por página y 0,5 por minuto; niveles de lector con lo que falta para el siguiente', () => {
  assert.strictEqual(L.puntosLectura(10, 20), 30);
  assert.strictEqual(L.puntosLectura('x', -5), 0);
  assert.strictEqual(L.nivelDeLector(0).nombre, 'Explorador de Páginas');
  assert.strictEqual(L.nivelDeLector(199).faltan, 1);
  assert.strictEqual(L.nivelDeLector(600).nombre, 'Sabio Lector');
  assert.strictEqual(L.nivelDeLector(5000).siguiente, null);
});

test('puntaje → nivel de logro AD/A/B/C con los cortes del Lectómetro (51, 71, 91)', () => {
  const casos = [[0, 'C'], [50, 'C'], [51, 'B'], [70, 'B'], [71, 'A'], [90, 'A'], [91, 'AD'], [100, 'AD']];
  for (const [p, n] of casos) assert.strictEqual(L.nivelLogroDePuntaje(p), n, p + '%');
});

test('evaluación: valida el cuestionario y califica (sin responder cuenta como incorrecta)', () => {
  const ok = { titulo: 'El zorro', preguntas: [
    { texto: '¿Quién?', opciones: ['A', 'B'], correcta: 1 }, { texto: '¿Dónde?', opciones: ['X', 'Y', 'Z'], correcta: 0 },
    { texto: '¿Cuándo?', opciones: ['1', '2'], correcta: 1 }, { texto: '¿Por qué?', opciones: ['p', 'q'], correcta: 0 }] };
  assert.strictEqual(L.validarEvaluacion(ok), '');
  assert.match(L.validarEvaluacion({ titulo: '', preguntas: [] }), /título/);
  assert.match(L.validarEvaluacion({ titulo: 'x', preguntas: [] }), /al menos una pregunta/);
  assert.match(L.validarEvaluacion({ titulo: 'x', preguntas: [{ texto: 'a', opciones: ['solo'], correcta: 0 }] }), /2 opciones/);
  assert.match(L.validarEvaluacion({ titulo: 'x', preguntas: [{ texto: 'a', opciones: ['a', 'b'], correcta: 5 }] }), /respuesta correcta/);
  const r = L.calificarEvaluacion(ok, [1, 0, 1, null]);
  assert.deepStrictEqual([r.correctas, r.total, r.puntaje, r.nivel], [3, 4, 75, 'A']);
  assert.strictEqual(L.calificarEvaluacion(ok, [1, 0, 1, 0]).nivel, 'AD');
  assert.strictEqual(L.calificarEvaluacion({ preguntas: [] }, []).puntaje, 0);
});

test('rachas: sigue viva si leyó hoy o ayer; se corta si falta un día; racha máxima histórica', () => {
  assert.strictEqual(L.rachaActual(['2026-10-13', '2026-10-14', '2026-10-15'], '2026-10-15'), 3);
  assert.strictEqual(L.rachaActual(['2026-10-13', '2026-10-14'], '2026-10-15'), 2, 'ayer cuenta');
  assert.strictEqual(L.rachaActual(['2026-10-12', '2026-10-13'], '2026-10-15'), 0, 'se cortó');
  assert.strictEqual(L.rachaActual(['2026-10-15', '2026-10-15', '2026-10-13'], '2026-10-15'), 1, 'repetidas y hueco');
  assert.strictEqual(L.rachaMaxima(['2026-09-01', '2026-09-02', '2026-09-03', '2026-10-01', '2026-10-02']), 3);
  assert.strictEqual(L.rachaMaxima([]), 0);
  // cruza fin de mes y de año
  assert.strictEqual(L.rachaMaxima(['2026-12-31', '2027-01-01']), 2);
});

function datosLector(extra) {
  const dias = []; for (let i = 0; i < 7; i++) dias.push('2026-10-' + String(9 + i).padStart(2, '0'));
  return Object.assign({
    lector: { id: 'L1', nombre: 'ANA' }, hoy: '2026-10-15',
    bitacora: dias.map((f, i) => ({ id: 'b' + i, lectorId: 'L1', libroId: 'lib' + (i % 3), fecha: f, paginas: 10, minutos: 20, puntos: 30 })).concat([{ id: 'x', lectorId: 'OTRO', libroId: 'z', fecha: '2026-10-15', puntos: 999 }]),
    prestamos: [], comprension: [], resenas: [], canjes: [], premios: []
  }, extra || {});
}
test('resumen del lector: puntos ganados/gastados/saldo, racha, libros distintos e insignias', () => {
  const r = L.resumenLector(datosLector({ canjes: [{ lectorId: 'L1', premioId: 'p1', estado: 'pendiente' }], premios: [{ id: 'p1', costoPuntos: 50 }] }));
  assert.strictEqual(r.puntos, 210, 'no suma la bitácora de otro lector');
  assert.strictEqual(r.gastados, 50);
  assert.strictEqual(r.saldo, 160);
  assert.strictEqual(r.racha, 7);
  assert.strictEqual(r.libros, 3);
  assert.deepStrictEqual(r.insignias.sort(), ['primer_libro', 'racha_7'].sort());
  assert.strictEqual(r.nivel.nombre, 'Aventurero Literario');
});
test('canje anulado devuelve los puntos; el costo guardado manda sobre el precio actual del premio', () => {
  const base = datosLector({ premios: [{ id: 'p1', costoPuntos: 500 }] });
  assert.strictEqual(L.resumenLector({ ...base, canjes: [{ lectorId: 'L1', premioId: 'p1', estado: 'anulado' }] }).saldo, 210);
  assert.strictEqual(L.resumenLector({ ...base, canjes: [{ lectorId: 'L1', premioId: 'p1', costo: 20, estado: 'entregado' }] }).saldo, 190);
});
test('insignias que dependen de préstamos, reseñas y evaluaciones', () => {
  const prest = []; for (let i = 0; i < 10; i++) prest.push({ id: 'p' + i, lectorId: 'L1', libroId: 'pl' + i, fecha: '2026-03-01', vence: '2026-03-08', devuelto: '2026-03-07' });
  const cmp = []; for (let i = 0; i < 5; i++) cmp.push({ lectorId: 'L1', nivel: 'AD' });
  const res = []; for (let i = 0; i < 5; i++) res.push({ lectorId: 'L1' });
  const r = L.resumenLector({ lector: { id: 'L1' }, hoy: '2026-10-15', bitacora: [], prestamos: prest, comprension: cmp, resenas: res, canjes: [], premios: [] });
  for (const i of ['primer_libro', 'devorador', 'comprension_alta', 'prestamo_responsable', 'critico']) assert.ok(r.insignias.includes(i), i);
  assert.ok(!r.insignias.includes('racha_7'));
  // un libro perdido o devuelto tarde no cuenta como "a tiempo"
  prest.forEach(p => { p.devuelto = '2026-03-20'; });
  assert.ok(!L.resumenLector({ lector: { id: 'L1' }, hoy: '2026-10-15', bitacora: [], prestamos: prest, comprension: [], resenas: [], canjes: [], premios: [] }).insignias.includes('prestamo_responsable'));
  prest.forEach(p => { p.perdido = true; });
  assert.strictEqual(L.resumenLector({ lector: { id: 'L1' }, hoy: '2026-10-15', bitacora: [], prestamos: prest, comprension: [], resenas: [], canjes: [], premios: [] }).libros, 0);
});
test('meta mensual: libros distintos en un mismo mes', () => {
  const bit = ['a', 'b', 'c', 'd'].map((l, i) => ({ lectorId: 'L1', libroId: l, fecha: '2026-05-0' + (i + 1), puntos: 1 }));
  assert.ok(L.resumenLector({ lector: { id: 'L1' }, hoy: '2026-10-15', bitacora: bit, metaLibros: 4 }).insignias.includes('meta_mensual'));
  assert.ok(!L.resumenLector({ lector: { id: 'L1' }, hoy: '2026-10-15', bitacora: bit.slice(0, 3), metaLibros: 4 }).insignias.includes('meta_mensual'));
});

test('ranking: solo alumnos con puntos, empates comparten puesto, canjear no baja de puesto', () => {
  const lectores = [{ id: 'a', nombre: 'A', tipo: 'Alumno', grado: '3A' }, { id: 'b', nombre: 'B', tipo: 'Alumno' }, { id: 'c', nombre: 'C', tipo: 'Alumno' }, { id: 'd', nombre: 'D', tipo: 'Docente' }, { id: 'e', nombre: 'E', tipo: 'Alumno', baja: true }];
  const bitacora = [{ lectorId: 'a', puntos: 100, fecha: '2026-10-01', libroId: 'x' }, { lectorId: 'b', puntos: 100, fecha: '2026-10-01', libroId: 'x' }, { lectorId: 'c', puntos: 40, fecha: '2026-10-01', libroId: 'x' }, { lectorId: 'd', puntos: 900, fecha: '2026-10-01' }, { lectorId: 'e', puntos: 900, fecha: '2026-10-01' }];
  const r = L.rankingPuntos({ lectores, bitacora, hoy: '2026-10-15', canjes: [{ lectorId: 'a', premioId: 'p', costo: 90, estado: 'entregado' }], premios: [] });
  assert.deepStrictEqual(r.map(f => [f.lector.id, f.pos]), [['a', 1], ['b', 1], ['c', 3]]);
});

test('premios: motivos por los que no se puede canjear', () => {
  assert.match(L.motivoNoCanje(null, 100), /disponible/);
  assert.match(L.motivoNoCanje({ activo: false, costoPuntos: 1 }, 100), /disponible/);
  assert.match(L.motivoNoCanje({ costoPuntos: 1, stock: 0 }, 100), /unidades/);
  assert.match(L.motivoNoCanje({ costoPuntos: 50 }, 49), /insuficientes/);
  assert.strictEqual(L.motivoNoCanje({ costoPuntos: 50, stock: null }, 50), '');
  assert.strictEqual(L.motivoNoCanje({ costoPuntos: 50, stock: 3 }, 80), '');
});

test('actividades del plan lector: próximas (incluye hoy) y vencidas sin hacer', () => {
  const a = [{ id: 1, fecha: '2026-10-15', titulo: 'Hoy' }, { id: 2, fecha: '2026-10-22', titulo: 'En 7' }, { id: 3, fecha: '2026-10-23', titulo: 'En 8' }, { id: 4, fecha: '2026-10-10', titulo: 'Vieja' }, { id: 5, fecha: '2026-10-16', titulo: 'Hecha', hecha: true }];
  assert.deepStrictEqual(L.actividadesProximas(a, '2026-10-15', 7).map(x => x.id), [1, 2]);
  assert.deepStrictEqual(L.actividadesVencidas(a, '2026-10-15').map(x => x.id), [4]);
});

test('certificado de lectura: escapa HTML y muestra nivel y puntos', () => {
  const html = L.certificadoLectorHTML({ nombre: '<img src=x onerror=1>', grado: '3A', resumen: { nivel: L.nivelDeLector(250), puntos: 250, libros: 4, rachaMax: 5, insignias: ['racha_7'] }, nombreIE: 'IE <b>' });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img') && html.includes('Aventurero Literario') && html.includes('250'));
});

/* ---------------- Migración desde LectorIEP ---------------- */
const paquete = () => ({ sistema: 'LectorIEP', data: {
  usuarios: [{ id: 'u1', nombre: 'María Pérez', rol: 'estudiante', aulaId: 'au1', puntos: 200 }, { id: 'u2', nombre: 'Luis Soto', rol: 'estudiante', nivel: 'secundaria', grado: 2, seccion: 'B', puntos: 0 }, { id: 'u3', nombre: 'Prof', rol: 'docente' }],
  aulas: [{ id: 'au1', nivel: 'primaria', grado: 3, seccion: 'A' }],
  libros: [{ id: 'b1', titulo: 'El Zorro y la Luna', autor: 'X' }, { id: 'b2', titulo: 'Libro que no está', autor: 'Y' }],
  bitacora: [{ id: 'r1', usuarioId: 'u1', libroId: 'b1', fecha: '2026-10-01', paginas: 10, minutos: 20, autoevaluacion: 4, comentario: 'Lindo', puntos: 30 }, { id: 'r2', usuarioId: 'u3', libroId: 'b1', fecha: '2026-10-02' }],
  quizzes: [{ id: 'q1', libroId: 'b1', titulo: 'Zorro', preguntas: [{ texto: 'p', opciones: ['a', 'b'], correcta: 0 }] }],
  resultadosQuiz: [{ id: 'qr1', usuarioId: 'u1', quizId: 'q1', puntaje: 95, nivel: 'logro_destacado', fecha: '2026-10-03' }],
  premios: [{ id: 'pr1', nombre: 'Stickers', costoPuntos: 50, stock: 5, activo: true }],
  canjes: [{ id: 'cj1', usuarioId: 'u1', premioId: 'pr1', fecha: '2026-10-04', estado: 'entregado' }],
  actividades: [{ id: 'ac1', titulo: 'Feria del libro', fecha: '2026-11-05', tipo: 'Feria' }],
  prestamos: [{ id: 'p1', usuarioId: 'u1', libroId: 'b1', fechaPrestamo: '2026-10-01', fechaDevolucionEsperada: '2026-10-05', fechaDevolucionReal: '2026-10-04' }, { id: 'p2', usuarioId: 'u1', libroId: 'b2', fechaPrestamo: '2026-10-01', fechaDevolucionEsperada: '2026-10-05' }]
} });
const ctx = () => { let n = 0; return { lectores: [{ id: 'lecX', cod: 'LEC-0001', nombre: 'MARIA PEREZ', grado: '3A' }], libros: [{ id: 'libS', titulo: 'El zorro y la luna' }], uid: p => p + '_' + (++n), siguienteCod: extra => 'LEC-' + String(2 + extra.length).padStart(4, '0') }; };
test('migración LectorIEP: reutiliza lectores por nombre, crea los que faltan y no toca lo existente', () => {
  const r = L.convertirLectometro(paquete(), ctx());
  assert.ok(!r.error);
  assert.strictEqual(r.reporte.lectoresExistentes, 1, 'María ya existía (sin importar tildes ni mayúsculas)');
  assert.strictEqual(r.reporte.lectores, 1);
  const luis = r.nuevo.lectores[0];
  assert.deepStrictEqual([luis.nombre, luis.cod, luis.grado, luis.tipo], ['LUIS SOTO', 'LEC-0002', '2° B Secundaria', 'Alumno']);
  assert.strictEqual(r.nuevo.bitacora.length, 1, 'la bitácora de un docente no se importa');
  assert.strictEqual(r.nuevo.bitacora[0].lectorId, 'lecX');
  assert.strictEqual(r.nuevo.bitacora[0].libroId, 'libS', 'el libro se enlaza por título');
  assert.ok(r.reporte.omitidos.some(o => /no es estudiante/.test(o)));
});
test('migración: el resultado del cuestionario también queda como Comprensión lectora', () => {
  const r = L.convertirLectometro(paquete(), ctx());
  assert.strictEqual(r.nuevo.quizres[0].nivel, 'AD');
  assert.strictEqual(r.nuevo.comprension.length, 1);
  assert.deepStrictEqual([r.nuevo.comprension[0].nivel, r.nuevo.comprension[0].lectorId, r.nuevo.comprension[0].grado], ['AD', 'lecX', '3A']);
  assert.strictEqual(r.nuevo.quizzes[0].libroId, 'libS');
});
test('migración: premios, canjes con su costo, actividades y préstamos de libros que sí están en el catálogo', () => {
  const r = L.convertirLectometro(paquete(), ctx());
  assert.strictEqual(r.nuevo.premios[0].costoPuntos, 50);
  assert.deepStrictEqual([r.nuevo.canjes[0].costo, r.nuevo.canjes[0].estado, r.nuevo.canjes[0].premioId], [50, 'entregado', r.nuevo.premios[0].id]);
  assert.strictEqual(r.nuevo.actividades[0].titulo, 'Feria del libro');
  assert.strictEqual(r.nuevo.prestamos.length, 1);
  assert.strictEqual(r.nuevo.prestamos[0].devuelto, '2026-10-04');
  assert.ok(r.reporte.omitidos.some(o => /Libro que no está/.test(o)), 'avisa el préstamo que no pudo importar');
});
test('migración: conserva los puntos que la bitácora no explica y es idempotente (no duplica al repetir)', () => {
  const r = L.convertirLectometro(paquete(), ctx());
  // María tenía 200 puntos: bitácora 30 − canje 50 = −20 → quedaron 220 sin explicar. Como ya existía en SIGIE, no se les guarda ajuste.
  assert.strictEqual(r.nuevo.lectores.length, 1);
  const ya = [];
  for (const k of ['bitacora', 'quizzes', 'quizres', 'premios', 'canjes', 'actividades', 'prestamos']) r.nuevo[k].forEach(x => ya.push(x.origen));
  const c2 = ctx(); c2.yaImportados = ya;
  const r2 = L.convertirLectometro(paquete(), c2);
  for (const k of ['bitacora', 'quizzes', 'quizres', 'premios', 'canjes', 'actividades', 'prestamos']) assert.strictEqual(r2.nuevo[k].length, 0, k + ' no debe duplicarse');
});
test('migración: archivo que no es del Lectómetro da error claro', () => {
  assert.match(L.convertirLectometro({ foo: 1 }, ctx()).error, /respaldo del Lectómetro/);
  assert.match(L.convertirLectometro(null, ctx()).error, /respaldo del Lectómetro/);
});

/* ---------------- Diplomas ---------------- */
test('código de diploma: formato D-XXXX-XXXX sin caracteres ambiguos, y único', () => {
  const vistos = new Set();
  for (let i = 0; i < 2000; i++) { const c = D.codigoDiploma(); assert.match(c, D.PATRON); assert.ok(!/[01OIL]/.test(c.slice(2))); vistos.add(c); }
  assert.strictEqual(vistos.size, 2000);
  // reintenta si el azar repite un código ya usado
  const seq = [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]; let i = 0;
  const usado = D.codigoDiploma(() => 0);
  assert.notStrictEqual(D.codigoNuevo([{ codigo: usado }], () => seq[i++ % seq.length]), usado);
});
test('normalizar código: acepta minúsculas, espacios, sin guiones y la URL completa del QR; rechaza lo demás', () => {
  const c = D.codigoDiploma(() => 0.3);
  assert.strictEqual(D.normalizarCodigo(c.toLowerCase()), c);
  assert.strictEqual(D.normalizarCodigo(' ' + c.replace(/-/g, ' ') + ' '), c);
  assert.strictEqual(D.normalizarCodigo(c.replace(/-/g, '')), c);
  assert.strictEqual(D.normalizarCodigo('http://192.168.1.5:3000/verificar.html?c=' + encodeURIComponent(c)), c);
  for (const mal of ['', 'hola', 'D-OOOO-1111', 'D-ABC-DEFG', null, undefined]) assert.strictEqual(D.normalizarCodigo(mal), '');
});
test('folio correlativo por año (los anulados no liberan su número) y duplicados por lector/tipo/clave/año', () => {
  const ds = [{ anio: 2026, folio: 1 }, { anio: 2026, folio: 2, anulado: true }, { anio: 2025, folio: 40 }];
  assert.strictEqual(D.siguienteFolio(ds, 2026), 3);
  assert.strictEqual(D.siguienteFolio(ds, 2027), 1);
  assert.strictEqual(D.folioTexto(7, 2026), 'N.° 0007-2026');
  const dup = [{ lectorId: 'L', tipo: 'lector', clave: '6', anio: 2026 }, { lectorId: 'L2', tipo: 'lector', clave: '6', anio: 2026, anulado: true }];
  assert.ok(D.diplomaDuplicado(dup, { lectorId: 'L', tipo: 'lector', clave: '6', anio: 2026 }));
  assert.ok(!D.diplomaDuplicado(dup, { lectorId: 'L', tipo: 'lector', clave: '10', anio: 2026 }), 'otra insignia no es duplicado');
  assert.ok(!D.diplomaDuplicado(dup, { lectorId: 'L', tipo: 'lector', clave: '6', anio: 2027 }), 'otro año no es duplicado');
  assert.ok(!D.diplomaDuplicado(dup, { lectorId: 'L2', tipo: 'lector', clave: '6', anio: 2026 }), 'uno anulado no cuenta');
});
test('verificación: auténtico, anulado, inexistente y mal formado; el nombre sale enmascarado y sin otros datos', () => {
  const dips = [{ codigo: 'D-ABCD-2345', nombre: 'ROSAS DE LA CRUZ DAPHNE', grado: '3A', titulo: 'Lector del año', fecha: '2026-10-15', folio: 3, anio: 2026, dni: '12345678', tel: '999' },
    { codigo: 'D-WXYZ-6789', nombre: 'LUIS', anulado: true, folio: 4, anio: 2026 }];
  const ok = D.verificarDiploma(dips, 'd-abcd-2345', { nombreIE: 'IE 20150' });
  assert.strictEqual(ok.valido, true);
  assert.strictEqual(ok.nombre, 'RO*** DE LA CR** DA****');
  assert.strictEqual(ok.folio, 'N.° 0003-2026');
  const txt = JSON.stringify(ok);
  for (const secreto of ['12345678', '999', 'ROSAS', 'DAPHNE', '3A']) assert.ok(!txt.includes(secreto), 'no debe filtrar ' + secreto);
  assert.deepStrictEqual([D.verificarDiploma(dips, 'D-WXYZ-6789').valido, D.verificarDiploma(dips, 'D-WXYZ-6789').motivo], [false, 'anulado']);
  assert.strictEqual(D.verificarDiploma(dips, 'D-ZZZZ-2222').motivo, 'no_encontrado');
  assert.strictEqual(D.verificarDiploma(dips, 'basura').motivo, 'formato');
  assert.strictEqual(D.verificarDiploma(null, 'D-ZZZZ-2222').motivo, 'no_encontrado');
});
test('diploma imprimible: QR con la URL de verificación, marca DUPLICADO y todo escapado', () => {
  const urls = [];
  const html = D.diplomasHTML([{ nombre: '<script>alert(1)</script>', titulo: 'T', motivo: 'M', fecha: '1 de octubre', folio: 'N.° 0001-2026', codigo: 'D-ABCD-2345', duplicado: true }, { nombre: 'Normal', titulo: 'T', motivo: 'M', fecha: 'f', folio: 'N.° 0002-2026', codigo: 'D-EFGH-2345' }],
    { nombreIE: 'IE', urlBase: 'https://colegio.edu.pe/', qrImg: u => { urls.push(u); return 'data:image/png;base64,AAA'; } });
  assert.deepStrictEqual(urls, ['https://colegio.edu.pe/verificar.html?c=D-ABCD-2345', 'https://colegio.edu.pe/verificar.html?c=D-EFGH-2345']);
  assert.ok(!html.includes('<script>alert'));
  assert.strictEqual((html.match(/class="marca"/g) || []).length, 1, 'solo el duplicado lleva marca');
  assert.ok(html.includes('size:A4 landscape'));
});
test('enmascarar nombre: no revela el nombre completo', () => {
  assert.strictEqual(D.enmascararNombre('  ana  de la  torre '), 'an* de la to***');
  assert.strictEqual(D.enmascararNombre(''), '');
  assert.strictEqual(D.enmascararNombre(null), '');
});
