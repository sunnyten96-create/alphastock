# AlphaStock Free Web Deployment

This app is now ready for a free hosted dashboard deployment.

## Recommended Path: Render Free Web Service

Use this when you want to open AlphaStock from the web as a dashboard/advisory tool.

1. Push this folder to a private GitHub repository.
2. In Render, create a new Blueprint or Web Service from that repository.
3. Render will read `render.yaml` and build the Docker image.
4. Set `APP_PASSWORD` in Render environment variables before the first public use.
5. Open the generated `https://...onrender.com` URL and log in with:
   - user: `alphastock`
   - password: the `APP_PASSWORD` you set

Render free services can sleep when idle. The first load after sleep may take time. This is acceptable for viewing the dashboard, but not ideal for unattended alerts or broker automation.

## What Is Included In The Docker Image

- `public/` dashboard UI
- `server.js` API server
- `kis.js` guarded KIS adapter
- latest research snapshot:
  - `data/research-report.json`
  - `data/research-report.md`
  - `data/model-registry.json`

Private runtime files are intentionally excluded:

- `.env`
- `data/portfolio.json`
- `data/kis-token-*.json`
- server logs

## Public Server Safety

Always set `APP_PASSWORD` on a public URL. Without it, anyone with the URL can access the dashboard and API routes.

For a public dashboard, keep broker execution locked:

```env
KIS_TRADING_MODE=paper
KIS_ORDER_EXECUTION=disabled
KIS_ALLOW_LIVE_ORDERS=false
```

Do not enable live orders on a sleeping free web service. Use a private always-on VM with HTTPS, authentication, persistent storage, and monitored logs before considering real broker execution.

## Health Check

The server exposes:

```text
/healthz
```

Render uses this route to confirm that the container is running.

## Local Docker Test

```bash
docker build -t alphastock .
docker run --rm -p 5173:5173 -e APP_PASSWORD=change-me alphastock
```

Then open `http://localhost:5173`.
