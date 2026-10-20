// Pruebas de la lógica pura de la biblioteca (bib-util.js): grado/sección, teléfonos, avisos, estadísticas, carnés y préstamo por aula.
const test = require('node:test');
const assert = require('node:assert');
const B = require('../bib-util.js');

/* ---------- grado y sección ---------- */
test('las distintas formas de escribir un aula caen en el mismo grupo', () => {
  const mismas = ['3° A PRIMARIA', '3A primaria', '3ro A Primaria', '3.º a primaria', 'Tercero A Primaria', '  3 ° a  PRIM ', '3º"A" primaria'];
  const claves = new Set(mismas.map(t => B.claveGrado(t, 'seccion')));
  assert.deepStrictEqual([...claves], ['3° A PRIMARIA']);
  assert.strictEqual(B.claveGrado('3A PRIMARIA', 'grado'), '3° PRIMARIA');
  assert.strictEqual(B.claveGrado('3° B PRIMARIA', 'grado'), '3° PRIMARIA', 'secciones distintas, mismo grado');
  assert.notStrictEqual(B.claveGrado('3° A PRIMARIA', 'seccion'), B.claveGrado('3° B PRIMARIA', 'seccion'));
});

test('primaria y secundaria no se mezclan; sin nivel no se adivina', () => {
  assert.notStrictEqual(B.claveGrado('3° A PRIMARIA', 'grado'), B.claveGrado('3° A SECUNDARIA', 'grado'));
  assert.strictEqual(B.claveGrado('1° SEC B', 'seccion'), '1° B SECUNDARIA');
  assert.strictEqual(B.claveGrado('3° A', 'seccion'), '3° A');
  assert.strictEqual(B.parsearGrado('3° A').nivel, '');
});

test('inicial por años, docentes, vacíos y texto libre', () => {
  assert.strictEqual(B.claveGrado('Inicial 4 años B', 'seccion'), '4 AÑOS B INICIAL');
  assert.strictEqual(B.claveGrado('5 años a', 'seccion'), '5 AÑOS A INICIAL');
  assert.strictEqual(B.claveGrado('DOCENTE — PRIMARIA', 'seccion'), 'DOCENTES Y PERSONAL');
  assert.strictEqual(B.parsearGrado('DOCENTE — INICIAL').esAlumno, false);
  assert.strictEqual(B.claveGrado('', 'grado'), 'SIN GRADO / SECCIÓN');
  assert.strictEqual(B.claveGrado(undefined, 'nivel'), 'SIN GRADO / SECCIÓN');
  assert.strictEqual(B.claveGrado('Taller de robótica', 'grado'), 'TALLER DE ROBÓTICA'.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
});

test('el orden va por nivel, grado y sección (no alfabético)', () => {
  const lista = ['2° B PRIMARIA', '10 libre', '1° A SECUNDARIA', '1° B PRIMARIA', '5 años A inicial', '1° A PRIMARIA', '2° A PRIMARIA'];
  const orden = lista.map(t => B.parsearGrado(t)).sort((a, b) => a.orden - b.orden).map(p => p.etiquetaSeccion);
  assert.deepStrictEqual(orden.slice(0, 6), ['5 AÑOS A INICIAL', '1° A PRIMARIA', '1° B PRIMARIA', '2° A PRIMARIA', '2° B PRIMARIA', '1° A SECUNDARIA']);
});

/* ---------- teléfonos ---------- */
test('teléfonos: celulares peruanos a formato wa.me', () => {
  for (const t of ['987654321', '987 654 321', '+51 987 654 321', '51987654321', '0051987654321', '(51) 987-654-321'])
    assert.deepStrictEqual(B.normalizarTelefono(t), { ok: true, numero: '51987654321' }, t);
  assert.strictEqual(B.normalizarTelefono('14567890').ok, false, 'un fijo no sirve para WhatsApp');
  assert.strictEqual(B.normalizarTelefono('').ok, false);
  assert.strictEqual(B.normalizarTelefono('abc').ok, false);
  assert.strictEqual(B.normalizarTelefono('51987654321999').ok, false);
  assert.deepStrictEqual(B.normalizarTelefono('+57 3001234567'), { ok: true, numero: '573001234567' }, 'otro país con código se respeta');
});

/* ---------- avisos ---------- */
const HOY = '2026-10-14';
const libros = [{ id: 'l1', cod: 'DIC-001', titulo: 'El Quijote', catId: 'c1' }, { id: 'l2', cod: 'CUE-002', titulo: 'Cuentos andinos', catId: 'c2' }, { id: 'l3', cod: 'CIE-003', titulo: 'Átomos', catId: 'c1' }];
const lectores = [
  { id: 'a1', cod: 'LEC-0001', nombre: 'ANA PEREZ', grado: '3° A PRIMARIA', tipo: 'Alumno', tel: '987654321' },
  { id: 'a2', cod: 'LEC-0002', nombre: 'LUIS RAMOS', grado: '3A primaria', tipo: 'Alumno' },
  { id: 'a3', cod: 'LEC-0003', nombre: 'MARTA SOTO', grado: '3° B PRIMARIA', tipo: 'Alumno', tel: '12345' },
  { id: 'd1', cod: 'LEC-0004', nombre: 'PROF. DIAZ', grado: 'DOCENTE — PRIMARIA', tipo: 'Docente', tel: '+51 999 111 222' }
];
const P = (id, libroId, lectorId, lector, vence, extra) => ({ id, libroId, lectorId, lector, grado: '', fecha: '2026-09-01', vence, devuelto: '', ...extra });

test('avisos: un mensaje por lector con todos sus libros vencidos, y solo a quien está vencido', () => {
  const prestamos = [
    P('p1', 'l1', 'a1', 'ANA PEREZ', '2026-10-01'),
    P('p2', 'l2', 'a1', 'ANA PEREZ', '2026-10-10'),
    P('p3', 'l3', 'a2', 'LUIS RAMOS', '2026-10-14'),                    // vence hoy: aún no es moroso
    P('p4', 'l3', 'a3', 'MARTA SOTO', '2026-09-20'),
    P('p5', 'l2', 'd1', 'PROF. DIAZ', '2026-10-12'),
    P('p6', 'l1', 'a2', 'LUIS RAMOS', '2026-09-01', { devuelto: '2026-09-05' })   // ya devuelto
  ];
  const av = B.avisosMorosos({ prestamos, lectores, libros, nombreIE: 'I.E. Prueba', hoy: HOY });
  assert.deepStrictEqual(av.map(a => a.nombre), ['MARTA SOTO', 'ANA PEREZ', 'PROF. DIAZ'], 'ordenados por atraso');
  const ana = av.find(a => a.nombre === 'ANA PEREZ');
  assert.strictEqual(ana.libros, 2); assert.strictEqual(ana.atrasoMax, 13);
  assert.match(ana.mensaje, /apoderado\(a\) de ANA PEREZ \(3° A PRIMARIA\)/);
  assert.match(ana.mensaje, /El Quijote.*DIC-001.*13 días de atraso/); assert.match(ana.mensaje, /Cuentos andinos.*4 días/);
  assert.match(ana.mensaje, /I\.E\. Prueba/);
  assert.strictEqual(ana.telefono, '51987654321');
  assert.ok(ana.url.startsWith('https://wa.me/51987654321?text=') && decodeURIComponent(ana.url).includes('El Quijote'));
  const marta = av.find(a => a.nombre === 'MARTA SOTO');
  assert.strictEqual(marta.url, ''); assert.match(marta.telefonoProblema, /incompleto/);
  const prof = av.find(a => a.nombre === 'PROF. DIAZ');
  assert.match(prof.mensaje, /^Estimado\(a\) PROF\. DIAZ:/, 'a un docente no se le escribe como a apoderado'); assert.strictEqual(prof.telefono, '51999111222');
});

test('avisos: filtro de atraso mínimo y marca del último aviso', () => {
  const prestamos = [P('p1', 'l1', 'a1', 'ANA PEREZ', '2026-10-12', { avisado: '2026-10-13' }), P('p2', 'l2', 'a3', 'MARTA SOTO', '2026-09-01')];
  assert.deepStrictEqual(B.avisosMorosos({ prestamos, lectores, libros, hoy: HOY, minDias: 7 }).map(a => a.nombre), ['MARTA SOTO']);
  const ana = B.avisosMorosos({ prestamos, lectores, libros, hoy: HOY }).find(a => a.nombre === 'ANA PEREZ');
  assert.strictEqual(ana.ultimoAviso, '2026-10-13'); assert.strictEqual(ana.diasDesdeAviso, 1);
});

test('avisos: un préstamo de un lector que ya no existe igual se avisa (sin celular)', () => {
  const prestamos = [P('p1', 'l1', '', 'ALUMNO ANTIGUO', '2026-09-01', { grado: '6° A PRIMARIA' })];
  const [a] = B.avisosMorosos({ prestamos, lectores, libros, hoy: HOY });
  assert.strictEqual(a.nombre, 'ALUMNO ANTIGUO'); assert.strictEqual(a.url, ''); assert.strictEqual(a.telefonoProblema, 'sin celular registrado');
});

/* ---------- estadísticas ---------- */
test('estadísticas: "3A" y "3° A PRIMARIA" cuentan como la misma sección', () => {
  const cats = [{ id: 'c1', nombre: 'Diccionarios' }, { id: 'c2', nombre: 'Cuentos' }];
  const prestamos = [
    P('p1', 'l1', 'a1', 'ANA PEREZ', '2026-10-01', { devuelto: '2026-10-02', fecha: '2026-09-20' }),
    P('p2', 'l2', 'a2', 'LUIS RAMOS', '2026-10-01', { fecha: '2026-09-25' }),                       // en casa y vencido
    P('p3', 'l2', 'a2', 'LUIS RAMOS', '2026-09-01', { devuelto: '2026-09-02', fecha: '2026-08-25' }),
    P('p4', 'l1', 'a3', 'MARTA SOTO', '2026-10-30', { fecha: '2026-10-02' })
  ];
  const r = B.estadisticasPorGrupo({ prestamos, lectores, libros, cats, hoy: HOY, cuanto: 'seccion' });
  const a = r.filas.find(f => f.grupo === '3° A PRIMARIA'), b = r.filas.find(f => f.grupo === '3° B PRIMARIA');
  assert.strictEqual(a.lectores, 2); assert.strictEqual(a.prestamos, 3); assert.strictEqual(a.lectoresActivos, 2);
  assert.strictEqual(a.participacion, 100); assert.strictEqual(a.promedio, 1.5);
  assert.strictEqual(a.enCasa, 1); assert.strictEqual(a.vencidos, 1); assert.strictEqual(a.categoriaTop, 'Cuentos');
  assert.strictEqual(b.lectores, 1); assert.strictEqual(b.prestamos, 1);
  const g = B.estadisticasPorGrupo({ prestamos, lectores, libros, cats, hoy: HOY, cuanto: 'grado' }).filas.find(f => f.grupo === '3° PRIMARIA');
  assert.strictEqual(g.lectores, 3); assert.strictEqual(g.prestamos, 4);
  const n = B.estadisticasPorGrupo({ prestamos, lectores, libros, cats, hoy: HOY, cuanto: 'nivel' }).filas.find(f => f.grupo === 'PRIMARIA');
  assert.strictEqual(n.lectores, 3);
});

test('estadísticas: periodo, docentes aparte y totales de alumnos', () => {
  const prestamos = [P('p1', 'l1', 'a1', 'ANA PEREZ', '2026-10-01', { fecha: '2026-03-01', devuelto: '2026-03-05' }), P('p2', 'l2', 'd1', 'PROF. DIAZ', '2026-10-20', { fecha: '2026-10-10' })];
  const r = B.estadisticasPorGrupo({ prestamos, lectores, libros, cats: [], hoy: HOY, desde: '2026-09-01', cuanto: 'seccion' });
  assert.strictEqual(r.filas.find(f => f.grupo === '3° A PRIMARIA').prestamos, 0, 'fuera del periodo');
  const doc = r.filas.find(f => f.grupo === 'DOCENTES Y PERSONAL');
  assert.strictEqual(doc.prestamos, 1); assert.strictEqual(doc.esAlumno, false);
  assert.strictEqual(r.totalAlumnos.lectores, 3, 'el total cuenta solo alumnos'); assert.strictEqual(r.totalAlumnos.prestamos, 0);
  assert.strictEqual(r.filas[r.filas.length - 1].grupo, 'DOCENTES Y PERSONAL', 'docentes al final');
});

test('estadísticas: un docente con grado "3° A" no infla el aula de los alumnos', () => {
  const lec = [...lectores, { id: 't1', cod: 'LEC-9', nombre: 'TUTOR', grado: '3° A PRIMARIA', tipo: 'Docente' }];
  const r = B.estadisticasPorGrupo({ prestamos: [], lectores: lec, libros, cats: [], hoy: HOY, cuanto: 'seccion' });
  assert.strictEqual(r.filas.find(f => f.grupo === '3° A PRIMARIA').lectores, 2);
});

/* ---------- carnés ---------- */
test('carnés: 8 por hoja, escapa nombres y usa el QR de cada código', () => {
  const muchos = Array.from({ length: 19 }, (_, i) => ({ id: 'x' + i, cod: 'LEC-' + String(i + 1).padStart(4, '0'), nombre: i === 0 ? '<img src=x onerror=alert(1)> "O\'NEIL"' : 'ALUMNO ' + i, grado: '3° A PRIMARIA', tipo: 'Alumno' }));
  const html = B.carnesHTML(muchos, { nombreIE: 'I.E. <Prueba>', qr: c => 'data:image/png;base64,' + c });
  assert.strictEqual((html.match(/class="carne"/g) || []).length, 19);
  assert.strictEqual((html.match(/class="pagina"/g) || []).length, 3, '19 carnés = 3 hojas');
  assert.ok(html.includes('data:image/png;base64,LEC-0019'));
  assert.ok(!html.includes('<img src=x'), 'el nombre no puede inyectar HTML');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;')); assert.ok(html.includes('I.E. &lt;Prueba&gt;'));
  assert.ok(html.includes('19 carné(s) · 3 hoja(s)'));
  assert.strictEqual((B.carnesHTML([], { qr: () => '' }).match(/class="pagina"/g) || []).length, 0);
});

/* ---------- préstamo por aula ---------- */
test('agruparTitulos junta los ejemplares de un mismo título y cuenta los libres', () => {
  const lib = [{ id: 'a', titulo: 'Rimas', autor: 'Bécquer', cant: 1 }, { id: 'b', titulo: 'RIMAS', autor: 'Becquer', cant: 1 }, { id: 'c', titulo: 'Rimas', autor: 'Bécquer', cant: 3 }, { id: 'd', titulo: 'Otro', autor: 'X', cant: 1 }];
  const prest = { a: 1, c: 1 };
  const g = B.agruparTitulos(lib, id => prest[id] || 0);
  const rimas = g.find(x => x.titulo.toLowerCase() === 'rimas');
  assert.strictEqual(rimas.total, 5); assert.strictEqual(rimas.libres, 3); assert.strictEqual(rimas.items.length, 3);
  assert.strictEqual(g.length, 2);
});

test('asignarAula: uno por lector, alfabético, respeta bloqueos y avisa a quién no le tocó', () => {
  const lec = [{ id: '1', nombre: 'CARLA' }, { id: '2', nombre: 'ANA' }, { id: '3', nombre: 'BETO' }, { id: '4', nombre: 'DANI' }];
  const items = [{ libro: { id: 'L1' }, libres: 1 }, { libro: { id: 'L2' }, libres: 1 }];
  const r = B.asignarAula(lec, items, { lector: l => l.nombre === 'BETO' ? 'tiene libros vencidos' : '' });
  assert.deepStrictEqual(r.asignaciones.map(a => a.lector.nombre + ':' + a.libro.id), ['ANA:L1', 'CARLA:L2']);
  assert.deepStrictEqual(r.sinEjemplar.map(l => l.nombre), ['DANI']);
  assert.deepStrictEqual(r.bloqueados.map(b => b.lector.nombre + ':' + b.motivo), ['BETO:tiene libros vencidos']);
  // no se pasa de los ejemplares libres ni reparte el mismo ejemplar dos veces
  const r2 = B.asignarAula(lec, [{ libro: { id: 'L1' }, libres: 3 }], {});
  assert.strictEqual(r2.asignaciones.length, 3); assert.strictEqual(r2.sinEjemplar.length, 1);
  // regla por libro: quien ya tiene el ejemplar L1 recibe otro
  const r3 = B.asignarAula([{ id: '1', nombre: 'ANA' }], [{ libro: { id: 'L1' }, libres: 1 }, { libro: { id: 'L2' }, libres: 1 }], { libro: (l, b) => b.id === 'L1' ? 'ya lo tiene' : '' });
  assert.strictEqual(r3.asignaciones[0].libro.id, 'L2');
});

test('lotesActivos agrupa por lote y solo muestra los que tienen libros sin devolver', () => {
  const prest = [
    { id: '1', lote: 'pl_1', loteNombre: '3° A · Rimas', fecha: '2026-10-01', vence: '2026-10-15', devuelto: '' },
    { id: '2', lote: 'pl_1', loteNombre: '3° A · Rimas', fecha: '2026-10-01', vence: '2026-10-15', devuelto: '2026-10-10' },
    { id: '3', lote: 'pl_2', loteNombre: '4° B · Cuentos', fecha: '2026-09-01', vence: '2026-09-15', devuelto: '2026-09-14' },
    { id: '4', fecha: '2026-10-02', vence: '2026-10-09', devuelto: '' }
  ];
  const l = B.lotesActivos(prest);
  assert.strictEqual(l.length, 1); assert.strictEqual(l[0].lote, 'pl_1'); assert.strictEqual(l[0].pendientes, 1); assert.strictEqual(l[0].total, 2);
});

/* ---------- v9: reseñas, lectores sin actividad y certificados ---------- */
test('reseñas: promedio por libro, ignora estrellas inválidas', () => {
  const m = B.resumenResenas([
    { libroId: 'a', estrellas: 5 }, { libroId: 'a', estrellas: 4 }, { libroId: 'a', estrellas: 0 }, { libroId: 'a', estrellas: 9 },
    { libroId: 'b', estrellas: '3' }, { estrellas: 5 }
  ]);
  assert.strictEqual(m.get('a').n, 2);
  assert.strictEqual(m.get('a').prom, 4.5);
  assert.strictEqual(m.get('b').prom, 3);
  assert.strictEqual(m.size, 2);
  assert.strictEqual(B.estrellasValidas(3.6), 4);
  assert.strictEqual(B.estrellasValidas(''), 0);
});

test('ranking de libros: más prestados primero, desempata por estrellas, no cuenta perdidos ni libros eliminados', () => {
  const libros = [{ id: 'a', titulo: 'A' }, { id: 'b', titulo: 'B' }, { id: 'c', titulo: 'C' }];
  const pres = [
    { libroId: 'a', fecha: '2026-03-01' }, { libroId: 'a', fecha: '2026-04-01' },
    { libroId: 'b', fecha: '2026-03-02' }, { libroId: 'b', fecha: '2026-03-03' },
    { libroId: 'c', fecha: '2026-03-02', perdido: true }, { libroId: 'zz', fecha: '2026-03-02' },
    { libroId: 'c', fecha: '2025-01-01' }
  ];
  const res = [{ libroId: 'b', estrellas: 5 }, { libroId: 'a', estrellas: 3 }];
  const r = B.rankingLibros(pres, res, libros, '2026-01-01');
  assert.deepStrictEqual(r.map(x => x.libro.id), ['b', 'a']);
  assert.strictEqual(r[0].prestamos, 2);
  assert.strictEqual(r[0].prom, 5);
  assert.strictEqual(B.rankingLibros(pres, res, libros, '').length, 3, 'sin filtro de fecha entra c (2025)');
});

test('devoluciones sin reseña: solo las devueltas, sin perdidos y sin reseña previa', () => {
  const pres = [
    { id: 'p1', devuelto: '2026-10-10' }, { id: 'p2', devuelto: '2026-10-12' }, { id: 'p3', devuelto: '' },
    { id: 'p4', devuelto: '2026-10-11', perdido: true }, { id: 'p5', devuelto: '2026-09-01' }
  ];
  const r = B.devolucionesSinResena(pres, [{ prestId: 'p1' }], '2026-10-01');
  assert.deepStrictEqual(r.map(p => p.id), ['p2']);
});

test('lectores sin actividad: por días, nunca leyeron primero, el que tiene un libro en mano no cuenta', () => {
  const hoy = '2026-10-15';
  const lect = [
    { id: 'l1', nombre: 'ANA' }, { id: 'l2', nombre: 'BETO' }, { id: 'l3', nombre: 'CARLA' },
    { id: 'l4', nombre: 'DIEGO', baja: true }, { id: 'l5', nombre: 'ELSA' }, { id: 'l6', nombre: 'FIDEL' }, { id: 'l7', nombre: 'GINA' }
  ];
  const pres = [
    { lectorId: 'l1', fecha: '2026-08-01', devuelto: '2026-08-08' },          // 68 días → inactiva
    { lectorId: 'l2', fecha: '2026-10-10', devuelto: '' , vence: '2026-10-20' }, // lo tiene en mano → activo
    { lectorId: 'l3', fecha: '2026-10-01', devuelto: '2026-10-05' },          // 10 días → activa
    { lectorId: 'l5', fecha: '2026-07-01', devuelto: '', vence: '2026-07-08' }, // vencido hace meses → inactivo
    { lectorId: 'l5', fecha: '2026-06-01', devuelto: '2026-06-09' },
    { lectorId: 'l7', fecha: '2026-09-05', devuelto: '', vence: '2026-11-01' } // lo sacó hace 40 días con plazo largo y aún no vence → está leyendo
  ];
  const r = B.lectoresInactivos(lect, pres, hoy, 30);
  assert.deepStrictEqual(r.map(x => x.lector.id), ['l6', 'l5', 'l1']);
  assert.strictEqual(r[0].sinPrestamos, true);
  assert.strictEqual(r[0].dias, null);
  assert.strictEqual(r.find(x => x.lector.id === 'l1').dias, 68);
  assert.strictEqual(r.find(x => x.lector.id === 'l5').ultima, '2026-07-01');
  assert.ok(!r.some(x => x.lector.id === 'l4'), 'los dados de baja no se avisan');
  assert.deepStrictEqual(B.lectoresInactivos(lect, pres, hoy, 90).map(x => x.lector.id), ['l6', 'l5'], 'con 90 días: quien nunca leyó y quien lleva 106 días (ANA, con 68, ya no)');
  assert.ok(B.lectoresInactivos(lect, pres, hoy, 'x').length >= 1, 'días inválidos → 30 por defecto');
});

test('certificados: candidatos por libros devueltos y HTML escapado, uno por hoja', () => {
  const lect = [{ id: 'l1', nombre: 'ANA <b>' }, { id: 'l2', nombre: 'BETO' }, { id: 'l3', nombre: 'CARLA', baja: true }];
  const pres = [
    ...['2026-02-01', '2026-03-01', '2026-04-01'].map(f => ({ lectorId: 'l1', fecha: f, devuelto: f })),
    { lectorId: 'l1', fecha: '2026-05-01', devuelto: '' }, { lectorId: 'l1', fecha: '2025-05-01', devuelto: '2025-05-02' },
    { lectorId: 'l2', fecha: '2026-02-01', devuelto: '2026-02-02' }, { lectorId: 'l2', fecha: '2026-02-03', devuelto: '2026-02-04', perdido: true },
    ...[1, 2, 3].map(() => ({ lectorId: 'l3', fecha: '2026-02-01', devuelto: '2026-02-02' }))
  ];
  const c = B.candidatosCertificado(lect, pres, 3, '2026-01-01');
  assert.deepStrictEqual(c.map(x => [x.lector.id, x.libros]), [['l1', 3]]);
  assert.strictEqual(B.candidatosCertificado(lect, pres, 1, '').length, 2);
  const html = B.certificadosHTML([{ nombre: 'ANA <b>', grado: '3° A', libros: 3, insignia: '🥉 Lector curioso' }, { nombre: 'BETO', libros: 1 }], { nombreIE: 'I.E. X', anio: 2026, fecha: '15/10/2026' });
  assert.strictEqual((html.match(/class="cert"/g) || []).length, 2);
  assert.ok(html.includes('ANA &lt;b&gt;') && !html.includes('ANA <b>'));
  assert.ok(html.includes('A4 landscape'));
});
