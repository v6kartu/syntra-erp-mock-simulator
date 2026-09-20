# MEAS — bulk solder, wire, and metal (kg)

Fictional **SME solder house** UAT pack. Houston blends paste, Jebel Ali draws wire, Batam mills metal. Sold by weight: 1 kg jars, 5 kg pails, 10 kg reels. Customer rows have **no email**.

Full manual UAT script: [`docs/uat-meas-solder-sme.md`](../../../../docs/uat-meas-solder-sme.md).

## What is in the feed

| Piece | Meaning |
|---|---|
| Plants | Houston blend/pack, Jebel Ali wire draw, Batam metal mill |
| Customers | EMS / auto / metal service sold-tos + dock ship-tos (no email) |
| SKUs | Tin, silver, copper, flux; SAC305 / Sn63 alloy; paste, wire, plate packs |
| UOM | **KG** |
| Lots | TANK (metals), DRUM (flux), COLD (Ag + paste), FG (wire/metal packs) |
| BOM | Alloy from metals; paste/wire = alloy + flux by kg |

**Shortage SKUs (tick these):** `MEA-CMP-AG-PWD` (silver), `MEA-FG-WIR-SAC-10KG` (10 kg reel), `MEA-FG-MTL-MIX-5KG` (mixed offcut).

## Load it

```bash
cd tools/erp-import-simulator
npm run sync-orgs -- --org meas
curl -s -X POST http://localhost:9090/simulator/reload
```

Admin UI: http://localhost:9090/admin/ → select **meas**.

## Connectors

Only four modules. Do not import plants or workforce through Connectors.

1. **CUSTOMERS** → `http://erp-import-simulator:9090/feed/meas/customers.json`
2. **PRODUCTS** → `.../feed/meas/products.json`
3. **INVENTORY** → `.../feed/meas/inventory.json` (optional `?plant=MEA-US-HOU`)
4. **BOM** → `.../feed/meas/bom.json`

Create plants and shopfloors in Plant Management yourself. Copy this folder to the Render simulator repo if you host feeds there.

## Demo orders (why Planning is not a wall of orange)

`orders.json` is a demo recipe served at `.../feed/meas/orders.json`. It is **not** imported by a Syntra connector (there is no Orders import module today). Use it as a checklist when creating orders manually in the CRM UI so the Planning board shows a real mix:

| Row prefix | Expected Planning color | Recipe |
|---|---|---|
| `MEA-SO-1xxx` | READY (green) | Comfortable promise (+22..35 d), non-shortage SKUs, FG in stock. |
| `MEA-SO-2xxx` | PARTIAL (amber) | Shortage SKUs (`MEA-CMP-AG-PWD`, `MEA-FG-WIR-SAC-10KG`, `MEA-FG-MTL-MIX-5KG`). |
| `MEA-SO-3xxx` | AT_RISK (orange) | Tight promise (+3..7 d), oversized qty. |
| `MEA-SO-4xxx` | BLOCKED (red) | `status = ON_HOLD`. |

Each row lists `customerApmId`, `sku`, `quantity` (kg), `promiseDate` (rolls forward every regen so it stays current), and `expectedReadiness` for reference. Regenerate any time with `npm run sync-orgs -- --org meas`.
