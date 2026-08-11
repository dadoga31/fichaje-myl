#!/usr/bin/env bash
# Ejecuta las migraciones y la batería de pruebas de cumplimiento contra un
# PostgreSQL local. No requiere Supabase: 00_supabase_stub.sql aporta el
# mínimo imprescindible (auth.users, auth.uid(), roles).
#
#   ./supabase/test/run-tests.sh
#
# Variables opcionales: PGHOST, PGPORT, PGUSER, TEST_DB
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_DB="${TEST_DB:-fichaje_test}"

echo "▸ Recreando base de datos de pruebas: $TEST_DB"
dropdb --if-exists "$TEST_DB"
createdb "$TEST_DB"

echo "▸ Aplicando stub de Supabase"
psql -q -v ON_ERROR_STOP=1 -d "$TEST_DB" -f "$ROOT/supabase/test/00_supabase_stub.sql" >/dev/null

echo "▸ Aplicando migraciones"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "    $(basename "$f")"
  psql -q -v ON_ERROR_STOP=1 -d "$TEST_DB" -f "$f"
done

echo "▸ Ejecutando pruebas de cumplimiento"
psql -v ON_ERROR_STOP=1 -d "$TEST_DB" -f "$ROOT/supabase/test/01_compliance_test.sql"
