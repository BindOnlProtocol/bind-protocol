# BIND

Stock tokens on Robinhood Chain trade in several pools at once, and the pools rarely quote one number. BIND sets those pools side by side, measures each gap in basis points, and stamps every figure with the service it came from and how old it is.

Site: **bind.onl**

## At a glance

| | |
|---|---|
| Chain | Robinhood Chain, id `4663` |
| RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Live sources | The chain's public node, DefiLlama, DexScreener |
| Wallet | Never asked. No connect button, no signature, no approval |
| Status | Reading surface is live; pool merging is a stated direction, not shipped |

## Contract and socials

Every external fact is one record with a state of `stated`, `absent` or `unconfirmed`. A slot stays inert until its record is stated.

| Record | State | Value |
|---|---|---|
| Contract address | absent | not stated yet |
| X | absent | not stated yet |
| GitHub | absent | not stated yet |
| Launch date | absent | none announced |

Copy a contract address only when the project's own account states it. Any other address is not this token.

## What it does today

- Reads chain id, newest block, block hash and gas price from the node every six seconds.
- Reads chain value locked from DefiLlama and pool data for six stock tokens from DexScreener every 45 seconds.
- Draws each stock's pools on one lane, measured from the median of the pools that hold at least 10,000 USD.
- Shows live, stale and unread as three different dot shapes. A source past its window shows the word unread, never an old number.
- Writes a short receipt (chain id, block, hash, time, widest pool gap) with a seal drawn from the note itself.

## Documents

- [Overview and vision](docs/whitepaper.md)
- [Token structure](docs/tokenomics.md)
- [Roadmap](docs/roadmap.md)
- [Architecture](docs/architecture.md)
- [Contributing](.github/CONTRIBUTING.md)
- [Security policy](.github/SECURITY.md)

## Develop

```bash
npm install
npm run build
npm run gates
```

## Disclaimer

BIND has no affiliation with Robinhood, DefiLlama, DexScreener or any issuer. Nothing here is advice. A token may fall to zero, a pool may run shallow, and a quoted price is no promise of a fill.

## License

MIT. See [LICENSE](LICENSE).
