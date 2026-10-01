# Contributing to BIND

Thanks for helping. Small, clear changes are easiest to review.

## Before you start

- Open an issue for anything larger than a fix, so the direction can be agreed first.
- Read [docs/architecture.md](../docs/architecture.md).

## Ground rules

- **Never invent a number.** A figure that cannot be read shows as unread.
- **Register first.** A contract address, handle or date goes in the register with a state. No link or copy action for a record that is not stated.
- **Colours live in one place.** Colour literals belong only in `src/tokens.css`, which the brand sampler writes.
- **Original copy.** Write in plain, specific language. Do not paste text from other sites.
- **Keep it light.** No wallet code, tracking or third-party scripts.
- **Keep the repo clean.** No editor, tool or assistant config files and no attribution lines in commits.

## Workflow

1. Fork and branch from `main`.
2. Make the change.
3. Run `npm run build` then `npm run gates`. Both must exit 0.
4. Open a pull request saying what changed and why. Include a screenshot for visual changes at phone and desktop width.

## Commit messages

Short imperative subject, for example `Drop pools under the liquidity floor`.

## Conduct

Be direct and kind. Critique the work, not the person.
