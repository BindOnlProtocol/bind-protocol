# Roadmap

Phases describe order, not dates. No dates are promised.

## Phase 1: Read (shipped)

- Node reads: chain id, newest block, hash, gas price.
- DefiLlama value locked; DexScreener pools for six stock tokens.
- Pool lane with median and basis-point gaps; pool book with sort, filter and row details.
- Freshness states, source and age on every figure.
- Receipt note with a deterministic seal.
- Register of external facts (contract, socials, launch date) that stays inert until stated.

## Phase 2: Widen

- More stock tokens in the watch list.
- Pool history, so a gap can be seen over time.
- Direct reads of pool contracts to cross-check the aggregator.

## Phase 3: Benchmark

- Read an outside benchmark price with its own source and age.
- Measure each pool against the benchmark as well as the median.
- Show both, and say which one is missing when it is.

## Phase 4: Merge

- Treat the pools of one stock as a single book.
- Publish the merge method so its output can be reproduced.

## Phase 5: Open

- Public data endpoint for the lane.
- Embeddable lane for other sites.

Anything moved between phases is noted here with the reason.
