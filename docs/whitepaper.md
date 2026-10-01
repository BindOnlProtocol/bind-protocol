# BIND: Overview and Vision

## The problem

A stock token can be swapped through more than one pool. Each pool carries its own price, shaped by its own depth, quote asset and flow. Anyone comparing them by hand reads several tabs and trusts none of them fully. A price taken from a shallow pool says more about the pool than about the stock.

## The idea

Put every pool that prices the same stock on one line, and make the gap between them a number you can check.

1. **Collect.** Read each pool from a public source.
2. **Filter.** Drop pools holding under 10,000 USD of liquidity.
3. **Centre.** Take the median price of what remains.
4. **Measure.** Place each pool by its distance from the median, in basis points.
5. **Stamp.** Attach the source and a running age to every figure.
6. **Withhold.** When a source fails or ages out, show no number.

## Principles

- **Honest gaps.** An unread figure is shown as unread. It is never replaced by a guess or by the last good value.
- **No custody, no connection.** The interface reads public data only. There is nothing to sign.
- **Checkable.** A receipt carries a block number and hash that anyone with a node can look up.
- **No invented reference.** Until an outside benchmark is read and verified, the centre line is called what it is: a median.

## Where it is going

The current product reads and compares. The direction is toward merging: treating the pools of one stock as a single book, then adding an outside benchmark so the lane measures against more than the pools' own middle. Those steps are intentions, not commitments, and each will be stated only when it ships.

## Limits

BIND cannot judge whether a listed pool is safe, whether an issuer's terms suit you, or whether a stock token is available where you live. It reports what public services say, with their age.
