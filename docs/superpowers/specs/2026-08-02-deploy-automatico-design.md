# Deploy automático (back, front, contracts) + manejo de secretos

**Fecha**: 2026-08-02
**Estado**: aprobado, pendiente de plan de implementación

## Contexto

PolFin ya tiene un `render.yaml` (Blueprint, dos web services: `polfin-backend`
y `polfin-frontend`, ambos con `autoDeploy: true`) y un `DEPLOY.md` que
documenta el proceso paso a paso. En la práctica, sin embargo, el deploy es
manual en tres frentes:

1. El Blueprint de Render **nunca se conectó** al repo de GitHub — cada
   deploy se dispara a mano desde el dashboard.
2. Los secretos (`AI_GATEWAY_API_KEY`, private keys de wallet operadora,
   API keys de 0xgasless) se comparten por WhatsApp/chat para desarrollo
   local, y se cargan a mano en el dashboard de Render para producción.
3. No hay ningún check automático (build/lint/tests) entre un push y el
   deploy — nada impide que código roto llegue a producción.

`contracts/` (Hardhat, contratos `EPagare`, `MockUSDC`, `ScoreRegistry`, con
tests ya escritos para los tres) hoy corre en `POLFIN_CHAIN_MODE=mock` —
nada está deployeado on-chain todavía. El plan de implementación on-chain
real ya está documentado por separado
(`2026-08-01-onchain-fuji-design.md`, `2026-08-01-avalanche-gasless-design.md`)
y queda fuera del alcance de esta spec.

## Decisiones tomadas

- **Se queda en Render** — no se evalúan proveedores alternativos. El
  cold-start del free tier no es un problema real para este proyecto (demo
  puntual, no tráfico constante).
- **Sin herramienta de gestión de secretos nueva** (se descartó Doppler
  explícitamente) — se usan los mecanismos ya disponibles: dashboard de
  Render para runtime, GitHub Environment secrets para CI/deploy de
  contratos. Compartir secretos para desarrollo local entre el equipo queda
  fuera de este alcance, sigue como está hoy.
- **Deploy de contratos on-chain queda manual** (`workflow_dispatch`), no
  continuo — un deploy de contrato es un evento raro y sensible (nueva
  address cada vez, gasta gas real), no algo que deba dispararse en cada
  commit.

## Diseño

### 1. CI en GitHub Actions

Un workflow, `.github/workflows/ci.yml`, disparado en `push` y `pull_request`
contra `master`, con tres jobs independientes filtrados por path (cada uno
corre solo si el push toca esa carpeta):

- **`backend`**
  - `npm ci` en `backend/`.
  - Smoke test: `npm run seed` (genera `backend/data/polfin.db` desde cero,
    valida que el schema y el seed determinístico no estén rotos) → arrancar
    `node src/server.js` en background con `LLM_MODE=mock` (no requiere API
    key) → `curl` a `/api/health` esperando `{"ok":true,...}` → matar el
    proceso.
  - No hay lint configurado en el backend ni suite de tests — el smoke test
    es la única red de seguridad real disponible hoy. No se agrega ESLint
    en esta spec (fuera de alcance; sería un cambio de convención del
    proyecto, no de deploy).

- **`frontend`**
  - `npm ci` en `frontend/`.
  - `npm run lint`.
  - `npm run build` con `NEXT_PUBLIC_API_URL` seteado a un valor dummy
    (`http://localhost:4000`) — el build de Next solo necesita compilar,
    Render re-inyecta el valor real al buildear en su infraestructura.

- **`contracts`**
  - `npm ci` en `contracts/`.
  - `npx hardhat compile`.
  - `npx hardhat test` (ya existen `EPagare.test.js`, `MockUSDC.test.js`,
    `ScoreRegistry.test.js`).
  - No necesita secretos: compilar y correr tests contra una red local de
    Hardhat no requiere RPC URL ni private key real.

Los tres jobs deben reportar como **required status checks** para el punto
siguiente.

### 2. Branch protection en `master`

Se configura la branch `master` para exigir que los tres checks de CI pasen
antes de poder mergear (vía PR; pushes directos a `master` quedan
bloqueados salvo administradores si así se prefiere, a definir en el plan).

Esto es lo que cierra el círculo de automatización real: Render ya
auto-deploya todo lo que llega a `master` (`autoDeploy: true`); con esta
protección, nada roto llega a `master`, y por lo tanto nada roto se
auto-deploya.

### 3. Conectar el Blueprint de Render (paso manual, una sola vez)

No automatizable por un agente — requiere login OAuth del dueño de la
cuenta de Render. Pasos (a documentar en `DEPLOY.md`):

1. Dashboard de Render → New → Blueprint → seleccionar el repo de GitHub
   `lucaspippo/Hackathon-Shippear-Polfin`, rama `master`.
2. Render detecta `render.yaml` y propone crear `polfin-backend` y
   `polfin-frontend`.
3. Cargar los secretos marcados `sync: false` en cada servicio (ver
   `DEPLOY.md` — `AI_GATEWAY_API_KEY` en backend; `NEXT_PUBLIC_API_URL` en
   frontend una vez que el backend tenga URL pública).
4. Confirmar. A partir de acá, cada push a `master` (que ya pasó CI, por el
   punto 2) dispara un deploy automático en ambos servicios.

### 4. Secretos

Sin herramienta nueva — dos fuentes de verdad separadas por audiencia:

- **Runtime (Render)**: como ya está en `render.yaml`/`DEPLOY.md` — variables
  `sync: false` cargadas a mano una vez en el dashboard de cada servicio.
  Ningún cambio de proceso acá, ya funciona razonablemente.
- **CI / deploy de contratos (GitHub Actions)**: **GitHub Environment
  secrets**. Se crea un Environment `fuji-testnet` en el repo con:
  - `POLFIN_OPERATOR_PRIVATE_KEY_FUJI`
  - `POLFIN_0XGASLESS_API_KEY_FUJI` (cuando el flujo gasless esté
    implementado — ver specs on-chain)
  - `POLFIN_FUJI_RPC_URL` (no es secreto, pero vive junto a los demás por
    simplicidad; puede quedar como valor público del workflow si se
    prefiere).
- **Desarrollo local entre el equipo**: fuera de alcance de esta spec, sigue
  como hoy (compartido manualmente).

### 5. Deploy de contratos: workflow manual

`.github/workflows/contracts-deploy.yml`, disparado solo por
`workflow_dispatch` con un input `network` (hoy con una única opción válida,
`fuji` — `avalanche`/mainnet no está configurada todavía en
`contracts/hardhat.config.js`, eso es parte del plan on-chain real ya
documentado y queda fuera de esta spec).

- Job corre en el Environment `fuji-testnet` de GitHub — esto permite (si se
  configura así en el repo, a decidir en el plan) exigir un reviewer humano
  antes de que el job arranque, ya que un deploy gasta gas real y genera una
  address nueva.
- Pasos: `npm ci` en `contracts/` → `npx hardhat run scripts/deploy.js
  --network fuji` usando los secretos del Environment.
- El mismo patrón (Environment + reviewers obligatorios) se reutiliza para
  `mainnet` el día que `hardhat.config.js` tenga esa red configurada — ahí
  los reviewers dejan de ser opcionales: se exigen siempre, dado que mueve
  fondos reales.
- Nota: `hardhat.config.js` hoy lee `POLFIN_OPERATOR_PRIVATE_KEY` (sin
  sufijo), mientras que `.env.example` documenta
  `POLFIN_OPERATOR_PRIVATE_KEY_FUJI`/`_AVALANCHE`. Este desalineamiento hay
  que resolverlo (en el plan de implementación) antes de que el workflow de
  deploy funcione — no es parte del diseño de CI/CD en sí, es una
  inconsistencia preexistente que este workflow expone.

## Fuera de alcance

- Migrar de proveedor (Render se mantiene).
- Herramienta de gestión de secretos para desarrollo local (Doppler u
  otra) — descartado explícitamente.
- Deploy on-chain real a Fuji/mainnet en sí (implementación de
  `deploy.js`, wiring de 0xgasless, red `avalanche` en `hardhat.config.js`)
  — cubierto por las specs on-chain existentes.
- Agregar ESLint/lint al backend.

## Testing

- CI: verificar que los tres jobs (`backend`, `backend` smoke test,
  `frontend` lint+build, `contracts` compile+test) corren y fallan
  correctamente ante un cambio roto introducido a propósito en una rama de
  prueba.
- Branch protection: confirmar que un PR con CI en rojo no se puede mergear.
- Render: confirmar que un push a `master` post-CI dispara deploy en ambos
  servicios (ya cubierto por `autoDeploy: true`, solo hay que verificar tras
  conectar el Blueprint).
- `contracts-deploy.yml`: probar el `workflow_dispatch` contra `fuji` una
  vez resuelto el desalineamiento de nombres de variables, verificando que
  pide aprobación del Environment antes de correr.
