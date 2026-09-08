# Brembo-style feeds (optional)

When these JSON files exist in **`data/brembo/`**, the simulator exposes extra pull URLs for Syntra **ERP import connectors**:

| File (here) | Feed URL (Docker, from backend) | Syntra `importModule` |
|-------------|----------------------------------|------------------------|
| `customers.json` | `http://erp-import-simulator:9090/feed/brembo-customers.json` | `CUSTOMERS` |
| `products.json` | `http://erp-import-simulator:9090/feed/brembo-products.json` | `PRODUCTS` |
| `inventory.json` | `http://erp-import-simulator:9090/feed/brembo-inventory.json` | `INVENTORY` |
| `bom.json` | `http://erp-import-simulator:9090/feed/brembo-bom.json` | `BOM` |

OData envelope: `http://erp-import-simulator:9090/odata/brembo-products` (same pattern for other keys).

## Populate this folder

**Option A — copy from your local `sample-data/uat-brembo-brakes/` pack** (if you keep it on disk):

```bash
# from repo root
cp sample-data/uat-brembo-brakes/01-customers.json tools/erp-import-simulator/data/brembo/customers.json
cp sample-data/uat-brembo-brakes/product.json tools/erp-import-simulator/data/brembo/products.json
cp sample-data/uat-brembo-brakes/inventory.json tools/erp-import-simulator/data/brembo/inventory.json
cp sample-data/uat-brembo-brakes/03-bom-lines.json tools/erp-import-simulator/data/brembo/bom.json
```

**Option B — npm script** (same copies when the sample pack exists):

```bash
cd tools/erp-import-simulator && npm run sync-brembo
```

Then reload the simulator process (or `POST /simulator/reload` with admin token if configured).

## Simulate changing inventory (operations / MRP UAT)

```bash
cd tools/erp-import-simulator
npm run brembo-tick
npm run brembo-tick -- --scenario shortage
```

Writes `sample-data/uat-brembo-brakes/inventory.json` and pushes in-memory `brembo-inventory` without a full container restart. Re-import **INVENTORY** in Syntra after each tick (or rely on connector poll interval).

Current pack (after sync): **20** products, **32** inventory rows, **60** BOM lines, **10** customers.

## Connector order

Same as any master-data load: **CUSTOMERS → PRODUCTS → INVENTORY → BOM**.

Store column mappings on each connector once (or rely on auto-suggest). Use **`http://erp-import-simulator:9090/...`** from the **backend** container; use **`http://localhost:9090/...`** from your laptop.
