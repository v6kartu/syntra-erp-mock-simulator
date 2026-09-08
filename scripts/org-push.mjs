#!/usr/bin/env node
/**
 * Push a JSON array file into an org module feed.
 *
 * Usage:
 *   npm run org-push -- --org valeo --module inventory --file ./my-inv.json
 */
import fs from 'fs';
import path from 'path';

const SIMULATOR_URL = (process.env.SIMULATOR_URL || 'http://localhost:9090').replace(/\/$/, '');
const ADMIN_TOKEN = process.env.ERP_SIMULATOR_ADMIN_TOKEN?.trim() || '';

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  if (i < 0) return null;
  return args[i + 1] ?? null;
}

const orgId = flag('--org');
const moduleName = flag('--module');
const filePath = flag('--file');

if (!orgId || !moduleName || !filePath) {
  console.error('Usage: npm run org-push -- --org <id> --module <name> --file <path.json>');
  process.exit(1);
}

const abs = path.resolve(filePath);
const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
if (!Array.isArray(data)) {
  console.error('File must contain a JSON array');
  process.exit(1);
}

const headers = { 'Content-Type': 'application/json' };
if (ADMIN_TOKEN) headers['x-simulator-token'] = ADMIN_TOKEN;

const res = await fetch(`${SIMULATOR_URL}/simulator/orgs/${orgId}/feeds/${moduleName}`, {
  method: 'POST',
  headers,
  body: JSON.stringify(data),
});
const text = await res.text();
if (!res.ok) {
  console.error(`push failed: ${res.status} ${text}`);
  process.exit(1);
}
console.log(`[org-push] ${orgId}/${moduleName} ← ${abs} (${data.length} rows)`);
console.log(text);
