#!/bin/zsh
# Applies the schema to a live Supabase project through the Management API.
#
#   SUPABASE_PAT=sbp_... PROJECT_REF=abcdefghijklm ./supabase/apply-remote.sh
#
# The dashboard's SQL editor works too, but this is repeatable and prints the
# first error instead of burying it in a toast.
set -e
: ${SUPABASE_PAT:?set SUPABASE_PAT}
: ${PROJECT_REF:?set PROJECT_REF}
here="$(cd "$(dirname "$0")" && pwd)"

run() {
  local label="$1" file="$2"
  echo "→ $label"
  python3 -c "
import json,sys,urllib.request
sql = open('$file').read()
req = urllib.request.Request(
    'https://api.supabase.com/v1/projects/$PROJECT_REF/database/query',
    data=json.dumps({'query': sql}).encode(),
    headers={'Authorization': 'Bearer $SUPABASE_PAT', 'Content-Type': 'application/json'},
    method='POST')
try:
    urllib.request.urlopen(req).read()
    print('  ok')
except urllib.error.HTTPError as e:
    print('  FAILED', e.code, e.read().decode()[:500]); sys.exit(1)
"
}

run "0001_init.sql" "$here/migrations/0001_init.sql"
run "bootstrap.sql" "$here/bootstrap.sql"
echo "done"
