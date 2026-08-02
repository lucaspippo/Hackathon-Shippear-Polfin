// backend/scripts/probar-x402-facilitator.js
//
// Prueba puntual del bounty/track de 0xgasless x402: construye una
// autorización EIP-3009 (transferWithAuthorization) firmada por una EOA y la
// manda al facilitator para que la liquide on-chain pagando el gas.
//
// OJO: esto es independiente del flujo gasless que ya usa PolFin
// (Smart Account + Paymaster/Bundler, ver backend/src/chain/gasless.js) —
// el x402 facilitator solo sabe liquidar transferWithAuthorization de un
// token EIP-3009, no llamar a registrarScore/generarInstrumento/mint. Es
// puramente para demostrar el requisito del sponsor, no queda wireado al
// pipeline de crédito.
//
// Shape del request confirmado leyendo la doc oficial real
// (docs.0xgasless.com/x402/facilitator-api/ — el fetch automático da 403,
// se leyó vía navegador) — el facilitator de 0xgasless usa un formato propio
// y más simple que el schema genérico del paquete npm "x402" (que es el de
// otro facilitator, el de Coinbase): acá no hay x402Version/scheme/asset/
// payTo, es directo { paymentPayload: {token, payload: {authorization,
// signature}}, paymentRequirements: {chainId, network?} }.
//
// Valores confirmados dos veces (on-chain vía RPC de Fuji y contra
// GET /tokens del facilitator — coinciden):
//   - FACILITATOR_CHAIN_ID: 43113 (Avalanche Fuji)
//   - TOKEN_ADDRESS: USDC testnet de Circle en Fuji, settlement "eip3009"
//   - TOKEN_NAME / TOKEN_VERSION: "USD Coin" / "2" (eip712Domain de /tokens)
//
// Todavía falta de tu lado:
//   - PAYER_PRIVATE_KEY: la EOA que firma la autorización — tiene que tener
//     balance de este USDC de prueba en Fuji (el facilitator paga el GAS,
//     no el valor transferido — conseguilo en faucet.circle.com, Fuji, USDC)
//   - RECIPIENT: a quién se le transfiere
//
// Uso: node backend/scripts/probar-x402-facilitator.js

import { Wallet } from 'ethers';

const FACILITATOR_URL = 'https://x402.0xgasless.com/settle';

const FACILITATOR_CHAIN_ID = 43113; // Avalanche Fuji
const TOKEN_ADDRESS = '0x5425890298aed601595a70AB815c96711a31Bc65'; // USDC testnet Fuji, confirmado en GET /tokens
const TOKEN_NAME = 'USD Coin'; // eip712Domain.name en GET /tokens
const TOKEN_VERSION = '2'; // eip712Domain.version en GET /tokens

const PAYER_PRIVATE_KEY = process.env.X402_PAYER_PRIVATE_KEY; // nunca hardcodear acá
const RECIPIENT = process.env.X402_RECIPIENT ?? '0x...';
const VALOR = '1000000'; // unidades atómicas del token (6 decimales → 1.000000 USDC)

if (!PAYER_PRIVATE_KEY) {
  console.error('Falta X402_PAYER_PRIVATE_KEY en el entorno (la EOA que firma y tiene balance del token).');
  process.exit(1);
}

const wallet = new Wallet(PAYER_PRIVATE_KEY);

const domain = {
  name: TOKEN_NAME,
  version: TOKEN_VERSION,
  chainId: FACILITATOR_CHAIN_ID,
  verifyingContract: TOKEN_ADDRESS,
};

const types = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

const validAfter = 0;
const validBefore = Math.floor(Date.now() / 1000) + 3600; // válida por 1 hora
const nonce = Wallet.createRandom().privateKey; // bytes32 random válido como nonce único

const authorizationForSigning = {
  from: wallet.address,
  to: RECIPIENT,
  value: VALOR,
  validAfter,
  validBefore,
  nonce,
};

console.log('Firmando autorización EIP-3009...');
const signature = await wallet.signTypedData(domain, types, authorizationForSigning);

// Shape real confirmado en docs.0xgasless.com/x402/facilitator-api/:
// paymentPayload.token (no paymentRequirements.asset), validAfter/validBefore
// como NÚMERO (no string), paymentRequirements solo necesita chainId
// (network es un slug opcional tipo "fuji", no "avalanche-fuji").
const paymentPayload = {
  token: TOKEN_ADDRESS,
  payload: {
    authorization: {
      from: authorizationForSigning.from,
      to: authorizationForSigning.to,
      value: authorizationForSigning.value,
      validAfter,
      validBefore,
      nonce,
    },
    signature,
  },
};

const paymentRequirements = {
  chainId: FACILITATOR_CHAIN_ID,
  network: 'fuji',
};

console.log('Mandando al facilitator...');
const res = await fetch(FACILITATOR_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ paymentPayload, paymentRequirements }),
});

const body = await res.json().catch(() => null);
console.log('Status HTTP:', res.status);
console.log('Respuesta:', body);

if (!res.ok || body?.success === false) {
  console.error('\nEl facilitator rechazó la liquidación — ver errorReason arriba.');
  process.exit(1);
}

console.log('\nOK — tx liquidada por el facilitator:', body?.transaction);
console.log('Ver en Snowtrace: https://testnet.snowtrace.io/tx/' + body?.transaction);
