-- Portal customers get an account with a password of their own.
--
-- Until now the emailed link was the only way in, so a customer who wanted to
-- check their project had to ask for a new email every time the old link aged
-- out. The first time a link is opened the portal now asks them to choose a
-- password, and /p/login takes email and password from then on. The emailed
-- link stays as the first-time and forgotten-password path.
--
-- One account per client row. Email is not unique on purpose: two client rows
-- can share an inbox, and sign-in checks the password against each.

create table if not exists portal_accounts (
  client_id     uuid primary key references clients(id) on delete cascade,
  company_id    uuid not null references companies(id) on delete cascade,
  email         citext not null,
  -- scrypt$<salt>$<key>, both base64url. Never the password.
  password_hash text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_login_at timestamptz
);
create index if not exists portal_accounts_email_idx on portal_accounts (email);

-- Password attempts share the audit table with link requests so one place
-- answers "who tried to get in as this customer". `matched` is whether the
-- password was right.
alter table portal_login_requests
  add column if not exists kind text not null default 'link'
  check (kind in ('link','password'));

alter table public.portal_accounts enable row level security;
alter table public.portal_accounts force row level security;
revoke all on public.portal_accounts from anon, authenticated;

notify pgrst, 'reload schema';
