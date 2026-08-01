// ============================================================================
// PolFin — Generador de datasets sintéticos argentinos (versión GRANDE)
// ----------------------------------------------------------------------------
// Reglas:
//  · REPRODUCIBLE: PRNG seedeado (mulberry32) + fecha de referencia FIJA.
//  · Los perfiles (estrella, thin file, moroso, intermedios) están DISEÑADOS
//    en los datos: el scoring los confirma calculando — nada hardcodeado.
//  · Una entidad puede ser acreedora Y deudora (la cadena entera se fía:
//    fábrica → distribuidora → mayorista → minorista → consumidor).
//  · ORDEN DE INSERCIÓN SAGRADO: primero los 13 comercios base y las 18
//    personas base (IDs 1–31, referenciados por la UI y los casos demo),
//    después las entidades nuevas. NO reordenar.
//  · GANCHO NARRATIVO: Marcela Benítez (id 14) NUNCA compra en el Corralón
//    Ovidio Lagos (id 7) → el caso del "comercio nuevo".
//  · Márgenes de la cadena ~20-25% y plazos por eslabón (7/15 fiado,
//    15/30/60 canal, 30/60/90 fábrica) están reflejados en montos y plazos.
// Correr con: npm run seed
// ============================================================================
import { rmSync, existsSync } from 'node:fs';
import { openDb, createSchema, DB_PATH } from './db.js';
import { calcularScore } from './scoring.js';
import { evaluarCredito } from './agente/agente.js';
import { ciclarMonitoreo } from './agente/agenteProactivo.js';

// ---------------------------------------------------------------- PRNG seedeado
const SEED = 20260801; // día de la hackathon
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const randInt = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const chance = (p) => rng() < p;
const redondear = (x) => Math.round(x / 500) * 500;
const hexSeeded = (n) => Array.from({ length: n }, () => '0123456789abcdef'[randInt(0, 15)]).join('');

// ------------------------------------------------------------- fechas (fijas)
const HOY_STR = '2026-08-01';
const HOY = new Date(`${HOY_STR}T00:00:00Z`);
const DIA_MS = 24 * 60 * 60 * 1000;
const addDays = (d, n) => new Date(d.getTime() + n * DIA_MS);
const fmt = (d) => d.toISOString().slice(0, 10);
const diasAtras = (n) => addDays(HOY, -n);

// ========================= ENTIDADES BASE (IDs 1–13, NO TOCAR EL ORDEN) =====
const COMERCIOS = [
  { clave: 'molinos',    nombre: 'Molinos del Litoral',              rol: 'fabrica',       rubro: 'Harinas y derivados',        barrio: 'Parque industrial', ciudad: 'San Lorenzo',             lat: -32.7456, lng: -60.7317 },
  { clave: 'pastas',     nombre: 'Fábrica de Pastas La Rosarina',    rol: 'fabrica',       rubro: 'Alimentos frescos',          barrio: 'Pichincha',         ciudad: 'Rosario',                 lat: -32.9376, lng: -60.6511 },
  { clave: 'parana',     nombre: 'Distribuidora de Bebidas El Paraná', rol: 'distribuidora', rubro: 'Bebidas y gaseosas',       barrio: 'Arroyito',          ciudad: 'Rosario',                 lat: -32.9098, lng: -60.6742 },
  { clave: 'ceres',      nombre: 'Distribuidora Ceres',              rol: 'distribuidora', rubro: 'Almacén por mayor',          barrio: 'Echesortu',         ciudad: 'Rosario',                 lat: -32.9394, lng: -60.6708 },
  { clave: 'vicente',    nombre: 'Mayorista Don Vicente',            rol: 'mayorista',     rubro: 'Alimentos y limpieza',       barrio: 'Mercado de Abasto', ciudad: 'Rosario',                 lat: -32.9645, lng: -60.6505 },
  { clave: 'dulce',      nombre: 'Golosinas Dulce Litoral',          rol: 'mayorista',     rubro: 'Golosinas y kiosco',         barrio: 'Centro',            ciudad: 'Rosario',                 lat: -32.9440, lng: -60.6420 },
  { clave: 'corralon',   nombre: 'Corralón Materiales Ovidio Lagos', rol: 'mayorista',     rubro: 'Materiales de construcción', barrio: 'Ovidio Lagos',      ciudad: 'Rosario',                 lat: -32.9702, lng: -60.6560 },
  { clave: 'ferreteria', nombre: 'Ferretería Sarmiento',             rol: 'minorista',     rubro: 'Ferretería',                 barrio: 'Centro',            ciudad: 'Rosario',                 lat: -32.9468, lng: -60.6393 },
  { clave: 'marta',      nombre: 'Almacén Doña Marta',               rol: 'minorista',     rubro: 'Almacén de barrio',          barrio: 'Barrio Belgrano',   ciudad: 'Rosario',                 lat: -32.9256, lng: -60.6989 },
  { clave: 'gringo',     nombre: 'Kiosco El Gringo',                 rol: 'minorista',     rubro: 'Kiosco',                     barrio: 'La Florida',        ciudad: 'Rosario',                 lat: -32.8869, lng: -60.6820 },
  { clave: 'pinos',      nombre: 'Minimercado Los Pinos',            rol: 'minorista',     rubro: 'Minimercado',                barrio: 'Centro',            ciudad: 'Funes',                   lat: -32.9150, lng: -60.8100 },
  { clave: 'cayetano',   nombre: 'Autoservicio San Cayetano',        rol: 'minorista',     rubro: 'Autoservicio',               barrio: 'Centro',            ciudad: 'Villa Gobernador Gálvez', lat: -33.0256, lng: -60.6280 },
  { clave: 'progreso',   nombre: 'Verdulería y Almacén El Progreso', rol: 'minorista',     rubro: 'Verdulería y almacén',       barrio: 'Centro',            ciudad: 'Granadero Baigorria',     lat: -32.8580, lng: -60.7110 },
];

// ==================== PERSONAS BASE (IDs 14–31, NO TOCAR EL ORDEN) ==========
const PERFILES = {
  estrella:   { puntual: 1.0,  adelanto: [0, 4],  atraso: [0, 0],   pImpaga: 0 },
  bueno:      { puntual: 0.9,  adelanto: [0, 2],  atraso: [1, 5],   pImpaga: 0 },
  regular:    { puntual: 0.65, adelanto: [0, 1],  atraso: [3, 15],  pImpaga: 0 },
  flojo:      { puntual: 0.45, adelanto: [0, 0],  atraso: [5, 25],  pImpaga: 0.06 },
  moroso:     { puntual: 0.2,  adelanto: [0, 0],  atraso: [10, 45], pImpaga: 0.18 },
  thin:       { puntual: 1.0,  adelanto: [0, 1],  atraso: [0, 0],   pImpaga: 0 },
};

const PERSONAS = [
  { clave: 'marcela',  nombre: 'Marcela Benítez',   perfil: 'estrella', comercios: ['marta', 'pinos', 'gringo', 'cayetano', 'ferreteria'], nTx: 26, mesesSpan: 24, notas: 'LA ESTRELLA — cero compras en el corralón.' },
  { clave: 'joaquin',  nombre: 'Joaquín Paz',       perfil: 'thin',     comercios: ['gringo'],                                             nTx: 4,  mesesSpan: 3,  notas: 'THIN FILE.' },
  { clave: 'ruben',    nombre: 'Rubén Alcaraz',     perfil: 'moroso',   comercios: ['marta', 'cayetano', 'progreso'],                      nTx: 15, mesesSpan: 20, notas: 'EL MOROSO.' },
  { clave: 'silvia',   nombre: 'Silvia Ferreyra',   perfil: 'bueno',    comercios: ['marta', 'pinos'],                                     nTx: 14, mesesSpan: 18 },
  { clave: 'diego',    nombre: 'Diego Maidana',     perfil: 'bueno',    comercios: ['ferreteria', 'corralon'],                             nTx: 10, mesesSpan: 16 },
  { clave: 'carina',   nombre: 'Carina López',      perfil: 'regular',  comercios: ['gringo', 'cayetano'],                                 nTx: 12, mesesSpan: 15 },
  { clave: 'oscar',    nombre: 'Oscar Villalba',    perfil: 'regular',  comercios: ['progreso', 'marta'],                                  nTx: 11, mesesSpan: 18 },
  { clave: 'natalia',  nombre: 'Natalia Giménez',   perfil: 'bueno',    comercios: ['pinos', 'gringo', 'marta'],                           nTx: 13, mesesSpan: 14 },
  { clave: 'hugo',     nombre: 'Hugo Pereyra',      perfil: 'flojo',    comercios: ['cayetano', 'progreso'],                               nTx: 10, mesesSpan: 16 },
  { clave: 'vanina',   nombre: 'Vanina Sosa',       perfil: 'bueno',    comercios: ['pinos', 'marta'],                                     nTx: 7,  mesesSpan: 7 },
  { clave: 'ariel',    nombre: 'Ariel Domínguez',   perfil: 'regular',  comercios: ['ferreteria', 'gringo'],                               nTx: 9,  mesesSpan: 13 },
  { clave: 'graciela', nombre: 'Graciela Mansilla', perfil: 'bueno',    comercios: ['marta'],                                              nTx: 16, mesesSpan: 22, notas: 'Buena pero MONO-COMERCIO.' },
  { clave: 'cristian', nombre: 'Cristian Ledesma',  perfil: 'flojo',    comercios: ['gringo', 'progreso'],                                 nTx: 9,  mesesSpan: 12 },
  { clave: 'romina',   nombre: 'Romina Aguirre',    perfil: 'bueno',    comercios: ['cayetano', 'pinos'],                                  nTx: 11, mesesSpan: 15 },
  { clave: 'jorge',    nombre: 'Jorge Barrios',     perfil: 'regular',  comercios: ['corralon', 'ferreteria'],                             nTx: 8,  mesesSpan: 14 },
  { clave: 'patricia', nombre: 'Patricia Coronel',  perfil: 'bueno',    comercios: ['marta', 'progreso', 'cayetano'],                      nTx: 15, mesesSpan: 23 },
  { clave: 'maxi',     nombre: 'Maximiliano Escobar', perfil: 'thin',   comercios: ['pinos', 'gringo'],                                    nTx: 5,  mesesSpan: 3 },
  { clave: 'elsa',     nombre: 'Elsa Quiroga',      perfil: 'bueno',    comercios: ['progreso', 'marta'],                                  nTx: 12, mesesSpan: 19 },
];

// ===================== ENTIDADES NUEVAS (IDs 32+, se insertan DESPUÉS) ======
const COMERCIOS_NUEVOS = [
  { clave: 'frigorifico', nombre: 'Frigorífico Paganini',              rol: 'fabrica',       rubro: 'Carnes y chacinados',   barrio: 'Zona industrial',  ciudad: 'Villa Gobernador Gálvez', lat: -33.0330, lng: -60.6350 },
  { clave: 'lactea',      nombre: 'Láctea del Sur Santafesino',        rol: 'fabrica',       rubro: 'Lácteos',               barrio: 'Ruta 33',          ciudad: 'Pérez',                   lat: -32.9980, lng: -60.7670 },
  { clave: 'limpiar',     nombre: 'Distribuidora Limpiar Rosario',     rol: 'distribuidora', rubro: 'Limpieza y perfumería', barrio: 'Ovidio Lagos sur', ciudad: 'Rosario',                 lat: -32.9850, lng: -60.6600 },
  { clave: 'lacteosdist', nombre: 'Lácteos y Fiambres del Oeste',      rol: 'distribuidora', rubro: 'Lácteos y fiambres',    barrio: 'Sorrento',         ciudad: 'Rosario',                 lat: -32.9300, lng: -60.6800 },
  { clave: 'tabacalera',  nombre: 'Distribuidora Tabacalera Rosario',  rol: 'distribuidora', rubro: 'Cigarrillos y kiosco',  barrio: 'Centro sur',       ciudad: 'Rosario',                 lat: -32.9550, lng: -60.6400 },
  { clave: 'papelera',    nombre: 'Papelera Mayorista Litoral',        rol: 'mayorista',     rubro: 'Papelería y descartables', barrio: 'Echesortu',     ciudad: 'Rosario',                 lat: -32.9400, lng: -60.6650 },
  { clave: 'bulonera',    nombre: 'Bulonera Mayorista San Martín',     rol: 'mayorista',     rubro: 'Bulonería y herrajes',  barrio: 'Av. San Martín',   ciudad: 'Rosario',                 lat: -32.9750, lng: -60.6400 },
  { clave: 'victoria',    nombre: 'Mayorista de Carnes La Victoria',   rol: 'mayorista',     rubro: 'Carnes por mayor',      barrio: 'Mercado de Abasto', ciudad: 'Rosario',                lat: -32.9660, lng: -60.6520 },
  { clave: 'esquina',     nombre: 'Almacén La Esquina',                rol: 'minorista',     rubro: 'Almacén de barrio',     barrio: 'Centro',           ciudad: 'Roldán',                  lat: -32.8990, lng: -60.9070 },
  { clave: 'kiosco25',    nombre: 'Kiosco 25 de Mayo',                 rol: 'minorista',     rubro: 'Kiosco',                barrio: 'Centro',           ciudad: 'Capitán Bermúdez',        lat: -32.8220, lng: -60.7190 },
  { clave: 'tere',        nombre: 'Despensa Lo de Tere',               rol: 'minorista',     rubro: 'Despensa',              barrio: 'Centro',           ciudad: 'Fray Luis Beltrán',       lat: -32.7890, lng: -60.7290 },
  { clave: 'novillo',     nombre: 'Carnicería El Novillo',             rol: 'minorista',     rubro: 'Carnicería',            barrio: 'Centro',           ciudad: 'Zavalla',                 lat: -33.0200, lng: -60.8770 },
  { clave: 'ferrurquiza', nombre: 'Ferretería Urquiza',                rol: 'minorista',     rubro: 'Ferretería',            barrio: 'Barrio Urquiza',   ciudad: 'Rosario',                 lat: -32.9400, lng: -60.7000 },
  { clave: 'tunel',       nombre: 'Almacén y Fiambrería El Túnel',     rol: 'minorista',     rubro: 'Almacén y fiambres',    barrio: 'Centro',           ciudad: 'Alvear',                  lat: -33.0620, lng: -60.6350 },
  { clave: 'parada',      nombre: 'Kiosco La Parada',                  rol: 'minorista',     rubro: 'Kiosco',                barrio: 'Centro',           ciudad: 'Pueblo Esther',           lat: -33.0700, lng: -60.5800 },
  { clave: 'ibarlucea',   nombre: 'Autoservicio Ibarlucea',            rol: 'minorista',     rubro: 'Autoservicio',          barrio: 'Centro',           ciudad: 'Ibarlucea',               lat: -32.8550, lng: -60.7800 },
];

// 30 consumidores nuevos: [nombre, perfil, comercios, nTx, mesesSpan]
const PERSONAS_NUEVAS = [
  ['Valeria Núñez', 'bueno', ['esquina', 'pinos', 'marta'], 14, 20],
  ['Marcos Herrera', 'estrella', ['esquina', 'kiosco25', 'tere', 'ibarlucea'], 22, 24],
  ['Lucía Cabrera', 'bueno', ['tere', 'esquina'], 12, 16],
  ['Ramón Ferreira', 'regular', ['novillo', 'marta'], 10, 14],
  ['Anahí Ríos', 'bueno', ['parada', 'tunel'], 11, 15],
  ['Gustavo Molina', 'moroso', ['esquina', 'tere', 'novillo'], 13, 18],
  ['Celeste Vera', 'bueno', ['kiosco25', 'parada'], 10, 12],
  ['Fabián Torres', 'regular', ['ibarlucea', 'esquina'], 12, 16],
  ['Karina Bustos', 'bueno', ['novillo', 'marta', 'tere'], 13, 19],
  ['Walter Godoy', 'flojo', ['tunel', 'parada'], 9, 14],
  ['Daniela Paredes', 'bueno', ['ibarlucea', 'pinos'], 12, 17],
  ['Sergio Luna', 'regular', ['gringo', 'kiosco25'], 9, 12],
  ['Mónica Arias', 'bueno', ['tere', 'esquina', 'ibarlucea'], 15, 22],
  ['Pablo Juárez', 'thin', ['esquina'], 4, 2],
  ['Rocío Medina', 'bueno', ['parada', 'cayetano'], 11, 14],
  ['Esteban Cardozo', 'regular', ['ferrurquiza', 'corralon'], 8, 15],
  ['Liliana Franco', 'bueno', ['novillo', 'tere'], 12, 18],
  ['Nahuel Ortiz', 'flojo', ['kiosco25', 'gringo'], 10, 13],
  ['Andrea Salinas', 'bueno', ['marta', 'esquina'], 12, 16],
  ['Claudio Romero', 'moroso', ['tunel', 'ibarlucea'], 12, 16],
  ['Florencia Gauna', 'bueno', ['pinos', 'parada'], 11, 15],
  ['Iván Peralta', 'regular', ['cayetano', 'novillo'], 10, 13],
  ['Susana Maldonado', 'bueno', ['tere', 'marta'], 13, 20],
  ['Leandro Acosta', 'regular', ['ferreteria', 'ferrurquiza'], 9, 14],
  ['Paola Vega', 'bueno', ['esquina', 'ibarlucea', 'parada'], 14, 21],
  ['Raúl Montiel', 'flojo', ['progreso', 'tunel'], 9, 13],
  ['Camila Soto', 'thin', ['parada', 'kiosco25'], 5, 3],
  ['Alfredo Leiva', 'regular', ['novillo', 'esquina'], 10, 15],
  ['Verónica Campos', 'bueno', ['ibarlucea', 'tere'], 12, 17],
  ['Matías Agüero', 'moroso', ['parada', 'esquina', 'gringo'], 12, 15],
].map(([nombre, perfil, comercios, nTx, mesesSpan], i) => ({
  clave: `pn${i + 1}`, nombre, perfil, comercios, nTx, mesesSpan,
}));

// ============== PERSONALIDAD DE PAGO B2B (cuando el comercio COMPRA) ========
const PERSONALIDAD_B2B = {
  pastas: PERFILES.bueno, parana: PERFILES.bueno, ceres: PERFILES.regular,
  vicente: PERFILES.bueno, dulce: PERFILES.regular, corralon: PERFILES.bueno,
  ferreteria: PERFILES.bueno, marta: PERFILES.estrella,
  gringo: PERFILES.flojo,
  pinos: PERFILES.estrella,   // caso demo: Los Pinos debe calificar muy bien
  cayetano: PERFILES.regular, progreso: PERFILES.flojo,
  // nuevos
  frigorifico: PERFILES.bueno, limpiar: PERFILES.bueno, lacteosdist: PERFILES.regular,
  tabacalera: PERFILES.bueno, papelera: PERFILES.bueno, bulonera: PERFILES.regular,
  victoria: PERFILES.bueno, esquina: PERFILES.bueno, kiosco25: PERFILES.regular,
  tere: PERFILES.bueno, novillo: PERFILES.regular, ferrurquiza: PERFILES.bueno,
  tunel: PERFILES.flojo, parada: PERFILES.regular, ibarlucea: PERFILES.bueno,
};

// ===================== RELACIONES B2B (montos coherentes por eslabón) =======
// fábrica→canal: $500k–$8M (volumen, 30/60/90) · canal→minorista: típicamente
// $50k–$900k (los autoservicios grandes compran $1,2M–$3,2M) · márgenes ~20-25%.
const EDGES_B2B = [
  // fábricas → canal
  { acreedor: 'molinos',     deudor: 'pastas',      freq: 0.85, monto: [2_000_000, 8_000_000], plazos: [30, 60],     conceptos: ['Harina 000 x bolsas 25kg', 'Harina 0000 y sémola — pedido mensual'] },
  { acreedor: 'molinos',     deudor: 'ceres',       freq: 0.6,  monto: [1_500_000, 6_000_000], plazos: [30, 60],     conceptos: ['Harinas y premezclas — reposición'] },
  { acreedor: 'pastas',      deudor: 'vicente',     freq: 0.7,  monto: [1_000_000, 5_000_000], plazos: [30, 60, 90], conceptos: ['Pastas frescas y tapas — pedido mayorista'] },
  { acreedor: 'pastas',      deudor: 'marta',       freq: 0.5,  monto: [150_000, 700_000],     plazos: [15, 30],     conceptos: ['Pastas frescas — entrega semanal'] },
  { acreedor: 'frigorifico', deudor: 'victoria',    freq: 0.8,  monto: [2_000_000, 8_000_000], plazos: [30, 60],     conceptos: ['Media res y chacinados — pedido semanal'] },
  { acreedor: 'frigorifico', deudor: 'novillo',     freq: 0.6,  monto: [700_000, 3_000_000],   plazos: [15, 30],     conceptos: ['Carne por mayor — pedido de carnicería'] },
  { acreedor: 'lactea',      deudor: 'lacteosdist', freq: 0.8,  monto: [1_500_000, 6_000_000], plazos: [30, 60],     conceptos: ['Quesos, yogures y leches — pedido de planta'] },
  // distribuidoras / mayoristas → minoristas
  { acreedor: 'parana',      deudor: 'gringo',      freq: 0.8,  monto: [150_000, 800_000],     plazos: [15, 30],     conceptos: ['Gaseosas y aguas — reposición semanal'] },
  { acreedor: 'parana',      deudor: 'pinos',       freq: 0.8,  monto: [1_200_000, 3_000_000], plazos: [15, 30],     conceptos: ['Bebidas y gaseosas — reposición'] },
  { acreedor: 'parana',      deudor: 'cayetano',    freq: 0.7,  monto: [900_000, 2_800_000],   plazos: [15, 30, 60], conceptos: ['Bebidas — pedido quincenal'] },
  { acreedor: 'parana',      deudor: 'esquina',     freq: 0.6,  monto: [150_000, 800_000],     plazos: [15, 30],     conceptos: ['Bebidas — reposición'] },
  { acreedor: 'parana',      deudor: 'parada',      freq: 0.5,  monto: [100_000, 500_000],     plazos: [15, 30],     conceptos: ['Gaseosas — reposición de kiosco'] },
  { acreedor: 'parana',      deudor: 'ibarlucea',   freq: 0.6,  monto: [200_000, 900_000],     plazos: [15, 30],     conceptos: ['Bebidas — pedido quincenal'] },
  { acreedor: 'parana',      deudor: 'tunel',       freq: 0.4,  monto: [100_000, 500_000],     plazos: [15, 30],     conceptos: ['Bebidas — reposición'] },
  { acreedor: 'ceres',       deudor: 'marta',       freq: 0.8,  monto: [200_000, 900_000],     plazos: [15, 30],     conceptos: ['Almacén seco — pedido quincenal', 'Conservas, fideos y aceites'] },
  { acreedor: 'ceres',       deudor: 'progreso',    freq: 0.6,  monto: [100_000, 600_000],     plazos: [15, 30],     conceptos: ['Almacén seco — reposición'] },
  { acreedor: 'ceres',       deudor: 'tere',        freq: 0.5,  monto: [100_000, 600_000],     plazos: [15, 30],     conceptos: ['Almacén seco — pedido'] },
  { acreedor: 'ceres',       deudor: 'esquina',     freq: 0.6,  monto: [120_000, 700_000],     plazos: [15, 30],     conceptos: ['Almacén seco — pedido quincenal'] },
  { acreedor: 'ceres',       deudor: 'ibarlucea',   freq: 0.5,  monto: [200_000, 900_000],     plazos: [15, 30],     conceptos: ['Almacén seco — pedido'] },
  { acreedor: 'ceres',       deudor: 'tunel',       freq: 0.5,  monto: [80_000, 450_000],      plazos: [15, 30],     conceptos: ['Almacén y fiambres — pedido'] },
  { acreedor: 'vicente',     deudor: 'pinos',       freq: 0.8,  monto: [1_200_000, 3_200_000], plazos: [30, 60],     conceptos: ['Alimentos y limpieza — pedido mensual'] },
  { acreedor: 'vicente',     deudor: 'cayetano',    freq: 0.75, monto: [900_000, 2_800_000],   plazos: [30, 60],     conceptos: ['Mercadería general — pedido mensual'] },
  { acreedor: 'vicente',     deudor: 'progreso',    freq: 0.5,  monto: [150_000, 800_000],     plazos: [15, 30],     conceptos: ['Alimentos — reposición'] },
  { acreedor: 'vicente',     deudor: 'ibarlucea',   freq: 0.6,  monto: [400_000, 1_800_000],   plazos: [30, 60],     conceptos: ['Mercadería general — pedido'] },
  { acreedor: 'vicente',     deudor: 'esquina',     freq: 0.5,  monto: [200_000, 900_000],     plazos: [15, 30],     conceptos: ['Alimentos y limpieza — pedido'] },
  { acreedor: 'dulce',       deudor: 'gringo',      freq: 0.85, monto: [100_000, 500_000],     plazos: [15, 30],     conceptos: ['Golosinas y cigarrillos — reposición semanal'] },
  { acreedor: 'dulce',       deudor: 'pinos',       freq: 0.3,  monto: [150_000, 600_000],     plazos: [15, 30],     conceptos: ['Golosinas — reposición'] },
  { acreedor: 'dulce',       deudor: 'parada',      freq: 0.5,  monto: [100_000, 500_000],     plazos: [15, 30],     conceptos: ['Golosinas — reposición de kiosco'] },
  { acreedor: 'dulce',       deudor: 'kiosco25',    freq: 0.5,  monto: [120_000, 600_000],     plazos: [15, 30],     conceptos: ['Golosinas — reposición'] },
  { acreedor: 'corralon',    deudor: 'ferreteria',  freq: 0.55, monto: [500_000, 2_500_000],   plazos: [30, 60],     conceptos: ['Hierro, cemento y áridos — pedido de obra'] },
  { acreedor: 'corralon',    deudor: 'ferrurquiza', freq: 0.5,  monto: [500_000, 2_500_000],   plazos: [30, 60],     conceptos: ['Materiales de obra — pedido'] },
  { acreedor: 'limpiar',     deudor: 'marta',       freq: 0.5,  monto: [100_000, 500_000],     plazos: [15, 30],     conceptos: ['Limpieza y perfumería — reposición'] },
  { acreedor: 'limpiar',     deudor: 'pinos',       freq: 0.3,  monto: [200_000, 900_000],     plazos: [15, 30],     conceptos: ['Limpieza — pedido'] },
  { acreedor: 'limpiar',     deudor: 'cayetano',    freq: 0.5,  monto: [250_000, 1_000_000],   plazos: [15, 30],     conceptos: ['Limpieza y perfumería — pedido'] },
  { acreedor: 'limpiar',     deudor: 'esquina',     freq: 0.4,  monto: [80_000, 450_000],      plazos: [15, 30],     conceptos: ['Limpieza — reposición'] },
  { acreedor: 'lacteosdist', deudor: 'marta',       freq: 0.6,  monto: [120_000, 700_000],     plazos: [15, 30],     conceptos: ['Lácteos y fiambres — entrega semanal'] },
  { acreedor: 'lacteosdist', deudor: 'pinos',       freq: 0.3,  monto: [300_000, 1_500_000],   plazos: [15, 30],     conceptos: ['Lácteos — pedido'] },
  { acreedor: 'lacteosdist', deudor: 'esquina',     freq: 0.5,  monto: [100_000, 600_000],     plazos: [15, 30],     conceptos: ['Lácteos y fiambres — pedido'] },
  { acreedor: 'lacteosdist', deudor: 'tere',        freq: 0.5,  monto: [80_000, 500_000],      plazos: [15, 30],     conceptos: ['Fiambres — entrega semanal'] },
  { acreedor: 'lacteosdist', deudor: 'ibarlucea',   freq: 0.5,  monto: [150_000, 800_000],     plazos: [15, 30],     conceptos: ['Lácteos — pedido'] },
  { acreedor: 'lacteosdist', deudor: 'tunel',       freq: 0.4,  monto: [80_000, 450_000],      plazos: [15, 30],     conceptos: ['Fiambres — pedido'] },
  { acreedor: 'tabacalera',  deudor: 'gringo',      freq: 0.7,  monto: [300_000, 1_200_000],   plazos: [15],         conceptos: ['Cigarrillos — reposición semanal'] },
  { acreedor: 'tabacalera',  deudor: 'kiosco25',    freq: 0.6,  monto: [200_000, 900_000],     plazos: [15],         conceptos: ['Cigarrillos — reposición'] },
  { acreedor: 'tabacalera',  deudor: 'parada',      freq: 0.5,  monto: [150_000, 700_000],     plazos: [15],         conceptos: ['Cigarrillos — reposición'] },
  { acreedor: 'papelera',    deudor: 'kiosco25',    freq: 0.4,  monto: [60_000, 300_000],      plazos: [15, 30],     conceptos: ['Descartables y papelería — pedido'] },
  { acreedor: 'papelera',    deudor: 'esquina',     freq: 0.4,  monto: [50_000, 250_000],      plazos: [15, 30],     conceptos: ['Descartables — reposición'] },
  { acreedor: 'bulonera',    deudor: 'ferreteria',  freq: 0.5,  monto: [400_000, 2_000_000],   plazos: [30, 60],     conceptos: ['Bulonería y herrajes — pedido'] },
  { acreedor: 'bulonera',    deudor: 'ferrurquiza', freq: 0.5,  monto: [300_000, 1_500_000],   plazos: [30, 60],     conceptos: ['Bulonería — pedido'] },
  { acreedor: 'victoria',    deudor: 'novillo',     freq: 0.6,  monto: [300_000, 1_500_000],   plazos: [15, 30],     conceptos: ['Carne — pedido semanal'] },
  { acreedor: 'victoria',    deudor: 'cayetano',    freq: 0.5,  monto: [500_000, 2_000_000],   plazos: [15, 30],     conceptos: ['Carne — pedido'] },
  { acreedor: 'victoria',    deudor: 'marta',       freq: 0.4,  monto: [200_000, 900_000],     plazos: [15, 30],     conceptos: ['Carne — pedido semanal'] },
];

// ======================= FIADO B2C (montos por rubro del comercio) ==========
const MONTOS_B2C = {
  marta:      { monto: [18_000, 120_000], plazos: [7, 15, 30],  conceptos: ['Fiado de almacén — compra semanal', 'Mercadería de la semana', 'Fiado — carne y almacén'] },
  gringo:     { monto: [8_000, 60_000],   plazos: [7, 15],      conceptos: ['Fiado de kiosco', 'Cigarrillos y golosinas — fiado'] },
  pinos:      { monto: [25_000, 120_000], plazos: [7, 15, 30],  conceptos: ['Compra de minimercado — fiado', 'Mercadería quincenal'] },
  cayetano:   { monto: [20_000, 120_000], plazos: [7, 15, 30],  conceptos: ['Compra de autoservicio — fiado', 'Mercadería de la semana'] },
  progreso:   { monto: [12_000, 90_000],  plazos: [7, 15],      conceptos: ['Verdulería y almacén — fiado semanal'] },
  ferreteria: { monto: [40_000, 450_000], plazos: [15, 30, 60], conceptos: ['Herramientas y materiales — cuenta corriente'] },
  corralon:   { monto: [80_000, 700_000], plazos: [30, 60],     conceptos: ['Materiales de obra — cuenta corriente'] },
  esquina:    { monto: [15_000, 110_000], plazos: [7, 15, 30],  conceptos: ['Fiado de almacén — compra semanal'] },
  kiosco25:   { monto: [8_000, 60_000],   plazos: [7, 15],      conceptos: ['Fiado de kiosco'] },
  tere:       { monto: [12_000, 95_000],  plazos: [7, 15],      conceptos: ['Fiado de despensa — la libreta de siempre'] },
  novillo:    { monto: [20_000, 130_000], plazos: [7, 15],      conceptos: ['Carne — fiado semanal'] },
  ferrurquiza: { monto: [40_000, 450_000], plazos: [15, 30, 60], conceptos: ['Ferretería — cuenta corriente'] },
  tunel:      { monto: [12_000, 90_000],  plazos: [7, 15],      conceptos: ['Fiado de almacén'] },
  parada:     { monto: [8_000, 70_000],   plazos: [7, 15],      conceptos: ['Fiado de kiosco'] },
  ibarlucea:  { monto: [20_000, 150_000], plazos: [7, 15, 30],  conceptos: ['Compra de autoservicio — fiado'] },
};

// ============================================== MACRO (referencia plausible)
const MACRO = [
  { mes: '2026-02', inflacion: 2.4, tc: 1385, tasa: 33.0 },
  { mes: '2026-03', inflacion: 2.2, tc: 1410, tasa: 32.0 },
  { mes: '2026-04', inflacion: 2.0, tc: 1440, tasa: 31.0 },
  { mes: '2026-05', inflacion: 1.9, tc: 1460, tasa: 30.0 },
  { mes: '2026-06', inflacion: 1.8, tc: 1480, tasa: 29.5 },
  { mes: '2026-07', inflacion: 1.8, tc: 1505, tasa: 29.0 },
];

// ============================================================== GENERACIÓN
function generarPago(fechaVenc, perfil) {
  if (chance(perfil.pImpaga)) return { fechaPago: null, estado: 'vencida' };
  let offsetDias;
  if (chance(perfil.puntual)) offsetDias = -randInt(perfil.adelanto[0], perfil.adelanto[1]);
  else offsetDias = randInt(perfil.atraso[0], perfil.atraso[1]);
  const fechaPago = addDays(fechaVenc, offsetDias);
  if (fechaPago >= HOY) return { fechaPago: null, estado: 'vencida' };
  return { fechaPago, estado: 'pagada' };
}

function generarTx({ acreedorId, deudorId, fechaEmision, plazo, monto, concepto, perfil }) {
  const fechaVenc = addDays(fechaEmision, plazo);
  let fechaPago = null;
  let estado;
  if (fechaVenc >= HOY) estado = 'pendiente';
  else ({ fechaPago, estado } = generarPago(fechaVenc, perfil));
  return {
    acreedor_id: acreedorId, deudor_id: deudorId, monto: redondear(monto), concepto,
    fecha_emision: fmt(fechaEmision), plazo_dias: plazo, fecha_vencimiento: fmt(fechaVenc),
    fecha_pago_real: fechaPago ? fmt(fechaPago) : null, estado,
  };
}

export async function sembrar() {
  if (existsSync(DB_PATH)) rmSync(DB_PATH);
  ['-journal', '-wal', '-shm'].forEach((s) => { if (existsSync(DB_PATH + s)) rmSync(DB_PATH + s); });
  const db = openDb();
  createSchema(db);

  // --- entidades (ORDEN SAGRADO: base primero → IDs estables 1–31) ---------
  const insCom = db.prepare(`
    INSERT INTO entidades (nombre, tipo, rol_cadena, rubro, barrio, ciudad, lat, lng, adherido)
    VALUES (?, 'comercio', ?, ?, ?, ?, ?, ?, 1)`);
  const insPer = db.prepare(`
    INSERT INTO entidades (nombre, tipo, rol_cadena, rubro, barrio, ciudad, lat, lng, adherido)
    VALUES (?, 'persona', NULL, NULL, NULL, 'Rosario', NULL, NULL, 1)`);
  const ids = {};
  for (const c of COMERCIOS) ids[c.clave] = Number(insCom.run(c.nombre, c.rol, c.rubro, c.barrio, c.ciudad, c.lat, c.lng).lastInsertRowid);
  for (const p of PERSONAS) ids[p.clave] = Number(insPer.run(p.nombre).lastInsertRowid);
  for (const c of COMERCIOS_NUEVOS) ids[c.clave] = Number(insCom.run(c.nombre, c.rol, c.rubro, c.barrio, c.ciudad, c.lat, c.lng).lastInsertRowid);
  for (const p of PERSONAS_NUEVAS) ids[p.clave] = Number(insPer.run(p.nombre).lastInsertRowid);

  // --- transacciones ---------------------------------------------------------
  const txs = [];

  // B2B: 24 meses, frecuencia completa por relación
  for (const edge of EDGES_B2B) {
    const perfil = PERSONALIDAD_B2B[edge.deudor];
    for (let mes = 24; mes >= 1; mes--) {
      if (!chance(edge.freq)) continue;
      const fecha = diasAtras(mes * 30 - randInt(0, 27));
      if (fecha >= HOY) continue;
      txs.push(generarTx({
        acreedorId: ids[edge.acreedor], deudorId: ids[edge.deudor],
        fechaEmision: fecha, plazo: pick(edge.plazos),
        monto: randInt(edge.monto[0], edge.monto[1]), concepto: pick(edge.conceptos), perfil,
      }));
    }
    // COMPRAS VIVAS garantizadas: cada eslabón tiene una reposición reciente
    // sin vencer → "Le compro a" nunca queda vacío en ningún rol.
    txs.push(generarTx({
      acreedorId: ids[edge.acreedor], deudorId: ids[edge.deudor],
      fechaEmision: diasAtras(randInt(2, 12)),
      plazo: Math.max(30, pick(edge.plazos)),
      monto: randInt(edge.monto[0], edge.monto[1]),
      concepto: pick(edge.conceptos), perfil: PERSONALIDAD_B2B[edge.deudor],
    }));
  }

  // B2C: fiado de todas las personas según su perfil diseñado
  for (const p of [...PERSONAS, ...PERSONAS_NUEVAS]) {
    const perfil = PERFILES[p.perfil];
    const spanDias = p.mesesSpan * 30;
    for (let i = 0; i < p.nTx; i++) {
      const comercio = pick(p.comercios);
      const cfg = MONTOS_B2C[comercio];
      txs.push(generarTx({
        acreedorId: ids[comercio], deudorId: ids[p.clave],
        fechaEmision: diasAtras(randInt(2, spanDias)),
        plazo: pick(cfg.plazos), monto: randInt(cfg.monto[0], cfg.monto[1]),
        concepto: pick(cfg.conceptos), perfil,
      }));
    }
  }

  // casos diseñados: la estrella con deuda viva sana / el moroso con vencida visible
  txs.push(generarTx({
    acreedorId: ids.marta, deudorId: ids.marcela, fechaEmision: diasAtras(4),
    plazo: 15, monto: 86_000, concepto: 'Fiado de almacén — compra semanal', perfil: PERFILES.estrella,
  }));
  txs.push(generarTx({
    acreedorId: ids.cayetano, deudorId: ids.ruben, fechaEmision: diasAtras(50),
    plazo: 15, monto: 148_000, concepto: 'Mercadería de la semana', perfil: PERFILES.moroso,
  }));

  txs.sort((a, b) => a.fecha_emision.localeCompare(b.fecha_emision));
  const insTx = db.prepare(`
    INSERT INTO transacciones
      (acreedor_id, deudor_id, monto, concepto, fecha_emision, plazo_dias, fecha_vencimiento, fecha_pago_real, estado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.exec('BEGIN');
  for (const t of txs) {
    insTx.run(t.acreedor_id, t.deudor_id, t.monto, t.concepto, t.fecha_emision,
      t.plazo_dias, t.fecha_vencimiento, t.fecha_pago_real, t.estado);
  }
  db.exec('COMMIT');

  // --- casos para el monitor de Ángela ---------------------------------------
  // Buenos pagadores CERCA DE SU LÍMITE (oportunidad de ampliación): se les
  // completa deuda viva hasta ~65% del límite que CALCULA el motor — no se
  // hardcodea el score, se siembra deuda relativa al límite real.
  for (const clave of ['marcela', 'patricia', 'pn2' /* Marcos Herrera */]) {
    const s = calcularScore(db, ids[clave]);
    const limite = s?.condiciones?.limite_sugerido_pesos ?? 0;
    if (!s?.score || s.score < 700 || !limite) continue;
    const viva = db.prepare(
      "SELECT COALESCE(SUM(monto),0) v FROM transacciones WHERE deudor_id = ? AND estado = 'pendiente'"
    ).get(ids[clave]).v;
    const falta = Math.round(0.66 * limite) - viva;
    if (falta > 15_000) {
      const comercio = { marcela: 'marta', patricia: 'marta', pn2: 'esquina' }[clave];
      insTx.run(ids[comercio], ids[clave], redondear(falta),
        'Fiado de almacén — compra quincenal', fmt(diasAtras(3)), 15,
        fmt(addDays(diasAtras(3), 15)), null, 'pendiente');
    }
  }

  // e-Pagarés con VENCIMIENTO CERCANO: el monitoreo dispara con ventana de
  // 7 días sin trucos (emitidos semanas atrás en la ficción del dataset).
  const insInstr = db.prepare(`
    INSERT INTO instrumentos
      (solicitud_id, deudor_id, acreedor_id, monto, tasa_tna, plazo_dias,
       fecha_vencimiento, estado, contrato_address, tx_hash, red)
    VALUES (NULL, ?, ?, ?, ?, ?, ?, 'activo', ?, ?, 'fuji-mock')`);
  insInstr.run(ids.cayetano, ids.vicente, 1_850_000, 34, 60, fmt(addDays(HOY, 3)),
    '0x' + hexSeeded(40), '0x' + hexSeeded(64));
  insInstr.run(ids.gringo, ids.parana, 640_000, 41, 30, fmt(addDays(HOY, 6)),
    '0x' + hexSeeded(40), '0x' + hexSeeded(64));

  // OPERACIÓN PENDIENTE DE ACEPTAR por el consumidor: Marcela (id 14) presentó
  // su score en el Corralón (comercio nuevo) y le fiaron — le llega el e-pagaré
  // para aceptar desde su lado. aceptado=0. (El resto de instrumentos quedan
  // aceptado=1 por el DEFAULT de la migración.)
  const insInstrPend = db.prepare(`
    INSERT INTO instrumentos
      (solicitud_id, deudor_id, acreedor_id, monto, tasa_tna, plazo_dias,
       fecha_vencimiento, estado, contrato_address, tx_hash, red, aceptado)
    VALUES (NULL, ?, ?, ?, ?, ?, ?, 'activo', ?, ?, 'fuji-mock', 0)`);
  insInstrPend.run(ids.marcela, ids.corralon, 180_000, 29, 90, fmt(addDays(HOY, 90)),
    '0x' + hexSeeded(40), '0x' + hexSeeded(64));

  // --- pagos parciales sobre deudas VIVAS (reproducibles) --------------------
  // Para que "cuánto falta" sea real: algunas deudas vivas quedan a medio pagar,
  // otras al 80%, otras recién empezadas, la mayoría sin tocar. El progreso que
  // muestra la vista de Pagos sale de esta tabla, no de un % inventado.
  const insPago = db.prepare(`
    INSERT INTO pagos (transaccion_id, monto, fecha, metodo, comprobante)
    VALUES (?, ?, ?, ?, ?)`);
  const vivas = db.prepare(
    "SELECT id, monto, fecha_emision FROM transacciones WHERE estado = 'pendiente' ORDER BY id"
  ).all();
  const metodos = ['transferencia', 'efectivo', 'mercado_pago'];
  let nParciales = 0;
  for (const t of vivas) {
    const r = rng();
    // ~45% de las deudas vivas tienen algún pago parcial; el resto arranca en 0
    let frac = 0;
    if (r < 0.15) frac = randInt(20, 40) / 100;       // a medio empezar
    else if (r < 0.30) frac = randInt(45, 65) / 100;  // a mitad de camino
    else if (r < 0.45) frac = randInt(75, 90) / 100;  // casi saldada
    if (frac === 0) continue;
    const monto = redondear(t.monto * frac);
    if (monto < 1000 || monto >= t.monto) continue;   // dejar saldo vivo real
    const fecha = fmt(addDays(new Date(`${t.fecha_emision}T00:00:00Z`), randInt(3, 20)));
    insPago.run(t.id, monto, fecha <= HOY_STR ? fecha : HOY_STR,
      pick(metodos), 'PF-SEED-' + t.id.toString(36).toUpperCase());
    nParciales++;
  }

  // --- macro ------------------------------------------------------------------
  const insMacro = db.prepare(`
    INSERT INTO macro_referencia (mes, inflacion_mensual_pct, tipo_cambio_oficial, tasa_referencia_tna, nota)
    VALUES (?, ?, ?, ?, ?)`);
  for (const m of MACRO) {
    insMacro.run(m.mes, m.inflacion, m.tc, m.tasa,
      'Valor de referencia plausible — VERIFICAR cifra real cerca de la fecha del evento');
  }

  // ============================ SANITY CHECK ================================
  const nEnt = db.prepare('SELECT COUNT(*) n FROM entidades').get().n;
  const nTx = db.prepare('SELECT COUNT(*) n FROM transacciones').get().n;
  const porRol = db.prepare(`
    SELECT COALESCE(rol_cadena, 'consumidor final') rol, COUNT(*) n
    FROM entidades GROUP BY rol_cadena ORDER BY n DESC`).all();
  const estados = db.prepare(`SELECT estado, COUNT(*) n FROM transacciones GROUP BY estado`).all();

  console.log(`\nPolFin seed OK → ${DB_PATH}`);
  console.log(`Seed: ${SEED} · Fecha de referencia: ${HOY_STR} (fija, reproducible)`);
  console.log(`Entidades: ${nEnt} · Transacciones: ${nTx} · ${estados.map((e) => `${e.n} ${e.estado}s`).join(' · ')}`);
  console.table(porRol);

  // montos por eslabón
  const eslabones = db.prepare(`
    SELECT CASE
        WHEN a.rol_cadena = 'fabrica' THEN 'fábrica → canal'
        WHEN d.tipo = 'comercio' THEN 'canal → minorista'
        ELSE 'fiado a consumidor'
      END eslabon,
      COUNT(*) n, MIN(t.monto) minimo, CAST(AVG(t.monto) AS INT) promedio, MAX(t.monto) maximo
    FROM transacciones t
    JOIN entidades a ON a.id = t.acreedor_id
    JOIN entidades d ON d.id = t.deudor_id
    GROUP BY eslabon`).all();
  console.log('Montos por eslabón de la cadena:');
  console.table(eslabones.map((e) => ({
    eslabon: e.eslabon, tx: e.n,
    min: '$' + e.minimo.toLocaleString('es-AR'),
    promedio: '$' + e.promedio.toLocaleString('es-AR'),
    max: '$' + e.maximo.toLocaleString('es-AR'),
  })));

  // perfiles diseñados: el motor los confirma calculando
  console.log('Perfiles diseñados (calculados por el motor, no hardcodeados):');
  for (const [clave, esperado] of [
    ['marcela', 'estrella ~900+ (5 comercios, 0 corralón)'],
    ['ruben', 'moroso <400'],
    ['joaquin', 'thin file ~400-550 (amortiguado)'],
    ['graciela', 'buena mono-comercio (clara brecha vs Marcela)'],
  ]) {
    const s = calcularScore(db, ids[clave]);
    console.log(`  ${s.entidad.nombre.padEnd(22)} score ${String(s.score).padStart(3)} · ${s.condiciones.riesgo.padEnd(9)} · límite $${s.condiciones.limite_sugerido_pesos.toLocaleString('es-AR')}  [esperado: ${esperado}]`);
  }
  const corralonTx = db.prepare('SELECT COUNT(*) n FROM transacciones WHERE deudor_id = ? AND acreedor_id = ?')
    .get(ids.marcela, ids.corralon).n;
  console.log(`  Marcela en el Corralón: ${corralonTx} tx (debe ser 0 — el comercio nuevo)`);

  // caso Los Pinos: el motor debe aprobar $2.5M (límite suficiente)
  const pinos = calcularScore(db, ids.pinos);
  console.log(`  Los Pinos (caso $2,5M):  score ${pinos.score} · ${pinos.condiciones.riesgo} · límite $${pinos.condiciones.limite_sugerido_pesos.toLocaleString('es-AR')} ${pinos.condiciones.limite_sugerido_pesos >= 2_500_000 ? '✓ banca los $2.500.000' : '✗ AJUSTAR: no banca $2,5M'}`);

  // uso del límite (material del monitor: ampliación)
  console.log('Cerca del límite (material para la detección de ampliación):');
  for (const clave of ['marcela', 'patricia', 'pn2']) {
    const s = calcularScore(db, ids[clave]);
    const viva = db.prepare("SELECT COALESCE(SUM(monto),0) v FROM transacciones WHERE deudor_id = ? AND estado='pendiente'").get(ids[clave]).v;
    const lim = s.condiciones.limite_sugerido_pesos;
    console.log(`  ${s.entidad.nombre.padEnd(22)} usa ${Math.round((100 * viva) / lim)}% de su límite ($${viva.toLocaleString('es-AR')} de $${lim.toLocaleString('es-AR')})`);
  }

  // "Le compro a" vivo en todos los eslabones
  const vivasPorComercio = db.prepare(`
    SELECT e.nombre, COUNT(*) vivas FROM transacciones t
    JOIN entidades e ON e.id = t.deudor_id
    WHERE e.tipo = 'comercio' AND t.estado = 'pendiente'
    GROUP BY t.deudor_id ORDER BY vivas DESC`).all();
  const sinVivas = db.prepare(`
    SELECT COUNT(*) n FROM entidades e WHERE e.tipo = 'comercio'
    AND e.rol_cadena != 'fabrica'
    AND e.id IN (SELECT DISTINCT deudor_id FROM transacciones)
    AND e.id NOT IN (SELECT deudor_id FROM transacciones WHERE estado = 'pendiente')`).get().n;
  console.log(`"Le compro a" con deuda viva: ${vivasPorComercio.length} comercios (${sinVivas} compradores sin vivas — debe ser 0)`);

  const instr = db.prepare("SELECT COUNT(*) n FROM instrumentos WHERE julianday(fecha_vencimiento) - julianday('now') <= 7").get().n;
  console.log(`e-Pagarés venciendo en ≤7 días (para el monitor): ${instr}`);

  const pagosSeed = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(monto),0) m FROM pagos').get();
  console.log(`Pagos parciales sembrados: ${pagosSeed.n} sobre deudas vivas ($${pagosSeed.m.toLocaleString('es-AR')} ya cobrado a cuenta)`);

  // Historial de decisiones/aprobaciones/monitoreo: corre el pipeline REAL para
  // que CUALQUIER instalación limpia (incluido Render) arranque con las pantallas
  // pobladas y la demo lista. El pipeline es async (borde on-chain), así que se
  // espera antes de cerrar la DB. Ver sembrarHistorial().
  await sembrarHistorial(db);

  db.close();
}

// ---------------------------------------------------------------------------
// Historial inicial vía el pipeline DETERMINÍSTICO (no LLM). Deja sembrado, de
// forma coherente y sin auto-ejecutar lo que requiere aprobación:
//   · Decisiones/Aprobaciones: solicitudes ya procesadas (aprobadas+ejecutadas
//     y alguna rechazada) + pendientes esperando OK (gate por monto + propuestas
//     proactivas de Ángela).
//   · e-Pagarés, scores on-chain, notificaciones, auditoría y detecciones que
//     esas mismas corridas generan.
// No toca `transacciones` ni `pagos`, así que scores, saldos y totales no cambian.
// Cada caso va en try/catch: si uno falla, el seed base sigue en pie (el backend
// nunca queda sin arrancar por esto).
// ---------------------------------------------------------------------------
async function sembrarHistorial(db) {
  const evaluar = async (deudorId, acreedorId, monto, contexto, origen = 'directa') => {
    try {
      return await evaluarCredito(db, { deudorId, acreedorId, monto, contexto, origen });
    } catch (e) {
      console.error(`[seed:historial] caso ${deudorId}→${acreedorId} ($${monto}) falló: ${e.message}`);
      return null;
    }
  };

  // --- Casos narrativos (IDs base estables) --------------------------------
  // Aprobada y ejecutada: Marcela presenta su score en el Corralón (comercio
  // nuevo). Monto < límite y < límite autónomo → COMPLETADO directo.
  await evaluar(14, 7, 180000, 'Marcela Benítez presentó su score en el Corralón Ovidio Lagos (comercio nuevo)');
  // Rechazada: Rubén (moroso) pide más de lo que su score banca → RECHAZADA.
  await evaluar(16, 9, 120000, 'Rubén Alcaraz pidió fiado en Almacén Doña Marta');
  // Pendiente de aprobación: Los Pinos pide una reposición grande que supera el
  // límite autónomo del agente ($500k) pero entra en su límite → gate humano.
  await evaluar(11, 3, 2500000, 'Minimercado Los Pinos pidió reposición grande a El Paraná');

  // --- Movimiento: algunas aprobadas más de buenos pagadores ---------------
  // Fiados chicos (dentro del límite y del autónomo) → COMPLETADO. Elegidos por
  // score real sobre un comercio donde el cliente YA opera (relación existente).
  const candidatos = db.prepare(`
    SELECT t.deudor_id AS d, t.acreedor_id AS a, COUNT(*) AS n
    FROM transacciones t JOIN entidades e ON e.id = t.deudor_id
    WHERE e.tipo = 'persona' AND t.deudor_id <> 14 AND t.deudor_id <> 16
    GROUP BY t.deudor_id
    ORDER BY t.deudor_id
  `).all();
  let aprobadasExtra = 0;
  for (const c of candidatos) {
    if (aprobadasExtra >= 3) break;
    const s = calcularScore(db, c.d);
    if (!s?.score || s.score < 680) continue;
    const limite = s.condiciones.limite_sugerido_pesos;
    if (!limite) continue;
    // ~30% del límite, redondeado, topeado bien por debajo del límite autónomo
    // → garantiza dentro_del_limite y ejecución directa (COMPLETADO).
    const monto = Math.max(20000, Math.min(Math.round((limite * 0.3) / 1000) * 1000, 250000));
    const r = await evaluar(c.d, c.a, monto, 'Fiado de mostrador aprobado por el motor');
    if (r?.estado === 'aprobada') aprobadasExtra++;
  }

  // --- Ángela proactiva: propuestas de ampliación pendientes + detecciones ---
  // Un ciclo del monitor deja: ampliaciones (origen='proactiva', PENDIENTE_
  // APROBACION — nunca auto-ejecutadas), avisos de atraso fuera de patrón y
  // vencimientos próximos → alimenta Aprobaciones, notificaciones y auditoría.
  try {
    await ciclarMonitoreo(db, {});
  } catch (e) {
    console.error(`[seed:historial] monitor proactivo: ${e.message}`);
  }

  const resumen = db.prepare('SELECT estado, COUNT(*) n FROM solicitudes_credito GROUP BY estado').all();
  const det = db.prepare('SELECT COUNT(*) n FROM detecciones').get().n;
  const aud = db.prepare('SELECT COUNT(*) n FROM auditoria').get().n;
  console.log(
    `Historial sembrado → solicitudes: ${resumen.map((r) => `${r.estado} ${r.n}`).join(', ')} · ` +
    `detecciones ${det} · auditoría ${aud} entradas`
  );
}

// Ejecutado directo (`npm run seed`) siembra SIEMPRE desde cero. Importado por
// el server (auto-seed en arranque), NO se auto-ejecuta: el server decide.
// sembrar() es async (borde on-chain del pipeline): esperamos y salimos con
// código de error si falla, para que `npm run seed` no mienta.
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/seed.js')) {
  sembrar().catch((e) => { console.error('seed falló:', e); process.exit(1); });
}
