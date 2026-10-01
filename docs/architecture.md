# Architecture

BIND is a static site. There is no server of its own: the browser calls three public services directly.

## Layout

```
src/        page, styles, scripts, register, sampled tokens, images
brand/      source logos and the sampled palette record
reference/  reference slides used for colour and voice
scripts/    build, brand sampler, browser measurement, gates
test/       synthetic fixtures (never shipped)
dist/       build output
```

## Data flow

| Source | Call | Cadence |
|---|---|---|
| Node (JSON-RPC) | one batch: chain id, block number, gas price, latest block | 6 s |
| DefiLlama | chain list, matched on chain id 4663 | 45 s |
| DexScreener | one search per watched ticker | 45 s |

Timers pause in a hidden tab and run again when it returns. A reply from any chain other than 4663 is discarded.

## Pure core

`lib.js` has no DOM, network or clock. It parses each source, filters pools (stock-token name, floor of 10,000 USD), computes the median and basis-point gaps, classifies freshness, validates addresses (EIP-55 when mixed case) and derives the receipt seal from a Keccak-256 of the note. The same file runs in the page, the build and the gates.

## Freshness

| Source | Live | Stale | Unread |
|---|---|---|---|
| Node | up to 30 s | up to 2 min | beyond |
| DefiLlama | up to 3 min | up to 15 min | beyond |
| DexScreener | up to 2 min | up to 10 min | beyond |

Live is a solid dot, stale a half dot, unread a hollow dot.

## Register

`src/register.json` holds one record per external fact with a state of stated, absent or unconfirmed. The build fills the contract slot, social icons and launch date from it, and emits `register.js`. Only a stated record can carry a link or a copy action. Handles are derived from the stored URL.

## Palette

Colours are sampled from the brand assets by seeded k-means, each snapped to a real pixel, and written to `src/tokens.css`, the only file with colour literals. Logo resizes are premultiplied because the transparent logo has a pure-black clear area.

## Rendering

DOM is built with node creation, never markup strings. Redraws restore keyboard focus. Motion respects reduced-motion settings. Layout responds to container width for the lane and the pool book.

## Verification

A build parity check, register and link rules, palette provenance, copy checks, accessibility and contrast checks, and a real-browser pass at five widths that measures overflow and tap size against synthetic data.
