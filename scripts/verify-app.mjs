import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("public/app.js", "utf8");
const research = JSON.parse(fs.readFileSync("data/research-report.json", "utf8"));
const marker = '\ndocument.querySelectorAll(".app-tab")';
const code = `${source.slice(0, source.indexOf(marker))}
globalThis.__api = { universe, fetchAsset, simulateWalkForward, buildDcaReplay };`;

async function direct(symbol) {
  const period1 = Math.floor(new Date("1999-01-01T00:00:00Z").getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=history`;
  const response = await fetch(url, { headers: { "user-agent": "CodexVerify/1.0" } });
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
}

const sandbox = {
  console,
  Intl,
  Math,
  Number,
  String,
  Date,
  URL,
  setTimeout,
  fetch: (url) => direct(new URL(`http://local${String(url)}`).searchParams.get("symbol")),
  document: { querySelector: () => ({ value: "10000000" }), querySelectorAll: () => [] },
  window: { devicePixelRatio: 1 }
};

vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const symbols = [...new Set([...sandbox.__api.universe, "^VIX", "^TNX"])];
const entries = await Promise.allSettled(symbols.map(async (symbol) => [symbol, await sandbox.__api.fetchAsset(symbol)]));
const assetMap = Object.fromEntries(entries.filter((entry) => entry.status === "fulfilled").map((entry) => entry.value));
const result = sandbox.__api.simulateWalkForward(assetMap, "QLD", research);
const sub = result.events.filter((event) => event.date >= "2024-01-19" && event.date <= "2026-03-25");
let holdout = 1;
let holdoutBench = 1;
sub.forEach((event) => {
  holdout *= 1 + event.nextReturn;
  holdoutBench *= 1 + event.spyReturn;
});

function compound(events, key = "nextReturn") {
  return events.reduce((value, event) => value * (1 + event[key]), 1) - 1;
}

const case2019Rows = result.events
  .filter((event) => event.date >= "2019-05-01" && event.date <= "2019-07-31")
  .map((event) => ({
    date: event.date,
    state: event.state,
    weights: event.weights,
    guards: event.guards?.map((guard) => ({ date: guard.date, label: guard.label, triggers: guard.triggers })),
    strategyReturn: event.nextReturn,
    benchmarkReturn: event.spyReturn
  }));

console.log(JSON.stringify({
  loaded: Object.keys(assetMap).length,
  guardCount: result.guardCount,
  cagr: result.cagr,
  mdd: result.mdd,
  benchCagr: result.spyCagr,
  benchMdd: result.spyMdd,
  edge: result.cagr - result.spyCagr,
  win: result.winRate,
  beat: result.beatRate,
  holdout: holdout - 1,
  holdoutBench: holdoutBench - 1,
  case2019: {
    strategyReturn: compound(result.events.filter((event) => event.date >= "2019-05-01" && event.date <= "2019-07-31")),
    benchmarkReturn: compound(result.events.filter((event) => event.date >= "2019-05-01" && event.date <= "2019-07-31"), "spyReturn"),
    rows: case2019Rows
  },
  currentGuard: result.current.guard,
  currentWeights: result.current.weights,
  firstEvent: result.events.at(0),
  lastEvent: result.events.at(-1)
}, null, 2));
