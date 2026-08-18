#!/bin/zsh
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
S="$(mktemp -d)"
dropdb --if-exists hydrodam_migration_test >/dev/null 2>&1
createdb hydrodam_migration_test
psql -q -d hydrodam_migration_test -c "alter database hydrodam_migration_test set search_path to \"\$user\", public, extensions;" >/dev/null
psql -q -d hydrodam_migration_test >/dev/null 2>&1 <<'SQL'
create schema if not exists extensions;
create schema if not exists auth;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
SQL
psql -v ON_ERROR_STOP=1 -d hydrodam_migration_test -f "$(cd "$(dirname "$0")/../.." && pwd)/supabase/migrations/0001_init.sql" > "$S/mig.log" 2>&1
code=$?
echo "exit=$code"
grep -E "^psql:.*(ERROR|FATAL)" "$S/mig.log" | head -5
