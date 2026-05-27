const symbols = [
  "SPY", "SSO", "UPRO", "QQQ", "QLD", "TQQQ",
  "XLK", "VGT", "SMH", "SOXX", "USD", "SOXL",
  "NVDA", "AVGO", "AMD", "MSFT", "AAPL", "META", "GOOGL", "AMZN", "TSLA",
  "GLD", "TLT", "IEF", "SHY", "BIL"
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const avg = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
const stdev = (a) => {
  const m = avg(a);
  return Math.sqrt(avg(a.map((v) => (v - m) ** 2)));
};

async function fetchRows(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10y&interval=1d&events=history`;
  const res = await fetch(url, { headers: { "user-agent": "CodexStrategySearch/1.0" } });
  if (!res.ok) throw new Error(`${symbol} ${res.status}`);
  const payload = await res.json();
  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const timestamps = result?.timestamp || [];
  const rows = timestamps.map((time, i) => ({
    date: new Date(time * 1000).toISOString().slice(0, 10),
    open: Number(quote.open[i]),
    high: Number(quote.high[i]),
    low: Number(quote.low[i]),
    close: Number(quote.close[i]),
    volume: Number(quote.volume[i] || 0)
  })).filter((r) => Number.isFinite(r.close) && Number.isFinite(r.high) && Number.isFinite(r.low));
  if (rows.length < 400) throw new Error(`${symbol} too short`);
  return rows;
}

function rolling(values, n, fn = avg) {
  return values.map((_, i) => i + 1 < n ? null : fn(values.slice(i + 1 - n, i + 1)));
}

function ema(values, n) {
  const k = 2 / (n + 1);
  let prev = values.find(Number.isFinite) ?? 0;
  return values.map((v, i) => {
    if (!Number.isFinite(v)) return i ? prev : null;
    prev = i ? v * k + prev * (1 - k) : v;
    return prev;
  });
}

function rsi(closes, n = 14) {
  const out = Array(closes.length).fill(null);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i += 1) {
    const ch = closes[i] - closes[i - 1];
    gain += Math.max(ch, 0);
    loss += Math.max(-ch, 0);
  }
  let ag = gain / n;
  let al = loss / n;
  for (let i = n; i < closes.length; i += 1) {
    if (i > n) {
      const ch = closes[i] - closes[i - 1];
      ag = (ag * (n - 1) + Math.max(ch, 0)) / n;
      al = (al * (n - 1) + Math.max(-ch, 0)) / n;
    }
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

function mfi(rows, n = 14) {
  const out = Array(rows.length).fill(null);
  const flows = rows.map((r, i) => {
    const tp = (r.high + r.low + r.close) / 3;
    const prev = i ? (rows[i - 1].high + rows[i - 1].low + rows[i - 1].close) / 3 : tp;
    return { up: tp > prev ? tp * r.volume : 0, down: tp < prev ? tp * r.volume : 0 };
  });
  for (let i = n; i < rows.length; i += 1) {
    const w = flows.slice(i + 1 - n, i + 1);
    const up = w.reduce((s, x) => s + x.up, 0);
    const down = w.reduce((s, x) => s + x.down, 0);
    out[i] = down === 0 ? 100 : 100 - 100 / (1 + up / down);
  }
  return out;
}

function decorate(asset) {
  const closes = asset.rows.map((r) => r.close);
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const macd = e12.map((v, i) => v - e26[i]);
  asset.ind = {
    sma20: rolling(closes, 20),
    sma50: rolling(closes, 50),
    sma100: rolling(closes, 100),
    sma200: rolling(closes, 200),
    rsi14: rsi(closes),
    mfi14: mfi(asset.rows),
    macd,
    macdSignal: ema(macd, 9)
  };
  asset.byDate = new Map(asset.rows.map((r, i) => [r.date, i]));
  return asset;
}

function ret(asset, i, days) {
  return i >= days ? asset.rows[i].close / asset.rows[i - days].close - 1 : 0;
}

function vol(asset, i, days = 63) {
  if (i < days + 1) return 0.35;
  const rs = [];
  for (let x = i - days + 1; x <= i; x += 1) rs.push(asset.rows[x].close / asset.rows[x - 1].close - 1);
  return stdev(rs) * Math.sqrt(252);
}

function dd(asset, i, days = 126) {
  const start = Math.max(0, i - days);
  const high = Math.max(...asset.rows.slice(start, i + 1).map((r) => r.close));
  return asset.rows[i].close / high - 1;
}

function maxDrawdown(series) {
  let peak = series[0]?.value ?? 1;
  let out = 0;
  for (const p of series) {
    peak = Math.max(peak, p.value);
    out = Math.min(out, p.value / peak - 1);
  }
  return out;
}

function cagr(series) {
  if (series.length < 2) return 0;
  const years = (new Date(series.at(-1).date) - new Date(series[0].date)) / 31557600000;
  return series.at(-1).value ** (1 / years) - 1;
}

function monthlyDates(base) {
  const dates = [];
  let lastMonth = "";
  for (let i = 1; i < base.rows.length; i += 1) {
    const m = base.rows[i].date.slice(0, 7);
    if (m !== lastMonth) {
      dates.push(base.rows[i].date);
      lastMonth = m;
    }
  }
  return dates;
}

function scoreAsset(asset, qqq, i, qqqI, p) {
  const ind = asset.ind;
  const r1 = ret(asset, i, 21);
  const r3 = ret(asset, i, 63);
  const r6 = ret(asset, i, 126);
  const r12 = ret(asset, i, 252);
  const rel = r3 - ret(qqq, qqqI, 63);
  const trend = asset.rows[i].close > ind.sma200[i] ? 1 : 0;
  const midTrend = asset.rows[i].close > ind.sma50[i] ? 1 : 0;
  const macd = ind.macd[i] > ind.macdSignal[i] ? 1 : 0;
  const flow = (ind.mfi14[i] ?? 50) >= p.mfiLo && (ind.mfi14[i] ?? 50) <= p.mfiHi ? 1 : 0;
  const exhaustion = (ind.mfi14[i] ?? 50) > p.mfiExhaust && (ind.rsi14[i] ?? 50) > p.rsiExhaust ? 1 : 0;
  const v = vol(asset, i, 63);
  const draw = dd(asset, i, 126);
  return (
    p.w1 * r1 + p.w3 * r3 + p.w6 * r6 + p.w12 * r12 + p.wRel * rel
    + p.wTrend * trend + p.wMidTrend * midTrend + p.wMacd * macd + p.wFlow * flow
    - p.wVol * v + p.wDd * draw - p.wExhaust * exhaustion
  );
}

function regime(assets, date, p) {
  const qqq = assets.get("QQQ");
  const spy = assets.get("SPY");
  const q = qqq.byDate.get(date) - 1;
  const s = spy.byDate.get(date) - 1;
  if (q < 252 || s < 252) return { risk: 0, mode: "warmup" };
  let heat = 0;
  if (qqq.rows[q].close > qqq.ind.sma200[q]) heat += 0.26;
  if (qqq.rows[q].close > qqq.ind.sma50[q]) heat += 0.16;
  if (qqq.ind.sma50[q] > qqq.ind.sma200[q]) heat += 0.16;
  if (ret(qqq, q, 63) > p.r3Gate) heat += 0.15;
  if (ret(qqq, q, 126) > p.r6Gate) heat += 0.13;
  if (spy.rows[s].close > spy.ind.sma200[s]) heat += 0.08;
  if (vol(qqq, q, 63) < p.maxQqqVol) heat += 0.06;
  if ((qqq.ind.mfi14[q] ?? 50) > 85 && (qqq.ind.rsi14[q] ?? 50) > 80) heat -= 0.08;
  const risk = heat >= p.fullHeat ? 1 : heat >= p.midHeat ? p.midRisk : heat >= p.lowHeat ? p.lowRisk : p.minRisk;
  return { risk, heat, mode: risk > 0.8 ? "risk-on" : risk > 0.35 ? "balanced" : "defensive" };
}

function allocate(assets, date, p, kind) {
  const qqq = assets.get("QQQ");
  const q = qqq.byDate.get(date) - 1;
  const reg = regime(assets, date, p);
  if (reg.risk <= 0.05) return { weights: { BIL: 0.7, GLD: 0.2, TLT: 0.1 }, mode: reg.mode };

  const pool = kind === "nasdaqLevered"
    ? ["TQQQ", "QLD", "QQQ", "SMH", "SOXX", "USD", "SOXL", "XLK", "VGT", "NVDA", "AVGO", "MSFT", "META"]
    : kind === "universalLevered"
      ? ["TQQQ", "QLD", "SSO", "UPRO", "QQQ", "SPY", "SMH", "SOXX", "XLK", "VGT", "NVDA", "AVGO", "MSFT", "META"]
      : ["QQQ", "SPY", "SMH", "SOXX", "XLK", "VGT", "NVDA", "AVGO", "MSFT", "META", "GLD", "TLT"];

  const ranked = pool
    .map((sym) => {
      const asset = assets.get(sym);
      const i = asset?.byDate.get(date);
      return asset && i > 252 ? { sym, score: scoreAsset(asset, qqq, i - 1, q, p) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, p.holdN);

  const weights = {};
  const raw = ranked.map((r, idx) => Math.max(0.01, Math.exp((r.score - ranked[0].score) / p.temp) * (1 - idx * p.rankDecay)));
  const sum = raw.reduce((a, b) => a + b, 0);
  ranked.forEach((r, idx) => {
    const cap = r.sym === "TQQQ" || r.sym === "SOXL" ? p.tripleCap : r.sym === "QLD" || r.sym === "SSO" || r.sym === "UPRO" || r.sym === "USD" ? p.doubleCap : p.singleCap;
    weights[r.sym] = Math.min(cap, reg.risk * raw[idx] / sum);
  });
  let used = Object.values(weights).reduce((a, b) => a + b, 0);

  if (reg.risk > 0.75 && used < reg.risk && p.coreQld > 0) {
    const add = Math.min(p.coreQld, reg.risk - used, Math.max(0, p.doubleCap - (weights.QLD || 0)));
    weights.QLD = (weights.QLD || 0) + add;
    used += add;
  }
  if (used < 0.98) {
    const safe = reg.risk > 0.45 ? "QQQ" : "BIL";
    weights[safe] = (weights[safe] || 0) + (1 - used);
  }
  return { weights, mode: reg.mode };
}

function simulate(assets, p, kind, start = "2018-01-01", end = "2026-05-15") {
  const base = assets.get("QQQ");
  const rebal = monthlyDates(base).filter((d) => d >= start && d <= end);
  let value = 1;
  const series = [];
  const trades = [];
  for (let r = 0; r < rebal.length - 1; r += 1) {
    const date = rebal[r];
    const next = rebal[r + 1];
    const pack = allocate(assets, date, p, kind);
    trades.push({ date, ...pack });
    const startI = base.byDate.get(date);
    const endI = base.byDate.get(next);
    for (let i = startI + 1; i <= endI; i += 1) {
      const d = base.rows[i].date;
      let daily = 0;
      for (const [sym, w] of Object.entries(pack.weights)) {
        const a = assets.get(sym);
        const ai = a?.byDate.get(d);
        if (!a || !ai) continue;
        daily += w * (a.rows[ai].close / a.rows[ai - 1].close - 1);
      }
      value *= 1 + daily;
      series.push({ date: d, value });
    }
  }
  const months = [];
  for (let i = 1; i < trades.length; i += 1) {
    const from = series.find((x) => x.date >= trades[i - 1].date)?.value ?? 1;
    const to = series.find((x) => x.date >= trades[i].date)?.value ?? from;
    months.push(to / from - 1);
  }
  return {
    kind,
    p,
    series,
    trades,
    total: series.at(-1)?.value - 1 ?? 0,
    cagr: cagr(series),
    mdd: maxDrawdown(series),
    winRate: months.filter((x) => x > 0).length / Math.max(1, months.length)
  };
}

function buyHold(assets, sym, start, end) {
  const a = assets.get(sym);
  const rows = a.rows.filter((r) => r.date >= start && r.date <= end);
  const first = rows[0].close;
  const series = rows.slice(1).map((r) => ({ date: r.date, value: r.close / first }));
  return { sym, total: series.at(-1).value - 1, cagr: cagr(series), mdd: maxDrawdown(series) };
}

function fmt(x) {
  return `${(x * 100).toFixed(1)}%`;
}

const paramGrid = [];
for (const holdN of [2, 3, 4]) {
  for (const tripleCap of [0.2, 0.3, 0.4, 0.55]) {
    for (const doubleCap of [0.45, 0.6, 0.75, 1]) {
      for (const fullHeat of [0.68, 0.74, 0.8]) {
        for (const maxQqqVol of [0.25, 0.32, 0.4]) {
          paramGrid.push({
            holdN, tripleCap, doubleCap, fullHeat, maxQqqVol,
            singleCap: 0.3,
            coreQld: 0.25,
            midHeat: 0.5,
            lowHeat: 0.32,
            midRisk: 0.78,
            lowRisk: 0.35,
            minRisk: 0.05,
            r3Gate: -0.01,
            r6Gate: 0,
            mfiLo: 38,
            mfiHi: 84,
            mfiExhaust: 90,
            rsiExhaust: 82,
            w1: 0.6,
            w3: 1.7,
            w6: 1.2,
            w12: 0.6,
            wRel: 1.1,
            wTrend: 0.2,
            wMidTrend: 0.12,
            wMacd: 0.12,
            wFlow: 0.1,
            wVol: 0.65,
            wDd: 0.45,
            wExhaust: 0.18,
            temp: 0.14,
            rankDecay: 0.1
          });
        }
      }
    }
  }
}

const loaded = new Map();
for (const sym of symbols) {
  try {
    const rows = await fetchRows(sym);
    loaded.set(sym, decorate({ symbol: sym, rows }));
    console.error(`loaded ${sym} ${rows.length}`);
  } catch (e) {
    console.error(`skip ${sym}: ${e.message}`);
  }
}

const results = [];
for (const p of paramGrid) {
  for (const kind of ["nasdaqLevered", "universalLevered", "unleveredPlus"]) {
    const full = simulate(loaded, p, kind, "2018-01-01", "2026-05-15");
    const holdout = simulate(loaded, p, kind, "2024-01-19", "2026-03-25");
    const score = holdout.total * 2.2 + full.cagr * 1.2 + Math.min(0, full.mdd + 0.45) * 0.8 + holdout.winRate * 0.25;
    results.push({ score, full, holdout });
  }
}

results.sort((a, b) => b.score - a.score);
const balanced = results
  .filter((r) => r.full.p.doubleCap <= 0.6 && r.full.p.tripleCap <= 0.3 && r.full.kind !== "unleveredPlus")
  .sort((a, b) => {
    const aScore = a.holdout.total * 1.7 + a.full.cagr * 1.4 + Math.min(0, a.full.mdd + 0.42) * 1.6 + a.holdout.winRate * 0.35;
    const bScore = b.holdout.total * 1.7 + b.full.cagr * 1.4 + Math.min(0, b.full.mdd + 0.42) * 1.6 + b.holdout.winRate * 0.35;
    return bScore - aScore;
  });
const chosen = balanced[0] || results[0];
const periods = [
  ["2018_Q4", "2018-09-20", "2018-12-24"],
  ["2020_crash", "2020-02-19", "2020-03-23"],
  ["2022_bear", "2022-01-03", "2022-10-14"],
  ["2024_2026", "2024-01-19", "2026-03-25"]
].map(([name, start, end]) => {
  const strat = simulate(loaded, chosen.full.p, chosen.full.kind, start, end);
  const qld = buyHold(loaded, "QLD", start, end);
  const qqq = buyHold(loaded, "QQQ", start, end);
  return { name, strategy: { total: fmt(strat.total), mdd: fmt(strat.mdd), winRate: fmt(strat.winRate) }, QLD: { total: fmt(qld.total), mdd: fmt(qld.mdd) }, QQQ: { total: fmt(qqq.total), mdd: fmt(qqq.mdd) } };
});
const qldFull = buyHold(loaded, "QLD", "2018-01-01", "2026-05-15");
const qldHold = buyHold(loaded, "QLD", "2024-01-19", "2026-03-25");
const qqqHold = buyHold(loaded, "QQQ", "2024-01-19", "2026-03-25");
const tqqqHold = buyHold(loaded, "TQQQ", "2024-01-19", "2026-03-25");

console.log(JSON.stringify({
  benchmarks: {
    QLD_full: { total: fmt(qldFull.total), cagr: fmt(qldFull.cagr), mdd: fmt(qldFull.mdd) },
    QQQ_2024_2026: { total: fmt(qqqHold.total), cagr: fmt(qqqHold.cagr), mdd: fmt(qqqHold.mdd) },
    QLD_2024_2026: { total: fmt(qldHold.total), cagr: fmt(qldHold.cagr), mdd: fmt(qldHold.mdd) },
    TQQQ_2024_2026: { total: fmt(tqqqHold.total), cagr: fmt(tqqqHold.cagr), mdd: fmt(tqqqHold.mdd) }
  },
  top: results.slice(0, 12).map((r) => ({
    kind: r.full.kind,
    score: r.score.toFixed(4),
    holdout: { total: fmt(r.holdout.total), cagr: fmt(r.holdout.cagr), mdd: fmt(r.holdout.mdd), winRate: fmt(r.holdout.winRate) },
    full: { total: fmt(r.full.total), cagr: fmt(r.full.cagr), mdd: fmt(r.full.mdd), winRate: fmt(r.full.winRate) },
    p: r.full.p,
    recentTrades: r.holdout.trades.slice(-8).map((t) => ({
      date: t.date,
      mode: t.mode,
      weights: Object.fromEntries(Object.entries(t.weights).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, `${(v * 100).toFixed(0)}%`]))
    }))
  })),
  balancedTop: balanced.slice(0, 5).map((r) => ({
    kind: r.full.kind,
    holdout: { total: fmt(r.holdout.total), cagr: fmt(r.holdout.cagr), mdd: fmt(r.holdout.mdd), winRate: fmt(r.holdout.winRate) },
    full: { total: fmt(r.full.total), cagr: fmt(r.full.cagr), mdd: fmt(r.full.mdd), winRate: fmt(r.full.winRate) },
    p: r.full.p,
    recentTrades: r.holdout.trades.slice(-6).map((t) => ({
      date: t.date,
      mode: t.mode,
      weights: Object.fromEntries(Object.entries(t.weights).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, `${(v * 100).toFixed(0)}%`]))
    }))
  })),
  chosenBalancedBreakdown: periods
}, null, 2));
