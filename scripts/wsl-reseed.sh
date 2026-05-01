#!/usr/bin/env bash
set -euo pipefail
cd /root/vdx
service postgresql status >/dev/null 2>&1 || service postgresql start >/dev/null
npm run db:seed 2>&1 | tail -3
PGPASSWORD=postgres psql -U postgres -h localhost -d noshow_recovery -tAc "SELECT id, name FROM clients ORDER BY name"
