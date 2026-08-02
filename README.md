# Placard

An ad campaign that pays out period by period, and only for periods a validator has actually looked at.

An advertiser escrows the whole budget and writes the brand safety rules in plain words. A publisher enrols a placement and submits the live placement URL once per period. Each submission opens a fresh consensus round in which GenLayer validators fetch that page themselves and rule on it. A pass releases that period's share of the budget to the publisher, a fail withholds it, and a publisher who accumulates enough strikes is removed and the whole remaining budget goes straight back to the advertiser.

* **Contract:** [`0x5491b037E5AbaFEbBc5Fc5F3fFA765322a9c482d`](https://explorer-studio.genlayer.com/address/0x5491b037E5AbaFEbBc5Fc5F3fFA765322a9c482d) on GenLayer Studionet
* **Contract source:** [`contracts/placard.py`](contracts/placard.py)
* **Regression suites:** [`tests/placard_regression.mjs`](tests/placard_regression.mjs) and [`tests/placard_lifecycle.mjs`](tests/placard_lifecycle.mjs), 43 checks

## Verified on chain

Everything below was produced by two suites run against the deployment linked
above, between two separate addresses, advertiser `0x80519c...da6258` and
publisher `0x0b5787...db9f6c`, with real GEN moving. **43 checks, 43 passing.**

**A period passed and the money was released.** The campaign bought a promotional
presentation of the Next.js brand on the project page its own team publishes and
controls, and the publisher submitted `https://github.com/vercel/next.js`.
`PASS`, `severity NONE`, one GEN released.

> "The page is the public GitHub repository for vercel/next.js, which is an official project page controlled by the Next.js team and explicitly describes Next.js as The React Framework with README text about building web applications."

Note what the arbiter checked. Not merely that the brand appears somewhere on the
page, but that the page is the one the placement requirement actually named. That
clause was written in prose and never parsed by any code.

**A period failed, at the heavier weight.** A Wikipedia article on sports betting
carries no placement and breaks the campaign's own safety rule. `FAIL`,
`safety_breach true`, `severity SEVERE`, two strikes rather than one.

> "The retrieved page is a Wikipedia article about sports betting and does not contain the agreed Next.js promotional creative. Its primary subject is sports betting, which violates the campaign-specific rule against placements on gambling content."

Severity is consensus bound precisely because it sets that weight, and the weight
is what removes a publisher and refunds a budget.

**The strike limit fired while other work was still in flight, and the refund
waited.** Two strikes hit the limit, so the placement was removed automatically,
but a second period was still awaiting its round. Its claim on the escrow is
exactly what a refund must not sweep away, so the refund was deferred, the
pending period was still verified afterwards, and only then was the remainder
released. The campaign settled `REFUNDED` with `escrowed_wei` at `0`.

**The arithmetic was checked on a budget that does not divide.** Two GEN across
three periods is `666666666666666666` each with `2` wei left over. One period was
paid its share, the rest was refunded, and the two sides add up to the budget to
the wei:

| | wei |
|---|---|
| released | `666666666666666666` |
| refunded | `1333333333333333334` |
| budget | `2000000000000000000` |

The remainder can be handed over only once, guarded by a flag on the campaign,
because a period could otherwise take it on its verification and a later
overturned dispute could take it again.

The frontend reads this same contract directly over Studionet JSON-RPC, chain id
`0xf22f`, with nothing on the page hardcoded.

## A bug that testing found

The first deployment could be bricked by an unreachable page, and it took a real failure to see it.

A publisher submitted a page that answered the validators with `403`. `gl.nondet.web.render` raised, and the whole transaction reverted. The contract did have a `try/except` around the round, but it sat outside the nondeterministic block, in a different VM invocation, so it never saw the exception at all. The period stayed in `SUBMITTED` forever, and its share of the budget stayed locked in the contract with no method able to move it.

The fix is to catch the failure inside the block and hand the validator a marker string instead, which the prompt then tells it how to read: rule the period `FAIL` with `severity` `MINOR`, because a publisher who cannot show the placement has not earned the period, but an unreachable page is not evidence of a safety breach and must not be punished as one. The dispute round treats an unloadable counter evidence page the same way, as proving nothing.

A second flaw turned up while reading an earlier deployment back through the frontend. An upheld dispute returns the period to `FAILED`, and `dispute_period` only checked that the period was `FAILED`, so the same publisher could reopen a settled question round after round until one went their way. The bond is weak protection on its own, because a win returns both the bond and the period share, making the grind close to a coin flip. Periods now carry a `disputed_once` flag and a second dispute is refused, with the frontend showing "dispute round already used" in place of the button.

## Campaign local solvency

One contract balance holds many campaigns. Keeping them apart inside it is the contract's job, and the first version did not do it properly. A reviewer asked for this and was right to.

**Pending periods now count against the budget.** The old check counted only decided periods, so a publisher could open ten periods on a three period campaign, leave them all undecided, and later collect a share for every one. `periods_pending` is incremented on submission and on opening a dispute, and decremented when the round settles.

**Nothing runs after a terminal state.** `verify_period`, `dispute_period`, `resolve_dispute` and `submit_period` all check the campaign's status and the placement's, not only the period's. A period left behind after a campaign closed and refunded can no longer pay out, because the value that would have funded it has already gone back to the advertiser.

**Closing over undecided work is refused.** `close_campaign` rejects while `periods_pending` is above zero, so the advertiser cannot take the escrow out from under a round that is still running.

**Every payout is charged to its own campaign.** `_charge_escrow` asserts the amount against that campaign's `escrowed_wei` and subtracts from it. A shortfall raises rather than quietly spending a neighbour's escrow. `escrowed_wei` is exposed on the campaign record so the invariant can be checked from outside.

### Raising out of a payable method does not return the caller's value

This one was found by the regression suite and is worth knowing about generally, because it is a property of the runtime rather than of this contract.

A refused payable call reverts the state change but **not** the incoming transfer. Measured on Studionet: a `dispute_period` carrying 1 GEN was refused, the transaction came back `ERROR`, and the contract ended 1 GEN heavier while the caller ended 1 GEN poorer. Every guard on a payable method was therefore a way to strand somebody's money here permanently, and one stray GEN in an earlier test run was exactly that, not a lost payout.

So the payable methods here never raise once value is attached. `open_campaign` and `dispute_period` route every refusal through `_refuse_payable`, which returns the value, writes an audit entry saying why, and exits normally. Record lookups inside those methods avoid the raising helpers for the same reason.

### Lifecycle, removal and the remainder

A second review pass raised three more, and all three were real.

**Removal used to sweep the escrow while work was still pending.** When a
publisher hit the strike limit, the automatic refund sent everything back to the
advertiser at once. A period still awaiting its round, or a bonded dispute, had a
claim on that value and lost it. Worse, an earlier fix made verification require
an active placement, so a period pending at the moment of removal could never be
verified, `periods_pending` never returned to zero, and `close_campaign` was
refused forever: the budget was locked with no way out at all.

The rule now is that removal stops new submissions and nothing else. Work already
in flight stays verifiable, a refund owed at removal is recorded as deferred, and
`_settle_pending_down` releases it when the last pending item settles. That also
gives every dispute bond a terminal path, because a campaign can no longer reach
a terminal state while a bonded dispute is live.

**The remainder could be paid twice.** A budget rarely divides evenly, and the
leftover rides on whichever period settles last. Both the pass path and the
overturned dispute path computed that independently, so a period could take the
remainder and a later overturn could take it again out of an escrow that only
ever held it once. A `remainder_paid` flag on the campaign now makes it a single
handover.

### Regression tests

Two suites, run against the deployment linked above.
[`tests/placard_regression.mjs`](tests/placard_regression.mjs) covers concurrent
pending periods, closure over undecided work, verification and disputes after
closure, the neighbouring campaign being untouched, refused payable calls
returning their value, and the balance invariant.
[`tests/placard_lifecycle.mjs`](tests/placard_lifecycle.mjs) covers the strike
limit firing while a period is pending, settling that period afterwards, the
deferred refund releasing exactly once, and the remainder on a budget that does
not divide.

The balance invariant is the one that catches what the others cannot: the
contract's real balance read from `eth_getBalance` must equal what every campaign
says it still holds plus any live dispute bond. Earlier suites all passed while a
real leak was open, because they only checked the contract's accounting against
itself.

```
22 passed, 0 failed
21 passed, 0 failed
```

## Why this needs an intelligent contract

"Did the ad run, on the agreed page, next to acceptable content?" has no deterministic answer. It requires fetching a page and judging it against safety rules written in prose. That is what GenLayer validators can do and an ordinary smart contract cannot.

The reason it matters here is structural. Today the party reporting on delivery is the party being paid for delivery, and the advertiser's only recourse is to believe the report or to stop buying. Placard removes the reporting step: the contract fetches the page itself, so the evidence is gathered by the same process that releases the money.

## Staged payment, not one settlement

This is deliberately not a three round dispute over a single pot. Value moves forward incrementally as evidence accumulates.

| Step | What happens |
|---|---|
| `open_campaign` | Escrows the whole budget, splits it into `periods_total` equal shares. Any remainder from the division is added to the final period so nothing is stranded in the contract. |
| `enrol_placement` | A publisher joins with a site name and URL. |
| `submit_period` | The publisher submits the live placement URL for one period. |
| `verify_period` | One consensus round over the fetched page. `PASS` releases that period's share, `FAIL` withholds it. |
| `dispute_period` | The publisher posts a bond equal to the period share to contest one failure. |
| `resolve_dispute` | A second round over both the original page and the counter evidence. `OVERTURNED` releases the share, reverses the strike and returns the bond. `UPHELD` forfeits the bond to the advertiser. |
| `close_campaign` | The advertiser closes and everything withheld comes back. |

A `SEVERE` breach costs two strikes, a `MINOR` breach or a missing ad costs one. Reaching `strike_limit` removes the placement and refunds the campaign's whole remaining budget immediately, without waiting for the advertiser to act.

## How the decision is bound

The equivalence rule for `verify_period` requires validators to match exactly on **four** fields, and the rule text says why each one matters:

* `verdict` releases or withholds this period's share of the escrowed budget, so a disagreement is a disagreement about paying out.
* `ad_present` and `safety_breach` are the two facts the verdict is derived from, so a validator differing on either has seen a different page or reached a different finding, not merely worded the same finding differently.
* `severity` sets the strike weight, which decides whether the publisher is removed and the whole remaining budget refunded.

Only the wording of `reasoning` may differ. `resolve_dispute` binds `outcome` and `evidence_supports_publisher` the same way.

Actors bind to the transaction sender throughout. The advertiser of a campaign is whoever paid for it, the publisher of a placement is whoever enrolled it, only that publisher may submit or dispute its periods, and only that advertiser may close the campaign or remove the placement.

### Evidence is fetched, not described

Every round retrieves its pages with `gl.nondet.web.render(url, mode="text")` rather than a raw HTTP `get`. A raw fetch returns HTML whose opening thousands of characters are head metadata, so a validator given `get` output is weighing boilerplate instead of the page. The window is 20000 characters. A fetch that fails is recorded as a failed period naming the fetch failure, rather than reverting the transaction.

The retrieved page is untrusted input and the prompt says so, instructing the validator to ignore any instruction inside the page telling it how to rule.

## Running it

```bash
npm install
npm run dev
```

Vite plus `genlayer-js`, talking to Studionet directly from the browser through `window.ethereum`, with no backend of its own. `get_frontend_bootstrap` returns a freshly loaded UI's whole first screen in one call, and the CSV query indexes (`idx_status_*`, `idx_party_*`, `idx_campaign_placements`, `idx_placement_periods`) exist so listing by status or by party is a lookup rather than a scan.

## Contract API

```python
open_campaign(brand, creative_description, placement_requirement,
              safety_rules, periods_total, strike_limit)   # payable, escrows the budget
enrol_placement(campaign_id, site_name, site_url)
submit_period(placement_id, evidence_url)
verify_period(period_id)                                   # consensus round one
dispute_period(period_id, argument, counter_evidence_url)  # payable, posts the bond
resolve_dispute(dispute_id)                                # consensus round two
close_campaign(campaign_id)                                # advertiser only
remove_placement(placement_id)                             # advertiser only
set_safety_baseline(baseline)                              # admin only

get_campaign_status(campaign_id)     # composition surface, consensus bound fields only
get_placement_status(placement_id)
get_frontend_bootstrap()
get_recent_campaigns(limit)
get_campaigns_by_status(status) / get_periods_by_status(status)
get_campaign_placements(campaign_id) / get_placement_periods(placement_id)
get_party_campaigns(address) / get_party_placements(address)
get_publisher_record(address) / get_advertiser_record(address)
get_audit_trail(item_kind, item_id)
get_campaign / get_placement / get_period / get_dispute
get_safety_baseline / get_stats
```

## Honest limits

The contract judges the page it can retrieve at the moment the round runs. It cannot prove that the page looked the same an hour earlier or that it looks the same to every visitor, which is the part of ad verification that personalised serving makes genuinely hard. It also cannot see an image: the judgement is made on the text a renderer returns, so a creative that exists only as an unlabelled graphic is not something it can confirm. A campaign runs one active placement at a time, so this is verification of a placement rather than a whole media plan.

The dispute round is a genuine second look at a wider evidence set, and the run above shows the cost of that. The publisher submitted the wrong URL, failed, and then won the dispute by pointing at the page where the placement really ran. That is the right answer on the merits, since the placement did run, but it does mean a dispute doubles as a correction for a bad submission, at the price of putting a bond at risk. Making the first submission binding would be the stricter design; it would also mean a publisher who mistypes a URL loses the period outright.
