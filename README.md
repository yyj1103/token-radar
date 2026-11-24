# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yyj1103/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yyj1103/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for the [Token Launch Radar bounty](https://make.fun/bounty/token-radar-01) on make.fun.

## What it does

Token Launch Radar ranks **226 pre-token protocols** by implied launch value, so you can see at a glance which protocols that have not issued a token yet are most worth farming for a future airdrop.

- **Implied value (the radar-2 model):** `TVL × size × growth × maturity × chains`. Size tapers as TVL grows, growth is clamped to −60%…+150%, maturity rises with time since listing (capped at 2 years), and chain breadth adds a small bonus. Every figure comes from the frozen DefiLlama snapshot — no hardcoded list, no name is ever special-cased.
- **Watchlist coverage:** all 40 watchlist protocols (TVL ≥ $50M, no token recorded) are ranked, plus 186 smaller pre-token protocols.
- **7-step farm plan per protocol:** concrete steps with chain-aware gas costs, capital by TVL ($50–$250), and a hold period by age (30–60 days).
- **Dark dashboard:** sortable columns, search, category and chain filters, Pre-token / Live-token tabs, and a detail drawer per protocol that recomputes the model live and shows a 7-day trend line derived from the protocol's real 7-day TVL change.
- **Offline by design:** all figures come from the frozen snapshot; nothing is fetched at runtime.

## How to run it

The program is `main.ts` (Node 22, standard library only, no network):

```sh
node main.ts --input /input/snapshot.json
```

It reads `/input/snapshot.json` and writes `/output/board.json` plus the dashboard data beside the page. Run it twice and the output is byte-identical.

Open `dashboard/index.html` in a browser to use the dashboard.

## Bounty

Built for the [Token Launch Radar bounty](https://make.fun/bounty/token-radar-01) — $1,325 prize pool, 1st place $1,000.

Referral code: `7bxsbwp9`
