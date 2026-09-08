#!/usr/bin/env python3
"""
SyntraOS shopfloor IoT simulator.

Simulates a badge reader or PLC posting signed requests to SyntraOS. Use this to
validate the end-to-end loop: admin provisions credentials -> device posts
signed events -> supervisor activity panel receives STOMP updates.

Prereqs
-------
1. Log in as a production supervisor/manager and mint a credential:

     POST /api/admin/shopfloor/credentials
     X-Tenant-Id: <tenant>
     X-Role: production_manager
     Body: {"scope": "SHOPFLOOR", "notes": "sim"}

   Capture the returned `keyId` and `secret` (secret only shown once).

2. Register a badge for an operator you want to simulate:

     POST /api/admin/shopfloor/badges
     Body: {"userId": "<uuid>", "badgeToken": "BADGE-001", "badgeLast4": "0001"}

   The server stores SHA-256(badgeToken). The simulator hashes the same way.

Usage
-----
  # Clock-in event for BADGE-001 on department <dep-uuid>
  python scripts/iot/simulate_shopfloor.py clock \
    --base-url http://localhost:8080 \
    --tenant <tenant-uuid> \
    --key-id shop_abc123 \
    --secret <plaintext-secret> \
    --badge-token BADGE-001 \
    --department <dep-uuid> \
    --event-type IN

  # Post a machine line status update
  python scripts/iot/simulate_shopfloor.py line-status \
    --base-url http://localhost:8080 \
    --tenant <tenant-uuid> \
    --key-id shop_abc123 \
    --secret <plaintext-secret> \
    --department <dep-uuid> \
    --status PROBLEM --reason "Simulator running"
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import sys
import uuid
from datetime import datetime, timezone

try:
    import requests  # type: ignore
except ImportError:
    print("pip install requests", file=sys.stderr)
    sys.exit(2)


def sign(secret: str, body: str) -> str:
    return hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def post_signed(url: str, tenant: str, key_id: str, secret: str, payload: dict) -> requests.Response:
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    headers = {
        "Content-Type": "application/json",
        "X-Tenant-Id": tenant,
        "X-Integration-Key-Id": key_id,
        "X-Integration-Secret": secret,
        "X-Integration-Signature": sign(secret, body),
    }
    return requests.post(url, data=body, headers=headers, timeout=10)


def cmd_clock(args: argparse.Namespace) -> int:
    payload = {
        "badgeHash": sha256_hex(args.badge_token),
        "departmentId": args.department,
        "eventType": args.event_type,
        "eventId": args.event_id or str(uuid.uuid4()),
        "deviceId": args.device_id or "sim-reader-01",
        "occurredAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    resp = post_signed(
        f"{args.base_url.rstrip('/')}/api/integrations/shopfloor/clock",
        args.tenant, args.key_id, args.secret, payload,
    )
    print(f"HTTP {resp.status_code}\n{resp.text}")
    return 0 if resp.ok else 1


def cmd_line_status(args: argparse.Namespace) -> int:
    payload = {
        "departmentId": args.department,
        "status": args.status,
        "reason": args.reason,
        "deviceId": args.device_id or "sim-plc-01",
        "occurredAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    resp = post_signed(
        f"{args.base_url.rstrip('/')}/api/integrations/production-lines/status",
        args.tenant, args.key_id, args.secret, payload,
    )
    print(f"HTTP {resp.status_code}\n{resp.text}")
    return 0 if resp.ok else 1


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="SyntraOS shopfloor IoT simulator")
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--base-url", required=True)
        sp.add_argument("--tenant", required=True, help="Tenant UUID")
        sp.add_argument("--key-id", required=True)
        sp.add_argument("--secret", required=True)
        sp.add_argument("--device-id")

    clock = sub.add_parser("clock", help="Simulate a badge clock event")
    common(clock)
    clock.add_argument("--badge-token", required=True, help="Plaintext badge token registered via /api/admin/shopfloor/badges")
    clock.add_argument("--department", required=True, help="Department (production line) UUID")
    clock.add_argument("--event-type", default="IN", choices=["IN", "OUT", "BREAK_START", "BREAK_END"])
    clock.add_argument("--event-id")
    clock.set_defaults(func=cmd_clock)

    ls = sub.add_parser("line-status", help="Simulate a PLC line status update")
    common(ls)
    ls.add_argument("--department", required=True)
    ls.add_argument("--status", required=True, help="ACTIVE | MAINTENANCE | PROBLEM | IDLE")
    ls.add_argument("--reason", default="")
    ls.set_defaults(func=cmd_line_status)
    return p


if __name__ == "__main__":
    parser = build_parser()
    ns = parser.parse_args()
    sys.exit(ns.func(ns))
