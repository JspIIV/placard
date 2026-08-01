import './style.css';
import { CONTRACT, connect, currentAccount, read, write, toGen, toWei, shortAddr } from './chain.js';

const TABS = [
  ['overview', 'Overview'],
  ['campaigns', 'Campaigns'],
  ['placements', 'Placements'],
  ['verification', 'Verification'],
  ['standing', 'Standing'],
];

let tab = 'overview';
const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function pill(value, kind) {
  if (value === null || value === undefined || value === '') return '<span class="pill">not decided</span>';
  return `<span class="pill ${kind || ''}">${esc(value)}</span>`;
}

function verdictPill(v) {
  if (!v) return '<span class="pill">awaiting verification</span>';
  return pill(v, v === 'PASS' ? 'ok' : 'bad');
}

function statusPill(s) {
  const ok = ['OPEN', 'ACTIVE', 'PASSED', 'OVERTURNED'];
  const bad = ['FAILED', 'REMOVED', 'REFUNDED'];
  return pill(s, ok.includes(s) ? 'ok' : bad.includes(s) ? 'bad' : 'warn');
}

function boolPill(b, badWhenTrue) {
  const text = b === true ? 'yes' : b === false ? 'no' : 'unknown';
  if (b === null || b === undefined) return pill(text, '');
  const isBad = badWhenTrue ? b === true : b === false;
  return pill(text, isBad ? 'bad' : 'ok');
}

function shell() {
  document.querySelector('#app').innerHTML = `
    <header class="top">
      <div class="brand">
        <h1>Placard</h1>
        <span class="tag">verified ad placements with staged payment</span>
      </div>
      <div class="row">
        <span class="mono addr" id="net">studionet</span>
        <button class="act" id="connect">Connect wallet</button>
      </div>
    </header>
    <nav class="tabs" id="tabs"></nav>
    <main><div class="wrap" id="view"></div></main>
    <footer class="foot">
      Contract <span class="mono">${CONTRACT}</span> ·
      <a href="https://explorer-studio.genlayer.com/address/${CONTRACT}" target="_blank" rel="noreferrer">explorer</a>
    </footer>`;

  el('tabs').innerHTML = TABS.map(([k, label]) =>
    `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${label}</button>`).join('');
  el('tabs').onclick = (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    tab = t.dataset.tab;
    shell();
    render();
  };
  el('connect').onclick = async () => {
    try {
      const a = await connect();
      el('connect').textContent = shortAddr(a);
      el('connect').className = 'ghost';
      render();
    } catch (err) { alert(err.message); }
  };
  if (currentAccount()) {
    el('connect').textContent = shortAddr(currentAccount());
    el('connect').className = 'ghost';
  }
}

function busy(msg = 'Reading contract state') {
  return `<div class="note"><span class="spin"></span> &nbsp;${esc(msg)}</div>`;
}

async function action(btn, fn, okMsg) {
  // The note goes immediately after the row holding the button, not at the end
  // of the panel. Appending it to the panel put it below the campaign list,
  // where a click looked like it had done nothing at all: the feedback existed
  // but was hundreds of pixels off screen.
  const anchor = btn.closest('.row') || btn;
  let noteEl = anchor.nextElementSibling;
  if (!noteEl || !noteEl.classList || !noteEl.classList.contains('live')) {
    noteEl = document.createElement('div');
    noteEl.className = 'note live';
    anchor.insertAdjacentElement('afterend', noteEl);
  }
  noteEl.className = 'note live';
  noteEl.innerHTML = '<span class="spin"></span> &nbsp;Submitting, then waiting for consensus…';
  noteEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  try {
    const hash = await fn();
    noteEl.className = 'note live ok';
    noteEl.innerHTML = `${esc(okMsg)}<br><span class="mono addr">${esc(hash)}</span><br>
      Validators settle in about a minute. Refresh the view then.`;
  } catch (err) {
    noteEl.className = 'note live err';
    const raw = String(err?.shortMessage || err?.message || err);
    noteEl.innerHTML = raw === 'Connect a wallet first.'
      ? 'Connect a wallet first, using the button at the top right. This action sends a transaction, so it has to be signed.'
      : esc(raw);
  }
  noteEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// Rendered at the top of any tab that can send a transaction, so the state is
// visible before a button is pressed rather than after.
function walletBanner() {
  if (currentAccount()) return '';
  if (typeof window.ethereum === 'undefined') {
    return `<div class="note err" style="margin-bottom:16px">
      No browser wallet detected. Reading this page needs nothing, but opening a campaign,
      enrolling a placement or disputing a period all send transactions and need a wallet
      such as MetaMask, connected to GenLayer Studionet.</div>`;
  }
  return `<div class="note" style="margin-bottom:16px">
    Wallet not connected. Use <strong>Connect wallet</strong> at the top right before
    sending anything from this page.</div>`;
}

// ----------------------------------------------------------------- overview

async function viewOverview() {
  el('view').innerHTML = `<h2>Overview</h2>${busy()}`;
  const b = await read('get_frontend_bootstrap', []);
  const s = b.stats || {};
  el('view').innerHTML = `
    <h2>Overview</h2>
    <p class="lede">An advertiser escrows a campaign budget and writes the brand safety rules in plain words.
    A publisher enrols a placement and submits the live page for each period. GenLayer validators fetch that
    page themselves and rule on it, and the period's share of the budget is released only on a pass. Value
    moves forward as evidence accumulates rather than in one settlement at the end.</p>
    <div class="stats">
      <div class="stat"><div class="n">${esc(s.campaigns ?? 0)}</div><div class="k">campaigns</div></div>
      <div class="stat"><div class="n">${esc(s.placements ?? 0)}</div><div class="k">placements</div></div>
      <div class="stat"><div class="n">${esc(s.periods ?? 0)}</div><div class="k">periods</div></div>
      <div class="stat"><div class="n">${esc(s.disputes ?? 0)}</div><div class="k">disputes</div></div>
      <div class="stat"><div class="n">${esc(s.audit_entries ?? 0)}</div><div class="k">audit entries</div></div>
    </div>
    <h3>Safety baseline in force</h3>
    <div class="card"><div class="body">${esc(b.safety_baseline || '')}</div></div>
    <h3>Awaiting verification</h3>
    <div id="pending"></div>
    <h3>Recently opened campaigns</h3>
    <div id="recent"></div>`;

  const pending = b.submitted_periods || [];
  el('pending').innerHTML = pending.length
    ? pending.map((p) => `
      <div class="card">
        <div class="head">
          <div>
            <div class="title">period #${esc(p.period_id)} · campaign #${esc(p.campaign_id)} · placement #${esc(p.placement_id)}</div>
            <div class="meta">period ${esc(p.index)} ·
              <a href="${esc(p.evidence_url)}" target="_blank" rel="noreferrer">evidence page</a></div>
          </div>
          ${statusPill(p.status)}
        </div>
      </div>`).join('')
    : '<div class="empty">No period is waiting on a verification round.</div>';

  el('recent').innerHTML = (b.recent_campaigns || []).length
    ? b.recent_campaigns.map(campaignCard).join('')
    : '<div class="empty">No campaigns opened yet.</div>';
}

// ---------------------------------------------------------------- campaigns

function campaignCard(c) {
  const total = Number(c.periods_total) || 0;
  const paid = Number(c.periods_paid) || 0;
  const failed = Number(c.periods_failed) || 0;
  const done = total ? Math.round(((paid + failed) / total) * 100) : 0;
  const budget = BigInt(c.budget_wei || '0');
  const released = BigInt(c.released_wei || '0');
  const refunded = BigInt(c.refunded_wei || '0');
  const withheld = budget - released - refunded;
  return `
    <div class="card" data-campaign="${esc(c.campaign_id)}">
      <div class="head">
        <div>
          <div class="title">#${esc(c.campaign_id)} · ${esc(c.brand)}</div>
          <div class="meta">advertiser <span class="mono addr">${esc(shortAddr(c.advertiser))}</span> ·
            budget ${toGen(budget)} GEN · ${toGen(c.per_period_wei)} GEN per period ·
            strike limit ${esc(c.strike_limit)}</div>
        </div>
        ${statusPill(c.status)}
      </div>
      <div class="body">${esc(c.creative_description)}</div>
      <div class="stages">
        <span class="stage">${esc(paid)} of ${esc(total)} periods paid</span>
        <span class="stage">${esc(failed)} failed</span>
        <span class="stage">released ${toGen(released)} GEN</span>
        <span class="stage">refunded ${toGen(refunded)} GEN</span>
        <span class="stage">still escrowed ${toGen(withheld < 0n ? 0n : withheld)} GEN</span>
      </div>
      <div class="bar"><span style="width:${done}%"></span></div>
    </div>`;
}

async function viewCampaigns() {
  el('view').innerHTML = `<h2>Campaigns</h2>${busy('Reading campaigns')}`;
  const campaigns = await read('get_recent_campaigns', ['50']);
  el('view').innerHTML = `
    <h2>Campaigns</h2>
    ${walletBanner()}
    <p class="lede">Opening a campaign escrows the whole budget in the contract and splits it into equal
    periods. The safety rules you write here are the rules every verification round is judged against, so
    they are stored on chain exactly as typed. Any remainder from the division is added to the final period
    so nothing is stranded.</p>
    <div class="grid two">
      <div class="field"><label>Brand</label><input id="c-brand" placeholder="Kestrel Outdoor" /></div>
      <div class="field"><label>Budget to escrow, in GEN</label><input id="c-budget" placeholder="4" /></div>
    </div>
    <div class="grid two">
      <div class="field"><label>Periods</label><input id="c-periods" placeholder="4" /></div>
      <div class="field"><label>Strike limit</label><input id="c-strikes" placeholder="2" /></div>
    </div>
    <div class="field"><label>Creative description, what the ad should look like</label>
      <textarea id="c-creative" placeholder="A banner reading Kestrel Outdoor, waterproof jackets."></textarea></div>
    <div class="field"><label>Placement requirement, where the ad should appear</label>
      <textarea id="c-req" placeholder="Above the fold on the publisher's hiking gear review page."></textarea></div>
    <div class="field"><label>Safety rules, in addition to the platform baseline</label>
      <textarea id="c-rules" placeholder="Not next to firearms content, not next to political campaigning."></textarea></div>
    <div class="row"><button class="act" id="c-go">Open campaign and escrow budget</button></div>
    <h3>Campaigns on chain</h3>
    <div id="c-list"></div>`;

  el('c-go').onclick = (e) => action(e.target, () => write('open_campaign', [
    el('c-brand').value,
    el('c-creative').value,
    el('c-req').value,
    el('c-rules').value,
    el('c-periods').value || '1',
    el('c-strikes').value || '1',
  ], toWei(el('c-budget').value)), 'Campaign submitted with the budget escrowed.');

  el('c-list').innerHTML = campaigns.length
    ? campaigns.map((c) => `${campaignCard(c)}
        <div class="card">
          <div class="meta">Campaign #${esc(c.campaign_id)} safety rules</div>
          <div class="body">${esc(c.safety_rules)}</div>
          <div class="row" style="margin-top:12px">
            <button class="ghost" data-close="${esc(c.campaign_id)}">Close campaign and refund what is withheld</button>
          </div>
        </div>`).join('')
    : '<div class="empty">Nothing opened yet.</div>';

  el('c-list').onclick = (e) => {
    const b = e.target.closest('[data-close]');
    if (!b) return;
    action(b, () => write('close_campaign', [b.dataset.close]), 'Close submitted.');
  };
}

// --------------------------------------------------------------- placements

async function viewPlacements() {
  el('view').innerHTML = `<h2>Placements</h2>${busy('Reading placements')}`;
  const campaigns = await read('get_recent_campaigns', ['50']);
  const groups = await Promise.all(
    campaigns.map((c) => read('get_campaign_placements', [c.campaign_id]).then((list) => [c, list || []])),
  );

  el('view').innerHTML = `
    <h2>Placements</h2>
    ${walletBanner()}
    <p class="lede">A publisher enrols a placement on a campaign and then submits one live URL per period.
    The publisher of a placement is whoever enrolled it, and only that address may submit or dispute its
    periods. Each submission opens a fresh consensus round over the page as it stands right now.</p>
    <div class="grid two">
      <div class="field"><label>Campaign id</label><input id="p-cid" placeholder="0" /></div>
      <div class="field"><label>Site name</label><input id="p-name" placeholder="Trailhead Weekly" /></div>
    </div>
    <div class="field"><label>Site URL</label><input id="p-url" placeholder="https://example.com" /></div>
    <div class="row"><button class="act" id="p-go">Enrol placement</button></div>
    <h3>Placements on chain</h3>
    <div id="p-list"></div>`;

  el('p-go').onclick = (e) => action(e.target, () => write('enrol_placement', [
    el('p-cid').value || '0', el('p-name').value, el('p-url').value,
  ]), 'Placement submitted.');

  const any = groups.some(([, list]) => list.length);
  el('p-list').innerHTML = any ? groups.filter(([, l]) => l.length).map(([c, list]) => list.map((p) => `
    <div class="card" data-placement="${esc(p.placement_id)}">
      <div class="head">
        <div>
          <div class="title">#${esc(p.placement_id)} · ${esc(p.site_name)} · campaign #${esc(p.campaign_id)} ${esc(c.brand)}</div>
          <div class="meta">publisher <span class="mono addr">${esc(shortAddr(p.publisher))}</span> ·
            <a href="${esc(p.site_url)}" target="_blank" rel="noreferrer">${esc(p.site_url)}</a></div>
        </div>
        ${statusPill(p.status)}
      </div>
      <div class="stages">
        <span class="stage">${esc(p.periods_submitted)} submitted</span>
        <span class="stage">${esc(p.periods_passed)} passed</span>
        <span class="stage">${esc(p.periods_failed)} failed</span>
        <span class="stage">${esc(p.strikes)} strikes of ${esc(c.strike_limit)}</span>
        <span class="stage">earned ${toGen(p.earned_wei)} GEN</span>
      </div>
      <div class="field" style="margin-top:12px">
        <label>Submit a period, evidence URL the contract will fetch</label>
        <input id="s-url-${esc(p.placement_id)}" placeholder="https://…" />
      </div>
      <div class="row">
        <button class="act" data-submit="${esc(p.placement_id)}">Submit period</button>
        <button class="ghost" data-remove="${esc(p.placement_id)}">Remove placement</button>
      </div>
    </div>`).join('')).join('')
    : '<div class="empty">No placements enrolled yet.</div>';

  el('p-list').onclick = (e) => {
    const sub = e.target.closest('[data-submit]');
    const rem = e.target.closest('[data-remove]');
    if (sub) {
      const id = sub.dataset.submit;
      return action(sub, () => write('submit_period', [id, el(`s-url-${id}`).value]), 'Period submitted.');
    }
    if (rem) {
      return action(rem, () => write('remove_placement', [rem.dataset.remove]), 'Removal submitted.');
    }
  };
}

// ------------------------------------------------------------- verification

function periodCard(p) {
  const failed = p.status === 'FAILED';
  const submitted = p.status === 'SUBMITTED';
  return `
    <div class="card" data-period="${esc(p.period_id)}">
      <div class="head">
        <div>
          <div class="title">period #${esc(p.period_id)} · campaign #${esc(p.campaign_id)} · placement #${esc(p.placement_id)}</div>
          <div class="meta">period ${esc(p.index)} ·
            <a href="${esc(p.evidence_url)}" target="_blank" rel="noreferrer">evidence page</a> ·
            released ${toGen(p.paid_wei)} GEN</div>
        </div>
        ${p.status === 'OVERTURNED' ? '<span class="pill ok">OVERTURNED</span>' : verdictPill(p.verdict)}
      </div>
      <div class="stages">
        <span class="stage">status ${esc(p.status)}</span>
        ${p.status === 'OVERTURNED' ? '<span class="stage">original verdict FAIL, reversed on dispute</span>' : ''}
        <span class="stage">ad present ${boolPill(p.ad_present, false)}</span>
        <span class="stage">safety breach ${boolPill(p.safety_breach, true)}</span>
        <span class="stage">severity ${esc(p.severity ?? 'not decided')}</span>
        <span class="stage">strike weight ${esc(p.strike_weight)}</span>
      </div>
      ${p.reasoning ? `<div class="note">${esc(p.reasoning)}</div>` : ''}
      <div class="row" style="margin-top:12px">
        ${submitted ? '<button class="act" data-verify="1">Run the verification round</button>' : ''}
        ${failed && !p.disputed_once ? '<button class="ghost" data-dispute="1">Dispute this failure</button>' : ''}
        ${failed && p.disputed_once ? '<span class="stage">dispute round already used</span>' : ''}
      </div>
      <div id="d-form-${esc(p.period_id)}"></div>
    </div>`;
}

async function viewVerification() {
  el('view').innerHTML = `<h2>Verification</h2>${busy('Reading periods')}`;
  const statuses = ['SUBMITTED', 'PASSED', 'FAILED', 'DISPUTED', 'OVERTURNED'];
  const groups = await Promise.all(statuses.map((s) => read('get_periods_by_status', [s]).then((r) => [s, r || []])));
  const stats = await read('get_stats', []);
  const disputeCount = Number(stats.disputes) || 0;
  const disputes = [];
  for (let i = 0; i < disputeCount; i += 1) {
    disputes.push(await read('get_dispute', [String(i)]));
  }

  el('view').innerHTML = `
    <h2>Verification</h2>
    ${walletBanner()}
    <p class="lede">Each round fetches the evidence page with render in text mode and asks for four bound
    facts: whether the ad is present, whether the page breaches the safety rules, how severe that breach is,
    and the verdict derived from the first two. Validators must match on all four, because the verdict moves
    money and the severity sets the strike weight that can remove the publisher outright. Only the wording
    of the reasoning may differ.</p>
    <div id="v-list"></div>
    <h3>Disputes</h3>
    <div id="v-disputes"></div>`;

  const any = groups.some(([, list]) => list.length);
  el('v-list').innerHTML = any
    ? groups.filter(([, l]) => l.length).map(([s, list]) => `
      <h3>${esc(s.toLowerCase())}</h3>${list.map(periodCard).join('')}`).join('')
    : '<div class="empty">No periods submitted yet.</div>';

  el('v-list').onclick = (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const id = card.dataset.period;
    if (e.target.closest('[data-verify]')) {
      return action(e.target, () => write('verify_period', [id]), 'Verification round started.');
    }
    if (e.target.closest('[data-dispute]')) {
      const holder = el(`d-form-${id}`);
      holder.innerHTML = `
        <div class="field" style="margin-top:12px"><label>Your argument</label>
          <textarea id="d-arg-${id}" placeholder="Why the failure was wrong."></textarea></div>
        <div class="field"><label>Counter evidence URL the contract should fetch</label>
          <input id="d-url-${id}" placeholder="https://…" /></div>
        <div class="field"><label>Bond, in GEN, must equal the period share and is forfeited if the failure stands</label>
          <input id="d-bond-${id}" placeholder="1" /></div>
        <button class="act" id="d-send-${id}">Post bond and dispute</button>`;
      el(`d-send-${id}`).onclick = (ev) => action(ev.target, () => write(
        'dispute_period', [id, el(`d-arg-${id}`).value, el(`d-url-${id}`).value], toWei(el(`d-bond-${id}`).value),
      ), 'Dispute opened with the bond posted.');
    }
  };

  el('v-disputes').innerHTML = disputes.length ? disputes.map((d) => `
    <div class="card" data-dispute-id="${esc(d.dispute_id)}">
      <div class="head">
        <div>
          <div class="title">dispute #${esc(d.dispute_id)} on period #${esc(d.period_id)}</div>
          <div class="meta">publisher <span class="mono addr">${esc(shortAddr(d.publisher))}</span> ·
            bond ${toGen(d.bond_wei)} GEN ·
            <a href="${esc(d.counter_evidence_url)}" target="_blank" rel="noreferrer">counter evidence</a></div>
        </div>
        ${pill(d.outcome || d.status, d.outcome === 'OVERTURNED' ? 'ok' : d.outcome === 'UPHELD' ? 'bad' : 'warn')}
      </div>
      <div class="body">${esc(d.argument)}</div>
      ${d.reasoning ? `<div class="note">${esc(d.reasoning)}</div>` : ''}
      <div class="stages">
        <span class="stage">evidence supports publisher ${boolPill(d.evidence_supports_publisher, false)}</span>
      </div>
      ${d.status === 'PENDING' ? '<div class="row" style="margin-top:12px"><button class="act" data-resolve="1">Resolve the dispute</button></div>' : ''}
    </div>`).join('') : '<div class="empty">No disputes opened.</div>';

  el('v-disputes').onclick = (e) => {
    const b = e.target.closest('[data-resolve]');
    if (!b) return;
    const id = b.closest('.card').dataset.disputeId;
    action(b, () => write('resolve_dispute', [id]), 'Second consensus round started.');
  };
}

// ------------------------------------------------------------------ standing

async function viewStanding() {
  const a = currentAccount() || '';
  el('view').innerHTML = `
    <h2>Standing</h2>
    <p class="lede">Standing is a by-product of settled rounds rather than a separate score. A publisher
    accumulates passed and failed periods, disputes won and lost, and everything earned. An advertiser
    accumulates what was escrowed, what was released and what came back. Every action also lands in an
    immutable audit trail.</p>
    <div class="field"><label>Address</label><input id="s-addr" value="${esc(a)}" placeholder="0x…" /></div>
    <div class="row"><button class="act" id="s-go">Look up</button></div>
    <div id="s-out"></div>
    <h3>Audit trail</h3>
    <div class="field"><label>Item</label>
      <div class="row">
        <select id="a-kind" style="max-width:170px">
          <option>CAMPAIGN</option><option>PLACEMENT</option><option>PERIOD</option>
          <option>DISPUTE</option><option>PROTOCOL</option>
        </select>
        <input id="a-id" placeholder="id" style="max-width:120px" value="0" />
        <button class="ghost" id="a-go">Show trail</button>
      </div></div>
    <div id="a-out"></div>`;

  el('s-go').onclick = async () => {
    const addr = el('s-addr').value.trim();
    if (!addr) return;
    el('s-out').innerHTML = busy('Reading standing');
    const [pub, adv, camps, places] = await Promise.all([
      read('get_publisher_record', [addr]),
      read('get_advertiser_record', [addr]),
      read('get_party_campaigns', [addr]),
      read('get_party_placements', [addr]),
    ]);
    el('s-out').innerHTML = `
      <h3>As publisher</h3>
      <div class="stats">
        <div class="stat"><div class="n">${esc(pub.periods_passed ?? 0)}</div><div class="k">periods passed</div></div>
        <div class="stat"><div class="n">${esc(pub.periods_failed ?? 0)}</div><div class="k">periods failed</div></div>
        <div class="stat"><div class="n">${esc(pub.disputes_won ?? 0)}</div><div class="k">disputes won</div></div>
        <div class="stat"><div class="n">${esc(pub.disputes_lost ?? 0)}</div><div class="k">disputes lost</div></div>
        <div class="stat"><div class="n">${toGen(pub.earned_wei ?? '0')}</div><div class="k">GEN earned</div></div>
      </div>
      <h3>As advertiser</h3>
      <div class="stats">
        <div class="stat"><div class="n">${esc(adv.campaigns_opened ?? 0)}</div><div class="k">campaigns opened</div></div>
        <div class="stat"><div class="n">${esc(adv.campaigns_closed ?? 0)}</div><div class="k">campaigns closed</div></div>
        <div class="stat"><div class="n">${toGen(adv.escrowed_wei ?? '0')}</div><div class="k">GEN escrowed</div></div>
        <div class="stat"><div class="n">${toGen(adv.released_wei ?? '0')}</div><div class="k">GEN released</div></div>
        <div class="stat"><div class="n">${toGen(adv.refunded_wei ?? '0')}</div><div class="k">GEN refunded</div></div>
      </div>
      <h3>Campaigns opened by this address</h3>
      <div>${(camps || []).length ? camps.map(campaignCard).join('') : '<div class="empty">None.</div>'}</div>
      <h3>Placements enrolled by this address</h3>
      <div>${(places || []).length ? places.map((p) => `
        <div class="card">
          <div class="head">
            <div><div class="title">#${esc(p.placement_id)} · ${esc(p.site_name)}</div>
              <div class="meta">campaign #${esc(p.campaign_id)} · earned ${toGen(p.earned_wei)} GEN ·
                ${esc(p.strikes)} strikes</div></div>
            ${statusPill(p.status)}
          </div>
        </div>`).join('') : '<div class="empty">None.</div>'}</div>`;
  };

  el('a-go').onclick = async () => {
    el('a-out').innerHTML = busy('Reading trail');
    const trail = await read('get_audit_trail', [el('a-kind').value, el('a-id').value || '0']);
    el('a-out').innerHTML = (trail || []).length
      ? `<table class="audit">${trail.map((t) => `<tr>
          <td class="k">${esc(t.action)}</td>
          <td class="mono addr">${esc(shortAddr(t.actor))}</td>
          <td>${esc(t.detail)}</td>
          <td class="k">${esc(String(t.at).slice(0, 19).replace('T', ' '))}</td></tr>`).join('')}</table>`
      : '<div class="empty">No entries.</div>';
  };

  if (a) el('s-go').click();
}

// -------------------------------------------------------------------- boot

async function render() {
  try {
    if (tab === 'overview') return await viewOverview();
    if (tab === 'campaigns') return await viewCampaigns();
    if (tab === 'placements') return await viewPlacements();
    if (tab === 'verification') return await viewVerification();
    if (tab === 'standing') return await viewStanding();
  } catch (err) {
    el('view').innerHTML = `<h2>Something went wrong</h2>
      <div class="note err">${esc(err?.shortMessage || err?.message || String(err))}</div>`;
  }
}

shell();
render();
