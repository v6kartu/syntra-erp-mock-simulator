/**
 * Local ERP pull simulator — organization-scoped feeds for Syntra connectors.
 *
 * Org packs live under data/orgs/{orgId}/ (customers, products, bom, inventory, plants, workforce).
 *
 * GET  /orgs                              — list orgs + plants + row counts
 * GET  /orgs/:org                         — one org manifest + sizes
 * GET  /feed/:org/:module.json            — flat JSON array (?plant= optional)
 * GET  /odata/:org/:module                — OData { value: [...] }
 * GET  /feed/:file.json                   — legacy flat / brembo-* aliases
 * POST /simulator/orgs/:org/feeds/:module — replace in-memory module
 * POST /simulator/orgs/:org/reload        — reload one org from disk
 * POST /simulator/orgs/:org/tick          — inventory tick { scenario, plant? }
 * POST /simulator/feeds/:name             — legacy push
 * POST /simulator/reload                  — reload all
 * GET  /admin                             — control UI
 * GET  /health
 *
 * Optional: ERP_SIMULATOR_TOKEN (Bearer on GET), ERP_SIMULATOR_ADMIN_TOKEN (x-simulator-token on POST)
 * DEFAULT_ORG — legacy /feed/products.json alias target (default: valeo)
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mountDemoRoutes } from './lib/demo-routes.mjs';
import { mountIotRoutes } from './lib/iot-routes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
const orgsDir = path.join(dataDir, 'orgs');
const publicDir = path.join(__dirname, 'public');

const CORE_MODULES = ['customers', 'products', 'bom', 'inventory', 'plants', 'workforce', 'orders'];
const LEGACY_CORE = ['products', 'inventory', 'bom', 'customers'];
const DEFAULT_ORG = (process.env.DEFAULT_ORG || 'valeo').trim();

/** @type {Record<string, { manifest: object, feeds: Record<string, any[]> }>} */
const orgs = Object.create(null);
/** Immutable copies used by the "reset" demo scene */
const baselines = Object.create(null);
/** Legacy flat keys for backward compat */
const legacyFeeds = Object.create(null);

const eventLog = [];
function pushEvent(evt) {
  eventLog.unshift({ ...evt, at: new Date().toISOString() });
  if (eventLog.length > 200) eventLog.length = 200;
}

function readJsonSafe(p, fallback = null) {
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function listOrgIds() {
  if (!fs.existsSync(orgsDir)) return [];
  return fs
    .readdirSync(orgsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort();
}

function loadOrgFromDisk(orgId) {
  const dir = path.join(orgsDir, orgId);
  if (!fs.existsSync(dir)) return null;

  const manifest =
    readJsonSafe(path.join(dir, 'manifest.json'), {
      orgId,
      displayName: orgId,
      plants: [],
      modules: CORE_MODULES,
      importOrder: CORE_MODULES,
    }) || { orgId };

  const feeds = Object.create(null);
  for (const mod of CORE_MODULES) {
    const p = path.join(dir, `${mod}.json`);
    if (!fs.existsSync(p)) continue;
    const data = readJsonSafe(p, []);
    if (!Array.isArray(data)) {
      throw new Error(`${orgId}/${mod}.json must be a JSON array`);
    }
    feeds[mod] = data;
  }
  return { manifest, feeds };
}

function cloneOrg(loaded) {
  return JSON.parse(JSON.stringify(loaded));
}

function loadAllOrgsFromDisk() {
  for (const k of Object.keys(orgs)) delete orgs[k];
  for (const k of Object.keys(baselines)) delete baselines[k];
  for (const id of listOrgIds()) {
    const loaded = loadOrgFromDisk(id);
    if (loaded && Object.keys(loaded.feeds).length) {
      baselines[id] = cloneOrg(loaded);
      orgs[id] = cloneOrg(loaded);
      console.log(
        `[orgs] loaded ${id} (${Object.entries(loaded.feeds)
          .map(([m, rows]) => `${m}:${rows.length}`)
          .join(', ')})`,
      );
    }
  }
}

function loadLegacyFlatFromDisk() {
  for (const k of Object.keys(legacyFeeds)) delete legacyFeeds[k];
  for (const key of LEGACY_CORE) {
    const p = path.join(dataDir, `${key}.json`);
    if (!fs.existsSync(p)) continue;
    const data = readJsonSafe(p, []);
    if (Array.isArray(data)) legacyFeeds[key] = data;
  }
  // Legacy data/brembo/*.json → brembo-* keys (and mirror into orgs.brembo if missing)
  const bdir = path.join(dataDir, 'brembo');
  if (fs.existsSync(bdir)) {
    for (const mod of ['customers', 'products', 'inventory', 'bom']) {
      const p = path.join(bdir, `${mod}.json`);
      if (!fs.existsSync(p)) continue;
      const data = readJsonSafe(p, []);
      if (!Array.isArray(data)) continue;
      legacyFeeds[`brembo-${mod}`] = data;
    }
  }
}

function loadAllFromDisk() {
  loadAllOrgsFromDisk();
  loadLegacyFlatFromDisk();
  // If no orgs yet, keep serving legacy only
  if (Object.keys(orgs).length === 0) {
    console.warn('[orgs] No data/orgs/* packs found. Run: npm run sync-orgs');
  }
}

function filterByPlant(module, rows, plant) {
  if (!plant || !Array.isArray(rows)) return rows;
  const p = String(plant).trim();
  if (!p) return rows;

  if (module === 'inventory') {
    return rows.filter((r) => String(r.plant || r.werks || r.location || '') === p);
  }
  if (module === 'plants') {
    return rows.filter((r) => String(r.code || r.werks || '') === p);
  }
  if (module === 'workforce') {
    return rows.filter((r) => String(r.plantCode || r.plant || '') === p);
  }
  // customers / products / bom — return full org catalog (plant is inventory/workforce scoped)
  return rows;
}

function resolveFeedRows(orgId, module, plant) {
  const org = orgs[orgId];
  if (!org) return null;
  const rows = org.feeds[module];
  if (!rows) return null;
  return filterByPlant(module, rows, plant);
}

function qtyField(row) {
  if (row.availableQuantity != null) return 'availableQuantity';
  if (row.quantityOnHand != null) return 'quantityOnHand';
  return 'availableQuantity';
}

function readQty(row) {
  const n = Number(row[qtyField(row)]);
  return Number.isFinite(n) ? n : 0;
}

function writeQty(row, value) {
  row[qtyField(row)] = String(Math.max(0, Math.round(value)));
  row.lastUpdated = new Date().toISOString();
}

function applyInventoryTick(rows, scenario, manifest, plantFilter) {
  const shortage = new Set(manifest?.shortageSkus || []);
  const surge = new Set(manifest?.surgeSkus || []);
  const out = rows.map((r) => ({ ...r }));
  for (const row of out) {
    if (plantFilter && String(row.plant || row.werks || row.location || '') !== plantFilter) {
      continue;
    }
    const sku = row.sku;
    let delta = 0;
    switch (scenario) {
      case 'shortage':
        if (shortage.has(sku) || (shortage.size === 0 && String(sku || '').includes('FG'))) {
          delta = -Math.floor(Math.random() * 40 + 15);
        } else {
          delta = Math.floor(Math.random() * 8) - 2;
        }
        break;
      case 'surge':
        if (surge.has(sku)) delta = Math.floor(Math.random() * 120 + 40);
        else if (shortage.has(sku)) delta = Math.floor(Math.random() * 25 + 10);
        else delta = Math.floor(Math.random() * 20) - 5;
        break;
      case 'receipt':
        if (shortage.has(sku)) delta = Math.floor(Math.random() * 800 + 400);
        else if (String(sku || '').startsWith(String(manifest?.productSkuPrefixes?.[0] || '').replace(/-$/, '') + '-FG') || String(sku || '').includes('-FG-')) {
          delta = Math.floor(Math.random() * 60 + 20);
        } else {
          delta = Math.floor(Math.random() * 15);
        }
        break;
      case 'balanced':
      default:
        delta = Math.floor(Math.random() * 41) - 15;
        break;
    }
    writeQty(row, readQty(row) + delta);
  }
  return out;
}

function persistOrgModule(orgId, module, rows) {
  if (String(process.env.PERSIST_FEEDS || '').trim() !== '1') return;
  const p = path.join(orgsDir, orgId, `${module}.json`);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(rows, null, 2) + '\n');
  } catch (e) {
    console.warn(`[persist] ${orgId}/${module} not written (${e.code || e.message}) — keeping in-memory`);
  }
}

function resetOrgFromBaseline(orgId) {
  const base = baselines[orgId];
  if (!base) return null;
  orgs[orgId] = cloneOrg(base);
  return orgs[orgId];
}

function authFeedMiddleware(req, res, next) {
  const t = process.env.ERP_SIMULATOR_TOKEN;
  if (!t || !String(t).trim()) return next();
  const h = req.headers.authorization ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  const got = m ? m[1].trim() : h.trim();
  if (got !== String(t).trim()) {
    return res.status(401).json({
      error: 'Unauthorized',
      hint: 'Set connector bearer to match ERP_SIMULATOR_TOKEN, or unset token on simulator.',
    });
  }
  next();
}

function adminMiddleware(req, res, next) {
  const admin = process.env.ERP_SIMULATOR_ADMIN_TOKEN;
  if (!admin || !String(admin).trim()) return next();
  const got = req.headers['x-simulator-token'];
  if (got !== String(admin).trim()) {
    return res.status(401).json({ error: 'Invalid or missing x-simulator-token header' });
  }
  next();
}

function orgSummary(orgId) {
  const org = orgs[orgId];
  if (!org) return null;
  return {
    orgId,
    displayName: org.manifest.displayName || orgId,
    plants: org.manifest.plants || [],
    importOrder: org.manifest.importOrder || CORE_MODULES,
    modules: Object.fromEntries(
      Object.entries(org.feeds).map(([m, rows]) => [m, rows.length]),
    ),
    connectorUrlsHint: org.manifest.connectorUrlsHint || {},
  };
}

loadAllFromDisk();

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-simulator-token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.get('/', (_req, res) => res.redirect('/admin/'));
if (fs.existsSync(publicDir)) {
  app.use('/admin', express.static(publicDir));
}

app.get('/health', (_req, res) => {
  const orgIds = Object.keys(orgs).sort();
  res.json({
    ok: true,
    service: 'erp-import-simulator',
    orgs: orgIds.map((id) => orgSummary(id)),
    legacyFeeds: Object.keys(legacyFeeds).sort().map((k) => ({ name: k, rows: legacyFeeds[k]?.length ?? 0 })),
    authRequired: Boolean(process.env.ERP_SIMULATOR_TOKEN?.trim()),
    admin: '/admin/',
    iot: { devices: '/iot/devices', clock: 'POST /iot/clock', lineStatus: 'POST /iot/line-status' },
    hint:
      orgIds.length === 0
        ? 'No org packs. From tools/erp-import-simulator run: npm run sync-orgs'
        : `${orgIds.length} org pack(s) loaded`,
  });
});

app.get('/orgs', (_req, res) => {
  res.json({
    orgs: Object.keys(orgs)
      .sort()
      .map((id) => orgSummary(id)),
  });
});

app.get('/orgs/:org', (req, res) => {
  const s = orgSummary(req.params.org);
  if (!s) return res.status(404).json({ error: 'Unknown org', known: Object.keys(orgs) });
  res.json(s);
});

app.get('/simulator/events', (_req, res) => {
  res.json({ events: eventLog.slice(0, 50) });
});

app.get('/feed/:org/:module', authFeedMiddleware, (req, res) => {
  const orgId = req.params.org;
  const module = req.params.module.replace(/\.json$/i, '');
  const plant = req.query.plant;
  const rows = resolveFeedRows(orgId, module, plant);
  if (!rows) {
    return res.status(404).json({
      error: 'Unknown feed',
      org: orgId,
      module,
      knownOrgs: Object.keys(orgs),
      knownModules: orgs[orgId] ? Object.keys(orgs[orgId].feeds) : [],
    });
  }
  res.type('application/json');
  res.send(JSON.stringify(rows));
});

app.get('/odata/:org/:module', authFeedMiddleware, (req, res) => {
  const orgId = req.params.org;
  const module = req.params.module.replace(/\.json$/i, '');
  const plant = req.query.plant || req.query.$filter?.match(/werks eq '([^']+)'/i)?.[1];
  const rows = resolveFeedRows(orgId, module, plant);
  if (!rows) {
    return res.status(404).json({ error: 'Unknown feed', org: orgId, module });
  }
  res.json({ value: rows, '@odata.context': `http://simulator/${orgId}/$metadata` });
});

/** Legacy single-segment feed routes */
app.get('/feed/:file', authFeedMiddleware, (req, res) => {
  const base = req.params.file.replace(/\.json$/i, '');

  // Alias: brembo-inventory → orgs.brembo.inventory (or legacy)
  const bremboMatch = /^brembo-(.+)$/.exec(base);
  if (bremboMatch) {
    const mod = bremboMatch[1];
    const fromOrg = resolveFeedRows('brembo', mod, req.query.plant);
    if (fromOrg) {
      res.type('application/json');
      return res.send(JSON.stringify(fromOrg));
    }
    if (legacyFeeds[base]) {
      res.type('application/json');
      return res.send(JSON.stringify(legacyFeeds[base]));
    }
  }

  // Alias core modules to DEFAULT_ORG when org pack exists
  if (LEGACY_CORE.includes(base) && orgs[DEFAULT_ORG]?.feeds[base]) {
    const rows = filterByPlant(base, orgs[DEFAULT_ORG].feeds[base], req.query.plant);
    res.type('application/json');
    return res.send(JSON.stringify(rows));
  }

  if (legacyFeeds[base]) {
    res.type('application/json');
    return res.send(JSON.stringify(legacyFeeds[base]));
  }

  return res.status(404).json({
    error: 'Unknown feed',
    file: req.params.file,
    hint: 'Use /feed/{org}/{module}.json — e.g. /feed/brembo/inventory.json?plant=BRB-IN-PUN',
    knownOrgs: Object.keys(orgs),
  });
});

app.post('/simulator/orgs/:org/feeds/:module', adminMiddleware, (req, res) => {
  const orgId = req.params.org;
  const module = req.params.module.replace(/\.json$/i, '');
  if (!orgs[orgId]) {
    return res.status(404).json({ error: 'Unknown org', known: Object.keys(orgs) });
  }
  let body = req.body;
  if (body && typeof body === 'object' && Array.isArray(body.rows)) body = body.rows;
  if (!Array.isArray(body)) {
    return res.status(400).json({ error: 'Body must be a JSON array or { "rows": [...] }' });
  }
  orgs[orgId].feeds[module] = body;
  persistOrgModule(orgId, module, body);
  // Keep legacy brembo-* in sync
  if (orgId === 'brembo' && ['customers', 'products', 'inventory', 'bom'].includes(module)) {
    legacyFeeds[`brembo-${module}`] = body;
  }
  pushEvent({ type: 'FEED_PUSH', org: orgId, module, rows: body.length });
  res.json({ ok: true, org: orgId, module, rows: body.length });
});

app.post('/simulator/orgs/:org/reload', adminMiddleware, (req, res) => {
  const orgId = req.params.org;
  const restored = resetOrgFromBaseline(orgId);
  if (!restored) return res.status(404).json({ error: 'Unknown org', org: orgId });
  pushEvent({ type: 'ORG_RELOAD', org: orgId });
  res.json({ ok: true, org: orgSummary(orgId) });
});

app.post('/simulator/orgs/:org/tick', adminMiddleware, (req, res) => {
  const orgId = req.params.org;
  const org = orgs[orgId];
  if (!org) return res.status(404).json({ error: 'Unknown org', known: Object.keys(orgs) });
  const inventory = org.feeds.inventory;
  if (!Array.isArray(inventory)) {
    return res.status(400).json({ error: 'Org has no inventory feed' });
  }
  const scenario = String(req.body?.scenario || 'balanced');
  const plant = req.body?.plant ? String(req.body.plant) : undefined;
  const updated = applyInventoryTick(inventory, scenario, org.manifest, plant);
  org.feeds.inventory = updated;
  persistOrgModule(orgId, 'inventory', updated);
  if (orgId === 'brembo') legacyFeeds['brembo-inventory'] = updated;
  pushEvent({ type: 'INVENTORY_TICK', org: orgId, scenario, plant: plant || null, rows: updated.length });
  res.json({
    ok: true,
    org: orgId,
    scenario,
    plant: plant || null,
    rows: updated.length,
    hint: 'Re-run the INVENTORY connector in Syntra to ingest changes.',
  });
});

app.post('/simulator/feeds/:name', adminMiddleware, (req, res) => {
  const key = req.params.name.replace(/\.json$/i, '');
  let body = req.body;
  if (body && typeof body === 'object' && Array.isArray(body.rows)) body = body.rows;
  if (!Array.isArray(body)) {
    return res.status(400).json({ error: 'Body must be a JSON array or { "rows": [...] }' });
  }

  const bremboMatch = /^brembo-(.+)$/.exec(key);
  if (bremboMatch && orgs.brembo) {
    const mod = bremboMatch[1];
    orgs.brembo.feeds[mod] = body;
    persistOrgModule('brembo', mod, body);
    legacyFeeds[key] = body;
    pushEvent({ type: 'FEED_PUSH', org: 'brembo', module: mod, rows: body.length });
    return res.json({ ok: true, name: key, rows: body.length });
  }

  if (LEGACY_CORE.includes(key) && orgs[DEFAULT_ORG]) {
    orgs[DEFAULT_ORG].feeds[key] = body;
    persistOrgModule(DEFAULT_ORG, key, body);
  }
  legacyFeeds[key] = body;
  pushEvent({ type: 'FEED_PUSH', name: key, rows: body.length });
  res.json({ ok: true, name: key, rows: body.length });
});

app.post('/simulator/reload', adminMiddleware, (_req, res) => {
  loadAllFromDisk();
  pushEvent({ type: 'RELOAD_ALL' });
  res.json({
    ok: true,
    orgs: Object.keys(orgs).sort().map((id) => orgSummary(id)),
    legacyFeeds: Object.keys(legacyFeeds).sort().map((k) => ({ name: k, rows: legacyFeeds[k].length })),
  });
});

mountDemoRoutes(app, {
  orgs,
  adminMiddleware,
  persistOrgModule,
  applyInventoryTick,
  loadOrgFromDisk,
  resetOrgFromBaseline,
  pushEvent,
  orgSummary,
  readQty,
  writeQty,
});
mountIotRoutes(app, { adminMiddleware, pushEvent, dataDir });

const port = Number(process.env.PORT || 9090);
app.listen(port, '0.0.0.0', () => {
  console.log(`erp-import-simulator listening on :${port}`);
  console.log(`  orgs: ${Object.keys(orgs).join(', ') || '(none — run npm run sync-orgs)'}`);
  console.log(`  admin: http://localhost:${port}/admin/`);
});
