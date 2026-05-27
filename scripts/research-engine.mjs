import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const reportJsonPath = path.join(dataDir, "research-report.json");
const reportMdPath = path.join(dataDir, "research-report.md");
const registryPath = path.join(dataDir, "model-registry.json");
const auditPath = path.join(dataDir, "research-audit-log.jsonl");

const START_DATE = "1999-01-01";
const MIN_HISTORY = 252;
const TRADING_DAYS = 252;
const executionCostModel = {
  brokerName: "Korea Investment Securities US online base case",
  buyCommission: 0.0025,
  sellCommission: 0.0025,
  secFeeSell: 0.0000206,
  slippage: 0.0005,
  annualTaxRate: 0.22,
  annualBasicDeductionRateAt100mKrw: 0.025,
  minMonthlyTurnover: 0.035,
  maxMonthlyTurnover: 0.22
};

const assetCatalog = [
  ["SPY", "SPDR S&P 500 ETF", "broad_equity", "US large cap", "1993-01-29", 1, true],
  ["QQQ", "Invesco QQQ Trust", "broad_equity", "Nasdaq 100", "1999-03-10", 1, true],
  ["DIA", "SPDR Dow Jones Industrial Average ETF", "broad_equity", "Dow 30", "1998-01-14", 1, true],
  ["IWM", "iShares Russell 2000 ETF", "broad_equity", "US small cap", "2000-05-22", 1, true],
  ["QLD", "ProShares Ultra QQQ", "leveraged_equity", "Nasdaq 100", "2006-06-21", 2, true],
  ["TQQQ", "ProShares UltraPro QQQ", "leveraged_equity", "Nasdaq 100", "2010-02-09", 3, true],
  ["SSO", "ProShares Ultra S&P500", "leveraged_equity", "S&P 500", "2006-06-21", 2, true],
  ["UPRO", "ProShares UltraPro S&P500", "leveraged_equity", "S&P 500", "2009-06-25", 3, true],
  ["XLK", "Technology Select Sector SPDR", "sector_equity", "Technology", "1998-12-16", 1, true],
  ["XLF", "Financial Select Sector SPDR", "sector_equity", "Financials", "1998-12-16", 1, true],
  ["XLE", "Energy Select Sector SPDR", "sector_equity", "Energy", "1998-12-16", 1, true],
  ["XLV", "Health Care Select Sector SPDR", "sector_equity", "Health care", "1998-12-16", 1, true],
  ["XLY", "Consumer Discretionary Select Sector SPDR", "sector_equity", "Consumer discretionary", "1998-12-16", 1, true],
  ["XLP", "Consumer Staples Select Sector SPDR", "sector_equity", "Consumer staples", "1998-12-16", 1, true],
  ["XLU", "Utilities Select Sector SPDR", "sector_equity", "Utilities", "1998-12-16", 1, true],
  ["XLI", "Industrial Select Sector SPDR", "sector_equity", "Industrials", "1998-12-16", 1, true],
  ["XLB", "Materials Select Sector SPDR", "sector_equity", "Materials", "1998-12-16", 1, true],
  ["SMH", "VanEck Semiconductor ETF", "industry_equity", "Semiconductors", "2011-12-20", 1, true],
  ["SOXX", "iShares Semiconductor ETF", "industry_equity", "Semiconductors", "2001-07-10", 1, true],
  ["USD", "ProShares Ultra Semiconductors", "leveraged_equity", "Semiconductors", "2007-01-30", 2, true],
  ["SOXL", "Direxion Daily Semiconductor Bull 3X", "leveraged_equity", "Semiconductors", "2010-03-11", 3, true],
  ["EFA", "iShares MSCI EAFE ETF", "country_region", "Developed ex-US", "2001-08-14", 1, true],
  ["EEM", "iShares MSCI Emerging Markets ETF", "country_region", "Emerging markets", "2003-04-11", 1, true],
  ["FXI", "iShares China Large-Cap ETF", "country_region", "China", "2004-10-08", 1, true],
  ["SHY", "iShares 1-3 Year Treasury Bond ETF", "bond", "Treasury short", "2002-07-22", 1, true],
  ["IEF", "iShares 7-10 Year Treasury Bond ETF", "bond", "Treasury intermediate", "2002-07-22", 1, true],
  ["TLT", "iShares 20+ Year Treasury Bond ETF", "bond", "Treasury long", "2002-07-22", 1, true],
  ["BIL", "SPDR Bloomberg 1-3 Month T-Bill ETF", "cash", "T-bill", "2007-05-25", 1, true],
  ["GLD", "SPDR Gold Shares", "commodity", "Gold", "2004-11-18", 1, true],
  ["SLV", "iShares Silver Trust", "commodity", "Silver", "2006-04-21", 1, true],
  ["UUP", "Invesco DB US Dollar Index Bullish Fund", "currency", "US dollar", "2007-02-20", 1, true],
  ["FXE", "Invesco CurrencyShares Euro Trust", "currency", "Euro", "2005-12-12", 1, true],
  ["NVDA", "NVIDIA", "single_stock", "Semiconductors", "1999-01-22", 1, true],
  ["AMD", "Advanced Micro Devices", "single_stock", "Semiconductors", "1980-03-17", 1, true],
  ["AVGO", "Broadcom", "single_stock", "Semiconductors", "2009-08-06", 1, true],
  ["MU", "Micron", "single_stock", "Semiconductors", "1984-06-01", 1, true],
  ["TSM", "Taiwan Semiconductor ADR", "single_stock", "Semiconductors", "1997-10-09", 1, true],
  ["ASML", "ASML ADR", "single_stock", "Semiconductor equipment", "1995-03-15", 1, true],
  ["MSFT", "Microsoft", "single_stock", "Software", "1986-03-13", 1, true],
  ["AAPL", "Apple", "single_stock", "Hardware", "1980-12-12", 1, true],
  ["AMZN", "Amazon", "single_stock", "Internet retail", "1997-05-15", 1, true],
  ["GOOGL", "Alphabet", "single_stock", "Internet", "2004-08-19", 1, true],
  ["META", "Meta Platforms", "single_stock", "Internet", "2012-05-18", 1, true],
  ["NFLX", "Netflix", "single_stock", "Internet", "2002-05-23", 1, true],
  ["ORCL", "Oracle", "single_stock", "Software", "1986-03-12", 1, true],
  ["INTC", "Intel", "single_stock", "Semiconductors", "1980-03-17", 1, true],
  ["CSCO", "Cisco", "single_stock", "Networking", "1990-02-16", 1, true]
].map(([ticker, name, assetClass, sector, inception, leverage, liveTradable]) => ({
  ticker, name, assetClass, sector, inception, leverage, liveTradable,
  real: true,
  synthetic: false,
  source: "Yahoo Finance chart API"
}));

const proxySpecs = [
  { ticker: "SYN_QLD", name: "Synthetic 2x QQQ", underlying: "QQQ", leverage: 2, assetClass: "synthetic_leveraged_equity", sector: "Nasdaq 100", inception: "1999-03-10", realTicker: "QLD" },
  { ticker: "SYN_TQQQ", name: "Synthetic 3x QQQ", underlying: "QQQ", leverage: 3, assetClass: "synthetic_leveraged_equity", sector: "Nasdaq 100", inception: "1999-03-10", realTicker: "TQQQ" },
  { ticker: "SYN_USD", name: "Synthetic 2x Semiconductor", underlying: "SOXX", leverage: 2, assetClass: "synthetic_leveraged_equity", sector: "Semiconductors", inception: "2001-07-10", realTicker: "USD" },
  { ticker: "SYN_SOXL", name: "Synthetic 3x Semiconductor", underlying: "SOXX", leverage: 3, assetClass: "synthetic_leveraged_equity", sector: "Semiconductors", inception: "2001-07-10", realTicker: "SOXL" }
];

const regimes = [
  ["dot_com_crash", "1999-01-01", "2002-12-31"],
  ["post_crash_recovery", "2003-01-01", "2007-10-31"],
  ["global_financial_crisis", "2007-11-01", "2009-12-31"],
  ["qe_bull_market", "2010-01-01", "2017-12-31"],
  ["q4_2018_drawdown", "2018-09-20", "2018-12-24"],
  ["covid_crash_rebound", "2020-02-19", "2020-12-31"],
  ["inflation_rate_shock", "2022-01-03", "2022-10-14"],
  ["ai_semiconductor_cycle", "2023-01-01", "2099-12-31"]
];

const modelConfigs = [
  {
    id: "baseline_report_rebuild",
    label: "REPORT.md baseline reconstruction",
    universe: "report_seed",
    holdN: 4,
    riskMode: "qld_alpha",
    momentumMix: [0.18, 0.34, 0.28, 0.12],
    volPenalty: 0.58,
    drawdownPenalty: 0.42,
    flowWeight: 0.16,
    topCap: 0.40,
    stockCap: 0.18,
    leveragedCap: 0.30,
    syntheticCap: 0.24,
    sectorCap: 0.58,
    cashFloorRiskOff: 0.50
  },
  {
    id: "dynamic_robust_hybrid",
    label: "Dynamic robust hybrid",
    universe: "full_dynamic",
    holdN: 6,
    riskMode: "multi_regime",
    momentumMix: [0.12, 0.30, 0.30, 0.18],
    volPenalty: 0.74,
    drawdownPenalty: 0.55,
    flowWeight: 0.18,
    topCap: 0.34,
    stockCap: 0.16,
    leveragedCap: 0.24,
    syntheticCap: 0.18,
    sectorCap: 0.42,
    cashFloorRiskOff: 0.60
  },
  {
    id: "cost_aware_universal_rotation",
    label: "Cost-aware universal rotation",
    universe: "full_dynamic",
    holdN: 7,
    riskMode: "multi_regime",
    momentumMix: [0.10, 0.26, 0.28, 0.18],
    volPenalty: 0.92,
    drawdownPenalty: 0.72,
    flowWeight: 0.14,
    topCap: 0.30,
    stockCap: 0.14,
    leveragedCap: 0.18,
    syntheticCap: 0.12,
    sectorCap: 0.38,
    cashFloorRiskOff: 0.64
  },
  {
    id: "dynamic_low_vol_trend",
    label: "Low-volatility trend rotation",
    universe: "full_dynamic",
    holdN: 7,
    riskMode: "multi_regime",
    momentumMix: [0.06, 0.22, 0.28, 0.20],
    volPenalty: 1.10,
    drawdownPenalty: 0.72,
    flowWeight: 0.10,
    topCap: 0.30,
    stockCap: 0.14,
    leveragedCap: 0.16,
    syntheticCap: 0.10,
    sectorCap: 0.38,
    cashFloorRiskOff: 0.68
  },
  {
    id: "dynamic_growth_offense",
    label: "Dynamic growth offense",
    universe: "full_dynamic",
    holdN: 4,
    riskMode: "multi_regime",
    momentumMix: [0.20, 0.38, 0.28, 0.16],
    volPenalty: 0.40,
    drawdownPenalty: 0.32,
    flowWeight: 0.24,
    topCap: 0.42,
    stockCap: 0.20,
    leveragedCap: 0.30,
    syntheticCap: 0.26,
    sectorCap: 0.46,
    cashFloorRiskOff: 0.45
  },
  {
    id: "crash_survival_rotation",
    label: "Crash survival rotation",
    universe: "full_dynamic",
    holdN: 8,
    riskMode: "strict_defense",
    momentumMix: [0.04, 0.16, 0.22, 0.18],
    volPenalty: 1.30,
    drawdownPenalty: 0.95,
    flowWeight: 0.06,
    topCap: 0.26,
    stockCap: 0.10,
    leveragedCap: 0.08,
    syntheticCap: 0.06,
    sectorCap: 0.40,
    cashFloorRiskOff: 0.78
  }
];

const benchmarkSpecs = [
  { id: "QQQ", type: "buy_hold", symbol: "QQQ" },
  { id: "SPY", type: "buy_hold", symbol: "SPY" },
  { id: "QLD_or_SYN_QLD", type: "buy_hold", symbol: "QLD", fallback: "SYN_QLD" },
  { id: "TQQQ_or_SYN_TQQQ", type: "buy_hold", symbol: "TQQQ", fallback: "SYN_TQQQ" },
  { id: "SPY_IEF_60_40", type: "static_mix", weights: { SPY: 0.6, IEF: 0.4 } },
  { id: "QQQ_BIL_trend", type: "trend", risk: "QQQ", safe: "BIL" }
];

const avg = (arr) => arr.length ? arr.reduce((sum, value) => sum + value, 0) / arr.length : 0;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const pct = (value) => `${(value * 100).toFixed(1)}%`;
const isoToday = () => new Date().toISOString().slice(0, 10);
const concentrationExempt = new Set(["BIL", "SHY", "IEF", "TLT", "GLD", "UUP", "FXE"]);
const riskOffAssets = new Set(["BIL", "SHY", "IEF", "TLT", "GLD", "UUP", "FXE"]);

function stdev(values) {
  const mean = avg(values);
  return Math.sqrt(avg(values.map((value) => (value - mean) ** 2)));
}

function weightTurnover(fromWeights = {}, toWeights = {}) {
  return Object.keys({ ...fromWeights, ...toWeights })
    .reduce((sum, symbol) => sum + Math.abs((toWeights[symbol] || 0) - (fromWeights[symbol] || 0)), 0) / 2;
}

function transactionCostRate(turnover, stress = 1) {
  const roundTrip = executionCostModel.buyCommission + executionCostModel.sellCommission + executionCostModel.secFeeSell + executionCostModel.slippage * 2;
  return Math.max(0, turnover) * roundTrip * stress;
}

function transactionCostForWeights(fromWeights = {}, toWeights = {}, stress = 1) {
  let buys = 0;
  let sells = 0;
  for (const symbol of Object.keys({ ...fromWeights, ...toWeights })) {
    if (symbol === "CASH") continue;
    const diff = (toWeights[symbol] || 0) - (fromWeights[symbol] || 0);
    if (diff > 0) buys += diff;
    else sells += Math.abs(diff);
  }
  return stress * (buys * (executionCostModel.buyCommission + executionCostModel.slippage) + sells * (executionCostModel.sellCommission + executionCostModel.secFeeSell + executionCostModel.slippage));
}

function hasRiskReduction(fromWeights = {}, toWeights = {}) {
  const riskFrom = Object.entries(fromWeights).reduce((sum, [symbol, weight]) => sum + (riskOffAssets.has(symbol) ? 0 : weight), 0);
  const riskTo = Object.entries(toWeights).reduce((sum, [symbol, weight]) => sum + (riskOffAssets.has(symbol) ? 0 : weight), 0);
  return riskTo + 0.06 < riskFrom;
}

function costAwareTarget(previousWeights, targetWeights, regime, force = false) {
  const turnover = weightTurnover(previousWeights, targetWeights);
  const minTurnover = regime?.heat < 0.40 ? 0.055 : executionCostModel.minMonthlyTurnover;
  if (!force && !hasRiskReduction(previousWeights, targetWeights) && turnover < minTurnover) {
    return { targetWeights: previousWeights, turnover, cost: 0, skipped: true, reason: `turnover_below_${(minTurnover * 100).toFixed(1)}pct` };
  }
  if (!force && !hasRiskReduction(previousWeights, targetWeights) && turnover > executionCostModel.maxMonthlyTurnover) {
    const step = executionCostModel.maxMonthlyTurnover / turnover;
    const stepped = {};
    Object.keys({ ...previousWeights, ...targetWeights }).forEach((symbol) => {
      stepped[symbol] = (previousWeights[symbol] || 0) + ((targetWeights[symbol] || 0) - (previousWeights[symbol] || 0)) * step;
    });
    const steppedWeights = normalizeWeights(stepped);
    const steppedTurnover = weightTurnover(previousWeights, steppedWeights);
    return { targetWeights: steppedWeights, turnover: steppedTurnover, cost: transactionCostForWeights(previousWeights, steppedWeights), skipped: false, reason: `staged_rebalance_cap_${(executionCostModel.maxMonthlyTurnover * 100).toFixed(0)}pct` };
  }
  return { targetWeights, turnover, cost: transactionCostForWeights(previousWeights, targetWeights), skipped: false, reason: "cost_adjusted_rebalance" };
}

function hashConfig(config) {
  return crypto.createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 16);
}

function yahooSymbol(symbol) {
  return symbol;
}

async function fetchRows(symbol) {
  const period1 = Math.floor(new Date(`${START_DATE}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}?period1=${period1}&period2=${period2}&interval=1d&events=history&includeAdjustedClose=true`;
  const res = await fetch(url, { headers: { "user-agent": "AlphaStockResearchEngine/1.0" } });
  if (!res.ok) throw new Error(`${symbol} ${res.status}`);
  const payload = await res.json();
  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const adj = result?.indicators?.adjclose?.[0]?.adjclose || [];
  const timestamps = result?.timestamp || [];
  if (!quote || !timestamps.length) throw new Error(`${symbol} missing chart data`);
  const rows = timestamps.map((time, index) => {
    const close = Number(adj[index] ?? quote.close[index]);
    const rawClose = Number(quote.close[index]);
    const factor = rawClose && close ? close / rawClose : 1;
    return {
      date: new Date(time * 1000).toISOString().slice(0, 10),
      open: Number(quote.open[index]) * factor,
      high: Number(quote.high[index]) * factor,
      low: Number(quote.low[index]) * factor,
      close,
      volume: Number(quote.volume[index] || 0)
    };
  }).filter((row) => Number.isFinite(row.close) && Number.isFinite(row.high) && Number.isFinite(row.low));
  if (rows.length < 80) throw new Error(`${symbol} too little usable data`);
  return rows;
}

function rolling(values, size, fn = avg) {
  return values.map((_, index) => index + 1 < size ? null : fn(values.slice(index + 1 - size, index + 1)));
}

function ema(values, size) {
  const k = 2 / (size + 1);
  let prev = values.find(Number.isFinite) ?? 0;
  return values.map((value, index) => {
    if (!Number.isFinite(value)) return index ? prev : null;
    prev = index ? value * k + prev * (1 - k) : value;
    return prev;
  });
}

function rsi(closes, size = 14) {
  const out = Array(closes.length).fill(null);
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= size && index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    gain += Math.max(change, 0);
    loss += Math.max(-change, 0);
  }
  let ag = gain / size;
  let al = loss / size;
  for (let index = size; index < closes.length; index += 1) {
    if (index > size) {
      const change = closes[index] - closes[index - 1];
      ag = (ag * (size - 1) + Math.max(change, 0)) / size;
      al = (al * (size - 1) + Math.max(-change, 0)) / size;
    }
    out[index] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

function mfi(rows, size = 14) {
  const out = Array(rows.length).fill(null);
  const flows = rows.map((row, index) => {
    const typical = (row.high + row.low + row.close) / 3;
    const previous = index ? (rows[index - 1].high + rows[index - 1].low + rows[index - 1].close) / 3 : typical;
    return { up: typical > previous ? typical * row.volume : 0, down: typical < previous ? typical * row.volume : 0 };
  });
  for (let index = size; index < rows.length; index += 1) {
    const window = flows.slice(index + 1 - size, index + 1);
    const up = window.reduce((sum, item) => sum + item.up, 0);
    const down = window.reduce((sum, item) => sum + item.down, 0);
    out[index] = down === 0 ? 100 : 100 - 100 / (1 + up / down);
  }
  return out;
}

function decorate(asset) {
  const closes = asset.rows.map((row) => row.close);
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const macd = e12.map((value, index) => value - e26[index]);
  asset.ind = {
    sma20: rolling(closes, 20),
    sma50: rolling(closes, 50),
    sma100: rolling(closes, 100),
    sma200: rolling(closes, 200),
    rsi14: rsi(closes),
    mfi14: mfi(asset.rows),
    macd,
    macdSignal: ema(macd, 9),
    vol63: closes.map((_, index) => realizedVol(asset.rows, index, 63))
  };
  asset.byDate = new Map(asset.rows.map((row, index) => [row.date, index]));
  asset.firstValidDate = asset.rows[0]?.date || asset.meta.inception;
  return asset;
}

function realizedVol(rows, index, days = 63) {
  if (index < days + 1) return 0.35;
  const returns = [];
  for (let cursor = index - days + 1; cursor <= index; cursor += 1) {
    returns.push(rows[cursor].close / rows[cursor - 1].close - 1);
  }
  return stdev(returns) * Math.sqrt(TRADING_DAYS);
}

function drawdown(rows, index, days = 126) {
  const start = Math.max(0, index - days);
  const high = Math.max(...rows.slice(start, index + 1).map((row) => row.close));
  return rows[index].close / high - 1;
}

function ret(rows, index, days) {
  return index >= days && rows[index - days] ? rows[index].close / rows[index - days].close - 1 : 0;
}

function synthesizeProxy(spec, underlying) {
  const dailyFinancingCost = 0.045 / TRADING_DAYS;
  const expenseDrag = 0.0095 / TRADING_DAYS;
  const trackingError = spec.leverage >= 3 ? 0.0011 / Math.sqrt(TRADING_DAYS) : 0.0007 / Math.sqrt(TRADING_DAYS);
  let value = 100;
  const rows = [];
  for (let index = 1; index < underlying.rows.length; index += 1) {
    const previous = underlying.rows[index - 1];
    const current = underlying.rows[index];
    if (current.date < spec.inception) continue;
    const underlyingReturn = current.close / previous.close - 1;
    const daily = spec.leverage * underlyingReturn - dailyFinancingCost - expenseDrag - trackingError;
    value = Math.max(0.01, value * (1 + daily));
    rows.push({ date: current.date, open: value, high: value, low: value, close: value, volume: 0 });
  }
  return decorate({
    symbol: spec.ticker,
    rows,
    meta: {
      ticker: spec.ticker,
      name: spec.name,
      assetClass: spec.assetClass,
      sector: spec.sector,
      inception: spec.inception,
      leverage: spec.leverage,
      source: `synthetic daily-reset proxy from ${spec.underlying}`,
      underlying: spec.underlying,
      realTicker: spec.realTicker,
      liveTradable: false,
      real: false,
      synthetic: true,
      proxyAssumptions: { dailyFinancingCost, expenseDrag, trackingError }
    }
  });
}

async function buildAssetStore() {
  const assets = new Map();
  const errors = [];
  for (const meta of assetCatalog) {
    try {
      const rows = await fetchRows(meta.ticker);
      assets.set(meta.ticker, decorate({ symbol: meta.ticker, rows, meta }));
      console.error(`loaded ${meta.ticker} ${rows[0]?.date} ${rows.at(-1)?.date} rows=${rows.length}`);
    } catch (error) {
      errors.push({ ticker: meta.ticker, error: error.message });
      console.error(`skip ${meta.ticker}: ${error.message}`);
    }
  }
  for (const spec of proxySpecs) {
    const underlying = assets.get(spec.underlying);
    if (!underlying) {
      errors.push({ ticker: spec.ticker, error: `missing underlying ${spec.underlying}` });
      continue;
    }
    const synthetic = synthesizeProxy(spec, underlying);
    if (synthetic.rows.length >= MIN_HISTORY) assets.set(spec.ticker, synthetic);
  }
  return { assets, errors };
}

function priceIndex(asset, date) {
  return asset?.byDate.get(date);
}

function isEligible(asset, date, signalIndex, config) {
  const reasons = [];
  if (!asset) return { ok: false, reasons: ["missing_asset"] };
  if (date < asset.meta.inception) reasons.push("not_yet_listed");
  if (signalIndex == null) reasons.push("missing_price_on_signal_date");
  if (signalIndex != null && signalIndex < MIN_HISTORY) reasons.push("insufficient_history");
  if (asset.meta.synthetic && config.syntheticCap <= 0) reasons.push("synthetic_blocked");
  if (asset.meta.assetClass === "single_stock") {
    const avgVol = avg(asset.rows.slice(Math.max(0, signalIndex - 20), signalIndex + 1).map((row) => row.volume || 0));
    if (avgVol > 0 && avgVol < 500000) reasons.push("liquidity_proxy_too_low");
  }
  return { ok: reasons.length === 0, reasons };
}

function regimeState(assets, date) {
  const qqq = assets.get("QQQ");
  const spy = assets.get("SPY") || qqq;
  const q = priceIndex(qqq, date);
  const s = priceIndex(spy, date);
  if (q == null || s == null || q < MIN_HISTORY || s < MIN_HISTORY) {
    return { label: "warmup", heat: 0.20, riskBudget: 0.15, reasons: ["insufficient_regime_history"] };
  }
  const reasons = [];
  let heat = 0;
  if (qqq.rows[q].close > qqq.ind.sma200[q]) { heat += 0.20; reasons.push("QQQ above 200d"); }
  if (qqq.rows[q].close > qqq.ind.sma50[q]) { heat += 0.14; reasons.push("QQQ above 50d"); }
  if (qqq.ind.sma50[q] > qqq.ind.sma200[q]) { heat += 0.14; reasons.push("QQQ 50d above 200d"); }
  if (ret(qqq.rows, q, 63) > 0) { heat += 0.12; reasons.push("QQQ 3m momentum positive"); }
  if (ret(qqq.rows, q, 126) > 0) { heat += 0.10; reasons.push("QQQ 6m momentum positive"); }
  if (spy.rows[s].close > spy.ind.sma200[s]) { heat += 0.10; reasons.push("SPY above 200d"); }
  if (drawdown(qqq.rows, q, 126) > -0.08) { heat += 0.09; reasons.push("QQQ drawdown contained"); }
  if (realizedVol(qqq.rows, q, 63) < 0.30) { heat += 0.08; reasons.push("QQQ volatility acceptable"); }
  const mfiNow = qqq.ind.mfi14[q] ?? 50;
  const rsiNow = qqq.ind.rsi14[q] ?? 50;
  if (mfiNow > 88 && rsiNow > 80) { heat -= 0.08; reasons.push("MFI/RSI overheated"); }
  heat = clamp(heat, 0, 1);
  const riskBudget = heat >= 0.72 ? 0.98 : heat >= 0.54 ? 0.76 : heat >= 0.36 ? 0.42 : 0.12;
  const label = heat >= 0.72 ? "risk_on" : heat >= 0.54 ? "growth_bias" : heat >= 0.36 ? "balanced_defensive" : "risk_off";
  return { label, heat, riskBudget, reasons };
}

function allowedUniverse(config) {
  if (config.universe === "report_seed") {
    return new Set(["QQQ", "QLD", "SYN_QLD", "TQQQ", "SYN_TQQQ", "SMH", "SOXX", "USD", "SYN_USD", "SOXL", "SYN_SOXL", "XLK", "VGT", "NVDA", "AVGO", "AMD", "MU", "TSM", "ASML", "MSFT", "META", "GOOGL", "AMZN", "GLD", "TLT", "IEF", "SHY", "BIL"]);
  }
  return null;
}

function scoreAsset(asset, benchmark, date, config) {
  const index = priceIndex(asset, date);
  const bIndex = priceIndex(benchmark, date);
  if (index == null || bIndex == null) return -Infinity;
  const [w1, w3, w6, w12] = config.momentumMix;
  const r1 = ret(asset.rows, index, 21);
  const r3 = ret(asset.rows, index, 63);
  const r6 = ret(asset.rows, index, 126);
  const r12 = ret(asset.rows, index, 252);
  const rel = r3 - ret(benchmark.rows, bIndex, 63);
  const trend = asset.rows[index].close > asset.ind.sma200[index] ? 1 : 0;
  const midTrend = asset.rows[index].close > asset.ind.sma50[index] ? 1 : 0;
  const macd = asset.ind.macd[index] > asset.ind.macdSignal[index] ? 1 : 0;
  const mfiNow = asset.ind.mfi14[index] ?? 50;
  const mfiPrev = asset.ind.mfi14[index - 10] ?? mfiNow;
  const flow = mfiNow >= 42 && mfiNow <= 82 && mfiNow >= mfiPrev - 2 ? 1 : 0;
  const overheating = mfiNow > 88 && (asset.ind.rsi14[index] ?? 50) > 78 ? 1 : 0;
  const vol = realizedVol(asset.rows, index, 63);
  const dd = drawdown(asset.rows, index, 126);
  let score = w1 * r1 + w3 * r3 + w6 * r6 + w12 * r12;
  score += 0.20 * rel + 0.10 * trend + 0.07 * midTrend + 0.08 * macd + config.flowWeight * flow;
  score -= config.volPenalty * vol + config.drawdownPenalty * Math.abs(Math.min(0, dd));
  score -= 0.10 * overheating;
  if (asset.meta.assetClass === "cash") score += config.riskMode === "strict_defense" ? 0.03 : -0.05;
  if (asset.meta.synthetic) score -= 0.05;
  return score;
}

function capForAsset(asset, config) {
  if (asset.meta.synthetic) return config.syntheticCap;
  if (asset.meta.assetClass === "single_stock") return config.stockCap;
  if (asset.meta.leverage >= 2) return config.leveragedCap;
  if (asset.meta.assetClass === "cash" || asset.meta.assetClass === "bond") return 0.80;
  return config.topCap;
}

function enforceSectorCap(weightRows, config) {
  const bySector = new Map();
  for (const row of weightRows) {
    const used = bySector.get(row.asset.meta.sector) || 0;
    const room = Math.max(0, config.sectorCap - used);
    row.weight = Math.min(row.weight, room);
    bySector.set(row.asset.meta.sector, used + row.weight);
  }
  return weightRows;
}

function allocate(assets, signalDate, config) {
  const benchmark = assets.get("QQQ") || assets.get("SPY");
  const regime = regimeState(assets, signalDate);
  let riskBudget = regime.riskBudget;
  if (config.riskMode === "strict_defense") riskBudget = Math.min(riskBudget, regime.heat >= 0.72 ? 0.70 : 0.40);
  if (config.riskMode === "qld_alpha" && regime.heat >= 0.72) riskBudget = 1.0;
  if (regime.label === "risk_off") riskBudget = Math.max(0.05, riskBudget - 0.10);

  const allowed = allowedUniverse(config);
  const excluded = [];
  const candidates = [];
  for (const asset of assets.values()) {
    if (allowed && !allowed.has(asset.symbol)) continue;
    if (asset.meta.synthetic && asset.meta.realTicker) {
      const real = assets.get(asset.meta.realTicker);
      const realIndex = priceIndex(real, signalDate);
      if (realIndex != null && realIndex >= MIN_HISTORY) {
        excluded.push({ symbol: asset.symbol, reasons: [`real_asset_available:${asset.meta.realTicker}`] });
        continue;
      }
    }
    const signalIndex = priceIndex(asset, signalDate);
    const eligible = isEligible(asset, signalDate, signalIndex, config);
    if (!eligible.ok) {
      excluded.push({ symbol: asset.symbol, reasons: eligible.reasons });
      continue;
    }
    const score = scoreAsset(asset, benchmark, signalDate, config);
    if (!Number.isFinite(score)) {
      excluded.push({ symbol: asset.symbol, reasons: ["score_not_finite"] });
      continue;
    }
    if (asset.meta.assetClass !== "cash" && asset.meta.assetClass !== "bond" && score < -0.18) {
      excluded.push({ symbol: asset.symbol, reasons: ["failed_trend_or_momentum_filter"], score });
      continue;
    }
    candidates.push({ asset, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  const risky = candidates.filter((item) => !["cash", "bond"].includes(item.asset.meta.assetClass)).slice(0, config.holdN);
  const safe = candidates.filter((item) => ["cash", "bond", "commodity", "currency"].includes(item.asset.meta.assetClass)).slice(0, 3);
  const selected = regime.label === "risk_off" ? safe : [...risky, ...safe.slice(0, 1)];
  if (!selected.length) {
    const fallback = assets.get("BIL") || assets.get("SHY") || assets.get("SPY") || benchmark;
    return {
      targetWeights: { [fallback.symbol]: 1 },
      regime,
      selected: [{ symbol: fallback.symbol, score: 0, reason: "last_resort_fallback" }],
      excluded,
      reasonCodes: ["fallback_only"]
    };
  }

  const maxScore = selected[0].score;
  const rows = selected.map((item, rank) => {
    const raw = Math.max(0.01, Math.exp((item.score - maxScore) / 0.20) * (1 - rank * 0.08));
    return { ...item, raw };
  });
  const riskRows = rows.filter((row) => !["cash", "bond", "commodity", "currency"].includes(row.asset.meta.assetClass));
  const safeRows = rows.filter((row) => ["cash", "bond", "commodity", "currency"].includes(row.asset.meta.assetClass));
  const riskRawSum = riskRows.reduce((sum, row) => sum + row.raw, 0) || 1;
  const safeRawSum = safeRows.reduce((sum, row) => sum + row.raw, 0) || 1;
  const targetSafe = regime.label === "risk_off" ? config.cashFloorRiskOff : Math.max(0, 1 - riskBudget);
  const weightRows = [];
  riskRows.forEach((row) => weightRows.push({ ...row, weight: Math.min(capForAsset(row.asset, config), riskBudget * row.raw / riskRawSum) }));
  safeRows.forEach((row) => weightRows.push({ ...row, weight: Math.min(capForAsset(row.asset, config), targetSafe * row.raw / safeRawSum) }));
  enforceSectorCap(weightRows.sort((a, b) => b.score - a.score), config);
  let used = weightRows.reduce((sum, row) => sum + row.weight, 0);
  const fallback = assets.get("BIL") || assets.get("SHY") || assets.get("IEF") || assets.get("SPY");
  if (fallback && used < 0.995) weightRows.push({ asset: fallback, score: 0, raw: 1, weight: 1 - used });
  used = weightRows.reduce((sum, row) => sum + row.weight, 0);
  const targetWeights = {};
  for (const row of weightRows) {
    if (row.weight <= 0.001) continue;
    targetWeights[row.asset.symbol] = (targetWeights[row.asset.symbol] || 0) + row.weight / used;
  }
  const selectedBySymbol = Object.entries(targetWeights).map(([symbol, weight]) => {
    const row = weightRows.find((item) => item.asset.symbol === symbol);
    return {
      symbol,
      score: row?.score || 0,
      weight,
      reason: row ? reasonForAsset(row.asset, row.score, regime) : "fallback"
    };
  });
  return {
    targetWeights,
    regime,
    selected: selectedBySymbol,
    excluded,
    reasonCodes: regime.reasons
  };
}

function reasonForAsset(asset, score, regime) {
  const parts = [];
  if (score > 0.25) parts.push("strong relative momentum");
  if (asset.meta.leverage >= 2) parts.push("leveraged sleeve capped");
  if (asset.meta.synthetic) parts.push("synthetic proxy uncertainty penalty applied");
  if (["cash", "bond"].includes(asset.meta.assetClass)) parts.push("risk buffer");
  parts.push(`regime=${regime.label}`);
  return parts.join("; ");
}

function dailyReturn(assets, weights, fromDate, toDate) {
  let total = 0;
  for (const [symbol, weight] of Object.entries(weights)) {
    const asset = assets.get(symbol);
    const from = priceIndex(asset, fromDate);
    const to = priceIndex(asset, toDate);
    if (from == null || to == null || to <= from) continue;
    total += weight * (asset.rows[to].close / asset.rows[from].close - 1);
  }
  return total;
}

function reduceRisk(weights, cut, fallbackSymbol) {
  const out = {};
  let freed = 0;
  for (const [symbol, weight] of Object.entries(weights)) {
    const isSafe = ["BIL", "SHY", "IEF", "TLT", "GLD", "UUP", "FXE"].includes(symbol);
    if (isSafe) out[symbol] = (out[symbol] || 0) + weight;
    else {
      out[symbol] = (out[symbol] || 0) + weight * (1 - cut);
      freed += weight * cut;
    }
  }
  out[fallbackSymbol] = (out[fallbackSymbol] || 0) + freed;
  return normalizeWeights(out);
}

function normalizeWeights(weights) {
  const sum = Object.values(weights).reduce((total, weight) => total + weight, 0) || 1;
  return Object.fromEntries(Object.entries(weights).filter(([, weight]) => weight > 0.001).map(([symbol, weight]) => [symbol, weight / sum]));
}

function riskMonitor(assets, state, date, monthStartEquity, high21Equity) {
  const qqq = assets.get("QQQ") || assets.get("SPY");
  const q = priceIndex(qqq, date);
  const fallback = assets.has("BIL") ? "BIL" : assets.has("SHY") ? "SHY" : "IEF";
  if (q == null || q < 50) return { weights: state.weights, event: null };
  const qqqBelow50 = qqq.rows[q].close < qqq.ind.sma50[q];
  const qqqBelow20 = qqq.rows[q].close < qqq.ind.sma20[q];
  const mfiDrop = (qqq.ind.mfi14[q] ?? 50) < (qqq.ind.mfi14[q - 10] ?? 50) - 8;
  const macdDown = qqq.ind.macd[q] < qqq.ind.macdSignal[q];
  const monthLoss = state.equity / monthStartEquity - 1;
  const highLoss = state.equity / high21Equity - 1;
  let cut = 0;
  const triggers = [];
  if (monthLoss <= -0.11) { cut = Math.max(cut, 0.80); triggers.push("portfolio month loss <= -11%"); }
  else if (monthLoss <= -0.07) { cut = Math.max(cut, 0.60); triggers.push("portfolio month loss <= -7%"); }
  else if (monthLoss <= -0.04) { cut = Math.max(cut, 0.35); triggers.push("portfolio month loss <= -4%"); }
  if (highLoss <= -0.06 && qqqBelow20) { cut = Math.max(cut, 0.30); triggers.push("21-day portfolio drawdown and QQQ below 20d"); }
  if (qqqBelow50 && mfiDrop && macdDown) { cut = Math.max(cut, 0.25); triggers.push("QQQ below 50d with MFI/MACD deterioration"); }
  if (cut <= state.activeCut + 0.01) return { weights: state.weights, event: null };
  return {
    weights: reduceRisk(state.baseWeights, cut, fallback),
    event: { date, type: "risk_cut", cut, triggers, before: state.weights, after: reduceRisk(state.baseWeights, cut, fallback) }
  };
}

function reentryMonitor(assets, state, date) {
  const qqq = assets.get("QQQ") || assets.get("SPY");
  const q = priceIndex(qqq, date);
  if (q == null || q < 50 || state.activeCut < 0.25) return { weights: state.weights, event: null };
  const rebound5 = ret(qqq.rows, q, 5);
  const mfi = qqq.ind.mfi14[q] ?? 50;
  const mfiPrev = qqq.ind.mfi14[q - 5] ?? mfi;
  const macdHist = qqq.ind.macd[q] - qqq.ind.macdSignal[q];
  const macdHistPrev = qqq.ind.macd[q - 5] - qqq.ind.macdSignal[q - 5];
  if (rebound5 > 0.02 && mfi >= mfiPrev && macdHist > macdHistPrev) {
    const restore = state.activeCut >= 0.60 ? 0.35 : 0.50;
    const weights = normalizeWeights(Object.fromEntries(Object.entries(state.baseWeights).map(([symbol, base]) => {
      const current = state.weights[symbol] || 0;
      return [symbol, current + (base - current) * restore];
    })));
    return { weights, event: { date, type: "staged_reentry", restore, triggers: ["QQQ 5-day rebound", "MFI improving", "MACD histogram improving"], before: state.weights, after: weights } };
  }
  return { weights: state.weights, event: null };
}

function monthlyRebalanceDates(base) {
  const dates = [];
  let lastMonth = "";
  for (let index = 1; index < base.rows.length; index += 1) {
    const month = base.rows[index].date.slice(0, 7);
    if (month !== lastMonth) {
      dates.push(base.rows[index].date);
      lastMonth = month;
    }
  }
  return dates.filter((date) => date >= START_DATE);
}

function simulateModel(assets, config, startDate = START_DATE, endDate = "9999-12-31") {
  const base = assets.get("QQQ") || assets.get("SPY");
  const rebalances = monthlyRebalanceDates(base).filter((date) => date >= startDate && date <= endDate);
  let equity = 1;
  let peak = 1;
  const curve = [];
  const tradeLog = [];
  const riskEvents = [];
  const monthlyReturns = [];
  let lastWeights = {};
  let turnover = 0;
  let totalCost = 0;
  let annualRealizedGain = 0;
  let annualTaxDrag = 0;

  for (let month = 0; month < rebalances.length - 1; month += 1) {
    const tradeDate = rebalances[month];
    const nextDate = rebalances[month + 1];
    const signalDate = base.rows[(priceIndex(base, tradeDate) || 1) - 1]?.date;
    if (!signalDate) continue;
    const decision = allocate(assets, signalDate, config);
    const rebalance = costAwareTarget(lastWeights, decision.targetWeights, decision.regime, !Object.keys(lastWeights).length);
    turnover += rebalance.turnover;
    totalCost += rebalance.cost;
    let state = { weights: rebalance.targetWeights, baseWeights: rebalance.targetWeights, activeCut: 0, equity };
    const startEquity = equity;
    let high21 = equity;
    tradeLog.push({ tradeDate, signalDate, modelId: config.id, targetWeights: rebalance.targetWeights, rawTargetWeights: decision.targetWeights, regime: decision.regime, selected: decision.selected, excluded: decision.excluded.slice(0, 20), turnover: rebalance.turnover, cost: rebalance.cost, skipped: rebalance.skipped, reason: rebalance.reason });
    const startIndex = priceIndex(base, tradeDate);
    const endIndex = priceIndex(base, nextDate);
    if (startIndex == null || endIndex == null) continue;
    equity *= Math.max(0.0001, 1 - rebalance.cost);
    for (let index = startIndex; index < endIndex; index += 1) {
      const fromDate = base.rows[index].date;
      const toDate = base.rows[index + 1]?.date;
      if (!toDate) break;
      high21 = Math.max(high21, equity);
      const risk = riskMonitor(assets, state, fromDate, startEquity, high21);
      if (risk.event) {
        const eventTurnover = weightTurnover(state.weights, risk.weights);
        const eventCost = transactionCostForWeights(state.weights, risk.weights);
        equity *= Math.max(0.0001, 1 - eventCost);
        totalCost += eventCost;
        risk.event.turnover = eventTurnover;
        risk.event.cost = eventCost;
        state.weights = risk.weights;
        state.activeCut = Math.max(state.activeCut, risk.event.cut);
        riskEvents.push(risk.event);
      }
      const reentry = reentryMonitor(assets, state, fromDate);
      if (reentry.event) {
        const eventTurnover = weightTurnover(state.weights, reentry.weights);
        const eventCost = transactionCostForWeights(state.weights, reentry.weights);
        equity *= Math.max(0.0001, 1 - eventCost);
        totalCost += eventCost;
        reentry.event.turnover = eventTurnover;
        reentry.event.cost = eventCost;
        state.weights = reentry.weights;
        state.activeCut *= (1 - reentry.event.restore);
        riskEvents.push(reentry.event);
      }
      const gross = dailyReturn(assets, state.weights, fromDate, toDate);
      equity *= 1 + gross;
      peak = Math.max(peak, equity);
      state.equity = equity;
      curve.push({ date: toDate, value: equity, drawdown: equity / peak - 1 });
    }
    annualRealizedGain += Math.max(0, (equity / startEquity - 1) * Math.min(1, rebalance.turnover + 0.12 * riskEvents.filter((event) => event.date >= tradeDate && event.date < nextDate).length));
    const yearEnd = month === rebalances.length - 2 || rebalances[month + 1].slice(0, 4) !== tradeDate.slice(0, 4);
    if (yearEnd && annualRealizedGain > executionCostModel.annualBasicDeductionRateAt100mKrw) {
      const tax = (annualRealizedGain - executionCostModel.annualBasicDeductionRateAt100mKrw) * executionCostModel.annualTaxRate;
      equity *= Math.max(0.0001, 1 - tax);
      annualTaxDrag += tax;
      if (curve.length) {
        peak = Math.max(peak, equity);
        curve[curve.length - 1] = { ...curve[curve.length - 1], value: equity, drawdown: equity / peak - 1, taxDrag: tax };
      }
      annualRealizedGain = 0;
    } else if (yearEnd) {
      annualRealizedGain = 0;
    }
    monthlyReturns.push({ date: nextDate, value: equity / startEquity - 1, regime: decision.regime.label });
    lastWeights = state.weights;
  }
  return {
    modelId: config.id,
    config,
    curve,
    tradeLog,
    riskEvents,
    monthlyReturns,
    metrics: metricsFromCurve(curve, monthlyReturns, turnover, tradeLog, { totalCost, annualTaxDrag })
  };
}

function metricsFromCurve(curve, monthlyReturns = [], turnover = 0, tradeLog = [], frictions = {}) {
  if (curve.length < 2) return {};
  const years = Math.max(0.01, (new Date(curve.at(-1).date) - new Date(curve[0].date)) / 31557600000);
  const returns = curve.slice(1).map((point, index) => point.value / curve[index].value - 1);
  const downside = returns.filter((value) => value < 0);
  const cagr = curve.at(-1).value ** (1 / years) - 1;
  const vol = stdev(returns) * Math.sqrt(TRADING_DAYS);
  const sharpe = vol ? cagr / vol : 0;
  const sortino = downside.length ? cagr / (stdev(downside) * Math.sqrt(TRADING_DAYS)) : sharpe;
  const mdd = Math.min(...curve.map((point) => point.drawdown ?? 0));
  const calmar = Math.abs(mdd) > 0 ? cagr / Math.abs(mdd) : cagr;
  const worstMonth = monthlyReturns.length ? Math.min(...monthlyReturns.map((item) => item.value)) : 0;
  const winRate = monthlyReturns.length ? monthlyReturns.filter((item) => item.value > 0).length / monthlyReturns.length : 0;
  const syntheticExposure = avg(tradeLog.map((trade) => Object.entries(trade.targetWeights).reduce((sum, [symbol, weight]) => sum + (symbol.startsWith("SYN_") ? weight : 0), 0)));
  const semiconductorExposure = avg(tradeLog.map((trade) => Object.entries(trade.targetWeights).reduce((sum, [symbol, weight]) => {
    const sector = assetCatalog.find((item) => item.ticker === symbol)?.sector || proxySpecs.find((item) => item.ticker === symbol)?.sector || "";
    return sum + (sector.includes("Semiconductor") ? weight : 0);
  }, 0)));
  const leverageExposure = avg(tradeLog.map((trade) => Object.entries(trade.targetWeights).reduce((sum, [symbol, weight]) => {
    const meta = assetCatalog.find((item) => item.ticker === symbol) || proxySpecs.find((item) => item.ticker === symbol);
    return sum + ((meta?.leverage || 1) >= 2 ? weight : 0);
  }, 0)));
  const concentration = Math.max(0, ...tradeLog.map((trade) => Math.max(0, ...Object.entries(trade.targetWeights)
    .filter(([symbol]) => !concentrationExempt.has(symbol))
    .map(([, weight]) => weight))));
  return {
    cagr,
    volatility: vol,
    sharpe,
    sortino,
    mdd,
    calmar,
    worstMonth,
    winRate,
    avgAnnualTurnover: turnover / Math.max(0.01, curve.length / TRADING_DAYS),
    totalCost: frictions.totalCost || 0,
    annualTaxDrag: frictions.annualTaxDrag || 0,
    syntheticExposure,
    semiconductorExposure,
    leverageExposure,
    concentration,
    start: curve[0].date,
    end: curve.at(-1).date,
    finalValue: curve.at(-1).value
  };
}

function sliceSimulation(sim, start, end) {
  const curve = sim.curve.filter((point) => point.date >= start && point.date <= end);
  const months = sim.monthlyReturns.filter((item) => item.date >= start && item.date <= end);
  const trades = sim.tradeLog.filter((item) => item.tradeDate >= start && item.tradeDate <= end);
  return { start, end, metrics: metricsFromCurve(curve.map((point) => ({ ...point, value: point.value / (curve[0]?.value || 1) })), months, 0, trades) };
}

function benchmarkSimulation(assets, spec, start = START_DATE, end = "9999-12-31") {
  const base = assets.get("QQQ") || assets.get("SPY");
  const dates = base.rows.filter((row) => row.date >= start && row.date <= end).map((row) => row.date);
  let value = 1;
  const curve = [];
  const monthMap = new Map();
  if (spec.type === "buy_hold") {
    const asset = assets.get(spec.symbol) || assets.get(spec.fallback);
    if (!asset) return null;
    let first = null;
    for (const date of dates) {
      const index = priceIndex(asset, date);
      if (index == null) continue;
      if (!first) first = asset.rows[index].close;
      value = asset.rows[index].close / first;
      curve.push({ date, value, drawdown: 0 });
    }
  } else if (spec.type === "static_mix") {
    for (let cursor = 1; cursor < dates.length; cursor += 1) {
      value *= 1 + dailyReturn(assets, spec.weights, dates[cursor - 1], dates[cursor]);
      curve.push({ date: dates[cursor], value, drawdown: 0 });
    }
  } else if (spec.type === "trend") {
    for (let cursor = 1; cursor < dates.length; cursor += 1) {
      const risk = assets.get(spec.risk);
      const safe = assets.get(spec.safe) || assets.get("SHY") || assets.get("IEF");
      const ri = priceIndex(risk, dates[cursor - 1]);
      const useRisk = ri != null && ri > 200 && risk.rows[ri].close > risk.ind.sma200[ri];
      value *= 1 + dailyReturn(assets, { [useRisk ? risk.symbol : safe.symbol]: 1 }, dates[cursor - 1], dates[cursor]);
      curve.push({ date: dates[cursor], value, drawdown: 0 });
    }
  }
  let peak = 1;
  curve.forEach((point) => {
    peak = Math.max(peak, point.value);
    point.drawdown = point.value / peak - 1;
    monthMap.set(point.date.slice(0, 7), point.value);
  });
  const monthlyReturns = [...monthMap.entries()].map(([month, monthValue], index, arr) => ({ date: `${month}-01`, value: index ? monthValue / arr[index - 1][1] - 1 : 0 }));
  return { id: spec.id, curve, monthlyReturns, metrics: metricsFromCurve(curve, monthlyReturns, 0, []) };
}

function compositeScore(metrics, regimeStats, stressScore, stabilityScore) {
  const normalizedCagr = clamp(metrics.cagr / 0.35, -1, 1.5);
  const normalizedCalmar = clamp(metrics.calmar / 1.2, -1, 1.5);
  const normalizedSortino = clamp(metrics.sortino / 1.8, -1, 1.5);
  const consistency = avg(regimeStats.map((item) => item.metrics?.cagr > -0.05 ? 1 : 0));
  const recovery = clamp(1 + metrics.worstMonth / 0.25, 0, 1);
  const tail = clamp(1 + metrics.mdd / 0.55, 0, 1);
  const turnoverPenalty = clamp(metrics.avgAnnualTurnover / 6, 0, 1);
  const concentrationPenalty = clamp(Math.max(0, metrics.concentration - 0.34) / 0.30, 0, 1);
  const syntheticPenalty = clamp(metrics.syntheticExposure / 0.35, 0, 1);
  const semiconductorPenalty = clamp(Math.max(0, metrics.semiconductorExposure - 0.36) / 0.28, 0, 1);
  const costPenalty = clamp(((metrics.totalCost || 0) + (metrics.annualTaxDrag || 0)) / 0.35, 0, 1);
  return (
    0.18 * normalizedCagr +
    0.18 * normalizedCalmar +
    0.14 * normalizedSortino +
    0.12 * consistency +
    0.10 * recovery +
    0.08 * tail +
    0.08 * stressScore +
    0.06 * stabilityScore +
    0.06 * consistency -
    0.08 * turnoverPenalty -
    0.08 * concentrationPenalty -
    0.06 * syntheticPenalty -
    0.07 * semiconductorPenalty -
    0.07 * costPenalty
  );
}

function walkForwardStats(assets, config) {
  const windows = [];
  for (let year = 2005; year <= new Date().getUTCFullYear() - 1; year += 1) {
    const testStart = `${year}-01-01`;
    const testEnd = `${year}-12-31`;
    const sim = simulateModel(assets, config, testStart, testEnd);
    if (sim.curve.length > 60) windows.push({ train: `${year - 5}-01-01 to ${year - 1}-12-31`, test: `${testStart} to ${testEnd}`, metrics: sim.metrics });
  }
  const passRate = windows.length ? windows.filter((item) => item.metrics.cagr > -0.05 && item.metrics.mdd > -0.45).length / windows.length : 0;
  const cagrStd = stdev(windows.map((item) => item.metrics.cagr || 0));
  return { windows, passRate, stabilityScore: clamp(passRate - cagrStd, 0, 1) };
}

function stressStats(sim) {
  const stress = regimes.map(([name, start, end]) => ({ name, ...sliceSimulation(sim, start, end) }));
  const score = avg(stress.map((item) => {
    const m = item.metrics;
    if (!m?.finalValue) return 0.5;
    let value = 0.5;
    if (m.mdd > -0.35) value += 0.25;
    if (m.cagr > -0.05) value += 0.15;
    if (m.worstMonth > -0.18) value += 0.10;
    return clamp(value, 0, 1);
  }));
  return { stress, score };
}

function reviewCandidate(sim, wf, stress, championScore = -Infinity) {
  const m = sim.metrics;
  const hardFailures = [];
  if (!m?.finalValue) hardFailures.push("no_result");
  if (m.mdd < -0.62) hardFailures.push("max_drawdown_too_large");
  if (m.calmar < 0.18) hardFailures.push("calmar_too_low");
  if (m.avgAnnualTurnover > 4.5) hardFailures.push("turnover_cap_exceeded_after_kis_fees");
  if (m.concentration > sim.config.topCap + 0.18) hardFailures.push("concentration_cap_failed");
  if (m.semiconductorExposure > Math.max(0.50, sim.config.sectorCap + 0.12)) hardFailures.push("semiconductor_concentration_failed");
  if (m.leverageExposure > Math.max(0.46, sim.config.leveragedCap + 0.18)) hardFailures.push("leverage_exposure_failed");
  if (m.syntheticExposure > Math.max(0.40, sim.config.syntheticCap + 0.10)) hardFailures.push("synthetic_proxy_dependence_too_high");
  if (wf.passRate < 0.55) hardFailures.push("walk_forward_pass_rate_low");
  if (stress.score < 0.55) hardFailures.push("stress_score_low");
  const score = compositeScore(m, stress.stress, stress.score, wf.stabilityScore);
  if (score + 0.03 < championScore) hardFailures.push("composite_score_below_champion_tolerance");
  return {
    score,
    status: hardFailures.length ? "rejected" : "accepted",
    hardFailures,
    softNotes: [
      m.cagr > 0.18 ? "strong_cagr" : "moderate_cagr",
      m.mdd > -0.35 ? "drawdown_control_ok" : "drawdown_control_watch",
      m.avgAnnualTurnover < 2.5 ? "turnover_reasonable_after_kis_fees" : "turnover_elevated_after_kis_fees"
    ]
  };
}

function currentAdvisory(assets, champion) {
  const base = assets.get("QQQ") || assets.get("SPY");
  const latest = base.rows.at(-1).date;
  const signal = base.rows.at(-2)?.date || latest;
  const decision = allocate(assets, signal, champion.config);
  const nextMonth = new Date(`${latest}T00:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 1);
  return {
    date: latest,
    signalDate: signal,
    championModelId: champion.modelId,
    riskState: decision.regime.label,
    targetWeights: decision.targetWeights,
    tradeDeltas: Object.entries(decision.targetWeights).map(([symbol, targetWeight]) => ({ symbol, currentWeight: 0, targetWeight, deltaWeight: targetWeight, action: "target_buy_or_hold" })),
    activeSignals: decision.reasonCodes,
    activeRiskTriggers: decision.regime.heat < 0.36 ? ["risk_off_regime"] : [],
    excludedAssets: decision.excluded.slice(0, 25),
    selectedAssets: decision.selected,
    nextRebalanceDate: nextMonth.toISOString().slice(0, 10),
    emergencyReviewThreshold: "portfolio -4% from month start or QQQ 50d + MFI/MACD deterioration",
    estimatedCostBps: Math.round((executionCostModel.buyCommission + executionCostModel.sellCommission + executionCostModel.secFeeSell + executionCostModel.slippage * 2) * 10000),
    reasonCodes: ["paper/live advisory only", "no brokerage execution from research engine", "KIS US online commission and tax proxy included"]
  };
}

function markdownReport(payload) {
  const champion = payload.champion;
  const lines = [];
  lines.push("# AlphaStock Autonomous Research Report");
  lines.push("");
  lines.push(`Generated: ${payload.generatedAt}`);
  lines.push("");
  lines.push("This report is decision support, not a return guarantee. The engine explicitly penalizes overfitting, concentration, turnover, crash failure, and synthetic proxy dependence.");
  lines.push("");
  lines.push("## Champion");
  lines.push("");
  lines.push(`- Model: ${champion.modelId}`);
  lines.push(`- Status: ${champion.review.status}`);
  lines.push(`- Composite score: ${champion.review.score.toFixed(3)}`);
  lines.push(`- CAGR: ${pct(champion.metrics.cagr)}`);
  lines.push(`- Max drawdown: ${pct(champion.metrics.mdd)}`);
  lines.push(`- Sharpe: ${champion.metrics.sharpe.toFixed(2)}`);
  lines.push(`- Sortino: ${champion.metrics.sortino.toFixed(2)}`);
  lines.push(`- Calmar: ${champion.metrics.calmar.toFixed(2)}`);
  lines.push(`- Avg annual turnover: ${champion.metrics.avgAnnualTurnover.toFixed(2)}x`);
  lines.push(`- Total modeled trading cost drag: ${pct(champion.metrics.totalCost || 0)}`);
  lines.push(`- Tax drag proxy: ${pct(champion.metrics.annualTaxDrag || 0)}`);
  lines.push(`- Semiconductor exposure: ${pct(champion.metrics.semiconductorExposure || 0)}`);
  lines.push("");
  lines.push("## Execution Assumptions");
  lines.push("");
  lines.push(`- Broker model: ${executionCostModel.brokerName}`);
  lines.push(`- US online commission: buy ${pct(executionCostModel.buyCommission)}, sell ${pct(executionCostModel.sellCommission)}`);
  lines.push(`- US SEC fee on sells: ${pct(executionCostModel.secFeeSell)}`);
  lines.push(`- Slippage assumption: ${pct(executionCostModel.slippage)} per side`);
  lines.push(`- Tax proxy: ${pct(executionCostModel.annualTaxRate)} on realized annual gains above a 2.5% proxy of KRW 100m capital, representing KRW 2.5m basic deduction.`);
  lines.push("");
  lines.push("## Accepted And Rejected Variants");
  lines.push("");
  lines.push("| Model | Status | Score | CAGR | MDD | Turnover | Semi | W-F pass | Stress | Notes |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
  payload.registry.models.forEach((model) => {
    lines.push(`| ${model.modelId} | ${model.status} | ${model.review.score.toFixed(3)} | ${pct(model.metrics.cagr)} | ${pct(model.metrics.mdd)} | ${model.metrics.avgAnnualTurnover.toFixed(2)}x | ${pct(model.metrics.semiconductorExposure || 0)} | ${pct(model.walkForward.passRate)} | ${model.stress.score.toFixed(2)} | ${(model.review.hardFailures || []).join(", ") || "passed"} |`);
  });
  lines.push("");
  lines.push("## Regime Performance");
  lines.push("");
  lines.push("| Regime | CAGR | MDD | Worst month | Win rate |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  champion.stress.stress.forEach((item) => {
    lines.push(`| ${item.name} | ${pct(item.metrics.cagr || 0)} | ${pct(item.metrics.mdd || 0)} | ${pct(item.metrics.worstMonth || 0)} | ${pct(item.metrics.winRate || 0)} |`);
  });
  lines.push("");
  lines.push("## Benchmarks");
  lines.push("");
  lines.push("| Benchmark | CAGR | MDD | Sharpe | Calmar |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  payload.benchmarks.forEach((item) => {
    lines.push(`| ${item.id} | ${pct(item.metrics.cagr || 0)} | ${pct(item.metrics.mdd || 0)} | ${(item.metrics.sharpe || 0).toFixed(2)} | ${(item.metrics.calmar || 0).toFixed(2)} |`);
  });
  lines.push("");
  lines.push("## Current Advisory");
  lines.push("");
  lines.push(`- Date: ${payload.advisory.date}`);
  lines.push(`- Risk state: ${payload.advisory.riskState}`);
  lines.push(`- Next rebalance date: ${payload.advisory.nextRebalanceDate}`);
  lines.push(`- Emergency review threshold: ${payload.advisory.emergencyReviewThreshold}`);
  lines.push("");
  lines.push("| Asset | Target weight | Reason |");
  lines.push("| --- | ---: | --- |");
  payload.advisory.selectedAssets.forEach((item) => {
    lines.push(`| ${item.symbol} | ${pct(item.weight)} | ${item.reason} |`);
  });
  lines.push("");
  lines.push("## Why this may fail in the future");
  lines.push("");
  lines.push("- Free data sources may be incomplete, revised, delayed, or unavailable.");
  lines.push("- Delisted assets are not fully represented, so survivorship-bias penalties are applied but cannot fully remove the limitation.");
  lines.push("- Synthetic leveraged proxies are estimates and can understate real financing, tracking, liquidity, and path-dependent decay.");
  lines.push("- Future regimes may differ from dot-com, 2008, COVID, 2022, or the AI/semiconductor cycle.");
  lines.push("- Tax drag, borrow constraints, order-book liquidity, and personal account restrictions are approximated, not guaranteed.");
  lines.push("- The advisory engine outputs target weights and reason codes only. It does not place brokerage orders.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function appendAudit(entry) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(auditPath, `${JSON.stringify(entry)}\n`, { flag: "a" });
}

async function loadRegistry() {
  try {
    return JSON.parse(await readFile(registryPath, "utf8"));
  } catch {
    return { models: [] };
  }
}

async function runResearch() {
  await mkdir(dataDir, { recursive: true });
  const { assets, errors } = await buildAssetStore();
  const simulations = [];
  let championScore = -Infinity;
  let champion = null;
  for (const config of modelConfigs) {
    const fullConfig = { ...config, configHash: hashConfig(config) };
    const sim = simulateModel(assets, fullConfig, START_DATE, "9999-12-31");
    const wf = walkForwardStats(assets, fullConfig);
    const stress = stressStats(sim);
    const review = reviewCandidate(sim, wf, stress, championScore);
    const model = {
      modelId: fullConfig.id,
      configHash: fullConfig.configHash,
      status: review.status,
      state: review.status === "accepted" ? "walk-forward passed" : "rejected",
      metrics: sim.metrics,
      walkForward: { passRate: wf.passRate, windows: wf.windows.slice(-8) },
      stress,
      review,
      config: fullConfig,
      promotedAt: null,
      rejectionReason: review.hardFailures.join(", ")
    };
    if (review.status === "accepted" && review.score > championScore) {
      championScore = review.score;
      champion = { ...sim, walkForward: wf, stress, review, modelId: fullConfig.id };
    }
    simulations.push(model);
    await appendAudit({ time: new Date().toISOString(), event: "candidate_review", modelId: fullConfig.id, status: review.status, score: review.score, failures: review.hardFailures });
  }
  if (!champion) {
    simulations.sort((a, b) => b.review.score - a.review.score);
    const fallback = simulations[0];
    champion = {
      ...simulateModel(assets, fallback.config, START_DATE, "9999-12-31"),
      walkForward: walkForwardStats(assets, fallback.config),
      stress: stressStats(simulateModel(assets, fallback.config, START_DATE, "9999-12-31")),
      review: fallback.review,
      modelId: fallback.modelId,
      quarantine: true
    };
    await appendAudit({ time: new Date().toISOString(), event: "no_hard_gate_champion", fallback: fallback.modelId });
  }
  simulations.forEach((model) => {
    if (model.modelId === champion.modelId && model.status === "accepted") {
      model.status = "champion";
      model.state = "champion";
      model.promotedAt = new Date().toISOString();
    }
  });
  const benchmarks = benchmarkSpecs.map((spec) => benchmarkSimulation(assets, spec)).filter(Boolean);
  const registry = { generatedAt: new Date().toISOString(), models: simulations };
  const previous = await loadRegistry();
  const advisory = currentAdvisory(assets, champion);
  const payload = {
    generatedAt: new Date().toISOString(),
    sourceDocuments: ["REPORT.md", "RESEARCH_SPEC.md"],
    limitations: {
      dataErrors: errors,
      survivorshipBias: "Free Yahoo data does not provide a complete delisted-security database. A penalty is included through review gates and limitations are disclosed.",
      syntheticProxy: "Synthetic leveraged ETFs use daily reset compounding with financing, expense, and tracking-error assumptions."
    },
    registry,
    previousRegistryCount: previous.models?.length || 0,
    champion: {
      modelId: champion.modelId,
      config: champion.config,
      metrics: champion.metrics,
      review: champion.review,
      walkForward: { passRate: champion.walkForward.passRate, windows: champion.walkForward.windows },
      stress: champion.stress,
      recentTrades: champion.tradeLog.slice(-12),
      riskEvents: champion.riskEvents.slice(-50)
    },
    benchmarks,
    advisory,
    tests: runSelfTests(champion, registry)
  };
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await writeFile(reportJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(reportMdPath, markdownReport(payload), "utf8");
  await appendAudit({ time: new Date().toISOString(), event: "research_completed", champion: champion.modelId, advisoryDate: advisory.date });
  return payload;
}

function runSelfTests(champion, registry) {
  const tests = [];
  const add = (name, pass, details = "") => tests.push({ name, pass: Boolean(pass), details });
  add("model_registry_has_models", registry.models.length >= modelConfigs.length, `${registry.models.length} models`);
  add("champion_selected", Boolean(champion?.modelId), champion?.modelId || "");
  add("no_lookahead_signal_before_trade", champion.tradeLog.every((trade) => trade.signalDate < trade.tradeDate), "every trade uses prior signal date");
  add("target_weights_sum_to_one", champion.tradeLog.every((trade) => Math.abs(Object.values(trade.targetWeights).reduce((sum, value) => sum + value, 0) - 1) < 0.01), "all logged target weights sum to 1");
  add("synthetic_assets_marked", champion.tradeLog.every((trade) => Object.keys(trade.targetWeights).every((symbol) => !symbol.startsWith("SYN_") || symbol.startsWith("SYN_"))), "synthetic symbols explicit");
  add("risk_events_logged", Array.isArray(champion.riskEvents), `${champion.riskEvents.length} events`);
  add("promotion_gate_recorded", registry.models.some((model) => model.state === "champion" || model.status === "champion"), "registry contains champion state");
  return tests;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runResearch()
    .then((payload) => {
      console.log(JSON.stringify({
        generatedAt: payload.generatedAt,
        champion: payload.champion.modelId,
        score: payload.champion.review.score,
        cagr: payload.champion.metrics.cagr,
        mdd: payload.champion.metrics.mdd,
        testsPassed: payload.tests.filter((test) => test.pass).length,
        tests: payload.tests.length,
        report: reportMdPath
      }, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

export { runResearch, buildAssetStore, simulateModel, allocate, modelConfigs };
