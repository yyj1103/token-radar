// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a filterable table, a
// per-protocol detail drawer with the model's own inputs and the protocol's
// farm plan. No network: every byte it shows is in data.js.
//
// The page recomputes every row from the snapshot figures with the same
// radar-2 model main.ts runs, so the page's code and the board's data are
// visibly the same arithmetic. The detail drawer shows the recomputed number
// next to the board's number: they agree, or the data is stale.
(() => {
  'use strict';

  const DATA = window.RADAR;
  if (!DATA) return;
  const mount = document.getElementById('board');

  // The reader's view: search text, two filters, which tab is open, how the
  // board is sorted, and which protocol's detail drawer is open.
  const ui = {
    query: '',
    category: 'all',
    chain: 'all',
    tab: 'pre-token',
    sortKey: 'implied',
    sortDir: -1,
    openSlug: null,
  };

  const usdFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  /** A dollar amount, shortened: $1.23B, $45.6M, $789K, or the full figure. */
  const formatMoney = (n) => {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFull.format(n);
  };

  /** A per-cent change with its sign, or n/a when the snapshot reports none. */
  const formatChange = (n) => {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  };

  /** An age in days as years once it passes a year, else days; unknown stays unknown. */
  const formatAge = (days) => {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  };

  // Radar-2 in one function: size tapers with TVL, growth is clamped,
  // maturity caps at two years, and the chain count adds a small capped
  // factor. The same constants main.ts runs, so the recomputed number and
  // the board's number are the same arithmetic.
  const recomputeRow = (row, model) => {
    const sizeDenominator = 1 + row.tvl_usd / model.size_half_tvl;
    const size = model.size_floor + model.size_headroom / sizeDenominator;
    const rawGrowth = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    const growth = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
    const growthMult = 1 + (growth / 100) * model.growth_weight;
    const age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    const maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    const chains = Math.min(Math.max((row.chains || []).length, 1), model.chain_cap);
    const chainMult = 1 + model.chain_step * chains;
    return {
      implied: Math.max(1, Math.round(row.tvl_usd * size * growthMult * maturity * chainMult)),
      size,
      growthMult,
      maturity,
      chainMult,
    };
  };

  /**
   * Build a DOM node: h('div', { class: 'panel' }, [child, 'text']).
   * A prop named `text` sets text content, `html` sets inner HTML, a prop
   * starting with `on` registers an event listener, and anything else
   * becomes an attribute (skipped when null or undefined). Children may be
   * nodes, strings, or arrays of either.
   */
  const h = (tag, props, children = []) => {
    const node = document.createElement(tag);
    if (props) {
      for (const key of Object.keys(props)) {
        const value = props[key];
        if (value === null || value === undefined) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value);
      }
    }
    const attach = (child) => {
      if (child === null || child === undefined || child === false) return;
      if (Array.isArray(child)) {
        for (const c of child) attach(c);
        return;
      }
      if (typeof child === 'string') {
        node.appendChild(document.createTextNode(child));
        return;
      }
      node.appendChild(child);
    };
    attach(children);
    return node;
  };

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, the capital, the hold
  // and every cost and time. No name is special-cased.
  const firstChain = (p) => {
    if (!p.chains || p.chains.length === 0) return 'its main chain';
    return p.chains[0];
  };
  const GAS_TABLE = {
    ethereum: { tx: 'about $8 of gas', week: 'about $5 of gas a week' },
    solana: { tx: 'about $0.05 of gas', week: 'about $0.05 of gas a week' },
  };
  const gasPrices = (p) => {
    const found = GAS_TABLE[firstChain(p).toLowerCase()];
    if (found !== undefined) return found;
    return { tx: 'about $0.50 of gas', week: 'about $0.50 of gas a week' };
  };
  const STAKE_TIERS = [
    [5e9, 250],
    [1e9, 150],
    [1e8, 100],
  ];
  const stakeFor = (p) => {
    for (const [floor, amount] of STAKE_TIERS) {
      if (p.tvl_usd >= floor) return amount;
    }
    return 50;
  };
  const holdFor = (age) => {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  };
  const ACTION_RULES = [
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
  const FALLBACK_ACTION = (capital, name, chain) =>
    'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  const actionForCategory = (p, capital, chain) => {
    const c = (p.category || '').toLowerCase();
    for (const rule of ACTION_RULES) {
      for (const key of rule.keys) {
        if (c.indexOf(key) >= 0) return rule.make(capital, p.name, chain);
      }
    }
    return FALLBACK_ACTION(capital, p.name, chain);
  };
  const renderStep = (step) => {
    let s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  };
  const farmSteps = (p) => {
    const chain = firstChain(p);
    const capital = stakeFor(p);
    const hold = holdFor(p.age_days);
    const gas = gasPrices(p);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionForCategory(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas.tx, time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: gas.week, time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: "Watch the protocol's own announcements for a token or points program: a snapshot is usually announced only after it happens, so the position must already be open.", cost: 'nothing to watch', time: '5 minutes a week' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
    ].map(renderStep);
  };

  /** Read the reader's view back out of the location hash, if one is set. */
  const parseHash = () => {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    const params = new URLSearchParams(hash);
    const q = params.get('q');
    if (q) ui.query = q;
    const p = params.get('p');
    if (p) ui.openSlug = p;
    const category = params.get('category');
    if (category) ui.category = category;
    const chain = params.get('chain');
    if (chain) ui.chain = chain;
  };

  /** Write the reader's view into the location hash, so a view can be linked to. */
  const saveHash = () => {
    const params = new URLSearchParams();
    if (ui.query) params.set('q', ui.query);
    if (ui.category !== 'all') params.set('category', ui.category);
    if (ui.chain !== 'all') params.set('chain', ui.chain);
    if (ui.openSlug) params.set('p', ui.openSlug);
    const next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  };

  /** The board rows the current search and filters leave standing. */
  const visibleRows = () => {
    const q = ui.query.trim().toLowerCase();
    return DATA.rows.filter((r) => {
      if (ui.category !== 'all' && r.category !== ui.category) return false;
      if (ui.chain !== 'all' && (r.chains || []).indexOf(ui.chain) < 0) return false;
      if (!q) return true;
      const hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  };

  /** The visible rows in the reader's chosen order. */
  const orderedRows = (list) => {
    const key = ui.sortKey;
    return list.slice().sort((a, b) => {
      let av;
      let bv;
      if (key === 'name') {
        av = a.name.toLowerCase();
        bv = b.name.toLowerCase();
      } else if (key === 'tvl') {
        av = a.tvl_usd;
        bv = b.tvl_usd;
      } else if (key === 'growth') {
        av = a.change_7d === null ? -Infinity : a.change_7d;
        bv = b.change_7d === null ? -Infinity : b.change_7d;
      } else if (key === 'age') {
        av = a.age_days === null ? Infinity : a.age_days;
        bv = b.age_days === null ? Infinity : b.age_days;
      } else {
        av = a.implied_value_usd;
        bv = b.implied_value_usd;
      }
      if (av < bv) return -ui.sortDir;
      if (av > bv) return ui.sortDir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  };

  /** The page's top bar: the mark, the name, and the snapshot's facts. */
  const topBar = () =>
    h('header', { class: 'top' }, [
      h('div', { class: 'brand' }, [
        h('span', { class: 'mark' }),
        h('span', { class: 'brand-name', text: 'Token Radar' }),
      ]),
      h('div', { class: 'top-meta' }, [
        h('span', { text: 'Snapshot ' + DATA.as_of }),
        h('span', { text: 'DefiLlama protocol index' }),
        h('span', { text: DATA.model_version + ' model' }),
      ]),
    ]);

  /** The lede: what the board is, and the five facts that frame it. */
  const lede = () =>
    h('section', { class: 'lede' }, [
      h('div', null, [
        h('h1', { text: DATA.board_size + ' pre-token protocols, ranked by implied value' }),
        h('p', {
          text:
            'The watchlist is the floor: every protocol with at least $' +
            Math.round(DATA.floor_usd / 1e6) +
            'M of TVL and no token on record, all ' +
            DATA.watchlist_size +
            ' of them covered. The early radar adds ' +
            DATA.early_size +
            ' pre-token protocols below that floor. Implied value is a model, not a promise: it is TVL times a size multiple that falls as a protocol grows, times seven-day growth, times maturity, times chain breadth.',
        }),
      ]),
      h('div', { class: 'facts' }, [
        h('div', { class: 'fact' }, [
          h('span', { text: 'Watchlist covered' }),
          h('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }),
        ]),
        h('div', { class: 'fact' }, [
          h('span', { text: 'Pre-token rows scored' }),
          h('b', { text: String(DATA.board_size) }),
        ]),
        h('div', { class: 'fact' }, [
          h('span', { text: 'Early rows below the floor' }),
          h('b', { text: String(DATA.early_size) }),
        ]),
        h('div', { class: 'fact' }, [
          h('span', { text: 'Total implied value' }),
          h('b', { text: formatMoney(DATA.total_implied_usd) }),
        ]),
        h('div', { class: 'fact' }, [
          h('span', { text: 'Live-token protocols set aside' }),
          h('b', { text: String(DATA.live_size) }),
        ]),
      ]),
    ]);

  /** The search box, the two filters, the tab switch, and the row count. */
  const controlRow = () => {
    const categories = Array.from(new Set(DATA.rows.map((r) => r.category || 'Other'))).sort();
    const chains = Array.from(new Set(DATA.rows.reduce((acc, r) => acc.concat(r.chains || []), []))).sort();
    const search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: ui.query, 'aria-label': 'Search the board' });
    search.addEventListener('input', () => {
      ui.query = search.value;
      saveHash();
      render();
    });
    const categoryOptions = [h('option', { value: 'all', text: 'All categories' })];
    for (const c of categories) {
      categoryOptions.push(h('option', { value: c, text: c, selected: c === ui.category ? 'selected' : null }));
    }
    const catSelect = h('select', { id: 'category', 'aria-label': 'Filter by category' }, categoryOptions);
    catSelect.addEventListener('change', () => {
      ui.category = catSelect.value;
      saveHash();
      render();
    });
    const chainOptions = [h('option', { value: 'all', text: 'All chains' })];
    for (const c of chains) {
      chainOptions.push(h('option', { value: c, text: c, selected: c === ui.chain ? 'selected' : null }));
    }
    const chainSelect = h('select', { id: 'chain', 'aria-label': 'Filter by chain' }, chainOptions);
    chainSelect.addEventListener('change', () => {
      ui.chain = chainSelect.value;
      saveHash();
      render();
    });
    const preTab = h('button', {
      type: 'button',
      'aria-pressed': ui.tab === 'pre-token' ? 'true' : 'false',
      text: 'Pre-token',
      onclick: () => {
        ui.tab = 'pre-token';
        render();
      },
    });
    const liveTab = h('button', {
      type: 'button',
      'aria-pressed': ui.tab === 'live' ? 'true' : 'false',
      text: 'Live token',
      onclick: () => {
        ui.tab = 'live';
        render();
      },
    });
    return h('div', { class: 'controls' }, [
      h('div', { class: 'field' }, [h('label', { for: 'q', text: 'Search' }), search]),
      h('div', { class: 'field' }, [h('label', { for: 'category', text: 'Category' }), catSelect]),
      h('div', { class: 'field' }, [h('label', { for: 'chain', text: 'Chain' }), chainSelect]),
      h('div', { class: 'field' }, [
        h('span', { class: 'sub', text: 'Token status' }),
        h('div', { class: 'tabs' }, [preTab, liveTab]),
      ]),
      h('span', { class: 'count', text: ui.tab === 'pre-token' ? visibleRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' }),
    ]);
  };

  /** One sortable column header: a button that sorts, or reverses, on click. */
  const sortHeader = (key, label) =>
    h('th', { scope: 'col' }, [
      h(
        'button',
        {
          type: 'button',
          onclick: () => {
            if (ui.sortKey === key) ui.sortDir = -ui.sortDir;
            else {
              ui.sortKey = key;
              ui.sortDir = -1;
            }
            render();
          },
        },
        [
          label,
          ui.sortKey === key ? h('span', { 'aria-hidden': 'true', text: ui.sortDir < 0 ? ' v' : ' ^' }) : null,
        ],
      ),
    ]);

  /** The pre-token board as a table, or an empty state when nothing matches. */
  const boardTable = () => {
    const list = orderedRows(visibleRows());
    if (list.length === 0) {
      return h('div', { class: 'panel' }, [
        h('div', { class: 'empty' }, [
          h('h2', { text: 'No protocol matches that filter' }),
          h('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
          h('button', {
            class: 'button primary',
            type: 'button',
            text: 'Clear filters',
            onclick: () => {
              ui.query = '';
              ui.category = 'all';
              ui.chain = 'all';
              saveHash();
              render();
            },
          }),
        ]),
      ]);
    }
    let max = 1;
    for (const r of DATA.rows) if (r.implied_value_usd > max) max = r.implied_value_usd;
    const tbody = h('tbody');
    for (const r of list) {
      const growth = r.change_7d === null ? 'n/a' : formatChange(r.change_7d);
      const growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      const chainsText = r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain';
      const nameCell = h('div', { class: 'name' }, [
        h('b', { text: r.name }),
        h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainsText }),
      ]);
      if (r.watchlist) nameCell.appendChild(h('span', { class: 'badge', text: 'WATCHLIST' }));
      const tr = h(
        'tr',
        {
          'data-selected': ui.openSlug === r.slug ? 'true' : 'false',
          tabindex: '0',
          onclick: () => openDetail(r.slug),
          onkeydown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openDetail(r.slug);
            }
          },
        },
        [
          h('td', { class: 'num', text: String(r.rank) }),
          h('td', null, [nameCell]),
          h('td', { class: 'num', text: formatMoney(r.tvl_usd) }),
          h('td', { class: 'num ' + growthClass, text: growth }),
          h('td', { class: 'num', text: formatAge(r.age_days) }),
          h('td', null, [
            h('div', { class: 'implied' }, [
              h('div', { class: 'bar', 'aria-hidden': 'true' }, [
                h('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' }),
              ]),
              h('span', { class: 'num', text: formatMoney(r.implied_value_usd) }),
            ]),
          ]),
          h('td', null, [h('span', { class: 'status', text: 'no token' })]),
        ],
      );
      tbody.appendChild(tr);
    }
    return h('div', { class: 'panel' }, [
      h('div', { class: 'table-wrap' }, [
        h('table', null, [
          h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan. Gold WATCHLIST marks the snapshot watchlist.' }),
          h('thead', null, [
            h('tr', null, [
              sortHeader('implied', 'Rank'),
              sortHeader('name', 'Protocol'),
              sortHeader('tvl', 'TVL'),
              sortHeader('growth', '7d'),
              sortHeader('age', 'Age'),
              sortHeader('implied', 'Implied value'),
              h('th', { scope: 'col', text: 'Token' }),
            ]),
          ]),
          tbody,
        ]),
      ]),
    ]);
  };

  /** The live-token protocols as a table: the market's own values, not a model. */
  const liveTable = () => {
    const tbody = h('tbody');
    for (const r of DATA.live) {
      const chainsText = r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain';
      tbody.appendChild(
        h('tr', null, [
          h('td', { class: 'num', text: 'live' }),
          h('td', null, [
            h('div', { class: 'name' }, [
              h('b', { text: r.name }),
              h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainsText }),
            ]),
          ]),
          h('td', { class: 'num', text: formatMoney(r.tvl_usd) }),
          h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: formatChange(r.change_7d) }),
          h('td', { class: 'num', text: formatMoney(r.mcap_usd) }),
          h('td', null, [h('span', { class: 'status', text: 'already trades' })]),
        ]),
      );
    }
    return h('div', { class: 'panel' }, [
      h('div', { class: 'table-wrap' }, [
        h('table', null, [
          h('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          h('thead', null, [
            h('tr', null, [
              h('th', { scope: 'col', text: 'Status' }),
              h('th', { scope: 'col', text: 'Protocol' }),
              h('th', { scope: 'col', text: 'TVL' }),
              h('th', { scope: 'col', text: '7d' }),
              h('th', { scope: 'col', text: 'Market cap' }),
              h('th', { scope: 'col', text: 'Token' }),
            ]),
          ]),
          tbody,
        ]),
      ]),
    ]);
  };

  /** The model panel: the formula in full, and what each part of it means. */
  const modelPanel = () => {
    const m = DATA.model;
    const formula =
      `implied = round( tvl_usd x (${m.size_floor} + ${m.size_headroom} / (1 + tvl_usd / ${m.size_half_tvl})) ` +
      `x (1 + clamp(change_7d, ${m.growth_floor}, ${m.growth_cap}) / 100 x ${m.growth_weight}) ` +
      `x (${m.maturity_floor} + min(age_days, ${m.maturity_days}) / ${m.maturity_days} x ${m.maturity_range}) ` +
      `x (1 + ${m.chain_step} x min(chains, ${m.chain_cap})) )`;
    return h('section', { class: 'panel model' }, [
      h('h2', { text: 'How implied value is computed' }),
      h('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      h('div', { class: 'formula', text: formula }),
      h('p', {
        class: 'sub',
        text:
          'TVL and seven-day growth come from the snapshot. The size multiple tapers smoothly from ' +
          (m.size_floor + m.size_headroom) +
          ' toward ' +
          m.size_floor +
          ' as TVL grows, so a small protocol is not buried by a large one. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' +
          m.unknown_age_days +
          ' days. Chain breadth adds at most ' +
          (m.chain_step * m.chain_cap * 100) +
          '%. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.',
      }),
    ]);
  };

  /**
   * Build an SVG node: svgNode('line', { x1: 0, y1: 0, x2: 10, y2: 10 }).
   * Elements are created in the SVG namespace, a prop named `text` sets
   * text content, and anything else becomes an attribute.
   */
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svgNode = (tag, attrs, children = []) => {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const key of Object.keys(attrs)) {
        const value = attrs[key];
        if (value === null || value === undefined) continue;
        if (key === 'text') node.textContent = value;
        else node.setAttribute(key, value);
      }
    }
    for (const child of children) {
      if (child === null || child === undefined) continue;
      node.appendChild(child);
    }
    return node;
  };

  /**
   * The 7-day trend for one protocol: the TVL seven days ago against today,
   * as a two-point line. The prior TVL is derived from the snapshot's own
   * figures — today divided by one plus the seven-day change — so it is the
   * same arithmetic the model runs, not a second source. A protocol with no
   * seven-day change on record gets no line and no invented number.
   */
  const trendChart = (row) => {
    const change = row.change_7d;
    if (change === null || change === undefined || !isFinite(change)) {
      return h('p', { class: 'sub', text: 'No 7-day data: the snapshot reports no seven-day TVL change for this protocol.' });
    }
    const today = row.tvl_usd;
    const weekAgo = today / (1 + change / 100);
    if (!isFinite(weekAgo) || weekAgo <= 0) {
      return h('p', { class: 'sub', text: 'No 7-day data: the reported seven-day change cannot give a prior TVL.' });
    }
    const up = change >= 0;
    const tone = up ? 'up' : 'down';
    // Chart geometry: a 320 by 100 canvas, two points with room for labels.
    const W = 320;
    const H = 100;
    const x0 = 48;
    const x1 = 272;
    const plotTop = 32;
    const plotBottom = 70;
    const lo = Math.min(weekAgo, today);
    const hi = Math.max(weekAgo, today);
    const yFor = (v) => {
      if (hi === lo) return (plotTop + plotBottom) / 2;
      return plotBottom - ((v - lo) / (hi - lo)) * (plotBottom - plotTop);
    };
    const y0 = yFor(weekAgo);
    const y1 = yFor(today);
    const chart = svgNode(
      'svg',
      {
        viewBox: '0 0 ' + W + ' ' + H,
        role: 'img',
        'aria-label': 'TVL 7 days ago ' + formatMoney(weekAgo) + ', today ' + formatMoney(today) + ', change ' + formatChange(change),
      },
      [
        svgNode('line', { class: 'line ' + tone, x1: x0, y1: y0, x2: x1, y2: y1 }),
        svgNode('circle', { class: 'dot ' + tone, cx: x0, cy: y0, r: 4 }),
        svgNode('circle', { class: 'dot ' + tone, cx: x1, cy: y1, r: 4 }),
        svgNode('text', { class: 'trend-value', x: x0, y: y0 - 10, 'text-anchor': 'middle', text: formatMoney(weekAgo) }),
        svgNode('text', { class: 'trend-value', x: x1, y: y1 - 10, 'text-anchor': 'middle', text: formatMoney(today) }),
        svgNode('text', { class: 'dim', x: x0, y: 90, 'text-anchor': 'middle', text: '7 days ago' }),
        svgNode('text', { class: 'dim', x: x1, y: 90, 'text-anchor': 'middle', text: 'Today' }),
        svgNode('text', { class: tone === 'up' ? 'up-text' : 'down-text', x: 160, y: 16, 'text-anchor': 'middle', text: formatChange(change) }),
      ],
    );
    return h('div', { class: 'trend' }, [chart]);
  };

  const dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', () => {
    ui.openSlug = null;
    saveHash();
  });

  /** Open the detail drawer for one protocol: its model inputs and its farm plan. */
  const openDetail = (slug) => {
    const row = DATA.rows.filter((r) => r.slug === slug)[0];
    if (!row) return;
    ui.openSlug = slug;
    saveHash();
    dialog.textContent = '';
    const steps = farmSteps(row);
    const calc = recomputeRow(row, DATA.model);
    dialog.appendChild(
      h('div', { class: 'detail-head' }, [
        h('div', null, [
          h('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? '  ·  Watchlist' : '  ·  Early radar') }),
          h('h2', { id: 'detail-title', text: row.name }),
          h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') }),
        ]),
        h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: () => dialog.close() }),
      ]),
    );
    const equationRows = [
      ['TVL', formatMoney(row.tvl_usd)],
      ['Seven-day growth', formatChange(row.change_7d)],
      ['Age with no token', formatAge(row.age_days)],
      ['Chains', String((row.chains || []).length)],
      ['Size multiplier', String(row.size_multiplier)],
      ['Growth multiplier', String(row.growth_multiplier)],
      ['Maturity multiplier', String(row.maturity_multiplier)],
      ['Chain multiplier', String(row.chain_multiplier)],
      ['Implied value', formatMoney(row.implied_value_usd)],
    ];
    dialog.appendChild(
      h('section', { class: 'detail-section' }, [
        h('h3', { text: 'Implied value' }),
        h(
          'div',
          { class: 'equation' },
          equationRows.map(([label, value]) =>
            h('div', null, [h('span', { text: label }), h('b', { class: 'num', text: value })]),
          ),
        ),
        h('p', {
          class: 'sub',
          text:
            'Model ' +
            DATA.model_version +
            ': the same function scores every protocol. The page recomputes this row as ' +
            formatMoney(calc.implied) +
            (calc.implied === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') +
            ' This is an estimate, not a price.',
        }),
      ]),
    );
    dialog.appendChild(
      h('section', { class: 'detail-section' }, [
        h('h3', { text: '7-day trend' }),
        trendChart(row),
      ]),
    );
    dialog.appendChild(
      h('section', { class: 'detail-section' }, [
        h('h3', { text: 'Farm plan' }),
        h(
          'ol',
          { class: 'steps' },
          steps.map((s) => {
            const at = s.indexOf(' Cost: ');
            const action = at >= 0 ? s.slice(0, at) : s;
            const tail = at >= 0 ? s.slice(at + 1) : '';
            return h('li', null, [h('b', { text: action }), h('span', { class: 'cost', text: tail })]);
          }),
        ),
      ]),
    );
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  };

  /** Render the whole page from the reader's current view. */
  const render = () => {
    mount.textContent = '';
    const shell = h('div', { class: 'shell' });
    shell.appendChild(topBar());
    shell.appendChild(lede());
    shell.appendChild(controlRow());
    shell.appendChild(ui.tab === 'pre-token' ? boardTable() : liveTable());
    if (ui.tab === 'pre-token') shell.appendChild(modelPanel());
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) mount.appendChild(dialog);
    if (ui.openSlug) openDetail(ui.openSlug);
  };

  parseHash();
  render();
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
