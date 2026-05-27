const $ = (selector) => document.querySelector(selector);
const fmtPct = (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
const fmtMoney = (v) => new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(v);
const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const numberValue = (selector, fallback) => Number(String($(selector)?.value || fallback).replace(/,/g, "")) || fallback;

const universe = [
  "SPY", "SSO", "UPRO", "QQQ", "QLD", "TQQQ", "IWM", "XLK", "XLF", "XLE", "XLV", "XLI", "XLY",
  "VGT", "SMH", "SOXX", "USD", "SOXL",
  "GLD", "TLT", "IEF", "SHY", "BIL", "UUP", "FXE", "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL",
  "AVGO", "AMD", "MU", "INTC", "CSCO", "TSM", "ASML", "TSLA", "JPM", "LLY"
];
const defensive = new Set(["CASH", "GLD", "TLT", "IEF", "SHY", "BIL", "UUP", "FXE"]);
const doubleLeveraged = new Set(["QLD", "SSO", "UPRO", "USD"]);
const tripleLeveraged = new Set(["TQQQ", "SOXL"]);
const executionCostModel = {
  brokerName: "KIS overseas US online",
  buyCommission: 0.0025,
  sellCommission: 0.0025,
  secFeeSell: 0.0000206,
  slippage: 0.0005,
  fxSpread: 0.0005,
  annualTaxRate: 0.22,
  annualBasicDeductionKrw: 2500000,
  minRebalanceTurnover: 0.035,
  maxMonthlyTurnover: 0.22,
  stressedMultiplier: 1.65
};
const assetMeta = {
  SPY: ["Broad US", "ETF"], SSO: ["Broad US", "Leveraged"], UPRO: ["Broad US", "Leveraged"],
  QQQ: ["Nasdaq 100", "ETF"], QLD: ["Nasdaq 100", "Leveraged"], TQQQ: ["Nasdaq 100", "Leveraged"],
  IWM: ["Small cap", "ETF"], XLK: ["Technology", "ETF"], VGT: ["Technology", "ETF"],
  XLF: ["Financials", "ETF"], XLE: ["Energy", "ETF"], XLV: ["Health care", "ETF"], XLI: ["Industrials", "ETF"], XLY: ["Consumer", "ETF"],
  SMH: ["Semiconductors", "ETF"], SOXX: ["Semiconductors", "ETF"], USD: ["Semiconductors", "Leveraged"], SOXL: ["Semiconductors", "Leveraged"],
  CASH: ["Cash", "Defensive"], GLD: ["Gold", "Defensive"], TLT: ["Treasury", "Defensive"], IEF: ["Treasury", "Defensive"], SHY: ["Cash", "Defensive"], BIL: ["Cash", "Defensive"],
  UUP: ["Dollar", "Defensive"], FXE: ["Currency", "Defensive"],
  AAPL: ["Technology", "Stock"], MSFT: ["Software", "Stock"], NVDA: ["Semiconductors", "Stock"], AMZN: ["Consumer", "Stock"], META: ["Internet", "Stock"],
  GOOGL: ["Internet", "Stock"], AVGO: ["Semiconductors", "Stock"], AMD: ["Semiconductors", "Stock"], MU: ["Semiconductors", "Stock"],
  INTC: ["Semiconductors", "Stock"], CSCO: ["Networking", "Stock"], TSM: ["Semiconductors", "Stock"], ASML: ["Semiconductors", "Stock"],
  TSLA: ["Consumer", "Stock"], JPM: ["Financials", "Stock"], LLY: ["Health care", "Stock"]
};
let appState = null;
let livePortfolio = { cash: 0, baselineDate: "", baselineValue: 0, holdings: [] };
let liveAlertTimer = null;
let kisBrokerStatus = null;
let selectedReplayIndex = null;
let researchLatest = null;
let chartState = {
  frame: "1d",
  type: "line",
  rows: [],
  symbol: "QQQ",
  indicators: new Set(["sma20", "sma50", "volume", "mfi", "rsi"])
};

async function requestJson(url, options = {}) {
  const rememberError = (error) => {
    if (typeof window !== "undefined") window.__alphaLastRequest = { url, error: error.message };
    return error;
  };
  if (typeof XMLHttpRequest !== "undefined") {
    return await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(options.method || "GET", url, true);
      Object.entries(options.headers || {}).forEach(([key, value]) => xhr.setRequestHeader(key, value));
      xhr.onload = () => {
        let payload = {};
        try {
          payload = xhr.responseText ? JSON.parse(xhr.responseText) : {};
        } catch {
          reject(rememberError(new Error(`${url} JSON parse failed`)));
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) reject(rememberError(new Error(payload.error || `${url} failed`)));
        else resolve(payload);
      };
      xhr.onerror = () => reject(rememberError(new Error(`${url} network failed`)));
      xhr.send(options.body || null);
    });
  }
  const nativeFetch = typeof fetch === "function"
    ? fetch
    : typeof window !== "undefined" && typeof window.fetch === "function"
      ? window.fetch.bind(window)
      : null;
  if (nativeFetch) {
    const res = await nativeFetch(url, options);
    const payload = await res.json();
    if (!res.ok) throw rememberError(new Error(payload.error || `${url} failed`));
    return payload;
  }
  throw rememberError(new Error("이 브라우저에서 네트워크 요청 API를 사용할 수 없습니다."));
}

const searchableSymbols = [
  ["QQQ", "Invesco QQQ Trust"], ["QLD", "ProShares Ultra QQQ"], ["TQQQ", "ProShares UltraPro QQQ"],
  ["SPY", "SPDR S&P 500 ETF"], ["SSO", "ProShares Ultra S&P500"], ["UPRO", "ProShares UltraPro S&P500"],
  ["NVDA", "NVIDIA"], ["AAPL", "Apple"], ["MSFT", "Microsoft"], ["AMZN", "Amazon"], ["META", "Meta"],
  ["GOOGL", "Alphabet"], ["AVGO", "Broadcom"], ["AMD", "Advanced Micro Devices"], ["MU", "Micron"],
  ["TSM", "TSMC ADR"], ["ASML", "ASML ADR"], ["SOXL", "Direxion Semiconductor Bull 3X"], ["SMH", "VanEck Semiconductor ETF"],
  ["SOXX", "iShares Semiconductor ETF"], ["TLT", "iShares 20+ Year Treasury"], ["GLD", "SPDR Gold Shares"], ["BIL", "SPDR 1-3 Month T-Bill"]
];

function rolling(values, n, fn = avg) {
  return values.map((_, i) => i + 1 < n ? null : fn(values.slice(i + 1 - n, i + 1)));
}

function stdev(values) {
  const m = avg(values);
  return Math.sqrt(avg(values.map((v) => (v - m) ** 2)));
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

function trueRange(rows) {
  return rows.map((r, i) => i ? Math.max(r.high - r.low, Math.abs(r.high - rows[i - 1].close), Math.abs(r.low - rows[i - 1].close)) : r.high - r.low);
}

function mfi(rows, n = 14) {
  const out = Array(rows.length).fill(null);
  const flow = rows.map((r, i) => {
    const tp = (r.high + r.low + r.close) / 3;
    const prev = i ? (rows[i - 1].high + rows[i - 1].low + rows[i - 1].close) / 3 : tp;
    return { up: tp > prev ? tp * r.volume : 0, down: tp < prev ? tp * r.volume : 0 };
  });
  for (let i = n; i < rows.length; i += 1) {
    const w = flow.slice(i + 1 - n, i + 1);
    const up = w.reduce((s, x) => s + x.up, 0);
    const down = w.reduce((s, x) => s + x.down, 0);
    out[i] = down === 0 ? 100 : 100 - 100 / (1 + up / down);
  }
  return out;
}

function indicators(rows) {
  const close = rows.map((r) => r.close);
  const high = rows.map((r) => r.high);
  const vol = rows.map((r) => r.volume);
  const tr = trueRange(rows);
  const atr = ema(tr, 14);
  const sma20 = rolling(close, 20);
  const sma50 = rolling(close, 50);
  const sma100 = rolling(close, 100);
  const sma200 = rolling(close, 200);
  const high55 = rolling(high, 55, (x) => Math.max(...x));
  const rsi14 = rsi(close);
  const mfi14 = mfi(rows);
  const e12 = ema(close, 12);
  const e26 = ema(close, 26);
  const macd = e12.map((v, i) => v - e26[i]);
  const macdSignal = ema(macd, 9);
  const vol63 = close.map((_, i) => realizedVol(rows, i, 63));
  return { close, sma20, sma50, sma100, sma200, high55, atr, rsi14, mfi14, macd, macdSignal, vol63, vol20: rolling(vol, 20) };
}

async function fetchAsset(symbol) {
  const payload = await requestJson(`/market/series?symbol=${encodeURIComponent(symbol)}`);
  return { symbol, rows: payload.rows, ind: indicators(payload.rows) };
}

async function fetchChartRows(symbol, frame = chartState.frame) {
  return await requestJson(`/market/chart?symbol=${encodeURIComponent(symbol)}&frame=${encodeURIComponent(frame)}`);
}

async function fetchNews(symbol) {
  try {
    const payload = await requestJson(`/market/news?symbols=${encodeURIComponent(symbol)}`);
    return payload.items || [];
  } catch {
    return [];
  }
}

async function fetchFundamentals(symbol) {
  try {
    const payload = await requestJson(`/market/fundamentals?symbol=${encodeURIComponent(symbol)}`);
    return payload.data || {};
  } catch {
    return {};
  }
}

async function fetchResearchLatest(force = false) {
  if (researchLatest && !force) return researchLatest;
  try {
    const payload = await requestJson("/market/research/latest");
    researchLatest = payload.available ? payload : null;
  } catch {
    researchLatest = null;
  }
  return researchLatest;
}

function activeResearchJson() {
  return researchLatest?.json || appState?.research?.json || null;
}

async function fetchLivePortfolio() {
  const payload = await requestJson("/market/portfolio");
  livePortfolio = normalizeLivePortfolio(payload);
  syncLivePortfolioInputs();
}

async function persistLivePortfolio() {
  const payload = await requestJson("/market/portfolio", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(livePortfolio)
  });
  livePortfolio = normalizeLivePortfolio(payload);
  syncLivePortfolioInputs();
}

function liveNumber(value) {
  return Math.max(0, Number(String(value || "").replace(/,/g, "")) || 0);
}

function normalizeLiveSymbol(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9.^-]/g, "");
}

function normalizeLivePortfolio(payload = {}) {
  return {
    cash: liveNumber(payload.cash),
    baselineDate: String(payload.baselineDate || "").slice(0, 10),
    baselineValue: liveNumber(payload.baselineValue),
    holdings: (Array.isArray(payload.holdings) ? payload.holdings : [])
      .map((item) => ({
        symbol: normalizeLiveSymbol(item.symbol),
        quantity: liveNumber(item.quantity),
        value: liveNumber(item.value)
      }))
      .filter((item) => item.symbol && (item.quantity > 0 || item.value > 0))
  };
}

function parseLiveHoldings(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^symbol\b/i.test(line))
    .map((line) => line.split(/[\t,]/).map((cell) => cell.trim()).filter(Boolean))
    .map(([symbol, quantity, value]) => ({
      symbol: normalizeLiveSymbol(symbol),
      quantity: liveNumber(quantity),
      value: liveNumber(value)
    }))
    .filter((item) => item.symbol && (item.quantity > 0 || item.value > 0));
}

function liveHoldingsText(profile = livePortfolio) {
  return (profile.holdings || []).map((item) => [item.symbol, item.quantity || "", item.value || ""].join(",")).join("\n");
}

function readLivePortfolioInputs() {
  return normalizeLivePortfolio({
    cash: $("#live-cash")?.value,
    baselineDate: $("#live-baseline-date")?.value,
    baselineValue: $("#live-baseline-value")?.value,
    holdings: parseLiveHoldings($("#live-holdings")?.value)
  });
}

function syncLivePortfolioInputs() {
  if ($("#live-holdings")) $("#live-holdings").value = liveHoldingsText();
  if ($("#live-cash")) $("#live-cash").value = String(livePortfolio.cash || 0);
  if ($("#live-baseline-value")) $("#live-baseline-value").value = String(livePortfolio.baselineValue || 0);
  if ($("#live-baseline-date")) $("#live-baseline-date").value = livePortfolio.baselineDate || "";
}

function setKisStatus(text) {
  if ($("#kis-status")) $("#kis-status").textContent = text;
}

async function fetchKisBrokerStatus() {
  const status = await requestJson("/market/kis/status");
  kisBrokerStatus = status;
  if ($("#kis-preview")) {
    $("#kis-preview").innerHTML = `
      <div><span class="label">운영 모드</span><strong>${status.mode}</strong></div>
      <div><span class="label">API 키</span><strong>${status.credentialsConfigured ? "설정됨" : "미설정"}</strong></div>
      <div><span class="label">계좌</span><strong>${status.accountConfigured ? "설정됨" : "미설정"}</strong></div>
      <div><span class="label">주문 잠금</span><strong>${status.executionEnabled ? "전송 허용" : "잠김"}</strong></div>
      <div><span class="label">확인 문구</span><strong>${status.orderConfirmation}</strong></div>`;
  }
  setKisStatus(`기본 조회 ${status.balanceDefaults.exchange}/${status.balanceDefaults.currency}`);
  return status;
}

function readKisOrders() {
  const raw = $("#kis-orders")?.value.trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("KIS 주문 초안은 JSON 배열이어야 합니다.");
  return parsed;
}

async function previewKisOrders() {
  const preview = await requestJson("/market/kis/orders/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orders: readKisOrders() })
  });
  $("#kis-preview").innerHTML = `
    <div><span class="label">검증 모드</span><strong>${preview.mode}</strong></div>
    <div><span class="label">주문 수</span><strong>${preview.orders.length}</strong></div>
    <div><span class="label">주문 범위</span><strong>${preview.exchangeScope}</strong></div>
    <div><span class="label">주문 잠금</span><strong>${preview.executionEnabled ? "전송 허용" : "잠김"}</strong></div>
    <div><span class="label">확인 문구</span><strong>${preview.confirmationRequired}</strong></div>`;
  setKisStatus(preview.orders.map((order) => `${order.side} ${order.symbol} ${order.quantity} @ ${order.limitPrice}`).join(" / ") || "검증할 주문이 없습니다.");
  return preview;
}

function createKisOrdersFromPlan() {
  if (!appState?.assets || !appState?.result) throw new Error("먼저 전체 재계산을 실행해 주세요.");
  const plan = buildLiveRebalancePlan(appState.assets, appState.result);
  if (!(plan.existing > 0)) throw new Error("KIS 동기화 또는 보유내역 입력 후 주문 초안을 만들 수 있습니다.");
  const exchange = kisBrokerStatus?.balanceDefaults?.exchange || "NASD";
  const minOrderValue = Math.max(50, plan.total * 0.012);
  const orders = plan.rows
    .map((row) => {
      const asset = appState.assets[row.symbol];
      const price = asset?.rows?.at(-1)?.close || 0;
      if (!(price > 0) || Math.abs(row.delta) < minOrderValue) return null;
      const side = row.delta > 0 ? "buy" : "sell";
      let quantity = Math.floor(Math.abs(row.delta) / price);
      if (side === "sell" && row.quantity > 0) quantity = Math.min(quantity, Math.floor(row.quantity));
      if (quantity < 1) return null;
      const limitPrice = side === "buy" ? price * 1.003 : price * 0.997;
      return {
        side,
        symbol: row.symbol,
        exchange,
        quantity,
        limitPrice: Number(limitPrice.toFixed(2)),
        reason: `${row.action} ${fmtMoney(Math.abs(row.delta))} · 목표 ${fmtPct(row.targetWeight)}`
      };
    })
    .filter(Boolean);
  if ($("#kis-orders")) $("#kis-orders").value = JSON.stringify(orders, null, 2);
  setKisStatus(orders.length ? `현재 보유내역과 연구 엔진 목표비중으로 주문 초안 ${orders.length}건을 만들었습니다. 전송 전 반드시 검증하세요.` : "주문 가능한 최소 금액 이상의 리밸런싱 차이가 없습니다.");
  addNotification("KIS 주문초안", `리밸런싱 주문 초안 ${orders.length}건 생성`, "검토 필요");
  return orders;
}

async function syncKisPortfolio() {
  const status = kisBrokerStatus || await fetchKisBrokerStatus();
  if (!status.credentialsConfigured) {
    await loadPaperDemoPortfolio();
    setKisStatus("API 키가 없어 모의투자 포트폴리오로 실행했습니다. 실계좌 동기화는 설정에서 App Key와 계좌번호를 입력한 뒤 가능합니다.");
    return;
  }
  const payload = await requestJson("/market/kis/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  livePortfolio = normalizeLivePortfolio(payload.portfolio);
  syncLivePortfolioInputs();
  setKisStatus(`${payload.broker.mode} ${payload.broker.exchange} 계좌 ${payload.broker.holdingCount}개 동기화`);
  addNotification("KIS 계좌", `${payload.broker.exchange} 보유 ${payload.broker.holdingCount}개 동기화`, "완료");
  await loadAll();
}

async function loadPaperDemoPortfolio() {
  livePortfolio = normalizeLivePortfolio({
    cash: 1000000,
    baselineDate: new Date().toISOString().slice(0, 10),
    baselineValue: 10000000,
    holdings: [
      { symbol: "QQQ", quantity: 8, value: 5200000 },
      { symbol: "QLD", quantity: 15, value: 2500000 },
      { symbol: "BIL", quantity: 0, value: 1300000 }
    ]
  });
  await persistLivePortfolio();
  addNotification("모의투자", "API 설정 없이 샘플 포트폴리오를 불러왔습니다.", "완료");
  setLiveStatus("모의투자 포트폴리오 준비 완료");
  await loadAll();
}

async function submitKisOrders() {
  const status = kisBrokerStatus || await fetchKisBrokerStatus();
  const confirm = window.prompt(`주문을 전송하려면 ${status.orderConfirmation} 를 입력하세요.`);
  if (!confirm) return;
  const payload = await requestJson("/market/kis/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orders: readKisOrders(), confirm })
  });
  setKisStatus(`${payload.mode} 주문 ${payload.submitted}건 전송 완료`);
  addNotification("KIS 주문", `${payload.mode} 주문 ${payload.submitted}건 전송`, "완료");
  await syncKisPortfolio();
}

function notificationLog() {
  try {
    return JSON.parse(localStorage.getItem("alphastock-notifications") || "[]");
  } catch {
    return [];
  }
}

function writeNotificationLog(items) {
  localStorage.setItem("alphastock-notifications", JSON.stringify(items.slice(-120)));
}

function addNotification(kind, message, status = "대기") {
  const items = notificationLog();
  items.push({ time: new Date().toLocaleString("ko-KR"), kind, message, status });
  writeNotificationLog(items);
  renderNotificationCenter();
}

function renderNotificationCenter() {
  const items = notificationLog().slice().reverse();
  if ($("#notification-summary")) {
    const liveAlerts = items.filter((item) => item.kind.includes("리스크")).length;
    const brokerAlerts = items.filter((item) => item.kind.includes("KIS")).length;
    $("#notification-summary").innerHTML = `
      <div><span class="label">전체 알림</span><strong>${items.length}</strong></div>
      <div><span class="label">리스크 알림</span><strong>${liveAlerts}</strong></div>
      <div><span class="label">브로커 알림</span><strong>${brokerAlerts}</strong></div>
      <div><span class="label">브라우저 알림</span><strong>${liveAlertTimer ? "켜짐" : "꺼짐"}</strong></div>`;
  }
  if ($("#notification-table")) {
    $("#notification-table").innerHTML = items.length ? items.map((item) => `
      <tr>
        <td>${item.time}</td>
        <td><strong>${item.kind}</strong></td>
        <td>${item.message}</td>
        <td>${item.status}</td>
      </tr>`).join("") : `<tr><td colspan="4" class="muted">아직 기록된 알림이 없습니다.</td></tr>`;
  }
}

function setSettingsStatus(text) {
  if ($("#settings-status")) $("#settings-status").textContent = text;
}

async function loadKisSettings() {
  const settings = await requestJson("/market/kis/settings");
  if ($("#kis-setting-mode")) $("#kis-setting-mode").value = settings.mode || "paper";
  if ($("#kis-setting-account")) $("#kis-setting-account").value = settings.account || "";
  if ($("#kis-setting-product")) $("#kis-setting-product").value = settings.product || "01";
  if ($("#kis-setting-exchange")) $("#kis-setting-exchange").value = settings.exchange || "NASD";
  if ($("#kis-setting-currency")) $("#kis-setting-currency").value = settings.currency || "USD";
  if ($("#kis-setting-execution")) $("#kis-setting-execution").value = settings.execution || "disabled";
  if ($("#kis-setting-live-orders")) $("#kis-setting-live-orders").value = settings.liveOrders || "false";
  ["paper-key", "paper-secret", "live-key", "live-secret"].forEach((id) => {
    const input = $(`#kis-setting-${id}`);
    if (input) input.value = "";
  });
  const configured = settings.configured || {};
  setSettingsStatus(`저장 상태: 모의키 ${configured.KIS_APP_KEY_PAPER ? "있음" : "없음"} · 모의시크릿 ${configured.KIS_APP_SECRET_PAPER ? "있음" : "없음"} · 실전키 ${configured.KIS_APP_KEY_LIVE ? "있음" : "없음"} · 실전시크릿 ${configured.KIS_APP_SECRET_LIVE ? "있음" : "없음"}`);
  return settings;
}

async function saveKisSettings() {
  const payload = {
    mode: $("#kis-setting-mode")?.value || "paper",
    account: $("#kis-setting-account")?.value || "",
    product: $("#kis-setting-product")?.value || "01",
    exchange: $("#kis-setting-exchange")?.value || "NASD",
    currency: $("#kis-setting-currency")?.value || "USD",
    paperKey: $("#kis-setting-paper-key")?.value || "",
    paperSecret: $("#kis-setting-paper-secret")?.value || "",
    liveKey: $("#kis-setting-live-key")?.value || "",
    liveSecret: $("#kis-setting-live-secret")?.value || "",
    execution: $("#kis-setting-execution")?.value || "disabled",
    liveOrders: $("#kis-setting-live-orders")?.value || "false",
    hashOrders: "true"
  };
  const settings = await requestJson("/market/kis/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  addNotification("KIS 설정", `${settings.mode} 모드 API 설정 저장`, "완료");
  await loadKisSettings();
  await fetchKisBrokerStatus();
}

function retAt(rows, i, days) {
  return i >= days && rows[i]?.close && rows[i - days]?.close ? rows[i].close / rows[i - days].close - 1 : 0;
}

function realizedVol(rows, i, days = 63) {
  if (i < days + 1) return 0.25;
  const rs = [];
  for (let x = i - days + 1; x <= i; x += 1) rs.push(rows[x].close / rows[x - 1].close - 1);
  return stdev(rs) * Math.sqrt(252);
}

function drawdown(rows, i, days = 126) {
  if (!rows[i]) return 0;
  const start = Math.max(0, i - days);
  const high = Math.max(...rows.slice(start, i + 1).map((r) => r.close));
  return rows[i].close / high - 1;
}

function indexOnOrBefore(asset, date) {
  const rows = asset?.rows || [];
  let lo = 0, hi = rows.length - 1, ans = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (rows[mid].date <= date) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
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
  Object.keys({ ...fromWeights, ...toWeights }).forEach((symbol) => {
    if (symbol === "CASH") return;
    const diff = (toWeights[symbol] || 0) - (fromWeights[symbol] || 0);
    if (diff > 0) buys += diff;
    else sells += Math.abs(diff);
  });
  return stress * (buys * (executionCostModel.buyCommission + executionCostModel.slippage) + sells * (executionCostModel.sellCommission + executionCostModel.secFeeSell + executionCostModel.slippage));
}

function buyOnlyCostRate() {
  return executionCostModel.buyCommission + executionCostModel.slippage + executionCostModel.fxSpread;
}

function estimateAnnualTaxKrw(realizedGainKrw) {
  return Math.max(0, realizedGainKrw - executionCostModel.annualBasicDeductionKrw) * executionCostModel.annualTaxRate;
}

function assetAvailableOn(assetMap = {}, symbol, date) {
  if (symbol === "CASH") return true;
  const asset = assetMap[symbol];
  if (!asset?.rows?.length) return false;
  if (!date) return true;
  const idx = indexOnOrBefore(asset, date);
  return idx != null && asset.rows[idx]?.date <= date;
}

function safeFallback(assetMap = {}, date = "") {
  return ["BIL", "SHY", "IEF", "GLD", "TLT", "UUP", "CASH"].find((symbol) => assetAvailableOn(assetMap, symbol, date)) || "CASH";
}

function symbolSector(symbol) {
  return assetMeta[symbol]?.[0] || (defensive.has(symbol) ? "Defensive" : "Other");
}

function symbolType(symbol) {
  return assetMeta[symbol]?.[1] || (defensive.has(symbol) ? "Defensive" : "ETF");
}

function capWeightGroups(weights, predicate, cap) {
  const out = { ...weights };
  const symbols = Object.keys(out).filter(predicate);
  const total = symbols.reduce((sum, symbol) => sum + (out[symbol] || 0), 0);
  if (total <= cap || total <= 0) return { weights: out, freed: 0 };
  const scale = cap / total;
  let freed = 0;
  symbols.forEach((symbol) => {
    const next = out[symbol] * scale;
    freed += out[symbol] - next;
    out[symbol] = next;
  });
  return { weights: out, freed };
}

function applyRealWorldConstraints(weights, state = {}, assetMap = {}, date = "") {
  let out = normalizeWeights(weights);
  let freed = 0;
  const heat = Number(state.heat ?? 0.55);
  const safe = safeFallback(assetMap, date);
  const semiCap = heat >= 0.72 ? 0.42 : heat >= 0.52 ? 0.36 : 0.28;
  const techCap = heat >= 0.72 ? 0.82 : heat >= 0.52 ? 0.66 : 0.48;
  const leverageCap = heat >= 0.72 ? 0.56 : heat >= 0.52 ? 0.38 : 0.16;
  const tripleCap = heat >= 0.72 ? 0.18 : 0.08;
  Object.keys(out).forEach((symbol) => {
    const maxSingle = symbolType(symbol) === "Stock" ? 0.16 : tripleLeveraged.has(symbol) ? 0.12 : 0.46;
    if (out[symbol] > maxSingle) {
      freed += out[symbol] - maxSingle;
      out[symbol] = maxSingle;
    }
  });
  let capped = capWeightGroups(out, (symbol) => symbolSector(symbol) === "Semiconductors", semiCap);
  out = capped.weights; freed += capped.freed;
  capped = capWeightGroups(out, (symbol) => ["Technology", "Software", "Internet", "Semiconductors"].includes(symbolSector(symbol)), techCap);
  out = capped.weights; freed += capped.freed;
  capped = capWeightGroups(out, (symbol) => doubleLeveraged.has(symbol) || tripleLeveraged.has(symbol), leverageCap);
  out = capped.weights; freed += capped.freed;
  capped = capWeightGroups(out, (symbol) => tripleLeveraged.has(symbol), tripleCap);
  out = capped.weights; freed += capped.freed;
  if (freed > 0 && assetAvailableOn(assetMap, safe, date)) out[safe] = (out[safe] || 0) + freed;
  return normalizeWeights(out);
}

function chooseCostAwareRebalance(previousWeights, targetWeights, state = {}, force = false) {
  const constrained = normalizeWeights(targetWeights);
  if (force || !Object.keys(previousWeights || {}).length) {
    const turnover = weightTurnover({}, constrained);
    return { weights: constrained, turnover, tradeCostRate: transactionCostForWeights({}, constrained), skipped: false, reason: "initial_or_forced_rebalance" };
  }
  const turnover = weightTurnover(previousWeights, constrained);
  const heat = Number(state.heat ?? 0.55);
  const minTurnover = heat < 0.40 ? 0.055 : executionCostModel.minRebalanceTurnover;
  const riskNow = riskExposure(previousWeights);
  const riskTarget = riskExposure(constrained);
  const riskReduction = riskTarget + 0.06 < riskNow;
  if (!riskReduction && turnover < minTurnover) {
    return { weights: normalizeWeights(previousWeights), turnover, tradeCostRate: 0, skipped: true, reason: `turnover_below_${(minTurnover * 100).toFixed(1)}pct` };
  }
  if (!riskReduction && turnover > executionCostModel.maxMonthlyTurnover) {
    const step = executionCostModel.maxMonthlyTurnover / turnover;
    const stepped = {};
    Object.keys({ ...previousWeights, ...constrained }).forEach((symbol) => {
      stepped[symbol] = (previousWeights[symbol] || 0) + ((constrained[symbol] || 0) - (previousWeights[symbol] || 0)) * step;
    });
    const steppedWeights = normalizeWeights(stepped);
    const steppedTurnover = weightTurnover(previousWeights, steppedWeights);
    return { weights: steppedWeights, turnover: steppedTurnover, tradeCostRate: transactionCostForWeights(previousWeights, steppedWeights), skipped: false, reason: `staged_rebalance_cap_${(executionCostModel.maxMonthlyTurnover * 100).toFixed(0)}pct` };
  }
  return { weights: constrained, turnover, tradeCostRate: transactionCostForWeights(previousWeights, constrained), skipped: false, reason: riskReduction ? "risk_reduction_override" : "expected_edge_exceeds_friction" };
}

function marketState(spy, i) {
  const { rows, ind } = spy;
  const date = rows[i]?.date;
  const vixIndex = indexOnOrBefore(spy.vix, date);
  const tnxIndex = indexOnOrBefore(spy.tnx, date);
  const vix = vixIndex != null ? spy.vix?.rows?.[vixIndex]?.close : null;
  const tnx = tnxIndex != null ? spy.tnx?.rows?.[tnxIndex]?.close : null;
  const tnxRise = tnxIndex != null && spy.tnx?.rows?.[tnxIndex - 63] ? (tnx - spy.tnx.rows[tnxIndex - 63].close) : 0;
  let heat = 0;
  if (rows[i].close > ind.sma200[i]) heat += 0.22;
  if (ind.sma50[i] > ind.sma200[i]) heat += 0.16;
  if (ind.sma20[i] > ind.sma50[i]) heat += 0.12;
  if (retAt(rows, i, 63) > 0) heat += 0.14;
  if (retAt(rows, i, 126) > 0) heat += 0.12;
  if (drawdown(rows, i, 126) > -0.08) heat += 0.12;
  if (ind.vol63[i] < 0.22) heat += 0.12;
  if (vix > 30) heat -= 0.2;
  else if (vix > 23) heat -= 0.1;
  else if (vix > 0 && vix < 17) heat += 0.07;
  if (tnxRise > 0.45 && retAt(rows, i, 63) < 0.02) heat -= 0.08;
  if (tnxRise < -0.35 && rows[i].close > ind.sma100[i]) heat += 0.04;
  heat = clamp(heat, 0, 1);
  const label = heat >= 0.72 ? "위험선호 상승장" : heat >= 0.52 ? "상승 우위" : heat >= 0.34 ? "중립/변동성" : "방어장";
  return { heat, label, riskBudget: heat >= 0.72 ? 1 : heat >= 0.52 ? 0.78 : heat >= 0.34 ? 0.45 : 0.16 };
}

function assetScore(asset, spy, i, flavor) {
  const signalDate = spy.rows[i]?.date;
  const ai = indexOnOrBefore(asset, signalDate);
  if (ai == null || ai < 252 || asset.rows[ai].date > signalDate) return 0;
  const spyIndex = i;
  i = ai;
  const { rows, ind } = asset;
  const r1 = retAt(rows, i, 21);
  const r3 = retAt(rows, i, 63);
  const r6 = retAt(rows, i, 126);
  const r12 = retAt(rows, i, 252);
  const rel = r3 - retAt(spy.rows, spyIndex, 63);
  const vol = realizedVol(rows, i, 63);
  const dd = drawdown(rows, i, 126);
  const trend = rows[i].close > ind.sma200[i] ? 1 : 0;
  const macd = ind.macd[i] > ind.macdSignal[i] ? 1 : 0;
  const breakout = ind.high55[i - 1] && rows[i].close > ind.high55[i - 1] ? 1 : 0;
  const rsiNow = ind.rsi14[i] ?? 50;
  const mfiNow = ind.mfi14[i] ?? 50;
  const mfiPrev = ind.mfi14[i - 10] ?? mfiNow;
  const volumeExpansion = ind.vol20[i] && rows[i].volume > ind.vol20[i] * 1.18 && rows[i].close > rows[i - 1].close ? 1 : 0;
  const healthyFlow = mfiNow >= 45 && mfiNow <= 78 && mfiNow > mfiPrev ? 1 : 0;
  const moneyExhaustion = mfiNow > 86 && rsiNow > 78 ? 1 : 0;
  const flowDivergence = r1 > 0.04 && mfiNow < mfiPrev - 8 ? 1 : 0;
  const oversold = rsiNow < 35 && mfiNow < 35 ? 1 : 0;
  const lowVol = 1 / Math.max(0.08, vol);

  const weights = {
    dualMomentum: [0.18, 0.30, 0.24, 0.16, 0.22, 0.08, 0.02],
    lowVolTrend: [0.06, 0.18, 0.20, 0.12, 0.16, 0.32, 0.03],
    breakout: [0.20, 0.24, 0.14, 0.08, 0.18, 0.06, 0.18],
    meanReversion: [-0.04, 0.08, 0.12, 0.04, 0.08, 0.16, 0.28],
    defensiveRotation: [0.04, 0.14, 0.18, 0.12, 0.10, 0.28, 0.02],
    qualityGrowth: [0.12, 0.24, 0.22, 0.18, 0.18, 0.12, 0.05],
    benchmarkCore: [0.18, 0.30, 0.24, 0.16, 0.24, 0.10, 0.05],
    championRotation: [0.22, 0.34, 0.30, 0.22, 0.28, 0.02, 0.08],
    turboTrend: [0.18, 0.32, 0.28, 0.20, 0.24, 0.04, 0.14],
    flowTrend: [0.20, 0.30, 0.24, 0.14, 0.26, 0.08, 0.12],
    crashSwitch: [0.02, 0.08, 0.12, 0.10, 0.05, 0.26, 0.02]
  }[flavor];
  let score = 45;
  score += clamp(r1 * 100 * weights[0], -12, 14);
  score += clamp(r3 * 100 * weights[1], -18, 24);
  score += clamp(r6 * 100 * weights[2], -18, 24);
  score += clamp(r12 * 100 * weights[3], -16, 24);
  score += clamp(rel * 100 * weights[4], -18, 22);
  score += clamp(lowVol * weights[5], 0, 18);
  score += breakout * weights[6] * 45;
  score += trend * 8 + macd * 5;
  score += healthyFlow * 6;
  score += volumeExpansion * (["breakout", "turboTrend", "championRotation"].includes(flavor) ? 7 : 3);
  score -= moneyExhaustion * (["championRotation", "turboTrend"].includes(flavor) ? 6 : 10);
  score -= flowDivergence * 7;
  score += oversold * (flavor === "meanReversion" ? 18 : -8);
  score += clamp(dd * 70, -22, 0);
  if (flavor === "benchmarkCore" && trend && macd && r3 > 0) score += 10;
  if (rows[i].close < ind.sma200[i] && !defensive.has(asset.symbol)) score -= 20;
  if (flavor === "defensiveRotation" && defensive.has(asset.symbol)) score += 20;
  if (flavor === "crashSwitch" && defensive.has(asset.symbol)) score += 24;
  if (["championRotation", "turboTrend"].includes(flavor) && defensive.has(asset.symbol)) score -= 18;
  if (flavor === "championRotation" && trend && macd && r3 > 0 && r6 > 0) score += 12;
  if (flavor === "turboTrend" && breakout && r1 > 0) score += 10;
  if (flavor === "flowTrend" && healthyFlow && macd && r3 > 0) score += 13;
  if (flavor === "flowTrend" && volumeExpansion && mfiNow < 82) score += 8;
  if (flavor === "flowTrend" && flowDivergence) score -= 12;
  if (rsiNow > 78 && !["breakout", "qualityGrowth"].includes(flavor)) score -= 8;
  if (["championRotation", "turboTrend"].includes(flavor) && rsiNow > 84) score -= 10;
  return clamp(score, 0, 100);
}

const strategyDefs = [
  { key: "autonomousResearch", name: "자율 연구 챔피언", note: "RESEARCH_SPEC 게이트를 통과한 최신 모델을 리플레이와 목표비중에 직접 반영" },
  { key: "adaptiveLeverage", name: "Alpha Prime Rotation", note: "QLD Alpha를 기준선으로 삼아 검증한 개선형. SOXL/QLD/QQQ와 반도체 상대강도를 더 정교하게 배분" },
  { key: "benchmarkCore", name: "벤치마크 코어 알파", note: "선택한 비교 기준을 코어로 깔고 검증된 위성 자산만 얹음" },
  { key: "championRotation", name: "챔피언 로테이션", note: "상승장에서는 가장 강한 1~3개 자산에 집중" },
  { key: "turboTrend", name: "터보 추세", note: "신고가·상대강도·MACD가 겹치는 고베타 자산을 추종" },
  { key: "flowTrend", name: "스마트 플로우", note: "MFI·거래량·MACD가 동시에 개선되는 자금 유입 추세를 추종" },
  { key: "dualMomentum", name: "듀얼 모멘텀", note: "3/6/12개월 강도와 SPY 대비 초과강도를 추적" },
  { key: "lowVolTrend", name: "저변동 추세", note: "수익률보다 변동성 대비 추세 품질을 우선" },
  { key: "breakout", name: "돌파 추종", note: "신고가와 거래량 확장 구간을 공격적으로 편입" },
  { key: "meanReversion", name: "공포 반등", note: "과매도 후 반등을 소액으로 포착" },
  { key: "defensiveRotation", name: "방어 로테이션", note: "GLD/TLT/SHY와 현금으로 하락장을 통과" },
  { key: "crashSwitch", name: "크래시 스위치", note: "지수 추세 훼손 시 성장주를 끊고 방어자산으로 이동" },
  { key: "qualityGrowth", name: "퀄리티 성장", note: "장기 주도 성장주를 변동성 페널티와 함께 선별" }
];

function assetBySymbol(assets) {
  return Object.fromEntries(assets.map((asset) => [asset.symbol, asset]));
}

function adaptiveLeverageState(assets, spy, i) {
  const map = assetBySymbol(assets);
  const qqq = map.QQQ || spy;
  const qi = indexOnOrBefore(qqq, spy.rows[i]?.date);
  if (qi == null || qi < 252) return { heat: 0.16, label: "Capital defense", riskBudget: 0.05 };
  const qqqMfi = qqq.ind.mfi14[qi] ?? 50;
  const qqqMfiPrev = qqq.ind.mfi14[qi - 10] ?? qqqMfi;
  const qqqMacdDown = qqq.ind.macd[qi] < qqq.ind.macdSignal[qi];
  const qqqShortBreak = qqq.rows[qi].close < qqq.ind.sma20[qi] && qqqMacdDown && qqqMfi < qqqMfiPrev - 5;
  const qqqHigh21 = qi >= 20 ? Math.max(...qqq.rows.slice(qi - 20, qi + 1).map((row) => row.close)) : qqq.rows[qi].close;
  const qqqDd21 = qqq.rows[qi].close / qqqHigh21 - 1;
  let heat = 0;
  if (qqq.rows[qi].close > qqq.ind.sma200[qi]) heat += 0.26;
  if (qqq.rows[qi].close > qqq.ind.sma50[qi]) heat += 0.16;
  if (qqq.ind.sma50[qi] > qqq.ind.sma200[qi]) heat += 0.16;
  if (retAt(qqq.rows, qi, 63) > -0.01) heat += 0.15;
  if (retAt(qqq.rows, qi, 126) > 0) heat += 0.13;
  if (spy.rows[i].close > spy.ind.sma200[i]) heat += 0.08;
  if (realizedVol(qqq.rows, qi, 63) < 0.32) heat += 0.06;
  if (qqqMfi > 85 && (qqq.ind.rsi14[qi] ?? 50) > 80) heat -= 0.08;
  if (qqqShortBreak) heat -= 0.04;
  if (qqqDd21 <= -0.04 && qqqMacdDown) heat -= 0.02;
  if (qqqDd21 <= -0.06 && qqqMfi < 52) heat -= 0.04;
  heat = clamp(heat, 0, 1);
  const riskBudget = heat >= 0.68 ? 1 : heat >= 0.50 ? 0.78 : heat >= 0.32 ? 0.35 : 0.05;
  const label = heat >= 0.68 ? "Leveraged risk-on" : heat >= 0.50 ? "Balanced growth" : heat >= 0.32 ? "Reduced exposure" : "Capital defense";
  return { heat, label, riskBudget };
}

function adaptiveLeverageScore(asset, qqq, i, qi) {
  const { rows, ind } = asset;
  const r1 = retAt(rows, i, 21);
  const r3 = retAt(rows, i, 63);
  const r6 = retAt(rows, i, 126);
  const r12 = retAt(rows, i, 252);
  const rel = r3 - retAt(qqq.rows, qi, 63);
  const trend = rows[i].close > ind.sma200[i] ? 1 : 0;
  const midTrend = rows[i].close > ind.sma50[i] ? 1 : 0;
  const macd = ind.macd[i] > ind.macdSignal[i] ? 1 : 0;
  const mfiNow = ind.mfi14[i] ?? 50;
  const rsiNow = ind.rsi14[i] ?? 50;
  const flow = mfiNow >= 38 && mfiNow <= 84 ? 1 : 0;
  const exhaustion = mfiNow > 90 && rsiNow > 82 ? 1 : 0;
  const vol = realizedVol(rows, i, 63);
  const dd = drawdown(rows, i, 126);
  let score =
    0.6 * r1 +
    1.7 * r3 +
    1.2 * r6 +
    0.6 * r12 +
    1.1 * rel +
    0.2 * trend +
    0.12 * midTrend +
    0.12 * macd +
    0.1 * flow -
    0.65 * vol +
    0.45 * dd -
    0.18 * exhaustion;
  return score;
}

function weightsForAdaptiveLeverage(assets, spy, i) {
  const map = assetBySymbol(assets);
  const qqq = map.QQQ || spy;
  const qi = indexOnOrBefore(qqq, spy.rows[i]?.date);
  const signalDate = spy.rows[i]?.date;
  if (qi == null || qi < 252) return { weights: defensiveWeights(map, signalDate), cash: 0, state: { heat: 0.16, label: "Capital defense", riskBudget: 0.05 }, scored: [] };
  const state = adaptiveLeverageState(assets, spy, i);
  const safe = safeFallback(map, signalDate);
  if (state.riskBudget <= 0.08) {
    const weights = {};
    Object.assign(weights, defensiveWeights(map, signalDate));
    return { weights, cash: Math.max(0, 1 - Object.values(weights).reduce((s, v) => s + v, 0)), state, scored: [] };
  }
  const pool = ["TQQQ", "QLD", "QQQ", "SMH", "SOXX", "USD", "SOXL", "XLK", "VGT", "NVDA", "AVGO", "AMD", "MU", "TSM", "ASML", "MSFT", "META", "GOOGL", "AMZN"];
  const ranked = pool
    .map((symbol) => {
      const asset = map[symbol];
      const ai = indexOnOrBefore(asset, spy.rows[i]?.date);
      if (!asset || ai == null || ai < 252 || asset.rows[ai].date > spy.rows[i].date) return null;
      return { symbol, score: adaptiveLeverageScore(asset, qqq, ai, qi), vol: realizedVol(asset.rows, ai, 63), defensive: false };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const weights = {};
  if (ranked.length) {
    const raw = ranked.map((item, idx) => Math.max(0.01, Math.exp((item.score - ranked[0].score) / 0.14) * (1 - idx * 0.10)));
    const sum = raw.reduce((s, v) => s + v, 0) || 1;
    ranked.forEach((item, idx) => {
      const cap = tripleLeveraged.has(item.symbol) ? 0.34 : doubleLeveraged.has(item.symbol) ? 0.88 : 0.34;
      weights[item.symbol] = Math.min(cap, state.riskBudget * raw[idx] / sum);
    });
  }
  let used = Object.values(weights).reduce((s, v) => s + v, 0);
  if (state.riskBudget > 0.75 && map.QLD && used < state.riskBudget) {
    const add = Math.min(0.15, state.riskBudget - used, Math.max(0, 0.88 - (weights.QLD || 0)));
    weights.QLD = (weights.QLD || 0) + add;
    used += add;
  }
  if (used < 0.98) {
    const filler = state.riskBudget > 0.45 && map.QQQ ? "QQQ" : safe;
    if (assetAvailableOn(map, filler, signalDate)) weights[filler] = (weights[filler] || 0) + (1 - used);
  }
  used = Object.values(weights).reduce((s, v) => s + v, 0);
  return { weights, cash: Math.max(0, 1 - used), state, scored: ranked };
}

function weightsForStrategy(assets, spy, i, flavor) {
  if (flavor === "adaptiveLeverage") return weightsForAdaptiveLeverage(assets, spy, i);
  const state = marketState(spy, i);
  let budget = state.riskBudget;
  if (flavor === "defensiveRotation") budget = Math.min(0.8, Math.max(0.25, 1 - state.heat + 0.25));
  if (flavor === "crashSwitch") budget = state.heat < 0.42 ? 0.9 : 0.18;
  if (flavor === "meanReversion") budget = Math.min(budget, 0.35);
  if (flavor === "breakout" && state.heat < 0.52) budget *= 0.45;
  if (["dualMomentum", "breakout", "qualityGrowth", "championRotation", "turboTrend", "flowTrend", "benchmarkCore"].includes(flavor) && state.heat >= 0.72) budget = Math.max(budget, 0.98);
  if (["championRotation", "turboTrend", "flowTrend", "benchmarkCore"].includes(flavor) && state.heat < 0.52) budget *= 0.25;

  const rows = assets.map((asset) => {
    const ai = indexOnOrBefore(asset, spy.rows[i]?.date);
    if (ai == null || ai < 252) return null;
    return {
      symbol: asset.symbol,
      score: assetScore(asset, spy, i, flavor),
      vol: realizedVol(asset.rows, ai, 63),
      defensive: defensive.has(asset.symbol)
    };
  }).filter((x) => x && x.score >= (x.defensive ? 46 : 58));

  rows.sort((a, b) => b.score - a.score);
  const take = flavor === "championRotation" ? 3 : flavor === "turboTrend" ? 4 : flavor === "flowTrend" || flavor === "benchmarkCore" ? 5 : flavor === "defensiveRotation" || flavor === "crashSwitch" ? 5 : 7;
  const selected = rows.slice(0, take);
  const raw = selected.map((x) => {
    const concentrationBoost = ["championRotation", "turboTrend", "flowTrend", "benchmarkCore"].includes(flavor) ? 1.45 : 1;
    return { ...x, raw: Math.max(1, x.score - 48) ** concentrationBoost / Math.max(0.10, x.vol) };
  });
  const sum = raw.reduce((s, x) => s + x.raw, 0);
  const weights = {};
  if (sum > 0) raw.forEach((x) => {
    const cap = flavor === "benchmarkCore" ? 0.48
      : flavor === "championRotation" ? 0.55
      : flavor === "turboTrend" ? 0.42
      : flavor === "flowTrend" ? 0.34
      : x.defensive ? 0.45
      : 0.22;
    weights[x.symbol] = Math.min(cap, budget * x.raw / sum);
  });
  const used = Object.values(weights).reduce((s, v) => s + v, 0);
  return { weights, cash: Math.max(0, 1 - used), state, scored: rows };
}

function researchModelName(modelId = "") {
  return ({
    crash_survival_rotation: "Crash Survival Rotation",
    dynamic_robust_hybrid: "Dynamic Robust Hybrid",
    dynamic_low_vol_trend: "Dynamic Low-vol Trend",
    baseline_report_rebuild: "QLD Alpha Rotation",
    dynamic_growth_offense: "Dynamic Growth Offense"
  })[modelId] || modelId || "Research Champion";
}

function researchRiskBudget(state, config = {}) {
  if (config.riskMode === "strict_defense") {
    if (state.heat >= 0.72) return 0.72;
    if (state.heat >= 0.55) return 0.45;
    if (state.heat >= 0.40) return 0.25;
    return 0.08;
  }
  if (config.riskMode === "low_vol") return state.heat >= 0.70 ? 0.78 : state.heat >= 0.48 ? 0.52 : 0.18;
  return state.riskBudget;
}

function researchScore(asset, spy, i, config = {}) {
  const signalDate = spy.rows[i]?.date;
  const ai = indexOnOrBefore(asset, signalDate);
  if (ai == null || ai < 252 || asset.rows[ai].date > signalDate) return { raw: -Infinity, display: 0 };
  const spyIndex = i;
  i = ai;
  const mix = config.momentumMix || [0.06, 0.18, 0.26, 0.18];
  const r1 = retAt(asset.rows, i, 21);
  const r3 = retAt(asset.rows, i, 63);
  const r6 = retAt(asset.rows, i, 126);
  const r12 = retAt(asset.rows, i, 252);
  const spy3 = retAt(spy.rows, Math.min(spyIndex, spy.rows.length - 1), 63);
  const trend = asset.rows[i].close > asset.ind.sma200[i] ? 0.14 : -0.18;
  const midTrend = asset.rows[i].close > asset.ind.sma50[i] ? 0.08 : -0.05;
  const macd = asset.ind.macd[i] > asset.ind.macdSignal[i] ? 0.06 : -0.04;
  const mfiNow = asset.ind.mfi14[i] ?? 50;
  const mfiPrev = asset.ind.mfi14[i - 10] ?? mfiNow;
  const flow = ((mfiNow - 50) / 50) * (config.flowWeight || 0.05) + (mfiNow > mfiPrev ? 0.025 : -0.025);
  const volPenalty = (config.volPenalty || 1.0) * realizedVol(asset.rows, i, 63) * 0.34;
  const drawdownPenalty = (config.drawdownPenalty || 0.7) * Math.abs(Math.min(0, drawdown(asset.rows, i, 126))) * 0.55;
  const relative = (r3 - spy3) * 0.28;
  const exhaustion = mfiNow > 88 && (asset.ind.rsi14[i] ?? 50) > 82 ? 0.16 : 0;
  const raw = mix[0] * r1 + mix[1] * r3 + mix[2] * r6 + mix[3] * r12 + trend + midTrend + macd + flow + relative - volPenalty - drawdownPenalty - exhaustion;
  return { raw, display: clamp(58 + raw * 120, 0, 100) };
}

function weightsForAutonomousResearch(assets, spy, i, research = activeResearchJson()) {
  const modelId = research?.champion?.modelId || research?.advisory?.championModelId || "dynamic_robust_hybrid";
  const config = research?.champion?.config || {};
  const state = marketState(spy, i);
  const budget = researchRiskBudget(state, config);
  const assetMap = assetBySymbol(assets);
  const signalDate = spy.rows[i]?.date;
  const safe = safeFallback(assetMap, signalDate);
  const ranked = assets
    .filter((asset) => {
      const ai = indexOnOrBefore(asset, spy.rows[i]?.date);
      return asset?.rows?.[ai] && ai >= 252;
    })
    .map((asset) => {
      const ai = indexOnOrBefore(asset, spy.rows[i]?.date);
      const score = researchScore(asset, spy, i, config);
      return {
        symbol: asset.symbol,
        score: score.display,
        raw: score.raw,
        vol: realizedVol(asset.rows, ai, 63),
        defensive: defensive.has(asset.symbol)
      };
    })
    .filter((row) => row.defensive || row.score >= 54)
    .sort((a, b) => b.raw - a.raw);
  const holdN = Math.max(4, Math.min(10, Number(config.holdN) || 7));
  const selected = ranked
    .filter((row) => row.symbol !== safe)
    .slice(0, holdN);
  const floor = selected.length ? Math.min(...selected.map((row) => row.raw)) : 0;
  const raw = selected.map((row, idx) => ({ ...row, allocRaw: Math.exp((row.raw - floor) * 5.4) * (1 - idx * 0.04) / Math.max(0.12, row.vol || 0.2) }));
  const rawSum = raw.reduce((sum, row) => sum + row.allocRaw, 0) || 1;
  const weights = {};
  raw.forEach((row) => {
    const cap = row.defensive ? 0.36
      : tripleLeveraged.has(row.symbol) ? Math.min(0.10, config.leveragedCap || 0.08)
      : doubleLeveraged.has(row.symbol) ? Math.min(0.16, (config.leveragedCap || 0.08) * 1.5)
      : row.symbol.length <= 4 && !["QQQ", "SPY", "IWM", "SMH", "XLK", "VGT"].includes(row.symbol) ? (config.stockCap || 0.10)
      : (config.topCap || 0.22);
    weights[row.symbol] = Math.min(cap, budget * row.allocRaw / rawSum);
  });
  let used = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const safeRoom = Math.max(0, 1 - used);
  if (safeRoom > 0.0001 && safe) {
    const uupWeight = assets.find((asset) => asset.symbol === "UUP") && config.riskMode === "strict_defense" ? Math.min(0.30, safeRoom * 0.38) : 0;
    if (uupWeight && assetAvailableOn(assetMap, "UUP", signalDate)) weights.UUP = (weights.UUP || 0) + uupWeight;
    const gldWeight = assetAvailableOn(assetMap, "GLD", signalDate) && state.heat < 0.52 ? Math.min(0.18, safeRoom * 0.18) : 0;
    if (gldWeight) weights.GLD = (weights.GLD || 0) + gldWeight;
    used = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
    weights[safe] = (weights[safe] || 0) + Math.max(0, 1 - used);
  }
  return {
    weights: normalizeWeights(weights),
    cash: Math.max(0, 1 - Object.values(weights).reduce((sum, weight) => sum + weight, 0)),
    state: { ...state, label: `${researchModelName(modelId)} / ${state.label}` },
    scored: ranked,
    components: [{ key: "autonomousResearch", name: `자율 연구 챔피언 (${researchModelName(modelId)})`, weight: 1 }]
  };
}

function normalizeResearchTargetWeights(targetWeights = {}, assetMap = {}) {
  const weights = {};
  Object.entries(targetWeights).forEach(([symbol, weight]) => {
    const normalizedSymbol = normalizeLiveSymbol(symbol);
    const numeric = Number(weight);
    if (normalizedSymbol && assetMap[normalizedSymbol] && Number.isFinite(numeric) && numeric > 0.0001) {
      weights[normalizedSymbol] = (weights[normalizedSymbol] || 0) + numeric;
    }
  });
  const used = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (used > 1.0001) {
    Object.keys(weights).forEach((symbol) => {
      weights[symbol] /= used;
    });
  }
  return normalizeWeights(weights);
}

function applyResearchAdvisoryCurrent(pack, assetMap, research = activeResearchJson()) {
  const advisory = research?.advisory;
  const weights = normalizeResearchTargetWeights(advisory?.targetWeights, assetMap);
  if (!Object.keys(weights).length) return pack;
  const riskState = advisory.riskState || "research";
  const triggers = [...(advisory.activeRiskTriggers || []), ...(advisory.activeSignals || [])].filter(Boolean);
  const used = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  return {
    ...pack,
    weights,
    cash: Math.max(0, 1 - used),
    state: { ...pack.state, label: `${researchModelName(advisory.championModelId)} / ${riskState}` },
    guard: {
      level: riskState.includes("off") || riskState.includes("defense") ? "trim" : "clear",
      label: `연구 엔진: ${riskState}`,
      triggers,
      cut: 0
    },
    components: [{ key: "autonomousResearch", name: `자율 연구 챔피언 (${researchModelName(advisory.championModelId)})`, weight: 1 }],
    advisory,
    researchApplied: true
  };
}

function monthReturn(weights, assetMap, i, nextI) {
  const baseRows = (assetMap.SPY || assetMap.QQQ || Object.values(assetMap).find((asset) => asset?.rows?.length))?.rows || [];
  const fromDate = baseRows[i]?.date;
  const toDate = baseRows[nextI]?.date;
  let out = 0;
  Object.entries(weights).forEach(([symbol, w]) => {
    const asset = assetMap[symbol];
    const from = rowOnOrBefore(asset, fromDate);
    const to = rowOnOrBefore(asset, toDate);
    if (from?.close && to?.close && to.date >= from.date) out += w * (to.close / from.close - 1);
  });
  return out;
}

function dailyReturn(weights, assetMap, i) {
  const baseRows = (assetMap.SPY || assetMap.QQQ || Object.values(assetMap).find((asset) => asset?.rows?.length))?.rows || [];
  const fromDate = baseRows[i - 1]?.date;
  const toDate = baseRows[i]?.date;
  let out = 0;
  Object.entries(weights).forEach(([symbol, w]) => {
    const asset = assetMap[symbol];
    const from = rowOnOrBefore(asset, fromDate);
    const to = rowOnOrBefore(asset, toDate);
    if (from?.close && to?.close && to.date >= from.date) out += w * (to.close / from.close - 1);
  });
  return out;
}

function normalizeWeights(weights) {
  const out = {};
  Object.entries(weights).forEach(([symbol, weight]) => {
    if (weight > 0.0001) out[symbol] = weight;
  });
  return out;
}

function reduceRisk(weights, cut, safeSymbol = "BIL") {
  const out = {};
  let freed = 0;
  Object.entries(weights).forEach(([symbol, weight]) => {
    if (defensive.has(symbol)) {
      out[symbol] = (out[symbol] || 0) + weight;
      return;
    }
    const kept = weight * (1 - cut);
    out[symbol] = (out[symbol] || 0) + kept;
    freed += weight - kept;
  });
  out[safeSymbol] = (out[safeSymbol] || 0) + freed;
  return normalizeWeights(out);
}

function riskExposure(weights) {
  return Object.entries(weights).reduce((sum, [symbol, weight]) => sum + (defensive.has(symbol) ? 0 : weight), 0);
}

function defensiveWeights(assetMap, date = "") {
  const weights = {};
  if (assetAvailableOn(assetMap, "BIL", date)) weights.BIL = 0.70;
  else if (assetAvailableOn(assetMap, "SHY", date)) weights.SHY = 0.70;
  else weights.CASH = 0.70;
  if (assetAvailableOn(assetMap, "GLD", date)) weights.GLD = 0.20;
  else weights.CASH = (weights.CASH || 0) + 0.20;
  if (assetAvailableOn(assetMap, "TLT", date)) weights.TLT = 0.10;
  else weights.CASH = (weights.CASH || 0) + 0.10;
  const used = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (used < 0.99) weights[safeFallback(assetMap, date)] = (weights[safeFallback(assetMap, date)] || 0) + (1 - used);
  return normalizeWeights(weights);
}

function recoveryReentrySignal(assetMap, assets, spy, i) {
  const map = assetBySymbol(assets);
  const qqq = map.QQQ || spy;
  const qi = indexOnOrBefore(qqq, spy.rows[i]?.date);
  if (qi < 20) return { ok: false, triggers: [] };
  const mfiNow = qqq.ind.mfi14[qi] ?? 50;
  const mfiPrev = qqq.ind.mfi14[qi - 5] ?? mfiNow;
  const macdHist = qqq.ind.macd[qi] - qqq.ind.macdSignal[qi];
  const macdHistPrev = qqq.ind.macd[qi - 5] - qqq.ind.macdSignal[qi - 5];
  const fiveDayRebound = retAt(qqq.rows, qi, 5);
  const rebound =
    fiveDayRebound > 0.018 &&
    (qqq.rows[qi].close > qqq.ind.sma20[qi] || fiveDayRebound > 0.04) &&
    (mfiNow > mfiPrev || mfiNow > 48) &&
    macdHist > macdHistPrev;
  const trendOk = qqq.rows[qi].close > qqq.ind.sma50[qi] || retAt(qqq.rows, qi, 21) > -0.025;
  const triggers = [];
  if (rebound) triggers.push("QQQ 5일 반등 + 20일선 회복");
  if (mfiNow > mfiPrev || mfiNow > 48) triggers.push("MFI 재유입");
  if (macdHist > macdHistPrev) triggers.push("MACD 히스토그램 개선");
  return { ok: rebound && trendOk, triggers };
}

function recoveryReentryWeights(assetMap, date = "") {
  const weights = {};
  if (assetAvailableOn(assetMap, "QLD", date)) weights.QLD = 0.25;
  if (assetAvailableOn(assetMap, "QQQ", date)) weights.QQQ = 0.40;
  if (assetAvailableOn(assetMap, "SMH", date)) weights.SMH = 0.12;
  if (assetAvailableOn(assetMap, "SOXL", date)) weights.SOXL = 0.08;
  const safe = safeFallback(assetMap, date);
  weights[safe] = Math.max(0, 1 - Object.values(weights).reduce((sum, weight) => sum + weight, 0));
  return normalizeWeights(weights);
}

function applyWeeklyRiskGuard(pack, assetMap, assets, spy, i) {
  const map = assetBySymbol(assets);
  const qqq = map.QQQ || spy;
  const smh = map.SMH;
  const soxx = map.SOXX;
  const signalDate = spy.rows[i]?.date;
  const safe = safeFallback(assetMap, signalDate);
  const qi = indexOnOrBefore(qqq, signalDate);
  const si = Math.min(i, spy.rows.length - 1);
  if (qi == null || qi < 252 || !spy.rows[si]) {
    return { ...pack, guard: { level: "clear", label: "주간 감시: 데이터 부족", triggers: [], cut: 0 } };
  }
  const triggers = [];
  let cut = 0;
  let hardDefense = false;

  const qqqBelow200 = qqq.rows[qi].close < qqq.ind.sma200[qi];
  const qqqBelow50 = qqq.rows[qi].close < qqq.ind.sma50[qi];
  const qqqBelow20 = qqq.rows[qi].close < qqq.ind.sma20[qi];
  const qqqMfi = qqq.ind.mfi14[qi] ?? 50;
  const qqqMfiPrev = qqq.ind.mfi14[qi - 10] ?? qqqMfi;
  const qqqMacdDown = qqq.ind.macd[qi] < qqq.ind.macdSignal[qi];
  const qqqFlowBreak = qqqMfi < 50 && qqqMacdDown;
  const qqqMfiDrop = qqqMfi < qqqMfiPrev - 7;
  const qqqHigh21 = qi >= 20 ? Math.max(...qqq.rows.slice(qi - 20, qi + 1).map((row) => row.close)) : qqq.rows[qi].close;
  const qqqDd21 = qqq.rows[qi].close / qqqHigh21 - 1;
  const qqqRet10 = retAt(qqq.rows, qi, 10);
  if (spy.rows[si].close < spy.ind.sma200[si]) {
    triggers.push("SPY 200일선 이탈");
    if (qqqBelow200 && qqqFlowBreak) cut = Math.max(cut, 0.60);
  }
  if (qqqBelow50) {
    triggers.push("QQQ 50일선 이탈");
  }
  if (qqqBelow20 && qqqMacdDown && qqqMfiDrop) {
    triggers.push("QQQ 20일선 이탈 + MFI 급감");
    cut = Math.max(cut, 0.08);
  }
  if (qqqFlowBreak) {
    triggers.push("QQQ MFI<50 + MACD 하락");
    cut = Math.max(cut, qqqBelow50 ? 0.10 : 0);
  }
  if (qqqDd21 <= -0.04 && qqqMacdDown) {
    triggers.push("QQQ 21일 고점 대비 -4% 급락");
    cut = Math.max(cut, 0.08);
  }
  if (qqqDd21 <= -0.06 && (qqqMfi < 52 || qqqBelow50 || qqqRet10 < -0.035)) {
    triggers.push("QQQ 21일 고점 대비 -6% 위험차단");
    cut = Math.max(cut, 0.20);
  }
  const soxl = assetMap.SOXL;
  const soxlI = soxl ? indexOnOrBefore(soxl, signalDate) : -1;
  if (soxl && soxlI >= 21) {
    const high21 = Math.max(...soxl.rows.slice(soxlI - 20, soxlI + 1).map((row) => row.close));
    const soxlDd21 = soxl.rows[soxlI].close / high21 - 1;
    if (soxlDd21 <= -0.12 && (qqqBelow20 || qqqMacdDown)) {
      triggers.push("SOXL 21일 고점 대비 -12% 레버리지 경고");
      cut = Math.max(cut, 0.08);
    }
    if (soxlDd21 <= -0.15) {
      triggers.push("SOXL 21일 고점 대비 -15% 이상");
      if (qqqBelow50 || qqqFlowBreak || qqqDd21 <= -0.04) cut = Math.max(cut, 0.16);
    }
  }
  const smhI = smh ? indexOnOrBefore(smh, signalDate) : null;
  const soxxI = soxx ? indexOnOrBefore(soxx, signalDate) : null;
  if (smh && soxx && qi >= 10 && smhI >= 10 && soxxI >= 10) {
    const semiWeak =
      retAt(smh.rows, smhI, 10) - retAt(qqq.rows, qi, 10) < -0.04 &&
      retAt(soxx.rows, soxxI, 10) - retAt(qqq.rows, qi, 10) < -0.04;
    if (semiWeak) {
      triggers.push("반도체 2주 상대강도 약화");
      if (qqqBelow50 || qqqFlowBreak || qqqDd21 <= -0.04) cut = Math.max(cut, 0.12);
    }
  }
  if ((qqq.ind.rsi14[qi] ?? 50) > 82 && (qqq.ind.mfi14[qi] ?? 50) > 84) {
    triggers.push("QQQ RSI/MFI 동시 과열");
  }

  if (hardDefense) {
    return {
      ...pack,
      weights: defensiveWeights(assetMap),
      guard: { level: "defense", label: "주간 감시: 방어 전환", triggers, cut: 1 }
    };
  }
  if (cut > 0) {
    return {
      ...pack,
      weights: reduceRisk(pack.weights, cut, safe),
      guard: { level: cut >= 0.4 ? "trim" : "watch", label: `주간 감시: 위험 ${(cut * 100).toFixed(0)}% 감산`, triggers, cut }
    };
  }
  return {
    ...pack,
    guard: { level: "clear", label: "주간 감시: 유지", triggers: [], cut: 0 }
  };
}

function monthReturnWithWeeklyGuard(pack, assetMap, assets, spy, i, nextI, benchmark, openingTradeCostRate = 0) {
  let weights = { ...pack.weights };
  let activeCut = 0;
  let defenseMode = false;
  let portfolio = Math.max(0.0001, 1 - openingTradeCostRate);
  let benchmarkEquity = 1;
  const guards = [];
  for (let day = i + 1; day <= nextI; day += 1) {
    const lossCut = portfolio <= 0.88 ? 0.72 : portfolio <= 0.92 ? 0.48 : portfolio <= 0.95 ? 0.24 : 0;
    if (!defenseMode && lossCut > activeCut) {
      weights = reduceRisk(pack.weights, lossCut, safeFallback(assetMap, spy.rows[Math.max(i, day - 1)]?.date));
      activeCut = lossCut;
      guards.push({
        date: spy.rows[Math.max(i, day - 1)].date,
        level: "trim",
        label: `월중 손실 제한: 위험 ${(lossCut * 100).toFixed(0)}% 감산`,
        triggers: [`전략 월중 평가손실 ${fmtPct(portfolio - 1)}`],
        cut: lossCut
      });
    }
    if ((day - i - 1) % 5 !== 0) {
      portfolio *= 1 + dailyReturn(weights, assetMap, day);
      const bFrom = rowOnOrBefore(benchmark, spy.rows[day - 1]?.date);
      const bTo = rowOnOrBefore(benchmark, spy.rows[day]?.date);
      benchmarkEquity *= bFrom?.close && bTo?.close ? bTo.close / bFrom.close : spy.rows[day].close / spy.rows[day - 1].close;
      continue;
    }
    const scanIndex = Math.max(i, day - 1);
    const guarded = applyWeeklyRiskGuard({ ...pack, weights: pack.weights }, assetMap, assets, spy, scanIndex);
    if (guarded.guard?.level === "defense" && !defenseMode) {
      const before = weights;
      const costRate = transactionCostForWeights(before, guarded.weights);
      weights = { ...guarded.weights };
      portfolio *= Math.max(0.0001, 1 - costRate);
      defenseMode = true;
      activeCut = 1;
      guards.push({ date: spy.rows[scanIndex].date, ...guarded.guard, weights, costRate });
    } else if (!defenseMode && (guarded.guard?.cut || 0) > activeCut) {
      const before = weights;
      const costRate = transactionCostForWeights(before, guarded.weights);
      weights = { ...guarded.weights };
      portfolio *= Math.max(0.0001, 1 - costRate);
      activeCut = guarded.guard.cut;
      guards.push({ date: spy.rows[scanIndex].date, ...guarded.guard, weights, costRate });
    }
    const reentry = recoveryReentrySignal(assetMap, assets, spy, scanIndex);
    if (reentry.ok && riskExposure(weights) < 0.35) {
      const before = weights;
      const reentryWeights = recoveryReentryWeights(assetMap, spy.rows[scanIndex]?.date);
      const costRate = transactionCostForWeights(before, reentryWeights);
      weights = reentryWeights;
      portfolio *= Math.max(0.0001, 1 - costRate);
      defenseMode = false;
      activeCut = Math.min(activeCut, 0.20);
      guards.push({
        date: spy.rows[scanIndex].date,
        level: "watch",
        label: "회복 재진입: 부분 위험자산 복귀",
        triggers: reentry.triggers,
        cut: activeCut,
        weights,
        costRate
      });
    }
    portfolio *= 1 + dailyReturn(weights, assetMap, day);
    const bFrom = rowOnOrBefore(benchmark, spy.rows[day - 1]?.date);
    const bTo = rowOnOrBefore(benchmark, spy.rows[day]?.date);
    benchmarkEquity *= bFrom?.close && bTo?.close ? bTo.close / bFrom.close : spy.rows[day].close / spy.rows[day - 1].close;
  }
  return {
    nextReturn: portfolio - 1,
    benchmarkReturn: benchmarkEquity - 1,
    finalWeights: weights,
    guards,
    openingTradeCostRate,
    totalGuardCostRate: guards.reduce((sum, guard) => sum + (guard.costRate || 0), 0)
  };
}

function returnsDrawdown(returns) {
  let equity = 1;
  let peak = 1;
  let mdd = 0;
  returns.forEach((r) => {
    equity *= 1 + r;
    peak = Math.max(peak, equity);
    mdd = Math.min(mdd, equity / peak - 1);
  });
  return mdd;
}

function evaluateStrategy(assetMap, assets, spy, flavor, fromI, toI, benchmarkAsset = spy) {
  const monthly = [];
  const benchmarkReturns = [];
  for (let i = fromI; i + 21 <= toI; i += 21) {
    const w = weightsForStrategy(assets, spy, i, flavor).weights;
    const fromDate = spy.rows[i]?.date;
    const toDate = spy.rows[i + 21]?.date;
    const benchFrom = rowOnOrBefore(benchmarkAsset, fromDate);
    const benchTo = rowOnOrBefore(benchmarkAsset, toDate);
    monthly.push(monthReturn(w, assetMap, i, i + 21));
    benchmarkReturns.push(benchFrom?.close && benchTo?.close ? benchTo.close / benchFrom.close - 1 : 0);
  }
  if (!monthly.length) return { score: -999, avg: 0, worst: 0 };
  const mean = avg(monthly);
  const worst = Math.min(...monthly);
  const vol = stdev(monthly) || 0.01;
  const excess = monthly.map((r, i) => r - benchmarkReturns[i]);
  const downside = Math.sqrt(avg(monthly.map((r) => Math.min(0, r) ** 2))) || 0.001;
  const win = monthly.filter((r) => r > 0).length / monthly.length;
  const beat = monthly.filter((r, i) => r >= benchmarkReturns[i]).length / monthly.length;
  const cagr = monthly.reduce((eq, r) => eq * (1 + r), 1) ** (12 / monthly.length) - 1;
  const excessCagr = avg(excess) * 12;
  const mdd = returnsDrawdown(monthly);
  const recent = avg(monthly.slice(-6));
  const stability = mean / vol;
  const score =
    stability * 1.02 +
    mean * 8.4 +
    cagr * 1.45 +
    excessCagr * 1.55 +
    win * 0.32 +
    beat * 0.30 +
    recent * 5.8 +
    worst * 1.2 -
    downside * 1.35 -
    Math.abs(mdd) * 0.28;
  return { score, avg: mean, worst, win, beat, cagr, excessCagr, mdd, vol };
}

function adjustedStrategyScore(strategy, ev, state) {
  let adjusted = ev.score;
  if (state.heat >= 0.62 && strategy.key === "adaptiveLeverage") adjusted += 1.45;
  if (state.heat >= 0.72 && strategy.key === "adaptiveLeverage") adjusted += 0.65;
  if (state.heat < 0.42 && strategy.key === "adaptiveLeverage") adjusted -= 0.55;
  if (state.heat >= 0.72 && strategy.key === "championRotation") adjusted += 1.08;
  if (state.heat >= 0.72 && strategy.key === "turboTrend") adjusted += 0.92;
  if (state.heat >= 0.52 && strategy.key === "benchmarkCore") adjusted += 0.32;
  if (state.heat >= 0.72 && strategy.key === "flowTrend") adjusted += 0.54;
  if (state.heat >= 0.72 && strategy.key === "qualityGrowth") adjusted += 0.40;
  if (state.heat >= 0.72 && strategy.key === "breakout") adjusted += 0.30;
  if (state.heat >= 0.72 && strategy.key === "dualMomentum") adjusted += 0.18;
  if (state.heat >= 0.72 && strategy.key === "defensiveRotation") adjusted -= 0.58;
  if (state.heat >= 0.60 && strategy.key === "meanReversion") adjusted -= 0.34;
  if (state.heat < 0.4 && !["defensiveRotation", "crashSwitch", "meanReversion", "lowVolTrend"].includes(strategy.key)) adjusted -= 0.62;
  if (state.heat < 0.4 && strategy.key === "defensiveRotation") adjusted += 0.52;
  if (state.heat < 0.4 && strategy.key === "crashSwitch") adjusted += 0.64;
  if (state.heat < 0.52 && strategy.key === "meanReversion") adjusted += 0.22;
  if (ev.win < 0.48) adjusted -= 0.18;
  if (ev.beat < 0.48) adjusted -= 0.15;
  if (ev.worst < -0.14) adjusted -= 0.18;
  return adjusted;
}

function buildStrategyMix(candidates, assets, spy, i) {
  const best = candidates[0]?.adjusted ?? candidates[0]?.score ?? 0;
  const selected = candidates
    .filter((item) => (item.adjusted ?? item.score) >= best - 0.62 && item.avg > -0.006 && (item.win ?? 1) >= 0.46)
    .slice(0, 3);
  const finalMix = selected.length ? selected : candidates.slice(0, 1);
  const floor = Math.min(...finalMix.map((item) => item.adjusted ?? item.score));
  const raw = finalMix.map((item) => ({ ...item, mixRaw: Math.exp(((item.adjusted ?? item.score) - floor) * 1.22) }));
  const rawSum = raw.reduce((sum, item) => sum + item.mixRaw, 0) || 1;
  const weights = {};
  const scoreMap = new Map();
  raw.forEach((strategy) => {
    const strategyWeight = strategy.mixRaw / rawSum;
    const pack = weightsForStrategy(assets, spy, i, strategy.key);
    Object.entries(pack.weights).forEach(([symbol, weight]) => {
      weights[symbol] = (weights[symbol] || 0) + weight * strategyWeight;
    });
    pack.scored.forEach((item) => {
      const prev = scoreMap.get(item.symbol);
      if (!prev || item.score > prev.score) scoreMap.set(item.symbol, item);
    });
  });
  const used = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  return {
    weights,
    cash: Math.max(0, 1 - used),
    components: raw.map((item) => ({ key: item.key, name: item.name, weight: item.mixRaw / rawSum })),
    scored: [...scoreMap.values()].sort((a, b) => b.score - a.score)
  };
}

function applyBenchmarkCore(pack, assetMap, benchmark, spy, i) {
  const bi = indexOnOrBefore(benchmark, spy.rows[i]?.date);
  if (bi == null || bi < 252 || defensive.has(benchmark.symbol)) return pack;
  if (pack.components.some((item) => item.key === "adaptiveLeverage")) return pack;
  const state = marketState(spy, i);
  const benchmarkTrend = benchmark.rows[bi].close > benchmark.ind.sma200[bi] && retAt(benchmark.rows, bi, 63) > 0;
  const coreWeight = benchmarkTrend ? (state.heat >= 0.72 ? 0.35 : 0.25) : 0.12;
  if (!coreWeight) return pack;
  const room = Math.max(0, 1 - coreWeight);
  const weights = {};
  Object.entries(pack.weights).forEach(([symbol, weight]) => {
    if (symbol === benchmark.symbol) return;
    weights[symbol] = weight * room;
  });
  weights[benchmark.symbol] = (weights[benchmark.symbol] || 0) + coreWeight;
  const used = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  return {
    ...pack,
    weights,
    cash: Math.max(0, 1 - used),
    components: [{ key: "benchmarkOverlay", name: `${benchmark.symbol} 코어 오버레이`, weight: coreWeight }, ...pack.components.map((item) => ({ ...item, weight: item.weight * room })).filter((item) => item.weight >= 0.01)],
  };
}

function indicatorSignal(asset, i) {
  const { rows, ind } = asset;
  const mfiNow = ind.mfi14[i] ?? 50;
  const rsiNow = ind.rsi14[i] ?? 50;
  const macdOk = ind.macd[i] > ind.macdSignal[i];
  const atrPct = ind.atr[i] ? ind.atr[i] / rows[i].close : 0;
  const breakout = ind.high55[i - 1] && rows[i].close > ind.high55[i - 1];
  const mfiPrev = ind.mfi14[i - 10] ?? mfiNow;
  const flow = mfiNow > mfiPrev ? "자금유입" : mfiNow < mfiPrev - 6 ? "자금둔화" : "중립";
  const verdict = breakout && macdOk && mfiNow < 82 ? "추가매수 우선" : macdOk && flow === "자금유입" ? "보유/분할매수" : mfiNow > 86 || rsiNow > 82 ? "과열 축소" : "관찰";
  return { mfiNow, rsiNow, macdOk, atrPct, breakout, flow, verdict };
}

function liveHoldingRows(assetMap, profile = livePortfolio) {
  return (profile.holdings || []).map((holding) => {
    const asset = assetMap[holding.symbol];
    const price = asset?.rows.at(-1)?.close || 0;
    const marketValue = holding.quantity > 0 && price > 0 ? holding.quantity * price : holding.value;
    return { ...holding, asset, price, marketValue };
  }).filter((holding) => holding.marketValue > 0);
}

function livePortfolioValue(assetMap, profile = livePortfolio) {
  return liveHoldingRows(assetMap, profile).reduce((sum, holding) => sum + holding.marketValue, profile.cash || 0);
}

function actionText(delta, total) {
  if (delta > total * 0.012) return "매수";
  if (delta < -total * 0.012) return "매도";
  return "유지";
}

function buildLiveRebalancePlan(assetMap, result, profile = livePortfolio) {
  const holdings = liveHoldingRows(assetMap, profile);
  const holdingMap = new Map(holdings.map((holding) => [holding.symbol, holding]));
  const existing = holdings.reduce((sum, holding) => sum + holding.marketValue, 0) + (profile.cash || 0);
  const monthly = numberValue("#monthly-contribution", 1000000);
  const total = existing + monthly;
  const targetWeights = result.current.weights;
  const symbols = [...new Set([...holdingMap.keys(), ...Object.keys(targetWeights)])];
  const rows = symbols.map((symbol) => {
    const holding = holdingMap.get(symbol);
    const currentValue = holding?.marketValue || 0;
    const currentWeight = existing ? currentValue / existing : 0;
    const targetWeight = targetWeights[symbol] || 0;
    const targetValue = total * targetWeight;
    const delta = targetValue - currentValue;
    return {
      symbol,
      quantity: holding?.quantity || 0,
      currentValue,
      currentWeight,
      targetWeight,
      targetValue,
      delta,
      action: actionText(delta, total)
    };
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const targetInvested = Object.values(targetWeights).reduce((sum, weight) => sum + weight, 0);
  const buys = rows.filter((row) => row.delta > 0).reduce((sum, row) => sum + row.delta, 0);
  const sells = rows.filter((row) => row.delta < 0).reduce((sum, row) => sum + Math.abs(row.delta), 0);
  const targetCash = Math.max(0, total * (1 - targetInvested));
  return {
    holdings,
    existing,
    monthly,
    total,
    invested: targetInvested,
    targetInvested,
    targetCash,
    buyTotal: buys,
    sellTotal: sells,
    buys,
    sells,
    rows
  };
}

function lossLimitCut(loss) {
  if (loss <= -0.11) return 0.80;
  if (loss <= -0.07) return 0.62;
  if (loss <= -0.04) return 0.36;
  return 0;
}

function alertScaleSummary(rows, cut) {
  const affected = rows
    .filter((row) => !defensive.has(row.symbol))
    .map((row) => ({ symbol: row.symbol, amount: row.marketValue * cut }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  return {
    symbols: affected.slice(0, 4).map((row) => row.symbol).join(", ") || "위험자산",
    amount: affected.reduce((sum, row) => sum + row.amount, 0)
  };
}

function alertBuySummary(total, weights) {
  const rows = Object.entries(weights)
    .filter(([symbol]) => !defensive.has(symbol))
    .map(([symbol, weight]) => ({ symbol, amount: total * weight }))
    .sort((a, b) => b.amount - a.amount);
  return {
    symbols: rows.map((row) => row.symbol).join(", "),
    amount: rows.reduce((sum, row) => sum + row.amount, 0)
  };
}

function buildLiveAlerts(assetMap, result, profile = livePortfolio) {
  const holdings = liveHoldingRows(assetMap, profile);
  const total = holdings.reduce((sum, holding) => sum + holding.marketValue, profile.cash || 0);
  const holdingRisk = total ? holdings.filter((holding) => !defensive.has(holding.symbol)).reduce((sum, holding) => sum + holding.marketValue, 0) / total : 0;
  const latestDate = assetMap.SPY?.rows.at(-1)?.date || "-";
  const alerts = [];
  const baselineLoss = profile.baselineValue > 0 ? total / profile.baselineValue - 1 : null;
  const portfolioCut = baselineLoss == null ? 0 : lossLimitCut(baselineLoss);
  if (portfolioCut > 0) {
    const scale = alertScaleSummary(holdings, portfolioCut);
    alerts.push({
      kind: "loss",
      rowClass: "alert-hot",
      date: latestDate,
      title: `월중 손실 제한 ${Math.round(portfolioCut * 100)}% 감산`,
      symbols: scale.symbols,
      amount: scale.amount,
      reason: `기준일 ${profile.baselineDate || "-"} 대비 ${fmtPct(baselineLoss)}`
    });
  }
  const guard = result.current.guard || { cut: 0, triggers: [] };
  if (total > 0 && (guard.cut || 0) > portfolioCut) {
    const scale = alertScaleSummary(holdings, guard.cut);
    alerts.push({
      kind: "guard",
      rowClass: "alert-watch",
      date: latestDate,
      title: guard.label,
      symbols: scale.symbols,
      amount: scale.amount,
      reason: (guard.triggers || []).join(", ")
    });
  }
  const assets = universe.map((symbol) => assetMap[symbol]).filter(Boolean);
  const spyAsset = assetMap.SPY || assets[0];
  const reentry = spyAsset ? recoveryReentrySignal(assetMap, assets, spyAsset, spyAsset.rows.length - 1) : { ok: false, triggers: [] };
  if (total > 0 && reentry.ok && holdingRisk < 0.35) {
    const reentryBuy = alertBuySummary(total || numberValue("#capital", 10000000), recoveryReentryWeights(assetMap));
    alerts.push({
      kind: "reentry",
      rowClass: "alert-reentry",
      date: latestDate,
      title: "회복 재진입",
      symbols: reentryBuy.symbols,
      amount: reentryBuy.amount,
      reason: reentry.triggers.join(", ")
    });
  }
  return { total, holdingRisk, baselineLoss, alerts, latestDate };
}

function buildContributionPlan(assetMap, result) {
  if (livePortfolio.holdings.length) return buildLiveRebalancePlan(assetMap, result);
  const existing = numberValue("#capital", 10000000);
  const monthly = numberValue("#monthly-contribution", 1000000);
  const total = existing + monthly;
  const priorWeights = result.events.at(-1)?.weights || result.current.weights;
  const targetWeights = result.current.weights;
  const symbols = [...new Set([...Object.keys(priorWeights), ...Object.keys(targetWeights)])];
  const rows = symbols.map((symbol) => {
    const currentWeight = priorWeights[symbol] || 0;
    const targetWeight = targetWeights[symbol] || 0;
    const currentValue = existing * currentWeight;
    const targetValue = total * targetWeight;
    const delta = targetValue - currentValue;
    const asset = assetMap[symbol];
    const signal = asset ? indicatorSignal(asset, asset.rows.length - 1) : null;
    const action = delta > total * 0.012 ? "추가매수" : delta < -total * 0.012 ? "일부매도" : "유지";
    return { symbol, currentWeight, targetWeight, currentValue, targetValue, delta, action, signal };
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const invested = Object.values(targetWeights).reduce((s, v) => s + v, 0);
  const buyTotal = rows.filter((r) => r.delta > 0).reduce((s, r) => s + r.delta, 0);
  const sellTotal = rows.filter((r) => r.delta < 0).reduce((s, r) => s + Math.abs(r.delta), 0);
  return { existing, monthly, total, invested, buyTotal, sellTotal, rows };
}

function buildDcaReplay(result, initialAmount, monthlyContribution, fromIndex = 0, toIndex = result.events.length - 1) {
  let portfolioValue = initialAmount;
  let benchmarkValue = initialAmount;
  let principal = initialAmount;
  let annualRealizedGain = 0;
  let totalFees = 0;
  let totalTax = 0;
  const points = [];
  for (let idx = Math.max(0, fromIndex); idx <= Math.min(result.events.length - 1, toIndex); idx += 1) {
    const event = result.events[idx];
    const buyFee = monthlyContribution * buyOnlyCostRate();
    totalFees += buyFee;
    const beginningValue = portfolioValue + monthlyContribution - buyFee;
    principal += monthlyContribution;
    portfolioValue = beginningValue * (1 + event.nextReturn);
    benchmarkValue = (benchmarkValue + monthlyContribution - buyFee) * (1 + event.spyReturn);
    annualRealizedGain += Math.max(0, beginningValue * Math.max(0, event.nextReturn) * Math.min(1, (event.turnover || 0) + (event.guardCostRate ? 0.12 : 0)));
    const isYearEnd = idx === Math.min(result.events.length - 1, toIndex) || result.events[idx + 1]?.date.slice(0, 4) !== event.date.slice(0, 4);
    let taxPaid = 0;
    if (isYearEnd && annualRealizedGain > 0) {
      taxPaid = estimateAnnualTaxKrw(annualRealizedGain);
      portfolioValue = Math.max(0, portfolioValue - taxPaid);
      totalTax += taxPaid;
      annualRealizedGain = 0;
    }
    points.push({
      date: result.curve[idx]?.date || event.date,
      principal,
      portfolioValue,
      benchmarkValue,
      feePaid: totalFees,
      taxPaid: totalTax,
      event,
      monthTaxPaid: taxPaid
    });
  }
  return points;
}

function monthlyRebalanceIndices(rows, start = 504) {
  const indices = [];
  let lastMonth = "";
  for (let i = start; i < rows.length - 2; i += 1) {
    const month = rows[i].date.slice(0, 7);
    if (month === lastMonth) continue;
    lastMonth = month;
    indices.push(i);
  }
  return indices;
}

function nextRebalanceIndex(rows, i) {
  const month = rows[i].date.slice(0, 7);
  let next = i + 1;
  while (next < rows.length - 1 && rows[next].date.slice(0, 7) === month) next += 1;
  return next;
}

function deploymentScore(result) {
  const calmar = result.mdd < 0 ? result.cagr / Math.abs(result.mdd) : result.cagr * 3;
  return result.cagr * 1.1 + calmar * 0.35 + result.winRate * 0.18 + result.beatRate * 0.16 - Math.abs(result.mdd) * 0.45;
}

function compactResultStats(result) {
  return {
    cagr: result.cagr,
    mdd: result.mdd,
    winRate: result.winRate,
    beatRate: result.beatRate,
    score: deploymentScore(result),
    currentWeights: result.current?.weights || {}
  };
}

function applyPerformanceFloorDeployment(researchResult, qldResult, research) {
  const researchScore = deploymentScore(researchResult);
  const qldScore = deploymentScore(qldResult);
  const qldCagrAdvantage = qldResult.cagr - researchResult.cagr;
  const qldDrawdownPenalty = Math.abs(qldResult.mdd) - Math.abs(researchResult.mdd);
  const qldWins =
    qldScore >= researchScore + 0.04 ||
    (qldCagrAdvantage > 0.05 && qldDrawdownPenalty < 0.12) ||
    (qldCagrAdvantage > 0.12 && qldResult.mdd > -0.35);
  const selected = qldWins ? qldResult : researchResult;
  const rejected = qldWins ? researchResult : qldResult;
  const deploymentMode = qldWins ? "qld_alpha_floor" : "research_champion";
  selected.researchApplied = true;
  selected.researchModelId = research?.champion?.modelId || research?.advisory?.championModelId || "";
  selected.deploymentMode = deploymentMode;
  selected.deploymentReason = qldWins
    ? "연구 후보가 Alpha Prime Rotation 성능 하한선을 넘지 못해 Alpha Prime Rotation을 실전 기본값으로 유지했습니다."
    : "연구 후보가 Alpha Prime Rotation 성능 하한선을 통과해 실전 기본값으로 승격됐습니다.";
  selected.researchCandidateStats = compactResultStats(researchResult);
  selected.qldAlphaStats = compactResultStats(qldResult);
  if (qldWins) {
    selected.currentStrategy = {
      key: "mix",
      name: "Alpha Prime Rotation + 연구 성능 게이트",
      components: [{ key: "adaptiveLeverage", name: "Alpha Prime Rotation", weight: 1 }]
    };
    selected.current.components = selected.currentStrategy.components;
    selected.current.guard = {
      ...(selected.current.guard || { level: "clear", label: "주간 감시: 유지", triggers: [], cut: 0 }),
      label: `${selected.current.guard?.label || "주간 감시: 유지"} · 연구 후보 탈락`
    };
  }
  selected.rejectedDeploymentStats = compactResultStats(rejected);
  return selected;
}

function simulateWalkForward(assetMap, benchmarkSymbol = "SPY", research = activeResearchJson()) {
  const spy = assetMap.SPY || assetMap[benchmarkSymbol] || Object.values(assetMap).find((asset) => asset?.rows?.length);
  if (!spy?.rows?.length) throw new Error("계산에 필요한 가격 데이터를 불러오지 못했습니다. 종목을 바꾸거나 잠시 후 다시 시도하세요.");
  spy.vix = assetMap["^VIX"];
  spy.tnx = assetMap["^TNX"];
  const benchmark = assetMap[benchmarkSymbol] || spy;
  const assets = universe.map((s) => assetMap[s]).filter(Boolean);
  const useResearch = Boolean(research?.champion || research?.advisory);
  let equity = 1;
  let benchmarkEquity = 1;
  const curve = [];
  const spyCurve = [];
  const events = [];
  const stats = Object.fromEntries(strategyDefs.map((s) => [s.key, { count: 0, rets: [], worst: 0 }]));
  let lastWeights = {};
  let totalCostRate = 0;

  for (const i of monthlyRebalanceIndices(spy.rows, 252)) {
    const state = marketState(spy, i);
    const pack = useResearch ? weightsForAutonomousResearch(assets, spy, i, research) : weightsForAdaptiveLeverage(assets, spy, i);
    if (!pack.components) pack.components = [{ key: "adaptiveLeverage", name: "Alpha Prime Rotation", weight: 1 }];
    pack.weights = applyRealWorldConstraints(pack.weights, pack.state || state, assetMap, spy.rows[i]?.date);
    const rebalance = chooseCostAwareRebalance(lastWeights, pack.weights, pack.state || state, !Object.keys(lastWeights).length);
    pack.weights = rebalance.weights;
    const nextI = nextRebalanceIndex(spy.rows, i);
    const guardedReturn = monthReturnWithWeeklyGuard(pack, assetMap, assets, spy, i, nextI, benchmark, rebalance.tradeCostRate);
    const r = guardedReturn.nextReturn;
    const sr = guardedReturn.benchmarkReturn;
    equity *= 1 + r;
    benchmarkEquity *= 1 + sr;
    totalCostRate += rebalance.tradeCostRate + (guardedReturn.totalGuardCostRate || 0);
    pack.components.forEach((component) => {
      if (!stats[component.key]) return;
      stats[component.key].count += 1;
      stats[component.key].rets.push(r);
      stats[component.key].worst = Math.min(stats[component.key].worst, r);
    });
    curve.push({ date: spy.rows[nextI].date, equity });
    spyCurve.push({ date: spy.rows[nextI].date, equity: benchmarkEquity });
    events.push({
      date: spy.rows[i].date,
      state: `${pack.state.label} / ${state.label}`,
      strategy: pack.components.map((item) => `${item.name} ${(item.weight * 100).toFixed(0)}%`).join(" + "),
      key: "mix",
      components: pack.components,
      weights: guardedReturn.finalWeights,
      baseWeights: pack.weights,
      turnover: rebalance.turnover,
      tradeCostRate: rebalance.tradeCostRate,
      guardCostRate: guardedReturn.totalGuardCostRate || 0,
      rebalanceSkipped: rebalance.skipped,
      rebalanceReason: rebalance.reason,
      guards: guardedReturn.guards,
      scored: pack.scored,
      nextReturn: r,
      spyReturn: sr,
      equity
    });
    lastWeights = guardedReturn.finalWeights;
  }

  const currentI = spy.rows.length - 1;
  const currentState = marketState(spy, currentI);
  const currentBaseRaw = useResearch ? weightsForAutonomousResearch(assets, spy, currentI, research) : weightsForAdaptiveLeverage(assets, spy, currentI);
  if (!currentBaseRaw.components) currentBaseRaw.components = [{ key: "adaptiveLeverage", name: "Alpha Prime Rotation", weight: 1 }];
  currentBaseRaw.weights = applyRealWorldConstraints(currentBaseRaw.weights, currentBaseRaw.state || currentState, assetMap, spy.rows[currentI]?.date);
  const currentBase = useResearch ? applyResearchAdvisoryCurrent(currentBaseRaw, assetMap, research) : currentBaseRaw;
  currentBase.weights = applyRealWorldConstraints(currentBase.weights, currentBase.state || currentState, assetMap, spy.rows[currentI]?.date);
  const current = applyWeeklyRiskGuard(currentBase, assetMap, assets, spy, currentI);
  current.components = currentBase.components;
  const currentStrategy = {
    key: "mix",
    name: current.components.map((item) => `${item.name} ${(item.weight * 100).toFixed(0)}%`).join(" + "),
    components: current.components
  };
  const years = Math.max(1, curve.length / 12);
  const cagr = curve.at(-1).equity ** (1 / years) - 1;
  const spyCagr = spyCurve.at(-1).equity ** (1 / years) - 1;
  const mdd = maxDrawdown(curve);
  const spyMdd = maxDrawdown(spyCurve);
  const winRate = events.filter((event) => event.nextReturn > 0).length / Math.max(1, events.length);
  const beatRate = events.filter((event) => event.nextReturn >= event.spyReturn).length / Math.max(1, events.length);
  const guardCount = events.reduce((sum, event) => sum + (event.guards?.length || 0), 0);
  const avgAnnualTurnover = events.reduce((sum, event) => sum + (event.turnover || 0), 0) / Math.max(1, curve.length / 12);
  const result = { curve, spyCurve, events, stats, current, currentStrategy, cagr, spyCagr, mdd, spyMdd, winRate, beatRate, guardCount, avgAnnualTurnover, totalCostRate, benchmarkSymbol: benchmark.symbol, state: current.state || currentState, researchApplied: useResearch, researchModelId: research?.champion?.modelId || research?.advisory?.championModelId || "", deploymentMode: useResearch ? "research_champion" : "qld_alpha_rotation" };
  if (useResearch) {
    const qldResult = simulateWalkForward(assetMap, benchmarkSymbol, null);
    return applyPerformanceFloorDeployment(result, qldResult, research);
  }
  return result;
}

function maxDrawdown(curve) {
  let peak = curve[0]?.equity || 1;
  let mdd = 0;
  curve.forEach((p) => {
    peak = Math.max(peak, p.equity);
    mdd = Math.min(mdd, p.equity / peak - 1);
  });
  return mdd;
}

function scenarioReturn(curve, start, end) {
  const a = curve.find((p) => p.date >= start);
  const b = [...curve].reverse().find((p) => p.date <= end);
  return a && b && a.date < b.date ? b.equity / a.equity - 1 : null;
}

function renderChart(result) {
  const c = $("#portfolio-chart");
  const ctx = c.getContext("2d");
  const scale = window.devicePixelRatio || 1;
  const rect = c.getBoundingClientRect();
  c.width = rect.width * scale;
  c.height = rect.height * scale;
  ctx.scale(scale, scale);
  const w = rect.width, h = rect.height, pad = { l: 58, r: 24, t: 18, b: 42 };
  ctx.clearRect(0, 0, w, h);
  const p = result.curve, s = result.spyCurve;
  const all = [...p.map((x) => x.equity), ...s.map((x) => x.equity)];
  const min = Math.min(...all), max = Math.max(...all);
  const x = (i) => pad.l + i / Math.max(1, p.length - 1) * (w - pad.l - pad.r);
  const y = (v) => h - pad.b - (v - min) / Math.max(0.001, max - min) * (h - pad.t - pad.b);
  ctx.strokeStyle = "#d8ded8";
  ctx.fillStyle = "#66736c";
  ctx.font = "11px Segoe UI";
  for (let g = 0; g < 5; g += 1) {
    const yy = pad.t + g / 4 * (h - pad.t - pad.b);
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(w - pad.r, yy); ctx.stroke();
    const value = max - g / 4 * (max - min);
    ctx.fillText(value.toFixed(2), 8, yy + 4);
  }
  const tickCount = Math.min(6, p.length);
  for (let t = 0; t < tickCount; t += 1) {
    const idx = Math.round(t / Math.max(1, tickCount - 1) * (p.length - 1));
    const xx = x(idx);
    ctx.strokeStyle = "#eef1ee";
    ctx.beginPath(); ctx.moveTo(xx, pad.t); ctx.lineTo(xx, h - pad.b); ctx.stroke();
    ctx.fillStyle = "#66736c";
    ctx.fillText(p[idx].date.slice(0, 7), xx - 20, h - 14);
  }
  const line = (arr, color, width) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
    arr.forEach((pt, i) => i ? ctx.lineTo(x(i), y(pt.equity)) : ctx.moveTo(x(i), y(pt.equity)));
    ctx.stroke();
  };
  line(s, "#17201c", 1.6);
  line(p, "#3267b7", 2.6);
  ctx.font = "12px Segoe UI";
  ctx.fillStyle = "#3267b7"; ctx.fillText("워크포워드 포트폴리오", pad.l + 8, pad.t + 14);
  ctx.fillStyle = "#17201c"; ctx.fillText(result.benchmarkSymbol || "SPY", pad.l + 8, pad.t + 34);
}

function chartLabel(dateIso, frame) {
  const d = new Date(dateIso);
  if (["5m", "1h"].includes(frame)) return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return dateIso.slice(0, 10);
}

function renderStockChart() {
  const c = $("#stock-chart");
  if (!c || !chartState.rows.length) return;
  const rows = chartState.rows.filter((row) => Number.isFinite(row.close));
  const ind = indicators(rows);
  const active = chartState.indicators;
  const ctx = c.getContext("2d");
  const rect = c.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  c.width = rect.width * scale;
  c.height = rect.height * scale;
  ctx.scale(scale, scale);
  const w = rect.width;
  const h = rect.height;
  const subCount = ["mfi", "rsi", "macd", "atr"].filter((key) => active.has(key)).length;
  const mainH = Math.max(250, h - (active.has("volume") ? 70 : 0) - subCount * 70 - 30);
  const pad = { l: 58, r: 22, t: 18, b: 28 };
  const priceVals = rows.flatMap((row) => [row.high, row.low]);
  ["sma20", "sma50", "sma200"].forEach((key) => {
    if (!active.has(key)) return;
    const n = Number(key.replace("sma", ""));
    priceVals.push(...rolling(rows.map((row) => row.close), n).filter(Number.isFinite));
  });
  if (active.has("bollinger")) {
    const closes = rows.map((row) => row.close);
    const mid = rolling(closes, 20);
    const sd = closes.map((_, i) => i + 1 < 20 ? null : stdev(closes.slice(i - 19, i + 1)));
    mid.forEach((m, i) => {
      if (Number.isFinite(m) && Number.isFinite(sd[i])) {
        priceVals.push(m + sd[i] * 2, m - sd[i] * 2);
      }
    });
  }
  const min = Math.min(...priceVals);
  const max = Math.max(...priceVals);
  const x = (i) => pad.l + i / Math.max(1, rows.length - 1) * (w - pad.l - pad.r);
  const y = (v) => pad.t + (max - v) / Math.max(0.001, max - min) * (mainH - pad.t - pad.b);
  ctx.clearRect(0, 0, w, h);
  ctx.font = "11px Segoe UI";
  ctx.strokeStyle = "#edf0f5";
  ctx.fillStyle = "#7d8794";
  for (let g = 0; g < 5; g += 1) {
    const yy = pad.t + g / 4 * (mainH - pad.t - pad.b);
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(w - pad.r, yy); ctx.stroke();
    ctx.fillText((max - g / 4 * (max - min)).toFixed(2), 8, yy + 4);
  }
  const tickCount = Math.min(7, rows.length);
  for (let t = 0; t < tickCount; t += 1) {
    const idx = Math.round(t / Math.max(1, tickCount - 1) * (rows.length - 1));
    const xx = x(idx);
    ctx.strokeStyle = "#f1f3f7";
    ctx.beginPath(); ctx.moveTo(xx, pad.t); ctx.lineTo(xx, mainH - pad.b); ctx.stroke();
    ctx.fillStyle = "#7d8794";
    ctx.fillText(chartLabel(rows[idx].date, chartState.frame), Math.min(w - 92, Math.max(8, xx - 34)), mainH - 8);
  }
  if (chartState.type === "candle") {
    const bodyW = Math.max(2, Math.min(9, (w - pad.l - pad.r) / rows.length * 0.6));
    rows.forEach((row, i) => {
      const xx = x(i);
      const up = row.close >= row.open;
      ctx.strokeStyle = up ? "#0a9f6a" : "#e04444";
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.moveTo(xx, y(row.high)); ctx.lineTo(xx, y(row.low)); ctx.stroke();
      const top = y(Math.max(row.open, row.close));
      const bot = y(Math.min(row.open, row.close));
      ctx.fillRect(xx - bodyW / 2, top, bodyW, Math.max(1, bot - top));
    });
  } else {
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    rows.forEach((row, i) => i ? ctx.lineTo(x(i), y(row.close)) : ctx.moveTo(x(i), y(row.close)));
    ctx.stroke();
  }
  const drawLine = (values, color, width = 1.5) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    values.forEach((value, i) => {
      if (!Number.isFinite(value)) return;
      i ? ctx.lineTo(x(i), y(value)) : ctx.moveTo(x(i), y(value));
    });
    ctx.stroke();
  };
  if (active.has("sma20")) drawLine(ind.sma20, "#f59e0b");
  if (active.has("sma50")) drawLine(ind.sma50, "#8b5cf6");
  if (active.has("sma200")) drawLine(ind.sma200, "#111827", 1.2);
  if (active.has("bollinger")) {
    const mid = ind.sma20;
    const closes = rows.map((row) => row.close);
    const sd = closes.map((_, i) => i + 1 < 20 ? null : stdev(closes.slice(i - 19, i + 1)));
    drawLine(mid.map((m, i) => Number.isFinite(m) && Number.isFinite(sd[i]) ? m + sd[i] * 2 : null), "#94a3b8", 1);
    drawLine(mid.map((m, i) => Number.isFinite(m) && Number.isFinite(sd[i]) ? m - sd[i] * 2 : null), "#94a3b8", 1);
  }
  let offset = mainH;
  if (active.has("volume")) {
    const volH = 62;
    const maxVol = Math.max(...rows.map((row) => row.volume || 0), 1);
    rows.forEach((row, i) => {
      ctx.fillStyle = row.close >= row.open ? "rgba(10,159,106,.34)" : "rgba(224,68,68,.34)";
      const bar = (row.volume || 0) / maxVol * (volH - 8);
      ctx.fillRect(x(i) - 2, offset + volH - bar, 4, bar);
    });
    ctx.fillStyle = "#7d8794";
    ctx.fillText("거래량", 8, offset + 16);
    offset += volH + 8;
  }
  const subPanel = (name, values, lo, hi, color) => {
    const panelH = 66;
    const top = offset;
    ctx.strokeStyle = "#edf0f5";
    ctx.strokeRect(pad.l, top, w - pad.l - pad.r, panelH - 8);
    ctx.fillStyle = "#7d8794";
    ctx.fillText(name, 8, top + 18);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    values.forEach((value, i) => {
      if (!Number.isFinite(value)) return;
      const yy = top + 5 + (hi - value) / Math.max(0.001, hi - lo) * (panelH - 18);
      i ? ctx.lineTo(x(i), yy) : ctx.moveTo(x(i), yy);
    });
    ctx.stroke();
    offset += panelH;
  };
  if (active.has("mfi")) subPanel("MFI", ind.mfi14, 0, 100, "#0a9f6a");
  if (active.has("rsi")) subPanel("RSI", ind.rsi14, 0, 100, "#2563eb");
  if (active.has("macd")) subPanel("MACD", ind.macd.map((v, i) => v - ind.macdSignal[i]), Math.min(...ind.macd.filter(Number.isFinite), -1), Math.max(...ind.macd.filter(Number.isFinite), 1), "#8b5cf6");
  if (active.has("atr")) subPanel("ATR%", ind.atr.map((v, i) => rows[i]?.close ? v / rows[i].close * 100 : null), 0, Math.max(1, ...ind.atr.map((v, i) => rows[i]?.close ? v / rows[i].close * 100 : 0)), "#f59e0b");
  ctx.fillStyle = "#111827";
  ctx.font = "12px Segoe UI";
  ctx.fillText(`${chartState.symbol} · ${chartState.frame} · ${chartState.type === "candle" ? "캔들" : "라인"}`, pad.l + 8, pad.t + 14);
}

async function refreshStockChart(symbol = $("#symbol")?.value || "QQQ") {
  const payload = await fetchChartRows(symbol, chartState.frame);
  chartState.symbol = String(symbol || payload.symbol || "QQQ").toUpperCase();
  chartState.rows = payload.rows;
  renderStockChart();
}

function metricCard(label, value, tone = "") {
  return `<div class="metric-card ${tone}"><span class="label">${label}</span><strong>${value}</strong></div>`;
}

function eventIndexOnOrAfter(result, date) {
  const index = result.events.findIndex((event) => event.date >= date);
  return index < 0 ? 0 : index;
}

function eventIndexOnOrBefore(result, date) {
  const index = result.events.findIndex((event) => event.date > date);
  return index < 0 ? result.events.length - 1 : Math.max(0, index - 1);
}

function summarizeEvents(events) {
  if (!events.length) return { count: 0, cagr: 0, win: 0, beat: 0, mdd: 0, worst: 0 };
  const returns = events.map((event) => event.nextReturn);
  const bench = events.map((event) => event.spyReturn);
  const equity = returns.reduce((value, r) => value * (1 + r), 1);
  return {
    count: events.length,
    cagr: equity ** (12 / events.length) - 1,
    win: returns.filter((r) => r > 0).length / events.length,
    beat: returns.filter((r, i) => r >= bench[i]).length / events.length,
    mdd: returnsDrawdown(returns),
    worst: Math.min(...returns)
  };
}

function renderValidationSummary(result) {
  const recent = result.events.slice(-24);
  const riskOn = result.events.filter((event) => event.state.includes("risk-on") || event.state.includes("상승"));
  const defense = result.events.filter((event) => event.state.includes("Capital defense") || event.state.includes("방어"));
  const guarded = result.events.filter((event) => event.guards?.length);
  const groups = [
    ["전체 워크포워드", summarizeEvents(result.events)],
    ["최근 24개월", summarizeEvents(recent)],
    ["상승장 샘플", summarizeEvents(riskOn)],
    ["방어/변동성 샘플", summarizeEvents(defense)],
    ["주간 감시 발동 월", summarizeEvents(guarded)]
  ];  $("#validation-summary").innerHTML = groups.map(([name, stat]) => `
    <div class="validation-card">
      <strong>${name}</strong>
      <span>표본 ${stat.count}개월</span>
      <span>연복리 ${fmtPct(stat.cagr)} · 승률 ${fmtPct(stat.win)}</span>
      <span>초과율 ${fmtPct(stat.beat)} · MDD ${fmtPct(stat.mdd)}</span>
      <span>최악월 ${fmtPct(stat.worst)}</span>
    </div>`).join("");
}

function ensureResearchPanel() {
  const lab = $("#view-lab");
  if (!lab || $("#research-report-panel")) return;
  const panel = document.createElement("section");
  panel.id = "research-report-panel";
  panel.className = "portfolio-panel";
  panel.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>자율 연구 엔진</h2>
        <p class="muted">REPORT.md와 RESEARCH_SPEC.md 기준으로 생성된 챔피언/챌린저 연구 결과입니다.</p>
      </div>
      <div class="button-row">
        <button id="refresh-research-report" type="button">연구 리포트 갱신</button>
      </div>
    </div>
    <div id="research-summary" class="portfolio-summary"></div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>모델</th>
            <th>상태</th>
            <th>점수</th>
            <th>CAGR</th>
            <th>MDD</th>
            <th>Walk-forward</th>
            <th>사유</th>
          </tr>
        </thead>
        <tbody id="research-model-table"></tbody>
      </table>
    </div>
    <pre id="research-latest-md" class="research-md"></pre>`;
  lab.appendChild(panel);
  $("#refresh-research-report")?.addEventListener("click", () => renderResearchLatest());
}

async function renderResearchLatest() {
  ensureResearchPanel();
  const summary = $("#research-summary");
  const table = $("#research-model-table");
  const markdown = $("#research-latest-md");
  if (!summary || !table) return;
  try {
    const payload = await fetchResearchLatest(true);
    if (!payload?.available) {
      summary.innerHTML = metricCard("상태", "리포트 없음", "warning") + metricCard("실행", "npm.cmd run research");
      table.innerHTML = `<tr><td colspan="7" class="muted">${payload?.message || "연구 리포트를 아직 불러오지 못했습니다."}</td></tr>`;
      if (markdown) markdown.textContent = "";
      return;
    }
    const champion = payload.json.champion;
    const advisory = payload.json.advisory;
    const deployment = appState?.result?.deploymentMode === "qld_alpha_floor" ? "Alpha Prime 운용" : appState?.result?.deploymentMode === "research_champion" ? "연구 챔피언 운용" : "검토 대기";
    summary.innerHTML = [
      metricCard("챔피언", champion.modelId, "primary"),
      metricCard("앱 운용", deployment, appState?.result?.deploymentMode === "qld_alpha_floor" ? "warning" : "success"),
      metricCard("위험 상태", advisory.riskState),
      metricCard("CAGR", fmtPct(champion.metrics.cagr), champion.metrics.cagr >= 0 ? "success" : "warning"),
      metricCard("MDD", fmtPct(champion.metrics.mdd), "warning"),
      metricCard("다음 리밸런싱", advisory.nextRebalanceDate),
      metricCard("테스트", `${payload.json.tests.filter((test) => test.pass).length}/${payload.json.tests.length}`)
    ].join("");
    table.innerHTML = payload.json.registry.models.map((model) => `
      <tr class="${model.status === "champion" ? "replay-win" : model.status === "accepted" ? "replay-defense" : "replay-loss"}">
        <td><strong>${model.modelId}</strong></td>
        <td>${model.status}</td>
        <td>${model.review.score.toFixed(3)}</td>
        <td>${fmtPct(model.metrics.cagr || 0)}</td>
        <td>${fmtPct(model.metrics.mdd || 0)}</td>
        <td>${fmtPct(model.walkForward.passRate || 0)}</td>
        <td>${model.review.hardFailures?.join(", ") || "passed"}</td>
      </tr>`).join("");
    if (markdown) markdown.textContent = payload.markdown || "";
  } catch (error) {
    summary.innerHTML = metricCard("오류", error.message, "warning");
    table.innerHTML = `<tr><td colspan="7" class="muted">연구 리포트를 불러오지 못했습니다.</td></tr>`;
  }
}

function renderReplayChart(result, dcaReplay) {
  const c = $("#replay-chart");
  if (!c || !dcaReplay.length) return;
  const ctx = c.getContext("2d");
  const rect = c.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  c.width = rect.width * scale;
  c.height = rect.height * scale;
  ctx.scale(scale, scale);
  const w = rect.width, h = rect.height, pad = { l: 74, r: 24, t: 18, b: 42 };
  const values = dcaReplay.flatMap((p) => [p.principal, p.portfolioValue, p.benchmarkValue]);
  const min = Math.min(...values) * 0.96;
  const max = Math.max(...values) * 1.04;
  const x = (i) => pad.l + i / Math.max(1, dcaReplay.length - 1) * (w - pad.l - pad.r);
  const y = (v) => h - pad.b - (v - min) / Math.max(1, max - min) * (h - pad.t - pad.b);
  ctx.clearRect(0, 0, w, h);
  ctx.font = "11px Segoe UI";
  ctx.strokeStyle = "#e2e7e3";
  ctx.fillStyle = "#66736c";
  for (let g = 0; g < 5; g += 1) {
    const yy = pad.t + g / 4 * (h - pad.t - pad.b);
    const value = max - g / 4 * (max - min);
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(w - pad.r, yy); ctx.stroke();
    ctx.fillText(fmtMoney(value), 8, yy + 4);
  }
  const tickCount = Math.min(7, dcaReplay.length);
  for (let t = 0; t < tickCount; t += 1) {
    const idx = Math.round(t / Math.max(1, tickCount - 1) * (dcaReplay.length - 1));
    const xx = x(idx);
    ctx.strokeStyle = "#f0f2f0";
    ctx.beginPath(); ctx.moveTo(xx, pad.t); ctx.lineTo(xx, h - pad.b); ctx.stroke();
    ctx.fillStyle = "#66736c";
    ctx.fillText(dcaReplay[idx].date.slice(0, 7), xx - 20, h - 14);
  }
  const draw = (key, color, width) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
    dcaReplay.forEach((pt, i) => i ? ctx.lineTo(x(i), y(pt[key])) : ctx.moveTo(x(i), y(pt[key])));
    ctx.stroke();
  };
  draw("principal", "#9aa39d", 1.6);
  draw("benchmarkValue", "#17201c", 2);
  draw("portfolioValue", "#3267b7", 2.8);
  dcaReplay.forEach((pt, i) => {
    if (i % 3 !== 0 && i !== dcaReplay.length - 1) return;
    ctx.fillStyle = pt.event.nextReturn >= pt.event.spyReturn ? "#1f8a5b" : "#c74b4b";
    ctx.beginPath(); ctx.arc(x(i), y(pt.portfolioValue), 3.5, 0, Math.PI * 2); ctx.fill();
  });
  ctx.fillStyle = "#3267b7"; ctx.fillText("전략", pad.l + 8, pad.t + 14);
  ctx.fillStyle = "#17201c"; ctx.fillText(result.benchmarkSymbol || "SPY", pad.l + 58, pad.t + 14);
  ctx.fillStyle = "#66736c"; ctx.fillText("원금", pad.l + 112, pad.t + 14);
}

function ensureReplayDetailLayout() {
  const view = $("#view-replay .portfolio-panel");
  if (!view || $("#replay-month-detail")) return;
  const table = view.querySelector(".table-scroll");
  const detail = document.createElement("section");
  detail.id = "replay-month-detail";
  detail.className = "replay-month-detail";
  detail.innerHTML = `
    <div class="panel-head compact-head">
      <div>
        <h3>선택 월 상세 리플레이</h3>
        <p class="muted">월을 선택하면 그 기간의 지수 흐름, 전략 자본 변화, 월중 감산/재진입 알림을 함께 표시합니다.</p>
      </div>
    </div>
    <div id="replay-month-summary" class="replay-metrics"></div>
    <canvas id="replay-month-chart" width="1200" height="340"></canvas>
    <div class="table-scroll compact-table">
      <table>
        <thead>
          <tr>
            <th>발생일</th>
            <th>리스크 조정</th>
            <th>조정 규모</th>
            <th>트리거</th>
            <th>조정 후 상위 비중</th>
          </tr>
        </thead>
        <tbody id="replay-risk-alerts"></tbody>
      </table>
    </div>`;
  view.insertBefore(detail, table);
}

function rowOnOrBefore(asset, date) {
  const rows = asset?.rows || [];
  let lo = 0, hi = rows.length - 1, ans = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (rows[mid].date <= date) {
      ans = rows[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function monthStartCapital(result, index, initialAmount, monthlyContribution) {
  const prior = index > 0 ? buildDcaReplay(result, initialAmount, monthlyContribution, 0, index - 1).at(-1) : null;
  const portfolioValue = prior?.portfolioValue ?? initialAmount;
  const benchmarkValue = prior?.benchmarkValue ?? initialAmount;
  const principal = prior?.principal ?? initialAmount;
  const buyFee = monthlyContribution * buyOnlyCostRate();
  return {
    principal: principal + monthlyContribution,
    portfolioValue: portfolioValue + monthlyContribution - buyFee,
    benchmarkValue: benchmarkValue + monthlyContribution - buyFee
  };
}

function topWeightsText(weights, limit = 4) {
  const items = Object.entries(weights || {})
    .filter(([, weight]) => weight > 0.003)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([symbol, weight]) => `${symbol} ${(weight * 100).toFixed(0)}%`);
  return items.join(", ") || "현금 대기";
}

function buildReplayMonthPoints(result, index) {
  const assets = appState?.assets || {};
  const event = result.events[index];
  const benchSymbol = result.benchmarkSymbol || "SPY";
  const benchAsset = assets[benchSymbol] || assets.SPY || Object.values(assets).find((asset) => asset?.rows?.length);
  if (!event || !benchAsset) return [];
  const endDate = result.events[index + 1]?.date || benchAsset.rows.at(-1)?.date || event.date;
  const rows = benchAsset.rows.filter((row) => row.date >= event.date && row.date <= endDate);
  if (!rows.length) return [];
  const amount = numberValue("#capital", 10000000);
  const monthly = numberValue("#monthly-contribution", 1000000);
  const start = monthStartCapital(result, index, amount, monthly);
  const guards = [...(event.guards || [])].sort((a, b) => a.date.localeCompare(b.date));
  let weights = event.baseWeights || event.weights || {};
  let guardCursor = 0;
  let portfolioValue = start.portfolioValue;
  let benchmarkValue = start.benchmarkValue;
  const points = [{
    date: rows[0].date,
    portfolioValue,
    benchmarkValue,
    principal: start.principal,
    portfolioReturn: 0,
    benchmarkReturn: 0,
    weights
  }];
  for (let i = 1; i < rows.length; i += 1) {
    const date = rows[i].date;
    while (guardCursor < guards.length && guards[guardCursor].date <= date) {
      weights = guards[guardCursor].weights || weights;
      if (guards[guardCursor].costRate) portfolioValue *= Math.max(0.0001, 1 - guards[guardCursor].costRate);
      guardCursor += 1;
    }
    const prevDate = rows[i - 1].date;
    const dailyReturn = Object.entries(weights).reduce((sum, [symbol, weight]) => {
      const asset = assets[symbol];
      const prev = rowOnOrBefore(asset, prevDate);
      const now = rowOnOrBefore(asset, date);
      if (!prev?.close || !now?.close) return sum;
      return sum + weight * (now.close / prev.close - 1);
    }, 0);
    portfolioValue *= 1 + dailyReturn;
    benchmarkValue *= rows[i].close / rows[i - 1].close;
    points.push({
      date,
      portfolioValue,
      benchmarkValue,
      principal: start.principal,
      portfolioReturn: portfolioValue / start.portfolioValue - 1,
      benchmarkReturn: benchmarkValue / start.benchmarkValue - 1,
      weights
    });
  }
  return points;
}

function drawReplayMonthChart(points, guards = [], benchmarkSymbol = "SPY") {
  const c = $("#replay-month-chart");
  if (!c || !points.length) return;
  const ctx = c.getContext("2d");
  const rect = c.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  c.width = rect.width * scale;
  c.height = rect.height * scale;
  ctx.scale(scale, scale);
  const w = rect.width, h = rect.height, pad = { l: 76, r: 28, t: 24, b: 46 };
  const values = points.flatMap((point) => [point.portfolioValue, point.benchmarkValue, point.principal]);
  const min = Math.min(...values) * 0.985;
  const max = Math.max(...values) * 1.015;
  const x = (i) => pad.l + i / Math.max(1, points.length - 1) * (w - pad.l - pad.r);
  const y = (v) => h - pad.b - (v - min) / Math.max(1, max - min) * (h - pad.t - pad.b);
  ctx.clearRect(0, 0, w, h);
  ctx.font = "11px Segoe UI";
  ctx.strokeStyle = "#e3e9e5";
  ctx.fillStyle = "#69756e";
  for (let g = 0; g < 5; g += 1) {
    const yy = pad.t + g / 4 * (h - pad.t - pad.b);
    const value = max - g / 4 * (max - min);
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(w - pad.r, yy); ctx.stroke();
    ctx.fillText(fmtMoney(value), 8, yy + 4);
  }
  const tickCount = Math.min(6, points.length);
  for (let t = 0; t < tickCount; t += 1) {
    const idx = Math.round(t / Math.max(1, tickCount - 1) * (points.length - 1));
    const xx = x(idx);
    ctx.strokeStyle = "#f2f4f2";
    ctx.beginPath(); ctx.moveTo(xx, pad.t); ctx.lineTo(xx, h - pad.b); ctx.stroke();
    ctx.fillStyle = "#69756e";
    ctx.fillText(points[idx].date.slice(5), xx - 14, h - 16);
  }
  const draw = (key, color, width) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
    points.forEach((point, i) => i ? ctx.lineTo(x(i), y(point[key])) : ctx.moveTo(x(i), y(point[key])));
    ctx.stroke();
  };
  draw("principal", "#9aa39d", 1.4);
  draw("benchmarkValue", "#111827", 2);
  draw("portfolioValue", "#2563eb", 2.8);
  guards.forEach((guard, idx) => {
    const pointIndex = Math.max(0, points.findIndex((point) => point.date >= guard.date));
    if (pointIndex < 0) return;
    const xx = x(pointIndex);
    const yy = y(points[pointIndex].portfolioValue);
    ctx.fillStyle = guard.cut >= 0.2 ? "#c2410c" : "#d97706";
    ctx.beginPath(); ctx.arc(xx, yy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillText(`${idx + 1}`, xx + 7, yy - 7);
  });
  ctx.fillStyle = "#2563eb"; ctx.fillText("전략 자본", pad.l + 8, pad.t - 6);
  ctx.fillStyle = "#111827"; ctx.fillText(benchmarkSymbol, pad.l + 76, pad.t - 6);
  ctx.fillStyle = "#9aa39d"; ctx.fillText("월 투입 원금", pad.l + 126, pad.t - 6);
}

function renderReplayMonthDetail(result, index) {
  ensureReplayDetailLayout();
  const event = result.events[index];
  if (!event) return;
  const bench = result.benchmarkSymbol || "SPY";
  const points = buildReplayMonthPoints(result, index);
  const last = points.at(-1);
  const guardRows = event.guards || [];
  $("#replay-month-summary").innerHTML = [
    metricCard("선택 월", event.date.slice(0, 7)),
    metricCard("예측 국면", event.state),
    metricCard("전략 월 수익", last ? fmtPct(last.portfolioReturn) : fmtPct(event.nextReturn), event.nextReturn >= 0 ? "success" : "warning"),
    metricCard(`${bench} 월 수익`, last ? fmtPct(last.benchmarkReturn) : fmtPct(event.spyReturn)),
    metricCard("월초 턴오버/비용", `${((event.turnover || 0) * 100).toFixed(1)}% / ${((event.tradeCostRate || 0) * 100).toFixed(2)}%`, event.rebalanceSkipped ? "success" : "neutral"),
    metricCard("월중 알림", `${guardRows.length}회`, guardRows.length ? "warning" : "success"),
    metricCard("최종 상위 비중", topWeightsText((guardRows.at(-1)?.weights || event.weights), 3), "primary")
  ].join("");
  $("#replay-risk-alerts").innerHTML = guardRows.length ? guardRows.map((guard) => `
    <tr class="${guard.cut >= 0.2 ? "alert-hot" : "alert-watch"}">
      <td>${guard.date}</td>
      <td><strong>${guard.label}</strong></td>
      <td>${fmtPct(guard.cut || 0)} 감산${guard.costRate ? ` · 비용 ${fmtPct(guard.costRate)}` : ""}</td>
      <td>${(guard.triggers || []).join(", ") || "월중 위험 신호"}</td>
      <td>${topWeightsText(guard.weights)}</td>
    </tr>`).join("") : `<tr><td colspan="5" class="muted">이 월에는 월중 리스크 조정 알림이 없었습니다.</td></tr>`;
  drawReplayMonthChart(points, guardRows, bench);
}

function renderContributionPlan(assetMap, result) {
  const plan = buildContributionPlan(assetMap, result);
  const cashTarget = plan.total * (1 - plan.invested);
  $("#contribution-summary").innerHTML = `
    <div><span class="label">기존 투자금</span><strong>${fmtMoney(plan.existing)}</strong></div>
    <div><span class="label">월 추가금</span><strong>${fmtMoney(plan.monthly)}</strong></div>
    <div><span class="label">목표 투자 비중</span><strong>${(plan.invested * 100).toFixed(0)}%</strong></div>
    <div><span class="label">이번 달 매수</span><strong>${fmtMoney(plan.buyTotal)}</strong></div>
    <div><span class="label">매도/현금</span><strong>${fmtMoney(plan.sellTotal + cashTarget)}</strong></div>`;
  $("#contribution-table").innerHTML = plan.rows.map((row) => {
    const cls = row.delta >= 0 ? "up" : "down";
    const signal = row.signal ? `MFI ${row.signal.mfiNow.toFixed(0)} · RSI ${row.signal.rsiNow.toFixed(0)} · ${row.signal.macdOk ? "MACD+" : "MACD-"}` : "-";
    return `<tr><td><strong>${row.symbol}</strong></td><td>${(row.currentWeight * 100).toFixed(1)}%</td><td>${(row.targetWeight * 100).toFixed(1)}%</td><td>${fmtMoney(row.currentValue)}</td><td>${fmtMoney(row.targetValue)}</td><td class="${cls}">${row.action} ${fmtMoney(Math.abs(row.delta))}</td><td>${signal}<br><span class="muted">${row.signal?.verdict || ""}</span></td></tr>`;
  }).join("");
}

function setLiveStatus(text) {
  if ($("#live-status")) $("#live-status").textContent = text;
}

function notifyLiveAlerts(alerts) {
  if (!liveAlertTimer || !("Notification" in window) || Notification.permission !== "granted") return;
  const seen = new Set(JSON.parse(localStorage.getItem("fund-manager-live-alerts") || "[]"));
  let changed = false;
  alerts.forEach((alert) => {
    const key = [alert.date, alert.kind, alert.title, Math.round(alert.amount)].join("|");
    if (seen.has(key)) return;
    new Notification(`Fund Manager ${alert.title}`, {
      body: `${alert.symbols} · ${fmtMoney(alert.amount)} · ${alert.reason}`
    });
    addNotification("리스크 알림", `${alert.title} · ${alert.symbols} · ${fmtMoney(alert.amount)}`, "발송");
    seen.add(key);
    changed = true;
  });
  if (changed) localStorage.setItem("fund-manager-live-alerts", JSON.stringify([...seen].slice(-80)));
}

function renderLiveManager(assetMap, result) {
  if (!$("#live-rebalance-table")) return;
  const plan = buildLiveRebalancePlan(assetMap, result);
  const alerts = buildLiveAlerts(assetMap, result);
  const hasPortfolio = plan.existing > 0;
  $("#live-summary").innerHTML = `
    <div><span class="label">실제 총자산</span><strong>${fmtMoney(plan.existing)}</strong></div>
    <div><span class="label">월 추가금</span><strong>${fmtMoney(plan.monthly)}</strong></div>
    <div><span class="label">월간 매수</span><strong>${fmtMoney(plan.buys)}</strong></div>
    <div><span class="label">월간 매도</span><strong>${fmtMoney(plan.sells)}</strong></div>
    <div><span class="label">목표 현금</span><strong>${fmtMoney(plan.targetCash)}</strong></div>`;
  $("#live-rebalance-table").innerHTML = hasPortfolio ? plan.rows.map((row) => {
    const cls = row.delta >= 0 ? "up" : "down";
    return `<tr><td><strong>${row.symbol}</strong></td><td>${row.quantity ? row.quantity.toFixed(4).replace(/\.?0+$/, "") : "-"}</td><td>${fmtMoney(row.currentValue)}</td><td>${fmtPct(row.currentWeight)}</td><td>${fmtPct(row.targetWeight)}</td><td class="${cls}">${row.action} ${fmtMoney(Math.abs(row.delta))}</td></tr>`;
  }).join("") : `<tr><td colspan="6" class="muted">저장된 보유내역이 없습니다.</td></tr>`;
  $("#live-alert-summary").innerHTML = `
    <div><span class="label">감시 기준일</span><strong>${livePortfolio.baselineDate || "-"}</strong></div>
    <div><span class="label">기준 평가액</span><strong>${fmtMoney(livePortfolio.baselineValue || 0)}</strong></div>
    <div><span class="label">월중 손익</span><strong class="${(alerts.baselineLoss || 0) >= 0 ? "up" : "down"}">${alerts.baselineLoss == null ? "-" : fmtPct(alerts.baselineLoss)}</strong></div>
    <div><span class="label">위험자산 비중</span><strong>${fmtPct(alerts.holdingRisk)}</strong></div>
    <div><span class="label">현재 알람</span><strong>${alerts.alerts.length}</strong></div>`;
  $("#live-alert-table").innerHTML = alerts.alerts.length ? alerts.alerts.map((alert) => `
    <tr class="${alert.rowClass}">
      <td>${alert.date}</td>
      <td><strong>${alert.title}</strong></td>
      <td>${alert.symbols}</td>
      <td>${fmtMoney(alert.amount)}</td>
      <td>${alert.reason}</td>
    </tr>`).join("") : `<tr><td colspan="5" class="muted">현재 발동된 월중 알람이 없습니다.</td></tr>`;
  notifyLiveAlerts(alerts.alerts);
}

function renderIndicatorTable(assetMap, result) {
  $("#indicator-table").innerHTML = Object.entries(result.current.weights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([symbol, weight]) => {
      const asset = assetMap[symbol];
      if (!asset) return "";
      const signal = indicatorSignal(asset, asset.rows.length - 1);
      return `<tr><td><strong>${symbol}</strong> <span class="muted">${(weight * 100).toFixed(1)}%</span></td><td>${signal.mfiNow.toFixed(0)} · ${signal.flow}</td><td>${signal.rsiNow.toFixed(0)}</td><td>${signal.macdOk ? "상승" : "둔화"}</td><td>${(signal.atrPct * 100).toFixed(1)}%</td><td>${signal.verdict}</td></tr>`;
    }).join("");
}

function renderReplayTable(result, startIndex = 0, endIndex = result.events.length - 1) {
  const table = $("#replay-table");
  if (!table || !result.events.length) return;
  const amount = numberValue("#capital", 10000000);
  const monthly = numberValue("#monthly-contribution", 1000000);
  const bench = result.benchmarkSymbol || "SPY";
  const from = clamp(Math.min(startIndex, endIndex), 0, result.events.length - 1);
  const to = clamp(Math.max(startIndex, endIndex), 0, result.events.length - 1);
  const dca = buildDcaReplay(result, amount, monthly, from, to);
  const dcaByIndex = new Map(dca.map((point, offset) => [from + offset, point]));
  table.innerHTML = result.events.slice(from, to + 1).map((event, offset) => {
    const eventIndex = from + offset;
    const dcaPoint = dcaByIndex.get(eventIndex);
    const top = Object.entries(event.weights).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([s, w]) => `${s} ${(w * 100).toFixed(0)}%`).join(", ");
    const costTrail = event.rebalanceSkipped
      ? `<br><span class="muted">거래비용 절감: ${event.rebalanceReason}</span>`
      : `<br><span class="muted">턴오버 ${(event.turnover * 100).toFixed(1)}% · 비용 ${(event.tradeCostRate * 100).toFixed(2)}%</span>`;
    const guardTrail = event.guards?.length ? `<br><span class="muted">${event.guards.map((g) => `${g.date} ${g.label}${g.costRate ? ` 비용 ${(g.costRate * 100).toFixed(2)}%` : ""}`).join(" / ")}</span>` : "";
    const verdict = event.nextReturn >= event.spyReturn ? `${bench} 초과` : `${bench} 미달`;
    const investedRow = Object.values(event.weights).reduce((sum, weight) => sum + weight, 0);
    const rowClass = investedRow < 0.08 ? "replay-cash" : event.nextReturn >= event.spyReturn && event.nextReturn >= 0 ? "replay-win" : event.nextReturn >= event.spyReturn ? "replay-defense" : "replay-loss";
    return `<tr class="${rowClass}" data-event-index="${eventIndex}" title="이 행의 월간 리플레이를 차트에 표시"><td>${event.date}</td><td>${event.state}${costTrail}${guardTrail}</td><td>${event.strategy}</td><td>${top || "현금"}</td><td>${fmtMoney(dcaPoint?.principal || 0)}</td><td>${fmtMoney(dcaPoint?.portfolioValue || 0)}</td><td class="${event.nextReturn >= 0 ? "up" : "down"}">${fmtPct(event.nextReturn)}</td><td class="${event.spyReturn >= 0 ? "up" : "down"}">${fmtPct(event.spyReturn)}</td><td>${verdict}</td></tr>`;
  }).reverse().join("");
  document.querySelectorAll("#replay-table tr[data-event-index]").forEach((row) => {
    row.addEventListener("click", () => selectReplayPeriod(Number(row.dataset.eventIndex)));
  });
}

function renderStockHeader(assetMap, result, selectedSymbol) {
  const asset = assetMap[selectedSymbol] || assetMap[result.benchmarkSymbol] || assetMap.SPY;
  if (!asset?.rows?.length) return;
  const rows = asset.rows;
  const last = rows.at(-1);
  const prev = rows.at(-2) || last;
  const change = last.close - prev.close;
  const changeRate = prev.close ? change / prev.close : 0;
  const signal = indicatorSignal(asset, rows.length - 1);
  if ($("#stock-hero-name")) $("#stock-hero-name").textContent = asset.symbol;
  if ($("#stock-hero-market")) $("#stock-hero-market").textContent = asset.symbol.includes(".KS") ? "코스피" : "미국";
  if ($("#stock-hero-price")) $("#stock-hero-price").textContent = `${last.close.toFixed(2)} USD`;
  if ($("#stock-hero-change")) {
    $("#stock-hero-change").className = changeRate >= 0 ? "up" : "down";
    $("#stock-hero-change").textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)} (${fmtPct(changeRate)})`;
  }
  if ($("#stock-hero-desc")) {
    $("#stock-hero-desc").textContent = `${asset.symbol} 기준 보조지표 판정은 ${signal.verdict}입니다. 알파스톡은 이 종목 판단과 포트폴리오 리밸런싱을 함께 계산합니다.`;
  }
  if ($("#hero-monthly")) $("#hero-monthly").textContent = fmtMoney(numberValue("#monthly-contribution", 1000000));
  if ($("#hero-capital")) $("#hero-capital").textContent = fmtMoney(numberValue("#capital", 10000000));
}

function renderQuoteOverview(assetMap, selectedSymbol) {
  const asset = assetMap[selectedSymbol] || assetMap.SPY;
  if (!asset?.rows?.length || !$("#quote-overview")) return;
  const rows = asset.rows;
  const last = rows.at(-1);
  const closes = rows.slice(-252).map((row) => row.close);
  const low52 = Math.min(...closes);
  const high52 = Math.max(...closes);
  const prev = rows.at(-2) || last;
  $("#quote-overview").innerHTML = [
    ["현재가", last.close.toFixed(2)],
    ["52주 최저", low52.toFixed(2)],
    ["52주 최고", high52.toFixed(2)],
    ["전일", prev.close.toFixed(2)],
    ["시가", last.open.toFixed(2)],
    ["고가", last.high.toFixed(2)],
    ["저가", last.low.toFixed(2)],
    ["거래량", fmtMoney(last.volume)]
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
}

function renderIndicatorOverview(assetMap, result, selectedSymbol) {
  const asset = assetMap[selectedSymbol] || assetMap.SPY;
  if (!asset?.rows?.length || !$("#indicator-overview")) return;
  const signal = indicatorSignal(asset, asset.rows.length - 1);
  $("#indicator-overview").innerHTML = [
    ["MFI", `${signal.mfiNow.toFixed(0)} · ${signal.flow}`],
    ["RSI", signal.rsiNow.toFixed(0)],
    ["MACD", signal.macdOk ? "상승" : "둔화"],
    ["ATR", `${(signal.atrPct * 100).toFixed(1)}%`],
    ["전략 판정", signal.verdict],
    ["월간 국면", result.state.label]
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
}

function renderDailyPriceTable(assetMap, selectedSymbol) {
  const asset = assetMap[selectedSymbol] || assetMap.SPY;
  if (!asset?.rows?.length || !$("#daily-price-table")) return;
  $("#daily-price-table").innerHTML = asset.rows.slice(-24).reverse().map((row, idx, arr) => {
    const chronologicalIndex = asset.rows.findIndex((item) => item.date === row.date);
    const prev = asset.rows[chronologicalIndex - 1] || row;
    const change = row.close - prev.close;
    const rate = prev.close ? change / prev.close : 0;
    return `<tr>
      <td>${row.date}</td>
      <td><strong>${row.close.toFixed(2)}</strong></td>
      <td class="${change >= 0 ? "up" : "down"}">${change >= 0 ? "상승" : "하락"} ${Math.abs(change).toFixed(2)}</td>
      <td class="${rate >= 0 ? "up" : "down"}">${fmtPct(rate)}</td>
      <td>${row.open.toFixed(2)}</td>
      <td>${row.high.toFixed(2)}</td>
      <td>${row.low.toFixed(2)}</td>
      <td>${fmtMoney(row.volume)}</td>
    </tr>`;
  }).join("");
}

function renderAutomationPlaybooks(result) {
  if (!$("#automation-playbooks")) return;
  const guard = result.current.guard || { level: "clear", label: "주간 감시: 유지" };
  const invested = Object.values(result.current.weights).reduce((sum, weight) => sum + weight, 0);
  const top = Object.entries(result.current.weights).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s, w]) => `${s} ${(w * 100).toFixed(0)}%`).join(", ");
  const cards = [
    ["월초 리밸런싱", `월 1회 목표 비중으로 조정. 현재 위험자산 투입률은 ${(invested * 100).toFixed(0)}%입니다.`, top || "현금 대기"],
    ["주간 리스크 감시", `QQQ 50일선, MFI, MACD, SOXL 낙폭, SPY 200일선을 감시합니다.`, guard.label],
    ["회복 재진입", "감산 후 QQQ 5일 반등, MFI 재유입, MACD 개선이 겹치면 분할 복귀합니다.", "일괄 진입 대신 30/40/30 분할"],
    ["KIS 주문 전 검증", "자동매매 전 주문 초안을 JSON으로 만들고 모의투자에서 수량·지정가·계좌 동기화를 확인합니다.", "실전 주문은 별도 잠금 유지"]
  ];
  $("#automation-playbooks").innerHTML = cards.map(([title, body, rule]) => `
    <div class="playbook-card">
      <strong>${title}</strong>
      <span>${body}</span>
      <small>${rule}</small>
    </div>`).join("");
}

function renderAll(assetMap, result) {
  const amount = numberValue("#capital", 10000000);
  const monthly = numberValue("#monthly-contribution", 1000000);
  const bench = result.benchmarkSymbol || "SPY";
  const selectedAsset = assetMap[bench] || assetMap.SPY || Object.values(assetMap).find((asset) => asset?.rows?.length);
  const invested = Object.values(result.current.weights).reduce((s, v) => s + v, 0);
  const guard = result.current.guard || { level: "clear", label: "주간 감시: 유지", triggers: [] };
  const guardNote = guard.triggers?.length ? guard.triggers.join(", ") : "트리거 없음";
  renderStockHeader(assetMap, result, bench);
  renderQuoteOverview(assetMap, bench);
  renderIndicatorOverview(assetMap, result, bench);
  renderDailyPriceTable(assetMap, bench);
  renderAutomationPlaybooks(result);
  $("#next-action").textContent = guard.level === "defense" ? "방어 전환" : guard.level === "trim" || guard.level === "watch" ? "위험 감산" : invested > 0.85 ? "월간 리밸런싱" : invested > 0.45 ? "선별 리밸런싱" : "방어/대기";
  $("#next-regime").textContent = result.state.label;
  $("#wf-cagr").textContent = fmtPct(result.cagr);
  $("#dd-edge").textContent = fmtPct(result.mdd - result.spyMdd);
  $("#benchmark-edge-label").textContent = `${bench} 대비 낙폭`;
  $("#chart-copy").textContent = `파란 선은 워크포워드 포트폴리오, 검은 선은 ${bench}입니다. 왼쪽 축은 성장 배수, 아래 축은 시간입니다.`;
  $("#replay-benchmark-head").textContent = bench;
  $("#stress-benchmark-head").textContent = bench;
  $("#report-date").textContent = `${selectedAsset?.rows?.at(-1)?.date || "-"} 기준`;
  $("#portfolio-summary").innerHTML = `
    <div><span class="label">선택 전략</span><strong>${result.currentStrategy.name}</strong></div>
    <div><span class="label">운용 게이트</span><strong>${result.deploymentMode === "qld_alpha_floor" ? "Alpha Prime 하한선 유지" : result.researchApplied ? "연구 후보 통과" : "내장 전략"}</strong></div>
    <div><span class="label">월중 리스크 감시</span><strong>${guard.label}</strong></div>
    <div><span class="label">투자 비중</span><strong>${(invested * 100).toFixed(0)}%</strong></div>
    <div><span class="label">연복리</span><strong>${fmtPct(result.cagr)}</strong></div>
    <div><span class="label">월 승률/초과율</span><strong>${fmtPct(result.winRate)} / ${fmtPct(result.beatRate)}</strong></div>
    <div><span class="label">${bench} 대비</span><strong>${fmtPct(result.cagr - result.spyCagr)}</strong></div>
    <div><span class="label">연 턴오버/비용</span><strong>${(result.avgAnnualTurnover || 0).toFixed(2)}x / ${((result.totalCostRate || 0) * 100).toFixed(1)}%</strong></div>`;
  $("#pretrade-report").innerHTML = `
    <p>다음 한 달은 <strong>${result.state.label}</strong>으로 예측합니다. 현재 선택된 전략은 <strong>${result.currentStrategy.name}</strong>입니다.</p>
    <p><strong>운용 모델 선택:</strong> ${result.deploymentReason || (result.researchApplied ? `최신 연구 리포트의 챔피언 모델 <strong>${researchModelName(result.researchModelId)}</strong>과 advisory 목표비중을 현재 리밸런싱 엔진에 반영했습니다.` : "연구 리포트를 찾지 못해 내장 Alpha Prime Rotation 로직으로 계산했습니다.")}</p>
    ${result.qldAlphaStats && result.researchCandidateStats ? `<p><strong>성능 비교:</strong> Alpha Prime Rotation CAGR ${fmtPct(result.qldAlphaStats.cagr)}, MDD ${fmtPct(result.qldAlphaStats.mdd)} / 연구 후보 CAGR ${fmtPct(result.researchCandidateStats.cagr)}, MDD ${fmtPct(result.researchCandidateStats.mdd)}입니다.</p>` : ""}
    <p><strong>실거래 비용 반영:</strong> 한국투자증권 미국 온라인 수수료 매수/매도 각 0.25%, 미국 매도 SEC Fee 0.00206%, 슬리피지 0.05%, 환전 스프레드 0.05%, 해외주식 양도세 프록시 22%(연 기본공제 250만 원)를 리플레이에 반영했습니다. 목표 비중 차이가 작으면 리밸런싱을 건너뛰어 수수료 손실을 줄입니다.</p>
    <p><strong>과적응 방지:</strong> 반도체 섹터, 기술주 묶음, 레버리지 ETF, 단일 종목 비중에 상한을 걸었습니다. 그래서 SOXL/NVDA 같은 최근 승자에만 몰아 넣어 2024~2026 구간을 맞춘 전략은 자동으로 감점됩니다.</p>
    <p><strong>운영 방식:</strong> 월초에는 목표 비중을 리밸런싱하고, 월중에는 QQQ 50일선, MFI/MACD, SOXL 낙폭, 반도체 상대강도, SPY 200일선, 전략 자체의 월중 손실 한도를 감시합니다. 급락 때는 위험자산을 줄이고, QQQ 5일 반등·MFI 재유입·MACD 개선이 겹치면 부분 재진입합니다. 현재 상태는 <strong>${guard.label}</strong>이며 근거는 ${guardNote}입니다.</p>
    <p>운용 금액 ${fmtMoney(amount)} 중 ${fmtMoney(amount * invested)}를 투입하고, 이번 달 추가 투자금 ${fmtMoney(monthly)}은 투자 추천 탭의 우선순위대로 배치합니다. 손절을 반복하는 대신, 시장 온도가 낮아지면 전략 자체가 방어 로테이션이나 현금 대기로 바뀝니다.</p>
    <p>이 결과는 매월 그 시점까지의 과거 데이터만으로 전략을 고른 워크포워드 리플레이입니다. 비교 기준은 현재 입력한 <strong>${bench}</strong>입니다.</p>`;
  $("#portfolio-table").innerHTML = Object.entries(result.current.weights).sort((a, b) => b[1] - a[1]).map(([sym, w]) => {
    const score = result.current.scored.find((x) => x.symbol === sym)?.score ?? 0;
    const role = defensive.has(sym) ? "방어/완충" : score > 78 ? "핵심 주도" : "전술 편입";
    return `<tr><td><strong>${sym}</strong></td><td>${(w * 100).toFixed(1)}%</td><td>${fmtMoney(amount * w)}</td><td><span class="score-pill">${score.toFixed(0)}</span></td><td>${role}</td></tr>`;
  }).join("");

  const activeKeys = new Set(result.currentStrategy.components?.map((item) => item.key) || [result.currentStrategy.key]);
  $("#strategy-cards").innerHTML = strategyDefs.map((s) => `<div class="strategy-card ${activeKeys.has(s.key) ? "active" : ""}"><strong>${s.name}</strong><p>${s.note}</p></div>`).join("");
  $("#strategy-table").innerHTML = strategyDefs.map((s) => {
    const st = result.stats[s.key];
    return `<tr><td>${s.name}</td><td>${st.count}</td><td>${fmtPct(avg(st.rets))}</td><td class="down">${fmtPct(st.worst)}</td><td>${activeKeys.has(s.key) ? "현재 혼합" : "대기"}</td></tr>`;
  }).join("");
  renderIndicatorTable(assetMap, result);
  renderLiveManager(assetMap, result);
  renderContributionPlan(assetMap, result);
  renderValidationSummary(result);
  renderResearchLatest();

  const dcaReplay = buildDcaReplay(result, amount, monthly);
  const lastDca = dcaReplay.at(-1);
  $("#dca-summary").innerHTML = [
    metricCard("누적 원금", fmtMoney(lastDca?.principal || amount)),
    metricCard("전략 평가액", fmtMoney(lastDca?.portfolioValue || amount), "primary"),
    metricCard(`${bench} 평가액`, fmtMoney(lastDca?.benchmarkValue || amount)),
    metricCard("벤치 대비", fmtMoney((lastDca?.portfolioValue || amount) - (lastDca?.benchmarkValue || amount)), (lastDca?.portfolioValue || amount) >= (lastDca?.benchmarkValue || amount) ? "success" : "warning"),
    metricCard("누적 수수료", fmtMoney(lastDca?.feePaid || 0)),
    metricCard("추정 양도세", fmtMoney(lastDca?.taxPaid || 0), "warning")
  ].join("");

  const defaultStart = eventIndexOnOrAfter(result, $("#projection-start")?.value || result.events[Math.max(0, result.events.length - 12)].date);
  const defaultEnd = eventIndexOnOrBefore(result, $("#projection-end")?.value || result.events.at(-1).date);
  renderReplayChart(result, buildDcaReplay(result, amount, monthly, defaultStart, defaultEnd));

  const scenarios = [
    ["2018 Q4 긴축 하락", "2018-09-20", "2018-12-24"],
    ["2020 코로나 급락", "2020-02-19", "2020-03-23"],
    ["2022 인플레 하락", "2022-01-03", "2022-10-14"],
    ["2025-26 최근 조정", "2025-11-20", "2026-03-30"]
  ];
  $("#scenario-table").innerHTML = scenarios.map(([name, start, end]) => {
    const p = scenarioReturn(result.curve, start, end);
    const s = scenarioReturn(result.spyCurve, start, end);
    if (p == null || s == null) return "";
    return `<tr><td>${name}</td><td class="${p >= 0 ? "up" : "down"}">${fmtPct(p)}</td><td class="${s >= 0 ? "up" : "down"}">${fmtPct(s)}</td><td class="${p - s >= 0 ? "up" : "down"}">${fmtPct(p - s)}</td></tr>`;
  }).join("");
  $("#stress-summary").innerHTML = `
    <div><span class="label">포트폴리오 MDD</span><strong class="down">${fmtPct(result.mdd)}</strong></div>
    <div><span class="label">${bench} MDD</span><strong class="down">${fmtPct(result.spyMdd)}</strong></div>
    <div><span class="label">연복리 차이</span><strong>${fmtPct(result.cagr - result.spyCagr)}</strong></div>
    <div><span class="label">월 승률</span><strong>${fmtPct(result.winRate)}</strong></div>`;
  setupProjectionDefaults(result);
  renderProjection(result);
  renderChart(result);
  renderMarketIntel(assetMap, result).catch(() => {
    $("#market-intel").innerHTML = `<div class="intel-item"><strong>뉴스/시장 입력</strong><span class="muted">실시간 데이터를 불러오지 못했습니다.</span></div>`;
  });
}

function recentReturn(asset, days) {
  const rows = asset?.rows || [];
  const i = rows.length - 1;
  return i >= days ? rows[i].close / rows[i - days].close - 1 : 0;
}

function newsSentiment(items) {
  const bad = /cut|cuts|lawsuit|probe|fraud|miss|warning|downgrade|tariff|recession|selloff|plunge|risk|debt|default|slump/i;
  const good = /beat|beats|upgrade|surge|record|growth|profit|strong|rally|buyback|approval|raises|optimistic/i;
  let score = 0;
  items.forEach((item) => {
    if (good.test(item.title)) score += 1;
    if (bad.test(item.title)) score -= 1;
  });
  return score;
}

async function renderMarketIntel(assetMap, result) {
  const bench = result.benchmarkSymbol || "SPY";
  const news = await fetchNews(bench);
  const sentiment = newsSentiment(news);
  const vix = assetMap["^VIX"]?.rows.at(-1)?.close;
  const tnx = assetMap["^TNX"]?.rows.at(-1)?.close;
  const spy1m = recentReturn(assetMap.SPY, 21);
  const gld1m = recentReturn(assetMap.GLD, 21);
  const tlt1m = recentReturn(assetMap.TLT, 21);
  const riskText = vix > 28 ? "변동성 경고" : vix > 20 ? "변동성 주의" : "변동성 정상";
  const newsText = sentiment > 1 ? "뉴스 우호" : sentiment < -1 ? "뉴스 경계" : "뉴스 중립";
  $("#market-intel").innerHTML = `
    <div class="intel-item"><strong>${riskText}</strong><span>VIX ${vix ? vix.toFixed(1) : "-"} · 10Y ${tnx ? tnx.toFixed(2) : "-"} · SPY 1M ${fmtPct(spy1m)} · GLD 1M ${fmtPct(gld1m)} · TLT 1M ${fmtPct(tlt1m)}</span></div>
    <div class="intel-item"><strong>${bench} ${newsText}</strong><span>VIX와 10년물 금리 흐름은 시장 열기 점수에 반영됩니다. 헤드라인 점수 ${sentiment}는 리스크 해석 패널에 표시합니다.</span></div>
    ${news.slice(0, 4).map((item) => `<div class="intel-item"><strong>${item.title}</strong><span class="muted">${item.date || ""}</span></div>`).join("")}`;
}

function setupProjectionDefaults(result) {
  const start = $("#projection-start");
  const end = $("#projection-end");
  if (!start || !end || start.dataset.ready) return;
  const defaultIndex = Math.max(0, result.events.length - 12);
  start.value = result.events[defaultIndex]?.date || result.events[0]?.date || "";
  end.value = result.events.at(-1)?.date || "";
  start.dataset.ready = "1";
}

function renderProjection(result) {
  const box = $("#projection-result");
  if (!box || !result.curve.length) return;
  const bench = result.benchmarkSymbol || "SPY";
  const amount = numberValue("#capital", 10000000);
  const monthly = numberValue("#monthly-contribution", 1000000);
  const startDate = $("#projection-start")?.value || result.events[Math.max(0, result.events.length - 12)].date;
  const endDate = $("#projection-end")?.value || result.events.at(-1).date;
  const startIndex = eventIndexOnOrAfter(result, startDate);
  let endIndex = eventIndexOnOrBefore(result, endDate);
  endIndex = Math.max(startIndex, Math.min(result.events.length - 1, endIndex));
  const startPoint = result.curve[startIndex];
  const endPoint = result.curve[endIndex];
  const spyStart = result.spyCurve[startIndex];
  const spyEnd = result.spyCurve[endIndex];
  const periodEvents = result.events.slice(startIndex, endIndex + 1);
  const portfolioReturn = periodEvents.reduce((value, event) => value * (1 + event.nextReturn), 1) - 1;
  const spyReturn = periodEvents.reduce((value, event) => value * (1 + event.spyReturn), 1) - 1;
  const dca = buildDcaReplay(result, amount, monthly, startIndex, endIndex);
  const last = dca.at(-1);
  box.innerHTML = [
    metricCard("계산 기간", `${result.events[startIndex].date} → ${result.events[endIndex].date}`),
    metricCard("일시투자 전략", fmtMoney(amount * (1 + portfolioReturn)), "primary"),
    metricCard(`${bench} 일시투자`, fmtMoney(amount * (1 + spyReturn))),
    metricCard("일시투자 초과", fmtPct(portfolioReturn - spyReturn), portfolioReturn >= spyReturn ? "success" : "warning"),
    metricCard("월 추가금", fmtMoney(monthly)),
    metricCard("선택 기간 누적 원금", fmtMoney(last?.principal || amount)),
    metricCard("선택 기간 누적 전략", fmtMoney(last?.portfolioValue || amount), "primary"),
    metricCard(`선택 기간 누적 ${bench}`, fmtMoney(last?.benchmarkValue || amount)),
    metricCard("선택 기간 누적 초과", fmtMoney((last?.portfolioValue || amount) - (last?.benchmarkValue || amount)), (last?.portfolioValue || amount) >= (last?.benchmarkValue || amount) ? "success" : "warning")
  ].join("");
  renderReplayChart(result, dca);
  renderReplayTable(result, startIndex, endIndex);
  const detailIndex = selectedReplayIndex != null && selectedReplayIndex >= startIndex && selectedReplayIndex <= endIndex ? selectedReplayIndex : endIndex;
  renderReplayMonthDetail(result, detailIndex);
}

function selectReplayPeriod(index) {
  if (!appState?.result?.events[index]) return;
  const result = appState.result;
  const date = result.events[index].date;
  selectedReplayIndex = index;
  const start = $("#projection-start");
  const end = $("#projection-end");
  if (start) start.value = date;
  if (end) end.value = date;
  renderProjection(result);
  document.querySelectorAll("#replay-table tr").forEach((row) => row.classList.remove("selected"));
  document.querySelector(`#replay-table tr[data-event-index="${index}"]`)?.classList.add("selected");
}

function ensureStockAnalysisLayout() {
  const view = $("#view-single");
  if (!view || view.dataset.analysisReady) return;
  view.dataset.analysisReady = "1";
  view.innerHTML = `
    <section class="analysis-shell">
      <div class="panel-head">
        <div>
          <h2 id="single-title">종목 분석</h2>
          <p id="single-note">시세, 뉴스, 공시, 투자 지표, 가치평가, 실적, 재무, 안정성, 회사 정보를 한 화면에서 봅니다.</p>
        </div>
      </div>
      <div class="analysis-layout">
        <section class="chart-panel single-summary-panel">
          <div class="single-summary-head">
            <div>
              <span class="section-kicker">요약 그래프</span>
              <h3 id="single-summary-title">가격·추세·자금흐름</h3>
              <p id="single-summary-copy">최근 1년 가격 흐름과 핵심 보조지표를 한 화면에 압축합니다.</p>
            </div>
            <div id="single-summary-badges" class="summary-badges"></div>
          </div>
          <div class="single-summary-grid">
            <div class="single-chart-wrap">
              <canvas id="single-chart" width="1200" height="420"></canvas>
            </div>
            <div id="single-summary-tiles" class="single-summary-tiles"></div>
          </div>
          <div id="single-mini-bars" class="single-mini-bars"></div>
        </section>
        <aside class="analysis-side">
          <section class="analysis-card">
            <h3>종목 판단</h3>
            <div id="single-report"></div>
          </section>
          <section class="analysis-card">
            <h3>시장 뉴스</h3>
            <div id="market-intel" class="intel-list"></div>
          </section>
        </aside>
      </div>
      <div class="analysis-grid">
        <section class="analysis-card"><h3>시세</h3><div id="analysis-price" class="fact-grid"></div></section>
        <section class="analysis-card"><h3>뉴스</h3><div id="analysis-news" class="intel-list"></div></section>
        <section class="analysis-card"><h3>공시</h3><div id="analysis-disclosures" class="intel-list"></div></section>
        <section class="analysis-card"><h3>투자 지표</h3><div id="analysis-investment" class="fact-grid"></div></section>
        <section class="analysis-card"><h3>가치평가지표</h3><div id="analysis-valuation" class="fact-grid"></div></section>
        <section class="analysis-card"><h3>실적</h3><div id="analysis-earnings" class="fact-grid"></div></section>
        <section class="analysis-card"><h3>재무</h3><div id="analysis-financials" class="fact-grid"></div></section>
        <section class="analysis-card"><h3>안정성</h3><div id="analysis-stability" class="fact-grid"></div></section>
        <section class="analysis-card wide-card"><h3>회사 정보</h3><div id="analysis-company" class="fact-grid"></div></section>
      </div>
    </section>`;
}

function formatFundValue(value, mode = "plain") {
  if (!Number.isFinite(Number(value))) return "-";
  const n = Number(value);
  if (mode === "money") return n >= 1e12 ? `${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : fmtMoney(n);
  if (mode === "pct") return `${(n * 100).toFixed(1)}%`;
  if (mode === "ratio") return n.toFixed(2);
  return Math.abs(n) >= 1000 ? fmtMoney(n) : n.toFixed(2);
}

function factGrid(rows) {
  return rows.map(([label, value, tone = ""]) => `<div class="fact-item ${tone}"><span>${label}</span><strong>${value ?? "-"}</strong></div>`).join("");
}

async function renderStockAnalysis(asset, score, trend) {
  const symbol = asset.symbol;
  const rows = asset.rows;
  const last = rows.at(-1);
  const prev = rows.at(-2) || last;
  const signal = indicatorSignal(asset, rows.length - 1);
  const closes = rows.slice(-252).map((row) => row.close);
  const high52 = Math.max(...closes);
  const low52 = Math.min(...closes);
  const position52 = high52 > low52 ? (last.close - low52) / (high52 - low52) : 0;
  const reference = appState?.assets?.SPY || asset;
  const relative3m = recentReturn(asset, 63) - recentReturn(reference, 63);
  const fundamentals = await fetchFundamentals(symbol);
  const news = await fetchNews(symbol);
  const secUrl = `https://www.sec.gov/edgar/search/#/q=${encodeURIComponent(symbol)}`;
  const yahooUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
  $("#analysis-price").innerHTML = factGrid([
    ["현재가", `${last.close.toFixed(2)} ${fundamentals.currency || "USD"}`],
    ["전일 대비", `${(last.close - prev.close).toFixed(2)} (${fmtPct(last.close / prev.close - 1)})`, last.close >= prev.close ? "good" : "bad"],
    ["52주 위치", `${(position52 * 100).toFixed(0)}%`],
    ["거래량", fmtMoney(last.volume)],
    ["52주 고가", high52.toFixed(2)],
    ["52주 저가", low52.toFixed(2)]
  ]);
  $("#analysis-investment").innerHTML = factGrid([
    ["MFI", `${signal.mfiNow.toFixed(0)} · ${signal.flow}`],
    ["RSI", signal.rsiNow.toFixed(0)],
    ["MACD", signal.macdOk ? "상승" : "둔화", signal.macdOk ? "good" : "bad"],
    ["ATR", `${(signal.atrPct * 100).toFixed(1)}%`],
    ["3개월 상대강도", fmtPct(relative3m), relative3m >= 0 ? "good" : "bad"],
    ["장기 추세", trend ? "유효" : "훼손/약화", trend ? "good" : "bad"]
  ]);
  $("#analysis-valuation").innerHTML = factGrid([
    ["시가총액", formatFundValue(fundamentals.marketCap, "money")],
    ["PER", formatFundValue(fundamentals.trailingPE, "ratio")],
    ["Forward PER", formatFundValue(fundamentals.forwardPE, "ratio")],
    ["PBR", formatFundValue(fundamentals.priceToBook, "ratio")],
    ["PSR", formatFundValue(fundamentals.priceToSales, "ratio")],
    ["배당수익률", formatFundValue(fundamentals.dividendYield, "pct")],
    ["데이터 상태", fundamentals.error ? "공식 통계 API 제한" : "정상"]
  ]);
  $("#analysis-earnings").innerHTML = factGrid([
    ["EPS TTM", formatFundValue(fundamentals.epsTrailingTwelveMonths)],
    ["EPS 예상", formatFundValue(fundamentals.epsForward)],
    ["매출", formatFundValue(fundamentals.revenue, "money")],
    ["EBITDA", formatFundValue(fundamentals.ebitda, "money")],
    ["실적 발표", fundamentals.earningsTimestamp ? fundamentals.earningsTimestamp.slice(0, 10) : fundamentals.earningsTimestampStart ? `${fundamentals.earningsTimestampStart.slice(0, 10)}~${fundamentals.earningsTimestampEnd.slice(0, 10)}` : "-"],
    ["이익률", formatFundValue(fundamentals.profitMargins, "pct")]
  ]);
  $("#analysis-financials").innerHTML = factGrid([
    ["총매출", formatFundValue(fundamentals.revenue, "money")],
    ["총마진", formatFundValue(fundamentals.grossMargins, "pct")],
    ["순이익률", formatFundValue(fundamentals.profitMargins, "pct")],
    ["부채비율", formatFundValue(fundamentals.debtToEquity, "ratio")],
    ["주당순자산", formatFundValue(fundamentals.bookValue)],
    ["발행주식", formatFundValue(fundamentals.sharesOutstanding, "money")]
  ]);
  $("#analysis-stability").innerHTML = factGrid([
    ["Beta", formatFundValue(fundamentals.beta, "ratio")],
    ["실현 변동성", `${(realizedVol(rows, rows.length - 1, 63) * 100).toFixed(1)}%`],
    ["126일 낙폭", fmtPct(drawdown(rows, rows.length - 1, 126)), "bad"],
    ["평균 거래량", formatFundValue(fundamentals.averageVolume, "money")],
    ["시장 상태", fundamentals.marketState || "-"],
    ["전략 점수", score.toFixed(0)]
  ]);
  $("#analysis-company").innerHTML = factGrid([
    ["이름", fundamentals.name || symbol],
    ["티커", symbol],
    ["거래소", fundamentals.exchange || "-"],
    ["자산 유형", fundamentals.quoteType || "-"],
    ["통화", fundamentals.currency || "USD"],
    ["데이터 출처", "Yahoo Finance quote/chart"]
  ]);
  $("#analysis-news").innerHTML = news.length ? news.slice(0, 6).map((item) => `
    <div class="intel-item">
      <strong>${item.link ? `<a href="${item.link}" target="_blank" rel="noreferrer">${item.title}</a>` : item.title}</strong>
      <span class="muted">${item.date || ""}</span>
    </div>`).join("") : `<div class="intel-item"><strong>뉴스 없음</strong><span class="muted">현재 불러온 헤드라인이 없습니다.</span></div>`;
  $("#analysis-disclosures").innerHTML = `
    <div class="intel-item"><strong><a href="${secUrl}" target="_blank" rel="noreferrer">SEC EDGAR 검색</a></strong><span>미국 주식/ETF 공시를 확인합니다. 국내 종목은 KRX/DART 연동을 추가해야 합니다.</span></div>
    <div class="intel-item"><strong><a href="${yahooUrl}" target="_blank" rel="noreferrer">Yahoo Finance 종목 페이지</a></strong><span>실적 일정, 프로필, 주요 통계를 교차 확인합니다.</span></div>
    <div class="intel-item"><strong>자동 공시 연동 상태</strong><span class="muted">현재는 링크 기반 확인입니다. 브로커/API 키 없이도 분석 화면은 작동합니다.</span></div>`;
}

function targetWeightForSymbol(symbol) {
  const current = appState?.result?.current?.weights?.[symbol];
  if (Number.isFinite(current)) return current;
  const advisory = activeResearchJson()?.advisory?.targetWeights?.[symbol];
  return Number.isFinite(advisory) ? advisory : 0;
}

function returnTone(value) {
  return value > 0.001 ? "good" : value < -0.001 ? "bad" : "neutral";
}

function signalGrade(score, trend, signal) {
  if (score >= 72 && trend && signal.macdOk && signal.flow === "자금유입") return "핵심 편입 후보";
  if (score >= 60 && trend && signal.macdOk) return "분할 매수 우위";
  if (signal.mfiNow > 86 || signal.rsiNow > 82) return "과열 축소 감시";
  if (!trend && score < 52) return "방어/관찰 우선";
  return "중립 관찰";
}

function summaryTile(label, value, detail, tone = "") {
  return `
    <div class="summary-tile ${tone}">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${detail}</small>
    </div>`;
}

function miniBar(label, value, display, tone = "neutral") {
  const pct = clamp(Number(value) || 0, 0, 100);
  return `
    <div class="mini-bar ${tone}">
      <div class="mini-bar-head"><span>${label}</span><strong>${display}</strong></div>
      <div class="mini-track"><i style="width:${pct.toFixed(1)}%"></i></div>
    </div>`;
}

function renderSingleSummary(asset, score, trend, signal) {
  const rows = asset.rows;
  const i = rows.length - 1;
  const last = rows[i];
  const prev = rows[i - 1] || last;
  const reference = asset.symbol === "QQQ" ? (appState?.assets?.SPY || asset) : (appState?.assets?.QQQ || appState?.assets?.SPY || asset);
  const closes = rows.slice(-252).map((row) => row.close);
  const high52 = Math.max(...closes);
  const low52 = Math.min(...closes);
  const position52 = high52 > low52 ? (last.close - low52) / (high52 - low52) : 0.5;
  const targetWeight = targetWeightForSymbol(asset.symbol);
  const dayReturn = prev.close ? last.close / prev.close - 1 : 0;
  const rel3m = recentReturn(asset, 63) - recentReturn(reference, 63);
  const dd126 = drawdown(rows, i, 126);
  const vol63 = realizedVol(rows, i, 63);
  const grade = signalGrade(score, trend, signal);
  const mfiTone = signal.mfiNow > 84 ? "bad" : signal.mfiNow >= 45 && signal.mfiNow <= 78 ? "good" : "neutral";
  const rsiTone = signal.rsiNow > 78 ? "bad" : signal.rsiNow >= 45 && signal.rsiNow <= 70 ? "good" : "neutral";

  $("#single-summary-title").textContent = `${asset.symbol} 요약 대시보드`;
  $("#single-summary-copy").textContent = `${last.date} 기준 가격, 추세, 자금흐름, 상대강도와 Alpha Prime 편입 상태를 압축 표시합니다.`;
  $("#single-summary-badges").innerHTML = [
    ["판정", grade, trend && score >= 60 ? "good" : grade.includes("축소") || grade.includes("방어") ? "bad" : "neutral"],
    ["신호", signal.verdict, signal.verdict.includes("매수") || signal.verdict.includes("보유") ? "good" : signal.verdict.includes("축소") ? "bad" : "neutral"],
    ["목표비중", targetWeight > 0 ? `${(targetWeight * 100).toFixed(1)}%` : "미편입", targetWeight > 0 ? "good" : "neutral"]
  ].map(([label, value, tone]) => `<span class="summary-badge ${tone}"><small>${label}</small>${value}</span>`).join("");
  $("#single-summary-tiles").innerHTML = [
    summaryTile("현재가", last.close.toFixed(2), `전일 ${fmtPct(dayReturn)}`, returnTone(dayReturn)),
    summaryTile("전략 점수", score.toFixed(0), grade, score >= 65 ? "good" : score < 50 ? "bad" : "neutral"),
    summaryTile("3개월 상대강도", fmtPct(rel3m), `기준 ${reference.symbol}`, returnTone(rel3m)),
    summaryTile("126일 낙폭", fmtPct(dd126), `실현변동성 ${(vol63 * 100).toFixed(1)}%`, dd126 < -0.16 ? "bad" : "neutral"),
    summaryTile("MFI / RSI", `${signal.mfiNow.toFixed(0)} / ${signal.rsiNow.toFixed(0)}`, `${signal.flow} · MACD ${signal.macdOk ? "상승" : "둔화"}`, signal.macdOk && signal.flow === "자금유입" ? "good" : "neutral")
  ].join("");
  $("#single-mini-bars").innerHTML = [
    miniBar("52주 위치", position52 * 100, `${(position52 * 100).toFixed(0)}%`, position52 > 0.7 ? "good" : position52 < 0.35 ? "bad" : "neutral"),
    miniBar("MFI 자금흐름", signal.mfiNow, signal.mfiNow.toFixed(0), mfiTone),
    miniBar("RSI 모멘텀", signal.rsiNow, signal.rsiNow.toFixed(0), rsiTone),
    miniBar("Alpha Prime 편입", targetWeight * 250, targetWeight > 0 ? `${(targetWeight * 100).toFixed(1)}%` : "0%", targetWeight > 0 ? "good" : "neutral"),
    miniBar("변동성 위험", vol63 * 100, `${(vol63 * 100).toFixed(1)}%`, vol63 > 0.65 ? "bad" : vol63 < 0.28 ? "good" : "neutral")
  ].join("");
}

function drawSingleSummaryChart(asset, signal) {
  const c = $("#single-chart");
  if (!c || !asset?.rows?.length) return;
  const ctx = c.getContext("2d");
  const rect = c.getBoundingClientRect();
  const width = Math.max(720, Math.round(rect.width || c.clientWidth || 960));
  const height = Math.max(390, Math.round(rect.height || c.clientHeight || 420));
  const scale = window.devicePixelRatio || 1;
  c.width = width * scale;
  c.height = height * scale;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const rows = asset.rows;
  const start = Math.max(0, rows.length - 260);
  const view = rows.slice(start);
  if (view.length < 2) {
    ctx.fillStyle = "#7d8794";
    ctx.font = "13px Segoe UI";
    ctx.fillText("차트를 그릴 가격 데이터가 부족합니다.", 24, 42);
    return;
  }
  const pad = { l: 58, r: 22, t: 24, b: 32 };
  const oscH = 74;
  const volH = 44;
  const gap = 12;
  const priceBottom = height - pad.b - oscH - volH - gap * 2;
  const priceH = Math.max(160, priceBottom - pad.t);
  const volTop = priceBottom + gap;
  const oscTop = volTop + volH + gap;
  const x = (idx) => pad.l + idx / Math.max(1, view.length - 1) * (width - pad.l - pad.r);

  const indexed = view.map((row, idx) => ({ row, idx: start + idx }));
  const priceVals = indexed.flatMap(({ row, idx }) => [row.close, asset.ind.sma20[idx], asset.ind.sma50[idx], asset.ind.sma200[idx]].filter(Number.isFinite));
  const rawMin = Math.min(...priceVals);
  const rawMax = Math.max(...priceVals);
  const range = Math.max(0.01, rawMax - rawMin);
  const min = rawMin - range * 0.05;
  const max = rawMax + range * 0.05;
  const y = (value) => priceBottom - (value - min) / Math.max(0.01, max - min) * priceH;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#e8edf3";
  ctx.lineWidth = 1;
  ctx.font = "11px Segoe UI";
  ctx.fillStyle = "#69756e";
  for (let n = 0; n <= 4; n += 1) {
    const yy = pad.t + priceH * n / 4;
    const value = max - (max - min) * n / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, yy);
    ctx.lineTo(width - pad.r, yy);
    ctx.stroke();
    ctx.fillText(value.toFixed(2), 10, yy + 4);
  }
  [0, Math.floor((view.length - 1) / 2), view.length - 1].forEach((idx) => {
    const xx = x(idx);
    ctx.fillStyle = "#8b95a1";
    ctx.fillText(view[idx].date.slice(2, 10), Math.min(width - pad.r - 54, Math.max(pad.l - 4, xx - 24)), height - 10);
  });

  const maxVol = Math.max(...view.map((row) => row.volume || 0), 1);
  view.forEach((row, idx) => {
    const prev = view[idx - 1] || row;
    const barH = (row.volume || 0) / maxVol * volH;
    ctx.fillStyle = row.close >= prev.close ? "rgba(10,159,106,.28)" : "rgba(224,68,68,.24)";
    ctx.fillRect(x(idx) - 1.2, volTop + volH - barH, 2.4, barH);
  });
  ctx.fillStyle = "#8b95a1";
  ctx.fillText("Volume", pad.l, volTop + 12);

  const drawLine = (values, color, lineWidth = 2, dash = []) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dash);
    ctx.beginPath();
    let active = false;
    values.forEach((value, idx) => {
      if (!Number.isFinite(value)) {
        active = false;
        return;
      }
      const xx = x(idx);
      const yy = y(value);
      if (!active) {
        ctx.moveTo(xx, yy);
        active = true;
      } else {
        ctx.lineTo(xx, yy);
      }
    });
    ctx.stroke();
    ctx.restore();
  };

  drawLine(indexed.map(({ row }) => row.close), "#111827", 2.4);
  drawLine(indexed.map(({ idx }) => asset.ind.sma20[idx]), "#f59e0b", 1.35);
  drawLine(indexed.map(({ idx }) => asset.ind.sma50[idx]), "#2563eb", 1.35);
  drawLine(indexed.map(({ idx }) => asset.ind.sma200[idx]), "#7d8794", 1.2, [5, 4]);

  const last = view.at(-1);
  const lastY = y(last.close);
  const lastX = x(view.length - 1);
  ctx.fillStyle = last.close >= (view.at(-2)?.close || last.close) ? "#0a9f6a" : "#e04444";
  ctx.beginPath();
  ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#111827";
  ctx.font = "700 12px Segoe UI";
  ctx.fillText(`${asset.symbol} ${last.close.toFixed(2)}`, Math.min(width - 116, lastX - 106), Math.max(pad.t + 14, lastY - 10));

  const legend = [["가격", "#111827"], ["SMA20", "#f59e0b"], ["SMA50", "#2563eb"], ["SMA200", "#7d8794"], ["MFI", "#0a9f6a"], ["RSI", "#8b5cf6"]];
  let lx = pad.l;
  legend.forEach(([label, color]) => {
    ctx.fillStyle = color;
    ctx.fillRect(lx, pad.t - 14, 16, 3);
    ctx.fillStyle = "#4d5562";
    ctx.font = "11px Segoe UI";
    ctx.fillText(label, lx + 20, pad.t - 9);
    lx += label.length * 8 + 54;
  });

  ctx.strokeStyle = "#e8edf3";
  ctx.strokeRect(pad.l, oscTop, width - pad.l - pad.r, oscH);
  const oy = (value) => oscTop + oscH - clamp(value, 0, 100) / 100 * oscH;
  [20, 50, 80].forEach((level) => {
    ctx.strokeStyle = level === 50 ? "#d5dbe3" : "#eef1f5";
    ctx.beginPath();
    ctx.moveTo(pad.l, oy(level));
    ctx.lineTo(width - pad.r, oy(level));
    ctx.stroke();
    ctx.fillStyle = "#8b95a1";
    ctx.fillText(String(level), 30, oy(level) + 4);
  });
  const drawOsc = (values, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    let active = false;
    values.forEach((value, idx) => {
      if (!Number.isFinite(value)) {
        active = false;
        return;
      }
      const xx = x(idx);
      const yy = oy(value);
      if (!active) {
        ctx.moveTo(xx, yy);
        active = true;
      } else {
        ctx.lineTo(xx, yy);
      }
    });
    ctx.stroke();
  };
  drawOsc(indexed.map(({ idx }) => asset.ind.mfi14[idx]), "#0a9f6a");
  drawOsc(indexed.map(({ idx }) => asset.ind.rsi14[idx]), "#8b5cf6");
  ctx.fillStyle = "#111827";
  ctx.font = "12px Segoe UI";
  ctx.fillText(`MFI ${signal.mfiNow.toFixed(0)} · RSI ${signal.rsiNow.toFixed(0)}`, pad.l + 8, oscTop + 16);
}

function renderSingle(asset) {
  if (!asset?.rows?.length) return;
  ensureStockAnalysisLayout();
  const rows = asset.rows, ind = asset.ind, i = rows.length - 1;
  const trend = rows[i].close > ind.sma200[i] && ind.sma50[i] > ind.sma200[i];
  const reference = appState?.assets?.SPY || asset;
  const score = assetScore(asset, reference, i, "dualMomentum");
  const signal = indicatorSignal(asset, i);
  $("#single-title").textContent = `${asset.symbol} 단일 종목`;
  $("#single-note").textContent = `${asset.symbol}의 시세, 뉴스, 공시 링크, 가치평가, 실적, 재무와 안정성을 함께 갱신했습니다.`;
  $("#single-report").innerHTML = `<p>제로베이스 점수는 <strong>${score.toFixed(0)}</strong>입니다. ${trend ? "장기 추세는 유효합니다." : "장기 추세가 약하거나 훼손됐습니다."}</p><p>MFI ${signal.mfiNow.toFixed(0)}, RSI ${signal.rsiNow.toFixed(0)}, MACD ${signal.macdOk ? "상승" : "둔화"}입니다. 단독 신호보다 포트폴리오 리밸런싱 표와 함께 판단하세요.</p>`;
  renderSingleSummary(asset, score, trend, signal);
  drawSingleSummaryChart(asset, signal);
  renderStockAnalysis(asset, score, trend).catch(() => {
    ["analysis-price", "analysis-news", "analysis-disclosures", "analysis-investment", "analysis-valuation", "analysis-earnings", "analysis-financials", "analysis-stability", "analysis-company"].forEach((id) => {
      const el = $(`#${id}`);
      if (el && !el.innerHTML) el.innerHTML = `<div class="muted">데이터를 불러오지 못했습니다.</div>`;
    });
  });
}

async function loadAll() {
  $("#next-action").textContent = "계산 중";
  const selectedSymbol = ($("#symbol").value.trim().toUpperCase() || "QQQ").replace(/[^A-Z0-9.^-]/g, "");
  const research = await fetchResearchLatest(true);
  const researchSymbols = Object.keys(research?.json?.advisory?.targetWeights || {});
  const liveSymbols = livePortfolio.holdings.map((holding) => holding.symbol);
  const symbols = [...new Set([...universe, ...researchSymbols, ...liveSymbols, selectedSymbol, "^VIX", "^TNX"])];
  const entries = await Promise.allSettled(symbols.map(async (s) => [s, await fetchAsset(s)]));
  const assets = Object.fromEntries(entries.filter((e) => e.status === "fulfilled").map((e) => e.value));
  const fallbackSymbol = assets.SPY ? "SPY" : Object.keys(assets).find((symbol) => assets[symbol]?.rows?.length);
  const benchmarkSymbol = assets[selectedSymbol] ? selectedSymbol : fallbackSymbol;
  if (!benchmarkSymbol) throw new Error("가격 데이터를 불러오지 못했습니다. 네트워크 상태를 확인하고 다시 계산하세요.");
  const result = simulateWalkForward(assets, benchmarkSymbol, research?.json || null);
  appState = { assets, result, research };
  renderAll(assets, result);
  renderSingle(assets[benchmarkSymbol] || assets.SPY || Object.values(assets)[0]);
  refreshStockChart(benchmarkSymbol).catch((error) => {
    if ($("#chart-copy")) $("#chart-copy").textContent = `차트 데이터를 불러오지 못했습니다: ${error.message}`;
  });
}

document.querySelectorAll(".app-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".app-tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    $(`#view-${btn.dataset.view}`).classList.add("active");
    if (appState && btn.dataset.view === "replay") renderProjection(appState.result);
    if (appState && btn.dataset.view === "brief") renderChart(appState.result);
    if (appState && btn.dataset.view === "single") {
      const asset = appState.assets[appState.result.benchmarkSymbol] || appState.assets.SPY || Object.values(appState.assets).find((item) => item?.rows?.length);
      if (asset) drawSingleSummaryChart(asset, indicatorSignal(asset, asset.rows.length - 1));
    }
    if (btn.dataset.view === "alerts") renderNotificationCenter();
    if (btn.dataset.view === "settings") loadKisSettings().catch((error) => setSettingsStatus(error.message));
  });
});

document.querySelectorAll("[data-jump-view]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelector(`.app-tab[data-view="${btn.dataset.jumpView}"]`)?.click();
  });
});

document.querySelectorAll(".frame-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    chartState.frame = btn.dataset.frame || "1d";
    document.querySelectorAll(".frame-btn").forEach((item) => item.classList.toggle("active", item === btn));
    refreshStockChart().catch((error) => {
      if ($("#chart-copy")) $("#chart-copy").textContent = `차트 데이터를 불러오지 못했습니다: ${error.message}`;
    });
  });
});

$("#indicator-toggle")?.addEventListener("click", () => {
  const menu = $("#indicator-menu");
  if (menu) menu.hidden = !menu.hidden;
});

$("#chart-type-toggle")?.addEventListener("click", () => {
  chartState.type = chartState.type === "line" ? "candle" : "line";
  $("#chart-type-toggle").textContent = chartState.type === "line" ? "라인/캔들" : "캔들/라인";
  renderStockChart();
});

document.querySelectorAll("#indicator-menu input[type='checkbox']").forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked) chartState.indicators.add(input.value);
    else chartState.indicators.delete(input.value);
    renderStockChart();
  });
});

function renderSymbolResults(query) {
  const box = $("#symbol-results");
  if (!box) return;
  const q = String(query || "").trim().toUpperCase();
  if (!q) {
    box.hidden = true;
    return;
  }
  const matches = searchableSymbols
    .filter(([symbol, name]) => symbol.includes(q) || name.toUpperCase().includes(q))
    .slice(0, 8);
  box.innerHTML = matches.map(([symbol, name]) => `<button type="button" data-symbol="${symbol}"><strong>${symbol}</strong><span>${name}</span></button>`).join("");
  box.hidden = !matches.length;
  box.querySelectorAll("button[data-symbol]").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("#symbol").value = btn.dataset.symbol;
      box.hidden = true;
      loadAll().catch(showError);
    });
  });
}

function ensureSettingsHelpLayout() {
  const panel = $("#view-settings .settings-panel");
  const grid = panel?.querySelector(".settings-grid");
  if (!panel || !grid || $("#load-paper-demo")) return;
  const guide = document.createElement("div");
  guide.className = "settings-guide";
  guide.innerHTML = `
    <section class="mode-card active">
      <strong>모의투자 모드</strong>
      <span>API 키 없이 바로 포트폴리오 저장, 리밸런싱 계산, 주문 초안 검증을 사용할 수 있습니다.</span>
      <button id="load-paper-demo" type="button">모의 포트폴리오로 시작</button>
    </section>
    <section class="mode-card">
      <strong>한국투자증권 API 입력 순서</strong>
      <span>1. 모의투자 또는 실전투자 선택 → 2. 계좌번호 앞 8자리와 상품코드 입력 → 3. App Key/Secret 입력 → 4. 저장 → 5. 계좌 동기화 순서로 진행합니다.</span>
    </section>
    <section class="mode-card danger">
      <strong>실전 주문 잠금</strong>
      <span>주문 전송 잠금과 실전 주문 추가 잠금을 모두 풀고 확인 문구를 입력해야만 실제 주문이 전송됩니다.</span>
    </section>`;
  panel.insertBefore(guide, grid);
}

ensureSettingsHelpLayout();

$("#symbol")?.addEventListener("input", (event) => renderSymbolResults(event.target.value));
$("#symbol")?.addEventListener("focus", (event) => renderSymbolResults(event.target.value));
document.addEventListener("click", (event) => {
  if (!event.target.closest?.(".symbol-search")) {
    const box = $("#symbol-results");
    if (box) box.hidden = true;
  }
});

$("#control-form").addEventListener("submit", (event) => {
  event.preventDefault();
  loadAll().catch(showError);
});

$("#reload-all").addEventListener("click", () => loadAll().catch(showError));
$("#projection-run").addEventListener("click", () => {
  if (appState) renderProjection(appState.result);
});
$("#save-live-portfolio")?.addEventListener("click", async () => {
  try {
    livePortfolio = readLivePortfolioInputs();
    await persistLivePortfolio();
    setLiveStatus("보유내역 저장 완료");
    await loadAll();
  } catch (error) {
    setLiveStatus(error.message);
  }
});
$("#snapshot-live-baseline")?.addEventListener("click", async () => {
  if (!appState) return;
  try {
    livePortfolio = readLivePortfolioInputs();
    livePortfolio.baselineValue = livePortfolioValue(appState.assets, livePortfolio);
    livePortfolio.baselineDate = appState.assets.SPY?.rows.at(-1)?.date || new Date().toISOString().slice(0, 10);
    await persistLivePortfolio();
    setLiveStatus("월초 감시 기준 저장 완료");
    renderLiveManager(appState.assets, appState.result);
  } catch (error) {
    setLiveStatus(error.message);
  }
});
$("#check-live-alerts")?.addEventListener("click", () => {
  setLiveStatus("가격과 알람을 갱신 중");
  loadAll().then(() => setLiveStatus("알람 점검 완료")).catch((error) => setLiveStatus(error.message));
});
$("#enable-live-alerts")?.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    setLiveStatus("이 브라우저는 알림을 지원하지 않습니다.");
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    setLiveStatus("브라우저 알림 권한이 필요합니다.");
    return;
  }
  if (liveAlertTimer) clearInterval(liveAlertTimer);
  liveAlertTimer = setInterval(() => loadAll().catch((error) => setLiveStatus(error.message)), 5 * 60 * 1000);
  setLiveStatus("5분 간격 실시간 알람 감시 중");
  loadAll().catch((error) => setLiveStatus(error.message));
});
$("#kis-refresh-status")?.addEventListener("click", () => fetchKisBrokerStatus().catch((error) => setKisStatus(error.message)));
$("#kis-sync-portfolio")?.addEventListener("click", () => syncKisPortfolio().catch((error) => setKisStatus(error.message)));
$("#kis-create-orders")?.addEventListener("click", () => {
  try {
    createKisOrdersFromPlan();
  } catch (error) {
    setKisStatus(error.message);
  }
});
$("#kis-preview-orders")?.addEventListener("click", () => previewKisOrders().catch((error) => setKisStatus(error.message)));
$("#kis-submit-orders")?.addEventListener("click", () => submitKisOrders().catch((error) => setKisStatus(error.message)));
$("#load-kis-settings")?.addEventListener("click", () => loadKisSettings().catch((error) => setSettingsStatus(error.message)));
$("#save-kis-settings")?.addEventListener("click", () => saveKisSettings().catch((error) => setSettingsStatus(error.message)));
$("#load-paper-demo")?.addEventListener("click", () => loadPaperDemoPortfolio().catch((error) => setSettingsStatus(error.message)));
$("#open-live-alerts")?.addEventListener("click", () => {
  document.querySelector('.app-tab[data-view="live"]')?.click();
});
$("#clear-notification-log")?.addEventListener("click", () => {
  writeNotificationLog([]);
  renderNotificationCenter();
});
["projection-start", "projection-end"].forEach((id) => {
  $(`#${id}`)?.addEventListener("change", () => {
    if (appState) renderProjection(appState.result);
  });
});
window.addEventListener("resize", () => {
  if (!appState) return;
  renderStockChart();
  const singleAsset = appState.assets[appState.result.benchmarkSymbol] || appState.assets.SPY || Object.values(appState.assets).find((asset) => asset?.rows?.length);
  if (singleAsset) drawSingleSummaryChart(singleAsset, indicatorSignal(singleAsset, singleAsset.rows.length - 1));
  renderChart(appState.result);
  const startIndex = eventIndexOnOrAfter(appState.result, $("#projection-start")?.value || appState.result.events[0].date);
  const endIndex = eventIndexOnOrBefore(appState.result, $("#projection-end")?.value || appState.result.events.at(-1).date);
  renderReplayChart(appState.result, buildDcaReplay(appState.result, numberValue("#capital", 10000000), numberValue("#monthly-contribution", 1000000), startIndex, endIndex));
  renderReplayMonthDetail(appState.result, selectedReplayIndex ?? endIndex);
});

function showError(error) {
  $("#next-action").textContent = "오류";
  $("#pretrade-report").innerHTML = `<p>${error.message}</p>`;
}

fetchLivePortfolio()
  .catch(() => setLiveStatus("저장된 보유내역 없음"))
  .finally(() => {
    fetchKisBrokerStatus().catch((error) => setKisStatus(error.message));
    loadKisSettings().catch((error) => setSettingsStatus(error.message));
    renderNotificationCenter();
    loadAll().catch(showError);
  });
