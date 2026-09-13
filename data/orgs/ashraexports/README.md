# Ashra Exports — textile UAT pack

Indian knitwear exporter (not Brembo). Use this tenant for the Monday textile demo.

## What is in the feed

| Piece | Count | Meaning |
|---|---|---|
| Plants | 3 | Tirupur knitwear (cut/sew/pack), Coimbatore dyeing, Noida woven |
| Brand customers | 50 | HQ sold-tos + EU/US DCs (H&M, Zara, Primark, Target, …) |
| SKUs | 21 | Fabric, trims, 6 finished garments |
| BOM | Polo / tee / hoodie / sweatpant | Card = garment, table = fabric |
| Workforce | Named planners + line ops | Sales, Planning, Cutting, Sewing, QA, Dyeing |

**Shortage SKUs (tick these):** `ASH-CMP-FAB-JSY180` (jersey mill), `ASH-CMP-FAB-FLC280` (fleece), `ASH-FG-TEE-BLK-M` (finished tee).

## Load it

```bash
cd tools/erp-import-simulator
npm run sync-orgs -- --org ashraexports
curl -s -X POST http://localhost:9090/simulator/reload
```

Admin UI: http://localhost:9090/admin/ → select **ashraexports** → **Tick: shortage**.

## Syntra tenant

Flyway `V135` creates org slug `ashraexports-org` and tenant slug **`ashraexports`** with:

- Departments: Sales, Merchandising, Planning, Fabric Store, Cutting, Sewing, Finishing, Packing, QA, Dyeing, Logistics
- Shopfloor lines: `CUT-01`, `SEW-A`, `SEW-B`, `PACK-01`, `DYE-01`, `SEW-WOVEN`, `FIN-01`
- 8 confirmed brand orders (H&M / Zara tees fighting jersey, Target/Gap hoodies fighting fleece)

Log in at `/login?org=ashraexports-org&tenant=ashraexports` (password for all: **`ChangeMe123!`**):

| Person | Email | Role |
|---|---|---|
| Priya Venkat (planner) | `priya.venkat@ashraexports.com` | Planning / ORG_ADMIN |
| Karthik Subramaniam (sales) | `karthik.sales@ashraexports.com` | Sales |
| Suresh Kumar (cutting) | `suresh.cutting@ashraexports.com` | Cutting operator |

## Connectors (real-time ERP)

Only four modules exist in **Settings → Connectors**. Run them in this order (plants/workforce are already in the tenant seed — they are not connector types):

1. **CUSTOMERS** → `https://<render-host>/feed/ashraexports/customers.json`
2. **PRODUCTS** → `https://<render-host>/feed/ashraexports/products.json`
3. **INVENTORY** → `https://<render-host>/feed/ashraexports/inventory.json`
4. **BOM** → `https://<render-host>/feed/ashraexports/bom.json`

This pack ships in the Render service (`syntra-erp-mock-simulator`). Redeploy after this commit so `/orgs` lists `ashraexports`.

Expect **0 errors**. Existing Ashra SKUs **update**; new mill/trim SKUs **create**. Inventory aggregates plant/lot rows to one on-hand per SKU (jersey CBE 420 + Tirupur 80 = 500 m).

Then: admin UI **Tick: shortage** → re-run **INVENTORY only**. Planning board should show short jersey on the H&M/Zara tee orders. **Raise PO** on `ASH-CMP-FAB-JSY180`.

Do not import plants.json or workforce.json through Connectors — those URLs are simulator-only. Shopfloor (CUT-01, SEW-A, …) and Priya/Karthik/Suresh logins come from the tenant seed.
