#!/usr/bin/env node
/**
 * Simulate ERP inventory movement for any org pack.
 *
 * Usage:
 *   npm run org-tick -- --org brembo --scenario shortage
 *   npm run org-tick -- --org mercedes --plant MBG-DE-SIN --scenario receipt
 *   npm run org-tick -- --org brembo --watch 120
 *   npm run org-tick -- --org valeo --disk-only
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const simRoot = path.join(__dirname, '..');
const orgsDir = path.join(simRoot, 'data', 'orgs');

const SIMULATOR_URL = (process.env.SIMULATOR_URL || 'http://localhost:9090').replace(/\/$/, '');
const ADMIN_TOKEN = process.env.ERP_SIMULATOR_ADMIN_TOKEN?.trim() || '';

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  return args[i + 1] ?? fallback;
}

const orgId = flag('--org', 'brembo');
const scenario = flag('--scenario', 'balanced');
const plant = flag('--plant', '') || undefined;
const watchSec = Number(flag('--watch', '0')) || 0;
const diskOnly = args.includes('--disk-only');
const pushOnly = args.includes('--push-only');

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (ADMIN_TOKEN) h['x-simulator-token'] = ADMIN_TOKEN;
  return h;
}

async function tickOnce() {
  console.log(`[org-tick] org=${orgId} scenario=${scenario} plant=${plant || '*'} simulator=${SIMULATOR_URL}`);

  if (diskOnly) {
    const invPath = path.join(orgsDir, orgId, 'inventory.json');
    const manifest = JSON.parse(fs.readFileSync(path.join(orgsDir, orgId, 'manifest.json'), 'utf8'));
    let rows = JSON.parse(fs.readFileSync(invPath, 'utf8'));
    // Local apply — mirror server tick lightly by POSTing then writing response isn't available offline;
    // call tick API if possible, else skip.
    console.warn('[org-tick] --disk-only still prefers live POST /tick; falling through to API when reachable');
  }

  if (!pushOnly || true) {
    const res = await fetch(`${SIMULATOR_URL}/simulator/orgs/${orgId}/tick`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ scenario, plant }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`tick failed: ${res.status} ${text}`);
    }
    const body = await res.json();
    console.log(`[org-tick] ok rows=${body.rows} — re-run INVENTORY connector in Syntra`);
    return body;
  }
}

async function main() {
  if (watchSec > 0) {
    console.log(`[org-tick] watch mode every ${watchSec}s (Ctrl+C to stop)`);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await tickOnce();
      } catch (e) {
        console.warn(`[org-tick] ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, watchSec * 1000));
    }
  }
  await tickOnce();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
