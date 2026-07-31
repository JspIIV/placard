# Placard

An ad campaign that pays out period by period, and only for periods a validator has actually looked at.

An advertiser escrows the whole budget and writes the brand safety rules in plain words. A publisher enrols a placement and submits the live placement URL once per period. Each submission opens a fresh consensus round in which GenLayer validators fetch that page themselves and rule on it. A pass releases that period's share of the budget to the publisher, a fail withholds it, and a publisher who accumulates enough strikes is removed and the whole remaining budget goes straight back to the advertiser.

* **Contract:** [`0x3D749Aa486D9ecdA9e810dcA73CA2f138AD22DEB`](https://explorer-studio.genlayer.com/address/0x3D749Aa486D9ecdA9e810dcA73CA2f138AD22DEB) on GenLayer Studionet
* **Contract source:** [`contracts/placard.py`](contracts/placard.py)
* **Regression suite:** [`tests/placard_regression.mjs`](tests/placard_regression.mjs)

## Verified on chain

A campaign was run from opening to settlement between two separate addresses, advertiser `0x80519c...da6258` and publisher `0x0b5787...db9f6c`, with real GEN moving. Two GEN escrowed across two periods, one GEN each. A second campaign sat alongside it throughout, so every step also had to leave a neighbour's escrow alone.

**A period passed and the money was released.** The campaign bought a promotional presentation of the Next.js brand on the project page its own team publishes and controls. The publisher submitted `https://github.com/vercel/next.js`.

| Field | Value |
|---|---|
| `verdict` | `PASS` |
| `ad_present` | `true` |
| `safety_breach` | `false` |
| `severity` | `NONE` |
| `paid_wei` | `1000000000000000000` |

> "The page is the official Next.js GitHub repository published by Vercel, and it presents Next.js as the React framework for the web. There is no gambling or betting content on the page, so the campaign safety rules are not breached."

Note what the arbiter checked. Not merely that the brand appears somewhere on the page, but that the page is the one the placement requirement actually specified. That clause was written in prose and never parsed by any code.

**A period failed, and failed at the heavier weight.** The publisher then submitted a Wikipedia article on sports betting, which breaks the campaign's own safety rule and carries no placement at all.

| Field | Value |
|---|---|
| `verdict` | `FAIL` |
| `ad_present` | `false` |
| `safety_breach` | `true` |
| `severity` | `SEVERE` |
| `strike_weight` | `2` |

> "The retrieved page is the Wikipedia article on Sports betting, not the official Next.js project page, so the agreed placement is absent. The page's primary subject is sports betting and wagering, which directly violates the campaign-specific safety rule prohibiting placement next to gambling or sports betting content."

Two strikes rather than one, because this is a brand safety breach and not merely an undelivered period. Severity is consensus bound precisely because it sets that weight, and the weight is what removes a publisher and refunds a whole budget.

**The dispute round overturned a finding and corrected the record.** The publisher contested the failure, posting a bond equal to the period share, and offered the official project page as counter evidence.

| Field | Value |
|---|---|
| `outcome` | `OVERTURNED` |
| `evidence_supports_publisher` | `true` |
| `bond_wei` | `1000000000000000000`, returned |

> "The counter evidence confirms the placement occurred on the official Next.js GitHub repository, which is controlled by the project team. This proves the original FAIL was based on a page submitted in error and that the agreed placement was actually met."

The period's share was released, the two strikes were reversed and the bond came back, leaving the placement at two periods passed, zero failed, zero strikes.

**Everything settled and the contract emptied.** Both campaigns closed, two GEN went to the publisher for the passed periods of this one, the dispute bond went back, and the contract's real balance read from `eth_getBalance` is `0`. Nothing is stranded, and no campaign ever drew on the other's escrow. The audit trail carries seventeen entries with actors and timestamps.

The frontend reads this same contract directly over Studionet JSON-RPC, chain id `0xf22f`, with nothing on the page hardcoded. Overview draws on `get_frontend_bootstrap`, Campaigns on `get_recent_campaigns`, Placements on `get_campaign_placements`, Verification on `get_periods_by_status` across all five period states plus `get_dispute`, and Standing on `get_publisher_record`, `get_advertiser_record`, `get_party_campaigns`, `get_party_placements` and `get_audit_trail`.

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

### Regression tests

[`tests/placard_regression.mjs`](tests/placard_regression.mjs) runs against a deployed contract and asserts each of these on chain. 22 checks, covering concurrent pending periods, closure over undecided work, verification and disputes after closure, the neighbouring campaign being untouched, refused payable calls returning their value, and the balance invariant: the contract's real balance must equal what the campaigns say they still hold plus any live dispute bond.

That last check is the one that caught the stranded GEN. The earlier tests all passed while a real leak was open, because they checked the contract's own accounting against itself. Comparing it to `eth_getBalance` is what made the gap visible.

```
22 passed, 0 failed
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
