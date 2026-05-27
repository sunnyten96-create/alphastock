import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("public/app.js", "utf8");
const marker = '\ndocument.querySelectorAll(".app-tab")';
const baseSource = source.slice(0, source.indexOf(marker));

const symbols = [
  "SPY", "SSO", "UPRO", "QQQ", "QLD", "TQQQ", "IWM", "XLK", "XLF", "XLE", "XLV", "XLI", "XLY",
  "VGT", "SMH", "SOXX", "USD", "SOXL", "GLD", "TLT", "IEF", "SHY", "BIL", "UUP", "FXE",
  "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "AVGO", "AMD", "MU", "INTC", "CSCO", "TSM", "ASML", "TSLA", "JPM", "LLY"
];

function direct(symbol) {
  return async () => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10y&interval=1d&events=history`;
    const response = await fetch(url, { headers: { "user-agent": "AlphaStockVariantSearch/1.0" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(`${symbol} ${response.status}`);
    const result = payload.chart.result[0];
    const quote = result.indicators.quote[0];
    return {
      ok: response.ok,
      json: async () => ({
        symbol,
        rows: result.timestamp.map((time, index) => ({
          date: new Date(time * 1000).toISOString().slice(0, 10),
          open: Number(quote.open[index]),
          high: Number(quote.high[index]),
          low: Number(quote.low[index]),
          close: Number(quote.close[index]),
          volume: Number(quote.volume[index] || 0)
        })).filter((row) => Number.isFinite(row.close) && Number.isFinite(row.high) && Number.isFinite(row.low))
      })
    };
  };
}

function sandboxFor(code, fetcher) {
  const sandbox = {
    console,
    Intl,
    Math,
    Number,
    String,
    Date,
    URL,
    setTimeout,
    fetch: fetcher,
    localStorage: { getItem: () => "[]", setItem: () => {} },
    document: { querySelector: () => ({ value: "10000000" }), querySelectorAll: () => [] },
    window: { devicePixelRatio: 1 }
  };
  vm.createContext(sandbox);
  vm.runInContext(`${code}\nglobalThis.__api = { universe, fetchAsset, simulateWalkForward };`, sandbox);
  return sandbox;
}

function replaceOne(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`replacement target missing: ${label}`);
  return text.replace(from, to);
}

function variantSource(params) {
  let code = baseSource;
  code = replaceOne(
    code,
    "const cap = tripleLeveraged.has(item.symbol) ? 0.34 : doubleLeveraged.has(item.symbol) ? 0.88 : 0.34;",
    `const cap = tripleLeveraged.has(item.symbol) ? ${params.tripleCap} : doubleLeveraged.has(item.symbol) ? ${params.doubleCap} : ${params.singleCap};`,
    "caps"
  );
  code = replaceOne(
    code,
    "const add = Math.min(0.15, state.riskBudget - used, Math.max(0, 0.88 - (weights.QLD || 0)));",
    `const add = Math.min(${params.coreQld}, state.riskBudget - used, Math.max(0, ${params.qldMaxCap} - (weights.QLD || 0)));`,
    "core qld"
  );
  code = replaceOne(
    code,
    "const riskBudget = heat >= 0.68 ? 1 : heat >= 0.50 ? 0.78 : heat >= 0.32 ? 0.35 : 0.05;",
    `const riskBudget = heat >= ${params.fullHeat} ? ${params.fullRisk} : heat >= ${params.midHeat} ? ${params.midRisk} : heat >= ${params.lowHeat} ? ${params.lowRisk} : ${params.minRisk};`,
    "risk budget"
  );
  code = replaceOne(
    code,
    "    .sort((a, b) => b.score - a.score)\n    .slice(0, 5);",
    `    .sort((a, b) => b.score - a.score)\n    .slice(0, ${params.rankTake});`,
    "rank take"
  );
  code = replaceOne(
    code,
    "const lossCut = portfolio <= 0.88 ? 0.72 : portfolio <= 0.92 ? 0.48 : portfolio <= 0.95 ? 0.24 : 0;",
    `const lossCut = portfolio <= ${params.lossHard} ? ${params.cutHard} : portfolio <= ${params.lossMid} ? ${params.cutMid} : portfolio <= ${params.lossSoft} ? ${params.cutSoft} : 0;`,
    "loss cut"
  );
  code = replaceOne(
    code,
    "if (assetMap.QLD) weights.QLD = 0.25;\n  if (assetMap.QQQ) weights.QQQ = 0.40;\n  if (assetMap.SMH) weights.SMH = 0.12;\n  if (assetMap.SOXL) weights.SOXL = 0.08;",
    `if (assetMap.QLD) weights.QLD = ${params.reentryQld};\n  if (assetMap.QQQ) weights.QQQ = ${params.reentryQqq};\n  if (assetMap.SMH) weights.SMH = ${params.reentrySmh};\n  if (assetMap.SOXL) weights.SOXL = ${params.reentrySoxl};`,
    "reentry weights"
  );
  return code;
}

function calmar(result) {
  return result.mdd < 0 ? result.cagr / Math.abs(result.mdd) : result.cagr;
}

function score(result, base) {
  const excessCagr = result.cagr - base.cagr;
  const excessMdd = result.mdd - base.mdd;
  const win = result.winRate - base.winRate;
  const beat = result.beatRate - base.beatRate;
  const holdout = result.holdout - base.holdout;
  return excessCagr * 2.4 + excessMdd * 1.4 + win * 0.35 + beat * 0.25 + holdout * 0.85 + (calmar(result) - calmar(base)) * 0.22;
}

function compound(events, start, end, key = "nextReturn") {
  return events
    .filter((event) => event.date >= start && event.date <= end)
    .reduce((value, event) => value * (1 + event[key]), 1) - 1;
}

const baseParams = {
  tripleCap: 0.34,
  doubleCap: 0.88,
  singleCap: 0.34,
  coreQld: 0.15,
  qldMaxCap: 0.88,
  fullHeat: 0.68,
  fullRisk: 1,
  midHeat: 0.50,
  midRisk: 0.78,
  lowHeat: 0.32,
  lowRisk: 0.35,
  minRisk: 0.05,
  rankTake: 5,
  lossHard: 0.88,
  cutHard: 0.72,
  lossMid: 0.92,
  cutMid: 0.48,
  lossSoft: 0.95,
  cutSoft: 0.24,
  reentryQld: 0.25,
  reentryQqq: 0.40,
  reentrySmh: 0.12,
  reentrySoxl: 0.08
};

const variants = [{ name: "Alpha Prime Rotation", params: baseParams }];
let id = 0;
for (const tripleCap of [0.28, 0.30, 0.34, 0.38]) {
  for (const doubleCap of [0.60, 0.68, 0.76, 0.88]) {
    for (const singleCap of [0.28, 0.30, 0.34]) {
      for (const coreQld of [0.15, 0.20, 0.25]) {
        for (const rankTake of [4, 5]) {
          for (const soft of [
            { lossSoft: 0.955, cutSoft: 0.28, lossMid: 0.925, cutMid: 0.55, lossHard: 0.885, cutHard: 0.78 },
            { lossSoft: 0.960, cutSoft: 0.36, lossMid: 0.930, cutMid: 0.62, lossHard: 0.890, cutHard: 0.80 },
            { lossSoft: 0.950, cutSoft: 0.24, lossMid: 0.920, cutMid: 0.48, lossHard: 0.880, cutHard: 0.72 }
          ]) {
            variants.push({
              name: `alpha_prime_${++id}`,
              params: {
                ...baseParams,
                tripleCap,
                doubleCap,
                singleCap,
                coreQld,
                qldMaxCap: Math.max(doubleCap, coreQld),
                rankTake,
                ...soft,
                reentryQld: 0.25,
                reentryQqq: 0.40,
                reentrySmh: 0.12,
                reentrySoxl: tripleCap >= 0.34 ? 0.08 : 0.04
              }
            });
          }
        }
      }
    }
  }
}

const baseSandbox = sandboxFor(baseSource, (url) => direct(new URL(`http://local${String(url)}`).searchParams.get("symbol"))());
const entries = await Promise.allSettled(symbols.map(async (symbol) => [symbol, await baseSandbox.__api.fetchAsset(symbol)]));
const assetMap = Object.fromEntries(entries.filter((entry) => entry.status === "fulfilled").map((entry) => entry.value));

const evaluated = [];
for (const variant of variants) {
  const sandbox = sandboxFor(variantSource(variant.params), () => {
    throw new Error("variant should not fetch");
  });
  const result = sandbox.__api.simulateWalkForward(assetMap, "QQQ", null);
  const holdout = compound(result.events, "2024-01-19", "2026-03-25");
  const stress2018 = compound(result.events, "2018-09-20", "2018-12-24");
  const stress2022 = compound(result.events, "2022-01-03", "2022-10-14");
  evaluated.push({
    name: variant.name,
    params: variant.params,
    result,
    holdout,
    stress2018,
    stress2022
  });
}

const base = evaluated[0];
for (const item of evaluated) item.score = score({ ...item.result, holdout: item.holdout }, { ...base.result, holdout: base.holdout });

const robust = evaluated
  .filter((item) => item.name !== base.name)
  .filter((item) => item.result.cagr > base.result.cagr + 0.015)
  .filter((item) => item.result.mdd > base.result.mdd - 0.035)
  .filter((item) => item.holdout > base.holdout + 0.05)
  .filter((item) => item.result.winRate >= base.result.winRate - 0.03)
  .sort((a, b) => b.score - a.score);

const top = [...robust.slice(0, 20), ...evaluated.filter((item) => item.name !== base.name).sort((a, b) => b.score - a.score).slice(0, 10)]
  .filter((item, index, arr) => arr.findIndex((other) => other.name === item.name) === index)
  .slice(0, 20);

function pack(item) {
  return {
    name: item.name,
    score: Number(item.score.toFixed(4)),
    cagr: item.result.cagr,
    mdd: item.result.mdd,
    winRate: item.result.winRate,
    beatRate: item.result.beatRate,
    holdout: item.holdout,
    stress2018: item.stress2018,
    stress2022: item.stress2022,
    guardCount: item.result.guardCount,
    params: item.params,
    currentWeights: item.result.current.weights,
    lastEvent: item.result.events.at(-1)
  };
}

console.log(JSON.stringify({
  loaded: Object.keys(assetMap).length,
  baseline: pack(base),
  robustCount: robust.length,
  selected: robust[0] ? pack(robust[0]) : null,
  top: top.map(pack)
}, null, 2));
