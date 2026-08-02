// backend/src/chain/gasless.js
//
// Envuelve la wallet operadora en una Smart Account de 0xgasless (ERC-4337)
// para mandar las tres llamadas on-chain con el gas patrocinado por el
// paymaster, en vez de que la wallet lo pague de su bolsillo.
//
// Investigación real del SDK (Tarea 6, Step 1) — confirmado leyendo
// backend/node_modules/@0xgasless/smart-account/{README.md,dist/_types/**}:
//
//   - paquete: @0xgasless/smart-account@0.0.13 (ya en package.json).
//     Dos gaps de empaquetado reales que hubo que resolver a mano porque el
//     propio paquete no los declara bien (`npm view @0xgasless/smart-account
//     dependencies` devuelve vacío pese a que node_modules/@0xgasless/
//     smart-account/package.json sí lista "merkletreejs" — bug de metadata
//     del publish, no nuestro):
//       - "viem": peerDependency real (^2) — sin instalarla, el import
//         explota con "Cannot find package 'viem'" (dist/_esm importa de
//         viem/viem-chains directo). Agregada a package.json.
//       - "merkletreejs": dependency directa del propio paquete, pero
//         ausente de package-lock.json porque `npm install
//         @0xgasless/smart-account` no la trajo. Agregada a package.json
//         para que el import no explote (confirmado: sin esto,
//         "Cannot find package 'merkletreejs'").
//   - función de wrap: `createSmartAccountClient` (named export del root,
//     alias de `ZeroXgaslessSmartAccount.create` — ver
//     dist/_types/account/index.d.ts). Config confirmada en
//     dist/_types/account/utils/Types.d.ts (ZeroXgaslessSmartAccountV2Config):
//       - `signer` (requerido si no se pasa defaultValidationModule): acepta
//         un ethers Wallet directo — dist/_esm/account/utils/convertSigner.js
//         lo detecta por duck-typing (`signer.provider !== undefined`) y lo
//         envuelve en su propio EthersSigner. Confirmado que EXIGE que la
//         wallet ya tenga `.provider` seteado (si no, tira
//         "Cannot consume an ethers Wallet without a provider") —
//         obtenerWalletOperador() ya la conecta a un JsonRpcProvider, ok.
//       - `bundlerUrl` / `paymasterUrl` (NO `apiKey` suelto): son URLs
//         completas que provee el dashboard de 0xgasless y ya incluyen la
//         key en el path (ver ejemplo real en el código fuente del propio
//         SDK, dist/_esm/account/0xGaslessSmartAccount.js ~L816:
//         "https://bundler.0xgasless.com/api/v2/84532/<key>"). El esqueleto
//         original de esta tarea asumía un `apiKey` suelto + `chainId` —
//         ajustado acá a lo que el SDK realmente pide.
//       - `chainId`: opcional pero lo pasamos explícito (43113/43114, ambos
//         resueltos por `viem/chains` según dist/_esm/account/utils/
//         getChain.js — no hace falta `viemChain` override).
//       - `rpcUrl`: opcional ("we set default rpc url if not passed" según
//         el doc comment del tipo), pero lo pasamos explícito con la misma
//         URL que usa provider.js: confirmado que convertSigner.js intenta
//         derivarlo de `ethersSigner.provider?.connection?.url`, que es un
//         campo de ethers v5 — con ethers v6 (lo que usa este repo,
//         `ethers.JsonRpcProvider`) ese campo no existe, así que sin pasarlo
//         a mano el SDK se queda sin rpcUrl derivado del signer.
//   - método de envío: `cuenta.sendTransaction({to, data, value},
//     buildUseropDto)` (dist/_types/account/0xGaslessSmartAccount.d.ts).
//     Confirmado leyendo el código fuente (no solo los tipos) que el
//     patrocinio NO es automático: si `buildUseropDto.paymasterServiceData`
//     no tiene `mode: PaymasterMode.SPONSORED`, el userOp se arma sin tocar
//     el paymaster (gas pagado por la propia Smart Account). Por eso acá
//     SIEMPRE se manda `{ paymasterServiceData: { mode: PaymasterMode.SPONSORED } }`.
//   - devuelve receipt con logs: sí, pero en dos pasos. `sendTransaction`
//     devuelve un `UserOpResponse` (dist/_types/bundler/utils/Types.d.ts):
//     `{ userOpHash, wait(confirmations?), waitForTxHash() }` — NO el
//     receipt todavía. Hay que llamar a `.wait()`, que devuelve un
//     `UserOpReceipt`: `{ userOpHash, entryPoint, paymaster, actualGasCost,
//     actualGasUsed, success: "true"|"false", reason, logs: any[],
//     receipt: any }` — el campo anidado `.receipt` es el receipt on-chain
//     real (el README lo confirma: `const { receipt: { transactionHash} } =
//     await wait()`), y ahí es donde están los `.logs` que necesita
//     mintearInstrumentoOnChain.
//   - dirección counterfactual: sí existe — `cuenta.getAddress(params?)`
//     (dist/_types/account/0xGaslessSmartAccount.d.ts) — funciona antes de
//     que la Smart Account tenga ninguna tx propia on-chain, la usa la
//     Tarea 8 para transferOwnership post-deploy.
//
// Lo que queda genuinamente sin confirmar (no hay forma de probarlo sin
// credenciales reales de dashboard.0xgasless.com — diferido a la Tarea 14):
//   - El formato exacto de bundlerUrl/paymasterUrl para Avalanche Fuji/mainnet
//     (el único ejemplo real visto en el propio código fuente del SDK es
//     para Base Sepolia, chainId 84532) — se asume que dashboard.0xgasless.com
//     entrega URLs con la misma forma para cualquier red soportada.
//   - Si 0xgasless soporta Avalanche C-Chain (43114) y Fuji (43113) en su
//     bundler/paymaster hospedado — el SDK en sí es agnóstico de red (usa
//     viem/chains para resolver el chainId), pero el servicio hospedado de
//     0xgasless podría no tener bundler/paymaster desplegado en esas redes.
//     Se confirma recién con las URLs reales del dashboard (Tarea 14).
import { createSmartAccountClient, PaymasterMode } from '@0xgasless/smart-account';
import { obtenerWalletOperador, obtenerRedActiva } from './provider.js';

const CHAIN_ID = { fuji: 43113, avalanche: 43114 };

const cuentas = {};

async function obtenerSmartAccount() {
  const red = obtenerRedActiva();
  if (cuentas[red]) return cuentas[red];

  const sufijo = red.toUpperCase();
  const bundlerUrl = process.env[`POLFIN_0XGASLESS_BUNDLER_URL_${sufijo}`];
  const paymasterUrl = process.env[`POLFIN_0XGASLESS_PAYMASTER_URL_${sufijo}`];
  if (!bundlerUrl || !paymasterUrl) {
    throw new Error(
      `faltan POLFIN_0XGASLESS_BUNDLER_URL_${sufijo} y/o POLFIN_0XGASLESS_PAYMASTER_URL_${sufijo} en POLFIN_CHAIN_MODE=${red}`,
    );
  }
  const rpcUrl = process.env[`POLFIN_${sufijo}_RPC_URL`];

  const cuenta = await createSmartAccountClient({
    signer: obtenerWalletOperador(),
    chainId: CHAIN_ID[red],
    bundlerUrl,
    paymasterUrl,
    rpcUrl,
  });
  cuentas[red] = cuenta;
  return cuenta;
}

// Manda `data` (calldata ya codificado) a `to`, patrocinado por el paymaster
// de la red activa. Devuelve el hash y, si está disponible, el receipt
// completo (lo necesita mintearInstrumentoOnChain para leer el evento).
export async function enviarSponsored({ to, data, value = 0n }) {
  const cuenta = await obtenerSmartAccount();
  const userOp = await cuenta.sendTransaction(
    { to, data, value },
    { paymasterServiceData: { mode: PaymasterMode.SPONSORED } },
  );
  if (userOp.error) {
    throw new Error(`0xgasless rechazó el userOp: ${userOp.error.message}`);
  }
  const userOpReceipt = await userOp.wait();
  if (userOpReceipt.success === 'false') {
    throw new Error(`userOp de 0xgasless falló on-chain: ${userOpReceipt.reason || 'sin razón informada'}`);
  }
  const receipt = userOpReceipt.receipt ?? null;
  const tx_hash = receipt?.transactionHash ?? receipt?.hash ?? userOpReceipt.userOpHash;
  return { tx_hash, receipt };
}

// Dirección de la Smart Account de la red dada — la usa contracts/scripts/deploy.js
// (vía su propia copia en contracts/scripts/lib/smartAccount.js, Tarea 8) para
// transferirle el ownership de los tres contratos justo después de deployarlos.
export async function obtenerDireccionSmartAccount() {
  const cuenta = await obtenerSmartAccount();
  return cuenta.getAddress();
}
