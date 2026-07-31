import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';

export const CONTRACT = '0x3D749Aa486D9ecdA9e810dcA73CA2f138AD22DEB';

let readClient = createClient({ chain: studionet });
let writeClient = null;
let account = null;

export function currentAccount() {
  return account;
}

export async function connect() {
  if (!window.ethereum) throw new Error('No browser wallet found. Install MetaMask to sign transactions.');
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  account = accounts[0];
  writeClient = createClient({ chain: studionet, account, provider: window.ethereum });
  return account;
}

/** Read a view method. Every view on this contract returns a JSON string. */
export async function read(functionName, args = []) {
  const raw = await readClient.readContract({ address: CONTRACT, functionName, args });
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Send a write method. `value` is in wei and only used by payable methods. */
export async function write(functionName, args = [], value = 0n) {
  if (!writeClient) throw new Error('Connect a wallet first.');
  return writeClient.writeContract({ address: CONTRACT, functionName, args, value });
}

export const GEN = 10n ** 18n;

export function toGen(wei) {
  if (wei === null || wei === undefined) return '0';
  const v = BigInt(wei);
  const whole = v / GEN;
  const frac = (v % GEN) / (10n ** 15n);
  return frac === 0n ? `${whole}` : `${whole}.${String(frac).padStart(3, '0')}`;
}

/** Turn a typed GEN amount such as "2.5" into wei, to three decimal places. */
export function toWei(text) {
  const n = parseFloat(String(text || '0'));
  if (!isFinite(n) || n <= 0) return 0n;
  return BigInt(Math.round(n * 1000)) * (GEN / 1000n);
}

export function shortAddr(a) {
  if (!a) return '';
  const s = String(a);
  return s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s;
}
