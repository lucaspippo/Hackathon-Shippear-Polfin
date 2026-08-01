// PolFin — API REST (Prompt 1: andamiaje + datos).
// Endpoints de lectura para verificar que el dataset quedó bien.
// El scoring, el agente y lo on-chain vienen en los prompts siguientes.
import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { openDb, createSchema, DB_PATH } from './db.js';
import { sembrar } from './seed.js';
import { calcularScore } from './scoring.js';
import { evaluarCredito, conversar, aprobarSolicitud, rechazarSolicitud } from './agente/agente.js';
import { chatAngela } from './agente/chatAngela.js';
import { contextoMacroPublico } from './macro.js';
import { generarInsights } from './agente/insights.js';
import { ciclarMonitoreo, arrancarMonitor } from './agente/agenteProactivo.js';
import { POLICY } from './agente/policy.js';

// Puerto: en Render (y cualquier PaaS) manda process.env.PORT. En local usamos
// POLFIN_API_PORT (para no chocar con el 3000 del front). Default 4000.
const PORT = process.env.PORT || process.env.POLFIN_API_PORT || 4000;

// AUTO-SEED EN ARRANQUE (producción con disco efímero): si la DB no existe o
// está vacía, se siembra el dataset reproducible ANTES de servir requests. Así
// el backend en Render siempre levanta con los 1.288 registros y los perfiles
// diseñados, aunque el disco se haya borrado en el deploy. El seed local
// (`npm run seed`) sigue igual: reproducible y desde cero.
function dbEstaVacia() {
  try {
    const probe = openDb();
    const n = probe.prepare('SELECT COUNT(*) AS n FROM entidades').get().n;
    probe.close();
    return n === 0;
  } catch {
    return true; // sin tabla/DB corrupta → tratar como vacía
  }
}
if (!existsSync(DB_PATH) || dbEstaVacia()) {
  console.log('[startup] DB ausente o vacía — sembrando dataset reproducible…');
  sembrar();
  console.log('[startup] seed completo.');
}

const db = openDb();
createSchema(db);

const app = express();
// CORS: aceptamos el origen del frontend. FRONTEND_URL (coma-separado) lo acota
// en producción; sin setear, se refleja cualquier origen (útil para *.onrender.com
// y pruebas). Nunca usamos credenciales/cookies, así que reflejar es seguro.
const origenesCors = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map((s) => s.trim())
  : true;
app.use(cors({ origin: origenesCors }));
app.use(express.json());

// Columnas de pago derivadas de la tabla `pagos`, para que TODA la app cuadre:
//  · pagado = suma de pagos registrados (o el monto entero si ya estaba 'pagada')
//  · saldo  = lo que falta cobrar (0 si pagada; monto − pagado si viva)
// Se inyectan en cada SELECT de transacciones como alias sobre la fila `t`.
const COLS_PAGO = `
  CASE WHEN t.estado = 'pagada' THEN t.monto
       ELSE COALESCE((SELECT SUM(p.monto) FROM pagos p WHERE p.transaccion_id = t.id), 0)
  END AS pagado,
  CASE WHEN t.estado = 'pagada' THEN 0
       ELSE t.monto - COALESCE((SELECT SUM(p.monto) FROM pagos p WHERE p.transaccion_id = t.id), 0)
  END AS saldo`;

app.get('/api/health', (_req, res) => {
  const n = db.prepare('SELECT COUNT(*) AS n FROM transacciones').get().n;
  res.json({ ok: true, servicio: 'polfin-api', transacciones: n });
});

// Entidades (filtros: ?tipo=comercio|persona, ?rol=fabrica|distribuidora|mayorista|minorista)
app.get('/api/entidades', (req, res) => {
  const { tipo, rol } = req.query;
  let sql = 'SELECT * FROM entidades WHERE 1=1';
  const params = [];
  if (tipo) { sql += ' AND tipo = ?'; params.push(tipo); }
  if (rol) { sql += ' AND rol_cadena = ?'; params.push(rol); }
  sql += " ORDER BY CASE tipo WHEN 'comercio' THEN 0 ELSE 1 END, id";
  res.json(db.prepare(sql).all(...params));
});

// Una entidad con sus dos caras: lo que le deben (acreedor) y lo que debe (deudor)
app.get('/api/entidades/:id', (req, res) => {
  const ent = db.prepare('SELECT * FROM entidades WHERE id = ?').get(req.params.id);
  if (!ent) return res.status(404).json({ error: 'entidad no encontrada' });
  const comoAcreedor = db.prepare(`
    SELECT t.*, ${COLS_PAGO}, e.nombre AS deudor_nombre FROM transacciones t
    JOIN entidades e ON e.id = t.deudor_id
    WHERE t.acreedor_id = ? ORDER BY t.fecha_emision DESC
  `).all(req.params.id);
  const comoDeudor = db.prepare(`
    SELECT t.*, ${COLS_PAGO}, e.nombre AS acreedor_nombre FROM transacciones t
    JOIN entidades e ON e.id = t.acreedor_id
    WHERE t.deudor_id = ? ORDER BY t.fecha_emision DESC
  `).all(req.params.id);
  res.json({ ...ent, como_acreedor: comoAcreedor, como_deudor: comoDeudor });
});

// Transacciones (filtros: ?deudor=id, ?acreedor=id, ?estado=, ?limit=)
app.get('/api/transacciones', (req, res) => {
  const { deudor, acreedor, estado, limit } = req.query;
  let sql = `
    SELECT t.*, ${COLS_PAGO}, a.nombre AS acreedor_nombre, d.nombre AS deudor_nombre
    FROM transacciones t
    JOIN entidades a ON a.id = t.acreedor_id
    JOIN entidades d ON d.id = t.deudor_id
    WHERE 1=1`;
  const params = [];
  if (deudor) { sql += ' AND t.deudor_id = ?'; params.push(deudor); }
  if (acreedor) { sql += ' AND t.acreedor_id = ?'; params.push(acreedor); }
  if (estado) { sql += ' AND t.estado = ?'; params.push(estado); }
  sql += ' ORDER BY t.fecha_emision DESC';
  sql += ' LIMIT ?'; params.push(Number(limit) || 500);
  res.json(db.prepare(sql).all(...params));
});

// ============================== PAGOS ==============================
// Resumen de cobros y cuentas por pagar del rol activo (calculado desde la
// tabla `pagos` para que cuadre con el resto de la app).
app.get('/api/pagos/resumen/:id', (req, res) => {
  const id = Number(req.params.id);
  const cobros = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN t.estado = 'pagada' THEN t.monto ELSE
        COALESCE((SELECT SUM(p.monto) FROM pagos p WHERE p.transaccion_id = t.id), 0) END), 0) AS cobrado,
      COALESCE(SUM(CASE WHEN t.estado != 'pagada' THEN
        t.monto - COALESCE((SELECT SUM(p.monto) FROM pagos p WHERE p.transaccion_id = t.id), 0) ELSE 0 END), 0) AS por_cobrar,
      COALESCE(SUM(CASE WHEN t.estado = 'vencida' THEN
        t.monto - COALESCE((SELECT SUM(p.monto) FROM pagos p WHERE p.transaccion_id = t.id), 0) ELSE 0 END), 0) AS vencido
    FROM transacciones t WHERE t.acreedor_id = ?
  `).get(id);
  const porPagar = db.prepare(`
    SELECT COALESCE(SUM(t.monto - COALESCE((SELECT SUM(p.monto) FROM pagos p WHERE p.transaccion_id = t.id), 0)), 0) AS debe
    FROM transacciones t WHERE t.deudor_id = ? AND t.estado != 'pagada'
  `).get(id);
  res.json({ ...cobros, debe: porPagar.debe });
});

// Deudas vivas donde la entidad es ACREEDOR (por cobrar) con progreso real.
app.get('/api/pagos/por-cobrar/:id', (req, res) => {
  res.json(db.prepare(`
    SELECT t.*, ${COLS_PAGO}, d.nombre AS deudor_nombre
    FROM transacciones t JOIN entidades d ON d.id = t.deudor_id
    WHERE t.acreedor_id = ? AND t.estado != 'pagada'
    ORDER BY t.fecha_vencimiento ASC
  `).all(Number(req.params.id)));
});

// Deudas vivas donde la entidad es DEUDOR (cuentas por pagar) con progreso.
app.get('/api/pagos/por-pagar/:id', (req, res) => {
  res.json(db.prepare(`
    SELECT t.*, ${COLS_PAGO}, a.nombre AS acreedor_nombre
    FROM transacciones t JOIN entidades a ON a.id = t.acreedor_id
    WHERE t.deudor_id = ? AND t.estado != 'pagada'
    ORDER BY t.fecha_vencimiento ASC
  `).all(Number(req.params.id)));
});

// Registrar un pago (mock, sin Mercado Pago). Soporta PARCIAL: descuenta del
// saldo; si llega a 0, marca la tx como 'pagada' con la fecha de hoy.
app.post('/api/pagos', (req, res) => {
  try {
    const { transaccion_id, monto, metodo } = req.body || {};
    const t = db.prepare('SELECT * FROM transacciones WHERE id = ?').get(Number(transaccion_id));
    if (!t) return res.status(404).json({ error: 'transacción inexistente' });
    if (t.estado === 'pagada') return res.status(400).json({ error: 'la deuda ya está saldada' });

    const yaPagado = db.prepare('SELECT COALESCE(SUM(monto), 0) AS s FROM pagos WHERE transaccion_id = ?').get(t.id).s;
    const saldo = t.monto - yaPagado;
    const m = Math.round(Number(monto));
    if (!Number.isFinite(m) || m <= 0) return res.status(400).json({ error: 'monto inválido' });
    if (m > saldo) return res.status(400).json({ error: `el pago ($${m.toLocaleString('es-AR')}) supera el saldo ($${saldo.toLocaleString('es-AR')})` });

    const hoy = new Date().toISOString().slice(0, 10);
    const comprobante = 'PF-' + Date.now().toString(36).toUpperCase();
    db.prepare(`
      INSERT INTO pagos (transaccion_id, monto, fecha, metodo, comprobante)
      VALUES (?, ?, ?, ?, ?)
    `).run(t.id, m, hoy, metodo || 'transferencia', comprobante);

    const nuevoSaldo = saldo - m;
    let estadoNuevo = t.estado;
    if (nuevoSaldo <= 0) {
      estadoNuevo = 'pagada';
      db.prepare('UPDATE transacciones SET estado = ?, fecha_pago_real = ? WHERE id = ?').run('pagada', hoy, t.id);
    }
    res.json({
      ok: true, comprobante, monto: m,
      transaccion_id: t.id, saldo_anterior: saldo, saldo_nuevo: Math.max(0, nuevoSaldo),
      estado: estadoNuevo, saldada: nuevoSaldo <= 0,
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// Historial de pagos de una transacción (para el comprobante / detalle)
app.get('/api/pagos/de/:txId', (req, res) => {
  res.json(db.prepare('SELECT * FROM pagos WHERE transaccion_id = ? ORDER BY id').all(Number(req.params.txId)));
});

// Score de una entidad: número + desglose explicable + condiciones sugeridas.
// Motor determinístico (Prompt 2) — el agente lo va a usar como tool después.
app.get('/api/score/:id', (req, res) => {
  const resultado = calcularScore(db, Number(req.params.id));
  if (!resultado) return res.status(404).json({ error: 'entidad no encontrada' });
  res.json(resultado);
});

// Ranking de scores de toda la red (filtros: ?tipo=persona|comercio)
app.get('/api/scores', (req, res) => {
  let sql = `
    SELECT DISTINCT e.id FROM entidades e
    JOIN transacciones t ON t.deudor_id = e.id`;
  const params = [];
  if (req.query.tipo) { sql += ' WHERE e.tipo = ?'; params.push(req.query.tipo); }
  const ids = db.prepare(sql).all(...params);
  const scores = ids
    .map((r) => calcularScore(db, r.id))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .map((s) => ({
      id: s.entidad.id,
      nombre: s.entidad.nombre,
      tipo: s.entidad.tipo,
      score: s.score,
      riesgo: s.condiciones.riesgo,
      tasa_sugerida_tna: s.condiciones.tasa_sugerida_tna,
      plazo_max_dias: s.condiciones.plazo_max_dias,
      limite_sugerido_pesos: s.condiciones.limite_sugerido_pesos,
      pct_puntual: s.metricas.pct_puntual ?? null,
      comercios_buenos: s.metricas.comercios_con_buen_comportamiento ?? 0,
    }));
  res.json(scores);
});

// La red completa para el Cerebro: nodos = entidades (con score real),
// aristas = relaciones de crédito agregadas por par acreedor→deudor.
app.get('/api/red', (_req, res) => {
  const entidades = db.prepare('SELECT * FROM entidades').all();
  const nodos = entidades.map((e) => {
    const s = calcularScore(db, e.id);
    return {
      id: e.id, nombre: e.nombre, tipo: e.tipo, rol_cadena: e.rol_cadena,
      rubro: e.rubro, ciudad: e.ciudad,
      score: s?.score ?? null,
      riesgo: s?.condiciones?.riesgo ?? null,
      operaciones: s?.metricas?.operaciones ?? 0,
      vencidas: s?.metricas?.vencidas_impagas ?? 0,
    };
  });
  const aristas = db.prepare(`
    SELECT acreedor_id, deudor_id, COUNT(*) AS n, SUM(monto) AS monto_total,
      SUM(CASE WHEN estado = 'vencida' THEN 1 ELSE 0 END) AS vencidas,
      SUM(CASE WHEN estado = 'pendiente' THEN 1 ELSE 0 END) AS pendientes
    FROM transacciones GROUP BY acreedor_id, deudor_id
  `).all().map((a) => ({
    source: a.acreedor_id, target: a.deudor_id,
    n: a.n, monto_total: a.monto_total, vencidas: a.vencidas, pendientes: a.pendientes,
  }));
  res.json({ nodos, aristas });
});

// Macro de referencia (para consultarMacro() del agente, más adelante)
app.get('/api/macro', (_req, res) => {
  res.json(db.prepare('SELECT * FROM macro_referencia ORDER BY mes').all());
});

// Contexto macro REAL (contexto_macro.json): indicadores + política + lectura +
// reglas activas + regla de neutralidad. Lo consume la UI para mostrar que el
// plazo/tasa consideran el contexto del país.
app.get('/api/macro/contexto', (_req, res) => {
  res.json(contextoMacroPublico());
});

// EL endpoint de verificación: totales + comportamiento de pago por deudor.
// Acá se ve si los datos sostienen la narrativa (estrella/thin/moroso) SIN scoring.
app.get('/api/resumen', (_req, res) => {
  const totales = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM entidades) AS entidades,
      (SELECT COUNT(*) FROM entidades WHERE tipo = 'comercio') AS comercios,
      (SELECT COUNT(*) FROM entidades WHERE tipo = 'persona') AS personas,
      COUNT(*) AS transacciones,
      SUM(CASE WHEN estado = 'pagada' THEN 1 ELSE 0 END) AS pagadas,
      SUM(CASE WHEN estado = 'pendiente' THEN 1 ELSE 0 END) AS pendientes,
      SUM(CASE WHEN estado = 'vencida' THEN 1 ELSE 0 END) AS vencidas,
      SUM(monto) AS monto_total
    FROM transacciones
  `).get();

  const porDeudor = db.prepare(`
    SELECT
      e.id, e.nombre, e.tipo,
      COUNT(*) AS n_tx,
      SUM(CASE WHEN t.estado = 'pagada' THEN 1 ELSE 0 END) AS pagadas,
      SUM(CASE WHEN t.estado = 'pagada' AND t.fecha_pago_real <= t.fecha_vencimiento THEN 1 ELSE 0 END) AS puntuales,
      SUM(CASE WHEN t.estado = 'pendiente' THEN 1 ELSE 0 END) AS pendientes,
      SUM(CASE WHEN t.estado = 'vencida' THEN 1 ELSE 0 END) AS vencidas,
      ROUND(AVG(CASE WHEN t.estado = 'pagada' AND t.fecha_pago_real > t.fecha_vencimiento
        THEN julianday(t.fecha_pago_real) - julianday(t.fecha_vencimiento) END), 1) AS atraso_promedio_dias,
      COUNT(DISTINCT t.acreedor_id) AS comercios_distintos,
      SUM(t.monto) AS monto_total,
      MIN(t.fecha_emision) AS primera_operacion,
      MAX(t.fecha_emision) AS ultima_operacion
    FROM transacciones t
    JOIN entidades e ON e.id = t.deudor_id
    GROUP BY t.deudor_id
    ORDER BY e.tipo DESC, (1.0 * puntuales) / MAX(pagadas, 1) DESC, n_tx DESC
  `).all().map((r) => ({
    ...r,
    pct_puntual: r.pagadas ? Math.round((100 * r.puntuales) / r.pagadas) : null,
  }));

  res.json({ fecha_referencia_seed: '2026-08-01', totales, por_deudor: porDeudor });
});

// ============================== EL AGENTE (Prompt 3) ==============================

// INVOCACIÓN DIRECTA (sin LLM): corre la máquina de estados determinística.
// Es lo que usa la UI. body: { deudor_id, acreedor_id, monto, contexto? }
app.post('/api/agente/evaluar-credito', async (req, res) => {
  try {
    const { deudor_id, acreedor_id, monto, contexto, plazo_dias } = req.body || {};
    const resultado = await evaluarCredito(db, {
      deudorId: Number(deudor_id),
      acreedorId: Number(acreedor_id),
      monto: Number(monto),
      contexto,
      plazoPreferido: plazo_dias ? Number(plazo_dias) : null,
    });
    res.json(resultado);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// INVOCACIÓN CONVERSACIONAL (LLM solo en los bordes): interpreta la frase,
// corre el MISMO pipeline determinístico, y verbaliza. body: { texto }
app.post('/api/agente/conversar', async (req, res) => {
  try {
    res.json(await conversar(db, { texto: req.body?.texto }));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// CHAT ABIERTO (el uso de IA central): el dueño pregunta cualquier cosa sobre su
// negocio en lenguaje natural y Ángela razona sobre los datos reales, eligiendo y
// encadenando tools de SOLO LECTURA. Es de consulta/análisis: NO ejecuta acciones
// que muevan dinero (eso va por el flujo formal con approval gate).
// body: { pregunta, entidadId, rol?, nombre?, historial?: [{role, content}] }
app.post('/api/agente/chat', async (req, res) => {
  try {
    const b = req.body || {};
    const pregunta = (b.pregunta ?? b.texto ?? '').toString();
    if (!pregunta.trim()) return res.status(400).json({ error: 'falta la pregunta' });
    const entId = Number(b.entidadId ?? b.entidad_id);
    const ent = Number.isFinite(entId) ? db.prepare('SELECT nombre FROM entidades WHERE id = ?').get(entId) : null;
    res.json(await chatAngela(db, {
      pregunta,
      entidadActivaId: Number.isFinite(entId) ? entId : null,
      entidadNombre: ent?.nombre ?? b.nombre ?? null,
      rol: b.rol ?? null,
      historial: Array.isArray(b.historial) ? b.historial : [],
    }));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// MONITOREO PROACTIVO: fuerza un ciclo YA (para gatillar en vivo en el pitch,
// sin esperar el intervalo). body opcional: { ventana_vencimiento }
app.post('/api/agente/monitorear', async (req, res) => {
  try {
    res.json(await ciclarMonitoreo(db, { ventanaVencimiento: req.body?.ventana_vencimiento }));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// Detecciones activas del monitor (alimentan el feed)
app.get('/api/agente/detecciones', (_req, res) => {
  res.json(db.prepare("SELECT * FROM detecciones WHERE estado = 'activa' ORDER BY id DESC").all());
});

// INSIGHTS PROACTIVOS (AI-native): Ángela lee la red del vendedor activo y
// genera tarjetas de early-warning priorizadas (cambio de comportamiento,
// concentración, oportunidad, anomalía, cobros). Se computan en vivo.
// query: ?entidadId=ID (el vendedor activo)
app.get('/api/agente/insights', (req, res) => {
  try {
    const entId = Number(req.query.entidadId);
    if (!Number.isFinite(entId)) return res.status(400).json({ error: 'falta entidadId' });
    res.json(generarInsights(db, entId));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// Config del policy engine (para mostrar en la UI del agente)
app.get('/api/agente/policy', (_req, res) => res.json(POLICY));

// Log de auditoría de una corrida (o las últimas N entradas si no se filtra)
app.get('/api/agente/auditoria', (req, res) => {
  const { corrida, limit } = req.query;
  if (corrida) {
    return res.json(db.prepare(
      'SELECT * FROM auditoria WHERE corrida_id = ? ORDER BY seq'
    ).all(corrida));
  }
  res.json(db.prepare(
    'SELECT * FROM auditoria ORDER BY id DESC LIMIT ?'
  ).all(Number(limit) || 100));
});

// Solicitudes de crédito (la cola de decisiones del dueño)
app.get('/api/solicitudes', (_req, res) => {
  res.json(db.prepare(`
    SELECT s.*, d.nombre AS deudor_nombre, a.nombre AS acreedor_nombre
    FROM solicitudes_credito s
    JOIN entidades d ON d.id = s.deudor_id
    JOIN entidades a ON a.id = s.acreedor_id
    ORDER BY s.id DESC
  `).all());
});

// Human-in-the-loop: el dueño aprueba o rechaza una solicitud pendiente
app.post('/api/solicitudes/:id/aprobar', async (req, res) => {
  try { res.json(await aprobarSolicitud(db, Number(req.params.id))); }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});
app.post('/api/solicitudes/:id/rechazar', async (req, res) => {
  try { res.json(await rechazarSolicitud(db, Number(req.params.id))); }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

// Instrumentos (e-pagarés) y notificaciones al dueño
// Instrumentos (e-pagarés). Filtros: ?deudor=id, ?acreedor=id, ?entidad=id
// (cualquiera de las dos caras), ?pendientes=1 (sin aceptar por el deudor).
app.get('/api/instrumentos', (req, res) => {
  const { deudor, acreedor, entidad, pendientes } = req.query;
  let sql = `
    SELECT i.*, d.nombre AS deudor_nombre, d.tipo AS deudor_tipo,
           a.nombre AS acreedor_nombre, a.rubro AS acreedor_rubro
    FROM instrumentos i
    JOIN entidades d ON d.id = i.deudor_id
    JOIN entidades a ON a.id = i.acreedor_id
    WHERE 1=1`;
  const params = [];
  if (deudor) { sql += ' AND i.deudor_id = ?'; params.push(deudor); }
  if (acreedor) { sql += ' AND i.acreedor_id = ?'; params.push(acreedor); }
  if (entidad) { sql += ' AND (i.deudor_id = ? OR i.acreedor_id = ?)'; params.push(entidad, entidad); }
  if (pendientes) { sql += ' AND i.aceptado = 0'; }
  sql += ' ORDER BY i.aceptado ASC, i.id DESC';
  res.json(db.prepare(sql).all(...params));
});

// Un instrumento con todo lo necesario para renderizar el documento legible.
app.get('/api/instrumentos/:id', (req, res) => {
  const i = db.prepare(`
    SELECT i.*, d.nombre AS deudor_nombre, d.tipo AS deudor_tipo, d.ciudad AS deudor_ciudad,
           a.nombre AS acreedor_nombre, a.rubro AS acreedor_rubro, a.ciudad AS acreedor_ciudad
    FROM instrumentos i
    JOIN entidades d ON d.id = i.deudor_id
    JOIN entidades a ON a.id = i.acreedor_id
    WHERE i.id = ?
  `).get(req.params.id);
  if (!i) return res.status(404).json({ error: 'instrumento inexistente' });
  res.json(i);
});

// Aceptación del deudor: cierra el "las dos partes atestiguan". El consumidor
// (o el comercio deudor) firma el e-pagaré desde su lado y queda formalizado.
app.post('/api/instrumentos/:id/aceptar', (req, res) => {
  const i = db.prepare('SELECT * FROM instrumentos WHERE id = ?').get(req.params.id);
  if (!i) return res.status(404).json({ error: 'instrumento inexistente' });
  if (i.aceptado) return res.status(400).json({ error: 'el instrumento ya estaba aceptado' });
  const at = new Date().toISOString();
  db.prepare('UPDATE instrumentos SET aceptado = 1, aceptado_at = ? WHERE id = ?').run(at, i.id);
  res.json({ ok: true, instrumento_id: i.id, aceptado_at: at });
});

// Un comprobante de pago por su código (PF-…), con la operación asociada.
app.get('/api/comprobante/:codigo', (req, res) => {
  const p = db.prepare(`
    SELECT p.*, t.concepto, t.monto AS deuda_total, t.fecha_vencimiento,
           a.nombre AS acreedor_nombre, d.nombre AS deudor_nombre
    FROM pagos p
    JOIN transacciones t ON t.id = p.transaccion_id
    JOIN entidades a ON a.id = t.acreedor_id
    JOIN entidades d ON d.id = t.deudor_id
    WHERE p.comprobante = ?
  `).get(req.params.codigo);
  if (!p) return res.status(404).json({ error: 'comprobante inexistente' });
  const saldoTras = db.prepare(`
    SELECT t.monto - COALESCE(SUM(p2.monto), 0) AS saldo
    FROM transacciones t LEFT JOIN pagos p2 ON p2.transaccion_id = t.id AND p2.id <= ?
    WHERE t.id = ?
  `).get(p.id, p.transaccion_id).saldo;
  res.json({ ...p, saldo_tras_pago: Math.max(0, saldoTras) });
});

app.get('/api/notificaciones', (_req, res) => {
  res.json(db.prepare('SELECT * FROM notificaciones ORDER BY id DESC').all());
});

app.listen(PORT, () => {
  console.log(`PolFin API escuchando en http://localhost:${PORT}`);
  console.log('Probá: /api/health · /api/entidades · /api/transacciones · /api/resumen · /api/macro');
  const seg = arrancarMonitor(db);
  if (seg) console.log(`Monitor proactivo de Ángela: cada ${seg}s (POLFIN_MONITOR_INTERVAL; 0 = apagado)`);
});
