# KIS Broker And Free Hosting

This project now includes a guarded Korea Investment & Securities overseas-stock adapter for the live portfolio tab.

## Safety Defaults

- `KIS_TRADING_MODE` defaults to `paper`.
- Broker order transmission stays locked until `KIS_ORDER_EXECUTION=enabled`.
- Live orders also require `KIS_ALLOW_LIVE_ORDERS=true`.
- Every order request must include the mode-specific confirmation phrase returned by `/api/kis/status`.
- The adapter accepts explicit US overseas limit orders. It does not silently convert a recommendation into a live market order.

Start with KIS virtual trading. Verify account sync, order preview, submitted virtual orders, fills, and portfolio values before considering live credentials.

## Local KIS Setup

1. Copy `.env.example` to `.env`.
2. Fill the KIS virtual-trading app key, app secret, account number, and product code.
3. Keep this paper configuration while validating the dashboard:

```env
KIS_TRADING_MODE=paper
KIS_ORDER_EXECUTION=disabled
KIS_ALLOW_LIVE_ORDERS=false
```

4. Run the server and open the `실전 운용` tab.
5. Press `KIS 상태`, then `계좌 동기화`.
6. Validate a draft overseas limit order:

```json
[
  {
    "side": "buy",
    "symbol": "QQQ",
    "exchange": "NASD",
    "quantity": 1,
    "limitPrice": 520.25
  }
]
```

Order preview uses `POST /api/kis/orders/preview`. Order transmission uses `POST /api/kis/orders` and stays locked unless the environment and confirmation string both allow it.

## Broker Endpoints

| Endpoint | Use |
| --- | --- |
| `GET /api/kis/status` | Show mode, configuration presence, order lock, and confirmation phrase without exposing secrets. |
| `POST /api/kis/sync` | Read overseas KIS balance and save it as the dashboard live portfolio. |
| `POST /api/kis/orders/preview` | Validate explicit US overseas limit-order drafts. |
| `POST /api/kis/orders` | Submit the validated drafts after order locks and confirmation checks pass. |

The current KIS balance sync defaults to `NASD` and `USD`. Set `KIS_OVERSEAS_EXCHANGE` and `KIS_OVERSEAS_CURRENCY` when the account uses another supported overseas market.

## Free Hosting Choice

For a web-only dashboard deployment, see `DEPLOY_FREE.md`. The project includes `render.yaml`, `/healthz`, and optional password protection through `APP_USER` / `APP_PASSWORD`.

For an alerting or auto-trading process, prefer an always-on VM over a free web-service tier that sleeps after inactivity. An Oracle Cloud Always Free VM is the practical free path for this app. Keep the instance small, patch it, restrict inbound ports, and expect the provider to reclaim idle Always Free compute in some conditions.

Render free web services are useful for a dashboard preview, but they spin down when idle and their local filesystem is not durable. That is not a good base for unattended broker work or token files.

## Oracle VM Deployment

On a Linux VM with Docker installed:

```bash
git clone YOUR_REPOSITORY_URL fund-manager
cd fund-manager
cp .env.example .env
docker build -t fund-manager-kis .
docker run -d --restart unless-stopped --name fund-manager-kis \
  --env-file .env \
  -p 5173:5173 \
  -v "$(pwd)/data:/app/data" \
  fund-manager-kis
```

Expose the dashboard through a reverse proxy with HTTPS and authentication before putting it on the public internet. Do not publish `.env`, KIS token-cache files, or an unauthenticated order endpoint.

## Live Cutover Checklist

1. Paper account sync matches the KIS app.
2. Virtual limit orders submit and fill as expected.
3. Portfolio currency and monthly contribution units are intentionally aligned.
4. The server clock and market-session schedule are correct.
5. Alerts have a delivery path outside the browser when unattended operation is required.
6. Only then set live credentials, switch `KIS_TRADING_MODE=live`, and decide whether to unlock live orders.
