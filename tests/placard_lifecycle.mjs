// Lifecycle and remainder tests for Placard, the second half of the suite.
//
// Written for three findings raised in review:
//   1. removal or automatic refund must not run while work is still pending
//   2. every dispute bond must have a terminal return or forfeiture path
//   3. the campaign remainder must be distributable exactly once
// Run against a fresh deployment, with a budget that deliberately does not
// divide evenly, so the remainder is a real number rather than zero.
import { Wallet } from 'file:///C:/Users/ysfym/AppData/Roaming/npm/node_modules/genlayer/node_modules/ethers/lib.esm/index.js';
import { createClient, createAccount } from './node_modules/genlayer-js/dist/index.js';
import { studionet } from './node_modules/genlayer-js/dist/chains/index.js';
import fs from 'fs';

const ADDR = process.env.PLACARD_ADDR;
const KS = String.raw`C:\Users\ysfym\.genlayer\keystores`;
const GEN = 10n ** 18n;
const ADV = '0x80519c53f10d731e4ff83a7d9acd69cf98da6258';
const PUB = '0x0b57877ec84d96b672cd47d8ea4424283fdb9f6c';

// 2 GEN over 3 periods: 666666666666666666 each, 2 wei left over.
const BUDGET = 2n * GEN;
const PERIODS = 3n;

async function load(name, password) {
  const w = await Wallet.fromEncryptedJson(fs.readFileSync(`${KS}/${name}.json`, 'utf8'), password);
  return createClient({ chain: studionet, account: createAccount(w.privateKey) });
}
const reader = createClient({ chain: studionet });
function isTransport(e) {
  const s = String(e && (e.details || e.message) || e);
  return /fetch failed|ECONNRESET|socket|timeout|Unexpected token '<'|503|502|429|Rate limit|Server busy|execution slots|-32006|-32029/i.test(s);
}
async function retry(label, fn, attempts = 5) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); } catch (e) {
      if (!isTransport(e)) throw e;
      last = e;
      console.log(`  ..    ${label}: transport error, retry ${i}/${attempts}`);
      await new Promise(r => setTimeout(r, 5000 * i));
    }
  }
  throw last;
}
async function read(fn, args = []) {
  const raw = await retry(`read ${fn}`, () => reader.readContract({ address: ADDR, functionName: fn, args }));
  try { return JSON.parse(raw); } catch { return raw; }
}
async function chainBalance(a) {
  const r = await fetch('https://studio.genlayer.com/api', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [a, 'latest'], id: 1 }),
  });
  return BigInt((await r.json()).result);
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
  const exec = String(r?.consensus_data?.leader_receipt?.[0]?.execution_result ?? '?');
  return { ok: !exec.toUpperCase().includes('ERROR'), exec };
}
async function mustAccept(name, client, fn, args, value = 0n) {
  const r = await send(client, fn, args, value);
  check(name, r.ok, `refused: ${r.exec}`);
  return r;
}

const advertiser = await load('padv', 'placard-test-adv-2026');
const publisher = await load('ppub', 'placard-test-pub-2026');

const BRAND = 'Next.js';
const CREATIVE = 'A promotional presentation of the Next.js brand on its own official project page, naming Next.js and describing it as a React framework for building web applications';
const REQUIREMENT = 'The placement must appear on the official project page that the Next.js team themselves publish and control';
const SAFETY = 'The placement must never appear on a page whose primary subject is gambling, sports betting or wagering of any kind';
const GOOD = 'https://github.com/vercel/next.js';
const BAD = 'https://en.wikipedia.org/wiki/Sports_betting';

console.log('contract', ADDR);
let st = await read('get_stats');
console.log('stats   ', JSON.stringify(st));

console.log('\n--- setup: a budget that does not divide evenly ---');
// Ids are taken from the counters rather than assumed to be zero, so this suite
// can run on a contract the solvency suite has already used.
const CID = String(st.campaigns);
const PID = String(st.placements);
const PA = String(st.periods);
const PB = String(Number(st.periods) + 1);
console.log(`  ..    using campaign ${CID}, placement ${PID}, periods ${PA} and ${PB}`);
if (true) {
  await mustAccept('open campaign 0, 2 GEN over 3 periods', advertiser, 'open_campaign',
    [BRAND, CREATIVE, REQUIREMENT, SAFETY, String(PERIODS), '2'], BUDGET);
}
const c0 = await read('get_campaign', [CID]);
const per = BigInt(c0.per_period_wei);
const rem = BigInt(c0.remainder_wei);
check('the remainder is real, not zero', rem > 0n, `per_period=${per} remainder=${rem}`);
check('the split accounts for the whole budget',
  per * PERIODS + rem === BUDGET, `per=${per} x${PERIODS} + rem=${rem} != ${BUDGET}`);

await mustAccept('enrol a placement', publisher, 'enrol_placement', [CID, 'Next.js Official Project Page', GOOD]);

console.log('\n--- case 1: a strike limit refund waits for work still in flight ---');
// strike_limit is 2 and a SEVERE failure carries two strikes, so verifying the
// gambling page trips the automatic removal. A second period is deliberately
// left undecided at that moment: its claim on the escrow is exactly what the
// refund must not sweep away.
await mustAccept('submit period A and leave it undecided', publisher, 'submit_period', [PID, GOOD]);
await mustAccept('submit period B, a gambling page', publisher, 'submit_period', [PID, BAD]);

const beforeStrike = await chainBalance(ADDR);
await mustAccept('verify period B, tripping the strike limit', publisher, 'verify_period', [PB]);
const afterStrike = await chainBalance(ADDR);
const p1 = await read('get_period', [PB]);
console.log('  ..    period B ' + p1.verdict + ' ' + p1.severity + ', strike weight ' + p1.strike_weight);

const cAfterStrike = await read('get_campaign', [CID]);
const placeAfter = await read('get_placement', [PID]);
check('the placement was removed automatically',
  placeAfter.status === 'REMOVED', 'status ' + placeAfter.status);
check('no refund was swept out while period A was pending',
  afterStrike === beforeStrike, 'contract moved by ' + (afterStrike - beforeStrike) + ' wei');
check('the refund is recorded as deferred',
  cAfterStrike.refund_when_settled === true,
  JSON.stringify({ deferred: cAfterStrike.refund_when_settled, pending: cAfterStrike.periods_pending }));
check('period A is still counted as pending',
  Number(cAfterStrike.periods_pending) === 1, 'pending ' + cAfterStrike.periods_pending);

console.log('\n--- case 2: work in flight can still be settled after the removal ---');
await mustAccept('verify period A despite the removal', publisher, 'verify_period', [PA]);
const p0 = await read('get_period', [PA]);
check('period A reached a decision', p0.status !== 'SUBMITTED', 'status ' + p0.status);

console.log('\n--- case 3: the deferred refund is released, once, when the last claim clears ---');
const cSettled = await read('get_campaign', [CID]);
check('pending is back to zero', Number(cSettled.periods_pending) === 0, 'pending ' + cSettled.periods_pending);
check('the deferred flag is cleared so it cannot fire twice',
  cSettled.refund_when_settled === false, 'flag ' + cSettled.refund_when_settled);
check('the campaign reached a terminal state',
  cSettled.status !== 'OPEN', 'status ' + cSettled.status);
check('the campaign now holds nothing',
  BigInt(cSettled.escrowed_wei) === 0n, 'escrowed ' + cSettled.escrowed_wei);
check('released and refunded together account for the whole budget',
  BigInt(cSettled.released_wei) + BigInt(cSettled.refunded_wei) === BUDGET,
  'released ' + cSettled.released_wei + ' refunded ' + cSettled.refunded_wei);

console.log('\n--- case 4: the remainder was handed over at most once ---');
let remainderPayments = 0;
const total = Number((await read('get_stats')).periods);
for (let i = Number(PA); i < total; i++) {
  const p = await read('get_period', [String(i)]);
  const paid = BigInt(p.paid_wei || '0');
  if (paid > per) remainderPayments++;
  if (paid > 0n) check('period ' + i + ' paid a whole share, with or without the remainder',
    paid === per || paid === per + rem, 'paid ' + paid);
}
check('no more than one period carried the remainder', remainderPayments <= 1, remainderPayments + ' did');

console.log('\n--- case 5: nothing is stranded, and no dispute bond is left homeless ---');
const stats = await read('get_stats');
let owed = 0n;
for (let i = 0; i < Number(stats.campaigns); i++) {
  owed += BigInt((await read('get_campaign', [String(i)])).escrowed_wei);
}
let liveBonds = 0n;
for (let i = 0; i < Number(stats.disputes); i++) {
  const d = await read('get_dispute', [String(i)]);
  if (d.status === 'PENDING') liveBonds += BigInt(d.bond_wei);
}
check('the real balance equals unreleased escrow plus live bonds',
  (await chainBalance(ADDR)) === owed + liveBonds,
  `real=${await chainBalance(ADDR)} escrow=${owed} bonds=${liveBonds}`);

console.log(`\n${passed} passed, ${failed} failed`);
console.log('final campaign', JSON.stringify(await read('get_campaign', [CID])));
process.exit(failed === 0 ? 0 : 1);
