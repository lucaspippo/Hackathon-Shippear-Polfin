// Conexión y esquema de la DB (SQLite nativo de Node 22.5+ — sin dependencias nativas).
// Modelo clave: UNA sola tabla `entidades`. Un comercio compra Y vende según dónde
// esté en la cadena (fábrica → distribuidora → mayorista → minorista → consumidor),
// así que cualquier entidad puede aparecer como acreedor o como deudor en `transacciones`.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = path.join(__dirname, '..', 'data', 'polfin.db');

export function openDb() {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

export function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entidades (
      id          INTEGER PRIMARY KEY,
      nombre      TEXT NOT NULL,
      tipo        TEXT NOT NULL CHECK (tipo IN ('comercio', 'persona')),
      -- rol_cadena solo aplica a comercios; una persona es consumidor final
      rol_cadena  TEXT CHECK (rol_cadena IN ('fabrica', 'distribuidora', 'mayorista', 'minorista')),
      rubro       TEXT,
      barrio      TEXT,
      ciudad      TEXT NOT NULL,
      lat         REAL,
      lng         REAL,
      -- adherido a la red PolFin (el efecto de red: lo no adherido no cuenta)
      adherido    INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS transacciones (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      acreedor_id      INTEGER NOT NULL REFERENCES entidades(id),
      deudor_id        INTEGER NOT NULL REFERENCES entidades(id),
      monto            INTEGER NOT NULL,           -- pesos argentinos, sin centavos
      concepto         TEXT,
      fecha_emision    TEXT NOT NULL,              -- YYYY-MM-DD
      plazo_dias       INTEGER NOT NULL,           -- plazo pactado
      fecha_vencimiento TEXT NOT NULL,
      fecha_pago_real  TEXT,                       -- NULL si no se pagó todavía
      estado           TEXT NOT NULL CHECK (estado IN ('pagada', 'pendiente', 'vencida')),
      CHECK (acreedor_id <> deudor_id)
    );

    CREATE INDEX IF NOT EXISTS idx_tx_deudor   ON transacciones(deudor_id);
    CREATE INDEX IF NOT EXISTS idx_tx_acreedor ON transacciones(acreedor_id);
    CREATE INDEX IF NOT EXISTS idx_tx_estado   ON transacciones(estado);

    -- Datos macro de referencia (sección 7 del doc maestro). Valores PLAUSIBLES de
    -- referencia — VERIFICAR cifras reales de Argentina cerca de la fecha del evento.
    CREATE TABLE IF NOT EXISTS macro_referencia (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      mes                    TEXT NOT NULL,        -- YYYY-MM
      inflacion_mensual_pct  REAL NOT NULL,
      tipo_cambio_oficial    REAL NOT NULL,        -- ARS por USD
      tasa_referencia_tna    REAL NOT NULL,        -- % TNA
      nota                   TEXT
    );

    -- ========================== Prompt 3: el agente ==========================

    -- Pedidos de crédito que el agente evalúa (la "cola de decisiones" del dueño)
    CREATE TABLE IF NOT EXISTS solicitudes_credito (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      corrida_id    TEXT NOT NULL,                 -- corrida del agente que la evaluó
      deudor_id     INTEGER NOT NULL REFERENCES entidades(id),
      acreedor_id   INTEGER NOT NULL REFERENCES entidades(id),
      monto         INTEGER NOT NULL,
      estado        TEXT NOT NULL CHECK (estado IN
        ('en_evaluacion', 'aprobada', 'pendiente_aprobacion', 'rechazada')),
      condiciones_json TEXT,                       -- lo que decidió el motor (tasa/plazo/límite)
      razonamiento  TEXT,                          -- la explicación final del agente
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- e-Pagarés. HOY: registro en DB con dirección/hash MOCK.
    -- PROMPT 4: el instrumento se despliega como smart contract en Avalanche Fuji
    -- y estas columnas guardan la dirección y el tx hash REALES.
    CREATE TABLE IF NOT EXISTS instrumentos (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      solicitud_id  INTEGER REFERENCES solicitudes_credito(id),
      deudor_id     INTEGER NOT NULL REFERENCES entidades(id),
      acreedor_id   INTEGER NOT NULL REFERENCES entidades(id),
      monto         INTEGER NOT NULL,
      tasa_tna      REAL NOT NULL,
      plazo_dias    INTEGER NOT NULL,
      fecha_vencimiento TEXT NOT NULL,
      estado        TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'pagado', 'vencido')),
      contrato_address TEXT NOT NULL,              -- real en fuji/avalanche, mock en modo demo
      tx_hash       TEXT NOT NULL,                 -- real en fuji/avalanche, mock en modo demo
      red           TEXT NOT NULL DEFAULT 'mock',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Registro de scores "on-chain" (real en fuji/avalanche, mock en modo demo).
    CREATE TABLE IF NOT EXISTS scores_onchain (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      entidad_id  INTEGER NOT NULL REFERENCES entidades(id),
      score       INTEGER NOT NULL,
      tx_hash     TEXT NOT NULL,                   -- real en fuji/avalanche, mock en modo demo
      red         TEXT NOT NULL DEFAULT 'mock',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Notificaciones al dueño (avisos + pedidos de aprobación human-in-the-loop)
    CREATE TABLE IF NOT EXISTS notificaciones (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo          TEXT NOT NULL CHECK (tipo IN ('info', 'aprobacion_requerida')),
      mensaje       TEXT NOT NULL,
      solicitud_id  INTEGER REFERENCES solicitudes_credito(id),
      leida         INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Log de auditoría del agente: CADA decisión y CADA tool ejecutada queda
    -- registrada (seguridad + se muestra en la UI del agente después).
    CREATE TABLE IF NOT EXISTS auditoria (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      corrida_id   TEXT NOT NULL,
      seq          INTEGER NOT NULL,
      tipo         TEXT NOT NULL CHECK (tipo IN ('inicio', 'llm', 'policy', 'tool_call', 'decision', 'error', 'aprobacion_humana')),
      tool         TEXT,
      params_json  TEXT,
      resultado_json TEXT,
      permitido    INTEGER,                        -- para tipo='policy'
      motivo       TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_corrida ON auditoria(corrida_id, seq);

    -- Pagos parciales/totales contra una deuda (transacción de crédito).
    -- CONVENCIÓN: las transacciones históricas con estado 'pagada' se saldaron
    -- de una (su pago está implícito en fecha_pago_real y NO se duplica acá).
    -- Esta tabla guarda los pagos de deudas VIVAS: los parciales sembrados y
    -- los que registra el dueño desde la vista de Pagos. Por eso el saldo es
    -- 0 si la tx está pagada, y monto − SUM(pagos) si está viva.
    CREATE TABLE IF NOT EXISTS pagos (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaccion_id INTEGER NOT NULL REFERENCES transacciones(id),
      monto          INTEGER NOT NULL CHECK (monto > 0),
      fecha          TEXT NOT NULL,
      metodo         TEXT NOT NULL DEFAULT 'transferencia'
                     CHECK (metodo IN ('transferencia', 'efectivo', 'mercado_pago', 'stablecoin')),
      comprobante    TEXT NOT NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pagos_tx ON pagos(transaccion_id);

    -- Detecciones del monitor proactivo (Ángela vigila la red sola).
    -- clave UNIQUE = dedup: la misma situación no se re-detecta cada ciclo.
    CREATE TABLE IF NOT EXISTS detecciones (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      corrida_id   TEXT NOT NULL,
      tipo         TEXT NOT NULL CHECK (tipo IN ('ampliacion', 'riesgo_atraso', 'vencimiento')),
      clave        TEXT NOT NULL UNIQUE,
      titulo       TEXT NOT NULL,
      detalle      TEXT NOT NULL,
      datos_json   TEXT,
      solicitud_id INTEGER REFERENCES solicitudes_credito(id),
      estado       TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'resuelta')),
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migración: la trayectoria de estados del pipeline determinístico
  // (RECIBIDO → SCORING → … → COMPLETADO) se persiste en la solicitud.
  try {
    db.exec(`ALTER TABLE solicitudes_credito ADD COLUMN estados_json TEXT`);
  } catch { /* la columna ya existe */ }
  // Migración: quién inició la solicitud — 'directa' (UI), 'conversacional'
  // (Ángela interpretando una frase) o 'proactiva' (Ángela sola, monitoreo).
  try {
    db.exec(`ALTER TABLE solicitudes_credito ADD COLUMN origen TEXT NOT NULL DEFAULT 'directa'`);
  } catch { /* la columna ya existe */ }
  // Migración: aceptación del deudor sobre el e-pagaré (las dos partes
  // atestiguan). 1 = el deudor ya firmó/aceptó; 0 = le llegó y está pendiente.
  // Default 1 para no romper lo ya generado por el pipeline (se acepta al vuelo);
  // las operaciones que el consumidor debe aceptar en la demo se siembran con 0.
  try {
    db.exec(`ALTER TABLE instrumentos ADD COLUMN aceptado INTEGER NOT NULL DEFAULT 1`);
  } catch { /* la columna ya existe */ }
  try {
    db.exec(`ALTER TABLE instrumentos ADD COLUMN aceptado_at TEXT`);
  } catch { /* la columna ya existe */ }
  // Migración: id del NFT minteado en el contrato EPagare (Prompt 4, Fuji).
  // NULL para instrumentos creados en POLFIN_CHAIN_MODE=mock.
  try {
    db.exec(`ALTER TABLE instrumentos ADD COLUMN token_id INTEGER`);
  } catch { /* la columna ya existe */ }
}
