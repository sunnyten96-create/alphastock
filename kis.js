import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const US_EXCHANGES = new Set(["NASD", "NYSE", "AMEX"]);
const MODE_CONFIG = {
  paper: {
    env: "demo",
    baseUrl: "https://openapivts.koreainvestment.com:29443",
    buyTr: "VTTT1002U",
    sellTr: "VTTT1006U",
    balanceTr: "VTTS3012R",
    confirm: "EXECUTE_PAPER"
  },
  live: {
    env: "real",
    baseUrl: "https://openapi.koreainvestment.com:9443",
    buyTr: "TTTT1002U",
    sellTr: "TTTT1006U",
    balanceTr: "TTTS3012R",
    confirm: "EXECUTE_LIVE"
  }
};

function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function safeSymbol(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9.^-]/g, "");
}

function numberFrom(record, keys) {
  for (const key of keys) {
    const value = String(record?.[key] ?? "").replace(/,/g, "");
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function firstText(record, keys) {
  for (const key of keys) {
    const value = text(record?.[key]);
    if (value) return value;
  }
  return "";
}

function secretFor(mode, prefix, fallback) {
  return text(process.env[`${prefix}_${mode.toUpperCase()}`] || process.env[fallback]);
}

function kisMode() {
  const mode = text(process.env.KIS_TRADING_MODE || "paper").toLowerCase();
  if (!(mode in MODE_CONFIG)) throw new Error("KIS_TRADING_MODE must be paper or live");
  return mode;
}

function kisConfig(dataDir) {
  const mode = kisMode();
  const configuredMode = MODE_CONFIG[mode];
  return {
    ...configuredMode,
    mode,
    appKey: secretFor(mode, "KIS_APP_KEY", "KIS_APP_KEY"),
    appSecret: secretFor(mode, "KIS_APP_SECRET", "KIS_APP_SECRET"),
    account: text(process.env.KIS_ACCOUNT_NO),
    product: text(process.env.KIS_ACCOUNT_PRODUCT || "01"),
    exchange: text(process.env.KIS_OVERSEAS_EXCHANGE || "NASD").toUpperCase(),
    currency: text(process.env.KIS_OVERSEAS_CURRENCY || "USD").toUpperCase(),
    hashOrders: text(process.env.KIS_HASH_ORDERS || "true").toLowerCase() !== "false",
    executionEnabled: text(process.env.KIS_ORDER_EXECUTION).toLowerCase() === "enabled",
    liveOrdersAllowed: text(process.env.KIS_ALLOW_LIVE_ORDERS).toLowerCase() === "true",
    tokenPath: path.join(dataDir, `kis-token-${mode}.json`)
  };
}

function requireConfig(config) {
  if (!config.appKey || !config.appSecret) throw new Error(`KIS ${config.mode} app key and app secret are required`);
  if (!config.account) throw new Error("KIS_ACCOUNT_NO is required");
  if (!config.product) throw new Error("KIS_ACCOUNT_PRODUCT is required");
}

async function fetchKis(config, pathname, options = {}) {
  const response = await fetch(`${config.baseUrl}${pathname}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`KIS ${pathname} returned ${response.status}: ${payload.msg1 || payload.message || "request failed"}`);
  }
  return payload;
}

async function readToken(config) {
  try {
    const token = JSON.parse(await readFile(config.tokenPath, "utf8"));
    if (token.accessToken && Number(token.expiresAt) > Date.now() + 60_000) return token.accessToken;
  } catch {
    return "";
  }
  return "";
}

async function writeToken(config, payload) {
  const expiresIn = Math.max(0, Number(payload.expires_in || payload.expiresIn || 0));
  const token = {
    accessToken: payload.access_token,
    tokenType: payload.token_type || "Bearer",
    expiresAt: Date.now() + expiresIn * 1000
  };
  await mkdir(path.dirname(config.tokenPath), { recursive: true });
  await writeFile(config.tokenPath, `${JSON.stringify(token, null, 2)}\n`, "utf8");
  return token.accessToken;
}

async function accessToken(config) {
  const cached = await readToken(config);
  if (cached) return cached;
  const payload = await fetchKis(config, "/oauth2/tokenP", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: config.appKey,
      appsecret: config.appSecret
    })
  });
  if (!payload.access_token) throw new Error("KIS token response did not include access_token");
  return writeToken(config, payload);
}

async function baseHeaders(config, trId) {
  return {
    authorization: `Bearer ${await accessToken(config)}`,
    appkey: config.appKey,
    appsecret: config.appSecret,
    tr_id: trId,
    custtype: "P",
    tr_cont: "",
    "content-type": "application/json"
  };
}

async function hashKey(config, body) {
  const payload = await fetchKis(config, "/uapi/hashkey", {
    method: "POST",
    headers: {
      appkey: config.appKey,
      appsecret: config.appSecret,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const hash = payload.HASH || payload.hash;
  if (!hash) throw new Error("KIS hashkey response did not include HASH");
  return hash;
}

function holdingFromKis(row) {
  const symbol = safeSymbol(firstText(row, ["ovrs_pdno", "pdno", "symb", "ticker"]));
  const quantity = numberFrom(row, ["ovrs_cblc_qty", "ord_psbl_qty", "hldg_qty", "qty"]);
  const value = numberFrom(row, ["ovrs_stck_evlu_amt", "frcr_evlu_amt2", "evlu_amt", "pchs_amt"]);
  return symbol && (quantity > 0 || value > 0) ? { symbol, quantity, value } : null;
}

function accountCashFromKis(summaryRows) {
  const summary = Array.isArray(summaryRows) ? summaryRows[0] : summaryRows;
  return numberFrom(summary, ["frcr_dncl_amt_2", "frcr_dncl_amt", "ord_psbl_frcr_amt", "cash_bal"]);
}

function rows(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function sanitizeOrder(input, config) {
  const side = text(input.side || input.ord_dv).toLowerCase();
  const exchange = text(input.exchange || input.ovrs_excg_cd || config.exchange).toUpperCase();
  const symbol = safeSymbol(input.symbol || input.pdno);
  const quantity = Math.floor(numberFrom(input, ["quantity", "ord_qty"]));
  const limitPrice = numberFrom(input, ["limitPrice", "ovrs_ord_unpr"]);
  if (!["buy", "sell"].includes(side)) throw new Error("KIS order side must be buy or sell");
  if (!US_EXCHANGES.has(exchange)) throw new Error("This adapter currently stages US overseas orders only");
  if (!symbol) throw new Error("KIS order symbol is required");
  if (!(quantity > 0)) throw new Error(`KIS order quantity is required for ${symbol}`);
  if (!(limitPrice > 0)) throw new Error(`KIS limitPrice is required for ${symbol}`);
  return {
    side,
    exchange,
    symbol,
    quantity: String(quantity),
    limitPrice: String(limitPrice),
    orderDivision: text(input.orderDivision || input.ord_dvsn || "00")
  };
}

async function submitOrder(config, order) {
  const body = {
    CANO: config.account,
    ACNT_PRDT_CD: config.product,
    OVRS_EXCG_CD: order.exchange,
    PDNO: order.symbol,
    ORD_QTY: order.quantity,
    OVRS_ORD_UNPR: order.limitPrice,
    CTAC_TLNO: "",
    MGCO_APTM_ODNO: "",
    SLL_TYPE: order.side === "sell" ? "00" : "",
    ORD_SVR_DVSN_CD: "0",
    ORD_DVSN: order.orderDivision
  };
  const trId = order.side === "buy" ? config.buyTr : config.sellTr;
  const headers = await baseHeaders(config, trId);
  if (config.hashOrders) headers.hashkey = await hashKey(config, body);
  const payload = await fetchKis(config, "/uapi/overseas-stock/v1/trading/order", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (payload.rt_cd && payload.rt_cd !== "0") throw new Error(`KIS order rejected: ${payload.msg1 || payload.msg_cd}`);
  return { order, trId, response: payload };
}

export function kisStatus(dataDir) {
  const config = kisConfig(dataDir);
  return {
    mode: config.mode,
    baseUrl: config.baseUrl,
    accountConfigured: Boolean(config.account),
    credentialsConfigured: Boolean(config.appKey && config.appSecret),
    executionEnabled: config.executionEnabled,
    liveOrdersAllowed: config.liveOrdersAllowed,
    orderConfirmation: config.confirm,
    balanceDefaults: { exchange: config.exchange, currency: config.currency }
  };
}

export async function syncKisOverseasPortfolio(dataDir, overrides = {}) {
  const config = kisConfig(dataDir);
  requireConfig(config);
  const exchange = text(overrides.exchange || config.exchange).toUpperCase();
  const currency = text(overrides.currency || config.currency).toUpperCase();
  const url = new URL("/uapi/overseas-stock/v1/trading/inquire-balance", config.baseUrl);
  url.searchParams.set("CANO", config.account);
  url.searchParams.set("ACNT_PRDT_CD", config.product);
  url.searchParams.set("OVRS_EXCG_CD", exchange);
  url.searchParams.set("TR_CRCY_CD", currency);
  url.searchParams.set("CTX_AREA_FK200", "");
  url.searchParams.set("CTX_AREA_NK200", "");
  const response = await fetch(url, { headers: await baseHeaders(config, config.balanceTr) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (payload.rt_cd && payload.rt_cd !== "0")) {
    throw new Error(`KIS balance failed: ${payload.msg1 || payload.msg_cd || response.status}`);
  }
  const holdingRows = rows(payload.output1);
  const summaryRows = rows(payload.output2);
  return {
    portfolio: {
      cash: accountCashFromKis(summaryRows),
      holdings: holdingRows.map(holdingFromKis).filter(Boolean)
    },
    broker: {
      mode: config.mode,
      exchange,
      currency,
      holdingCount: holdingRows.length,
      holdingFields: Object.keys(holdingRows[0] || {}),
      summaryFields: Object.keys(summaryRows[0] || {})
    }
  };
}

export function previewKisOrders(dataDir, payload = {}) {
  const config = kisConfig(dataDir);
  const orders = rows(payload.orders).map((order) => sanitizeOrder(order, config));
  return {
    mode: config.mode,
    exchangeScope: "US overseas limit orders",
    executionEnabled: config.executionEnabled,
    confirmationRequired: config.confirm,
    liveOrdersAllowed: config.liveOrdersAllowed,
    orders
  };
}

export async function executeKisOrders(dataDir, payload = {}) {
  const config = kisConfig(dataDir);
  const preview = previewKisOrders(dataDir, payload);
  if (!config.executionEnabled) throw new Error("KIS_ORDER_EXECUTION=enabled is required before orders can be sent");
  if (config.mode === "live" && !config.liveOrdersAllowed) throw new Error("KIS_ALLOW_LIVE_ORDERS=true is required for live orders");
  if (text(payload.confirm) !== config.confirm) throw new Error(`Order confirmation must be ${config.confirm}`);
  requireConfig(config);
  const results = [];
  for (const order of preview.orders) results.push(await submitOrder(config, order));
  return { ...preview, submitted: results.length, results };
}
