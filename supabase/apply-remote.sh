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
set -e
: ${SUPABASE_PAT:?set SUPABASE_PAT}
here="$(cd "$(dirname "$0")" && pwd)"

api() {
  python3 - "$@" <<'PY'
import json, sys, os, urllib.request, urllib.error
method, path = sys.argv[1], sys.argv[2]
body = sys.argv[3] if len(sys.argv) > 3 else None
req = urllib.request.Request(
    f"https://api.supabase.com/v1{path}",
    data=body.encode() if body else None,
    headers={"Authorization": f"Bearer {os.environ['SUPABASE_PAT']}", "Content-Type": "application/json"},
    method=method)
try:
    print(urllib.request.urlopen(req).read().decode())
except urllib.error.HTTPError as e:
    print("FAILED", e.code, e.read().decode()[:600], file=sys.stderr)
    sys.exit(1)
PY
}

if [[ "$1" == "--create" ]]; then
  org="$2"; dbpass="$3"
  : ${org:?pass the organization id}
  : ${dbpass:?pass a database password}
  echo "→ creating project"
  api POST /projects "{\"name\":\"hydrodam-ops\",\"organization_id\":\"$org\",\"region\":\"us-east-1\",\"db_pass\":\"$dbpass\"}"
  echo "Now wait for ACTIVE_HEALTHY (~2.5 min), then re-run with PROJECT_REF set."
  exit 0
fi

: ${PROJECT_REF:?set PROJECT_REF}

run_sql() {
  local label="$1" file="$2"
  echo "→ $label"
  python3 - "$file" <<'PY'
import json, os, sys, urllib.request, urllib.error
sql = open(sys.argv[1]).read()
req = urllib.request.Request(
    f"https://api.supabase.com/v1/projects/{os.environ['PROJECT_REF']}/database/query",
    data=json.dumps({"query": sql}).encode(),
    headers={"Authorization": f"Bearer {os.environ['SUPABASE_PAT']}", "Content-Type": "application/json"},
    method="POST")
try:
    urllib.request.urlopen(req).read()
    print("  ok")
except urllib.error.HTTPError as e:
    print("  FAILED", e.code, e.read().decode()[:800]); sys.exit(1)
PY
}

run_sql "0001_init.sql"  "$here/migrations/0001_init.sql"
run_sql "0002_api.sql"   "$here/migrations/0002_api.sql"
run_sql "bootstrap.sql"  "$here/bootstrap.sql"

# The forms, the price book and the agreement are generated from the same
# TypeScript the UI renders, so a reworded question can never drift from the
# field key the database validates against.
echo "→ reference seed"
tmp="$(mktemp -t hydrodam-reference)"
node "$here/seed-reference.ts" > "$tmp"
run_sql "reference.sql" "$tmp"
rm -f "$tmp"

echo
echo "service_role key (put on Vercel as SUPABASE_SERVICE_ROLE_KEY):"
api GET "/projects/$PROJECT_REF/api-keys?reveal=true" \
  | python3 -c "import json,sys; print(next(k['api_key'] for k in json.load(sys.stdin) if k['name']=='service_role'))"
echo "SUPABASE_URL=https://$PROJECT_REF.supabase.co"
