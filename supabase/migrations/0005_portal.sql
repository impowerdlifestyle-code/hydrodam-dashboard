-- The client portal grows a front door and a source of estimates.
--
-- Until now a customer only ever reached /p/:token through a link the office
-- minted by hand, and the itemized estimate Emma sends lives in QuickBooks,
-- which the portal could not see. Four tables:
--
--   portal_login_requests   every "email me my link" attempt, matched or not,
--                           so the login form can be rate limited and audited
--   quickbooks_connections  the OAuth grant for Mady's QuickBooks company
--   quickbooks_estimates    a cache of her estimates, matched to a client by
--                           the customer's email so the portal renders them
--   portal_acceptances      the customer accepting a QuickBooks estimate and
--                           signing the agreement online, with the same
--                           evidence the quote signature keeps

create table if not exists portal_login_requests (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references companies(id) on delete cascade,
  email       citext not null,
  client_id   uuid references clients(id) on delete set null,
  matched     boolean not null default false,
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists portal_login_requests_email_idx
  on portal_login_requests (email, created_at desc);

create table if not exists quickbooks_connections (
  company_id        uuid primary key references companies(id) on delete cascade,
  realm_id          text not null,
  environment       text not null default 'production'
                    check (environment in ('sandbox','production')),
  refresh_token     text not null,
  access_token      text,
  access_expires_at timestamptz,
  connected_by      text,
  connected_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  last_sync_at      timestamptz,
  last_sync_error   text
);

create table if not exists quickbooks_estimates (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  realm_id        text not null,
  qb_id           text not null,
  doc_number      text,
  txn_date        date,
  expiration_date date,
  -- QuickBooks' own TxnStatus: Pending | Accepted | Closed | Rejected | Converted
  txn_status      text,
  customer_ref    text,
  customer_name   text,
  customer_email  citext,
  client_id       uuid references clients(id) on delete set null,
  subtotal_cents  bigint not null default 0,
  discount_cents  bigint not null default 0,
  tax_cents       bigint not null default 0,
  total_cents     bigint not null default 0,
  -- [{ name, description, quantity, rate_cents, amount_cents }]
  lines           jsonb not null default '[]'::jsonb,
  memo            text,
  accepted_by     text,
  accepted_at     timestamptz,
  qb_updated_at   timestamptz,
  synced_at       timestamptz not null default now(),
  raw             jsonb,
  unique (realm_id, qb_id)
);
create index if not exists quickbooks_estimates_client_idx
  on quickbooks_estimates (client_id, txn_date desc);
create index if not exists quickbooks_estimates_email_idx
  on quickbooks_estimates (customer_email);

create table if not exists portal_acceptances (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references companies(id) on delete cascade,
  client_id              uuid not null references clients(id) on delete cascade,
  quickbooks_estimate_id uuid references quickbooks_estimates(id) on delete restrict,
  signer_name            text not null check (length(trim(signer_name)) >= 2),
  signed_at              timestamptz not null default now(),
  ip_address             inet,
  user_agent             text,
  agreement_version      text not null,
  esign_consent_text     text not null,
  total_cents            bigint not null,
  lines_sha256           text,
  qb_synced_at           timestamptz
);
create index if not exists portal_acceptances_client_idx
  on portal_acceptances (client_id, signed_at desc);

-- Same grant model as everything else: service role only, anon sees nothing.
do $$
declare t text;
begin
  foreach t in array array['portal_login_requests','quickbooks_connections','quickbooks_estimates','portal_acceptances']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
