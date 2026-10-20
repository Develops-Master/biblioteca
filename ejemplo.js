/* =========================================================================
   SIGIE — Generador de DATOS DE EJEMPLO (todo simulado)
   -------------------------------------------------------------------------
   Rellena TODOS los módulos del sistema con información ficticia pero
   coherente entre sí, para demostraciones, capacitaciones o pruebas:
     · Biblioteca: libros, categorías (cotejo), lectores con carné,
       préstamos (devueltos, vigentes y vencidos), inventario por estante.
     · Patrimonio: aulas, personal, bienes con código SBN oficial, kardex,
       préstamos de bienes, mantenimientos / incidencias / calibraciones,
       pólizas, requerimientos y órdenes de compra, bajas (todas las etapas),
       almacén de consumibles, presupuesto por fuente, comisión de
       inventario, conciliación contable, plano del colegio, tomas de
       inventario, comparativo interanual, actas verificables, papelera.
     · Gestión: usuarios de ejemplo, bitácora de auditoría, datos de la IE.

   Cómo funciona: se construye TODO en memoria (construirDatosEjemplo) con
   un generador pseudoaleatorio de semilla fija —cada clic produce el mismo
   conjunto de datos— y recién después se guarda en la base de datos con
   los mismos DB.save que usa el resto del sistema.

   Seguridad: reemplaza los datos actuales de los módulos, por eso pide
   confirmación y ofrece descargar un respaldo (.json) antes. NO toca:
   la cuenta "admin", el catálogo SBN, los cargos, la vida útil de
   depreciación ni el logo de la institución.

   Carga: se incluye en index.html después de biblioteca.js; la función
   pública es generarDatosEjemplo() (botón en Reportes y en Libros).
   ========================================================================= */
(function(){
  'use strict';

  const SEMILLA = 20260613;
  const CLAVE_USUARIOS_EJEMPLO = 'Ejemplo2026';
  let enCurso = false;

  /* ---------------------------------------------------------------------
     Utilidades puras (sin tocar la base de datos ni el DOM)
     --------------------------------------------------------------------- */
  function mulberry32(a){
    return function(){
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const pad = (n, w) => String(n).padStart(w, '0');
  const r2 = n => Math.round(n * 100) / 100;
  const addD = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const addM = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
  const minISO = (a, b) => (a < b ? a : b);

  /* ---------------------------------------------------------------------
     Bancos de datos ficticios
     --------------------------------------------------------------------- */
  const NOM_H = ['Carlos','Luis','José','Jorge','Miguel','Pedro','Juan','Víctor','Raúl','Hugo','César','Daniel','Fernando','Alberto','Ricardo','Manuel','Edwin','Walter','Óscar','Marco','Percy','Elmer','Julio','Wilfredo'];
  const NOM_M = ['Rosa','María','Ana','Carmen','Lucía','Patricia','Elena','Sofía','Gladys','Marleni','Karla','Julia','Silvia','Doris','Milagros','Yolanda','Teresa','Nancy','Flor','Diana','Noemí','Betty','Liz','Rocío'];
  const APE = ['Quispe','Huamán','Flores','Rojas','Mamani','Condori','Chávez','Torres','Vargas','Castillo','Ramos','Gutiérrez','Díaz','Sánchez','Paredes','Salazar','Vega','Mendoza','Ríos','Cárdenas','Ccori','Anccasi','Soto','Campos','Palomino','Ortiz','Valdivia','Zevallos','Aguilar','Núñez','Cáceres','Ayala','Medina','Poma','Cusi','Yupanqui','Lazo','Bustamante','Espinoza','Huanca','Callo','Apaza','Ticona','Layme'];
  const MARCAS_PC = [['LENOVO','IdeaPad 3 15IAU7'],['HP','250 G9'],['DELL','Inspiron 15 3520'],['ACER','Aspire 5 A515'],['ASUS','VivoBook X515'],['HUAWEI','MateBook D15']];
  const MARCAS_CPU = [['HP','ProDesk 400 G7'],['LENOVO','ThinkCentre M70s'],['DELL','OptiPlex 3080'],['ADVANCE','AD-5100'],['HALION','HL-3300']];
  const MARCAS_MONITOR = [['LG','22MK430H'],['SAMSUNG','S22R350'],['AOC','22B1H'],['HP','P22v G4'],['VIEWSONIC','VA2215']];
  const MARCAS_IMPR = [['HP','LaserJet Pro M404dn'],['BROTHER','HL-L2370DW'],['EPSON','EcoTank L3250'],['CANON','Pixma G3110']];
  const MARCAS_PROY = [['EPSON','PowerLite X49'],['BENQ','MX550'],['VIEWSONIC','PA503S'],['OPTOMA','S336']];
  const MARCAS_TV = [['LG','43UQ8000'],['SAMSUNG','UN43AU7000'],['HISENSE','43A6H'],['AOC','43S5295']];

  /* Banco de bienes. sbn = código oficial del Catálogo Nacional (SBN) y den =
     denominación EXACTA del catálogo, para que "Verificación SBN" no marque
     discrepancias. p = rango de precio (S/), serie = lleva N° de serie. */
  const BANCO = {
    CARPETA:   { den:'CARPETA DE MADERA UNIPERSONAL', sbn:'74642423', p:[85,140], col:['MARRÓN','CELESTE','BEIGE'] },
    SILLAM:    { den:'SILLA FIJA DE MADERA', sbn:'74648119', p:[45,80], col:['MARRÓN','BEIGE'] },
    SILLAME:   { den:'SILLA FIJA DE METAL', sbn:'74648187', p:[60,110], col:['NEGRO','GRIS'] },
    SILLAG:    { den:'SILLA GIRATORIA DE METAL', sbn:'74648390', p:[180,320], col:['NEGRO','GRIS'] },
    ESCR:      { den:'ESCRITORIO DE MELAMINA', sbn:'74643745', p:[220,380], col:['CAOBA','HAYA','GRIS'] },
    ESCRD:     { den:'ESCRITORIO DE METAL Y MELAMINA', sbn:'74643881', p:[450,820], col:['CAOBA','GRIS'] },
    MESA:      { den:'MESA DE MELAMINA', sbn:'74645056', p:[160,320], col:['HAYA','BLANCO','CELESTE'] },
    MESAM:     { den:'MESA DE METAL', sbn:'74645068', p:[320,640], col:['GRIS','NEGRO'] },
    PIZ:       { den:'PIZARRA ACRILICA', sbn:'74647305', p:[150,320], col:['BLANCO'] },
    ARM:       { den:'ARMARIO DE MELAMINA', sbn:'74640626', p:[350,650], col:['CAOBA','HAYA','GRIS'] },
    ESTM:      { den:'ESTANTE DE MELAMINA', sbn:'74644152', p:[280,520], col:['CAOBA','HAYA'] },
    ESTME:     { den:'ESTANTE DE METAL', sbn:'74644186', p:[260,480], col:['GRIS','NEGRO'] },
    LIBM:      { den:'LIBRERO DE MELAMINA', sbn:'74644542', p:[300,560], col:['CAOBA','HAYA'] },
    LIBMAD:    { den:'LIBRERO DE MADERA', sbn:'74644525', p:[380,700], col:['MARRÓN'] },
    ARCH:      { den:'ARCHIVADOR DE METAL', sbn:'74640389', p:[380,720], col:['GRIS','BEIGE'] },
    LOCK:      { den:'CASILLERO DE METAL - LOCKER', sbn:'74642898', p:[420,900], col:['GRIS','AZUL'] },
    PERCH:     { den:'PERCHERO METALICO', sbn:'74647238', p:[60,120], col:['NEGRO','GRIS'] },
    ECRAN:     { den:'PANTALLA ECRAN', sbn:'74646695', p:[180,350], col:['BLANCO'] },
    BANCA:     { den:'BANCA METALICA', sbn:'74641203', p:[180,360], col:['GRIS','AZUL'] },
    CAJA:      { den:'CAJA FUERTE', sbn:'74641881', p:[600,1500], col:['NEGRO'], marcas:[['DIGITAL','CF-30']], serie:true },
    EXT:       { den:'EXTINTOR', sbn:'88222525', p:[90,180], col:['ROJO'], marcas:[['SEGURITEC','PQS 6 kg'],['FIRESTOP','PQS 4 kg'],['PROTEXA','CO2 5 kg']], serie:true },
    BOT:       { den:'BOTIQUIN DE METAL', sbn:'53641192', p:[120,260], col:['BLANCO'] },
    RELOJ:     { den:'RELOJ DE PARED', sbn:'74229147', p:[40,120], col:['NEGRO','BLANCO'] },
    VENT:      { den:'VENTILADOR ELECTRICO PARA PARED', sbn:'11228366', p:[120,300], col:['BLANCO','NEGRO'], marcas:[['RECCO','VP-16'],['INDUSTRIAL','VT-20']], serie:true },
    TELF:      { den:'TELEFONO', sbn:'95228287', p:[60,200], col:['NEGRO','BLANCO'], marcas:[['PANASONIC','KX-TS500'],['GRANDSTREAM','GXP1610']], serie:true },
    HERV:      { den:'HERVIDOR ELECTRICO', sbn:'32225000', p:[70,150], col:['PLATEADO'], marcas:[['OSTER','BVSTKS'],['RECCO','HE-17']], serie:true },
    CAFE:      { den:'CAFETERA ELECTRICA', sbn:'32220757', p:[90,220], col:['NEGRO'], marcas:[['OSTER','BVSTDC'],['BLACK+DECKER','DCM600']], serie:true },
    PC:        { den:'COMPUTADORA PERSONAL PORTATIL', sbn:'74080500', p:[1900,3600], col:['GRIS','NEGRO','PLATEADO'], marcas:MARCAS_PC, serie:true, elec:true },
    CPU:       { den:'UNIDAD CENTRAL DE PROCESO - CPU', sbn:'74089950', p:[1400,2600], col:['NEGRO'], marcas:MARCAS_CPU, serie:true, elec:true },
    MON:       { den:'MONITOR LED', sbn:'74088037', p:[450,900], col:['NEGRO'], marcas:MARCAS_MONITOR, serie:true, elec:true },
    TECL:      { den:'TECLADO - KEYBOARD', sbn:'74089500', p:[40,90], col:['NEGRO'], marcas:[['GENIUS','KB-110'],['LOGITECH','K120'],['HP','C2500']], serie:true, elec:true },
    MOUSE:     { den:'MOUSE INALAMBRICO', sbn:'74088224', p:[25,60], col:['NEGRO'], marcas:[['LOGITECH','M170'],['GENIUS','NX-7000'],['HP','S1000']], serie:true, elec:true },
    IMPL:      { den:'IMPRESORA LASER', sbn:'74084100', p:[700,1500], col:['NEGRO','BLANCO'], marcas:MARCAS_IMPR.slice(0,2), serie:true, elec:true },
    IMPT:      { den:'IMPRESORA A INYECCION DE TINTA', sbn:'74083650', p:[400,900], col:['NEGRO'], marcas:MARCAS_IMPR.slice(2), serie:true, elec:true },
    TAB:       { den:'TABLETA PAD', sbn:'74089493', p:[600,1500], col:['NEGRO','GRIS'], marcas:[['SAMSUNG','Galaxy Tab A8'],['LENOVO','Tab M10'],['HUAWEI','MatePad T10']], serie:true, elec:true },
    DISCO:     { den:'DISCO DURO EXTERNO', sbn:'74081850', p:[250,400], col:['NEGRO'], marcas:[['SEAGATE','Expansion 2TB'],['WESTERN DIGITAL','Elements 2TB']], serie:true, elec:true },
    SWITCH:    { den:'SWITCH PARA RED', sbn:'95228117', p:[300,900], col:['NEGRO'], marcas:[['TP-LINK','TL-SG1024D'],['D-LINK','DGS-1024D']], serie:true, elec:true },
    AP:        { den:'PUNTO DE ACCESO INALAMBRICO - ACCESS POINT WIRELESS', sbn:'95226742', p:[250,700], col:['BLANCO'], marcas:[['TP-LINK','EAP225'],['UBIQUITI','UAP-AC-LITE']], serie:true, elec:true },
    ESTAB:     { den:'ESTABILIZADOR', sbn:'46225215', p:[90,250], col:['NEGRO'], marcas:[['FORZA','FVR-1202'],['SOLA BASIC','XR 1200']], serie:true, elec:true },
    FOTOC:     { den:'FOTOCOPIADORA EN GENERAL', sbn:'74222726', p:[3500,9000], col:['BLANCO'], marcas:[['KYOCERA','TASKalfa 2554ci'],['RICOH','MP 2555']], serie:true, elec:true },
    MULTI:     { den:'EQUIPO MULTIFUNCIONAL COPIADORA IMPRESORA SCANNER Y/O FAX', sbn:'74222358', p:[1800,4500], col:['BLANCO'], marcas:[['BROTHER','MFC-L5900DW'],['CANON','imageRUNNER 1643i']], serie:true, elec:true },
    PROY:      { den:'PROYECTOR', sbn:'95226644', p:[1800,3500], col:['BLANCO'], marcas:MARCAS_PROY, serie:true, elec:true },
    TV:        { den:'TELEVISOR LED', sbn:'95228586', p:[1500,4200], col:['NEGRO'], marcas:MARCAS_TV, serie:true, elec:true },
    PARL:      { den:'PARLANTE AMPLIFICADOR PORTATIL', sbn:'95226039', p:[450,1200], col:['NEGRO'], marcas:[['KLIPXTREME','KWS-650'],['JBL','PartyBox 110'],['MIDIPLUS','MP-10']], serie:true, elec:true },
    MIC:       { den:'MICROFONO INALAMBRICO', sbn:'95225529', p:[200,600], col:['NEGRO'], marcas:[['SHURE','BLX24'],['BEHRINGER','ULM300'],['SENNHEISER','XSW 1']], serie:true, elec:true },
    SONIDO:    { den:'EQUIPO DE SONIDO', sbn:'95223375', p:[1200,3000], col:['NEGRO'], marcas:[['YAMAHA','MG10XU'],['BEHRINGER','X1204USB']], serie:true, elec:true },
    AMPL:      { den:'AMPLIFICADOR DE AUDIO', sbn:'95220163', p:[600,1500], col:['NEGRO'], marcas:[['YAMAHA','A-S301'],['BEHRINGER','A800']], serie:true, elec:true },
    CAM:       { den:'CAMARA FOTOGRAFICA DIGITAL', sbn:'74220897', p:[900,2200], col:['NEGRO'], marcas:[['CANON','EOS Rebel T7'],['NIKON','D3500'],['SONY','ZV-E10']], serie:true, elec:true },
    RADIO:     { den:'RADIOGRABADORA', sbn:'95227003', p:[250,500], col:['NEGRO','GRIS'], marcas:[['SONY','ZS-PS50'],['PHILIPS','AZ215'],['RECCO','RG-26']], serie:true, elec:true },
    MEGAF:     { den:'MEGAFONO', sbn:'95225340', p:[150,350], col:['BLANCO'], marcas:[['PYLE','PMP-50'],['RECCO','MG-25']], serie:true, elec:true },
    MICRO:     { den:'MICROSCOPIO COMPUESTO', sbn:'53227869', p:[1100,2600], col:['NEGRO','BLANCO'], marcas:[['OLYMPUS','CX23'],['MOTIC','BA210'],['NATIONAL','131']], serie:true },
    BALP:      { den:'BALANZA DE PRECISION', sbn:'60220686', p:[600,1800], col:['PLATEADO'], marcas:[['OHAUS','PX224'],['ADAM','PGW 253e']], serie:true },
    BALA:      { den:'BALANZA ANALITICA', sbn:'60220634', p:[1800,4000], col:['PLATEADO'], marcas:[['OHAUS','Pioneer PX523'],['METTLER','ME204']], serie:true },
    ESQ:       { den:'MODELO ANATOMICO DEL ESQUELETO HUMANO', sbn:'53648141', p:[700,1500], col:['BEIGE'], marcas:[['ERLER ZIMMER','A10']] },
    TELESC:    { den:'TELESCOPIO REFRACTOR', sbn:'67229800', p:[500,1400], col:['BLANCO','NEGRO'], marcas:[['CELESTRON','AstroMaster 70'],['BRESSER','Lyra 70/900']], serie:true },
    ESTUFA:    { den:'ESTUFA ELECTRICA PARA LABORATORIO', sbn:'67225727', p:[1500,3500], col:['PLATEADO'], marcas:[['MEMMERT','UN30'],['BINDER','ED 23']], serie:true },
    CALC:      { den:'CALCULADORA CIENTIFICA', sbn:'74220050', p:[80,180], col:['NEGRO'], marcas:[['CASIO','fx-570LA X'],['CASIO','fx-991LA X']], serie:true },
    GUIT:      { den:'GUITARRA ACUSTICA', sbn:'39223964', p:[250,700], col:['NATURAL'], marcas:[['YAMAHA','F310'],['FENDER','CD-60'],['EPIPHONE','DR-100']], serie:true },
    CHAR:      { den:'CHARANGO', sbn:'39221662', p:[150,420], col:['NATURAL'] },
    QUENA:     { den:'QUENA', sbn:'39227071', p:[40,90], col:['MARRÓN'] },
    BOMBO:     { den:'BOMBO', sbn:'39220971', p:[250,500], col:['MARRÓN'] },
    FLAUTA:    { den:'FLAUTA DULCE', sbn:'39223746', p:[25,60], col:['BEIGE','NEGRO'], marcas:[['YAMAHA','YRS-24B'],['HOHNER','9508']] },
    PIANO:     { den:'PIANO DIGITAL', sbn:'39226755', p:[1500,3500], col:['NEGRO'], marcas:[['YAMAHA','P-45'],['CASIO','CDP-S160']], serie:true },
    BATERIA:   { den:'BATERIA MUSICAL', sbn:'39220741', p:[1800,3500], col:['NEGRO'], marcas:[['PEARL','Roadshow'],['TAMA','Imperialstar']], serie:true }
  };

  /* Kits (qué bienes lleva cada tipo de ambiente): [clave, cantidad, probabilidad] */
  const KITS = {
    inicial: [['ESCR',1],['SILLAM',6],['MESA',3],['ESTM',2],['PIZ',1],['ARM',1],['RADIO',1],['EXT',1,.8],['RELOJ',1,.6],['PERCH',1,.7]],
    aula: [['ESCR',1],['SILLAM',2],['CARPETA',5],['PIZ',1],['ARM',1],['ESTM',1,.5],['PERCH',1,.5],['RELOJ',1,.6],['EXT',1,.8],['PROY',1,.4],['ECRAN',1,.4],['TV',1,.15],['PARL',1,.12],['CALC',2,.2]],
    direccion: [['ESCRD',1],['SILLAG',2],['ARCH',2],['PC',1],['IMPL',1],['TELF',1],['LIBM',1],['EXT',1],['RELOJ',1],['ARM',1]],
    secretaria: [['ESCRD',1],['SILLAG',2],['ARCH',3],['PC',1],['IMPL',1],['FOTOC',1],['MULTI',1],['CAJA',1],['TELF',1],['EXT',1],['ESTAB',1]],
    sala: [['MESA',2],['SILLAM',8],['ARM',2],['LOCK',2],['PC',2],['IMPT',1],['HERV',1],['CAFE',1],['RELOJ',1],['TELF',1],['VENT',1],['EXT',1]],
    biblioteca: [['ESTME',6],['LIBMAD',2],['MESA',3],['SILLAM',8],['ESCR',1],['PC',1],['IMPT',1],['RELOJ',1],['EXT',1],['VENT',1]],
    lab: [['MESAM',4],['SILLAME',8],['MICRO',5],['BALP',2],['BALA',1],['ESQ',1],['TELESC',1],['ESTUFA',1],['ARM',2],['EXT',1],['BOT',1],['PROY',1],['PIZ',1]],
    innov: [['CPU',6],['MON',6],['TECL',6],['MOUSE',6],['PC',4],['TAB',4],['PROY',1],['SWITCH',1],['AP',2],['ESTAB',3],['ESCR',1],['MESA',3],['SILLAG',6],['IMPT',1],['EXT',1],['TV',1],['DISCO',1]],
    aud: [['SONIDO',1],['MIC',2],['PARL',2],['PROY',1],['ECRAN',1],['AMPL',1],['GUIT',2],['PIANO',1],['BATERIA',1],['BOMBO',1],['QUENA',4],['FLAUTA',6],['CHAR',1],['CAM',1],['MEGAF',1],['BANCA',4],['EXT',2]],
    almacen: [['ESTME',3],['ARM',2],['CARPETA',3],['SILLAM',4],['PIZ',2],['ESCR',1],['EXT',1]]
  };

  /* Libros de ejemplo por prefijo de categoría: 'TÍTULO|AUTOR|DEWEY' */
  const MEDU = 'MINISTERIO DE EDUCACIÓN';
  const TITULOS = {
    DIC:['DICCIONARIO ESCOLAR DE LA LENGUA ESPAÑOLA|VARIOS AUTORES|463','DICCIONARIO DE SINÓNIMOS Y ANTÓNIMOS|VARIOS AUTORES|463','DICCIONARIO ILUSTRADO INGLÉS-ESPAÑOL|VARIOS AUTORES|423','DICCIONARIO QUECHUA-CASTELLANO|VARIOS AUTORES|498.3','DICCIONARIO DE MATEMÁTICAS|VARIOS AUTORES|510.3'],
    ENC:['ENCICLOPEDIA ESCOLAR ILUSTRADA|VARIOS AUTORES|030','ENCICLOPEDIA DEL ESTUDIANTE|VARIOS AUTORES|030','ENCICLOPEDIA DE LA CIENCIA|VARIOS AUTORES|503','ENCICLOPEDIA DEL PERÚ|VARIOS AUTORES|985','ENCICLOPEDIA DE LOS ANIMALES|VARIOS AUTORES|590','ENCICLOPEDIA DEL CUERPO HUMANO|VARIOS AUTORES|611'],
    PSI:['INTRODUCCIÓN A LA PSICOLOGÍA|VARIOS AUTORES|150','EL MUNDO DE SOFÍA|JOSTEIN GAARDER|100','LA ADOLESCENCIA Y SUS CAMBIOS|VARIOS AUTORES|155.5','FILOSOFÍA PARA JÓVENES|VARIOS AUTORES|100'],
    REL:['BIBLIA ESCOLAR|VARIOS AUTORES|220','CATECISMO PARA NIÑOS|VARIOS AUTORES|238','HISTORIAS DE LA BIBLIA|VARIOS AUTORES|220.9','EDUCACIÓN RELIGIOSA 3° SECUNDARIA|VARIOS AUTORES|268'],
    ECO:['ECONOMÍA BÁSICA|VARIOS AUTORES|330','INTRODUCCIÓN A LA ECONOMÍA PERUANA|VARIOS AUTORES|330.985','FINANZAS PERSONALES PARA JÓVENES|VARIOS AUTORES|332.024'],
    NEG:['EMPRENDIMIENTO ESCOLAR|VARIOS AUTORES|658.4','MI PRIMER NEGOCIO|VARIOS AUTORES|658.11','GESTIÓN DE MICROEMPRESAS|VARIOS AUTORES|658'],
    EDU:['EDUCACIÓN CÍVICA|VARIOS AUTORES|372.83','EDUCACIÓN AMBIENTAL|VARIOS AUTORES|372.357','CONVIVENCIA ESCOLAR|VARIOS AUTORES|371.58','EDUCACIÓN SEXUAL INTEGRAL|VARIOS AUTORES|372.372'],
    ING:['ENGLISH 1 STUDENT BOOK|VARIOS AUTORES|428','ENGLISH 2 STUDENT BOOK|VARIOS AUTORES|428','ENGLISH 3 STUDENT BOOK|VARIOS AUTORES|428','ENGLISH GRAMMAR IN USE|VARIOS AUTORES|425','PICTURE DICTIONARY FOR KIDS|VARIOS AUTORES|423'],
    LEN:['APRENDAMOS QUECHUA|VARIOS AUTORES|498.3','GRAMÁTICA DEL AIMARA|VARIOS AUTORES|498.3','FRANCÉS BÁSICO|VARIOS AUTORES|448'],
    LEY:['CONSTITUCIÓN POLÍTICA DEL PERÚ|CONGRESO DE LA REPÚBLICA|342.85','CÓDIGO DE LOS NIÑOS Y ADOLESCENTES|VARIOS AUTORES|346.85','LEY GENERAL DE EDUCACIÓN|'+MEDU+'|344.04'],
    REV:['REVISTA CIENCIA Y NATURALEZA|VARIOS AUTORES|505','REVISTA PERÚ HISTÓRICO|VARIOS AUTORES|985','REVISTA ESCOLAR EDUCARTE|VARIOS AUTORES|370.5'],
    MAT:['MATEMÁTICA 1 SECUNDARIA|'+MEDU+'|510','MATEMÁTICA 2 SECUNDARIA|'+MEDU+'|510','MATEMÁTICA 3 SECUNDARIA|'+MEDU+'|510','ÁLGEBRA ELEMENTAL|VARIOS AUTORES|512','GEOMETRÍA PLANA|VARIOS AUTORES|516','ARITMÉTICA ESCOLAR|VARIOS AUTORES|513'],
    QUI:['QUÍMICA GENERAL|VARIOS AUTORES|540','QUÍMICA ORGÁNICA BÁSICA|VARIOS AUTORES|547','LA TABLA PERIÓDICA|VARIOS AUTORES|546'],
    BIO:['BIOLOGÍA CELULAR|VARIOS AUTORES|571.6','GENÉTICA PARA PRINCIPIANTES|VARIOS AUTORES|576.5'],
    FIS:['FÍSICA ELEMENTAL|VARIOS AUTORES|530','MECÁNICA CLÁSICA ESCOLAR|VARIOS AUTORES|531','ÓPTICA Y ONDAS|VARIOS AUTORES|535'],
    CIE:['CIENCIA Y AMBIENTE 5° PRIMARIA|'+MEDU+'|500','EL CUERPO HUMANO|VARIOS AUTORES|612','ECOSISTEMAS DEL PERÚ|VARIOS AUTORES|577','ATLAS DE ANATOMÍA ESCOLAR|VARIOS AUTORES|611','EXPERIMENTOS CIENTÍFICOS FÁCILES|VARIOS AUTORES|507.8'],
    ART:['HISTORIA DEL ARTE PARA JÓVENES|VARIOS AUTORES|709','ARTE PERUANO PRECOLOMBINO|VARIOS AUTORES|709.85','TÉCNICAS DE DIBUJO Y PINTURA|VARIOS AUTORES|741'],
    LEA:['GRAMÁTICA DE LA LENGUA ESPAÑOLA|VARIOS AUTORES|465','ORTOGRAFÍA PRÁCTICA|VARIOS AUTORES|461','COMUNICACIÓN INTEGRAL 6° PRIMARIA|'+MEDU+'|468','REDACCIÓN Y ESTILO|VARIOS AUTORES|808'],
    OBR:['EL PRINCIPITO|ANTOINE DE SAINT-EXUPÉRY|843','DON QUIJOTE DE LA MANCHA (EDICIÓN ESCOLAR)|MIGUEL DE CERVANTES|863','CIEN AÑOS DE SOLEDAD|GABRIEL GARCÍA MÁRQUEZ|863','LA CIUDAD Y LOS PERROS|MARIO VARGAS LLOSA|863','LOS RÍOS PROFUNDOS|JOSÉ MARÍA ARGUEDAS|863','EL MUNDO ES ANCHO Y AJENO|CIRO ALEGRÍA|863','AVES SIN NIDO|CLORINDA MATTO DE TURNER|863','TRADICIONES PERUANAS (SELECCIÓN)|RICARDO PALMA|863','VEINTE MIL LEGUAS DE VIAJE SUBMARINO|JULIO VERNE|843','LA ISLA DEL TESORO|ROBERT LOUIS STEVENSON|823','EL CABALLERO CARMELO|ABRAHAM VALDELOMAR|863','LA METAMORFOSIS|FRANZ KAFKA|833'],
    TER:['DRÁCULA (EDICIÓN JUVENIL)|BRAM STOKER|823','FRANKENSTEIN|MARY SHELLEY|823','CUENTOS DE TERROR|EDGAR ALLAN POE|813'],
    HIS:['HISTORIETAS DEL PERÚ ANTIGUO|VARIOS AUTORES|741.5','MANGA: CÓMO DIBUJARLO|VARIOS AUTORES|741.5','CÓMICS CIENTÍFICOS|VARIOS AUTORES|741.5','AVENTURAS ILUSTRADAS (SELECCIÓN)|VARIOS AUTORES|741.5'],
    BIS:['VIDA DE MIGUEL GRAU|VARIOS AUTORES|923.5','VIDA DE FRANCISCO BOLOGNESI|VARIOS AUTORES|923.5','ALBERT EINSTEIN, SU VIDA|VARIOS AUTORES|925','MARIE CURIE, UNA CIENTÍFICA|VARIOS AUTORES|925','HÉROES DEL PERÚ|VARIOS AUTORES|923.5'],
    ATL:['ATLAS GEOGRÁFICO DEL PERÚ|VARIOS AUTORES|912','ATLAS UNIVERSAL ESCOLAR|VARIOS AUTORES|912','ATLAS DE HISTORIA DEL PERÚ|VARIOS AUTORES|911'],
    HIL:['HISTORIA UNIVERSAL ILUSTRADA|VARIOS AUTORES|909','LA EDAD MEDIA|VARIOS AUTORES|940.1','LAS CIVILIZACIONES ANTIGUAS|VARIOS AUTORES|930'],
    HIU:['HISTORIA DEL PERÚ 3° SECUNDARIA|'+MEDU+'|985','EL IMPERIO DE LOS INCAS|VARIOS AUTORES|985.01','LA INDEPENDENCIA DEL PERÚ|VARIOS AUTORES|985.05','LA GUERRA CON CHILE|VARIOS AUTORES|985.06','LA REPÚBLICA ARISTOCRÁTICA|VARIOS AUTORES|985.06'],
    GEO:['GEOGRAFÍA DEL PERÚ|VARIOS AUTORES|918.5','REGIONES NATURALES DEL PERÚ|VARIOS AUTORES|918.5'],
    CIS:['CIENCIAS SOCIALES 2° SECUNDARIA|'+MEDU+'|300','FORMACIÓN CIUDADANA|VARIOS AUTORES|323.6','HISTORIA, GEOGRAFÍA Y ECONOMÍA 1|'+MEDU+'|300'],
    EDN:['DIDÁCTICA DE LA LECTURA|VARIOS AUTORES|372.4','ESTRATEGIAS DE APRENDIZAJE|VARIOS AUTORES|371.3','CURRÍCULO NACIONAL DE LA EDUCACIÓN BÁSICA|'+MEDU+'|375'],
    TUT:['TUTORÍA Y ORIENTACIÓN EDUCATIVA 1°|'+MEDU+'|371.4','TUTORÍA Y ORIENTACIÓN EDUCATIVA 2°|'+MEDU+'|371.4','TUTORÍA Y ORIENTACIÓN EDUCATIVA 3°|'+MEDU+'|371.4','HABILIDADES SOCIOEMOCIONALES|VARIOS AUTORES|152.4','PREVENCIÓN DE LA VIOLENCIA ESCOLAR|VARIOS AUTORES|371.58'],
    EDA:['EDUCACIÓN FÍSICA ESCOLAR|VARIOS AUTORES|796','JUEGOS Y DEPORTES|VARIOS AUTORES|796.07','VOLEIBOL: FUNDAMENTOS|VARIOS AUTORES|796.325'],
    COM:['COMUNICACIÓN 1 SECUNDARIA|'+MEDU+'|468','COMUNICACIÓN 2 SECUNDARIA|'+MEDU+'|468','COMUNICACIÓN 3 SECUNDARIA|'+MEDU+'|468','COMPRENSIÓN LECTORA 4° PRIMARIA|VARIOS AUTORES|372.4'],
    PED:['PEDAGOGÍA CONTEMPORÁNEA|VARIOS AUTORES|370.1','EVALUACIÓN FORMATIVA|VARIOS AUTORES|371.27','LA ENSEÑANZA POR COMPETENCIAS|VARIOS AUTORES|371.3'],
    PER:['PERSONA, FAMILIA Y RELACIONES HUMANAS 1°|'+MEDU+'|155','PERSONA, FAMILIA Y RELACIONES HUMANAS 2°|'+MEDU+'|155','AUTOESTIMA EN LA ADOLESCENCIA|VARIOS AUTORES|155.5'],
    MAS:['PROBLEMAS DE RAZONAMIENTO MATEMÁTICO|VARIOS AUTORES|510','TRIGONOMETRÍA ESCOLAR|VARIOS AUTORES|516.24','ESTADÍSTICA BÁSICA|VARIOS AUTORES|519.5'],
    CYT:['CIENCIA Y TECNOLOGÍA 1° SECUNDARIA|'+MEDU+'|500','CIENCIA Y TECNOLOGÍA 2° SECUNDARIA|'+MEDU+'|500','CIENCIA Y TECNOLOGÍA 3° SECUNDARIA|'+MEDU+'|500','CIENCIA Y TECNOLOGÍA 4° SECUNDARIA|'+MEDU+'|500'],
    PEA:['PSICOPEDAGOGÍA INFANTIL|VARIOS AUTORES|370.15','ATENCIÓN A LA DIVERSIDAD|VARIOS AUTORES|371.9'],
    EDO:['EDUCACIÓN PARA EL TRABAJO: COMPUTACIÓN|'+MEDU+'|004','EDUCACIÓN PARA EL TRABAJO: CARPINTERÍA|VARIOS AUTORES|684','EDUCACIÓN PARA EL TRABAJO: COCINA|VARIOS AUTORES|641.5','OFIMÁTICA PARA ESTUDIANTES|VARIOS AUTORES|005.5'],
    ARE:['ARTE Y CULTURA 1° SECUNDARIA|'+MEDU+'|700','ARTE Y CULTURA 2° SECUNDARIA|'+MEDU+'|700','MÚSICA ESCOLAR|VARIOS AUTORES|780','DANZAS DEL PERÚ|VARIOS AUTORES|793.3'],
    POE:['TRILCE|CÉSAR VALLEJO|861','LOS HERALDOS NEGROS|CÉSAR VALLEJO|861','VEINTE POEMAS DE AMOR Y UNA CANCIÓN DESESPERADA|PABLO NERUDA|861','RIMAS Y LEYENDAS|GUSTAVO ADOLFO BÉCQUER|861','ANTOLOGÍA POÉTICA PERUANA|VARIOS AUTORES|861'],
    CUE:['MITOS, LEYENDAS Y CUENTOS PERUANOS|JOSÉ MARÍA ARGUEDAS|398.2','CUENTOS DE LA SELVA|HORACIO QUIROGA|863','CUENTOS ANDINOS|VARIOS AUTORES|398.2','LEYENDAS PERUANAS|VARIOS AUTORES|398.2','CUENTOS COMPLETOS (SELECCIÓN)|JULIO RAMÓN RIBEYRO|863']
  };
  const EDITORIALES = ['EDICIONES ANDINAS','EDITORIAL HORIZONTE','EDICIONES DEL SUR','EDITORIAL PACHACÚTEC','FONDO EDITORIAL ESCOLAR','EDICIONES LUMBRE','EDITORIAL AMAUTA ESCOLAR'];
  const OBS_LIBRO_MALO = ['Hojas sueltas','Tapa deteriorada','Lomo despegado','Páginas manchadas','Falta carátula'];
  const OBS_LIBRO_OK = ['Donación de promoción','Ejemplar de la UGEL','Donado por APAFA','Reposición','Dotación del MINEDU'];

  /* =====================================================================
     CONSTRUCCIÓN DE TODOS LOS DATOS (en memoria)
     ctx = { hoy, anio, bibCats, categoriasDeprec, lookupCategoria, usuariosPrevios,
             totalesSIGIE(items), snapshotItems(items) }
     ===================================================================== */
  function construirDatosEjemplo(ctx){
    const R = mulberry32(SEMILLA);
    const int = (a, b) => a + Math.floor(R() * (b - a + 1));
    const pick = a => a[Math.floor(R() * a.length)];
    const chance = p => R() < p;
    const shuffle = a => { a = a.slice(); for(let i = a.length - 1; i > 0; i--){ const j = Math.floor(R() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
    const wpick = (vals, ws) => { const tot = ws.reduce((x, y) => x + y, 0); let r = R() * tot; for(let i = 0; i < vals.length; i++){ r -= ws[i]; if(r <= 0) return vals[i]; } return vals[vals.length - 1]; };
    const hoy = ctx.hoy, anio = ctx.anio;
    const uid = ctx.uid;

    /* ---------- Bitácora: se va llenando a medida que se generan los datos ---------- */
    const bit = [];
    const tsSeguro = iso => {
      let t = Date.parse(iso + 'T' + pad(int(13, 22), 2) + ':' + pad(int(0, 59), 2) + ':' + pad(int(0, 59), 2) + '.000Z');
      if(t > Date.now()) t = Date.now() - int(1, 300) * 60000;
      return new Date(t).toISOString();
    };
    const ROLES_USR = { admin:'ADMIN', biblioteca:'ADMIN2', secretaria:'ADMIN2', docente:'DOCENTE', 'prof.quispe':'DOCENTE', 'prof.vargas':'DOCENTE', director:'CONSULTA', consulta:'CONSULTA' };
    const log = (fecha, usuario, accion, detalle) => bit.push({ id:uid('log'), fecha:tsSeguro(fecha), usuario, rol:ROLES_USR[usuario] || 'ADMIN', accion, detalle:detalle || '' });

    /* ---------- Datos de la IE ---------- */
    const cfg = {
      nombreIE:'I.E. N° 20456 "Rosa de América"', codigoModular:'0123456', codigoLocal:'345678',
      ugel:'UGEL 03 - Lima Metropolitana', dre:'DRE Lima Metropolitana',
      director:'Mg. Carlos Alberto Quispe Mendoza', responsablePatrimonio:'Lic. Rosa María Huamán Torres',
      anioFiscal:anio, siglas:'RA', entidadCodigoSIGA:'01', nivelIE:'INICIAL - PRIMARIA - SECUNDARIA',
      personalInventariador:'Prof. Luis Alberto Vargas Ríos', emailNotificaciones:'patrimonio@ie20456.example.edu.pe',
      fechaUltimoResumenSemanal:''
    };

    /* ---------- Personal / custodios ---------- */
    const dnisUsados = new Set(), nombresUsados = new Set();
    const dniUnico = () => { let d; do { d = String(pick([4, 4, 7, 7, 7, 4, 9])) + pad(int(0, 9999999), 7); } while(dnisUsados.has(d)); dnisUsados.add(d); return d; };
    const persona = (cargo, genero) => {
      let nombre;
      do { nombre = pick(genero === 'M' ? NOM_M : NOM_H) + ' ' + pick(APE) + ' ' + pick(APE); } while(nombresUsados.has(nombre));
      nombresUsados.add(nombre);
      return { id:uid('cust'), nombre, cargo, dni:dniUnico(), aulaId:'', aulaNombre:'', genero };
    };
    const persDirector = persona('Director(a)', 'H'); persDirector.nombre = 'Carlos Alberto Quispe Mendoza';
    const persSub = persona('Subdirector(a)', 'M');
    const persCoord = persona('Coordinador(a) Académico', 'H');
    const persSecre = persona('Secretaría', 'M');
    const persAdm = persona('Personal Administrativo', 'H');
    const persBib = persona('Bibliotecario(a)', 'M');
    const docIni = [persona('Docente de Inicial', 'M'), persona('Docente de Inicial', 'M'), persona('Docente de Inicial', 'M')];
    const docPri = [0, 1, 2, 3, 4, 5].map(i => persona('Docente de Primaria', i % 3 === 0 ? 'H' : 'M'));
    const docSec = [0, 1, 2, 3, 4, 5].map(i => persona('Docente de Secundaria', i % 2 === 0 ? 'H' : 'M'));
    const auxs = [persona('Auxiliar de Educación', 'H'), persona('Auxiliar de Educación', 'M')];
    const servs = [persona('Personal de Servicio', 'H'), persona('Personal de Servicio', 'H')];
    const personal = [persDirector, persSub, persCoord, persSecre, persAdm, persBib, ...docIni, ...docPri, ...docSec, ...auxs, ...servs];

    /* ---------- Aulas y ambientes ---------- */
    const AULAS_DEF = [
      ['Inicial','3 años','A','inicial',docIni[0]], ['Inicial','4 años','A','inicial',docIni[1]], ['Inicial','5 años','A','inicial',docIni[2]],
      ['Primaria','1°','A','aula',docPri[0]], ['Primaria','2°','A','aula',docPri[1]], ['Primaria','3°','A','aula',docPri[2]],
      ['Primaria','4°','A','aula',docPri[3]], ['Primaria','5°','A','aula',docPri[4]], ['Primaria','6°','A','aula',docPri[5]],
      ['Secundaria','1°','A','aula',docSec[0]], ['Secundaria','2°','A','aula',docSec[1]], ['Secundaria','3°','A','aula',docSec[2]],
      ['Secundaria','4°','A','aula',docSec[3]], ['Secundaria','5°','A','aula',docSec[4]],
      ['Administrativo','Dirección','','direccion',persDirector], ['Administrativo','Secretaría','','secretaria',persSecre],
      ['Administrativo','Sala de profesores','','sala',persSub],
      ['Áreas comunes','Biblioteca','','biblioteca',persBib], ['Áreas comunes','Laboratorio de Ciencias','','lab',docSec[5]],
      ['Áreas comunes','Aula de Innovación','','innov',persCoord], ['Áreas comunes','Auditorio','','aud',auxs[0]],
      ['Áreas comunes','Almacén general','','almacen',persAdm]
    ];
    const aulas = AULAS_DEF.map((d, i) => {
      const nombre = [d[1], d[2]].filter(Boolean).join(' ');
      const a = { id:uid('aula'), codigo:'AUL-' + pad(i + 1, 3), nivel:d[0], grado:d[1], seccion:d[2], nombre, aulaLabel:d[0] + ' · ' + nombre, responsable:d[4].nombre };
      d[4].aulaId = a.id; d[4].aulaNombre = a.aulaLabel; a._kit = d[3]; a._resp = d[4];
      return a;
    });
    const aulaPorNombre = n => aulas.find(a => a.nombre === n || a.aulaLabel === n);
    const aulaPri4 = aulas.find(a => a.aulaLabel === 'Primaria · 4° A');
    const aulaPri3 = aulas.find(a => a.aulaLabel === 'Primaria · 3° A');
    const aulaLab = aulaPorNombre('Laboratorio de Ciencias'), aulaInnov = aulaPorNombre('Aula de Innovación');
    const aulaDir = aulaPorNombre('Dirección'), aulaSecre = aulaPorNombre('Secretaría'), aulaAud = aulaPorNombre('Auditorio');
    const aulaBib = aulaPorNombre('Biblioteca'), aulaAlm = aulaPorNombre('Almacén general'), aulaSala = aulaPorNombre('Sala de profesores');

    /* ---------- Bienes: generación ---------- */
    const FORMAS = ['Compra','Donación','Transferencia','APAFA','Otro'];
    const DONANTES = ['Asociación de Padres de Familia (APAFA)','Empresa Minera Andes del Sur S.A.','Promoción 2019','Municipalidad Distrital','Fundación Educar Perú'];
    const OBS_ITEM = ['Pequeños rayones por uso normal.','Requiere limpieza periódica.','Con etiqueta de inventario adherida.','Bien en uso diario.','Se recomienda revisar en el próximo mantenimiento.','Uso exclusivo del docente.'];
    const catsDep = ctx.categoriasDeprec;
    const items = [];
    const fechaAleatoria = () => {
      const off = wpick([0, 1, 2, 3, 4, 5, 6, 7], [18, 20, 18, 14, 12, 9, 6, 3]);
      const y = anio - off;
      const ini = off === 7 ? y + '-03-01' : y + '-01-15';
      const fin = off === 0 ? addD(hoy, -12) : y + '-12-10';
      const dIni = Date.parse(ini + 'T12:00:00Z'), dFin = Date.parse(fin + 'T12:00:00Z');
      return new Date(dIni + Math.floor(R() * Math.max(1, dFin - dIni))).toISOString().slice(0, 10);
    };
    const edadAnios = f => (Date.parse(hoy + 'T12:00:00Z') - Date.parse(f + 'T12:00:00Z')) / (365.25 * 864e5);
    function nuevoItem(key, aula, extra){
      extra = extra || {};
      const b = BANCO[key];
      const fecha = extra.fechaRegistro || fechaAleatoria();
      const edad = edadAnios(fecha);
      const estado = extra.estadoConservacion || (edad < 2 ? wpick(['Muy Bueno','Bueno','Regular','Malo'], [50, 40, 10, 0]) : edad < 4 ? wpick(['Muy Bueno','Bueno','Regular','Malo'], [20, 50, 25, 5]) : wpick(['Muy Bueno','Bueno','Regular','Malo'], [5, 30, 45, 20]));
      const forma = extra.formaAdquisicion || wpick(FORMAS, [56, 12, 12, 15, 5]);
      const mm = b.marcas ? pick(b.marcas) : ['', ''];
      const valor = extra.valorAdquisicion != null ? extra.valorAdquisicion : r2(int(b.p[0] * 100, b.p[1] * 100) / 100);
      const resp = aula._resp;
      let garantia = '';
      if(b.elec && edad < 3 && chance(.75)) garantia = addM(fecha, pick([12, 24, 36]));
      const it = {
        id:uid('item'), codigoInterno:'', codigoAnioAnterior: chance(.4) ? 'PAT-' + pad(int(1, 9999), 4) : '',
        codigoUsoInterno:'', denominacion:b.den, codigoSBN:b.sbn,
        marca:mm[0], modelo:mm[1], numeroSerie: b.serie ? 'SN' + Math.floor(R() * 36 ** 8).toString(36).toUpperCase().padStart(8, '0') : '',
        color:pick(b.col || ['']), estadoConservacion:estado,
        aulaId:aula.id, aulaNombre:aula.aulaLabel, valorAdquisicion:valor, formaAdquisicion:forma,
        donante: forma === 'Donación' ? pick(DONANTES) : '', documentoDonacion: forma === 'Donación' ? 'RD N° ' + pad(int(1, 180), 3) + '-' + (new Date(fecha + 'T12:00:00Z').getUTCFullYear()) + '-IE' : '',
        categoriaDeprecId:ctx.lookupCategoria(b.den, catsDep),
        custodioId:resp.id, custodioNombre:resp.nombre, situacion:'Activo', fotoId:'', fotosIds:[], fotosHistorial:[],
        observaciones: extra.observaciones != null ? extra.observaciones : (chance(.12) ? pick(OBS_ITEM) : ''),
        fechaRegistro:fecha, anio:new Date(fecha + 'T12:00:00Z').getUTCFullYear(), garantiaHasta:garantia,
        registradoPor: extra.registradoPor || pick(['admin', 'admin', 'biblioteca', 'secretaria'])
      };
      if(extra.situacion) it.situacion = extra.situacion;
      if(extra.pendienteSaneamiento){ it.pendienteSaneamiento = true; it.motivoSaneamiento = extra.motivoSaneamiento; }
      items.push(it);
      return it;
    }
    aulas.forEach(a => {
      (KITS[a._kit] || []).forEach(k => {
        const prob = k[2] == null ? 1 : k[2];
        if(!chance(prob)) return;
        for(let i = 0; i < k[1]; i++) nuevoItem(k[0], a);
      });
    });

    /* ---------- Requerimientos / órdenes de compra (algunos generan bienes) ---------- */
    const FUENTES = ['Recursos Ordinarios (RO)','Recursos Directamente Recaudados (RDR)','APAFA','Donaciones','Otro'];
    const lin = (den, cant, precio, rec) => ({ id:uid('lin'), denominacion:den, cantidad:cant, precioUnitario:precio, cantidadRecibida:rec || 0 });
    const reqs = [];
    const nroReq = n => 'REQ-' + anio + '-' + pad(n, 4);
    const nroOC = n => 'OC-' + anio + '-' + pad(n, 4);
    const nombreDirector = persDirector.nombre;
    let seqOC = 0;
    // 1) Recibido total
    {
      const f = addD(hoy, -125), fAprob = addD(f, 2), fOC = addD(f, 6), fRec = addD(f, 21);
      const l1 = lin('SILLA FIJA DE MADERA', 6, 62, 6);
      reqs.push({ id:uid('req'), numero:nroReq(1), fecha:f, solicitante:docPri[2].nombre, aulaId:aulaPri3.id, aulaNombre:aulaPri3.aulaLabel,
        justificacion:'Reposición de sillas en mal estado del aula.', lineas:[l1], estado:'Recibido total', fuenteFinanciamiento:FUENTES[0],
        aprobadoPor:nombreDirector, fechaAprobacion:fAprob, motivoRechazo:'',
        ordenCompra:{ numero:nroOC(++seqOC), proveedor:'Comercial Muebles del Perú S.A.C.', ruc:'20512345671', fechaEmision:fOC, fechaEntregaEstimada:addD(fOC, 14) },
        historialRecepciones:[{ id:uid('rec'), fecha:fRec, recibidoPor:persAdm.nombre, lineas:[{ lineaId:l1.id, cantidad:6 }], observacion:'Conforme, sin observaciones.' }],
        creadoPor:'secretaria', fechaCreacion:f, _recibe:[{ key:'SILLAM', aula:aulaPri3, cant:6, precio:62, fecha:fRec, linea:l1 }] });
    }
    // 2) Recibido parcial
    {
      const f = addD(hoy, -62), fAprob = addD(f, 3), fOC = addD(f, 8), fRec = addD(f, 24);
      const l1 = lin('IMPRESORA LASER', 2, 980, 1), l2 = lin('TABLETA PAD', 10, 850, 4);
      reqs.push({ id:uid('req'), numero:nroReq(2), fecha:f, solicitante:persCoord.nombre, aulaId:aulaInnov.id, aulaNombre:aulaInnov.aulaLabel,
        justificacion:'Equipamiento del Aula de Innovación para talleres de robótica y ofimática.', lineas:[l1, l2], estado:'Recibido parcial', fuenteFinanciamiento:FUENTES[1],
        aprobadoPor:nombreDirector, fechaAprobacion:fAprob, motivoRechazo:'',
        ordenCompra:{ numero:nroOC(++seqOC), proveedor:'TecnoAndina Soluciones E.I.R.L.', ruc:'20601234568', fechaEmision:fOC, fechaEntregaEstimada:addD(fOC, 20) },
        historialRecepciones:[{ id:uid('rec'), fecha:fRec, recibidoPor:persAdm.nombre, lineas:[{ lineaId:l1.id, cantidad:1 }, { lineaId:l2.id, cantidad:4 }], observacion:'Entrega parcial; el saldo llega en 15 días.' }],
        creadoPor:'admin', fechaCreacion:f, _recibe:[{ key:'IMPL', aula:aulaInnov, cant:1, precio:980, fecha:fRec, linea:l1 }, { key:'TAB', aula:aulaInnov, cant:4, precio:850, fecha:fRec, linea:l2 }] });
    }
    // 3) En compra
    {
      const f = addD(hoy, -26), fOC = addD(f, 9);
      reqs.push({ id:uid('req'), numero:nroReq(3), fecha:f, solicitante:docSec[1].nombre, aulaId:aulas.find(a => a.aulaLabel === 'Secundaria · 2° A').id, aulaNombre:'Secundaria · 2° A',
        justificacion:'Proyectores para aulas de secundaria que no cuentan con equipo multimedia.', lineas:[lin('PROYECTOR', 3, 2650, 0)], estado:'En compra', fuenteFinanciamiento:FUENTES[2],
        aprobadoPor:nombreDirector, fechaAprobacion:addD(f, 3), motivoRechazo:'',
        ordenCompra:{ numero:nroOC(++seqOC), proveedor:'Importaciones Visión Digital S.A.', ruc:'20498765432', fechaEmision:fOC, fechaEntregaEstimada:addD(hoy, 10) },
        historialRecepciones:[], creadoPor:'admin', fechaCreacion:f });
    }
    // 4) Aprobado
    {
      const f = addD(hoy, -12);
      reqs.push({ id:uid('req'), numero:nroReq(4), fecha:f, solicitante:docPri[0].nombre, aulaId:aulas.find(a => a.aulaLabel === 'Primaria · 1° A').id, aulaNombre:'Primaria · 1° A',
        justificacion:'Pizarras acrílicas para aulas de primaria con pizarra deteriorada.', lineas:[lin('PIZARRA ACRILICA', 4, 240, 0)], estado:'Aprobado', fuenteFinanciamiento:FUENTES[0],
        aprobadoPor:nombreDirector, fechaAprobacion:addD(f, 2), motivoRechazo:'', ordenCompra:null, historialRecepciones:[], creadoPor:'admin', fechaCreacion:f });
    }
    // 5) Solicitado
    {
      const f = addD(hoy, -3);
      reqs.push({ id:uid('req'), numero:nroReq(5), fecha:f, solicitante:persBib.nombre, aulaId:aulaBib.id, aulaNombre:aulaBib.aulaLabel,
        justificacion:'Ampliación de estantes para la sección de obras literarias.', lineas:[lin('ESTANTE DE METAL', 3, 310, 0)], estado:'Solicitado', fuenteFinanciamiento:FUENTES[1],
        aprobadoPor:'', fechaAprobacion:'', motivoRechazo:'', ordenCompra:null, historialRecepciones:[], creadoPor:'biblioteca', fechaCreacion:f });
    }
    // 6) Rechazado
    {
      const f = addD(hoy, -48);
      reqs.push({ id:uid('req'), numero:nroReq(6), fecha:f, solicitante:docSec[3].nombre, aulaId:aulas.find(a => a.aulaLabel === 'Secundaria · 4° A').id, aulaNombre:'Secundaria · 4° A',
        justificacion:'Televisores para proyección en aulas.', lineas:[lin('TELEVISOR LED', 2, 3200, 0)], estado:'Rechazado', fuenteFinanciamiento:FUENTES[0],
        aprobadoPor:'', fechaAprobacion:'', motivoRechazo:'Sin disponibilidad presupuestal en la fuente solicitada.', ordenCompra:null, historialRecepciones:[], creadoPor:'admin', fechaCreacion:f });
    }
    // 7) Cancelado
    {
      const f = addD(hoy, -90);
      reqs.push({ id:uid('req'), numero:nroReq(7), fecha:f, solicitante:docIni[1].nombre, aulaId:aulas.find(a => a.aulaLabel === 'Inicial · 4 años A').id, aulaNombre:'Inicial · 4 años A',
        justificacion:'Mesas para el sector de construcción.', lineas:[lin('MESA DE MELAMINA', 4, 190, 0)], estado:'Cancelado', fuenteFinanciamiento:FUENTES[2],
        aprobadoPor:'', fechaAprobacion:'', motivoRechazo:'', ordenCompra:null, historialRecepciones:[], creadoPor:'admin', fechaCreacion:f });
    }
    const reqItems = []; // bienes dados de alta por recepción de compra
    reqs.forEach(r => (r._recibe || []).forEach(rc => {
      for(let i = 0; i < rc.cant; i++){
        const it = nuevoItem(rc.key, rc.aula, { fechaRegistro:rc.fecha, valorAdquisicion:rc.precio, estadoConservacion:'Muy Bueno', formaAdquisicion:'Compra', registradoPor:'admin',
          observaciones:'Ingresado por recepción de compra ' + r.numero + ' — OC ' + r.ordenCompra.numero + ' — ' + r.ordenCompra.proveedor + '.' });
        it.codigoAnioAnterior = ''; it.garantiaHasta = addM(rc.fecha, 12);
        it._reqNumero = r.numero; it._oc = r.ordenCompra.numero;
        reqItems.push(it);
      }
      delete r._recibe;
    }));

    /* ---------- Bienes hallados sin registro (por sanear) en tomas de inventario ---------- */
    const fechaToma1 = addD(hoy, -41), fechaToma2 = addD(hoy, -19);
    const sanear1 = nuevoItem('MESA', aulaPri4, { fechaRegistro:fechaToma1, valorAdquisicion:null, situacion:'Por sanear', pendienteSaneamiento:true, estadoConservacion:'Regular', formaAdquisicion:'Otro',
      motivoSaneamiento:'Hallado físicamente en el aula "' + aulaPri4.aulaLabel + '" durante la toma de inventario del ' + fechaToma1 + ', sin registro previo (sin documentación de compra).', observaciones:'', registradoPor:'docente' });
    sanear1.codigoAnioAnterior = ''; sanear1.valorAdquisicion = null;
    const sanear2 = nuevoItem('PROY', aulaLab, { fechaRegistro:fechaToma2, valorAdquisicion:null, situacion:'Por sanear', pendienteSaneamiento:true, estadoConservacion:'Bueno', formaAdquisicion:'Donación',
      motivoSaneamiento:'Hallado físicamente en el aula "' + aulaLab.aulaLabel + '" durante la toma de inventario del ' + fechaToma2 + ', sin registro previo (sin documentación de compra).', observaciones:'', registradoPor:'prof.vargas' });
    sanear2.codigoAnioAnterior = ''; sanear2.valorAdquisicion = null; sanear2.garantiaHasta = '';

    /* ---------- Códigos patrimoniales (SBN + correlativo) y código interno ---------- */
    const seqPorSBN = {}; let seqInterno = 0;
    [...items].sort((a, b) => a.fechaRegistro.localeCompare(b.fechaRegistro) || String(a.id).localeCompare(String(b.id))).forEach(it => {
      const k = it.codigoSBN || 'SINCODIGO';
      seqPorSBN[k] = (seqPorSBN[k] || 0) + 1;
      it.codigoInterno = String(k).replace(/\D/g, '').padStart(8, '0').slice(0, 8) + pad(seqPorSBN[k], 4);
      it.codigoUsoInterno = pad(++seqInterno, 6);
    });

    /* ---------- Reserva de bienes para cada módulo (sin solaparse) ---------- */
    const usados = new Set();
    const tomar = (pred, n) => {
      const c = shuffle(items.filter(i => !usados.has(i.id) && pred(i)));
      const r = c.slice(0, n == null ? 1 : n); r.forEach(i => usados.add(i.id)); return r;
    };
    const den = d => i => i.denominacion === d;
    const viejo = (anios) => i => edadAnios(i.fechaRegistro) >= anios;

    // Papelera (3 bienes enviados a la papelera)
    const papeleraItems = tomar(i => ['CARPETA DE MADERA UNIPERSONAL', 'SILLA FIJA DE MADERA', 'PIZARRA ACRILICA'].includes(i.denominacion) && viejo(3)(i), 3);
    // Bajas (una por cada etapa)
    const bajaPool = tomar(i => ['COMPUTADORA PERSONAL PORTATIL', 'MONITOR LED', 'IMPRESORA LASER', 'PROYECTOR', 'RADIOGRABADORA', 'UNIDAD CENTRAL DE PROCESO - CPU', 'ESTABILIZADOR'].includes(i.denominacion) && viejo(2.5)(i) && i.situacion === 'Activo', 5);
    // Mantenimientos
    const mExt = tomar(den('EXTINTOR'))[0], mProy1 = tomar(den('PROYECTOR'))[0], mPc = tomar(den('COMPUTADORA PERSONAL PORTATIL'))[0];
    const mPiz = tomar(den('PIZARRA ACRILICA'))[0], mParl = tomar(den('PARLANTE AMPLIFICADOR PORTATIL'))[0], mImp = tomar(i => i.denominacion === 'IMPRESORA A INYECCION DE TINTA' || i.denominacion === 'IMPRESORA LASER')[0];
    const mCam = tomar(den('CAMARA FOTOGRAFICA DIGITAL'))[0], mBalA = tomar(den('BALANZA ANALITICA'))[0], mBalP = tomar(den('BALANZA DE PRECISION'))[0];
    const mTel = tomar(den('TELESCOPIO REFRACTOR'))[0], mVent = tomar(den('VENTILADOR ELECTRICO PARA PARED'))[0], mEst = tomar(den('ESTABILIZADOR'))[0];
    // Préstamos de bienes
    const prestables = tomar(i => ['PROYECTOR', 'COMPUTADORA PERSONAL PORTATIL', 'PARLANTE AMPLIFICADOR PORTATIL', 'CAMARA FOTOGRAFICA DIGITAL', 'MICROFONO INALAMBRICO', 'TABLETA PAD', 'MEGAFONO'].includes(i.denominacion) && i.situacion === 'Activo', 16);
    // Bienes asignados a una persona
    const asignados = tomar(i => i.denominacion === 'COMPUTADORA PERSONAL PORTATIL' && i.situacion === 'Activo', 3);

    /* ---------- Movimientos (kardex) ---------- */
    const movs = [];
    const mov = (it, tipo, detalle, fecha) => movs.push({ id:uid('mov'), itemId:it.id, codigoInterno:it.codigoInterno, tipo, detalle, fecha });
    items.forEach(it => {
      if(it.situacion === 'Por sanear'){
        mov(it, 'Alta', 'Hallado sin registro previo en toma de inventario del ' + it.fechaRegistro + ' — dado de alta como "Por sanear" por ' + it.registradoPor + '.', it.fechaRegistro);
      }else if(it._reqNumero){
        mov(it, 'Alta', 'Alta por recepción del requerimiento ' + it._reqNumero + ' (OC ' + it._oc + '), registrado por ' + it.registradoPor + '.', it.fechaRegistro);
      }else if(it.formaAdquisicion === 'Donación'){
        mov(it, 'Alta', 'Registro inicial del bien en el inventario por ' + it.registradoPor + '. Ingresa por donación de ' + it.donante + ' (' + it.documentoDonacion + ').', it.fechaRegistro);
      }else{
        mov(it, 'Alta', 'Registro inicial del bien en el inventario por ' + it.registradoPor + '.', it.fechaRegistro);
      }
    });
    // Traslados de ambiente
    tomar(i => edadAnios(i.fechaRegistro) > 0.5 && i.situacion === 'Activo' && i.aulaId !== aulaAlm.id && !i._reqNumero, 7).forEach(it => {
      const aulaPrev = pick(aulas.filter(a => a.id !== it.aulaId && a._kit !== 'almacen'));
      const f = addD(it.fechaRegistro, int(20, Math.max(25, Math.floor(edadAnios(it.fechaRegistro) * 365 - 10))));
      mov(it, 'Traslado de ambiente', 'Traslado desde "' + aulaPrev.aulaLabel + '" hacia "' + it.aulaNombre + '" por ' + pick(['admin', 'secretaria']) + '.', minISO(f, addD(hoy, -3)));
    });
    // Cambios de custodio y actualizaciones
    asignados.forEach((it, i) => {
      const p = [docPri[i], docSec[i], persCoord][i];
      it.situacion = 'Asignado'; it.custodioId = p.id; it.custodioNombre = p.nombre;
      mov(it, 'Cambio de custodio', 'Asignado a ' + p.nombre + ' (' + p.cargo + ') para su uso personal de trabajo.', addD(hoy, -int(30, 200)));
    });
    tomar(i => i.situacion === 'Activo', 16).forEach(it => mov(it, 'Observación', 'Actualización de datos del bien por ' + pick(['admin', 'secretaria']) + '.', addD(hoy, -int(5, 160))));

    /* ---------- Garantías: algunas por vencer y otras vencidas (alertas del panel) ---------- */
    tomar(i => BANCO && i.garantiaHasta && i.situacion === 'Activo' && edadAnios(i.fechaRegistro) < 2.5, 5).forEach((it, i) => {
      it.garantiaHasta = i < 3 ? addD(hoy, int(6, 27)) : addD(hoy, -int(10, 70));
    });

    /* ---------- Préstamos de bienes ---------- */
    const docentesPrest = [docPri[0], docPri[1], docPri[3], docPri[5], docSec[0], docSec[1], docSec[2], docSec[3], persBib, persCoord];
    const MOTIVOS = ['Exposiciones de la clase de Comunicación', 'Feria de ciencias y tecnología', 'Capacitación docente', 'Actividad cívica — izamiento del pabellón', 'Reunión de padres de familia', 'Proyección de documental en clase', 'Concurso de oratoria', 'Taller de lectura en voz alta'];
    const LUGARES = ['Aula del solicitante', 'Auditorio', 'Patio principal', 'Sala de profesores', 'Biblioteca', 'Laboratorio de Ciencias'];
    const itemsPrest = prestables.slice();
    const prestamos = [];
    function nuevoPrestamo(solic, bienes, fechaPrest, fechaProg, estado, fechaReal){
      const detalleEntrega = bienes.map(b => ({ itemId:b.id, codigoInterno:b.codigoInterno, denominacion:b.denominacion, marca:b.marca || '', modelo:b.modelo || '', numeroSerie:b.numeroSerie || '', color:b.color || '', estadoEntrega:b.estadoConservacion }));
      const p = { id:uid('pres'), numero:'', docente:solic.nombre, dni:solic.dni, cargo:solic.cargo, motivo:pick(MOTIVOS), lugar:pick(LUGARES), autoriza:nombreDirector,
        fechaPrestamo:fechaPrest, fechaDevolucionProgramada:fechaProg, fechaDevolucionReal:fechaReal || '', estado,
        bienesIds:bienes.map(b => b.id), bienesAula:bienes.map(b => b.aulaId), detalleEntrega, detalleDevolucion:[], registradoPor:pick(['admin', 'secretaria']) };
      if(estado === 'Devuelto'){
        p.detalleDevolucion = bienes.map(b => ({ itemId:b.id, estadoDevolucion:b.estadoConservacion, observacion:'' }));
      }
      prestamos.push(p);
      bienes.forEach(b => mov(b, 'Préstamo', 'Prestado a ' + p.docente + ' — ' + p.motivo + ' (' + p.registradoPor + ').', fechaPrest));
      if(estado === 'Devuelto') bienes.forEach(b => mov(b, 'Devolución', 'Devuelto por ' + p.docente + '. Estado: ' + b.estadoConservacion + ' (' + p.registradoPor + ').', fechaReal));
      return p;
    }
    const sacar = n => itemsPrest.splice(0, n);
    for(let i = 0; i < 6; i++){
      const fp = addD(hoy, -int(25, 150)), prog = addD(fp, pick([2, 3, 5, 7]));
      nuevoPrestamo(docentesPrest[i], sacar(int(1, 2)), fp, prog, 'Devuelto', minISO(addD(prog, int(-1, 2)), addD(hoy, -1)));
    }
    nuevoPrestamo(docentesPrest[6], sacar(2), addD(hoy, -14), addD(hoy, -6), 'Prestado');   // vencido
    nuevoPrestamo(docentesPrest[7], sacar(1), addD(hoy, -4), addD(hoy, 2), 'Prestado');     // por vencer
    nuevoPrestamo(docentesPrest[8], sacar(2), addD(hoy, -1), addD(hoy, 5), 'Prestado');     // reciente
    prestamos.sort((a, b) => a.fechaPrestamo.localeCompare(b.fechaPrestamo)).forEach((p, i) => { p.numero = 'PR-' + anio + '-' + pad(i + 1, 4); });
    // un préstamo devuelto con un bien en peor estado
    {
      const pd = prestamos.find(p => p.estado === 'Devuelto');
      if(pd){
        const d = pd.detalleDevolucion[0], it = items.find(x => x.id === d.itemId);
        if(it && it.estadoConservacion !== 'Malo'){ d.estadoDevolucion = it.estadoConservacion === 'Muy Bueno' ? 'Bueno' : 'Regular'; d.observacion = 'Pequeño desgaste por uso.'; it.estadoConservacion = d.estadoDevolucion; }
      }
    }
    prestamos.forEach(p => log(p.fechaPrestamo, p.registradoPor, 'Préstamo de bien', p.numero + ' — ' + p.docente));

    /* ---------- Mantenimientos / incidencias / calibraciones ---------- */
    const mants = [];
    function mant(it, o){
      const m = Object.assign({ id:uid('mant'), itemId:it.id, codigoInterno:it.codigoInterno, denominacion:it.denominacion, aulaNombre:it.aulaNombre,
        tipo:'Incidencia / Falla', prioridad:'Media', descripcion:'', fechaReporte:hoy, fechaProgramada:'', recurrenciaMeses:null, estado:'Abierto', costo:null,
        proveedor:'', solucion:'', numeroDenuncia:'', entidadCalibradora:'', numeroCertificado:'', resultadoCalibracion:'', fechaCierre:'', reportadoPor:'admin' }, o);
      mants.push(m);
      mov(it, 'Mantenimiento', m.tipo + ' — ' + m.descripcion + ' (' + m.estado + ') registrado por ' + m.reportadoPor + '.', m.fechaReporte);
      if(m.tipo !== 'Calibración'){
        if(m.estado === 'Resuelto'){ /* vuelve a Activo (ya lo es) */ }
        else it.situacion = m.tipo === 'Siniestro / Pérdida' ? 'Perdido/Sustraído' : 'En mantenimiento';
      }
      log(m.fechaReporte, m.reportadoPor, m.tipo === 'Siniestro / Pérdida' ? 'Registrar siniestro/pérdida' : 'Registrar mantenimiento', it.codigoInterno + ' — ' + it.denominacion + ' (' + m.estado + ')');
      return m;
    }
    if(mExt){ const fp = addD(hoy, -335); mant(mExt, { tipo:'Mantenimiento programado', prioridad:'Media', descripcion:'Recarga y revisión anual del extintor.', fechaReporte:addD(fp, -10), fechaProgramada:fp, recurrenciaMeses:12, estado:'Resuelto', costo:45, proveedor:'Servicios Contra Incendios Lima S.A.C.', solucion:'Recarga de PQS y cambio de precinto.', fechaCierre:addD(fp, 2) });
      mant(mExt, { tipo:'Mantenimiento programado', prioridad:'Media', descripcion:'Recarga y revisión anual del extintor.', fechaReporte:hoy, fechaProgramada:addM(fp, 12), recurrenciaMeses:12, estado:'Abierto', proveedor:'Servicios Contra Incendios Lima S.A.C.' }); }
    if(mProy1) mant(mProy1, { tipo:'Mantenimiento programado', prioridad:'Media', descripcion:'Limpieza de filtro y revisión de lámpara.', fechaReporte:addD(hoy, -5), fechaProgramada:addD(hoy, 10), recurrenciaMeses:6, estado:'Abierto', proveedor:'TecnoAndina Soluciones E.I.R.L.' });
    if(mPc) mant(mPc, { tipo:'Incidencia / Falla', prioridad:'Alta', descripcion:'La computadora no enciende; posible falla de la fuente de poder.', fechaReporte:addD(hoy, -9), estado:'En proceso', costo:180, proveedor:'Servicio Técnico Lima Norte', reportadoPor:'prof.vargas' });
    if(mPiz) mant(mPiz, { tipo:'Incidencia / Falla', prioridad:'Media', descripcion:'Pizarra con marco suelto y superficie rayada.', fechaReporte:addD(hoy, -3), estado:'Abierto', reportadoPor:'prof.quispe' });
    if(mParl) mant(mParl, { tipo:'Incidencia / Falla', prioridad:'Baja', descripcion:'Parlante sin audio por cable defectuoso.', fechaReporte:addD(hoy, -40), estado:'Resuelto', costo:35, proveedor:'Electrónica Central', solucion:'Cambio de cable de alimentación.', fechaCierre:addD(hoy, -36), reportadoPor:'docente' });
    if(mImp) mant(mImp, { tipo:'Incidencia / Falla', prioridad:'Media', descripcion:'Atasco de papel recurrente y manchas en la impresión.', fechaReporte:addD(hoy, -70), estado:'Resuelto', costo:120, proveedor:'TecnoAndina Soluciones E.I.R.L.', solucion:'Limpieza de rodillos y cambio de cabezal.', fechaCierre:addD(hoy, -64), reportadoPor:'secretaria' });
    if(mCam) mant(mCam, { tipo:'Siniestro / Pérdida', prioridad:'Alta', descripcion:'Sustracción de la cámara durante la actividad por aniversario.', fechaReporte:addD(hoy, -21), estado:'Abierto', numeroDenuncia:'DEN-' + anio + '-014523 (Comisaría del sector)', reportadoPor:'admin' });
    if(mBalA){ const fp = addD(hoy, -340);
      mant(mBalA, { tipo:'Calibración', prioridad:'Media', descripcion:'Calibración anual de la balanza analítica.', fechaReporte:addD(fp, -5), fechaProgramada:fp, recurrenciaMeses:12, estado:'Resuelto', costo:380, proveedor:'MetroPerú Laboratorio de Calibración S.A.C.', entidadCalibradora:'MetroPerú Laboratorio de Calibración S.A.C.', numeroCertificado:'CC-' + (anio - 1) + '-0481', resultadoCalibracion:'Conforme', solucion:'Certificado emitido sin desviaciones.', fechaCierre:addD(fp, 3), reportadoPor:'prof.vargas' });
      mant(mBalA, { tipo:'Calibración', prioridad:'Media', descripcion:'Calibración anual de la balanza analítica.', fechaReporte:hoy, fechaProgramada:addM(fp, 12), recurrenciaMeses:12, estado:'Abierto', proveedor:'MetroPerú Laboratorio de Calibración S.A.C.', reportadoPor:'prof.vargas' }); }
    if(mBalP) mant(mBalP, { tipo:'Calibración', prioridad:'Media', descripcion:'Calibración periódica de balanza de precisión.', fechaReporte:addD(hoy, -100), fechaProgramada:addD(hoy, -95), estado:'Resuelto', costo:290, proveedor:'MetroPerú Laboratorio de Calibración S.A.C.', entidadCalibradora:'MetroPerú Laboratorio de Calibración S.A.C.', numeroCertificado:'CC-' + anio + '-0112', resultadoCalibracion:'Conforme con observaciones', solucion:'Se recomienda ajustar nivelación antes de cada uso.', fechaCierre:addD(hoy, -92), reportadoPor:'prof.vargas' });
    if(mTel) mant(mTel, { tipo:'Calibración', prioridad:'Baja', descripcion:'Verificación del enfoque y alineación óptica.', fechaReporte:addD(hoy, -150), fechaProgramada:addD(hoy, -145), estado:'Resuelto', costo:150, proveedor:'Óptica Científica Perú', entidadCalibradora:'Óptica Científica Perú', numeroCertificado:'OC-' + anio + '-0033', resultadoCalibracion:'No conforme', solucion:'Se programó cambio de lente ocular.', fechaCierre:addD(hoy, -140), reportadoPor:'prof.vargas' });
    if(mVent) mant(mVent, { tipo:'Incidencia / Falla', prioridad:'Baja', descripcion:'Ventilador con ruido excesivo.', fechaReporte:addD(hoy, -85), estado:'Resuelto', costo:40, proveedor:'Electro Servicios Perú', solucion:'Lubricación y ajuste de aspas.', fechaCierre:addD(hoy, -82), reportadoPor:'admin' });
    if(mEst) mant(mEst, { tipo:'Mantenimiento programado', prioridad:'Alta', descripcion:'Mantenimiento preventivo de la sala de cómputo (limpieza interna y revisión eléctrica).', fechaReporte:addD(hoy, -35), fechaProgramada:addD(hoy, -8), recurrenciaMeses:6, estado:'Abierto', proveedor:'Servicio Técnico Lima Norte', reportadoPor:'admin' });

    /* ---------- Bajas de bienes (una por cada etapa del expediente) ---------- */
    const bajas = [];
    const CAUSALES = ['Obsolescencia tecnológica', 'Mantenimiento o reparación onerosa', 'Deterioro por el uso', 'Reposición por renovación de equipos', 'Siniestro (incendio, inundación u otro)'];
    const DESTINOS = ['Donación a operador RAEE autorizado', 'Venta / subasta pública', 'Transferencia a otra entidad (I.E./UGEL)', 'Incineración / destrucción'];
    const etapas = ['Solicitada', 'Con informe técnico', 'Con resolución', 'Con disposición final', 'Rechazada'];
    bajaPool.forEach((it, i) => {
      const etapa = etapas[i]; const fs = addD(hoy, -(120 - i * 22));
      const causal = CAUSALES[i % CAUSALES.length];
      const b = { id:uid('baja'), numero:'BAJA-' + anio + '-' + pad(i + 1, 4), itemId:it.id, itemCodigoInterno:it.codigoInterno, itemDenominacion:it.denominacion, itemCodigoSBN:it.codigoSBN,
        itemValorAdquisicion:it.valorAdquisicion, itemAulaNombre:it.aulaNombre, fechaSolicitud:fs, solicitante:persAdm.nombre, causal,
        sustento:'El bien presenta ' + (causal === 'Obsolescencia tecnológica' ? 'obsolescencia tecnológica que impide su uso con las aplicaciones actuales' : 'deterioro que hace inviable o antieconómica su reparación') + '. Se solicita su evaluación para la baja correspondiente.',
        estado:etapa, informeTecnico:null, resolucion:null, disposicionFinal:null, registradoPor:'admin' };
      it.estadoConservacion = 'Malo';
      mov(it, 'Observación', 'Solicitud de baja ' + b.numero + ' iniciada — causal: ' + causal + ' (admin).', fs);
      log(fs, 'admin', 'Solicitar baja de bien', it.denominacion + ' (' + it.codigoInterno + ') — Expediente ' + b.numero + ' — Causal: ' + causal);
      if(i >= 1){ b.informeTecnico = { fecha:addD(fs, 6), responsable:persCoord.nombre, descripcion:'Evaluado el bien, se verifica el estado de inoperatividad. Se recomienda proceder con la baja conforme a la Directiva N° 001-2015/SBN.' };
        mov(it, 'Observación', 'Informe técnico agregado al expediente de baja ' + b.numero + ' por admin.', b.informeTecnico.fecha); log(b.informeTecnico.fecha, 'admin', 'Agregar informe técnico de baja', it.denominacion + ' — Expediente ' + b.numero); }
      if(i >= 2){
        const rech = etapa === 'Rechazada';
        b.resolucion = { numero:'R.D. N° ' + pad(20 + i, 3) + '-' + anio + '-IE', fecha:addD(fs, 14), emitidaPor:'Dirección de la I.E. N° 20456', tipo: rech ? 'Rechazada' : 'Aprobada', motivoRechazo: rech ? 'El bien aún es reparable a un costo razonable; se recomienda su mantenimiento.' : '' };
        log(b.resolucion.fecha, 'admin', rech ? 'Rechazar baja' : 'Aprobar baja', it.denominacion + ' — ' + b.resolucion.numero); }
      if(i === 3){
        b.disposicionFinal = { tipo:DESTINOS[0], fecha:addD(fs, 30), destinatario:'EcoRAEE Perú S.A.C. (operador autorizado)', observaciones:'Entrega con acta de recojo N° 0045.' };
        mov(it, 'Baja', 'Baja formalizada — Expediente ' + b.numero + ', Resolución ' + b.resolucion.numero + ', destino: ' + b.disposicionFinal.tipo + ' (' + b.disposicionFinal.destinatario + ') (admin).', b.disposicionFinal.fecha);
        log(b.disposicionFinal.fecha, 'admin', 'Dar de baja', it.denominacion + ' (' + it.codigoInterno + ')');
      }
      it.situacion = etapa === 'Con disposición final' ? 'De baja' : etapa === 'Rechazada' ? 'Activo' : 'En trámite de baja';
      if(etapa === 'Rechazada') it.estadoConservacion = 'Regular';
      bajas.push(b);
    });

    /* ---------- Papelera: se quitan del inventario ---------- */
    const papelera = papeleraItems.map(it => {
      const fe = addD(hoy, -int(8, 70));
      mov(it, 'Observación', 'Bien enviado a la papelera por admin.', fe);
      log(fe, 'admin', 'Eliminar bien (a papelera)', it.denominacion + ' (' + it.codigoInterno + ')');
      return Object.assign({}, it, { eliminadoPor:'admin', fechaEliminacion:fe });
    });
    const idsPapelera = new Set(papeleraItems.map(i => i.id));
    const itemsFinal = items.filter(i => !idsPapelera.has(i.id)).map(i => { const c = Object.assign({}, i); delete c._reqNumero; delete c._oc; return c; });
    papelera.forEach(p => { delete p._reqNumero; delete p._oc; });
    // los movimientos de bienes eliminados se conservan (kardex histórico)
    const idsVivos = new Set(itemsFinal.map(i => i.id));
    movs.sort((a, b) => a.fecha.localeCompare(b.fecha));

    /* ---------- Pólizas de seguro ---------- */
    const polizas = [];
    {
      const bienesCompu = itemsFinal.filter(i => i.categoriaDeprecId === 'computo' && i.situacion !== 'De baja').slice(0, 14).map(i => i.id);
      const bienesAV = itemsFinal.filter(i => ['PROYECTOR', 'TELEVISOR LED', 'EQUIPO DE SONIDO', 'CAMARA FOTOGRAFICA DIGITAL', 'PIANO DIGITAL'].includes(i.denominacion) && i.situacion !== 'De baja').map(i => i.id);
      polizas.push({ id:uid('poliza'), aseguradora:'Aseguradora Andina del Perú S.A.', numeroPoliza:'POL-' + anio + '-0012', tipoCobertura:'Todo riesgo — equipos electrónicos y de cómputo',
        vigenciaDesde:addD(hoy, -200), vigenciaHasta:addD(hoy, 165), primaAnual:2480, bienesIds:[...new Set([...bienesCompu, ...bienesAV])], observaciones:'Cobertura incluye robo con violencia y daños eléctricos.', registradoPor:'admin' });
      polizas.push({ id:uid('poliza'), aseguradora:'Seguros Pacífico Sur S.A.', numeroPoliza:'POL-' + (anio - 1) + '-0877', tipoCobertura:'Incendio y robo — mobiliario y bienes de laboratorio',
        vigenciaDesde:addD(hoy, -345), vigenciaHasta:addD(hoy, 20), primaAnual:1350, bienesIds:itemsFinal.filter(i => ['maquinaria', 'muebles'].includes(i.categoriaDeprecId) && i.situacion !== 'De baja').slice(0, 12).map(i => i.id), observaciones:'Renovar antes del vencimiento.', registradoPor:'admin' });
      log(addD(hoy, -200), 'admin', 'Crear póliza de seguro', 'Aseguradora Andina del Perú S.A. — N° POL-' + anio + '-0012');
    }

    /* ---------- Almacén de consumibles ---------- */
    const CONS_DEF = [
      ['Papel bond A4 75 g (millar)', 'Papelería', 'millar', 20, 12, 'Almacén general'], ['Plumones para pizarra acrílica (caja x12)', 'Papelería', 'caja', 15, 6, 'Almacén general'],
      ['Tóner negro para impresora láser', 'Cómputo', 'unidad', 5, 4, 'Secretaría'], ['Tinta para impresora de tanque (botella)', 'Cómputo', 'botella', 14, 6, 'Aula de Innovación'],
      ['Pilas AA (paquete x4)', 'Cómputo', 'paquete', 9, 5, 'Almacén general'], ['Detergente industrial (kg)', 'Limpieza', 'kg', 30, 10, 'Almacén general'],
      ['Lejía (galón)', 'Limpieza', 'galón', 12, 5, 'Almacén general'], ['Papel higiénico (paquete x24)', 'Limpieza', 'paquete', 10, 8, 'Almacén general'],
      ['Jabón líquido (galón)', 'Limpieza', 'galón', 7, 6, 'Almacén general'], ['Bolsas de basura 140 L (paquete)', 'Limpieza', 'paquete', 25, 10, 'Almacén general'],
      ['Guantes de nitrilo (caja x100)', 'Laboratorio', 'caja', 6, 3, 'Laboratorio de Ciencias'], ['Alcohol medicinal 96° (litro)', 'Laboratorio', 'litro', 18, 8, 'Laboratorio de Ciencias'],
      ['Mascarillas descartables (caja x50)', 'Salud/Botiquín', 'caja', 8, 4, 'Tópico'], ['Alcohol en gel (litro)', 'Salud/Botiquín', 'litro', 16, 8, 'Tópico'],
      ['Gasas estériles (paquete)', 'Salud/Botiquín', 'paquete', 20, 10, 'Tópico'], ['Cinta de embalaje (rollo)', 'Otro', 'rollo', 24, 8, 'Almacén general']
    ];
    const consumibles = [], movsConsumibles = [];
    CONS_DEF.forEach(d => {
      const c = { id:uid('cons'), nombre:d[0], categoria:d[1], unidad:d[2], stockActual:0, stockMinimo:d[4], ubicacion:d[5], observaciones:'' };
      let saldo = 0;
      const f0 = addD(hoy, -int(100, 170));
      const ini = int(Math.ceil(d[3] * 1.2), Math.ceil(d[3] * 2.2));
      saldo = ini; movsConsumibles.push({ id:uid('movc'), consumibleId:c.id, tipo:'Entrada', cantidad:ini, fecha:f0, motivo:'Stock inicial al crear el consumible', registradoPor:'admin', saldoResultante:saldo });
      const n = int(4, 8); const fechas = []; for(let k = 0; k < n; k++) fechas.push(addD(f0, int(5, Math.max(10, diffDias(f0, hoy)))));
      fechas.sort().forEach(f => {
        if(chance(.28)){ const q = int(Math.max(1, Math.floor(d[3] / 3)), Math.max(2, Math.floor(d[3] / 1.5))); saldo += q; movsConsumibles.push({ id:uid('movc'), consumibleId:c.id, tipo:'Entrada', cantidad:q, fecha:f, motivo:pick(['Compra directa', 'Requerimiento ' + nroReq(2), 'Dotación de la UGEL']), observacion:'', registradoPor:'admin', saldoResultante:saldo }); }
        else if(saldo > 0){ const q = Math.min(saldo, int(1, Math.max(1, Math.floor(d[3] / 4)))); saldo -= q; movsConsumibles.push({ id:uid('movc'), consumibleId:c.id, tipo:'Salida', cantidad:q, fecha:f, motivo:pick(['Aula 3° B — Prof. ' + pick(APE), 'Secretaría', 'Dirección', 'Sala de profesores', 'Mantenimiento general']), observacion:'', registradoPor:pick(['admin', 'secretaria']), saldoResultante:saldo }); }
      });
      c.stockActual = saldo; consumibles.push(c);
    });
    // algunos consumibles quedan por debajo del mínimo (alerta de stock)
    [2, 7, 12].forEach(idx => { const c = consumibles[idx]; const falta = c.stockActual - Math.max(0, c.stockMinimo - 2); if(falta > 0){ const q = Math.min(falta, c.stockActual); c.stockActual -= q; movsConsumibles.push({ id:uid('movc'), consumibleId:c.id, tipo:'Salida', cantidad:q, fecha:addD(hoy, -int(1, 6)), motivo:'Dotación a las aulas', observacion:'', registradoPor:'admin', saldoResultante:c.stockActual }); } });
    movsConsumibles.sort((a, b) => a.fecha.localeCompare(b.fecha));

    /* ---------- Presupuesto por fuente ---------- */
    const presupuestos = [];
    [[FUENTES[0], 28000, 25000], [FUENTES[1], 15000, 11000], [FUENTES[2], 9000, 8000], [FUENTES[3], 5000, 4000]].forEach(f => {
      presupuestos.push({ id:uid('presu'), anio:String(anio), fuente:f[0], montoAsignado:f[1], observaciones:'' });
      presupuestos.push({ id:uid('presu'), anio:String(anio - 1), fuente:f[0], montoAsignado:f[2], observaciones:'Ejecución del año anterior.' });
    });

    /* ---------- Comisión de inventario ---------- */
    const comision = [
      { id:'com_' + uid('c'), nombre:persSub.nombre, cargo:'Presidente(a)', activo:true },
      { id:'com_' + uid('c'), nombre:persSecre.nombre, cargo:'Secretario(a)', activo:true },
      { id:'com_' + uid('c'), nombre:docSec[2].nombre, cargo:'Miembro', activo:true },
      { id:'com_' + uid('c'), nombre:persAdm.nombre, cargo:'Miembro', activo:true },
      { id:'com_' + uid('c'), nombre:docPri[1].nombre, cargo:'Miembro (anterior)', activo:false }
    ];

    /* ---------- Conciliación patrimonial-contable ---------- */
    const conciliaciones = [];
    {
      const tot = ctx.totalesSIGIE(itemsFinal);
      const prev = JSON.parse(JSON.stringify(tot));
      prev.totalItems = Math.max(1, Math.round(tot.totalItems * 0.93)); prev.valorAdquisicionTotal = r2(tot.valorAdquisicionTotal * 0.92); prev.valorNetoLibrosTotal = r2(tot.valorNetoLibrosTotal * 1.08);
      prev.porCategoria = prev.porCategoria.map(c => Object.assign({}, c, { valorAdq:r2(c.valorAdq * 0.92), valorNeto:r2(c.valorNeto * 1.08) }));
      conciliaciones.push({ id:uid('conc'), fechaCorte:(anio - 1) + '-12-31', sigie:prev, valorContable:r2(prev.valorAdquisicionTotal * 1.004), valorNetoContable:r2(prev.valorNetoLibrosTotal * 0.995),
        fuente:'SIAF-SP — Balance de comprobación al 31/12/' + (anio - 1), observaciones:'Diferencia menor por redondeos y bienes en proceso de valorización.', creadoPor:persDirector.nombre, fechaCreacion:(anio) + '-01-12' });
      conciliaciones.push({ id:uid('conc'), fechaCorte:addD(hoy, -15), sigie:tot, valorContable:r2(tot.valorAdquisicionTotal * 0.86), valorNetoContable:r2(tot.valorNetoLibrosTotal * 0.82),
        fuente:'SIAF-SP — Balance de comprobación (corte mensual)', observaciones:'Diferencia por bienes pendientes de saneamiento aún no valorizados contablemente.', creadoPor:persDirector.nombre, fechaCreacion:addD(hoy, -14) });
      log(addD(hoy, -14), 'admin', 'Registrar conciliación patrimonial-contable', 'Fecha de corte ' + addD(hoy, -15));
    }

    /* ---------- Plano del colegio (imagen SVG simulada + marcadores) ---------- */
    const planos = [];
    function svgPlano(titulo, salas){
      const cols = 4, w = 800, h = 130 + Math.ceil(salas.length / cols) * 130, cw = (w - 40) / cols;
      let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><rect width="100%" height="100%" fill="#f4f1ea"/>' +
        '<text x="400" y="34" text-anchor="middle" font-family="Arial" font-size="20" font-weight="700" fill="#14304d">' + titulo + '</text>' +
        '<rect x="20" y="52" width="' + (w - 40) + '" height="22" fill="#d9d2c0"/><text x="400" y="68" text-anchor="middle" font-family="Arial" font-size="11" fill="#5a5444">PASADIZO PRINCIPAL</text>';
      salas.forEach((n, i) => { const c = i % cols, r = Math.floor(i / cols); const x = 20 + c * cw, y = 90 + r * 130;
        s += '<rect x="' + (x + 6) + '" y="' + y + '" width="' + (cw - 12) + '" height="110" rx="4" fill="#fff" stroke="#14304d" stroke-width="2"/>' +
          '<text x="' + (x + cw / 2) + '" y="' + (y + 100) + '" text-anchor="middle" font-family="Arial" font-size="12" fill="#14304d">' + n.replace(/&/g, '&amp;') + '</text>'; });
      return s + '</svg>';
    }
    function marcadores(salas, lista){
      const cols = 4, w = 800, h = 130 + Math.ceil(salas.length / cols) * 130, cw = (w - 40) / cols;
      return lista.map((a, i) => ({ id:uid('mk'), aulaId:a.id, x:r2(((20 + (i % cols) * cw + cw / 2) / w) * 100), y:r2(((90 + Math.floor(i / cols) * 130 + 45) / h) * 100) }));
    }
    const salasPB = aulas.filter(a => a.nivel === 'Inicial' || a.nivel === 'Administrativo' || a.nivel === 'Áreas comunes');
    const salas2P = aulas.filter(a => a.nivel === 'Primaria' || a.nivel === 'Secundaria');
    planos.push({ id:uid('plano'), nombre:'Planta baja — Inicial, administración y áreas comunes', _svg:svgPlano('PLANTA BAJA (EJEMPLO)', salasPB.map(a => a.nombre)), imagenId:'', marcadores:marcadores(salasPB.map(a => a.nombre), salasPB) });
    planos.push({ id:uid('plano'), nombre:'Segundo piso — Primaria y Secundaria', _svg:svgPlano('SEGUNDO PISO (EJEMPLO)', salas2P.map(a => a.nombre)), imagenId:'', marcadores:marcadores(salas2P.map(a => a.nombre), salas2P) });

    /* ---------- Tomas de inventario por aula ---------- */
    const tomas = [];
    function nuevaToma(aula, fecha, verificador, sanear){
      const its = itemsFinal.filter(i => i.aulaId === aula.id && i.situacion !== 'Por sanear' && i.situacion !== 'De baja');
      const noEnc = new Set(shuffle(its).slice(0, chance(.7) ? 1 : 0).map(i => i.id));
      const t = { id:uid('toma'), aulaId:aula.id, aulaNombre:aula.aulaLabel, responsable:aula.responsable, fecha, verificadoPor:verificador,
        items:its.map(i => ({ itemId:i.id, codigoInterno:i.codigoInterno, denominacion:i.denominacion, encontrado:!noEnc.has(i.id), estadoEncontrado:noEnc.has(i.id) ? '' : i.estadoConservacion, observacion:noEnc.has(i.id) ? 'No se ubicó durante la verificación.' : '' })),
        noRegistrados:sanear ? [{ itemId:sanear.id, codigoInterno:sanear.codigoInterno, denominacion:sanear.denominacion, observacion:'' }] : [] };
      tomas.push(t);
      log(fecha, verificador === persDirector.nombre ? 'admin' : 'docente', 'Registrar toma de inventario', aula.aulaLabel + ' — ' + its.length + ' bien(es) verificados');
      return t;
    }
    const itSan1 = itemsFinal.find(i => i.id === sanear1.id), itSan2 = itemsFinal.find(i => i.id === sanear2.id);
    nuevaToma(aulaPri4, fechaToma1, persSub.nombre, itSan1);
    nuevaToma(aulaLab, fechaToma2, docSec[5].nombre, itSan2);
    nuevaToma(aulaSecre, addD(hoy, -7), persSecre.nombre, null);

    /* ---------- Inventario guardado de años anteriores (comparativo interanual) ---------- */
    const snapshots = [];
    {
      const itemsAnt = ctx.snapshotItems(itemsFinal.filter(i => i.fechaRegistro < anio + '-01-01'));
      shuffle(itemsAnt).slice(0, Math.floor(itemsAnt.length * .12)).forEach(i => { i.estadoConservacion = i.estadoConservacion === 'Muy Bueno' ? 'Bueno' : i.estadoConservacion === 'Bueno' ? 'Regular' : i.estadoConservacion; });
      shuffle(itemsAnt).slice(0, 4).forEach(i => { const o = pick(aulas.filter(a => a._kit === 'aula')); i.aulaId = o.id; i.aulaNombre = o.aulaLabel; });
      snapshots.push({ id:uid('snap'), anio:String(anio - 1), fecha:(anio - 1) + '-12-20', nota:'Inventario de cierre de año (ejemplo).', creadoPor:persDirector.nombre, items:itemsAnt });
      log((anio - 1) + '-12-20', 'admin', 'Guardar inventario del año', 'Año ' + (anio - 1) + ' — ' + itemsAnt.length + ' bien(es)');
    }

    /* ---------- Bitácora: eventos de alta de los bienes más recientes ---------- */
    itemsFinal.filter(i => i.fechaRegistro >= addD(hoy, -90)).slice(0, 25).forEach(i => log(i.fechaRegistro, i.registradoPor, 'Crear bien', i.denominacion + ' (' + i.codigoInterno + ')'));
    itemsFinal.filter(i => i.fechaRegistro >= addD(hoy, -400)).slice(0, 8).forEach(i => log(addD(hoy, -int(3, 60)), pick(['admin', 'secretaria']), 'Editar bien', i.denominacion + ' (' + i.codigoInterno + ')'));
    reqs.forEach(r => { log(r.fecha, r.creadoPor, 'Registrar requerimiento de compra', r.numero + ' — ' + r.lineas.length + ' ítem(s)'); if(r.fechaAprobacion) log(r.fechaAprobacion, 'admin', 'Aprobar requerimiento de compra', r.numero); if(r.ordenCompra) log(r.ordenCompra.fechaEmision, 'admin', 'Generar orden de compra', r.numero + ' — OC ' + r.ordenCompra.numero + ' — ' + r.ordenCompra.proveedor); if(r.estado === 'Rechazado') log(addD(r.fecha, 2), 'admin', 'Rechazar requerimiento de compra', r.numero + ' — ' + r.motivoRechazo); (r.historialRecepciones || []).forEach(h => log(h.fecha, 'admin', 'Registrar recepción de compra', r.numero)); });
    presupuestos.filter(p => p.anio === String(anio)).forEach(p => log(addD(hoy, -int(150, 250)), 'admin', 'Asignar techo presupuestal', p.fuente + ' — ' + anio + ' — S/ ' + p.montoAsignado));

    /* =====================================================================
       BIBLIOTECA
       ===================================================================== */
    const cats = ctx.bibCats.map(c => Object.assign({}, c));
    const libros = [];
    const ubiCat = {};
    cats.forEach(c => {
      const lista = String(c.ubicaciones || '').split(',').map(s => s.trim()).filter(Boolean);
      if(!lista.length){ const u = String(40 + (c.prefijo === 'CUE' ? 2 : 1)); lista.push(u); c.ubicaciones = u; }
      ubiCat[c.id] = lista;
    });
    const OBS_BUENO = ['Buen estado de conservación','Ejemplar de uso frecuente','Sin observaciones','Donación de promoción','Dotación del MINEDU','Reposición reciente'];
    const OBS_REGULAR = ['Cubierta con desgaste leve','Páginas amarillentas','Subrayado a lápiz','Lomo con desgaste','Esquinas dobladas'];
    cats.forEach(c => {
      const bank = TITULOS[c.prefijo] || [1, 2, 3].map(n => c.nombre + ' — TEXTO ' + n + '|VARIOS AUTORES|000');
      const filas = [];
      // Igual que la planilla física: UNA FILA POR EJEMPLAR (cant = 1), con su propio código y estado.
      bank.forEach(linea => {
        const p = linea.split('|');
        const esMed = p[1] === MEDU;
        const copias = esMed ? int(6, 14) : (c.prefijo === 'ENC' || c.prefijo === 'DIC') ? int(3, 7) : c.prefijo === 'OBR' ? int(3, 8) : int(1, 4);
        const d12 = '978612' + pad(int(0, 999999), 6); let sum = 0; for(let k = 0; k < 12; k++) sum += Number(d12[k]) * (k % 2 ? 3 : 1);
        const isbn = d12 + ((10 - sum % 10) % 10);
        const editorial = esMed ? MEDU : pick(EDITORIALES);
        for(let k = 0; k < copias; k++){
          const estado = wpick(['Bueno', 'Regular', 'Malo'], [55, 35, 10]);
          filas.push({ p, isbn, editorial, estado, obs: estado === 'Malo' ? pick(OBS_LIBRO_MALO) : estado === 'Regular' ? pick(OBS_REGULAR) : pick(OBS_BUENO) });
        }
      });
      const ubis = ubiCat[c.id];
      filas.forEach((f, idx) => {
        libros.push({ id:uid('lib'), cod:c.prefijo + '-' + pad(idx + 1, 3), catId:c.id, titulo:f.p[0], autor:f.p[1], dewey:f.p[2], cant:1, estado:f.estado,
          isbn:f.isbn, editorial:f.editorial, obs:f.obs, ubi:ubis[Math.min(ubis.length - 1, Math.floor(idx / filas.length * ubis.length))] });
      });
      const reg = filas.length;
      c.totalDeclarado = chance(.72) ? reg : Math.max(0, reg + wpick([-3, -2, -1, 1, 2, 4], [1, 2, 3, 3, 2, 1]));
    });

    // Lectores (alumnos, docentes y personal) con carné QR
    const lectores = [];
    const gradosAl = aulas.filter(a => a.nivel === 'Primaria' || a.nivel === 'Secundaria').map(a => a.grado + ' ' + a.seccion + ' ' + a.nivel.toUpperCase());
    const nomLect = new Set();
    const nuevoLector = (nombre, grado, tipo) => lectores.push({ id:uid('lec'), cod:'LEC-' + pad(lectores.length + 1, 4), nombre:nombre.toUpperCase(), grado, tipo });
    for(let i = 0; i < 56; i++){
      let n; do { n = pick(i % 2 ? NOM_M : NOM_H) + ' ' + pick(APE) + ' ' + pick(APE); } while(nomLect.has(n) || nombresUsados.has(n));
      nomLect.add(n); nuevoLector(n, pick(gradosAl), 'Alumno');
    }
    [...docIni, ...docPri, ...docSec].forEach(d => nuevoLector(d.nombre, 'DOCENTE — ' + d.cargo.replace('Docente de ', '').toUpperCase(), 'Docente'));
    [persSecre, persAdm].forEach(d => nuevoLector(d.nombre, d.cargo.toUpperCase(), 'Otro'));

    // Lecturas asignadas por aula (v10): 3 aulas con su libro. Para que un aula pueda leer el mismo título a la vez, ese libro
    // tiene un ejemplar por alumno (se decide ANTES de generar préstamos y reservas, así todo lo demás sigue coherente).
    const lecturasEj = [];
    if(typeof SigieBib !== 'undefined'){
      const porAula = new Map();
      lectores.filter(l => l.tipo === 'Alumno').forEach(l => { const k = SigieBib.claveGrado(l.grado, 'seccion'); if(!porAula.has(k)) porAula.set(k, []); porAula.get(k).push(l); });
      const aulasLec = [...porAula.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 3);
      const usados = new Set();
      aulasLec.forEach(([aula, alumnos], i) => {
        let l, tries = 0; do { l = pick(libros); tries++; } while((usados.has(l.id) || l.estado === 'Malo') && tries < 80);
        usados.add(l.id); l.cant = Math.max(l.cant || 1, alumnos.length);
        const plan = [{ desde:-21, limite:-7, recibe:1, devuelve:.7 }, { desde:-6, limite:8, recibe:1, devuelve:.35 }, { desde:-30, limite:-16, recibe:1, devuelve:1 }][i];
        lecturasEj.push({ id:uid('lc'), aula, titulo:SigieBib.agruparTitulos([l]) [0].clave, libroTitulo:l.titulo, autor:l.autor || '', fecha:addD(hoy, plan.desde), limite:addD(hoy, plan.limite), obs:i === 1 ? 'Leer los primeros capítulos para la práctica de comprensión.' : '', docente:'Docente (ejemplo)', _libro:l, _alumnos:alumnos, _plan:plan });
      });
    }

    // Préstamos de libros: devueltos, vigentes y vencidos
    const bprest = [];
    const activosPorLibro = {};
    const libroDisp = l => (activosPorLibro[l.id] || 0) < l.cant;
    const crearBP = (fecha, vence, devuelto) => {
      let l, tries = 0; do { l = pick(libros); tries++; } while(!devuelto && !libroDisp(l) && tries < 50);
      const lc = pick(lectores);
      if(!devuelto) activosPorLibro[l.id] = (activosPorLibro[l.id] || 0) + 1;
      bprest.push({ id:uid('bp'), libroId:l.id, lectorId:lc.id, lector:lc.nombre, grado:lc.grado, fecha, vence, devuelto:devuelto || '' });
    };
    for(let i = 0; i < 44; i++){ const f = addD(hoy, -int(10, 115)); const v = addD(f, pick([7, 7, 14])); crearBP(f, v, minISO(addD(f, int(1, 16)), addD(hoy, -1))); }
    for(let i = 0; i < 6; i++){ const f = addD(hoy, -int(16, 32)); crearBP(f, addD(f, pick([7, 14])), ''); }
    for(let i = 0; i < 10; i++){ let f = addD(hoy, -int(0, 6)); let v = addD(f, pick([7, 14])); crearBP(f, v, ''); }
    lecturasEj.forEach((lc, i) => lc._alumnos.forEach(al => {
      if(!chance(lc._plan.recibe)) return;
      const f = addD(lc.fecha, int(0, 2)), dev = chance(lc._plan.devuelve);
      if(!dev) activosPorLibro[lc._libro.id] = (activosPorLibro[lc._libro.id] || 0) + 1;
      bprest.push({ id:uid('bp'), libroId:lc._libro.id, lectorId:al.id, lector:al.nombre, grado:al.grado, fecha:f, vence:lc.limite,
        devuelto:dev ? minISO(addD(f, int(3, 14)), addD(hoy, -1)) : '', lote:'pl-ej-' + (i + 1), loteNombre:lc.aula + ' · ' + lc.libroTitulo, lecturaId:lc.id });
    }));
    bprest.sort((a, b) => a.fecha.localeCompare(b.fecha));

    // Reseñas (v9): la mayoría de los libros devueltos tiene estrellas; algunos con comentario
    const comentariosRes = ['Muy entretenido, lo recomiendo.', 'Me gustaron los personajes.', 'Un poco largo, pero bonito.', 'Aprendí cosas nuevas.', 'Quisiera leer la segunda parte.', 'No me gustó el final.', 'Las imágenes son lindas.'];
    const resenas = [];
    bprest.filter(p => p.devuelto && R() < .65).forEach(p => {
      const est = pick([3, 4, 4, 5, 5, 5, 2, 1]);
      resenas.push({ id:uid('rs'), libroId:p.libroId, prestId:p.id, lectorId:p.lectorId, lector:p.lector, grado:p.grado, estrellas:est, comentario:R() < .5 ? pick(comentariosRes) : '', fecha:p.devuelto });
    });

    // Comprensión lectora AD / A / B / C (v10): la registra el docente en la mitad de las devoluciones
    const obsCompr = ['Identifica la idea principal.', 'Le cuesta inferir.', 'Resume con sus palabras.', 'Necesita apoyo con el vocabulario.', ''];
    const compr = (typeof SigieBib === 'undefined' ? [] : bprest.filter(p => p.devuelto && SigieBib.parsearGrado(p.grado).esAlumno && chance(.55))).map(p => ({ id:uid('cp'), prestId:p.id, libroId:p.libroId, lectorId:p.lectorId, lector:p.lector, grado:p.grado,
      nivel:wpick(['AD', 'A', 'B', 'C'], [2, 6, 4, 2]), obs:pick(obsCompr), fecha:p.devuelto, docente:'Docente (ejemplo)', ...(p.lecturaId ? { lecturaId:p.lecturaId } : {}) }));
    // Meta mensual por aula: 1 libro por cada dos alumnos o por alumno
    const metasEj = [];
    if(typeof SigieBib !== 'undefined'){
      const cnt = new Map(); lectores.filter(l => l.tipo === 'Alumno').forEach(l => { const k = SigieBib.claveGrado(l.grado, 'seccion'); cnt.set(k, (cnt.get(k) || 0) + 1); });
      [...cnt.entries()].forEach(([aula, n]) => metasEj.push({ id:'mt_' + aula, aula, libros:Math.max(2, Math.round(n * pick([.5, 1]))) }));
    }
    const lecturas = lecturasEj.map(lc => { const c = Object.assign({}, lc); delete c._libro; delete c._alumnos; delete c._plan; return c; });

    // Bajas de libros (perdidos, dañados, desgaste…): se eligen ejemplares que NUNCA se prestaron, se quitan del
    // catálogo (como hace el sistema al registrar una baja) y se guarda el acta de baja con la misma forma que la pantalla.
    const bajasBib = [];
    const nuncaPrestados = shuffle(libros.filter(l => !bprest.some(p => p.libroId === l.id)));
    [['Perdido', 'Extraviado durante la feria del libro'], ['Dañado', 'Humedad en el estante por filtración'], ['Desgaste', 'Hojas sueltas, no se puede reparar'], ['Obsoleto', 'Edición de contenido desactualizado']].forEach(([motivo, obs], k) => {
      const l = nuncaPrestados[k]; if(!l) return;
      libros.splice(libros.indexOf(l), 1);
      const cat = cats.find(c => c.id === l.catId);
      const f = addD(hoy, -int(12 + k * 20, 40 + k * 25));
      bajasBib.push({ id:uid('bj'), fecha:f, libroId:l.id, cod:l.cod, titulo:l.titulo, autor:l.autor, cat:cat ? cat.nombre : '', cant:1, motivo, resolucion:k % 2 ? '' : 'R.D. N° ' + pad(int(10, 90), 3) + '-' + ctx.anio, lector:'', grado:'', obs, responsable:'Bibliotecario(a) responsable' });
      log(f, 'biblioteca', 'Baja de libro', l.cod + ' · ' + motivo + ' x1');
    });

    // Reservas: en espera (libros con todos sus ejemplares prestados), atendidas (lectores que luego se llevaron el libro) y canceladas.
    const reservas = [];
    const yaReservo = new Set();
    const agotados = shuffle(libros.filter(l => !libroDisp(l)));
    agotados.slice(0, 5).forEach(l => {
      for(let t = 0; t < 20; t++){
        const lc = pick(lectores);
        const loTiene = bprest.some(p => p.libroId === l.id && !p.devuelto && p.lectorId === lc.id);
        if(loTiene || yaReservo.has(l.id + lc.id)) continue;
        yaReservo.add(l.id + lc.id);
        reservas.push({ id:uid('rs'), libroId:l.id, lectorId:lc.id, lector:lc.nombre, grado:lc.grado, fecha:addD(hoy, -int(0, 9)), estado:'Espera' });
        break;
      }
    });
    bprest.filter(p => p.devuelto).slice(0, 3).forEach((p, k) => {
      const estado = k < 2 ? 'Atendida' : 'Cancelada';
      reservas.push({ id:uid('rs'), libroId:p.libroId, lectorId:p.lectorId, lector:p.lector, grado:p.grado, fecha:addD(p.fecha, -int(2, 6)), estado });
    });
    reservas.sort((a, b) => a.fecha.localeCompare(b.fecha));
    reservas.forEach(r => { const l = libros.find(x => x.id === r.libroId); if(l) log(r.fecha, 'biblioteca', 'Reserva de libro', r.lector + ' · ' + l.cod); });

    bprest.forEach(p => { const l = libros.find(x => x.id === p.libroId); log(p.fecha, 'biblioteca', 'Préstamo de libro', p.lector + ' · ' + l.cod); if(p.devuelto) log(p.devuelto, 'biblioteca', 'Devolución de libro', p.id); });
    log(addD(hoy, -160), 'biblioteca', 'Importación de libros', libros.length + ' libros');

    // Inventario por estante
    const tomasBib = [];
    const ubisDisp = [...new Set(libros.map(l => String(l.ubi)))];
    shuffle(ubisDisp).slice(0, 4).forEach((u, k) => {
      const lib = libros.filter(l => String(l.ubi) === u);
      const faltantes = shuffle(lib).slice(0, chance(.6) ? int(1, 2) : 0).map(l => l.cod);
      const otros = libros.filter(l => String(l.ubi) !== u);
      const f = addD(hoy, -(8 + k * 17));
      tomasBib.push({ id:uid('bt'), fecha:f, ubi:u, responsable:'Bibliotecario(a) responsable', total:lib.length, verificados:lib.length - faltantes.length, faltantes, sobrantes:chance(.4) && otros.length ? [pick(otros).cod] : [] });
      log(f, 'biblioteca', 'Inventario por estante', 'Estante ' + u + ': ' + (lib.length - faltantes.length) + '/' + lib.length);
    });

    /* ---------- Actas verificables (registro con hash; el hash se calcula luego) ---------- */
    const pPrest = prestamos.find(p => p.estado === 'Devuelto'), tToma = tomas[0], bBaja = bajas[3], cConc = conciliaciones[1];
    const actasDef = [
      ['Acta de Préstamo', pPrest && pPrest.id, 'Préstamo ' + (pPrest && pPrest.numero) + ' — ' + (pPrest && pPrest.docente), pPrest && addD(pPrest.fechaPrestamo, 0)],
      ['Acta de Toma de Inventario Físico', tToma.id, 'Toma de inventario — ' + tToma.aulaNombre + ' (' + tToma.fecha + ')', tToma.fecha],
      ['Expediente de Baja de Bienes', bBaja && bBaja.id, 'Expediente ' + (bBaja && bBaja.numero) + ' — ' + (bBaja && bBaja.itemDenominacion), bBaja && bBaja.disposicionFinal ? bBaja.disposicionFinal.fecha : addD(hoy, -20)],
      ['Acta de Conciliación Patrimonio-Contable', cConc.id, 'Conciliación al corte ' + cConc.fechaCorte, cConc.fechaCreacion]
    ].filter(a => a[1]);

    const lectometro = (() => {
      const alum = lectores.filter(l => (l.tipo || 'Alumno') === 'Alumno').slice(0, 24);
      const bit = [];
      alum.forEach((l, i) => {
        const dias = 2 + Math.floor(R() * 20), libro = pick(libros);
        for (let d = 0; d < dias; d++) { if (!chance(.7)) continue; const pag = 5 + Math.floor(R() * 40), min = 10 + Math.floor(R() * 35);
          bit.push({ id:uid('bt'), lectorId:l.id, libroId:libro.id, libroTitulo:'', fecha:addD(hoy, -d), paginas:pag, minutos:min, autoevaluacion:3 + Math.floor(R() * 3), comentario:chance(.2) ? 'Me gustó mucho.' : '', puntos:Math.round(pag * 2 + min * .5) }); }
      });
      const lib0 = libros[0];
      const quiz = lib0 ? [{ id:uid('ev'), libroId:lib0.id, libroTitulo:'', titulo:'Comprensión de «' + lib0.titulo + '»', preguntas:[
        { texto:'¿De qué trata principalmente el libro?', opciones:['De un viaje', 'De una amistad', 'De un misterio', ''], correcta:1 },
        { texto:'¿Cuál es el personaje principal?', opciones:['El protagonista', 'El vecino', 'El maestro', 'El abuelo'], correcta:0 },
        { texto:'¿Qué enseñanza deja la historia?', opciones:['Ser constante', 'Ser veloz', 'Ser callado', ''], correcta:0 }] }] : [];
      const qres = quiz.length ? alum.slice(0, 8).map(l => { const pt = pick([34, 67, 67, 100, 100]); return { id:uid('qr'), quizId:quiz[0].id, lectorId:l.id, puntaje:pt, nivel:pt >= 91 ? 'AD' : pt >= 71 ? 'A' : pt >= 51 ? 'B' : 'C', fecha:addD(hoy, -Math.floor(R() * 10)) }; }) : [];
      const prem = [{ id:uid('pr'), nombre:'Stickers de lectura', descripcion:'Hoja de stickers', costoPuntos:100, stock:30, activo:true }, { id:uid('pr'), nombre:'Marcapáginas', descripcion:'Marcapáginas del colegio', costoPuntos:60, stock:null, activo:true }, { id:uid('pr'), nombre:'Libro a elección', descripcion:'Un libro de la biblioteca para su casa', costoPuntos:600, stock:3, activo:true }];
      const canj = alum.slice(0, 3).map((l, i) => ({ id:uid('cj'), lectorId:l.id, premioId:prem[1].id, costo:60, fecha:addD(hoy, -3 - i), estado:i === 0 ? 'pendiente' : 'entregado' }));
      const act = [{ id:uid('ac'), titulo:'Feria del libro', fecha:addD(hoy, 5), tipo:'Feria del libro', descripcion:'Exposición y venta de libros', hecha:false }, { id:uid('ac'), titulo:'Entrega de diplomas del Lectómetro', fecha:addD(hoy, 18), tipo:'Entrega de diplomas', descripcion:'', hecha:false }, { id:uid('ac'), titulo:'Concurso de cuentos', fecha:addD(hoy, -12), tipo:'Concurso', descripcion:'', hecha:true }];
      return { bit, quiz, qres, prem, canj, act };
    })();
    return {
      cfg, aulas:aulas.map(a => { const c = Object.assign({}, a); delete c._kit; delete c._resp; return c; }),
      custodios:personal.map(p => ({ id:p.id, nombre:p.nombre, cargo:p.cargo, dni:p.dni, aulaId:p.aulaId, aulaNombre:p.aulaNombre })),
      items:itemsFinal, movs, papelera, prestamos, mantenimientos:mants, polizas, requerimientos:reqs, bajas, consumibles, movsConsumibles, presupuestos, comision,
      conciliaciones, planos, tomas, snapshots, actasDef, bitacora:bit,
      seqs:{ seq:seqInterno, seqInterno, seqPorSBN, seqReq:reqs.length, seqBaja:bajas.length },
      bib:{ cats, libros, lectores, prest:bprest, tomas:tomasBib, res:reservas, baj:bajasBib, resenas, lecturas, compr, metas:metasEj, sanc:[], lectometro },
      refs:{ aulasPri:aulas.filter(a => a.nivel === 'Primaria').map(a => a.id), aulaPri4:aulaPri4.id, aulaLab:aulaLab.id, aulaInnov:aulaInnov.id, aulaDir:aulaDir.id, aulaSecre:aulaSecre.id, aulaAud:aulaAud.id, aulaSala:aulaSala.id, enMovsVivos:idsVivos.size }
    };
  }
  function diffDias(a, b){ return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5); }

  /* =====================================================================
     INTERFAZ: confirmación, respaldo, guardado y resumen
     ===================================================================== */
  function ejProgreso(msg){
    let bg = document.getElementById('ejProgreso');
    if(!bg){
      bg = document.createElement('div'); bg.id = 'ejProgreso'; bg.className = 'modal-bg';
      bg.innerHTML = '<div class="modal" style="max-width:420px;"><div class="m-h"><h3>Generando datos de ejemplo…</h3></div><div class="m-b"><div id="ejProgresoTxt" class="hint"></div><div style="margin-top:10px;height:8px;background:var(--line,#ddd);border-radius:4px;overflow:hidden;"><div id="ejProgresoBar" style="height:100%;width:0;background:var(--accent,#14304d);transition:width .2s;"></div></div></div></div>';
      document.body.appendChild(bg);
    }
    document.getElementById('ejProgresoTxt').textContent = msg;
  }
  function ejBarra(p){ const b = document.getElementById('ejProgresoBar'); if(b) b.style.width = Math.round(p * 100) + '%'; }
  function ejCerrarProgreso(){ const bg = document.getElementById('ejProgreso'); if(bg) bg.remove(); }
  const esperar = ms => new Promise(r => setTimeout(r, ms));

  function resumenActual(){
    const g = k => (DB.get(KEYS[k]) || []).length;
    return { bienes:g('items'), aulas:g('aulas'), libros:(DB.get(BKEYS.libros) || []).length, lectores:(DB.get(BKEYS.lect) || []).length, prestamos:g('prestamos'), mant:g('mantenimientos') };
  }

  async function generarDatosEjemplo(){
    if(enCurso) return;
    if(typeof isAdmin === 'function' && !isAdmin()){ toast('Solo un administrador puede generar datos de ejemplo.', 'err'); return; }
    const act = resumenActual();
    const hayDatos = act.bienes + act.aulas + act.libros + act.lectores + act.prestamos + act.mant > 0;
    const msg = hayDatos
      ? '🧪 GENERAR DATOS DE EJEMPLO\n\nEsto REEMPLAZARÁ los datos actuales de todos los módulos por información simulada:\n' +
        '• ' + act.bienes + ' bien(es), ' + act.aulas + ' aula(s), ' + act.libros + ' libro(s), ' + act.lectores + ' lector(es), ' + act.prestamos + ' préstamo(s) de bienes y ' + act.mant + ' mantenimiento(s) actuales se perderán.\n\n' +
        'NO se tocan: la cuenta "admin", el catálogo SBN, los cargos, la vida útil de depreciación y el logo.\n\n¿Deseas continuar?'
      : '🧪 GENERAR DATOS DE EJEMPLO\n\nSe rellenarán todos los módulos con información simulada (biblioteca, bienes, aulas, préstamos, mantenimientos, compras, bajas, almacén, bitácora, etc.).\n\n¿Continuar?';
    if(!confirm(msg)) return;
    if(hayDatos && confirm('¿Quieres descargar primero un respaldo completo (.json) de los datos actuales, por si acaso?')){
      try{
        const backup = {}; Object.entries(KEYS).forEach(([k, key]) => { backup[k] = DB.get(key); });
        Object.entries(BKEYS).forEach(([k, key]) => { backup['bib_' + k] = DB.get(key); });
        backup.bib_reservas = DB.get(B2.res); backup.bib_bajas = DB.get(B2.baj); backup.bib_resenas = DB.get(B5.res);
        backup.bib_lecturas = DB.get(B6.lec); backup.bib_comprension = DB.get(B6.cmp); backup.bib_sanciones = DB.get(B6.san); backup.bib_metas = DB.get(B6.met); if(typeof L7 !== 'undefined') Object.entries(L7).forEach(([k, key]) => { backup['lectometro_' + k] = DB.get(key); }); if(typeof D7 !== 'undefined') Object.entries(D7).forEach(([k, key]) => { backup['diplomas_' + k] = DB.get(key); });
        backup._meta = { exportadoEl:new Date().toISOString(), sistema:'SIGIE', motivo:'Respaldo previo a generar datos de ejemplo' };
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type:'application/json;charset=utf-8;' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'respaldo_sigie_antes_de_datos_ejemplo_' + today() + '.json';
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        await esperar(600);
      }catch(e){ if(!confirm('No se pudo descargar el respaldo. ¿Continuar de todos modos?')) return; }
    }
    enCurso = true;
    try{
      ejProgreso('Preparando datos simulados…'); ejBarra(.02); await esperar(30);
      const ctx = {
        hoy:today(), anio:new Date().getFullYear(), uid:uid,
        bibCats:(typeof bibCats === 'function' && bibCats().length) ? bibCats() : BIB_SEED,
        categoriasDeprec:DB.get(KEYS.categoriasDeprec) || SEED_CATEGORIAS_DEPREC,
        lookupCategoria:lookupCategoriaDeprec,
        usuariosPrevios:DB.get(KEYS.usuarios) || [],
        totalesSIGIE:items => {
          const prev = DB.get(KEYS.items); DB.cache[KEYS.items] = items;
          try{ return calcularTotalesSIGIE(); } finally { DB.cache[KEYS.items] = prev; }
        },
        snapshotItems:items => items.map(i => ({
          id:i.id, codigoInterno:i.codigoInterno, codigoUsoInterno:i.codigoUsoInterno, codigoAnioAnterior:i.codigoAnioAnterior || '', denominacion:i.denominacion, codigoSBN:i.codigoSBN,
          marca:i.marca || '', modelo:i.modelo || '', numeroSerie:i.numeroSerie || '', color:i.color || '', estadoConservacion:i.estadoConservacion, situacion:i.situacion,
          aulaId:i.aulaId, aulaNombre:i.aulaNombre, custodioNombre:i.custodioNombre || '', valorAdquisicion:i.valorAdquisicion, fechaRegistro:i.fechaRegistro }))
      };
      const D = construirDatosEjemplo(ctx);
      const pasos = [];
      const S = (etiqueta, key, valor) => pasos.push([etiqueta, key, valor]);

      // imágenes de los planos (SVG como data URL, en la "carpeta" de imágenes)
      ejProgreso('Dibujando el plano del colegio…'); ejBarra(.06);
      for(const p of D.planos){
        p.imagenId = await guardarImagen('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(p._svg));
        delete p._svg;
      }

      // usuarios de ejemplo (la cuenta admin y las semilla del sistema se conservan)
      ejProgreso('Creando usuarios de ejemplo…'); ejBarra(.09);
      const usuarios = (DB.get(KEYS.usuarios) || []).map(u => Object.assign({}, u));
      const docenteSemilla = usuarios.find(u => u.usuario === 'docente');
      if(docenteSemilla) docenteSemilla.aulaIds = D.refs.aulasPri.slice(0, 3);
      const nuevosU = [
        ['secretaria', 'Secretaría de la I.E. (ejemplo)', 'ADMIN2', []], ['director', 'Director(a) — solo consulta (ejemplo)', 'CONSULTA', []],
        ['prof.quispe', 'Docente de Primaria 4° A (ejemplo)', 'DOCENTE', [D.refs.aulaPri4]], ['prof.vargas', 'Docente de Ciencias (ejemplo)', 'DOCENTE', [D.refs.aulaLab, D.refs.aulaInnov]]
      ];
      // Solo un ADMIN puede crear usuarios (el servidor lo exige): si quien genera es ADMIN2, se omiten.
      const puedeUsuarios = (typeof puedeGestionarUsuarios === 'function') ? !!puedeGestionarUsuarios() : true;
      for(const [usuario, nombre, rol, aulaIds] of (puedeUsuarios ? nuevosU : [])){
        if(usuarios.some(u => u.usuario === usuario)) continue;
        usuarios.push(Object.assign({ id:uid('usr'), usuario, nombre, rol, aulaIds, debeCambiarPass:false }, await prepararCredencialUsuario(CLAVE_USUARIOS_EJEMPLO)));
        D.bitacora.push({ id:uid('log'), fecha:new Date(Date.now() - 864e5 * 150).toISOString(), usuario:'admin', rol:'ADMIN', accion:'Crear usuario', detalle:'Usuario: ' + usuario + ' (' + rol + ')' });
      }
      D.bitacora.push({ id:uid('log'), fecha:new Date(Date.now() - 60000).toISOString(), usuario:(STATE.session && STATE.session.usuario) || 'admin', rol:(STATE.session && STATE.session.rol) || 'ADMIN', accion:'Generar datos de ejemplo', detalle:'Se cargaron datos simulados en todos los módulos.' });
      D.bitacora.sort((a, b) => a.fecha.localeCompare(b.fecha));
      if(D.bitacora.length > 3000) D.bitacora = D.bitacora.slice(D.bitacora.length - 3000);

      // configuración: se conservan el logo y los indicadores de migración para que NO se re-ejecuten
      const cfgPrev = DB.get(KEYS.config) || {};
      const cfg = Object.assign({}, DEFAULT_CONFIG, D.cfg, { logo:cfgPrev.logo || '', logoId:cfgPrev.logoId || '',
        migradoCodigoPatrimonialV2:true, normalizadoLaptopsV1:true, normalizadoCargadoresV1:true, normalizadoTabletasV1:true, backfillDeteccionSBNv1:true, datosEjemplo:true, datosEjemploFecha:today() });

      S('Datos de la institución', KEYS.config, cfg);
      S('Aulas y ambientes', KEYS.aulas, D.aulas); S('Personal / responsables', KEYS.custodios, D.custodios);
      S('Bienes patrimoniales', KEYS.items, D.items); S('Movimientos / kardex', KEYS.movs, D.movs);
      S('Correlativos', KEYS.seq, D.seqs.seq); S('Correlativos', KEYS.seqInterno, D.seqs.seqInterno); S('Correlativos', KEYS.seqPorSBN, D.seqs.seqPorSBN);
      S('Correlativos', KEYS.seqReq, D.seqs.seqReq); S('Correlativos', KEYS.seqBaja, D.seqs.seqBaja);
      S('Papelera', KEYS.papelera, D.papelera); S('Préstamos de bienes', KEYS.prestamos, D.prestamos);
      S('Mantenimientos y calibraciones', KEYS.mantenimientos, D.mantenimientos); S('Pólizas de seguro', KEYS.polizas, D.polizas);
      S('Requerimientos y órdenes de compra', KEYS.requerimientos, D.requerimientos); S('Bajas de bienes', KEYS.bajas, D.bajas);
      S('Almacén de consumibles', KEYS.consumibles, D.consumibles); S('Kardex de consumibles', KEYS.movsConsumibles, D.movsConsumibles);
      S('Presupuesto por fuente', KEYS.presupuestos, D.presupuestos); S('Comisión de inventario', KEYS.comision, D.comision);
      S('Conciliación contable', KEYS.conciliaciones, D.conciliaciones); S('Plano del colegio', KEYS.planos, D.planos);
      S('Tomas de inventario', KEYS.tomas, D.tomas); S('Comparativo interanual', KEYS.snapshots, D.snapshots);
      if(puedeUsuarios) S('Usuarios', KEYS.usuarios, usuarios);
      S('Biblioteca: categorías', BKEYS.cats, D.bib.cats); S('Biblioteca: libros', BKEYS.libros, D.bib.libros);
      S('Biblioteca: lectores', BKEYS.lect, D.bib.lectores); S('Biblioteca: préstamos', BKEYS.prest, D.bib.prest); S('Biblioteca: inventario por estante', BKEYS.tomas, D.bib.tomas);
      S('Biblioteca: reservas', B2.res, D.bib.res); S('Biblioteca: bajas', B2.baj, D.bib.baj); S('Biblioteca: reseñas', B5.res, D.bib.resenas);
      S('Biblioteca: lecturas por aula', B6.lec, D.bib.lecturas); S('Biblioteca: comprensión lectora', B6.cmp, D.bib.compr); S('Biblioteca: metas mensuales', B6.met, D.bib.metas); S('Biblioteca: sanciones', B6.san, D.bib.sanc);
      if(typeof L7 !== 'undefined' && D.bib.lectometro){ const Lm = D.bib.lectometro;
        S('Biblioteca: Lectómetro (bitácora)', L7.bit, Lm.bit); S('Biblioteca: evaluaciones', L7.quiz, Lm.quiz); S('Biblioteca: resultados de evaluaciones', L7.qres, Lm.qres);
        S('Biblioteca: premios', L7.prem, Lm.prem); S('Biblioteca: canjes', L7.canj, Lm.canj); S('Biblioteca: actividades del plan lector', L7.act, Lm.act); }

      // actas verificables (hash SHA-256 real de un contenido canónico simulado)
      const actas = [];
      for(const [tipo, refId, resumen, fecha] of D.actasDef){
        const hash = await sha256Hex(JSON.stringify({ tipo, refId, resumen, ejemplo:true }));
        actas.push({ id:uid('acta'), tipo, refId, fecha:new Date((fecha || today()) + 'T15:00:00Z').toISOString(), generadoPor:'Dirección (ejemplo)', resumen, hash });
      }
      S('Actas verificables', KEYS.actasFirmadas, actas);
      S('Bitácora de auditoría', KEYS.bitacora, D.bitacora);

      for(let i = 0; i < pasos.length; i++){
        ejProgreso('Guardando: ' + pasos[i][0] + '…'); ejBarra(.12 + .86 * (i / pasos.length));
        await DB.save(pasos[i][1], pasos[i][2], { reemplazar:true });
      }
      ejBarra(1);

      // estados de pantalla que podrían apuntar a datos que ya no existen
      STATE.planoActivoId = ''; STATE.planoModoEdicion = false; STATE.planoMoviendoId = ''; STATE.tomaEnCurso = null; STATE.qrSelection = new Set();
      if(typeof bibF !== 'undefined'){ bibF.q = ''; bibF.cat = ''; bibF.estado = ''; bibF.ubi = ''; }
      ejCerrarProgreso();
      enCurso = false;
      render();
      mostrarResumenEjemplo(D, usuarios);
    }catch(err){
      console.error('Error al generar datos de ejemplo:', err);
      ejCerrarProgreso(); enCurso = false;
      toast('No se pudieron generar los datos de ejemplo: ' + (err && err.message ? err.message : err), 'err');
    }
  }

  function mostrarResumenEjemplo(D, usuarios){
    const filas = [
      ['Libros (una fila por ejemplar, como la planilla)', D.bib.libros.length], ['Lectores con carné', D.bib.lectores.length],
      ['Préstamos de libros', D.bib.prest.length + ' (' + D.bib.prest.filter(p => !p.devuelto).length + ' sin devolver)'], ['Inventarios por estante', D.bib.tomas.length],
      ['Reservas de libros', D.bib.res.length + ' (' + D.bib.res.filter(r => r.estado === 'Espera').length + ' en espera)'], ['Bajas de libros', D.bib.baj.length],
      ['Aulas y ambientes', D.aulas.length], ['Personal / responsables', D.custodios.length], ['Bienes patrimoniales', D.items.length],
      ['Movimientos de kardex', D.movs.length], ['Préstamos de bienes', D.prestamos.length], ['Mantenimientos / calibraciones', D.mantenimientos.length],
      ['Requerimientos de compra', D.requerimientos.length], ['Expedientes de baja', D.bajas.length], ['Pólizas', D.polizas.length],
      ['Consumibles en almacén', D.consumibles.length], ['Bienes en papelera', D.papelera.length], ['Registros de bitácora', D.bitacora.length]
    ];
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = '<div class="modal" style="max-width:560px;"><div class="m-h"><h3>✅ Datos de ejemplo generados</h3><button class="close-x">&times;</button></div><div class="m-b">' +
      '<div class="tbl-wrap"><table><tbody>' + filas.map(f => '<tr><td>' + esc(f[0]) + '</td><td class="num"><b>' + esc(String(f[1])) + '</b></td></tr>').join('') + '</tbody></table></div>' +
      '<div class="note-banner" style="margin-top:12px;"><b>Usuarios de ejemplo</b> (contraseña: <span class="mono">' + CLAVE_USUARIOS_EJEMPLO + '</span>): <span class="mono">secretaria</span> (ADMIN2), <span class="mono">director</span> (CONSULTA), <span class="mono">prof.quispe</span> y <span class="mono">prof.vargas</span> (DOCENTE). Tu cuenta <span class="mono">admin</span> no se modificó.</div>' +
      '<div class="hint" style="margin-top:8px;">Todos los nombres, DNI, RUC, montos, certificados y expedientes son ficticios. Para volver a empezar desde cero usa "Reiniciar sistema" en Reportes.</div>' +
      '</div><div class="m-f"><button class="btn btn-primary" id="ejOk">Entendido</button></div></div>';
    document.body.appendChild(bg);
    const close = () => bg.remove();
    bg.querySelector('.close-x').onclick = close; bg.querySelector('#ejOk').onclick = close;
  }

  window.generarDatosEjemplo = generarDatosEjemplo;
  window.construirDatosEjemplo = construirDatosEjemplo; // expuesto para pruebas
})();
