import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeKisOrders, kisStatus, previewKisOrders, syncKisOverseasPortfolio } from "./kis.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const portfolioPath = path.join(dataDir, "portfolio.json");
const researchReportPath = path.join(dataDir, "research-report.json");
const researchReportMdPath = path.join(dataDir, "research-report.md");
const envPath = path.join(__dirname, ".env");
const port = Number(process.env.PORT || 5173);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

const kisEnvKeys = [
  "KIS_TRADING_MODE",
  "KIS_APP_KEY_PAPER",
  "KIS_APP_SECRET_PAPER",
  "KIS_APP_KEY_LIVE",
  "KIS_APP_SECRET_LIVE",
  "KIS_ACCOUNT_NO",
  "KIS_ACCOUNT_PRODUCT",
  "KIS_OVERSEAS_EXCHANGE",
  "KIS_OVERSEAS_CURRENCY",
  "KIS_ORDER_EXECUTION",
  "KIS_ALLOW_LIVE_ORDERS",
  "KIS_HASH_ORDERS"
];
const secretEnvKeys = new Set(["KIS_APP_KEY_PAPER", "KIS_APP_SECRET_PAPER", "KIS_APP_KEY_LIVE", "KIS_APP_SECRET_LIVE"]);

function parseEnvText(text) {
  const values = {};
  text.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) return;
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  });
  return values;
}

function isAuthEnabled() {
  return Boolean(process.env.APP_PASSWORD);
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return cryptoSafeCompare(a, b);
}

function cryptoSafeCompare(a, b) {
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function parseBasicAuth(header = "") {
  const match = String(header).match(/^Basic\s+(.+)$/i);
  if (!match) return null;
  try {
    const [user = "", password = ""] = Buffer.from(match[1], "base64").toString("utf8").split(/:(.*)/s);
    return { user, password };
  } catch {
    return null;
  }
}

function requireAppAuth(req, res) {
  if (!isAuthEnabled()) return true;
  const credentials = parseBasicAuth(req.headers.authorization);
  const ok = credentials &&
    timingSafeEqualText(credentials.user, process.env.APP_USER || "alphastock") &&
    timingSafeEqualText(credentials.password, process.env.APP_PASSWORD || "");
  if (ok) return true;
  res.writeHead(401, {
    "content-type": "text/plain; charset=utf-8",
    "www-authenticate": 'Basic realm="AlphaStock"',
    "cache-control": "no-store"
  });
  res.end("Authentication required");
  return false;
}

function routeIs(url, ...paths) {
  return paths.includes(url.pathname);
}

async function loadLocalEnv() {
  try {
    const values = parseEnvText(await readFile(envPath, "utf8"));
    Object.entries(values).forEach(([key, value]) => {
      if (!(key in process.env)) process.env[key] = value;
    });
  } catch {
    // Environment variables are optional for dashboard-only use.
  }
}

await loadLocalEnv();

async function readEnvFile() {
  try {
    return parseEnvText(await readFile(envPath, "utf8"));
  } catch {
    return {};
  }
}

function cleanEnvValue(value) {
  return String(value ?? "").replace(/[\r\n]/g, "").trim();
}

function maskedSettings(values) {
  const env = { ...values };
  kisEnvKeys.forEach((key) => {
    if (!(key in env) && process.env[key]) env[key] = process.env[key];
  });
  return {
    mode: env.KIS_TRADING_MODE || "paper",
    account: env.KIS_ACCOUNT_NO || "",
    product: env.KIS_ACCOUNT_PRODUCT || "01",
    exchange: env.KIS_OVERSEAS_EXCHANGE || "NASD",
    currency: env.KIS_OVERSEAS_CURRENCY || "USD",
    execution: env.KIS_ORDER_EXECUTION || "disabled",
    liveOrders: env.KIS_ALLOW_LIVE_ORDERS || "false",
    hashOrders: env.KIS_HASH_ORDERS || "true",
    configured: Object.fromEntries([...secretEnvKeys].map((key) => [key, Boolean(env[key])]))
  };
}

async function readKisSettings() {
  return maskedSettings(await readEnvFile());
}

async function writeKisSettings(payload = {}) {
  const existing = await readEnvFile();
  const next = { ...existing };
  const updates = {
    KIS_TRADING_MODE: payload.mode,
    KIS_ACCOUNT_NO: payload.account,
    KIS_ACCOUNT_PRODUCT: payload.product || "01",
    KIS_OVERSEAS_EXCHANGE: payload.exchange || "NASD",
    KIS_OVERSEAS_CURRENCY: payload.currency || "USD",
    KIS_ORDER_EXECUTION: payload.execution || "disabled",
    KIS_ALLOW_LIVE_ORDERS: payload.liveOrders || "false",
    KIS_HASH_ORDERS: payload.hashOrders || "true",
    KIS_APP_KEY_PAPER: payload.paperKey,
    KIS_APP_SECRET_PAPER: payload.paperSecret,
    KIS_APP_KEY_LIVE: payload.liveKey,
    KIS_APP_SECRET_LIVE: payload.liveSecret
  };
  Object.entries(updates).forEach(([key, value]) => {
    const cleaned = cleanEnvValue(value);
    if (secretEnvKeys.has(key) && !cleaned && next[key]) return;
    next[key] = cleaned;
    process.env[key] = cleaned;
  });
  const preservedKeys = Object.keys(next).filter((key) => !kisEnvKeys.includes(key));
  const body = [...preservedKeys, ...kisEnvKeys].map((key) => `${key}=${next[key] || ""}`).join("\n");
  await writeFile(envPath, `${body}\n`, "utf8");
  return maskedSettings(next);
}

function toYahooSymbol(input) {
  const raw = String(input || "SPY").trim().toUpperCase().replace(/[^A-Z0-9.^-]/g, "");
  if (raw === "BTC") return "BTC-USD";
  if (raw === "EURUSD") return "EURUSD=X";
  return raw || "SPY";
}

async function fetchDaily(symbol) {
  try {
    return await fetchDailyFromYahoo(symbol);
  } catch (error) {
    return await fetchDailyFromStooq(symbol, error);
  }
}

async function fetchDailyFromYahoo(symbol) {
  const yahoo = toYahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?range=10y&interval=1d&events=history`;
  const res = await fetch(url, { headers: { "user-agent": "CodexMarketAdvisor/1.0" } });
  if (!res.ok) throw new Error(`Yahoo Finance returned ${res.status}`);
  const payload = await res.json();
  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const timestamps = result?.timestamp || [];
  if (!quote || !timestamps.length) throw new Error(`No chart data for ${symbol}`);
  const rows = timestamps.map((time, index) => ({
    date: new Date(time * 1000).toISOString().slice(0, 10),
    open: Number(quote.open[index]),
    high: Number(quote.high[index]),
    low: Number(quote.low[index]),
    close: Number(quote.close[index]),
    volume: Number(quote.volume[index] || 0)
  })).filter((row) => Number.isFinite(row.close));
  if (rows.length < 80) throw new Error(`Not enough daily data for ${symbol}`);
  return rows;
}

function toStooqSymbol(input) {
  const raw = String(input || "SPY").trim().toUpperCase().replace(/[^A-Z0-9.^-]/g, "");
  if (raw === "BTC") return "btcusd";
  if (raw === "EURUSD") return "eurusd";
  if (raw === "^VIX") return "^vix";
  if (raw.startsWith("^")) return raw.toLowerCase();
  return `${raw.replace(".", "-").toLowerCase()}.us`;
}

async function fetchDailyFromStooq(symbol, cause) {
  const stooq = toStooqSymbol(symbol);
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooq)}&i=d`;
  const res = await fetch(url, { headers: { "user-agent": "AlphaStockFallback/1.0" } });
  if (!res.ok) throw new Error(`${cause?.message || "Yahoo failed"}; Stooq returned ${res.status}`);
  const csv = await res.text();
  const rows = csv.trim().split(/\r?\n/).slice(1).map((line) => {
    const [date, open, high, low, close, volume] = line.split(",");
    return {
      date,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume || 0)
    };
  }).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.close) && Number.isFinite(row.high) && Number.isFinite(row.low));
  if (rows.length < 80) throw new Error(`${cause?.message || "Yahoo failed"}; Stooq fallback has not enough data for ${symbol}`);
  return rows.slice(-2600);
}

const chartFrames = {
  "5m": { range: "5d", interval: "5m", minRows: 20 },
  "1h": { range: "3mo", interval: "1h", minRows: 40 },
  "1d": { range: "2y", interval: "1d", minRows: 80 },
  "1wk": { range: "5y", interval: "1wk", minRows: 80 },
  "1mo": { range: "10y", interval: "1mo", minRows: 60 }
};

function chartFrame(input) {
  const key = String(input || "1d").toLowerCase();
  return chartFrames[key] ? key : "1d";
}

async function fetchChart(symbol, frameInput = "1d") {
  const frame = chartFrame(frameInput);
  const config = chartFrames[frame];
  const yahoo = toYahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?range=${config.range}&interval=${config.interval}&events=history&includePrePost=true`;
  try {
    const res = await fetch(url, { headers: { "user-agent": "AlphaStockChart/1.0" } });
    if (!res.ok) throw new Error(`Yahoo Finance chart returned ${res.status}`);
    const payload = await res.json();
    const result = payload.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    const timestamps = result?.timestamp || [];
    if (!quote || !timestamps.length) throw new Error(`No chart data for ${symbol}`);
    const rows = timestamps.map((time, index) => ({
      date: new Date(time * 1000).toISOString(),
      open: Number(quote.open[index]),
      high: Number(quote.high[index]),
      low: Number(quote.low[index]),
      close: Number(quote.close[index]),
      volume: Number(quote.volume[index] || 0)
    })).filter((row) => Number.isFinite(row.close) && Number.isFinite(row.high) && Number.isFinite(row.low));
    if (rows.length < config.minRows) throw new Error(`Not enough ${frame} chart data for ${symbol}`);
    return { symbol: yahoo, frame, range: config.range, interval: config.interval, rows };
  } catch (error) {
    const rows = (await fetchDailyFromStooq(symbol, error)).map((row) => ({ ...row, date: `${row.date}T00:00:00.000Z` }));
    return { symbol: toStooqSymbol(symbol), frame: "1d", range: "10y", interval: "1d", rows };
  }
}

async function fetchNews(symbols) {
  const safe = String(symbols || "SPY").split(",").map((s) => s.trim().toUpperCase().replace(/[^A-Z0-9.^-]/g, "")).filter(Boolean).slice(0, 8);
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(safe.join(","))}&region=US&lang=en-US`;
  const res = await fetch(url, { headers: { "user-agent": "CodexMarketAdvisor/1.0" } });
  if (!res.ok) throw new Error(`Yahoo Finance news returned ${res.status}`);
  const xml = await res.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .slice(0, 10)
    .map((match) => {
      const block = match[1];
      const title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] || "";
      const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
      const date = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "";
      return { title: title.replace(/&amp;/g, "&"), link: link.replace(/&amp;/g, "&"), date };
    })
    .filter((item) => item.title);
  return items;
}

async function fetchFundamentals(symbol) {
  const yahoo = toYahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(yahoo)}`;
  const res = await fetch(url, { headers: { "user-agent": "AlphaStockFundamentals/1.0" } });
  if (!res.ok) throw new Error(`Yahoo Finance quote returned ${res.status}`);
  const payload = await res.json();
  const quote = payload.quoteResponse?.result?.[0];
  if (!quote) throw new Error(`No quote fundamentals for ${symbol}`);
  return {
    symbol: quote.symbol || yahoo,
    name: quote.longName || quote.shortName || yahoo,
    exchange: quote.fullExchangeName || quote.exchange || "",
    quoteType: quote.quoteType || "",
    currency: quote.currency || "USD",
    marketState: quote.marketState || "",
    price: quote.regularMarketPrice,
    previousClose: quote.regularMarketPreviousClose,
    dayLow: quote.regularMarketDayLow,
    dayHigh: quote.regularMarketDayHigh,
    fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
    fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
    volume: quote.regularMarketVolume,
    averageVolume: quote.averageDailyVolume3Month || quote.averageDailyVolume10Day,
    marketCap: quote.marketCap,
    beta: quote.beta,
    trailingPE: quote.trailingPE,
    forwardPE: quote.forwardPE,
    priceToBook: quote.priceToBook,
    priceToSales: quote.priceToSalesTrailing12Months,
    epsTrailingTwelveMonths: quote.epsTrailingTwelveMonths,
    epsForward: quote.epsForward,
    bookValue: quote.bookValue,
    dividendYield: quote.dividendYield,
    dividendRate: quote.dividendRate,
    sharesOutstanding: quote.sharesOutstanding,
    ebitda: quote.ebitda,
    revenue: quote.totalRevenue,
    grossMargins: quote.grossMargins,
    profitMargins: quote.profitMargins,
    debtToEquity: quote.debtToEquity,
    earningsTimestamp: quote.earningsTimestamp ? new Date(quote.earningsTimestamp * 1000).toISOString() : "",
    earningsTimestampStart: quote.earningsTimestampStart ? new Date(quote.earningsTimestampStart * 1000).toISOString() : "",
    earningsTimestampEnd: quote.earningsTimestampEnd ? new Date(quote.earningsTimestampEnd * 1000).toISOString() : ""
  };
}

function normalizePortfolio(payload = {}) {
  const holdings = Array.isArray(payload.holdings) ? payload.holdings : [];
  return {
    cash: Math.max(0, Number(payload.cash) || 0),
    baselineDate: String(payload.baselineDate || "").slice(0, 10),
    baselineValue: Math.max(0, Number(payload.baselineValue) || 0),
    holdings: holdings
      .map((item) => ({
        symbol: String(item.symbol || "").trim().toUpperCase().replace(/[^A-Z0-9.^-]/g, ""),
        quantity: Math.max(0, Number(item.quantity) || 0),
        value: Math.max(0, Number(item.value) || 0)
      }))
      .filter((item) => item.symbol && (item.quantity > 0 || item.value > 0))
      .slice(0, 120)
  };
}

async function readPortfolio() {
  try {
    return normalizePortfolio(JSON.parse(await readFile(portfolioPath, "utf8")));
  } catch {
    return normalizePortfolio();
  }
}

async function writePortfolio(payload) {
  const portfolio = normalizePortfolio(payload);
  await mkdir(dataDir, { recursive: true });
  await writeFile(portfolioPath, `${JSON.stringify(portfolio, null, 2)}\n`, "utf8");
  return portfolio;
}

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 400000) throw new Error("Portfolio payload is too large");
  }
  return raw ? JSON.parse(raw) : {};
}

async function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*"
  });
  res.end(JSON.stringify(data));
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`);
  let filePath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const absolute = path.join(publicDir, filePath);
  if (!absolute.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const body = await readFile(absolute);
    res.writeHead(200, {
      "content-type": mime[path.extname(absolute)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname === "/healthz") {
      await sendJson(res, { ok: true, service: "alphastock", time: new Date().toISOString() });
      return;
    }
    if (!requireAppAuth(req, res)) return;
    if (routeIs(url, "/api/daily", "/market/daily")) {
      const symbol = url.searchParams.get("symbol") || "SPY";
      const rows = await fetchDaily(symbol);
      await sendJson(res, { symbol: symbol.toUpperCase(), source: "Yahoo Finance chart API", rows });
      return;
    }
    if (routeIs(url, "/api/chart", "/market/chart")) {
      const symbol = url.searchParams.get("symbol") || "QQQ";
      const frame = url.searchParams.get("frame") || "1d";
      await sendJson(res, { source: "Yahoo Finance chart API", ...await fetchChart(symbol, frame) });
      return;
    }
    if (routeIs(url, "/api/market-map", "/market/map")) {
      const tickers = ["SPY", "QQQ", "IWM", "TLT", "GLD", "USO", "BTC"];
      const entries = await Promise.allSettled(tickers.map(async (ticker) => {
        const rows = await fetchDaily(ticker);
        return { ticker, rows: rows.slice(-260) };
      }));
      await sendJson(res, entries.filter((entry) => entry.status === "fulfilled").map((entry) => entry.value));
      return;
    }
    if (routeIs(url, "/api/news", "/market/news")) {
      const symbols = url.searchParams.get("symbols") || "SPY";
      await sendJson(res, { symbols, items: await fetchNews(symbols) });
      return;
    }
    if (routeIs(url, "/api/fundamentals", "/market/fundamentals")) {
      const symbol = url.searchParams.get("symbol") || "QQQ";
      try {
        await sendJson(res, { source: "Yahoo Finance quote API", data: await fetchFundamentals(symbol) });
      } catch (error) {
        await sendJson(res, {
          source: "Yahoo Finance quote API",
          data: { symbol: toYahooSymbol(symbol), name: toYahooSymbol(symbol), currency: "USD", error: error.message }
        });
      }
      return;
    }
    if (routeIs(url, "/api/portfolio", "/market/portfolio") && req.method === "GET") {
      await sendJson(res, await readPortfolio());
      return;
    }
    if (routeIs(url, "/api/portfolio", "/market/portfolio") && req.method === "POST") {
      await sendJson(res, await writePortfolio(await readJsonBody(req)));
      return;
    }
    if (routeIs(url, "/api/research/latest", "/market/research/latest") && req.method === "GET") {
      try {
        const json = JSON.parse(await readFile(researchReportPath, "utf8"));
        const slim = {
          generatedAt: json.generatedAt,
          sourceDocuments: json.sourceDocuments,
          limitations: json.limitations,
          registry: json.registry,
          champion: json.champion ? {
            modelId: json.champion.modelId,
            config: json.champion.config,
            metrics: json.champion.metrics,
            review: json.champion.review,
            walkForward: json.champion.walkForward,
            recentTrades: json.champion.recentTrades,
            riskEvents: json.champion.riskEvents
          } : null,
          benchmarks: Array.isArray(json.benchmarks) ? json.benchmarks.map((item) => ({ id: item.id, metrics: item.metrics })) : [],
          advisory: json.advisory,
          tests: json.tests
        };
        let markdown = "";
        try {
          markdown = await readFile(researchReportMdPath, "utf8");
        } catch {
          markdown = "";
        }
        await sendJson(res, { available: true, json: slim, markdown });
      } catch {
        await sendJson(res, { available: false, message: "Research report has not been generated yet. Run npm run research." });
      }
      return;
    }
    if (routeIs(url, "/api/kis/status", "/market/kis/status") && req.method === "GET") {
      await sendJson(res, kisStatus(dataDir));
      return;
    }
    if (routeIs(url, "/api/kis/settings", "/market/kis/settings") && req.method === "GET") {
      await sendJson(res, await readKisSettings());
      return;
    }
    if (routeIs(url, "/api/kis/settings", "/market/kis/settings") && req.method === "POST") {
      await sendJson(res, await writeKisSettings(await readJsonBody(req)));
      return;
    }
    if (routeIs(url, "/api/kis/sync", "/market/kis/sync") && req.method === "POST") {
      const payload = await syncKisOverseasPortfolio(dataDir, await readJsonBody(req));
      const current = await readPortfolio();
      const portfolio = await writePortfolio({
        ...current,
        ...payload.portfolio,
        baselineDate: current.baselineDate,
        baselineValue: current.baselineValue
      });
      await sendJson(res, { ...payload, portfolio });
      return;
    }
    if (routeIs(url, "/api/kis/orders/preview", "/market/kis/orders/preview") && req.method === "POST") {
      await sendJson(res, previewKisOrders(dataDir, await readJsonBody(req)));
      return;
    }
    if (routeIs(url, "/api/kis/orders", "/market/kis/orders") && req.method === "POST") {
      await sendJson(res, await executeKisOrders(dataDir, await readJsonBody(req)));
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    await sendJson(res, { error: error.message }, 500);
  }
});

server.listen(port, () => {
  console.log(`Market timing advisor running at http://localhost:${port}`);
});

export { server };
