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
| `PORT` | — | *(automático)* | lo inyecta Render; NO cargar a mano |

### Frontend (`polfin-frontend`)

| Variable | Secreto | Valor | De dónde sale |
|---|---|---|---|
| `NODE_ENV` | no | `production` | fijo (ya en render.yaml) |
| `NEXT_PUBLIC_API_URL` | no | URL pública del **backend** | la URL del `polfin-backend` (paso 1) |
| `PORT` | — | *(automático)* | lo inyecta Render; NO cargar a mano |

\* `FRONTEND_URL` no es un secreto, pero se carga a mano porque su valor
(la URL del front) no se conoce hasta después del primer deploy.

**Único secreto real: `AI_GATEWAY_API_KEY`** (en el backend). Todo lo demás es
config pública. El `.env` con la key **no** está en el repo (gitignoreado).

## Verificar tras el deploy

- Backend: `GET https://<backend>/api/health` → `{"ok":true,...,"transacciones":1288}`.
- Chat de Ángela (gateway): mandá una pregunta desde el panel del front; tiene
  que responder con datos reales (usa `AI_GATEWAY_API_KEY` + `LLM_MODE=gateway`).
- Camino feliz: generar una venta a plazo → e-pagaré → insights en el inicio →
  cerebro → mapa.
