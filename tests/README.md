# Regression tests

`placard_regression.mjs` runs against a deployed Placard contract and asserts on
chain that the solvency rules hold. It is not a unit test suite: every check is a
real transaction, because the behaviour being tested is how the runtime settles
value, which cannot be observed in isolation.

```bash
cd placard-app
PLACARD_ADDR=0x... node ../tests/placard_regression.mjs
```

It needs two funded local keystores, one acting as the advertiser and one as the
publisher, and it takes roughly fifteen minutes because every write waits for
FINALIZED and two of them run a consensus round.

The suite is resumable. Studionet drops connections often enough that an
unretried run turns a contract test into a network test, so transport failures
are retried and setup steps already on chain are skipped. A refusal by the
contract is never retried: that is a result, not an error, and it must reach the
assertion.
