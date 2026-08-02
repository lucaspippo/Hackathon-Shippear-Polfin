# Deploy automático (back, front, contracts) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el circuito de auto-deploy sobre Render con un gate de CI en
GitHub Actions (backend, frontend, contracts), y agregar un workflow manual
separado para el deploy de contratos on-chain, sin introducir herramientas
nuevas de gestión de secretos.

**Architecture:** Un workflow `.github/workflows/ci.yml` con un job
`changes` (path-filter) que decide qué de los tres jobs (`backend`,
`frontend`, `contracts`) corre en cada push/PR contra `master`. Un segundo
workflow `.github/workflows/contracts-deploy.yml`, disparado solo a mano
(`workflow_dispatch`), corre el script de Hardhat existente contra Fuji
usando un GitHub Environment para secretos y aprobación. `DEPLOY.md` se
actualiza con los pasos manuales que no son automatizables (conectar el
Blueprint de Render, activar branch protection, crear el Environment de
GitHub).

**Tech Stack:** GitHub Actions (`actions/checkout@v4`,
`actions/setup-node@v4`, `dorny/paths-filter@v3`), Node 22, npm, Hardhat
(ya en `contracts/`), Next.js/ESLint (ya en `frontend/`).

## Global Constraints

- Node **22.x** en todos los jobs de CI (mismo pin que `engines.node` en
  `backend/package.json` y `frontend/package.json`; `contracts/package.json`
  no lo declara hoy, no hace falta agregarlo en este plan).
- Usar `npm ci` (no `npm install`) en CI — los tres `package-lock.json` ya
  existen.
- Identificadores, comentarios y nombres de jobs en **español**, consistente
  con el resto del repo (ver `CLAUDE.md`).
- No se toca Render como proveedor, no se agrega Doppler ni ninguna otra
  herramienta de secretos — decisiones ya tomadas en la spec
  (`docs/superpowers/specs/2026-08-02-deploy-automatico-design.md`).
- El deploy de contratos a `avalanche`/mainnet queda fuera de este plan
  (red no configurada aún en `contracts/hardhat.config.js`) — solo `fuji`.
- Acciones que tocan configuración compartida del repo en GitHub (branch
  protection, creación del Environment) requieren permisos de admin que
  puede no tener quien ejecute este plan, y son cambios visibles para todo
  el equipo — **quedan documentadas como pasos manuales, no como tareas
  automatizadas**, y cualquier `git push`/PR contra el repo compartido debe
  confirmarse con el usuario antes de ejecutarse.

---

### Task 1: CI — job `changes` (path-filter) + job `backend`

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: workflow `CI` con trigger `push`/`pull_request` sobre `master`;
  job `changes` con outputs `backend`, `frontend`, `contracts` (booleans
  como string `'true'`/`'false'`); job `backend`.

- [ ] **Step 1: Crear el workflow con el job `changes` y el job `backend`**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  # Decide qué jobs corren según qué carpetas tocó el push/PR.
  changes:
    runs-on: ubuntu-latest
    outputs:
      backend: ${{ steps.filter.outputs.backend }}
      frontend: ${{ steps.filter.outputs.frontend }}
      contracts: ${{ steps.filter.outputs.contracts }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            backend:
              - 'backend/**'
            frontend:
              - 'frontend/**'
            contracts:
              - 'contracts/**'

  backend:
    needs: changes
    if: needs.changes.outputs.backend == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json
      - name: Instalar dependencias
        working-directory: backend
        run: npm ci
      - name: Seedear la DB (valida schema + seed determinístico)
        working-directory: backend
        run: npm run seed
      - name: Levantar el server y chequear /api/health
        working-directory: backend
        env:
          LLM_MODE: mock
          POLFIN_MONITOR_INTERVAL: '0'
        run: |
          node src/server.js &
          SERVER_PID=$!
          ok=""
          for i in $(seq 1 20); do
            if curl -sf http://localhost:4000/api/health -o /tmp/health.json; then
              ok=1
              break
            fi
            sleep 1
          done
          cat /tmp/health.json || true
          kill "$SERVER_PID" 2>/dev/null || true
          [ -n "$ok" ] || (echo "el server nunca respondió" && exit 1)
          grep -q '"ok":true' /tmp/health.json
```

- [ ] **Step 2: Rehearsal local del job backend**

Corré exactamente los mismos comandos que el job, desde la raíz del repo:

```bash
cd backend
npm ci
npm run seed
LLM_MODE=mock POLFIN_MONITOR_INTERVAL=0 node src/server.js &
SERVER_PID=$!
sleep 2
curl -sf http://localhost:4000/api/health
kill $SERVER_PID
```

Expected: el `curl` imprime `{"ok":true,"servicio":"polfin-api","transacciones":1288}`.

- [ ] **Step 3: Validar sintaxis YAML**

Run: `node -e "require('js-yaml') ? '' : ''"` no está disponible sin
dependencia — en su lugar, usá el linter online de GitHub o simplemente
confiá en el parseo real del Step 5 (push a una rama). Si tenés `python3`
disponible localmente podés validar rápido:

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"`
Expected: sin output (no levanta excepción). Si no tenés `python3`, saltá
este check — el Step 5 de la Task 7 (push real) es la validación definitiva.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: agregar job de CI para backend con path-filter"
```

---

### Task 2: CI — job `frontend`

**Files:**
- Modify: `.github/workflows/ci.yml` (agregar job `frontend`)

**Interfaces:**
- Consumes: output `needs.changes.outputs.frontend` del job `changes`
  (Task 1).
- Produces: job `frontend` en el mismo workflow.

- [ ] **Step 1: Agregar el job `frontend` al final de `ci.yml`**

```yaml
  frontend:
    needs: changes
    if: needs.changes.outputs.frontend == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json
      - name: Instalar dependencias
        working-directory: frontend
        run: npm ci
      - name: Lint
        working-directory: frontend
        run: npm run lint
      - name: Build
        working-directory: frontend
        env:
          NEXT_PUBLIC_API_URL: http://localhost:4000
        run: npm run build
```

- [ ] **Step 2: Rehearsal local del job frontend**

```bash
cd frontend
npm ci
npm run lint
NEXT_PUBLIC_API_URL=http://localhost:4000 npm run build
```

Expected: `lint` termina sin errores (warnings están OK), `build` termina
con "Compiled successfully" (o equivalente de Next 16) y exit code 0.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: agregar job de CI para frontend (lint + build)"
```

---

### Task 3: CI — job `contracts`

**Files:**
- Modify: `.github/workflows/ci.yml` (agregar job `contracts`)

**Interfaces:**
- Consumes: output `needs.changes.outputs.contracts` del job `changes`
  (Task 1).
- Produces: job `contracts` en el mismo workflow.

- [ ] **Step 1: Agregar el job `contracts` al final de `ci.yml`**

```yaml
  contracts:
    needs: changes
    if: needs.changes.outputs.contracts == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: contracts/package-lock.json
      - name: Instalar dependencias
        working-directory: contracts
        run: npm ci
      - name: Compilar contratos
        working-directory: contracts
        run: npx hardhat compile
      - name: Correr tests
        working-directory: contracts
        run: npx hardhat test
```

- [ ] **Step 2: Rehearsal local del job contracts**

```bash
cd contracts
npm ci
npx hardhat compile
npx hardhat test
```

Expected: compile sin errores; los tests de `EPagare.test.js`,
`MockUSDC.test.js` y `ScoreRegistry.test.js` pasan (exit code 0).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: agregar job de CI para contracts (compile + test)"
```

---

### Task 4: Alinear el nombre de la private key en `hardhat.config.js`

`contracts/.env.example` y `backend/.env.example` documentan
`POLFIN_OPERATOR_PRIVATE_KEY_FUJI` (con sufijo de red, para no mezclar la
wallet de testnet con la de mainnet), pero `contracts/hardhat.config.js`
hoy lee `process.env.POLFIN_OPERATOR_PRIVATE_KEY` (sin sufijo). Sin este
fix, el workflow de deploy manual (Task 5) nunca va a levantar la key desde
el secreto correcto.

**Files:**
- Modify: `contracts/hardhat.config.js:15`

**Interfaces:**
- Consumes: variable de entorno `POLFIN_OPERATOR_PRIVATE_KEY_FUJI` (ya
  documentada en `contracts/.env.example`, sin cambios ahí).
- Produces: red `fuji` de Hardhat configurada con la key correcta.

- [ ] **Step 1: Corregir el nombre de la variable**

En `contracts/hardhat.config.js`, cambiar:

```js
      accounts: process.env.POLFIN_OPERATOR_PRIVATE_KEY ? [process.env.POLFIN_OPERATOR_PRIVATE_KEY] : [],
```

por:

```js
      accounts: process.env.POLFIN_OPERATOR_PRIVATE_KEY_FUJI ? [process.env.POLFIN_OPERATOR_PRIVATE_KEY_FUJI] : [],
```

- [ ] **Step 2: Verificar que `contracts/test/` sigue pasando (no toca la red `fuji`, corre en la red default in-memory de Hardhat)**

Run: `cd contracts && npx hardhat test`
Expected: mismos resultados que en Task 3 Step 2 (nada debería cambiar, la
red default de tests no usa este `accounts` array).

- [ ] **Step 3: Commit**

```bash
git add contracts/hardhat.config.js
git commit -m "fix(contracts): alinear nombre de env var de la private key con .env.example"
```

---

### Task 5: Workflow manual de deploy de contratos a Fuji

**Files:**
- Create: `.github/workflows/contracts-deploy.yml`

**Interfaces:**
- Consumes: secretos del GitHub Environment `fuji-testnet`:
  `POLFIN_OPERATOR_PRIVATE_KEY_FUJI`, `POLFIN_FUJI_RPC_URL` (este último no
  es secreto pero se define igual en el Environment por simplicidad — ver
  Task 6). Usa el script existente `contracts/scripts/deploy.js` (sin
  cambios) y la red `fuji` de `contracts/hardhat.config.js` (Task 4).
- Produces: workflow `contracts-deploy` disparable solo por
  `workflow_dispatch`, con input `network` (única opción hoy: `fuji`).

- [ ] **Step 1: Crear el workflow**

```yaml
# .github/workflows/contracts-deploy.yml
name: Deploy de contratos

on:
  workflow_dispatch:
    inputs:
      network:
        description: 'Red destino del deploy'
        required: true
        type: choice
        options:
          - fuji

jobs:
  deploy:
    runs-on: ubuntu-latest
    # El Environment exige (si así se configuró en el repo, ver DEPLOY.md)
    # aprobación manual de un reviewer antes de correr — un deploy gasta
    # gas real y genera una address nueva cada vez.
    environment: fuji-testnet
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: contracts/package-lock.json
      - name: Instalar dependencias
        working-directory: contracts
        run: npm ci
      - name: Deploy a ${{ inputs.network }}
        working-directory: contracts
        env:
          POLFIN_OPERATOR_PRIVATE_KEY_FUJI: ${{ secrets.POLFIN_OPERATOR_PRIVATE_KEY_FUJI }}
          POLFIN_FUJI_RPC_URL: ${{ secrets.POLFIN_FUJI_RPC_URL }}
        run: npx hardhat run scripts/deploy.js --network ${{ inputs.network }}
      - name: Subir direcciones deployadas como artifact
        uses: actions/upload-artifact@v4
        with:
          name: contracts-deployment-${{ inputs.network }}
          path: contracts/deployments/${{ inputs.network }}.json
```

- [ ] **Step 2: Validar sintaxis YAML (mismo método que Task 1 Step 3)**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/contracts-deploy.yml'))"`
Expected: sin output. Si no hay `python3`, saltar — se valida en real cuando
el usuario lo dispare desde GitHub (fuera de este plan; requiere que el
Environment y sus secretos existan, ver Task 6).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/contracts-deploy.yml
git commit -m "ci: agregar workflow manual de deploy de contratos a fuji"
```

---

### Task 6: Documentar los pasos manuales en `DEPLOY.md`

Estos tres pasos requieren acceso de admin al repo/cuenta de Render y no
son automatizables por un agente: conectar el Blueprint, activar branch
protection, y crear el GitHub Environment con sus secretos. Se documentan
para que el dueño del repo (o quien tenga permisos) los ejecute una sola
vez.

**Files:**
- Modify: `DEPLOY.md` (agregar sección nueva al final)

- [ ] **Step 1: Agregar la sección "CI/CD automático" a `DEPLOY.md`**

Agregar al final del archivo:

```markdown
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

\`\`\`bash
gh api repos/lucaspippo/Hackathon-Shippear-Polfin/branches/master/protection \
  -X PUT \
  -H "Accept: application/vnd.github+json" \
  -f required_status_checks.strict=true \
  -f 'required_status_checks.contexts[]=backend' \
  -f 'required_status_checks.contexts[]=frontend' \
  -f 'required_status_checks.contexts[]=contracts' \
  -f enforce_admins=false \
  -f required_pull_request_reviews=null \
  -f restrictions=null
\`\`\`

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

El día que el plan on-chain real agregue la red `avalanche` a
`hardhat.config.js`, se repite este mismo paso 3 con un Environment
`mainnet` y reviewers **obligatorios** (no opcionales) dado que ahí se
mueve gas real.
```

- [ ] **Step 2: Commit**

```bash
git add DEPLOY.md
git commit -m "docs(deploy): documentar pasos manuales de CI/CD (blueprint, branch protection, environment)"
```

---

### Task 7: Verificación end-to-end en GitHub (requiere confirmación antes de pushear)

Este es el único paso que efectivamente empuja algo al repo compartido y
abre un PR visible para el equipo — **confirmá con el usuario antes de
correr el Step 1**.

**Files:** ninguno nuevo — solo verifica lo de las Tasks 1-6 corriendo de
verdad en GitHub Actions.

- [ ] **Step 1 (pedir confirmación primero): Pushear una rama y abrir un PR de prueba**

```bash
git push -u origin HEAD:ci/deploy-automatico
gh pr create --title "ci: deploy automatico (back, front, contracts)" \
  --body "Agrega CI (backend/frontend/contracts) + workflow manual de deploy de contratos. Ver docs/superpowers/specs/2026-08-02-deploy-automatico-design.md." \
  --base master
```

Si no hay `gh` CLI disponible, abrir el PR a mano desde la UI de GitHub
con la misma rama.

- [ ] **Step 2: Verificar que los tres jobs corren y pasan**

En la pestaña "Checks" del PR, confirmar que `changes`, `backend`,
`frontend` y `contracts` corrieron (los tres últimos solo si el PR tocó
esas carpetas — como este PR toca las tres, deberían correr los tres) y
terminaron en verde.

- [ ] **Step 3: Probar que un cambio roto efectivamente falla el check**

En la misma rama, romper algo trivial y reversible (ej.: agregar una línea
`;;;` suelta en `frontend/app/page.tsx`), pushear, confirmar que el job
`frontend` se pone rojo, después revertir ese commit y pushear de nuevo.

```bash
git revert HEAD --no-edit
git push
```

- [ ] **Step 4: Mergear el PR (con confirmación del usuario) y cerrar el loop**

Una vez todo en verde y el branch protection del Task 6 activado, mergear.
A partir de acá, todo push a `master` pasa por CI antes de disparar el
auto-deploy de Render.

---

## Self-Review

**Cobertura de la spec:**
- CI backend/frontend/contracts con path-filter → Tasks 1-3. ✅
- Branch protection → documentado en Task 6 (no automatizable sin admin en
  este entorno). ✅
- Conectar Blueprint de Render → documentado en Task 6 (paso manual por
  diseño, requiere OAuth del dueño de la cuenta). ✅
- Secretos: Render dashboard (ya está, sin cambios) + GitHub Environment
  secrets → Task 6. ✅
- Workflow manual de deploy de contratos con Environment/reviewers → Task 5
  + Task 6. ✅
- Desalineamiento de nombre de env var de la private key, marcado en la
  spec como bloqueante para el workflow de deploy → Task 4. ✅
- Fuera de alcance (Doppler, migrar de proveedor, red `avalanche`, lint en
  backend) → correctamente no incluido en ninguna task. ✅

**Placeholder scan:** sin TBD/TODO — todos los YAML y comandos están
completos y son ejecutables tal cual.

**Consistencia de nombres:** `POLFIN_OPERATOR_PRIVATE_KEY_FUJI` usado igual
en Task 4, Task 5 y Task 6; nombres de jobs (`backend`, `frontend`,
`contracts`, `changes`) consistentes entre `ci.yml` (Tasks 1-3) y el texto
de branch protection (Task 6).
