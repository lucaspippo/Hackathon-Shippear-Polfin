// ============================================================================
// verificar-gateway.mjs — La prueba mínima OBLIGATORIA de tool use.
// ----------------------------------------------------------------------------
// Corre el caso conversacional de Marcela DE PUNTA A PUNTA con el provider que
// diga LLM_MODE (mock | anthropic | gateway):
//   texto → extracción por tool use → pipeline determinístico → verbalización.
//
// Comprueba que el provider extrajo EXACTO {deudorId:14, acreedorId:7,
// monto:180000} (Marcela Benítez pide en el Corralón Ovidio Lagos), que el
// pipeline corrió, y que salió una verbalización. Con LLM_MODE=gateway esto
// valida que el tool use forzado se comporta igual que con el provider directo.
//
// Uso:  npm run verificar:gateway         (carga backend/.env)
//   o:  node --env-file-if-exists=.env src/verificar-gateway.mjs
// Para forzar un modo puntual:  LLM_MODE=mock npm run verificar:gateway
// ============================================================================
import { existsSync } from 'node:fs';
import { openDb, createSchema, DB_PATH } from './db.js';
import { conversar } from './agente/agente.js';

const TEXTO = 'Fijate si le podemos fiar $180.000 a Marcela Benítez en el Corralón Ovidio Lagos';
const ESPERADO = { deudorId: 14, acreedorId: 7, monto: 180000 }; // Marcela=14, Corralón=7

const modo = (process.env.LLM_MODE || 'mock').toLowerCase();
console.log(`\n=== Verificación conversacional · LLM_MODE=${modo} ===`);
console.log(`Frase: "${TEXTO}"\n`);

if (!existsSync(DB_PATH)) {
  console.error('No existe la DB. Corré primero: npm run seed');
  process.exit(1);
}

const db = openDb();
createSchema(db);

let r;
try {
  r = await conversar(db, { texto: TEXTO });
} catch (e) {
  console.error('✗ conversar() tiró un error:', e.message);
  if (modo === 'gateway') {
    console.error('  → ¿Pegaste AI_GATEWAY_API_KEY en backend/.env? ¿GATEWAY_MODEL válido?');
    console.error('  → Podés seguir con LLM_MODE=mock mientras tanto (el backend no se cae).');
  }
  process.exit(1);
}

console.log('Provider:      ', r.provider);
console.log('¿Entendido?:   ', r.entendido);
console.log('Interpretación:', JSON.stringify(r.interpretacion));

if (!r.entendido || !r.interpretacion) {
  console.error('\n✗ El provider no extrajo deudor/acreedor/monto.');
  process.exit(1);
}

const i = r.interpretacion;
const okExtraccion =
  i.deudorId === ESPERADO.deudorId &&
  i.acreedorId === ESPERADO.acreedorId &&
  i.monto === ESPERADO.monto;

console.log('\n--- Resultado del pipeline determinístico ---');
console.log('Estado:', r.resultado?.estado);
console.log('Score: ', r.resultado?.score);
console.log('\n--- Verbalización de Ángela ---');
console.log(r.respuesta);

if (!okExtraccion) {
  console.error(
    `\n✗ FALLA: la extracción por tool use no coincide con lo esperado.\n` +
    `  esperado ${JSON.stringify(ESPERADO)}\n  obtenido ${JSON.stringify(i)}`
  );
  process.exit(1);
}

if (!r.respuesta || !r.respuesta.trim()) {
  console.error('\n✗ FALLA: el pipeline corrió pero no hubo verbalización.');
  process.exit(1);
}

console.log(
  `\n✓ OK — tool use → {deudorId:${i.deudorId}, acreedorId:${i.acreedorId}, ` +
  `monto:${i.monto}} → pipeline (${r.resultado?.estado}) → verbalización. ` +
  `Provider: ${r.provider}.`
);
process.exit(0);
