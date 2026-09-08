/**
 * Demo-time catalog + inventory edits and named ERP scenarios.
 * Changes stay in memory (and on disk when the volume is writable).
 */
export function mountDemoRoutes(app, ctx) {
  const {
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
  } = ctx;

  function requireOrg(orgId, res) {
    const org = orgs[orgId];
    if (!org) {
      res.status(404).json({ error: 'Unknown org', known: Object.keys(orgs) });
      return null;
    }
    return org;
  }

  function productTemplate(org, patch) {
    const prefix = org.manifest?.productSkuPrefixes?.[0] || `${org.manifest?.orgId || 'DEMO'}-`.toUpperCase();
    const sku = String(patch.sku || `${prefix}FG-DEMO-${Date.now().toString(36).toUpperCase()}`);
    return {
      name: patch.name || `Demo product ${sku}`,
      sku,
      productId: patch.productId || sku,
      description: patch.description || 'Added from simulator demo console (UAT).',
      listPrice: String(patch.listPrice ?? '99'),
      costPrice: String(patch.costPrice ?? '55'),
      manufacturer: patch.manufacturer || org.manifest?.displayName || orgIdFallback(org),
      uom: patch.uom || 'EA',
      stock: String(patch.stock ?? '250'),
      reorderLevel: String(patch.reorderLevel ?? '40'),
      reorderQuantity: String(patch.reorderQuantity ?? '80'),
      barcode: patch.barcode || `DEMO${sku.replace(/[^0-9A-Z]/gi, '').slice(-10)}`,
    };
  }

  function orgIdFallback(org) {
    return org.manifest?.orgId || 'org';
  }

  function seedInventoryForSku(org, orgId, product, qty) {
    if (!Array.isArray(org.feeds.inventory)) org.feeds.inventory = [];
    const plants = org.manifest?.plants || [];
    const plantCodes = plants.length ? plants.map((p) => p.code) : [undefined];
    const now = new Date().toISOString();
    for (const code of plantCodes.slice(0, 2)) {
      org.feeds.inventory.push({
        sku: product.sku,
        itemName: product.name,
        description: code ? `Demo seed — ${code}` : 'Demo seed',
        availableQuantity: String(qty),
        unitCost: product.costPrice,
        reorderPoint: product.reorderLevel,
        economicOrderQty: product.reorderQuantity,
        uom: product.uom,
        plant: code || '',
        storageLocation: 'DEMO',
        lotNumber: `L-DEMO-${product.sku.slice(-6)}`,
        lastUpdated: now,
      });
    }
    persistOrgModule(orgId, 'inventory', org.feeds.inventory);
  }

  app.patch('/simulator/orgs/:org/inventory', adminMiddleware, (req, res) => {
    const orgId = req.params.org;
    const org = requireOrg(orgId, res);
    if (!org) return;
    const { sku, plant, storageLocation, quantity, delta } = req.body || {};
    if (!sku) return res.status(400).json({ error: 'sku is required' });
    if (quantity == null && delta == null) {
      return res.status(400).json({ error: 'Provide quantity or delta' });
    }
    const inventory = org.feeds.inventory;
    if (!Array.isArray(inventory)) return res.status(400).json({ error: 'No inventory feed' });

    let matched = 0;
    for (const row of inventory) {
      if (String(row.sku) !== String(sku)) continue;
      if (plant && String(row.plant || row.werks || '') !== String(plant)) continue;
      if (storageLocation && String(row.storageLocation || '') !== String(storageLocation)) continue;
      if (quantity != null) writeQty(row, Number(quantity));
      else writeQty(row, readQty(row) + Number(delta));
      matched += 1;
    }
    if (!matched) return res.status(404).json({ error: 'No inventory rows matched', sku, plant });
    persistOrgModule(orgId, 'inventory', inventory);
    pushEvent({ type: 'INVENTORY_PATCH', org: orgId, sku, plant: plant || null, matched });
    res.json({ ok: true, org: orgId, sku, matched, hint: 'Re-run the INVENTORY connector in Syntra.' });
  });

  app.post('/simulator/orgs/:org/products', adminMiddleware, (req, res) => {
    const orgId = req.params.org;
    const org = requireOrg(orgId, res);
    if (!org) return;
    if (!Array.isArray(org.feeds.products)) org.feeds.products = [];
    const product = productTemplate(org, req.body || {});
    if (org.feeds.products.some((p) => p.sku === product.sku)) {
      return res.status(409).json({ error: 'SKU already exists', sku: product.sku });
    }
    org.feeds.products.push(product);
    persistOrgModule(orgId, 'products', org.feeds.products);
    const seedQty = req.body?.seedInventoryQty;
    if (seedQty != null || req.body?.seedInventory) {
      seedInventoryForSku(org, orgId, product, Number(seedQty ?? product.stock ?? 250));
    }
    pushEvent({ type: 'PRODUCT_ADD', org: orgId, sku: product.sku });
    res.json({
      ok: true,
      product,
      hint: 'Re-run PRODUCTS (and INVENTORY if seeded) connectors in Syntra.',
    });
  });

  app.patch('/simulator/orgs/:org/products/:sku', adminMiddleware, (req, res) => {
    const orgId = req.params.org;
    const org = requireOrg(orgId, res);
    if (!org) return;
    const sku = decodeURIComponent(req.params.sku);
    const products = org.feeds.products || [];
    const idx = products.findIndex((p) => String(p.sku) === sku);
    if (idx < 0) return res.status(404).json({ error: 'Unknown SKU', sku });
    const next = { ...products[idx], ...(req.body || {}), sku };
    if (next.listPrice != null) next.listPrice = String(next.listPrice);
    if (next.costPrice != null) next.costPrice = String(next.costPrice);
    if (next.stock != null) next.stock = String(next.stock);
    products[idx] = next;
    persistOrgModule(orgId, 'products', products);
    pushEvent({ type: 'PRODUCT_PATCH', org: orgId, sku });
    res.json({ ok: true, product: next, hint: 'Re-run the PRODUCTS connector in Syntra.' });
  });

  app.delete('/simulator/orgs/:org/products/:sku', adminMiddleware, (req, res) => {
    const orgId = req.params.org;
    const org = requireOrg(orgId, res);
    if (!org) return;
    const sku = decodeURIComponent(req.params.sku);
    const before = org.feeds.products?.length || 0;
    org.feeds.products = (org.feeds.products || []).filter((p) => String(p.sku) !== sku);
    persistOrgModule(orgId, 'products', org.feeds.products);
    pushEvent({ type: 'PRODUCT_DELETE', org: orgId, sku, removed: before - org.feeds.products.length });
    res.json({ ok: true, sku, remaining: org.feeds.products.length });
  });

  /**
   * Named demo scenarios so a presenter can drive the story from one click.
   * Body: { scenario, plant?, sku?, listPrice?, quantity? }
   */
  app.post('/simulator/orgs/:org/scenario', adminMiddleware, (req, res) => {
    const orgId = req.params.org;
    const org = requireOrg(orgId, res);
    if (!org) return;
    const scenario = String(req.body?.scenario || '').toLowerCase();
    const plant = req.body?.plant ? String(req.body.plant) : undefined;

    const tickScenarios = new Set(['balanced', 'shortage', 'surge', 'receipt']);
    if (tickScenarios.has(scenario)) {
      if (!Array.isArray(org.feeds.inventory)) {
        return res.status(400).json({ error: 'Org has no inventory feed' });
      }
      org.feeds.inventory = applyInventoryTick(org.feeds.inventory, scenario, org.manifest, plant);
      persistOrgModule(orgId, 'inventory', org.feeds.inventory);
      pushEvent({ type: 'INVENTORY_TICK', org: orgId, scenario, plant: plant || null });
      return res.json({
        ok: true,
        org: orgId,
        scenario,
        plant: plant || null,
        rows: org.feeds.inventory.length,
        hint: 'Re-run the INVENTORY connector in Syntra.',
      });
    }

    if (scenario === 'stockout' || scenario === 'zero-stock') {
      const hints = new Set(org.manifest?.shortageSkus || []);
      let changed = 0;
      for (const row of org.feeds.inventory || []) {
        if (plant && String(row.plant || '') !== plant) continue;
        if (hints.size && !hints.has(row.sku)) continue;
        if (!hints.size && !String(row.sku || '').includes('FG')) continue;
        writeQty(row, 0);
        changed += 1;
      }
      persistOrgModule(orgId, 'inventory', org.feeds.inventory);
      pushEvent({ type: 'STOCKOUT', org: orgId, plant: plant || null, changed });
      return res.json({
        ok: true,
        scenario: 'stockout',
        changed,
        hint: 'Re-run INVENTORY. Shortage SKUs are now 0.',
      });
    }

    if (scenario === 'price-drop' || scenario === 'promo') {
      const hints = new Set([
        ...(org.manifest?.surgeSkus || []),
        ...(org.manifest?.shortageSkus || []),
      ]);
      const factor = Number(req.body?.factor || 0.85);
      let changed = 0;
      for (const p of org.feeds.products || []) {
        if (hints.size && !hints.has(p.sku)) continue;
        const price = Number(p.listPrice);
        if (!Number.isFinite(price)) continue;
        p.listPrice = String(Math.round(price * factor * 100) / 100);
        changed += 1;
      }
      persistOrgModule(orgId, 'products', org.feeds.products);
      pushEvent({ type: 'PRICE_DROP', org: orgId, changed, factor });
      return res.json({
        ok: true,
        scenario: 'price-drop',
        changed,
        factor,
        hint: 'Re-run the PRODUCTS connector in Syntra.',
      });
    }

    if (scenario === 'new-product' || scenario === 'new-sku') {
      const product = productTemplate(org, req.body || {});
      org.feeds.products.push(product);
      persistOrgModule(orgId, 'products', org.feeds.products);
      seedInventoryForSku(org, orgId, product, Number(req.body?.quantity ?? 180));
      pushEvent({ type: 'PRODUCT_ADD', org: orgId, sku: product.sku, scenario: 'new-product' });
      return res.json({
        ok: true,
        scenario: 'new-product',
        product,
        hint: 'Re-run PRODUCTS then INVENTORY connectors.',
      });
    }

    if (scenario === 'reset') {
      const restored = resetOrgFromBaseline(orgId);
      if (!restored) return res.status(404).json({ error: 'Unknown org', org: orgId });
      pushEvent({ type: 'ORG_RELOAD', org: orgId, scenario: 'reset' });
      return res.json({ ok: true, scenario: 'reset', org: orgSummary(orgId) });
    }

    return res.status(400).json({
      error: 'Unknown scenario',
      known: [
        'shortage',
        'surge',
        'receipt',
        'balanced',
        'stockout',
        'price-drop',
        'new-product',
        'reset',
      ],
    });
  });
}
