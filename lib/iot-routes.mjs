import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

function compact(obj) {
  const ordered = {};
  for (const key of Object.keys(obj).sort()) {
    if (obj[key] === undefined || obj[key] === null) continue;
    ordered[key] = obj[key];
  }
  return JSON.stringify(ordered);
}

function hmacHex(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function mask(secret) {
  if (!secret) return '';
  if (secret.length <= 6) return '••••';
  return `${secret.slice(0, 4)}…${secret.slice(-2)}`;
}

function envConfig() {
  const lineId = process.env.SYNTRAOS_LINE_ID?.trim() || '';
  const badge = process.env.SYNTRAOS_BADGE_TOKEN?.trim() || 'BADGE-001';
  return {
    apiUrl: (process.env.SYNTRAOS_API_URL || '').replace(/\/$/, ''),
    tenant: process.env.SYNTRAOS_TENANT || '',
    shopKey: process.env.SYNTRAOS_SHOP_KEY || '',
    shopSecret: process.env.SYNTRAOS_SHOP_SECRET || '',
    iotKey: process.env.SYNTRAOS_IOT_KEY || '',
    iotSecret: process.env.SYNTRAOS_IOT_SECRET || '',
    lines: lineId
      ? [
          {
            id: 'line-a',
            name: 'Line A',
            departmentId: lineId,
            readerDeviceId: 'sim-reader-01',
            plcDeviceId: 'sim-plc-01',
          },
        ]
      : [],
    badges: lineId
      ? [{ label: 'Operator 1', token: badge, departmentId: lineId, deviceId: 'sim-reader-01' }]
      : [],
  };
}

function redacted(cfg) {
  return {
    apiUrl: cfg.apiUrl,
    tenant: cfg.tenant,
    shopKey: cfg.shopKey,
    shopSecretSet: Boolean(cfg.shopSecret),
    shopSecretMasked: mask(cfg.shopSecret),
    iotKey: cfg.iotKey,
    iotSecretSet: Boolean(cfg.iotSecret),
    iotSecretMasked: mask(cfg.iotSecret),
    lines: cfg.lines,
    badges: (cfg.badges || []).map((b) => ({
      ...b,
      token: b.token,
    })),
    ready: Boolean(cfg.apiUrl && cfg.tenant),
  };
}

async function postSigned(apiUrl, pathName, tenant, keyId, secret, payload) {
  const body = compact(payload);
  const url = `${apiUrl}${pathName}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': tenant,
      'X-Integration-Key-Id': keyId,
      'X-Integration-Secret': secret,
      'X-Integration-Signature': hmacHex(secret, body),
    },
    body,
  });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { ok: res.ok, status: res.status, url, body: parsed, signedBody: body };
}

export function mountIotRoutes(app, { adminMiddleware, pushEvent, dataDir }) {
  const devicesPath = path.join(dataDir, 'iot', 'devices.json');
  const seedDevices = fs.existsSync(devicesPath)
    ? JSON.parse(fs.readFileSync(devicesPath, 'utf8'))
    : { readers: [], plcs: [] };

  let config = envConfig();
  const localEvents = [];
  const deviceState = {
    readers: Object.fromEntries((seedDevices.readers || []).map((d) => [d.id, { ...d, lastEvent: null }])),
    plcs: Object.fromEntries(
      (seedDevices.plcs || []).map((d) => [d.id, { ...d, status: 'ACTIVE', lastEvent: null }]),
    ),
  };

  function note(evt) {
    localEvents.unshift({ ...evt, at: new Date().toISOString() });
    if (localEvents.length > 100) localEvents.length = 100;
    pushEvent(evt);
  }

  app.get('/iot/devices', (_req, res) => {
    res.json({
      readers: Object.values(deviceState.readers),
      plcs: Object.values(deviceState.plcs),
      sampleClock: {
        path: '/api/integrations/shopfloor/clock',
        headers: ['X-Tenant-Id', 'X-Integration-Key-Id', 'X-Integration-Secret', 'X-Integration-Signature'],
        body: {
          badgeHash: '<sha256(badgeToken)>',
          departmentId: '<production_line uuid>',
          eventType: 'IN | OUT | BREAK_START | BREAK_END',
          deviceId: 'sim-reader-01',
          occurredAt: 'ISO-8601',
        },
      },
      sampleLineStatus: {
        path: '/api/integrations/production-lines/status',
        scope: 'PRODUCTION_IOT',
        body: {
          departmentId: '<production_line uuid>',
          status: 'ACTIVE | MAINTENANCE | PROBLEM | IDLE',
          reason: 'string',
          deviceId: 'sim-plc-01',
          occurredAt: 'ISO-8601',
        },
      },
    });
  });

  app.get('/iot/events', (_req, res) => {
    res.json({ events: localEvents.slice(0, 50) });
  });

  app.get('/iot/config', (_req, res) => {
    res.json(redacted(config));
  });

  app.post('/iot/config', adminMiddleware, (req, res) => {
    const b = req.body || {};
    config = {
      ...config,
      apiUrl: (b.apiUrl || config.apiUrl || '').replace(/\/$/, ''),
      tenant: b.tenant ?? config.tenant,
      shopKey: b.shopKey ?? config.shopKey,
      shopSecret: b.shopSecret || config.shopSecret,
      iotKey: b.iotKey ?? config.iotKey,
      iotSecret: b.iotSecret || config.iotSecret,
      lines: Array.isArray(b.lines) ? b.lines : config.lines,
      badges: Array.isArray(b.badges) ? b.badges : config.badges,
    };
    note({ type: 'IOT_CONFIG', apiUrl: config.apiUrl, tenant: config.tenant });
    res.json({ ok: true, config: redacted(config) });
  });

  async function runClock(body) {
    const eventType = String(body?.eventType || 'IN').toUpperCase();
    const badge = body?.badge || config.badges?.[0];
    if (!badge?.token) {
      return {
        http: 400,
        json: {
          error: 'No badge configured',
          hint: 'POST /iot/config with badges: [{ token, departmentId, deviceId }]',
        },
      };
    }
    const departmentId = body?.departmentId || badge.departmentId;
    const deviceId = body?.deviceId || badge.deviceId || 'sim-reader-01';
    const payload = {
      badgeHash: sha256Hex(badge.token),
      departmentId,
      eventType,
      deviceId,
      occurredAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    const reader =
      Object.values(deviceState.readers).find((r) => r.deviceId === deviceId) ||
      Object.values(deviceState.readers)[0];
    if (reader) reader.lastEvent = payload;
    if (!config.apiUrl || !config.tenant || !config.shopKey || !config.shopSecret) {
      note({ type: 'CLOCK_LOCAL', ...payload, forwarded: false });
      return {
        http: 202,
        json: {
          ok: true,
          forwarded: false,
          payload,
          hint: 'Saved locally. Add Syntra API URL + SHOPFLOOR key in IoT config to push.',
        },
      };
    }
    const result = await postSigned(
      config.apiUrl,
      '/api/integrations/shopfloor/clock',
      config.tenant,
      config.shopKey,
      config.shopSecret,
      payload,
    );
    note({ type: 'CLOCK_FORWARD', eventType, status: result.status, forwarded: true });
    return { http: result.ok ? 200 : 502, json: { ok: result.ok, forwarded: true, payload, syntra: result } };
  }

  async function runLineStatus(body) {
    const status = String(body?.status || 'ACTIVE').toUpperCase();
    const allowed = new Set(['ACTIVE', 'MAINTENANCE', 'PROBLEM', 'IDLE']);
    if (!allowed.has(status)) {
      return { http: 400, json: { error: 'status must be ACTIVE | MAINTENANCE | PROBLEM | IDLE' } };
    }
    const line = body?.line || config.lines?.[0];
    const departmentId = body?.departmentId || line?.departmentId;
    if (!departmentId) {
      return {
        http: 400,
        json: {
          error: 'No production line configured',
          hint: 'POST /iot/config with lines: [{ name, departmentId, plcDeviceId }]',
        },
      };
    }
    const deviceId = body?.deviceId || line?.plcDeviceId || 'sim-plc-01';
    const payload = {
      departmentId,
      status,
      reason: body?.reason || `simulator ${status.toLowerCase()}`,
      deviceId,
      occurredAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    const plc =
      Object.values(deviceState.plcs).find((p) => p.deviceId === deviceId) || Object.values(deviceState.plcs)[0];
    if (plc) {
      plc.status = status;
      plc.lastEvent = payload;
    }
    if (!config.apiUrl || !config.tenant || !config.iotKey || !config.iotSecret) {
      note({ type: 'PLC_LOCAL', ...payload, forwarded: false });
      return {
        http: 202,
        json: {
          ok: true,
          forwarded: false,
          payload,
          hint: 'Saved locally. Add Syntra API URL + PRODUCTION_IOT key to push.',
        },
      };
    }
    const result = await postSigned(
      config.apiUrl,
      '/api/integrations/production-lines/status',
      config.tenant,
      config.iotKey,
      config.iotSecret,
      payload,
    );
    note({ type: 'PLC_FORWARD', status, http: result.status, forwarded: true });
    return { http: result.ok ? 200 : 502, json: { ok: result.ok, forwarded: true, payload, syntra: result } };
  }

  app.post('/iot/clock', adminMiddleware, async (req, res) => {
    try {
      const out = await runClock(req.body || {});
      res.status(out.http).json(out.json);
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  app.post('/iot/line-status', adminMiddleware, async (req, res) => {
    try {
      const out = await runLineStatus(req.body || {});
      res.status(out.http).json(out.json);
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  app.post('/iot/scenario', adminMiddleware, async (req, res) => {
    const scenario = String(req.body?.scenario || '').toLowerCase();
    const map = {
      'shift-start': { kind: 'clock', eventType: 'IN' },
      'break-start': { kind: 'clock', eventType: 'BREAK_START' },
      'break-end': { kind: 'clock', eventType: 'BREAK_END' },
      'shift-end': { kind: 'clock', eventType: 'OUT' },
      'line-active': { kind: 'plc', status: 'ACTIVE', reason: 'Line running' },
      'line-problem': { kind: 'plc', status: 'PROBLEM', reason: 'Demo machine fault' },
      'line-maintenance': { kind: 'plc', status: 'MAINTENANCE', reason: 'Demo planned maintenance' },
      'line-idle': { kind: 'plc', status: 'IDLE', reason: 'Demo idle' },
    };
    const spec = map[scenario];
    if (!spec) {
      return res.status(400).json({ error: 'Unknown IoT scenario', known: Object.keys(map) });
    }
    try {
      const out = spec.kind === 'clock' ? await runClock({ ...req.body, ...spec }) : await runLineStatus({ ...req.body, ...spec });
      res.status(out.http).json({ scenario, ...out.json });
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });
}
