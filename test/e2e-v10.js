// Prueba de extremo a extremo de la v10 en un NAVEGADOR REAL (Chromium vía Playwright) contra el servidor real.
// No forma parte de `npm test` (que usa jsdom): se corre a mano cuando hay Playwright instalado:
//     npm i -D playwright && npx playwright install chromium
//     node test/e2e-v10.js
// Sale con código 1 si algo falla. Los CDN (Excel, QR) se bloquean a propósito: se prueba sin internet.
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { console.log('Playwright no está instalado: se omite.'); process.exit(0); }

const RAIZ = path.join(__dirname, '..');
const PUERTO = 5900 + Math.floor(Math.random() * 90), URL = 'http://127.0.0.1:' + PUERTO;
const esperar = ms => new Promise(r => setTimeout(r, ms));
let ok = 0; const fallos = [];
let paginaActual = null;
async function paso(nombre, fn) { try { await fn(); ok++; console.log('  ✔', nombre); } catch (e) { try { for (const pg of module.exports.paginas || []) await pg.evaluate(() => document.querySelectorAll('.modal-bg').forEach(m => m.remove())); } catch (_) {} fallos.push(nombre + ': ' + (e.stack || e.message).split('\n').slice(0, 4).join(' | ')); console.log('  ✖', nombre, '\n     ', e.message.split('\n')[0]); } }

async function abrir(browser, usuario, clave) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.route(u => !u.href.startsWith(URL), r => r.abort());
  const post = async (ruta, cuerpo) => (await ctx.request.post(URL + ruta, { data: cuerpo }));
  let r = await post('/api/login', { usuario, password: clave.inicial });
  const d = await r.json();
  if (d.debeCambiarPass) await post('/api/password', { nueva: clave.nueva });
  const page = await ctx.newPage(), errores = [];
  page.on('pageerror', e => errores.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errores.push('console.error: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(URL + '/index.html');
  await page.waitForFunction(() => typeof STATE !== 'undefined' && STATE.loaded && document.getElementById('content').innerHTML.length > 200, null, { timeout: 15000 });
  return { ctx, page, errores };
}
const ir = (page, vista) => page.evaluate(v => { STATE.view = v; render(); }, vista);
const texto = page => page.evaluate(() => document.getElementById('content').textContent);

module.exports = { URL, PUERTO, RAIZ, esperar, paso, abrir, ir, texto, chromium, get resumen() { return { ok, fallos }; }, iniciarServidor() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigie-e2e-'));
  const hijo = spawn(process.execPath, [path.join(RAIZ, 'server.js')], { env: { ...process.env, PORT: String(PUERTO), SIGIE_DATA_DIR: dir }, stdio: 'ignore' });
  return { hijo, dir, parar() { hijo.kill(); fs.rmSync(dir, { recursive: true, force: true }); } };
} };


/* ===================== recorrido ===================== */
async function cargarEjemplo(page) {
  return page.evaluate(async () => {
    const D = window.construirDatosEjemplo({ hoy: today(), anio: new Date().getFullYear(), uid, bibCats: BIB_SEED, categoriasDeprec: SEED_CATEGORIAS_DEPREC, lookupCategoria: lookupCategoriaDeprec, usuariosPrevios: [], totalesSIGIE: () => ({ porCategoria: [] }), snapshotItems: i => i.map(x => ({ id: x.id })) }).bib;
    for (const [k, v] of [[BKEYS.cats, D.cats], [BKEYS.libros, D.libros], [BKEYS.lect, D.lectores], [BKEYS.prest, D.prest], [B2.res, D.res], [B2.baj, D.baj], [B5.res, D.resenas], [B6.lec, D.lecturas], [B6.cmp, D.compr], [B6.met, D.metas]]) await DB.save(k, v);
    return { lecturas: D.lecturas.length, compr: D.compr.length };
  });
}
const ev = (page, expr) => page.evaluate(expr);
const modalAbierto = page => page.waitForSelector('.modal-bg', { timeout: 5000 });
const modalCerrado = page => page.waitForFunction(() => !document.querySelector('.modal-bg'), null, { timeout: 5000 });
const titulosModales = page => page.evaluate(() => [...document.querySelectorAll('.modal-bg .m-h h3')].map(h => h.textContent));
const cerrarModales = async page => { await page.evaluate(() => document.querySelectorAll('.modal-bg').forEach(m => m.remove())); };

async function main() {
  const srv = module.exports.iniciarServidor();
  for (let i = 0; i < 80; i++) { try { if ((await fetch(URL + '/api/health')).ok) break; } catch (e) {} await esperar(100); }
  const browser = await chromium.launch();
  const erroresTotales = [];
  try {
    const A = await abrir(browser, 'admin', { inicial: 'admin123', nueva: 'ClaveSegura#2026' }), page = A.page; module.exports.paginas = [page];
    await cargarEjemplo(page);
    await page.reload(); await page.waitForFunction(() => STATE.loaded && document.getElementById('content').innerHTML.length > 200);

    console.log('\nVistas');
    await paso('las vistas nuevas, Retos y el menú se dibujan; el menú trae las 2 entradas nuevas y Sanciones solo si hay política', async () => {
      for (const v of ['bibLecturas', 'bibCompr', 'bibSanc', 'bibRetos', 'bibInicio']) { await ir(page, v); assert.ok((await texto(page)).length > 100, v); }
      const nav = await page.evaluate(() => document.querySelector('#nav, nav, .sidebar').textContent);
      assert.ok(nav.includes('Lecturas por aula') && nav.includes('Comprensión lectora'));
      assert.ok(!nav.includes('Sanciones por atraso'), 'apagada y sin sanciones: no estorba en el menú');
    });
    await paso('Lecturas: cada fila muestra recibieron/devolvieron/atrasados que calcula la lógica; las completas se ocultan en "Pendientes"', async () => {
      await ir(page, 'bibLecturas');
      const todas = await ev(page, 'bibLecturasCalcTodas().map(x=>({aula:x.l.aula,r:x.av.recibieron,d:x.av.devolvieron,t:x.av.total,a:x.av.atrasados,c:x.av.completa}))');
      assert.strictEqual(todas.length, 3);
      const pendientes = todas.filter(x => !x.c);
      assert.strictEqual(await page.locator('[data-lcver]').count(), pendientes.length);
      const t = await texto(page);
      for (const x of pendientes) { assert.ok(t.includes(x.aula)); assert.ok(t.includes(`${x.r}/${x.t}`) && t.includes(`${x.d}/${x.t}`)); }
      assert.ok(todas.some(x => x.c), 'el ejemplo trae una lectura completa');
      await page.selectOption('#lcVer', 'todas'); assert.strictEqual(await page.locator('[data-lcver]').count(), 3);
      await page.selectOption('#lcVer', 'activas');
      assert.ok((await ev(page, 'bibLecturasAtrasadasN()')) > 0 && (await page.evaluate(() => document.querySelector('.sidebar, nav, #nav').textContent)).includes('Lecturas por aula'));
    });

    console.log('\nAsignar una lectura y prestarla al aula');
    let nueva;
    await paso('Asignar: valida la fecha, busca el libro, guarda y no permite repetir la misma lectura', async () => {
      // un aula donde se pueda prestar y un libro libre
      const eleg = await page.evaluate(() => {
        const aulas = bibGruposLector().filter(g => !/^DOCENTES|^SIN GRADO/.test(g.clave));
        const aula = aulas.find(g => bibLect().some(l => !l.baja && bibEsAlumno(l) && bibGrupoDe(l) === g.clave && bibPuede(l, l.nombre) === '' && !bibLecturas().some(x => x.aula === g.clave)));
        const libro = bibLibros().find(l => bibPrestados(l.id) === 0 && !bibLecturas().some(x => x.libroTitulo === l.titulo) && bibEjemplares(l) === 1);
        return { aula: aula.clave, titulo: libro.titulo, n: bibLecturas().length };
      });
      await ir(page, 'bibLecturas'); await page.click('#lcNueva'); await modalAbierto(page);
      await page.selectOption('#lcAula', eleg.aula);
      await page.fill('#lcQ', eleg.titulo.slice(0, 8));
      assert.ok((await page.locator('#lcTit option').count()) >= 1, 'el buscador filtra');
      await page.selectOption('#lcTit', { index: 0 });
      const opcion = await page.locator('#lcTit option').evaluateAll(os => os.map(o => o.textContent));
      const idx = opcion.findIndex(t => t.startsWith(eleg.titulo)); await page.selectOption('#lcTit', { index: idx });
      await page.fill('#lcLim', await page.evaluate(() => bibEnDias(-1)));
      await page.click('#bmS'); await esperar(300);
      assert.strictEqual(await ev(page, 'bibLecturas().length'), eleg.n, 'fecha pasada: no guarda');
      assert.ok(await page.locator('.modal-bg').count(), 'y la ventana sigue abierta');
      await page.fill('#lcLim', await page.evaluate(() => bibEnDias(10)));
      await page.fill('#lcObs', 'Leer el capítulo 1');
      await page.click('#bmS'); await modalCerrado(page);
      await page.waitForFunction(n => bibLecturas().length === n + 1, eleg.n);
      nueva = await ev(page, 'bibLecturas().slice(-1)[0]');
      assert.deepStrictEqual([nueva.aula, nueva.libroTitulo, nueva.obs, nueva.docente], [eleg.aula, eleg.titulo, 'Leer el capítulo 1', 'Coordinador de Innovación y Soporte Tecnológico (CIST)']);
      assert.strictEqual(nueva.fecha, await ev(page, 'today()'));
      // repetir la misma
      await page.click('#lcNueva'); await modalAbierto(page);
      await page.selectOption('#lcAula', eleg.aula); await page.fill('#lcQ', eleg.titulo.slice(0, 8));
      const o2 = await page.locator('#lcTit option').evaluateAll(os => os.map(o => o.textContent)); await page.selectOption('#lcTit', { index: o2.findIndex(t => t.startsWith(eleg.titulo)) });
      await page.click('#bmS'); await esperar(300);
      assert.strictEqual(await ev(page, 'bibLecturas().length'), eleg.n + 1, 'no se duplica');
      await cerrarModales(page);
    });
    await paso('Prestar: el botón deja el aula y el libro elegidos, el préstamo queda ligado a la lectura y el avance sube', async () => {
      await ir(page, 'bibLecturas'); await page.selectOption('#lcVer', 'activas');
      await page.click(`[data-lcpres="${nueva.id}"]`); await modalAbierto(page);
      assert.strictEqual(await page.inputValue('#baAula'), nueva.aula);
      assert.strictEqual(await page.inputValue('#baTit'), nueva.titulo);
      assert.strictEqual(await page.inputValue('#baDias'), '10', 'los días llegan hasta la fecha límite');
      await page.waitForSelector('[data-baidx]'); const nAsig = await page.locator('[data-baidx]').count();
      await page.click('#bmS'); await modalCerrado(page);
      await page.waitForFunction(id => bibPrest().some(p => p.lecturaId === id), nueva.id);
      const p = await ev(page, `bibPrest().find(p=>p.lecturaId==='${nueva.id}')`);
      assert.strictEqual(p.vence, nueva.limite, 'vence en la fecha límite de la lectura');
      assert.ok(p.lote, 'sigue siendo un préstamo por aula (se devuelve por lote)');
      const av = await ev(page, `bibLecturasCalcTodas().find(x=>x.l.id==='${nueva.id}').av`);
      assert.strictEqual(av.recibieron, nAsig, 'recibieron = los alumnos a los que se les prestó'); assert.ok(nAsig >= 1); assert.strictEqual(av.devolvieron, 0); assert.strictEqual(av.atrasados, 0);
    });
    await paso('Quitar una lectura no borra los préstamos', async () => {
      const antes = await ev(page, 'bibPrest().length');
      await ir(page, 'bibLecturas'); await page.click(`[data-lcdel="${nueva.id}"]`);
      await page.waitForFunction(id => !bibLecturas().some(l => l.id === id), nueva.id);
      assert.strictEqual(await ev(page, 'bibPrest().length'), antes);
    });

    console.log('\nComprensión AD / A / B / C');
    await paso('Detalle de la lectura: elegir niveles de los que ya devolvieron, guardarlos, verlos de nuevo y quitarlos', async () => {
      await ir(page, 'bibLecturas');
      const lc = await ev(page, 'bibLecturasCalcTodas().find(x=>x.av.devolvieron>0 && !x.av.completa).l');
      await page.click(`[data-lcver="${lc.id}"]`); await modalAbierto(page);
      const n = await page.locator('[data-ldniv]').count();
      assert.strictEqual(n, await ev(page, `bibLecturasCalcTodas().find(x=>x.l.id==='${lc.id}').av.devolvieron`), 'un selector por cada alumno que ya devolvió');
      const antes = await ev(page, 'bibCompr().length');
      const sel = page.locator('[data-ldniv]').first(), prestId = await sel.getAttribute('data-ldniv'), previo = await sel.getAttribute('data-ldini');
      await sel.selectOption('B'); await page.click('#bmS'); await modalCerrado(page);
      await page.waitForFunction(id => bibCompr().some(c => c.prestId === id && c.nivel === 'B'), prestId);
      const reg = await ev(page, `bibCompr().find(c=>c.prestId==='${prestId}')`);
      assert.strictEqual(reg.lecturaId, lc.id); assert.ok(reg.docente); assert.strictEqual(reg.fecha, await ev(page, 'today()'));
      assert.strictEqual(await ev(page, 'bibCompr().length'), previo ? antes : antes + 1, 'no duplica cuando ya tenía nivel');
      await page.click(`[data-lcver="${lc.id}"]`); await modalAbierto(page);
      assert.strictEqual(await page.locator(`[data-ldniv="${prestId}"]`).inputValue(), 'B');
      await page.locator(`[data-ldniv="${prestId}"]`).selectOption(''); await page.click('#bmS'); await modalCerrado(page);
      await page.waitForFunction(id => !bibCompr().some(c => c.prestId === id), prestId);
    });
    await paso('Comprensión: resumen por aula/grado/nivel, % A+AD y alta rápida desde "sin evaluar" (con la tecla D = AD y Omitir)', async () => {
      await ir(page, 'bibCompr');
      const r = await ev(page, 'SigieBib.resumenComprension(bibCompr(), { desde:bibInicioAnio(), cuanto:"seccion" })');
      assert.ok(r.filas.length > 0 && !r.filas.some(f => /DOCENTES/.test(f.grupo)), 'sin docentes');
      const t = await texto(page); assert.ok(t.includes(r.filas[0].grupo) && t.includes(r.totales.logro + '%') && t.includes('Informe de comprensión lectora'));
      await page.selectOption('#cpCuanto', 'nivel');
      const filasNivel = await page.locator('table').first().locator('tbody tr td:first-child').allTextContents();
      assert.ok(filasNivel.some(x => /^PRIMARIA/.test(x.trim())) && !filasNivel.some(x => x.includes('3° A')), filasNivel.join('|'));
      await page.selectOption('#cpCuanto', 'grado'); await page.selectOption('#cpCuanto', 'seccion');
      const antes = await ev(page, 'bibCompr().length');
      await page.locator('[data-cpnew]').first().click(); await modalAbierto(page);
      assert.ok((await titulosModales(page))[0].includes('Comprensión del libro'));
      await page.click('#bmS'); await esperar(200); assert.strictEqual(await ev(page, 'bibCompr().length'), antes, 'sin elegir nivel no guarda'); assert.ok(await page.locator('.modal-bg').count());
      await page.keyboard.press('d'); await page.fill('#cpObs', 'Muy buena inferencia'); await page.click('#bmS'); await modalCerrado(page);
      await page.waitForFunction(n => bibCompr().length === n + 1, antes);
      const ult = await ev(page, 'bibCompr().slice(-1)[0]'); assert.deepStrictEqual([ult.nivel, ult.obs], ['AD', 'Muy buena inferencia']);
      await page.locator('[data-cpnew]').first().click(); await modalAbierto(page); await page.click('#bmC'); await modalCerrado(page);
      assert.strictEqual(await ev(page, 'bibCompr().length'), antes + 1, 'Omitir no guarda');
      const quedan = await page.locator('[data-cpnew]').count();
      assert.ok(quedan >= 1, 'la lista sigue ofreciendo los pendientes');
      await page.click(`[data-cpdel="${ult.id}"]`); await page.waitForFunction(n => bibCompr().length === n, antes);
    });
    await paso('Excel/CSV de comprensión se genera sin internet (queda el CSV de respaldo)', async () => {
      await ir(page, 'bibCompr');
      const [d] = await Promise.all([page.waitForEvent('download'), page.click('#cpXls')]);
      assert.ok(/^comprension-lectora-\d{4}-\d{2}-\d{2}\.csv$/.test(d.suggestedFilename()), d.suggestedFilename());
      const f = await d.path(); const csv = fs.readFileSync(f, 'utf8'); assert.ok(csv.includes('AD') && csv.includes('Informe de comprensión lectora'));
    });

    console.log('\nAl devolver: comprensión y reseña');
    const activos = () => page.evaluate(() => bibPrest().filter(p => !p.devuelto && !bibVencido(p)).map(p => ({ id: p.id, esAlumno: SigieBib.parsearGrado(p.grado).esAlumno })));
    await paso('Con la opción apagada (por defecto) devolver pide solo la reseña', async () => {
      assert.ok(!(await ev(page, 'bibCfg().pedirComprension')));
      const p = (await activos()).find(x => x.esAlumno);
      await ir(page, 'bibPrest'); await page.click(`[data-bibdev="${p.id}"]`);
      await page.waitForSelector('[data-rsest="3"]'); assert.deepStrictEqual(await titulosModales(page), ['¿Qué te pareció el libro?']);
      await page.click('#bmC'); await modalCerrado(page);
    });
    await paso('Con la opción activada: primero la comprensión y después la reseña; docentes no son evaluados', async () => {
      await page.evaluate(() => DB.save(B2.cfg, { ...bibCfg(), pedirComprension: true }));
      const [a1, a2] = (await activos()).filter(x => x.esAlumno), doc = (await activos()).find(x => !x.esAlumno);
      // 1) omitir la comprensión → aparece la reseña
      await ir(page, 'bibPrest'); await page.click(`[data-bibdev="${a1.id}"]`);
      await page.waitForSelector('[data-cpniv="A"]'); assert.deepStrictEqual(await titulosModales(page), ['Comprensión del libro']);
      const antes = await ev(page, 'bibCompr().length');
      await page.click('#bmC'); await page.waitForSelector('[data-rsest="3"]'); assert.deepStrictEqual(await titulosModales(page), ['¿Qué te pareció el libro?']);
      assert.strictEqual(await ev(page, 'bibCompr().length'), antes); await page.click('#bmC'); await modalCerrado(page);
      // 2) guardar nivel con las teclas → luego la reseña
      await ir(page, 'bibPrest'); await page.click(`[data-bibdev="${a2.id}"]`);
      await page.waitForSelector('[data-cpniv="A"]'); await page.keyboard.press('b'); await page.click('#bmS');
      await page.waitForSelector('[data-rsest="3"]'); await page.waitForFunction(id => bibCompr().some(c => c.prestId === id && c.nivel === 'B'), a2.id);
      await page.click('[data-rsest="5"]'); await page.click('#bmS'); await modalCerrado(page);
      await page.waitForFunction(id => bibResenas().some(r => r.prestId === id && r.estrellas === 5), a2.id);
      // 3) un docente: solo la reseña
      await ir(page, 'bibPrest'); await page.click(`[data-bibdev="${doc.id}"]`);
      await page.waitForSelector('[data-rsest="3"]'); assert.deepStrictEqual(await titulosModales(page), ['¿Qué te pareció el libro?']);
      await page.click('#bmC'); await modalCerrado(page);
      await page.evaluate(() => DB.save(B2.cfg, { ...bibCfg(), pedirComprension: false }));
    });
    await paso('Mostrador: el flujo de escáner también encadena comprensión y reseña y devuelve el cursor al escáner', async () => {
      await page.evaluate(() => DB.save(B2.cfg, { ...bibCfg(), pedirComprension: true }));
      const p = await page.evaluate(() => { const x = bibPrest().find(p => !p.devuelto && !bibVencido(p) && SigieBib.parsearGrado(p.grado).esAlumno); return { cod: bibLibros().find(l => l.id === x.libroId).cod, lec: bibLect().find(l => l.id === x.lectorId).cod, id: x.id }; });
      await ir(page, 'bibMost');
      await page.fill('#bmIn', p.lec); await page.press('#bmIn', 'Enter'); await page.waitForFunction(() => document.getElementById('bmIn') && /Lector:/.test(document.getElementById('content').textContent));
      await page.fill('#bmIn', p.cod); await page.press('#bmIn', 'Enter');
      await page.waitForSelector('[data-cpniv="A"]'); await page.click('#bmC'); await page.waitForSelector('[data-rsest="3"]'); await page.click('#bmC'); await modalCerrado(page);
      assert.strictEqual(await page.evaluate(() => document.activeElement && document.activeElement.id), 'bmIn');
      await page.evaluate(() => DB.save(B2.cfg, { ...bibCfg(), pedirComprension: false }));
    });

    console.log('\nSanción proporcional al atraso');
    await paso('Apagada por defecto: devolver tarde no sanciona ni muestra el menú', async () => {
      const v = await page.evaluate(() => bibPrest().find(p => !p.devuelto && bibVencido(p) && SigieBib.parsearGrado(p.grado).esAlumno));
      await ir(page, 'bibPrest'); await page.click(`[data-bibdev="${v.id}"]`); await page.waitForSelector('[data-rsest="3"]'); await page.click('#bmC'); await modalCerrado(page);
      assert.strictEqual(await ev(page, 'bibSanciones().length'), 0);
      assert.ok(!(await page.evaluate(() => document.querySelector('#nav, nav, .sidebar').textContent)).includes('Sanciones por atraso'));
    });
    let suspendido;
    await paso('Activada en Reglas: al devolver con atraso se calcula la suspensión y se bloquea un nuevo préstamo', async () => {
      await ir(page, 'bibCompr'); await page.click('#bibReglas'); await modalAbierto(page);
      assert.strictEqual(await page.isChecked('#rg_san'), false); assert.strictEqual(await page.inputValue('#rg_sanm'), '30');
      await page.check('#rg_san'); await page.fill('#rg_sanf', '2'); await page.fill('#rg_sanm', '12'); await page.click('#bmS'); await modalCerrado(page);
      await page.waitForFunction(() => bibCfg().sancion && bibCfg().sancion.activa);
      assert.deepStrictEqual(await ev(page, 'bibCfg().sancion'), { activa: true, factor: 2, maxDias: 12 });
      const v = await page.evaluate(() => { const x = bibPrest().find(p => !p.devuelto && bibVencido(p) && SigieBib.parsearGrado(p.grado).esAlumno && bibPrest().filter(q => !q.devuelto && bibVencido(q) && q.lectorId === p.lectorId).length === 1);
        return { id: x.id, lectorId: x.lectorId, nombre: x.lector, atraso: SigieBib.diasEntre(x.vence, today()) }; });
      await ir(page, 'bibPrest'); await page.click(`[data-bibdev="${v.id}"]`); await page.waitForSelector('[data-rsest="3"]'); await page.click('#bmC'); await modalCerrado(page);
      await page.waitForFunction(id => bibSanciones().some(s => s.prestId === id), v.id);
      const s = await ev(page, `bibSanciones().find(s=>s.prestId==='${v.id}')`);
      const dias = Math.min(12, v.atraso * 2);
      assert.deepStrictEqual([s.atraso, s.dias, s.levantada], [v.atraso, dias, false]);
      assert.strictEqual(s.hasta, await ev(page, `SigieBib.sumarDias(today(), ${dias})`));
      suspendido = { ...v, sancion: s };
      const msg = await page.evaluate(id => bibPuede(bibLect().find(l => l.id === id), bibLect().find(l => l.id === id).nombre), v.lectorId);
      assert.ok(/suspendido hasta el/.test(msg) && msg.includes(v.nombre), msg);
      const lib = await page.evaluate(() => { const l = bibLibros().find(l => bibPrestados(l.id) === 0); return l.id; });
      const err = await page.evaluate(async ([lid, uid]) => bibPrestar(bibLibros().find(l => l.id === lid), bibLect().find(l => l.id === uid), bibLect().find(l => l.id === uid).nombre, ''), [lib, v.lectorId]);
      assert.ok(/suspendido/.test(err), 'el préstamo se rechaza: ' + err);
      assert.ok((await page.evaluate(() => document.querySelector('#nav, nav, .sidebar').textContent)).includes('Sanciones por atraso'));
    });
    await paso('La vista de sanciones lista al suspendido y "Levantar" lo habilita de nuevo; el aula no lo incluye mientras dure', async () => {
      await ir(page, 'bibSanc'); const t = await texto(page);
      assert.ok(t.includes('Suspendidos hoy (1)') && t.includes(suspendido.nombre) && t.includes('Activada'));
      const bloq = await page.evaluate(id => { const l = bibLect().find(x => x.id === id); const r = SigieBib.asignarAula([l], [{ libro: bibLibros()[0], libres: 1 }], { lector: x => bibPuede(x, x.nombre) }); return r.bloqueados.length; }, suspendido.lectorId);
      assert.strictEqual(bloq, 1, 'el préstamo por aula lo deja como bloqueado');
      await page.click(`[data-sanlev="${suspendido.sancion.id}"]`);
      await page.waitForFunction(id => bibSanciones().find(s => s.id === id).levantada, suspendido.sancion.id);
      assert.strictEqual(await page.evaluate(id => bibPuede(bibLect().find(l => l.id === id), 'x'), suspendido.lectorId), '', 'levantada: puede volver a llevar libros');
      await page.waitForFunction(() => /Suspendidos hoy \(0\)/.test(document.getElementById('content').textContent) && /Levantada/.test(document.getElementById('content').textContent));
    });
    await paso('Volver a apagar la política: las sanciones ya registradas dejan de bloquear', async () => {
      const s2 = await page.evaluate(async () => { const x = bibLect().find(l => bibEsAlumno(l)); await DB.save(B6.san, [...bibSanciones(), { id: 'sn_x', prestId: 'zz', lectorId: x.id, lector: x.nombre, atraso: 3, dias: 3, desde: today(), hasta: bibEnDias(5), levantada: false }]);
        const antes = bibPuede(x, x.nombre); await DB.save(B2.cfg, { ...bibCfg(), sancion: { ...bibCfg().sancion, activa: false } }); return { antes, despues: bibPuede(x, x.nombre) }; });
      assert.ok(/suspendido/.test(s2.antes) && s2.despues === '', JSON.stringify(s2));
    });

    console.log('\nMeta mensual (Retos de lectura)');
    await paso('Retos: aplicar "1 libro por alumno" a todas las aulas, ajustar una y ver leídos/avance', async () => {
      await ir(page, 'bibRetos'); assert.ok((await texto(page)).includes('Meta mensual por aula'));
      await page.fill('#mtPorAlumno', '0.5'); await page.click('#mtAplicar');
      await page.waitForFunction(() => { const al = bibLect().filter(x => !x.baja && bibEsAlumno(x)), n = new Map(); al.forEach(x => { const k = SigieBib.claveGrado(x.grado, 'seccion'); n.set(k, (n.get(k) || 0) + 1); });
        return [...n].every(([k, c]) => { const m = bibMetas().find(m => m.aula === k); return Math.round(c * 0.5) === 0 ? !m : m && m.libros === Math.round(c * 0.5); }); });
      const r = await ev(page, 'SigieBib.metaMensual({prestamos:bibPrest(),alumnos:bibLect().filter(x=>!x.baja&&bibEsAlumno(x)),metas:bibMetas(),mes:today().slice(0,7)})');
      const con = r.filas.filter(f => f.alumnos > 0);
      assert.ok(con.every(f => f.meta === Math.round(f.alumnos * 0.5)) === true || con.every(f => f.meta === Math.round(f.alumnos * 0.5) || f.meta === 0));
      const f0 = con.find(f => f.meta > 0), campo = page.locator(`[data-mtaula="${f0.aula}"]`);
      await page.waitForFunction(([a, m]) => { const i = document.querySelector(`[data-mtaula="${a}"]`); return i && i.value === String(m); }, [f0.aula, f0.meta]);
      assert.strictEqual(await campo.inputValue(), String(f0.meta));
      await campo.fill('7'); await campo.dispatchEvent('change');
      await page.waitForFunction(a => (bibMetas().find(m => m.aula === a) || {}).libros === 7, f0.aula);
      await page.locator(`[data-mtaula="${f0.aula}"]`).fill(''); await page.locator(`[data-mtaula="${f0.aula}"]`).dispatchEvent('change');
      await page.waitForFunction(a => !bibMetas().some(m => m.aula === a), f0.aula);
      await page.fill('#mtMes', '2020-01'); await page.locator('#mtMes').dispatchEvent('change');
      await page.waitForFunction(() => document.getElementById('mtMes').value === '2020-01');
      const t = await texto(page); assert.ok(t.includes('Meta mensual por aula'));
    });
    await paso('Un aula que alcanza su meta se marca como cumplida', async () => {
      const r = await page.evaluate(async () => {
        const mes = today().slice(0, 7), a = bibLect().find(l => !l.baja && bibEsAlumno(l)), aula = SigieBib.claveGrado(a.grado, 'seccion');
        await DB.save(BKEYS.prest, [...bibPrest(), { id: 'bp_meta', libroId: bibLibros()[0].id, lectorId: a.id, lector: a.nombre, grado: a.grado, fecha: today(), vence: bibEnDias(7), devuelto: today() }]);
        await DB.save(B6.met, [{ id: 'mt_' + aula, aula, libros: 1 }]); bibMt.mes = mes; return aula; });
      await ir(page, 'bibRetos'); assert.ok((await texto(page)).includes('Cumplida'), 'se ve ✅ Cumplida');
      const w = await page.evaluate(a => { const f = SigieBib.metaMensual({ prestamos: bibPrest(), alumnos: bibLect().filter(x => !x.baja && bibEsAlumno(x)), metas: bibMetas(), mes: today().slice(0, 7) }).filas.find(f => f.aula === a); return [f.cumplida, f.pct >= 100]; }, r);
      assert.deepStrictEqual(w, [true, true]);
    });

    console.log('\nRespaldo, ejemplo y avisos');
    await paso('El respaldo incluye las 4 claves nuevas y restaurar las devuelve', async () => {
      const keys = await ev(page, 'bibKeysTodas()'); for (const k of ['sigie:bib_lecturas', 'sigie:bib_comprension', 'sigie:bib_sanciones', 'sigie:bib_metas']) assert.ok(keys.includes(k), k);
      const r = await page.evaluate(async () => { const o = { datos: {} }; bibKeysTodas().forEach(k => o.datos[k] = DB.get(k)); const n = bibCompr().length; await DB.save(B6.cmp, [], { reemplazar: true });
        for (const k of bibKeysTodas()) if (o.datos[k] !== undefined && o.datos[k] !== null) await DB.save(k, o.datos[k], { reemplazar: true }); return [n, bibCompr().length]; });
      assert.strictEqual(r[0], r[1]);
    });
    await paso('Inicio avisa de las lecturas atrasadas y el botón lleva a la pantalla', async () => {
      await page.evaluate(async () => { const l = bibLecturas()[0]; await DB.save(B6.lec, bibLecturas().map(x => x.id === l.id ? { ...x, limite: bibEnDias(-30), fecha: bibEnDias(-40) } : x)); });
      await ir(page, 'bibInicio'); assert.ok(/alumno\(s\) con una lectura asignada atrasada/.test(await texto(page)));
      await page.click('[data-bigo="bibLecturas"]'); await page.waitForFunction(() => STATE.view === 'bibLecturas');
    });
    await paso('Se recarga todo desde el servidor: lo guardado persiste (4 claves nuevas)', async () => {
      const antes = await page.evaluate(() => [bibLecturas().length, bibCompr().length, bibMetas().length, bibSanciones().length]);
      await esperar(500); await page.reload(); await page.waitForFunction(() => STATE.loaded && document.getElementById('content').innerHTML.length > 200);
      assert.deepStrictEqual(await page.evaluate(() => [bibLecturas().length, bibCompr().length, bibMetas().length, bibSanciones().length]), antes);
    });
    erroresTotales.push(...A.errores);

    console.log('\nPermisos por rol');
    const D = await abrir(browser, 'docente', { inicial: 'Docente2026', nueva: 'ClaveSegura#2026' });
    await paso('DOCENTE: puede asignar lecturas, evaluar comprensión y fijar metas', async () => {
      await ir(D.page, 'bibLecturas'); assert.ok(await D.page.locator('#lcNueva').count());
      await ir(D.page, 'bibCompr'); const n = await ev(D.page, 'bibCompr().length'), btn = D.page.locator('[data-cpnew]').first(); assert.ok(await btn.count());
      await btn.click(); await modalAbierto(D.page); await D.page.keyboard.press('a'); await D.page.click('#bmS'); await modalCerrado(D.page);
      await D.page.waitForFunction(n => bibCompr().length === n + 1, n);
      assert.ok((await ev(D.page, 'bibCompr().slice(-1)[0].docente')).length > 0, 'queda quién la registró');
      await ir(D.page, 'bibRetos'); assert.ok(await D.page.locator('#mtAplicar').count());
    });
    erroresTotales.push(...D.errores);
    const C = await abrir(browser, 'consulta', { inicial: 'Consulta2026', nueva: 'ClaveSegura#2026' });
    await paso('CONSULTA (director/UGEL): ve todo pero no registra nada, ni en pantalla ni en el servidor', async () => {
      await ir(C.page, 'bibLecturas'); assert.strictEqual(await C.page.locator('#lcNueva, [data-lcpres], [data-lcdel]').count(), 0); assert.ok(await C.page.locator('[data-lcver]').count());
      await C.page.locator('[data-lcver]').first().click(); await modalAbierto(C.page);
      assert.strictEqual(await C.page.locator('[data-ldniv]').count(), 0, 'sin selectores de nivel'); assert.ok(await C.page.locator('#bmS').textContent() === 'Cerrar'); await C.page.click('#bmS'); await modalCerrado(C.page);
      await ir(C.page, 'bibCompr'); assert.strictEqual(await C.page.locator('[data-cpnew], [data-cpdel]').count(), 0); assert.ok((await texto(C.page)).includes('Informe de comprensión lectora'));
      await C.page.evaluate(() => { const p = bibPrest().find(p => p.devuelto && SigieBib.parsearGrado(p.grado).esAlumno && !bibCompr().some(c => c.prestId === p.id)); bibComprPedir(p.id, null, true); });
      await esperar(300); assert.strictEqual(await C.page.locator('.modal-bg').count(), 0, 'ni abre la ventana de evaluar');
      await ir(C.page, 'bibRetos'); assert.strictEqual(await C.page.locator('#mtAplicar, [data-mtaula]').count(), 0);
      const antes = await ev(C.page, 'bibCompr().length');
      const r = await C.page.evaluate(async () => { try { await DB.save(B6.cmp, [...bibCompr(), { id: 'cp_hack', prestId: 'x', nivel: 'AD', grado: '3° A PRIMARIA', lector: 'X', fecha: today() }]); return 'guardó'; } catch (e) { return 'rechazado'; } });
      await esperar(400); await C.page.reload(); await C.page.waitForFunction(n => STATE.loaded && bibCompr().length > 0, antes);
      assert.ok(!(await ev(C.page, 'bibCompr().some(c=>c.id==="cp_hack")')), 'el servidor no guardó la escritura de CONSULTA (' + r + ')');
      assert.strictEqual(await ev(C.page, 'bibCompr().length'), antes);
    });
    erroresTotales.push(...C.errores);
  } finally { await browser.close(); srv.parar(); }

  const { ok: n, fallos: f } = module.exports.resumen;
  console.log(`\nErrores de consola/página: ${erroresTotales.length}`); erroresTotales.slice(0, 8).forEach(e => console.log('  !', e.slice(0, 300)));
  console.log(`\n${n} pasos bien, ${f.length} con fallo${erroresTotales.length ? ', ' + erroresTotales.length + ' errores del navegador' : ''}`);
  f.forEach(x => console.log(' ✖', x));
  process.exit(f.length || erroresTotales.length ? 1 : 0);
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
