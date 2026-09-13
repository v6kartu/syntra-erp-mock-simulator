# Organization ERP packs

Each subdirectory is one organization (ERP client) with complete UAT feeds:

```
orgs/{orgId}/
  manifest.json
  customers.json
  products.json
  bom.json
  inventory.json
  plants.json
  workforce.json
  scenarios/
```

Regenerate from sample-data:

```bash
cd tools/erp-import-simulator
npm run sync-orgs
npm run sync-orgs -- --org rheinpumpe
```

Current generated packs:

- `valeo` — Tier-1 automotive electronics and lighting
- `brembo` — 2W braking systems
- `mercedes` — premium braking modules
- `rheinpumpe` — European industrial pumps (DE/CZ/ES/FR)
- `ashraexports` — Indian knitwear exporter (Tirupur / Coimbatore / Noida)

Feed URLs: `/feed/{orgId}/{module}.json` and optional `?plant={code}`.
