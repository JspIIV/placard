// Regression tests for campaign local solvency in Placard.
//
// Each case asserts a specific abuse is refused on chain. These exist because a
// reviewer asked for them, and because the contract previously allowed all three:
//   1. more pending periods than the campaign has budget for
//   2. closing a campaign while undecided work still points at its escrow
//   3. verifying or disputing a period after its campaign is closed
// The fourth case checks the invariant behind all of them, that one campaign can
// never pay out value escrowed by another.
import { Wallet } from 'file:///C:/Users/ysfym/AppData/Roaming/npm/node_modules/genlayer/node_modules/ethers/lib.esm/index.js';
import { createClient, createAccount } from './node_modules/genlayer-js/dist/index.js';
import { studionet } from './node_modules/genlayer-js/dist/chains/index.js';
import fs from 'fs';

const ADDR = process.env.PLACARD_ADDR;
const KS = String.raw`C:\Users\ysfym\.genlayer\keystores`;
const GEN = 10n ** 18n;

async function load(name, password) {
  const w = await Wallet.fromEncryptedJson(fs.readFileSync(`${KS}/${name}.json`, 'utf8'), password);
  return createClient({ chain: studionet, account: createAccount(w.privateKey) });
}
const reader = createClient({ chain: studionet });

// Studionet drops connections often enough that an unretried call turns a
// contract test into a network test. Only transport failures are retried; a
// refusal by the contract is a result, not an error, and must reach the caller.
function isTransport(e) {
  const s = String(e && (e.details || e.message) || e);
  return /fetch failed|ECONNRESET|socket|timeout|Unexpected token '<'|503|502|429|Rate limit/i.test(s);
}
async function retry(label, fn, attempts = 5) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); } catch (e) {
      if (!isTransport(e)) throw e;
      last = e;
      const wait = 5000 * i;
      console.log(`  ..    ${label}: transport error, retry ${i}/${attempts} in ${wait / 1000}s`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw last;
}

async function read(fn, args = []) {
  const raw = await retry(`read ${fn}`, () => reader.readContract({ address: ADDR, functionName: fn, args }));
  try { return JSON.parse(raw); } catch { return raw; }
}

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}\n        ${detail}`); }
}

async function send(client, fn, args, value = 0n) {
  const hash = await retry(`send ${fn}`, () => client.writeContract({ address: ADDR, functionName: fn, args, value }));
  const r = await retry(`receipt ${fn}`, () =>
    client.waitForTransactionReceipt({ hash, status: 'FINALIZED', retries: 60, interval: 15000 }));
  const lr = r?.consensus_data?.leader_receipt?.[0];
  const exec = String(lr?.execution_result ?? r?.execution_result ?? '?');
  let msg = '';
  try { msg = JSON.stringify(lr?.result ?? '').slice(0, 300); } catch { msg = ''; }
  return { ok: !exec.toUpperCase().includes('ERROR'), exec, msg };
}

// Asserts the call is refused by the contract rather than succeeding.
async function mustReject(name, client, fn, args, value = 0n) {
  try {
    const r = await send(client, fn, args, value);
    check(name, !r.ok, `call succeeded but should have been refused (${r.exec})`);
  } catch (e) {
    check(name, true);
  }
}
async function mustAccept(name, client, fn, args, value = 0n) {
  const r = await send(client, fn, args, value);
  check(name, r.ok, `call was refused: ${r.exec} ${r.msg}`);
  return r;
}

const advertiser = await load('padv', 'placard-test-adv-2026');
const publisher = await load('ppub', 'placard-test-pub-2026');

const BRAND = 'Next.js';
const CREATIVE = 'A promotional presentation of the Next.js brand on its own official project page, naming Next.js and describing it as a React framework for building web applications';
const REQUIREMENT = 'The placement must appear on the official project page that the Next.js team themselves publish and control';
const SAFETY = 'The placement must never appear on a page whose primary subject is gambling, sports betting or wagering of any kind';
const GOOD = 'https://github.com/vercel/next.js';

console.log('contract', ADDR);
let st = await read('get_stats');
console.log('stats   ', JSON.stringify(st));

// Resumable: Studionet drops often enough that a rerun after a transport failure
// must not repeat setup it already landed on chain.
console.log('\n--- setup ---');
if (Number(st.campaigns) < 1) {
  await mustAccept('open campaign 0, 2 periods of 1 GEN', advertiser, 'open_campaign',
    [BRAND, CREATIVE, REQUIREMENT, SAFETY, '2', '3'], 2n * GEN);
} else console.log('  skip  campaign 0 already open');
st = await read('get_stats');
if (Number(st.campaigns) < 2) {
  await mustAccept('open campaign 1, the neighbour', advertiser, 'open_campaign',
    [BRAND, CREATIVE, REQUIREMENT, SAFETY, '2', '3'], 2n * GEN);
} else console.log('  skip  neighbouring campaign already open');
st = await read('get_stats');
if (Number(st.placements) < 1) {
  await mustAccept('enrol placement on campaign 0', publisher, 'enrol_placement',
    ['0', 'Next.js Official Project Page', GOOD]);
} else console.log('  skip  placement already enrolled');

console.log('\n--- case 1: concurrent pending periods cannot exceed the budget ---');
st = await read('get_stats');
if (Number(st.periods) < 1) {
  await mustAccept('submit period 1 of 2', publisher, 'submit_period', ['0', GOOD]);
} else console.log('  skip  period 1 already submitted');
st = await read('get_stats');
if (Number(st.periods) < 2) {
  await mustAccept('submit period 2 of 2', publisher, 'submit_period', ['0', GOOD]);
} else console.log('  skip  period 2 already submitted');
await mustReject('third period is refused while two are pending', publisher, 'submit_period', ['0', GOOD]);
const c0 = await read('get_campaign', ['0']);
check('campaign records 2 pending periods', Number(c0.periods_pending) === 2, `got ${c0.periods_pending}`);

console.log('\n--- case 2: closing over undecided work is refused ---');
await mustReject('close is refused while periods are pending', advertiser, 'close_campaign', ['0']);

console.log('\n--- deciding both periods ---');
await mustAccept('verify period 0', publisher, 'verify_period', ['0']);
await mustAccept('verify period 1', publisher, 'verify_period', ['1']);
const c0b = await read('get_campaign', ['0']);
check('pending returns to zero once decided', Number(c0b.periods_pending) === 0, `got ${c0b.periods_pending}`);

console.log('\n--- case 4: a campaign never pays out more than it holds ---');
const held = BigInt(c0b.escrowed_wei);
const budget = BigInt(c0b.budget_wei);
const released = BigInt(c0b.released_wei);
const refunded = BigInt(c0b.refunded_wei);
check('escrow equals budget minus released and refunded',
  held === budget - released - refunded,
  `held=${held} budget=${budget} released=${released} refunded=${refunded}`);
check('released never exceeds budget', released <= budget, `released=${released} budget=${budget}`);

console.log('\n--- case 3: nothing runs after closure ---');
await mustAccept('close campaign 0 once decided', advertiser, 'close_campaign', ['0']);
await mustReject('verification after closure is refused', publisher, 'verify_period', ['0']);
await mustReject('submitting after closure is refused', publisher, 'submit_period', ['0', GOOD]);

// Case 6. A payable call that the contract refuses must give the value back.
// Raising out of a payable method reverts the state change but not the transfer
// in, so a guard that raises is a way to strand a caller's money here forever.
// Measured before the fix: a refused dispute left the contract 1 GEN heavier and
// the caller 1 GEN poorer.
console.log('\n--- case 6: a refused payable call returns the value ---');
async function chainBalance(a) {
  const r = await fetch('https://studio.genlayer.com/api', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [a, 'latest'], id: 1 }),
  });
  return BigInt((await r.json()).result);
}
const PUB_ADDR = '0x0b57877ec84d96b672cd47d8ea4424283fdb9f6c';
const beforeRefusal = { c: await chainBalance(ADDR), p: await chainBalance(PUB_ADDR) };
await send(publisher, 'dispute_period', ['1', 'contesting after the campaign closed', GOOD], 1n * GEN);
const afterRefusal = { c: await chainBalance(ADDR), p: await chainBalance(PUB_ADDR) };
check('a refused dispute leaves nothing behind in the contract',
  afterRefusal.c === beforeRefusal.c,
  `contract moved by ${afterRefusal.c - beforeRefusal.c} wei`);
check('a refused dispute returns the bond to the caller',
  afterRefusal.p === beforeRefusal.p,
  `caller moved by ${afterRefusal.p - beforeRefusal.p} wei`);
const disputesAfter = Number((await read('get_stats')).disputes);
check('a refused dispute opens no dispute record', disputesAfter === 0, `got ${disputesAfter}`);

const c0c = await read('get_campaign', ['0']);
const c1c = await read('get_campaign', ['1']);
check('closed campaign holds nothing', BigInt(c0c.escrowed_wei) === 0n, `got ${c0c.escrowed_wei}`);
check('the neighbouring campaign is untouched', BigInt(c1c.escrowed_wei) === 2n * GEN, `got ${c1c.escrowed_wei}`);

// Case 5. The contract's real balance must equal what the campaigns say they
// still hold, plus any live dispute bond. This caught a silent leak: a
// settlement owing one address both a period share and a returned bond was
// paying them as two transfers, and only the first landed, leaving the bond
// stranded in the contract forever.
console.log('\n--- case 5: the real balance matches what the campaigns claim to hold ---');
const finalStats = await read('get_stats');
let claimed = 0n;
for (let i = 0; i < Number(finalStats.campaigns); i++) {
  claimed += BigInt((await read('get_campaign', [String(i)])).escrowed_wei);
}
let liveBonds = 0n;
for (let i = 0; i < Number(finalStats.disputes); i++) {
  const d = await read('get_dispute', [String(i)]);
  if (d.status === 'PENDING') liveBonds += BigInt(d.bond_wei);
}
const real = BigInt(finalStats.contract_balance_wei);
check('no value is stranded in the contract',
  real === claimed + liveBonds,
  `real=${real} claimed escrow=${claimed} live bonds=${liveBonds}`);

console.log(`\n${passed} passed, ${failed} failed`);
console.log('final stats', JSON.stringify(await read('get_stats')));
process.exit(failed === 0 ? 0 : 1);
