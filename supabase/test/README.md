# Validating 0001_init.sql before it touches a real project

The migration is written for Supabase but is plain Postgres, so it can be proven
locally first. Three bugs were found this way — all of them would have failed on
the very first `apply` against a live project.

```sh
brew install postgresql@16 && brew services start postgresql@16
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
./supabase/test/apply-local.sh
```

The shim creates what Supabase provides and a bare Postgres does not: the
`extensions` and `auth` schemas, the `anon` / `authenticated` / `service_role`
roles, and `auth.uid()`. It also sets `search_path` to `"$user", public,
extensions` — **without that the migration fails on `citext`**, because the
extensions are created `with schema extensions` but referenced unqualified.
Supabase sets that search_path for you; nothing else does.

Verified on 2026-08-18 against PostgreSQL 16.15: 46 tables, RLS on all 46,
42 policies, 37 triggers, 14 `app.*` functions, and `anon` denied on every
table (`permission denied for table clients` when you `set role anon`).

Guards proven by execution, not by reading:

| Guard | Behaviour |
|---|---|
| `armed_requires_epoch` | arming with no epoch is refused; disarmed with no epoch is fine |
| `app.require_checklist_on_complete` | job → completed refused without a **job-linked** submitted `qa_checklist`; on success it stamps `completed_at`, a 5-year warranty and the 30-day check date |
| `app.require_signature_on_approve` | quote → approved refused without a signature or a signed agreement; stamps `approved_at` |
| `app.validate_submission` | label-keyed answers refused, missing required fields refused, field-id-keyed answers accepted |
| `status_transitions` | `completed → pending` refused |
| append-only | UPDATE and DELETE on `signatures` both refused |

One loose end: `has_schema_privilege('anon','public','usage')` is still true,
because `USAGE` on schema `public` is granted to `PUBLIC` and revoking from
`anon` does not undo that. It is not exploitable — every table grant is revoked,
so `anon` gets `permission denied` on everything — but the "no schema grant at
all" phrasing in the migration header overstates it.
