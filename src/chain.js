import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';

export const CONTRACT = '0x3D749Aa486D9ecdA9e810dcA73CA2f138AD22DEB';

let readClient = createClient({ chain: studionet });
let writeClient = null;
let account = null;

export function currentAccount() {
  return account;
}

// Studionet as a wallet sees it. A transaction is built with chainId 0xf22f, so
// a wallet sitting on any other network rejects it with an invalid parameters
// error that says nothing about the actual problem. The network is therefore
// checked and switched before anything is signed.
const CHAIN_ID_HEX = '0xf22f';
const CHAIN_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: 'GenLayer Studionet',
  nativeCurrency: { name: 'GEN Token', symbol: 'GEN', decimals: 18 },
  rpcUrls: ['https://studio.genlayer.com/api'],
  blockExplorerUrls: ['https://explorer-studio.genlayer.com'],
};

export async function ensureStudionet() {
  if (!window.ethereum) throw new Error('No browser wallet found.');
  const current = await window.ethereum.request({ method: 'eth_chainId' });
  if (String(current).toLowerCase() === CHAIN_ID_HEX) return;
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (err) {
    // 4902 means the wallet does not know this network yet. Offer to add it,
    // rather than leaving the user to type five fields by hand.
    if (err && (err.code === 4902 || err.code === -32603)) {
      await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [CHAIN_PARAMS] });
      return;
    }
    throw new Error(
      'This app runs on GenLayer Studionet. Your wallet is on a different network and did not switch, '
      + 'so a transaction signed there would be rejected. Switch to Studionet and try again.'
    );
  }
}

export async function connect() {
  if (!window.ethereum) throw new Error('No browser wallet found. Install MetaMask to sign transactions.');
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  account = accounts[0];
  await ensureStudionet();
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
  // Checked again here, not only at connect: a wallet can be switched to
  // another network at any point after connecting, and the failure that causes
  // is an opaque invalid parameters error from the wallet.
  await ensureStudionet();
  try {
    return await writeClient.writeContract({ address: CONTRACT, functionName, args, value });
  } catch (err) {
    // The useful code is often two or three levels down a cause chain, and the
    // message viem puts on top says nothing a user can act on, so the whole
    // chain is walked and the text is matched as well as the code.
    const codes = [];
    const texts = [];
    for (let e = err, i = 0; e && i < 6; e = e.cause, i++) {
      if (e.code !== undefined) codes.push(e.code);
      if (e.shortMessage) texts.push(String(e.shortMessage));
      if (e.message) texts.push(String(e.message));
    }
    const blob = texts.join(' | ');
    if (codes.includes(4001) || /rejected the request|User denied/i.test(blob)) {
      throw new Error('You rejected the transaction in your wallet.');
    }
    if (codes.includes(-32602) || /invalid parameters|Missing or invalid parameters/i.test(blob)) {
      throw new Error(
        'Your wallet would not accept the transaction parameters. The usual cause is being on the '
        + 'wrong network: this app signs for GenLayer Studionet, chain id 61999. Check the network '
        + 'selected in your wallet, then try again.'
      );
    }
    throw err;
  }
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
