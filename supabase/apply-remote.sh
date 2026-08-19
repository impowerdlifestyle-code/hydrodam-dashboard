#!/bin/zsh
# Stands up (or updates) the HydroDam Supabase project through the Management API.
#
#   SUPABASE_PAT=sbp_... PROJECT_REF=abcdefghijklm ./supabase/apply-remote.sh
#
# Or, with no project yet, create one first:
#   SUPABASE_PAT=sbp_... ./supabase/apply-remote.sh --create "<org-id>" "<db-password>"
#
# Everything is idempotent: the schema uses `create ... if not exists` where it
# can, the API functions are `create or replace`, and the reference seed upserts.
# Re-running is the normal way to push a change.
#
# curl rather than python's urllib throughout: the macOS Python.framework build
# ships without a CA bundle, so urlopen dies with CERTIFICATE_VERIFY_FAILED
# against every https host. curl uses the system trust store.
set -e
: ${SUPABASE_PAT:?set SUPABASE_PAT}
here="$(cd "$(dirname "$0")" && pwd)"

api() {
  local method="$1" path="$2" body="$3"
  if [[ -n "$body" ]]; then
    curl -sS --fail-with-body -X "$method" "https://api.supabase.com/v1$path" \
      -H "Authorization: Bearer $SUPABASE_PAT" -H "Content-Type: application/json" -d "$body"
  else
    curl -sS --fail-with-body -X "$method" "https://api.supabase.com/v1$path" \
      -H "Authorization: Bearer $SUPABASE_PAT" -H "Content-Type: application/json"
  fi
}

if [[ "$1" == "--create" ]]; then
  org="$2"; dbpass="$3"
  : ${org:?pass the organization id}
  : ${dbpass:?pass a database password}
  echo "→ creating project"
  api POST /projects "{\"name\":\"hydrodam-ops\",\"organization_id\":\"$org\",\"region\":\"us-east-1\",\"db_pass\":\"$dbpass\"}"
  echo
  echo "Now wait for ACTIVE_HEALTHY (~2.5 min), then re-run with PROJECT_REF set."
  exit 0
fi

: ${PROJECT_REF:?set PROJECT_REF}

run_sql() {
  local label="$1" file="$2"
  echo "→ $label"
  # json.dumps so quotes, dollar-quoting and the em dashes in the migration
  # comments all survive the round trip. --data-binary @- keeps curl from
  # mangling newlines.
  local out
  if out="$(python3 -c 'import json,sys; sys.stdout.write(json.dumps({"query": open(sys.argv[1]).read()}))' "$file" \
      | curl -sS --fail-with-body -X POST \
          "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
          -H "Authorization: Bearer $SUPABASE_PAT" -H "Content-Type: application/json" \
          --data-binary @-)"; then
    echo "  ok"
  else
    echo "  FAILED: ${out:0:900}"
    return 1
  fi
}

run_sql "0001_init.sql"  "$here/migrations/0001_init.sql"
run_sql "0002_api.sql"   "$here/migrations/0002_api.sql"
run_sql "bootstrap.sql"  "$here/bootstrap.sql"

# The forms, the price book and the agreement are generated from the same
# TypeScript the UI renders, so a reworded question can never drift from the
# field key the database validates against.
tmp="$(mktemp -t hydrodam-reference)"
node "$here/seed-reference.ts" > "$tmp" 2>/dev/null
run_sql "reference seed" "$tmp"
rm -f "$tmp"

echo
echo "SUPABASE_URL=https://$PROJECT_REF.supabase.co"
echo -n "SUPABASE_SERVICE_ROLE_KEY="
api GET "/projects/$PROJECT_REF/api-keys?reveal=true" \
  | python3 -c "import json,sys; print(next(k['api_key'] for k in json.load(sys.stdin) if k['name']=='service_role'))"
