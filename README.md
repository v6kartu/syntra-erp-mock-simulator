# SyntraOS demo simulator

Public HTTP simulator for **ERP import connectors** (Syntra pulls JSON) and **Machine / IoT feeders** (this service HMAC-POSTs into Syntra).

Repo: [v6kartu/syntra-erp-mock-simulator](https://github.com/v6kartu/syntra-erp-mock-simulator)

## Why this exists

GitHub Pages can host static JSON, but a live demo needs **one-click inventory / catalog changes** without committing. This app keeps org packs in memory, lets you tick scenarios from a browser console, and optionally signs shopfloor events into sandbox Syntra.

## Quick start (local)

```bash
npm install
npm start
```

Open http://localhost:9090/admin/

Health: http://localhost:9090/health

## Organization packs (already included)

| Org | What it is |
|-----|------------|
| `valeo` | Tier-1 automotive lighting / electronics |
| `brembo` | 2W braking (calipers, pads, pistons) |
| `mercedes` | Premium braking modules |
| `rheinpumpe` | European industrial pumps |
| `ashraexports` | Indian knitwear exporter (Tirupur / Coimbatore / Noida) |
| `meas` | Solder paste, cored wire, bulk metal (1 / 5 / 10 / 25 kg) |
| `helixems` | Consumer / industrial EMS (AX routers, IoT gateway, MCU allocation) |
| `paperlane` | Stationery / paper converting (school books, copier reams) |
| `trailhaus` | Sporting-goods retail brand (DCs, stores, marketplace) |

Each pack: `customers`, `products`, `bom`, `inventory`, `plants`, `workforce`.

### Connector pull URLs

Import order: **plants → customers → products → workforce → inventory → bom**

```
http://localhost:9090/feed/brembo/plants.json
http://localhost:9090/feed/brembo/customers.json
http://localhost:9090/feed/brembo/products.json
http://localhost:9090/feed/brembo/workforce.json
http://localhost:9090/feed/brembo/inventory.json
http://localhost:9090/feed/brembo/inventory.json?plant=BRB-IN-PUN
http://localhost:9090/feed/brembo/bom.json
```

OData: `/odata/brembo/inventory`

Ashra Exports (textile demo — use these in AWS sandbox connectors after Render deploy):

```
https://<your-render-host>/feed/ashraexports/customers.json
https://<your-render-host>/feed/ashraexports/products.json
https://<your-render-host>/feed/ashraexports/inventory.json
https://<your-render-host>/feed/ashraexports/inventory.json?plant=ASH-IN-TPR
https://<your-render-host>/feed/ashraexports/bom.json
```


MEAS (solder paste / wire / metal by kg — no customer emails):

```
https://<your-render-host>/feed/meas/customers.json
https://<your-render-host>/feed/meas/products.json
https://<your-render-host>/feed/meas/inventory.json
https://<your-render-host>/feed/meas/inventory.json?plant=MEA-US-HOU
https://<your-render-host>/feed/meas/bom.json
```

Helix EMS / Paperlane / Trailhaus (electronics, stationery, sporting-goods retail):

```
https://<your-render-host>/feed/helixems/customers.json
https://<your-render-host>/feed/helixems/products.json
https://<your-render-host>/feed/helixems/inventory.json
https://<your-render-host>/feed/helixems/inventory.json?plant=HLX-CN-SZN
https://<your-render-host>/feed/helixems/bom.json

https://<your-render-host>/feed/paperlane/customers.json
https://<your-render-host>/feed/paperlane/products.json
https://<your-render-host>/feed/paperlane/inventory.json
https://<your-render-host>/feed/paperlane/inventory.json?plant=PLN-UG-KLA
https://<your-render-host>/feed/paperlane/bom.json

https://<your-render-host>/feed/trailhaus/customers.json
https://<your-render-host>/feed/trailhaus/products.json
https://<your-render-host>/feed/trailhaus/inventory.json
https://<your-render-host>/feed/trailhaus/inventory.json?plant=TRL-FR-LYS
https://<your-render-host>/feed/trailhaus/bom.json
```

Do not import plants or workforce through Connectors. Create plant structure in Syntra Plant Management.

After you deploy on **Render**, replace `http://localhost:9090` with that HTTPS origin. Paste the URLs into Syntra **ERP import connectors** and use **Run now**. Plants and workforce for Ashra stay in the Syntra tenant seed — do not import those two modules.

## Demo console (inventory + catalog)

Admin UI tabs:

| Tab | Use during a demo |
|-----|-------------------|
| **Demo scenes** | Shortage, stockout (qty 0), surge, goods receipt, balanced noise, add demo SKU, 15% price drop, reset pack, combo shortage + line PROBLEM |
| **Product catalog** | Edit list price / catalog stock, add a SKU (optionally seeds inventory) |
| **Inventory** | Set on-hand qty per SKU + plant |
| **Machine / IoT** | Clock IN/OUT/break + PLC ACTIVE / PROBLEM / MAINTENANCE / IDLE |
| **Connector URLs** | Copy pull URLs for Syntra |

Demo edits stay **in memory**. **Reset pack** restores the files that shipped in git. Set `PERSIST_FEEDS=1` only if you want ticks written back to `data/orgs`.

HTTP (same as the buttons):

```bash
# Inventory story
curl -s -X POST http://localhost:9090/simulator/orgs/brembo/scenario \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"shortage","plant":"BRB-IN-PUN"}'

# Catalog story
curl -s -X POST http://localhost:9090/simulator/orgs/brembo/scenario \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"new-product"}'

# Exact qty
curl -s -X PATCH http://localhost:9090/simulator/orgs/brembo/inventory \
  -H 'Content-Type: application/json' \
  -d '{"sku":"BRB-FG-YAM-R15F","plant":"BRB-IN-PUN","quantity":0}'
```

Scenarios: `shortage` | `surge` | `receipt` | `balanced` | `stockout` | `price-drop` | `new-product` | `reset`

## Machine / IoT feeders

These **push into Syntra** (they are not pull mocks):

| Device | Syntra URL | Credential scope |
|--------------------|------------------|
| Badge reader | `POST /api/integrations/shopfloor/clock` | `SHOPFLOOR` |
| PLC / machine | `POST /api/integrations/production-lines/status` | `PRODUCTION_IOT` |

Line status values: `ACTIVE` | `MAINTENANCE` | `PROBLEM` | `IDLE`

1. In Syntra, mint two integration credentials and register a badge (`BADGE-001`).
2. Open **Machine / IoT**, paste API URL (`https://api.syntrasystems.cloud` or `http://host.docker.internal:8080`), tenant UUID, keys, line department UUID, badge token.
3. Click **Save feeder config**, then **Clock IN** or **PROBLEM**.

Without keys, events are stored locally (`202`) so you can still show the device API (`GET /iot/devices`).

```bash
curl -s -X POST http://localhost:9090/iot/config \
  -H 'Content-Type: application/json' \
  -d '{
    "apiUrl":"https://api.syntrasystems.cloud",
    "tenant":"<uuid>",
    "shopKey":"...",
    "shopSecret":"...",
    "iotKey":"...",
    "iotSecret":"...",
    "lines":[{"name":"Line A","departmentId":"<uuid>","plcDeviceId":"sim-plc-01"}],
    "badges":[{"token":"BADGE-001","departmentId":"<uuid>","deviceId":"sim-reader-01"}]
  }'

curl -s -X POST http://localhost:9090/iot/scenario -H 'Content-Type: application/json' -d '{"scenario":"shift-start"}'
curl -s -X POST http://localhost:9090/iot/scenario -H 'Content-Type: application/json' -d '{"scenario":"line-problem"}'
```

CLI (same HMAC as SyntraOS `scripts/iot/simulate_shopfloor.py`):

```bash
python3 scripts/iot/simulate_shopfloor.py clock \
  --base-url https://api.syntrasystems.cloud \
  --tenant <uuid> --key-id <shop-key> --secret <shop-secret> \
  --badge-token BADGE-001 --department <line-uuid> --event-type IN
```

Do **not** commit secrets. Use the UI, Render env vars, or `.env` (gitignored).

## Free hosting (recommended: Render)

Static GitHub Pages cannot change inventory during a demo. Use a free Node host:

1. Open [Render](https://render.com) → **New → Blueprint** (or Web Service) → this GitHub repo.
2. Docker runtime, health check `/health`. `render.yaml` is included.
3. After deploy, Syntra pull URLs become `https://<service>.onrender.com/feed/brembo/products.json`.
4. Optional env: `SYNTRAOS_*` from `.env.example`.

Free Render sleeps after idle; the first request after sleep can take ~30s. Sandbox Syntra ECS is also off 00:00–09:00 Stockholm — do not IoT-tick overnight.

**Fly.io** alternative: `fly launch` from this directory (Dockerfile is ready).

## Auth (optional)

| Env | Effect |
|-----|--------|
| `ERP_SIMULATOR_TOKEN` | GET `/feed/*` requires `Authorization: Bearer` (match Syntra connector token) |
| `ERP_SIMULATOR_ADMIN_TOKEN` | POST/PATCH require `x-simulator-token` |
| `DEFAULT_ORG` | Legacy `/feed/products.json` alias (default `valeo`) |

## Pack layout

```
data/orgs/{orgId}/
  manifest.json
  customers.json  products.json  bom.json
  inventory.json  plants.json    workforce.json
  scenarios/
data/iot/devices.json
```
