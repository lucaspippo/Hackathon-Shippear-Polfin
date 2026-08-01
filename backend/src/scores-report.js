// Reporte de scores por consola: corre el motor sobre TODOS los deudores y
// muestra el ranking + el detalle de los perfiles diseñados. Sirve para
// verificar que el motor cuenta la historia que la demo necesita.
// Correr con: npm run scores  (desde backend/)
import { openDb } from './db.js';
import { calcularScore } from './scoring.js';

const db = openDb();

const ids = db.prepare(`
  SELECT DISTINCT e.id FROM entidades e
  JOIN transacciones t ON t.deudor_id = e.id
`).all();

const todos = ids
  .map((r) => calcularScore(db, r.id))
  .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

console.log('\n=== PolFin · Motor de scoring — ranking de la red ===\n');
console.table(todos.map((s) => ({
  deudor: s.entidad.nombre,
  tipo: s.entidad.tipo,
  score: s.score,
  riesgo: s.condiciones.riesgo,
  'tasa TNA': s.condiciones.tasa_sugerida_tna !== null ? s.condiciones.tasa_sugerida_tna + '%' : 'rechazo',
  'plazo máx': s.condiciones.plazo_max_dias + ' d',
  'límite': '$' + s.condiciones.limite_sugerido_pesos.toLocaleString('es-AR'),
  '% puntual': s.metricas.pct_puntual !== null ? s.metricas.pct_puntual + '%' : '—',
  'com. buenos': s.metricas.comercios_con_buen_comportamiento,
})));

const DISENADOS = [
  ['Marcela Benítez', 'LA ESTRELLA (portable: 5 comercios)'],
  ['Graciela Mansilla', 'BUENA PERO MONO-COMERCIO (contraste de portabilidad)'],
  ['Joaquín Paz', 'THIN FILE (poco historial)'],
  ['Rubén Alcaraz', 'EL MOROSO'],
];
console.log('=== Detalle de los perfiles diseñados ===');
for (const [nombre, etiqueta] of DISENADOS) {
  const s = todos.find((x) => x.entidad.nombre === nombre);
  console.log(`\n— ${etiqueta} —`);
  console.log(`${s.entidad.nombre}: SCORE ${s.score} (${s.condiciones.riesgo})`);
  for (const d of s.desglose) {
    console.log(`  ${d.factor.padEnd(12)} ${String(d.aporte).padStart(3)}/${d.maximo}  ${d.detalle}`);
  }
  console.log(`  → ${s.condiciones.decision}` +
    (s.condiciones.tasa_sugerida_tna !== null
      ? ` · tasa ${s.condiciones.tasa_sugerida_tna}% TNA (base ${s.condiciones.tasa_base_tna}% + ${s.condiciones.recargo_pp}pp)`
      : ''));
  console.log(`  "${s.explicacion}"`);
}

const marcela = todos.find((x) => x.entidad.nombre === 'Marcela Benítez');
const graciela = todos.find((x) => x.entidad.nombre === 'Graciela Mansilla');
console.log(`\n=== Chequeo de portabilidad (el corazón de PolFin) ===`);
console.log(`Marcela (5 comercios): ${marcela.score} · Graciela (1 comercio): ${graciela.score} · brecha: ${marcela.score - graciela.score} puntos`);
db.close();
