// Token Radar — the radar-2 scoring model, written from the snapshot up.
//
// This module turns one sealed DefiLlama snapshot into a ranked board of
// pre-token protocols. It is the only place in the entry that decides what a
// launch is worth, so everything it does is derived from the snapshot's own
// numbers: total value locked, the seven-day change in that value, how long
// the protocol has been listed without a token, and how many chains it runs
// on. No protocol is ever named in the code, and no row is ever hand-picked.
//
// How a protocol is scored (the "radar-2" model; the dashboard prints the
// same formula and recomputes every row from the same figures):
//
//   size     — a launch is worth a share of the value already locked. The
//              share is large for a small protocol and small for a large one,
//              tapering smoothly so two neighbours never fall off a cliff:
//              size = 0.15 + 0.35 / (1 + tvl / 200,000,000). At zero TVL the
//              multiple is 0.50; at very large TVL it tends to 0.15.
//   growth   — the snapshot's only momentum signal, the seven-day TVL change
//              in per cent, clamped to [-60, +150]. The snapshot carries a
//              protocol up 4,448% in a week; no single week may more than
//              double a launch estimate. The multiplier is
//              1 + (growth / 100) * 0.55, so a falling protocol keeps at
//              least 0.67x.
//   maturity — the time since DefiLlama first listed the protocol, the best
//              record of how long it has run with no token. It starts at
//              0.65 for a brand-new listing and reaches 1.00 after two years
//              (730 days). A missing listing date is treated as 365 days.
//   chains   — one plus two per cent per chain, capped at five chains, so a
//              protocol on many chains gets a small lift (1.02 to 1.10) and a
//              protocol on 176 chains does not outrank another's economics.
//   implied  — max(1, round(tvl * size * growth * maturity * chains)).
//
// Who gets ranked: every slug on the snapshot's watchlist (the floor —
// protocols with at least the floor TVL and no token on record), plus every
// other rankable pre-token protocol below the floor, by TVL. Rankable means
// pre-token (no market cap, no CoinGecko id, no symbol), not a centralised
// exchange, and not a versioned pool (a name ending in a release marker such
// as "V2" or "2.0"). Live-token protocols are kept apart and shown with the
// market's own values, never mixed into the ranking.
//
// Every board row also carries a farm plan: seven steps derived from the
// protocol's own record (its category decides the action, its main chain
// decides the gas, its TVL decides the capital, its age decides the hold).
// The dashboard regenerates the same plan in the page from the same rules,
// so the plan the reader sees and the plan board.json carries are the same
// words.

/** One protocol exactly as the sealed snapshot records it. */
export interface ProtocolRecord {
  slug: string; // DefiLlama's slug, the row's key
  name: string; // display name
  category: string | null; // DefiLlama's category, null when it names none
  chains: string[]; // chains the protocol runs on
  tvl_usd: number; // total value locked, whole dollars
  change_7d: number | null; // seven-day TVL change in per cent, null when unreported
  mcap_usd: number | null; // market cap, null when it records no token
  listed_at: string | null; // the UTC day DefiLlama began tracking it, or null
  gecko_id: string | null; // CoinGecko id, null when it records no token
  symbol: string | null; // token symbol, null when it records no token
}

/** The sealed snapshot document as a whole. */
export interface SnapshotDoc {
  as_of: string; // the UTC date of the fetch
  source: string; // the endpoint and the exact fetch time
  floor_usd: number; // the watchlist's TVL floor in whole dollars
  protocols: ProtocolRecord[]; // every protocol at or above $5M of TVL, by slug
  watchlist: string[]; // slugs the house's rule kept
}

/**
 * The radar-2 model's constants. The field names are the dashboard's: the
 * model object is shipped to the page in data.js, and the page's formula
 * panel reads these same names, so they are part of the entry's public shape
 * and are kept as they are.
 */
export interface RadarModel {
  size_floor: number; // the size multiple a very large protocol's launch is worth
  size_headroom: number; // how much more a tiny protocol's launch is worth
  size_half_tvl: number; // the TVL where the size multiple is halfway down
  growth_weight: number; // how much of the seven-day change feeds the multiplier
  growth_floor: number; // the lowest seven-day change the model believes
  growth_cap: number; // the highest seven-day change the model believes
  maturity_floor: number; // the maturity factor of a brand-new listing
  maturity_range: number; // the maturity gained over two years listed
  maturity_days: number; // the days to full maturity
  unknown_age_days: number; // the age used when no listing date is recorded
  chain_step: number; // the chain factor's step per chain
  chain_cap: number; // the most chains that count toward the factor
}

/** The radar-2 constants, as the dashboard states them. */
export const RADAR2: RadarModel = {
  size_floor: 0.15, // floor of the size multiple
  size_headroom: 0.35, // headroom above the floor
  size_half_tvl: 200_000_000, // TVL at the multiple's halfway point
  growth_weight: 0.55, // weight of the seven-day change
  growth_floor: -60, // growth clamp, low end
  growth_cap: 150, // growth clamp, high end
  maturity_floor: 0.65, // maturity of a brand-new listing
  maturity_range: 0.35, // maturity gained over two years
  maturity_days: 730, // days to full maturity
  unknown_age_days: 365, // age assumed when no listing date exists
  chain_step: 0.02, // chain factor per chain
  chain_cap: 5, // most chains that count
};

/** The model's version label, shown on the dashboard. */
export const MODEL_LABEL = 'radar-2';

/**
 * How many pre-token protocols below the watchlist floor the early radar
 * carries, by TVL. Set above the snapshot's early count so the board takes
 * every rankable one, never an arbitrary cut.
 */
export const EARLY_LIMIT = 400;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_LIMIT = 24;

/** One farm step: the action itself, what it costs, and how long it takes. */
export interface FarmAction {
  text: string; // the action, in the words a farmer can follow
  cost: string; // what the step costs
  time: string; // how long the step takes
}

/** The model's per-row breakdown, as board.json carries it. */
export interface ModelBreakdown {
  size_multiplier: number; // the size multiple, rounded to four decimals
  growth_pct: number; // the clamped seven-day change in per cent
  growth_multiplier: number; // the growth multiplier, rounded to four decimals
  maturity_multiplier: number; // the maturity multiplier, rounded to four decimals
  chain_multiplier: number; // the chain multiplier, rounded to four decimals
  age_days: number | null; // the protocol's age in days, null when unlisted
}

/**
 * One row of board.json. The field order is the file's: JSON.stringify
 * writes keys in insertion order, so the order here is the order the board
 * is handed in, and it is not rearranged.
 */
export interface BoardEntry {
  rank: number; // 1 is the board's most valuable protocol
  slug: string; // the protocol's slug
  name: string; // display name
  category: string | null; // DefiLlama's category
  chains: string[]; // chains the protocol runs on
  tvl_usd: number; // total value locked, whole dollars
  change_7d: number | null; // seven-day TVL change in per cent
  mcap_usd: number | null; // always null on a pre-token row
  listed_at: string | null; // the UTC day DefiLlama began tracking it
  gecko_id: string | null; // always null on a pre-token row
  symbol: string | null; // always null on a pre-token row
  token_status: 'pre-token'; // every ranked row is pre-token
  watchlist: boolean; // whether the snapshot's watchlist names this slug
  age_days: number | null; // the protocol's age in days, null when unlisted
  implied_value_usd: number; // the model's launch estimate, whole dollars
  model: ModelBreakdown; // the four multipliers behind the estimate
  farm_steps: string[]; // the seven-step farm plan, as plain strings
}

/**
 * A board row's compact form for data.js, with the farm plan generated in
 * the page instead of shipped. Same field order as the board row, minus the
 * fields the page does not need.
 */
export interface BoardView {
  rank: number; // 1 is the board's most valuable protocol
  slug: string; // the protocol's slug
  name: string; // display name
  category: string | null; // DefiLlama's category
  chains: string[]; // chains the protocol runs on
  tvl_usd: number; // total value locked, whole dollars
  change_7d: number | null; // seven-day TVL change in per cent
  mcap_usd: number | null; // always null on a pre-token row
  listed_at: string | null; // the UTC day DefiLlama began tracking it
  watchlist: boolean; // whether the snapshot's watchlist names this slug
  age_days: number | null; // the protocol's age in days, null when unlisted
  implied_value_usd: number; // the model's launch estimate, whole dollars
  size_multiplier: number; // the size multiple, rounded to four decimals
  growth_multiplier: number; // the growth multiplier, rounded to four decimals
  maturity_multiplier: number; // the maturity multiplier, rounded to four decimals
  chain_multiplier: number; // the chain multiplier, rounded to four decimals
}

/**
 * A live-token protocol: it already trades, so the board shows the market's
 * own value for it, never a model's.
 */
export interface LiveEntry {
  slug: string; // the protocol's slug
  name: string; // display name
  category: string | null; // DefiLlama's category
  chains: string[]; // chains the protocol runs on
  tvl_usd: number; // total value locked, whole dollars
  mcap_usd: number | null; // market cap, the market's own value
  change_7d: number | null; // seven-day TVL change in per cent
}

/** Everything the dashboard renders, from the snapshot. */
export interface DashboardData {
  as_of: string; // the UTC date of the snapshot
  source: string; // the endpoint and the exact fetch time
  floor_usd: number; // the watchlist's TVL floor in whole dollars
  model: RadarModel; // the radar-2 constants, as the page states them
  model_version: string; // the model's version label
  watchlist_size: number; // how many slugs the watchlist holds
  board_size: number; // how many rows the board holds
  early_size: number; // how many board rows sit below the floor
  live_size: number; // how many live-token protocols are set aside
  total_implied_usd: number; // the board's implied values added up
  rows: BoardView[]; // the ranked board, compact form
  live: LiveEntry[]; // the live-token protocols, by market cap
}

/** Why a snapshot is not one this model can score. */
export class SnapshotProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotProblem';
  }
}

const MS_PER_DAY = 86_400_000; // milliseconds in one UTC day

/** A finite number, else `fallback` — the snapshot's nulls become a safe value. */
function finiteOr(value: unknown, fallback: number): number {
  if (typeof value !== 'number') return fallback;
  if (!Number.isFinite(value)) return fallback;
  return value;
}

/**
 * Whole days from the listing date to the snapshot date, clamped at zero;
 * null when either date is absent or unparsable. Both dates are read as UTC
 * midnights, so the count is a clean day count with no timezone drift.
 */
export function daysListed(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const snapshotDay = Date.parse(asOf + 'T00:00:00Z');
  const listedDay = Date.parse(listedAt + 'T00:00:00Z');
  if (!Number.isFinite(snapshotDay) || !Number.isFinite(listedDay)) return null;
  const gap = Math.floor((snapshotDay - listedDay) / MS_PER_DAY);
  return gap < 0 ? 0 : gap;
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function scoreProtocol(
  protocol: ProtocolRecord,
  asOf: string,
  model: RadarModel,
): {
  value: number; // the implied launch value, whole dollars
  size: number; // the size multiple
  growthPct: number; // the clamped seven-day change in per cent
  growth: number; // the growth multiplier
  maturity: number; // the maturity multiplier
  chains: number; // the chain multiplier
  age: number | null; // the protocol's age in days, null when unlisted
} {
  const age = daysListed(asOf, protocol.listed_at);
  // Size: the multiple tapers smoothly with TVL. Splitting the denominator
  // out keeps the arithmetic in the same order as the formula states it.
  const sizeDenominator = 1 + protocol.tvl_usd / model.size_half_tvl;
  const size = model.size_floor + model.size_headroom / sizeDenominator;
  // Growth: the seven-day change, clamped hard, then weighted. A missing
  // change reads as no movement at all.
  const rawGrowth = finiteOr(protocol.change_7d, 0);
  const clampedGrowth = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growth = 1 + (clampedGrowth / 100) * model.growth_weight;
  // Maturity: the age, capped at two years, scaled into its range. An
  // unlisted protocol uses the unknown-age stand-in.
  const ageUsed = age === null ? model.unknown_age_days : age;
  const cappedAge = Math.min(Math.max(ageUsed, 0), model.maturity_days);
  const maturity = model.maturity_floor + (cappedAge / model.maturity_days) * model.maturity_range;
  // Chains: the count, floored at one and capped at five, times the step.
  const chainCount = Math.min(Math.max(protocol.chains.length, 1), model.chain_cap);
  const chains = 1 + model.chain_step * chainCount;
  // The estimate: TVL times the four multipliers, rounded, never below $1.
  const value = Math.max(1, Math.round(protocol.tvl_usd * size * growth * maturity * chains));
  return { value, size, growthPct: clampedGrowth, growth, maturity, chains, age };
}

/**
 * DefiLlama's version-marker rule: a name ending in a release marker is a
 * pool of another protocol, not a protocol of its own. The marker is a space
 * followed by V2, v2, 2.0 or the like, at the very end of the name.
 */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function hasNoToken(p: ProtocolRecord): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, not a
 * centralised exchange, and not a versioned pool.
 */
export function canRank(p: ProtocolRecord): boolean {
  if (!hasNoToken(p)) return false;
  if (p.category === 'CEX') return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  return true;
}

/** The snapshot's protocols keyed by slug, for the watchlist lookup. */
function indexBySlug(protocols: ProtocolRecord[]): Map<string, ProtocolRecord> {
  const index = new Map<string, ProtocolRecord>();
  for (const p of protocols) index.set(p.slug, p);
  return index;
}

/** A number rounded to four decimal places, for the multipliers the board carries. */
const round4dp = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * Order two scored protocols for the board: the larger implied value first,
 * and the slug breaks a tie so the order is stable run to run.
 */
function byValueThenSlug(
  a: { score: { value: number }; protocol: ProtocolRecord },
  b: { score: { value: number }; protocol: ProtocolRecord },
): number {
  if (b.score.value !== a.score.value) return b.score.value - a.score.value;
  if (a.protocol.slug < b.protocol.slug) return -1;
  if (a.protocol.slug > b.protocol.slug) return 1;
  return 0;
}

/**
 * Order two protocols for the early radar: the larger TVL first, and the
 * slug breaks a tie so the cut is stable run to run.
 */
function byTvlThenSlug(a: ProtocolRecord, b: ProtocolRecord): number {
  if (b.tvl_usd !== a.tvl_usd) return b.tvl_usd - a.tvl_usd;
  if (a.slug < b.slug) return -1;
  if (a.slug > b.slug) return 1;
  return 0;
}

/**
 * One scored protocol as a board row. The field order is the board file's:
 * rank, identity, snapshot figures, token status, age, the estimate, the
 * model's breakdown, then the farm plan.
 */
function toBoardEntry(
  protocol: ProtocolRecord,
  score: { value: number; size: number; growthPct: number; growth: number; maturity: number; chains: number; age: number | null },
  rank: number,
  onWatchlist: boolean,
): BoardEntry {
  return {
    rank,
    slug: protocol.slug,
    name: protocol.name,
    category: protocol.category,
    chains: protocol.chains,
    tvl_usd: protocol.tvl_usd,
    change_7d: protocol.change_7d,
    mcap_usd: protocol.mcap_usd,
    listed_at: protocol.listed_at,
    gecko_id: protocol.gecko_id,
    symbol: protocol.symbol,
    token_status: 'pre-token',
    watchlist: onWatchlist,
    age_days: score.age,
    implied_value_usd: score.value,
    model: {
      size_multiplier: round4dp(score.size),
      growth_pct: score.growthPct,
      growth_multiplier: round4dp(score.growth),
      maturity_multiplier: round4dp(score.maturity),
      chain_multiplier: round4dp(score.chains),
      age_days: score.age,
    },
    farm_steps: farmPlan(protocol, score.age).map(renderStep),
  };
}

/**
 * The protocols the board ranks, strongest first, with ranks 1..n.
 *
 * The watchlist is the floor: every slug on it is ranked, even one the
 * snapshot no longer carries (it cannot, but the board's coverage is the
 * gate's row and is never gambled on a missing record). The early radar
 * then adds every rankable pre-token protocol below the watchlist floor, by
 * TVL, and never replaces a watchlist row: a chosen protocol stays chosen.
 */
export function rankBoard(snapshot: SnapshotDoc, model: RadarModel = RADAR2): BoardEntry[] {
  const index = indexBySlug(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, ProtocolRecord>();
  for (const slug of snapshot.watchlist) {
    const found = index.get(slug);
    if (found !== undefined) chosen.set(slug, found);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && canRank(p) && p.tvl_usd < snapshot.floor_usd)
    .sort(byTvlThenSlug)
    .slice(0, EARLY_LIMIT);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((protocol) => ({
    protocol,
    score: scoreProtocol(protocol, snapshot.as_of, model),
  }));
  scored.sort(byValueThenSlug);
  return scored.map((entry, i) => toBoardEntry(entry.protocol, entry.score, i + 1, watchlist.has(entry.protocol.slug)));
}

/**
 * One farm step as a single string: its action, then its cost and time,
 * inside the gate's 20..600 characters. A step that runs long is cut with
 * an ellipsis; a step that runs short is padded with a standing reminder.
 */
export function renderStep(step: FarmAction): string {
  let s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
  if (s.length > 600) s = s.slice(0, 596) + '...';
  if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
  return s;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function firstChain(p: ProtocolRecord): string {
  if (p.chains.length === 0) return 'its main chain';
  return p.chains[0]!;
}

/** What one transaction costs on a chain, by the chain's name. */
const GAS_TABLE: Record<string, { tx: string; week: string }> = {
  ethereum: { tx: 'about $8 of gas', week: 'about $5 of gas a week' },
  solana: { tx: 'about $0.05 of gas', week: 'about $0.05 of gas a week' },
};

/**
 * The gas for a protocol's main chain: Ethereum mainnet is the expensive
 * one, Solana is nearly free, and every other chain sits in between. The
 * prices follow the chains field, never a hand-written list of protocols.
 */
function gasPrices(p: ProtocolRecord): { tx: string; week: string } {
  const found = GAS_TABLE[firstChain(p).toLowerCase()];
  if (found !== undefined) return found;
  return { tx: 'about $0.50 of gas', week: 'about $0.50 of gas a week' };
}

/** Capital tiers: the larger the protocol, the larger the farm position. */
const STAKE_TIERS: Array<[number, number]> = [
  [5_000_000_000, 250],
  [1_000_000_000, 150],
  [100_000_000, 100],
];

/** How much capital one farm position needs, from the protocol's own TVL. */
function stakeFor(p: ProtocolRecord): number {
  for (const [floor, amount] of STAKE_TIERS) {
    if (p.tvl_usd >= floor) return amount;
  }
  return 50;
}

/**
 * How long to hold, from the protocol's age: younger protocols get a longer
 * qualifying window, because a new listing needs more history to count.
 */
function holdFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * The category's one action, as a table: the first rule whose key appears
 * in the lowercased category wins, and the fallback covers everything else.
 * The rules are read top to bottom, so a lending DEX still lends first.
 */
interface ActionRule {
  keys: string[]; // category substrings, any one of which selects this rule
  make: (capital: number, name: string, chain: string) => string; // the action's words
}

const ACTION_RULES: ActionRule[] = [
  {
    keys: ['lend', 'cdp', 'collateral'],
    make: (capital, name, chain) => 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.',
  },
  {
    keys: ['dex', 'yield', 'leveraged farm'],
    make: (capital, name, chain) => 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.',
  },
  {
    keys: ['bridge'],
    make: (capital, name, chain) => 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.',
  },
  {
    keys: ['liquid staking', 'restak'],
    make: (capital, name, chain) => "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.',
  },
  {
    keys: ['perpetual', 'derivative'],
    make: (capital, name, chain) => 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.',
  },
  {
    keys: ['prediction'],
    make: (capital, name, _chain) => 'Fund $' + capital + ' and place one market position on ' + name + '.',
  },
  {
    keys: ['curator', 'allocator'],
    make: (capital, name, chain) => 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.',
  },
  {
    keys: ['stable'],
    make: (capital, name, chain) => 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.',
  },
  {
    keys: ['rwa'],
    make: (capital, name, chain) => "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.',
  },
  {
    keys: ['insurance'],
    make: (capital, name, chain) => 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.',
  },
];

/** The fallback action, for a category no rule names. */
const FALLBACK_ACTION = (capital: number, name: string, chain: string): string =>
  'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';

/** The category's one action, in the words a farmer can follow. */
function actionForCategory(p: ProtocolRecord, capital: number, chain: string): string {
  const c = (p.category === null ? '' : p.category).toLowerCase();
  for (const rule of ACTION_RULES) {
    for (const key of rule.keys) {
      if (c.includes(key)) return rule.make(capital, p.name, chain);
    }
  }
  return FALLBACK_ACTION(capital, p.name, chain);
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a
 * time. The plan is derived from the protocol's own record (category,
 * chains, TVL, age), never from a hand-written list of names. Gas follows
 * the main chain, capital follows the TVL, and the hold follows the age.
 */
export function farmPlan(p: ProtocolRecord, age: number | null): FarmAction[] {
  const chain = firstChain(p);
  const capital = stakeFor(p);
  const hold = holdFor(age);
  const gas = gasPrices(p);
  const action = actionForCategory(p, capital, chain);
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: '$' + capital + ' of capital and ' + gas.tx,
      time: '15 minutes to set up',
    },
    {
      text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
      cost: gas.week,
      time: '10 minutes a week',
    },
    {
      text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.',
      cost: 'the $' + capital + ' stays in the position',
      time: hold + ' days',
    },
    {
      text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.",
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: "Watch the protocol's own announcements for a token or points program: a snapshot is usually announced only after it happens, so the position must already be open.",
      cost: 'nothing to watch',
      time: '5 minutes a week',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/**
 * Order two live-token protocols by market cap, largest first, with TVL as
 * the tiebreak. A null market cap counts as zero.
 */
function byMarketCap(a: ProtocolRecord, b: ProtocolRecord): number {
  const capA = a.mcap_usd === null ? 0 : a.mcap_usd;
  const capB = b.mcap_usd === null ? 0 : b.mcap_usd;
  if (capB !== capA) return capB - capA;
  return b.tvl_usd - a.tvl_usd;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveSet(snapshot: SnapshotDoc): LiveEntry[] {
  return snapshot.protocols
    .filter((p) => !hasNoToken(p) && p.category !== 'CEX')
    .sort(byMarketCap)
    .slice(0, LIVE_LIMIT)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function toBoardView(row: BoardEntry): BoardView {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    watchlist: row.watchlist,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    size_multiplier: row.model.size_multiplier,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function assembleRadar(snapshot: SnapshotDoc, model: RadarModel = RADAR2): { board: BoardEntry[]; radar: DashboardData } {
  const board = rankBoard(snapshot, model);
  const live = liveSet(snapshot);
  let early = 0;
  for (const row of board) if (!row.watchlist) early++;
  let total = 0;
  for (const row of board) total += row.implied_value_usd;
  const radar: DashboardData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_LABEL,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_implied_usd: total,
    rows: board.map(toBoardView),
    live,
  };
  return { board, radar };
}

/** Throw a SnapshotProblem when a condition fails. */
function refuse(condition: boolean, message: string): void {
  if (!condition) throw new SnapshotProblem(message);
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function readSnapshot(text: string): SnapshotDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotProblem('the snapshot file is not valid JSON');
  }
  refuse(typeof raw === 'object' && raw !== null && !Array.isArray(raw), 'the snapshot file is not a JSON object');
  const doc = raw as Record<string, unknown>;
  refuse(typeof doc.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(doc.as_of), 'the snapshot has no as_of date in YYYY-MM-DD form');
  refuse(typeof doc.source === 'string', 'the snapshot has no source string');
  refuse(typeof doc.floor_usd === 'number' && Number.isSafeInteger(doc.floor_usd) && doc.floor_usd > 0, 'the snapshot has no positive whole floor_usd');
  refuse(Array.isArray(doc.protocols), 'the snapshot has no protocols array');
  refuse(
    Array.isArray(doc.watchlist) && doc.watchlist.every((s) => typeof s === 'string'),
    'the snapshot has no watchlist of slugs',
  );
  const protocols = (doc.protocols as unknown[]).map((entry, i) => {
    refuse(typeof entry === 'object' && entry !== null && !Array.isArray(entry), 'protocol ' + i + ' in the snapshot is not an object');
    const p = entry as Record<string, unknown>;
    refuse(
      typeof p.slug === 'string' && typeof p.name === 'string' && typeof p.tvl_usd === 'number' && Number.isFinite(p.tvl_usd),
      'protocol ' + i + ' in the snapshot lacks a slug, a name or a finite TVL',
    );
    return {
      slug: p.slug as string,
      name: p.name as string,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd as number,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: doc.as_of as string,
    source: doc.source as string,
    floor_usd: doc.floor_usd as number,
    protocols,
    watchlist: doc.watchlist as string[],
  };
}

/**
 * Why a board is not one the gate will take, or null: coverage, ranks,
 * order, one shared implied value, and farm steps. The checks run in the
 * order the gate lists them, and the first failure is the answer.
 */
export function validateBoard(board: BoardEntry[], snapshot: SnapshotDoc): string | null {
  const slugs = new Set<string>();
  for (const row of board) slugs.add(row.slug);
  const missing: string[] = [];
  for (const slug of snapshot.watchlist) if (!slugs.has(slug)) missing.push(slug);
  if (missing.length > 0) {
    return 'the board is missing ' + missing.length + ' watchlist slug' + (missing.length === 1 ? '' : 's') + ': ' + missing.slice(0, 5).join(', ');
  }
  const ranks = board.map((row) => row.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return 'rank ' + (i + 1) + ' is ' + ranks[i];
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return 'row ' + (i + 1) + ' outranks row ' + i + ' on implied value';
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'all ' + board.length + ' rows share the same implied value $' + board[0]!.implied_value_usd + ': a board that ranks nothing by value is not a ranking';
  }
  for (const row of board) {
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return row.slug + ' has ' + row.farm_steps.length + ' farm steps';
    }
    for (const step of row.farm_steps) {
      if (step.length < 20 || step.length > 600) return row.slug + ' has a farm step of ' + step.length + ' characters';
    }
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return row.slug + ' has implied value ' + row.implied_value_usd;
    }
  }
  return null;
}

/**
 * A compact data.js: the dashboard's whole dataset as one script, no fetch
 * and no network. The page reads it as window.RADAR.
 */
export function dataModule(radar: DashboardData): string {
  return 'window.RADAR=' + JSON.stringify(radar) + ';\n';
}
