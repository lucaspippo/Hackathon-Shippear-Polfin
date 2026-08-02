# Deploy de PolFin en Render

Monorepo con **dos web services** separados. La base de datos es **SQLite**
(módulo nativo `node:sqlite`, sin dependencias) y se **auto-seedea en el
arranque**: si el disco efímero de Render está vacío, el backend siembra el
dataset reproducible (1.288 transacciones, perfiles diseñados — Marcela 957,
etc.) **antes** de servir requests. No hace falta Postgres ni disco persistente.

## Servicios

| Servicio | Root dir | Build | Start | Health |
|---|---|---|---|---|
| `polfin-backend` | `backend/` | `npm install` | `npm start` | `/api/health` |
| `polfin-frontend` | `frontend/` | `npm install && npm run build` | `npx next start -p $PORT` | — |

Node **22** pineado (`.nvmrc` + `engines.node`) — `node:sqlite` sin flag necesita ≥ 22.13.
`PORT` lo inyecta Render solo (no se declara): el backend bindea a `process.env.PORT`.

## Orden de deploy (importante)

1. **Deployá el backend primero.** Anotá su URL pública (ej. `https://polfin-backend.onrender.com`).
2. En el **frontend**, seteá `NEXT_PUBLIC_API_URL` con esa URL y (re)deployalo.
   La URL se **inlinea en el build** de Next → si la cambiás, hay que rebuildear.
3. (Opcional) En el **backend**, seteá `FRONTEND_URL` con la URL del front para
   acotar CORS. Sin setear, el backend acepta cualquier origen (funciona igual).

Con el `render.yaml` (Blueprint) los dos servicios se crean juntos; solo cargás
los valores marcados abajo.

## Variables de entorno por servicio

### Backend (`polfin-backend`)

| Variable | Secreto | Valor | De dónde sale |
|---|---|---|---|
| `NODE_ENV` | no | `production` | fijo (ya en render.yaml) |
| `LLM_MODE` | no | `gateway` | fijo (ya en render.yaml) |
| `GATEWAY_MODEL` | no | `anthropic/claude-sonnet-5` | fijo (ya en render.yaml) |
| `AI_GATEWAY_API_KEY` | **sí** | la key del AI Gateway de Vercel/V0 | la misma que está en `backend/.env` local (dashboard de Vercel AI Gateway) |
| `FRONTEND_URL` | no* | URL del frontend en Render | la sabés tras deployar el front (opcional; acota CORS) |
| `POLFIN_MONITOR_INTERVAL` | no | `0` | fijo (ya en render.yaml) — apaga el loop de fondo |
| `POLFIN_FUJI_RPC_URL` | no** | RPC de Fuji | opcional — solo si activás on-chain (ver abajo) |
| `POLFIN_OPERATOR_PRIVATE_KEY_FUJI` | **sí**** | private key de la wallet operadora de testnet | opcional — solo si activás on-chain |
| `POLFIN_0XGASLESS_BUNDLER_URL_FUJI` | **sí**** | URL del bundler (dashboard.0xgasless.com, incluye key) | opcional — solo si activás on-chain |
| `POLFIN_0XGASLESS_PAYMASTER_URL_FUJI` | **sí**** | URL del paymaster (dashboard.0xgasless.com, incluye key) | opcional — solo si activás on-chain |
| `PORT` | — | *(automático)* | lo inyecta Render; NO cargar a mano |

### Frontend (`polfin-frontend`)

| Variable | Secreto | Valor | De dónde sale |
|---|---|---|---|
| `NODE_ENV` | no | `production` | fijo (ya en render.yaml) |
| `NEXT_PUBLIC_API_URL` | no | URL pública del **backend** | la URL del `polfin-backend` (paso 1) |
| `PORT` | — | *(automático)* | lo inyecta Render; NO cargar a mano |

\* `FRONTEND_URL` no es un secreto, pero se carga a mano porque su valor
(la URL del front) no se conoce hasta después del primer deploy.

\*\* Las 4 variables de Fuji son **opcionales**: sin cargarlas, el backend
queda en `POLFIN_CHAIN_MODE=mock` (default, funciona igual salvo por las
funciones on-chain). Activalas recién cuando corras el deploy de contratos
(`contracts/deployments/fuji.json` todavía no existe) — ahí cargás las 4 en
el dashboard y agregás `POLFIN_CHAIN_MODE` con valor `fuji` en `render.yaml`.

**Secretos reales: `AI_GATEWAY_API_KEY`** siempre, y las 3 variables de Fuji
marcadas arriba **si** activás on-chain. Todo lo demás es config pública. El
`.env` con las keys **no** está en el repo (gitignoreado).

## Verificar tras el deploy

- Backend: `GET https://<backend>/api/health` → `{"ok":true,...,"transacciones":1288}`.
- Chat de Ángela (gateway): mandá una pregunta desde el panel del front; tiene
  que responder con datos reales (usa `AI_GATEWAY_API_KEY` + `LLM_MODE=gateway`).
- Camino feliz: generar una venta a plazo → e-pagaré → insights en el inicio →
  cerebro → mapa.

## CI/CD automático

Desde que se agregó `.github/workflows/ci.yml`, cada push/PR contra
`master` corre CI (backend, frontend, contracts — solo los jobs de las
carpetas que tocaste). Para que esto realmente bloquee deploys rotos hacen
falta tres pasos manuales, una sola vez, hechos por quien tenga permisos de
admin sobre el repo y la cuenta de Render:

### 1. Conectar el Blueprint de Render

1. Dashboard de Render → **New** → **Blueprint**.
2. Elegí el repo `lucaspippo/Hackathon-Shippear-Polfin`, rama `master`.
3. Render detecta `render.yaml` y propone crear `polfin-backend` y
   `polfin-frontend`.
4. Cargá los secretos marcados `sync: false` (ver tabla más arriba en este
   mismo archivo: `AI_GATEWAY_API_KEY` en el backend; `NEXT_PUBLIC_API_URL`
   en el frontend, una vez que sepas la URL pública del backend).
5. Confirmá. De acá en más, `autoDeploy: true` dispara un deploy en cada
   push a `master`.

### 2. Branch protection en `master`

Vía dashboard: Settings → Branches → Add branch protection rule →
`master` → tildar "Require status checks to pass before merging" →
seleccionar los tres jobs (`backend`, `frontend`, `contracts` —
aparecen en la lista después de que corran al menos una vez en un PR).

Vía `gh` CLI (alternativa, si lo tenés instalado y con permisos de admin):

```bash
gh api repos/lucaspippo/Hackathon-Shippear-Polfin/branches/master/protection \
  --method PUT \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["backend", "frontend", "contracts"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
EOF
```

### 3. GitHub Environment para el deploy de contratos

1. Settings → Environments → **New environment** → nombre `fuji-testnet`.
2. (Opcional pero recomendado) Agregar un "Required reviewer" — vos mismo o
   quien vaya a autorizar cada deploy — así el workflow de
   `contracts-deploy.yml` pide aprobación antes de correr.
3. En "Environment secrets", agregar:
   - `POLFIN_OPERATOR_PRIVATE_KEY_FUJI` — la private key de la wallet
     operadora de testnet (la misma que usás localmente en
     `contracts/.env`, nunca la de mainnet).
   - `POLFIN_FUJI_RPC_URL` — podés usar el público
     `https://api.avax-test.network/ext/bc/C/rpc` o uno propio.
4. Para disparar un deploy: Actions → "Deploy de contratos" → "Run
   workflow" → rama `master` → network `fuji`.

`contracts/hardhat.config.js` ya tiene configurada la red `avalanche` (mainnet), pero `contracts-deploy.yml` intencionalmente solo soporta `fuji` por ahora — habilitar deploy a mainnet desde CI es una decisión aparte, deliberada, que todavía no se tomó. El día que se agregue, se repite este mismo paso 3 con un Environment `mainnet` y reviewers **obligatorios** (no opcionales) dado que ahí se mueve gas real.
