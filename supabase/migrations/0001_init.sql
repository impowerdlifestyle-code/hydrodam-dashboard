-- HydroDam Ops — initial schema.
--
-- Money is integer cents (bigint) everywhere. Quantities are numeric(12,3).
-- Every table carries company_id so the single tenant can become many without
-- a rewrite. Apply with the Management API:
--   POST https://api.supabase.com/v1/projects/<ref>/database/query
--   Authorization: Bearer sbp_...   body: {"query": "<this file>"}

create schema if not exists app;

create extension if not exists pgcrypto  with schema extensions;
create extension if not exists citext     with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm    with schema extensions;

create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ============================================================ enums

create type staff_role     as enum ('owner','office','crew');
create type client_type    as enum ('residential','commercial','hoa','property_manager');
create type product_series as enum ('sentinel','onyx','titanium');
create type opening_type   as enum ('door','double_door','single_garage','double_garage','slider','storefront','window','custom');

create type request_status as enum ('new','contacted','assessment_scheduled','assessed','converted','unqualified');
create type quote_status   as enum ('draft','sent','viewed','approved','declined','expired','converted');
create type job_status     as enum ('pending','scheduled','in_progress','on_hold','completed','invoiced','closed');
create type fab_status     as enum ('not_started','cut_sheet_ready','in_fabrication','qc_passed','ready_for_install');
create type visit_status   as enum ('unscheduled','scheduled','confirmed','en_route','in_progress','completed','no_show','cancelled');
create type visit_kind     as enum ('assessment','measure','install','service','thirty_day_check');
create type invoice_status as enum ('draft','sent','viewed','partially_paid','paid','void');
create type invoice_kind   as enum ('deposit','progress','final','standalone');
create type payment_method as enum ('card','ach','check','cash','wire');
create type payment_status as enum ('processing','succeeded','failed','refunded');
create type msg_channel    as enum ('sms','email');
create type msg_direction  as enum ('inbound','outbound');
create type consent_channel as enum ('sms_marketing','sms_transactional','email_marketing');
create type consent_action  as enum ('granted','revoked');
create type field_type      as enum ('text','textarea','select','check');

-- ============================================================ tenancy

create table companies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  legal_name    text,
  slug          citext not null unique,
  timezone      text not null default 'America/New_York',
  -- Barrier installs bolt into the structure, so this is a lump-sum improvement
  -- to real property: no sales tax to the customer, use tax on materials is our
  -- cost. Have a Florida CPA confirm before go-live; the schema supports either.
  default_tax_treatment text not null default 'lump_sum_real_property'
    check (default_tax_treatment in ('lump_sum_real_property','retail_plus_installation','exempt')),
  state_tax_rate_bps    integer not null default 600,
  surtax_rate_bps       integer not null default 100,
  surtax_item_cap_cents bigint  not null default 500000,  -- Pinellas: first $5k per item
  contractor_license text,
  address_line1 text, city text, postal_code text, phone text, email citext,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger t_companies_upd before update on companies for each row execute function app.set_updated_at();

create table document_counters (
  company_id uuid not null references companies(id) on delete cascade,
  doc_type   text not null check (doc_type in ('request','quote','job','invoice')),
  next_value bigint not null default 1000,
  primary key (company_id, doc_type)
);

create or replace function app.next_doc_number(p_company uuid, p_type text)
returns bigint language plpgsql as $$
declare v bigint;
begin
  insert into document_counters (company_id, doc_type) values (p_company, p_type) on conflict do nothing;
  update document_counters set next_value = next_value + 1
   where company_id = p_company and doc_type = p_type
   returning next_value - 1 into v;
  return v;
end $$;

create table users (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  auth_user_id uuid unique,                       -- auth.users.id
  email        citext not null,
  full_name    text not null,
  phone        text,
  role         staff_role not null default 'crew',
  color        text,
  cost_rate_cents_per_hour bigint not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, email)
);
create trigger t_users_upd before update on users for each row execute function app.set_updated_at();

-- SECURITY DEFINER so policies can read users without recursing through RLS.
create or replace function app.current_user_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as
$$ select id from users where auth_user_id = auth.uid() and is_active limit 1 $$;

create or replace function app.current_company_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as
$$ select company_id from users where auth_user_id = auth.uid() and is_active limit 1 $$;

create or replace function app.current_role() returns staff_role
language sql stable security definer set search_path = public, pg_temp as
$$ select role from users where auth_user_id = auth.uid() and is_active limit 1 $$;

create or replace function app.is_office() returns boolean
language sql stable as $$ select app.current_role() in ('owner','office') $$;

-- ============================================================ CRM

create table clients (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  type         client_type not null default 'residential',
  first_name   text, last_name text, company_name text,
  display_name text generated always as (
                 coalesce(nullif(trim(company_name),''),
                          nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')),''),
                          'Unnamed client')) stored,
  email        citext,
  phone        text,                              -- E.164
  lead_source  text not null default 'other',
  notes        text,
  tags         text[] not null default '{}',
  stripe_customer_id text unique,
  hubspot_contact_id text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz,
  constraint clients_reachable check (email is not null or phone is not null),
  constraint clients_phone_e164 check (phone is null or phone ~ '^\+[1-9]\d{7,14}$')
);
-- The two dedupe keys the HubSpot import leans on.
create unique index clients_email_uk on clients (company_id, lower(email::text))
  where email is not null and archived_at is null;
create unique index clients_phone_uk on clients (company_id, phone)
  where phone is not null and archived_at is null;
create unique index clients_hubspot_uk on clients (company_id, hubspot_contact_id)
  where hubspot_contact_id is not null;
create index clients_name_trgm on clients using gin (display_name extensions.gin_trgm_ops);
create trigger t_clients_upd before update on clients for each row execute function app.set_updated_at();

create table properties (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  client_id     uuid not null references clients(id) on delete cascade,
  label         text,
  address_line1 text not null,
  city          text not null,
  state         char(2) not null default 'FL',
  postal_code   text not null,
  county        text,
  lat numeric(9,6), lng numeric(9,6),
  flood_zone    text check (flood_zone in ('X','AE','A','VE') or flood_zone is null),
  crs_class     integer,
  property_type text,
  year_built    text,
  prior_flooding text,
  access_notes  text,
  storage_location text,
  deployer_name text,
  is_primary    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index properties_client_idx on properties (client_id);
create unique index properties_one_primary on properties (client_id) where is_primary;
create trigger t_properties_upd before update on properties for each row execute function app.set_updated_at();

-- The physical inventory of protectable openings.
create table openings (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  property_id   uuid not null references properties(id) on delete cascade,
  label         text not null,
  type          opening_type not null default 'custom',
  width_in      numeric(6,2) check (width_in > 0),
  protection_height_in numeric(6,2) check (protection_height_in > 0),
  surface       text,
  surface_level text,
  obstructions  text,
  sort_order    integer not null default 0,
  -- Anything wider than 9 ft takes a third, centre post. Derived so it can
  -- never disagree with the spec.
  center_post_required boolean generated always as (coalesce(width_in,0) > 108) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index openings_property_idx on openings (property_id, sort_order);
create trigger t_openings_upd before update on openings for each row execute function app.set_updated_at();

create table products (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  sku           text not null,
  name          text not null,
  series        product_series,
  unit          text not null default 'each',
  unit_price_cents bigint not null default 0,
  unit_cost_cents  bigint not null default 0,
  rate_per_sqft_cents bigint,
  wall_thickness_mm numeric(4,2),
  panel_height_in numeric(5,2) default 7.08,
  -- Titanium is quote-only and must never be auto-priced.
  quote_only    boolean not null default false,
  is_labor      boolean not null default false,
  is_taxable_material boolean not null default true,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, sku)
);
create trigger t_products_upd before update on products for each row execute function app.set_updated_at();

-- ============================================================ sales

create table requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  number        bigint not null,
  client_id     uuid references clients(id) on delete set null,
  property_id   uuid references properties(id) on delete set null,
  status        request_status not null default 'new',
  source        text not null default 'website_form',
  source_url    text,
  external_id   text,                              -- idempotency for /api/intake
  title         text not null default 'Flood barrier assessment',
  details       text,
  estimate_low_cents  bigint,
  estimate_high_cents bigint,
  estimate_payload jsonb,
  assigned_to   uuid references users(id) on delete set null,
  first_response_at timestamptz,                   -- speed to lead
  converted_quote_id uuid,
  hubspot_deal_id text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, number)
);
create unique index requests_external_uk on requests (company_id, source, external_id)
  where external_id is not null;
create index requests_status_idx on requests (company_id, status, created_at desc);
create trigger t_requests_upd before update on requests for each row execute function app.set_updated_at();

create table quotes (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  number        bigint not null,
  request_id    uuid references requests(id) on delete set null,
  client_id     uuid not null references clients(id) on delete restrict,
  property_id   uuid not null references properties(id) on delete restrict,
  status        quote_status not null default 'draft',
  title         text not null,
  primary_series product_series,
  client_message text,
  internal_notes text,
  tax_treatment text not null default 'lump_sum_real_property',
  tax_rate_bps  integer not null default 700,
  subtotal_cents bigint not null default 0,
  discount_cents bigint not null default 0,
  tax_cents      bigint not null default 0,
  total_cents    bigint not null default 0,
  deposit_percent_bps integer not null default 5000,
  deposit_due_cents   bigint not null default 0,
  valid_until   date,
  sent_at timestamptz, first_viewed_at timestamptz,
  approved_at timestamptz, approved_by_name text,
  declined_at timestamptz, decline_reason text,
  converted_job_id uuid,
  owner_id      uuid references users(id) on delete set null,
  -- The signed artifact, frozen. What was agreed must not drift with the pricebook.
  snapshot      jsonb,
  hubspot_deal_id text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, number),
  constraint quotes_money_nonneg check (subtotal_cents >= 0 and tax_cents >= 0 and total_cents >= 0)
);
create index quotes_status_idx on quotes (company_id, status, created_at desc);
create trigger t_quotes_upd before update on quotes for each row execute function app.set_updated_at();

alter table requests add constraint requests_quote_fk
  foreign key (converted_quote_id) references quotes(id) on delete set null;

create table quote_openings (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  quote_id      uuid not null references quotes(id) on delete cascade,
  opening_id    uuid references openings(id) on delete set null,
  label         text not null,
  type          opening_type not null default 'custom',
  width_in      numeric(6,2) not null check (width_in > 0),
  protection_height_in numeric(6,2) not null check (protection_height_in > 0),
  quantity      integer not null default 1 check (quantity > 0),
  product_id    uuid references products(id) on delete set null,
  series        product_series not null,
  -- Panel math is stored, not derived: the published spec can change without
  -- silently repricing history.
  panel_height_in numeric(5,2) not null default 7.08,
  panel_count   integer not null check (panel_count > 0),
  post_count    integer not null default 2 check (post_count >= 2),
  center_post_required boolean not null default false,
  sqft numeric(10,2) generated always as
    (round((width_in * protection_height_in / 144.0) * quantity, 2)) stored,
  notes         text,
  sort_order    integer not null default 0,
  line_total_cents bigint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index quote_openings_idx on quote_openings (quote_id, sort_order);
create trigger t_quote_openings_upd before update on quote_openings for each row execute function app.set_updated_at();

create table quote_line_items (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  quote_id      uuid not null references quotes(id) on delete cascade,
  quote_opening_id uuid references quote_openings(id) on delete cascade,
  product_id    uuid references products(id) on delete set null,
  kind          text not null default 'material'
                  check (kind in ('material','labor','fee','discount','allowance')),
  name          text not null,
  description   text,
  quantity      numeric(12,3) not null default 1,
  unit          text not null default 'each',
  unit_price_cents bigint not null default 0,
  unit_cost_cents  bigint not null default 0,      -- snapshot, for margin at quote time
  is_taxable    boolean not null default true,
  -- Optional items the client can toggle in the portal. Upsells close themselves.
  optional      boolean not null default false,
  selected      boolean not null default true,
  amount_cents  bigint generated always as (round(quantity * unit_price_cents)::bigint) stored,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index quote_lines_idx on quote_line_items (quote_id, sort_order);
create trigger t_quote_lines_upd before update on quote_line_items for each row execute function app.set_updated_at();

-- ============================================================ jobs

create table jobs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  number        bigint not null,
  quote_id      uuid references quotes(id) on delete set null,
  request_id    uuid references requests(id) on delete set null,
  client_id     uuid not null references clients(id) on delete restrict,
  property_id   uuid not null references properties(id) on delete restrict,
  status        job_status not null default 'pending',
  title         text not null,
  instructions  text,
  internal_notes text,
  fabrication_status fab_status not null default 'not_started',
  contract_cents bigint not null default 0,
  scheduled_start timestamptz,
  started_at timestamptz, completed_at timestamptz, closed_at timestamptz,
  warranty_starts_on date,
  warranty_ends_on   date,
  thirty_day_check_due_on date,
  owner_id      uuid references users(id) on delete set null,
  hubspot_deal_id text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, number)
);
create index jobs_status_idx on jobs (company_id, status, scheduled_start);
create trigger t_jobs_upd before update on jobs for each row execute function app.set_updated_at();

alter table quotes add constraint quotes_job_fk
  foreign key (converted_job_id) references jobs(id) on delete set null;

create table job_openings (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  job_id        uuid not null references jobs(id) on delete cascade,
  quote_opening_id uuid references quote_openings(id) on delete set null,
  label         text not null,
  series        product_series not null,
  ordered_width_in numeric(6,2) not null,
  ordered_height_in numeric(6,2) not null,
  panel_count   integer not null,
  post_count    integer not null,
  center_post_required boolean not null default false,
  -- as-built, written by the QA checklist
  measured_width_in  numeric(6,2),
  measured_height_in numeric(6,2),
  center_post_fitted text check (center_post_fitted in
    ('Not required','Required and fitted','Required, NOT fitted')),
  install_status text not null default 'pending'
    check (install_status in ('pending','installed','deferred','failed')),
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index job_openings_idx on job_openings (job_id, sort_order);
create trigger t_job_openings_upd before update on job_openings for each row execute function app.set_updated_at();

-- A job has many visits: assessment, measure, install day 1, install day 2,
-- the 30-day check, warranty callbacks.
create table visits (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  job_id        uuid references jobs(id) on delete cascade,
  request_id    uuid references requests(id) on delete cascade,
  client_id     uuid not null references clients(id) on delete restrict,
  property_id   uuid not null references properties(id) on delete restrict,
  kind          visit_kind not null default 'install',
  status        visit_status not null default 'unscheduled',
  title         text,
  sequence      integer not null default 1,
  scheduled_start timestamptz,
  scheduled_end   timestamptz,
  scheduled_range tstzrange generated always as
    (case when scheduled_start is not null and scheduled_end is not null
          then tstzrange(scheduled_start, scheduled_end, '[)') end) stored,
  route_position integer,
  en_route_at timestamptz,
  checked_in_at timestamptz, check_in_lat numeric(9,6), check_in_lng numeric(9,6),
  checked_out_at timestamptz,
  completed_at  timestamptz,
  crew_notes    text,
  reminder_24h_sent_at timestamptz,
  on_my_way_sent_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint visits_parent check (job_id is not null or request_id is not null),
  constraint visits_time_order check (scheduled_end is null or scheduled_start is null
                                      or scheduled_end > scheduled_start)
);
create index visits_calendar_idx on visits (company_id, scheduled_start)
  where status not in ('cancelled','completed');
create index visits_range_gist on visits using gist (scheduled_range);
create trigger t_visits_upd before update on visits for each row execute function app.set_updated_at();

create table visit_assignments (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  visit_id   uuid not null references visits(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  is_lead    boolean not null default false,
  created_at timestamptz not null default now(),
  unique (visit_id, user_id)
);
create index visit_assignments_user_idx on visit_assignments (user_id);

-- One person cannot be on two overlapping visits. Enforced here, hinted in the UI.
create or replace function app.check_visit_overlap() returns trigger
language plpgsql as $$
declare conflict_id uuid;
begin
  select v2.id into conflict_id
    from visit_assignments va2
    join visits v2 on v2.id = va2.visit_id
    join visits v1 on v1.id = new.visit_id
   where va2.user_id = new.user_id
     and va2.visit_id <> new.visit_id
     and v2.status not in ('cancelled','no_show')
     and v1.scheduled_range is not null
     and v2.scheduled_range && v1.scheduled_range
   limit 1;
  if conflict_id is not null then
    raise exception 'user % already assigned to overlapping visit %', new.user_id, conflict_id
      using errcode = '23P01';
  end if;
  return new;
end $$;
create trigger t_visit_overlap before insert or update on visit_assignments
  for each row execute function app.check_visit_overlap();

-- ============================================================ time + costs

create table time_entries (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  user_id       uuid not null references users(id) on delete restrict,
  job_id        uuid references jobs(id) on delete set null,
  visit_id      uuid references visits(id) on delete set null,
  started_at    timestamptz not null,
  ended_at      timestamptz,
  span tstzrange generated always as
    (tstzrange(started_at, coalesce(ended_at,'infinity'), '[)')) stored,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  duration_minutes integer generated always as
    (case when ended_at is null then null
          else greatest(0, (extract(epoch from ended_at - started_at)/60)::int - break_minutes) end) stored,
  activity      text not null default 'install'
                  check (activity in ('travel','install','fabrication','assessment','admin','break')),
  -- Rate snapshot, so a raise never rewrites the margin on a finished job.
  cost_rate_cents_per_hour bigint not null default 0,
  cost_cents bigint generated always as
    (case when ended_at is null then 0
          else round(((extract(epoch from ended_at - started_at)/60)::numeric - break_minutes)
                     / 60.0 * cost_rate_cents_per_hour)::bigint end) stored,
  source        text not null default 'mobile' check (source in ('mobile','web','manual','import')),
  start_lat numeric(9,6), start_lng numeric(9,6),
  notes         text,
  approved_by   uuid references users(id), approved_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint time_order check (ended_at is null or ended_at > started_at),
  -- one clock per person at a time
  exclude using gist (user_id with =, span with &&)
);
create index time_entries_job_idx on time_entries (job_id);
create trigger t_time_upd before update on time_entries for each row execute function app.set_updated_at();

create table job_materials (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  job_id        uuid not null references jobs(id) on delete cascade,
  product_id    uuid references products(id) on delete set null,
  name          text not null,
  quantity      numeric(12,3) not null default 1,
  unit          text not null default 'each',
  unit_cost_cents bigint not null default 0,
  total_cost_cents bigint generated always as (round(quantity * unit_cost_cents)::bigint) stored,
  -- Under the lump-sum regime we are the consumer, so the tax we paid is a cost.
  use_tax_cents bigint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index job_materials_idx on job_materials (job_id);
create trigger t_materials_upd before update on job_materials for each row execute function app.set_updated_at();

create table expenses (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  job_id        uuid references jobs(id) on delete set null,
  user_id       uuid references users(id) on delete set null,
  category      text not null default 'other'
    check (category in ('materials','subcontractor','permit','fuel','equipment','disposal','other')),
  vendor        text,
  description   text not null,
  amount_cents  bigint not null check (amount_cents >= 0),
  tax_cents     bigint not null default 0,
  billable      boolean not null default false,
  incurred_on   date not null default current_date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index expenses_job_idx on expenses (job_id, incurred_on);
create trigger t_expenses_upd before update on expenses for each row execute function app.set_updated_at();

-- ============================================================ forms + e-sign

-- ONBOARDING and QA_CHECKLIST become versioned data. Answers are keyed by
-- field key (the stable id), never by label — the label-keyed version of this
-- silently dropped half of every submission when a question was reworded.
create table form_templates (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  key        text not null,
  name       text not null,
  audience   text not null default 'client' check (audience in ('client','crew','internal')),
  created_at timestamptz not null default now(),
  unique (company_id, key)
);

create table form_versions (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  template_id uuid not null references form_templates(id) on delete cascade,
  version     integer not null,
  published_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (template_id, version)
);

create table form_groups (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  version_id uuid not null references form_versions(id) on delete cascade,
  key        text not null,
  title      text not null,
  blurb      text,
  sort_order integer not null default 0,
  unique (version_id, key)
);

create table form_fields (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  version_id uuid not null references form_versions(id) on delete cascade,
  group_id   uuid not null references form_groups(id) on delete cascade,
  key        text not null,                        -- STABLE FOREVER
  label      text not null,                        -- free to reword
  type       field_type not null,
  options    text[] not null default '{}',
  required   boolean not null default false,
  help       text,
  maps_to    text,                                 -- e.g. 'job_openings.measured_width_in'
  sort_order integer not null default 0,
  unique (version_id, key)
);

create table form_submissions (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  version_id   uuid not null references form_versions(id) on delete restrict,
  template_key text not null,
  status       text not null default 'draft' check (status in ('draft','submitted','void')),
  client_id    uuid references clients(id) on delete cascade,
  job_id       uuid references jobs(id) on delete cascade,
  visit_id     uuid references visits(id) on delete cascade,
  quote_id     uuid references quotes(id) on delete cascade,
  answers      jsonb not null default '{}'::jsonb,  -- keyed by form_fields.key
  submitted_at timestamptz,
  submitted_by_user_id uuid references users(id) on delete set null,
  submitted_by_name text,
  submitted_by_ip inet,
  submitted_user_agent text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint submissions_context check (client_id is not null or job_id is not null or visit_id is not null),
  constraint submissions_answers_object check (jsonb_typeof(answers) = 'object')
);
create index submissions_job_idx on form_submissions (job_id, template_key);
create index submissions_answers_gin on form_submissions using gin (answers jsonb_path_ops);
create unique index submissions_one_per_visit on form_submissions (visit_id, template_key)
  where status = 'submitted' and visit_id is not null;
create trigger t_submissions_upd before update on form_submissions for each row execute function app.set_updated_at();

-- Required-field validation happens against the version, in the database.
-- The second check is what makes label-keying impossible to reintroduce.
create or replace function app.validate_submission() returns trigger
language plpgsql as $$
declare missing text[];
begin
  if new.status <> 'submitted' then return new; end if;

  select array_agg(f.key order by f.sort_order) into missing
    from form_fields f
   where f.version_id = new.version_id and f.required
     and coalesce(nullif(trim(new.answers ->> f.key), ''), null) is null;
  if missing is not null then
    raise exception 'submission % missing required fields: %', new.id, missing using errcode = '23514';
  end if;

  if exists (select 1 from jsonb_object_keys(new.answers) k
              where k not in (select key from form_fields where version_id = new.version_id)) then
    raise exception 'submission % has unknown answer keys — answers must be keyed by field id, not label', new.id
      using errcode = '23514';
  end if;

  new.submitted_at := coalesce(new.submitted_at, now());
  return new;
end $$;
create trigger t_submission_validate before insert or update on form_submissions
  for each row execute function app.validate_submission();

-- The legal text is versioned AND snapshotted. A version string alone is not
-- enough: you must be able to show what was on screen without shipping old code.
create table agreement_templates (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  version       text not null,
  effective_from date not null,
  title         text not null,
  warranty_clauses jsonb not null,
  terms_clauses    jsonb not null,
  acknowledgment_text text not null,
  esign_consent_text  text not null,
  document_html text,
  created_at    timestamptz not null default now(),
  unique (company_id, version)
);

create table agreements (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  template_id   uuid not null references agreement_templates(id) on delete restrict,
  agreement_version text not null,
  client_id     uuid not null references clients(id) on delete restrict,
  quote_id      uuid references quotes(id) on delete set null,
  job_id        uuid references jobs(id) on delete set null,
  onboarding_submission_id uuid references form_submissions(id) on delete set null,
  status        text not null default 'pending'
                  check (status in ('pending','sent','viewed','signed','declined','void')),
  document_html text not null,                     -- immutable snapshot
  document_sha256 text not null,
  total_cents   bigint,
  sent_at timestamptz, viewed_at timestamptz, signed_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index agreements_one_signed_per_quote on agreements (quote_id)
  where status = 'signed' and quote_id is not null;
create trigger t_agreements_upd before update on agreements for each row execute function app.set_updated_at();

-- UETA/ESIGN record. Append-only — see the immutability triggers below.
create table signatures (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  agreement_id  uuid references agreements(id) on delete restrict,
  quote_id      uuid references quotes(id) on delete restrict,
  form_submission_id uuid references form_submissions(id) on delete restrict,
  purpose       text not null default 'agreement'
    check (purpose in ('agreement','quote_approval','checklist_signoff','change_order')),
  signer_name   text not null check (length(trim(signer_name)) >= 2),
  signer_email  citext,
  signer_role   text not null default 'customer' check (signer_role in ('customer','installer','company')),
  signed_at     timestamptz not null default now(),
  ip_address    inet not null,
  user_agent    text not null,
  agreement_version text not null,
  esign_consent_text text not null,
  consent_checked boolean not null default false check (consent_checked = true),
  document_sha256 text,
  audit         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  constraint signatures_target check (
    agreement_id is not null or quote_id is not null or form_submission_id is not null)
);
create index signatures_agreement_idx on signatures (agreement_id);

-- ============================================================ consent (TCPA)

-- Append-only ledger. The verbatim wording is the evidence — never paraphrase it.
create table consents (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  client_id   uuid references clients(id) on delete cascade,
  email       citext,
  phone       text,
  channel     consent_channel not null,
  action      consent_action not null,
  wording     text not null,
  source      text not null,
  source_url  text,
  occurred_at timestamptz not null default now(),
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz not null default now(),
  constraint consents_identity check (client_id is not null or email is not null or phone is not null)
);
create index consents_client_idx on consents (client_id, channel, occurred_at desc);
create index consents_phone_idx on consents (phone, channel, occurred_at desc) where phone is not null;

-- Current state = latest event per identity+channel. Every send checks this.
create view v_current_consent as
select distinct on (company_id, coalesce(client_id::text, phone, email::text), channel)
       company_id, client_id, phone, email, channel,
       action = 'granted' as granted, wording, source, occurred_at
  from consents
 order by company_id, coalesce(client_id::text, phone, email::text), channel, occurred_at desc;

create or replace function app.has_consent(p_client uuid, p_channel consent_channel)
returns boolean language sql stable as
$$ select coalesce((select granted from v_current_consent
                     where client_id = p_client and channel = p_channel), false) $$;

-- ============================================================ billing

create table billing_milestones (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  job_id     uuid not null references jobs(id) on delete cascade,
  name       text not null,
  kind       invoice_kind not null default 'progress',
  sequence   integer not null default 1,
  percent_bps integer check (percent_bps between 0 and 10000),
  fixed_cents bigint,
  amount_cents bigint not null default 0,
  trigger_event text not null default 'manual'
    check (trigger_event in ('manual','quote_approved','agreement_signed',
                             'fabrication_started','install_scheduled','job_completed')),
  invoice_id uuid,
  due_offset_days integer not null default 0,
  created_at timestamptz not null default now(),
  unique (job_id, sequence),
  constraint milestone_amount check (percent_bps is not null or fixed_cents is not null)
);

create table invoices (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  number        bigint not null,
  kind          invoice_kind not null default 'standalone',
  status        invoice_status not null default 'draft',
  client_id     uuid not null references clients(id) on delete restrict,
  job_id        uuid references jobs(id) on delete set null,
  quote_id      uuid references quotes(id) on delete set null,
  title         text,
  client_message text,
  tax_rate_bps  integer not null default 700,
  subtotal_cents bigint not null default 0,
  discount_cents bigint not null default 0,
  tax_cents      bigint not null default 0,
  total_cents    bigint not null default 0,
  amount_paid_cents     bigint not null default 0,
  amount_refunded_cents bigint not null default 0,
  balance_cents bigint generated always as
    (total_cents - amount_paid_cents + amount_refunded_cents) stored,
  issue_date date, due_date date,
  net_terms_days integer not null default 0,
  sent_at timestamptz, first_viewed_at timestamptz, paid_at timestamptz, voided_at timestamptz,
  stripe_invoice_id text unique,
  stripe_payment_link_url text,
  hubspot_deal_id text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, number),
  constraint invoices_money_nonneg check (
    subtotal_cents >= 0 and tax_cents >= 0 and total_cents >= 0 and amount_paid_cents >= 0),
  constraint invoices_issued_has_dates check (
    status = 'draft' or (issue_date is not null and due_date is not null))
);
create index invoices_outstanding_idx on invoices (company_id, due_date)
  where status in ('sent','viewed','partially_paid');
create trigger t_invoices_upd before update on invoices for each row execute function app.set_updated_at();

alter table billing_milestones add constraint milestones_invoice_fk
  foreign key (invoice_id) references invoices(id) on delete set null;

-- "Overdue" is derived, never stored — it is a function of due_date and balance.
create view v_invoices_overdue as
select i.*, current_date - i.due_date as days_overdue
  from invoices i
 where i.status in ('sent','viewed','partially_paid')
   and i.balance_cents > 0 and i.due_date < current_date;

create table invoice_line_items (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  invoice_id    uuid not null references invoices(id) on delete cascade,
  quote_line_item_id uuid references quote_line_items(id) on delete set null,
  kind          text not null default 'material'
    check (kind in ('material','labor','fee','discount','deposit_credit','allowance')),
  name          text not null,
  quantity      numeric(12,3) not null default 1,
  unit          text not null default 'each',
  unit_price_cents bigint not null default 0,
  is_taxable    boolean not null default true,
  amount_cents  bigint generated always as (round(quantity * unit_price_cents)::bigint) stored,
  tax_cents     bigint not null default 0,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);
create index invoice_lines_idx on invoice_line_items (invoice_id, sort_order);

create table payments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  invoice_id    uuid not null references invoices(id) on delete restrict,
  client_id     uuid not null references clients(id) on delete restrict,
  status        payment_status not null default 'processing',
  method        payment_method not null,
  amount_cents  bigint not null check (amount_cents > 0),
  -- Stripe takes its cut before the money lands; the owner must see net.
  fee_cents     bigint not null default 0,
  net_cents     bigint generated always as (amount_cents - fee_cents) stored,
  refunded_cents bigint not null default 0 check (refunded_cents >= 0),
  stripe_payment_intent_id text,
  stripe_charge_id text,
  stripe_balance_transaction_id text,
  stripe_mandate_id text,                          -- ACH debit authorization
  last4 text, brand text, bank_name text,
  check_number text,
  received_on   date not null default current_date,
  -- ACH clears in 3–5 business days: "initiated" is not "paid".
  expected_settlement_on date,
  settled_at timestamptz,
  failed_at timestamptz, failure_code text,
  disputed_at timestamptz,
  notes text,
  recorded_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_refund_le_amount check (refunded_cents <= amount_cents)
);
create unique index payments_pi_uk on payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
create index payments_invoice_idx on payments (invoice_id);
create trigger t_payments_upd before update on payments for each row execute function app.set_updated_at();

-- Webhook idempotency: insert the event id first, on conflict do nothing.
create table stripe_events (
  id           text primary key,
  company_id   uuid references companies(id) on delete cascade,
  type         text not null,
  livemode     boolean not null default false,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);

-- Keep invoice totals honest without trusting the app layer.
create or replace function app.recalc_invoice_paid() returns trigger
language plpgsql as $$
declare inv uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  update invoices i set
    amount_paid_cents = coalesce((select sum(p.amount_cents) from payments p
                                   where p.invoice_id = inv and p.status = 'succeeded'), 0),
    amount_refunded_cents = coalesce((select sum(p.refunded_cents) from payments p
                                   where p.invoice_id = inv), 0)
   where i.id = inv;
  update invoices i set status = 'paid', paid_at = coalesce(paid_at, now())
   where i.id = inv and i.balance_cents <= 0 and i.status in ('sent','viewed','partially_paid');
  update invoices i set status = 'partially_paid'
   where i.id = inv and i.amount_paid_cents > 0 and i.balance_cents > 0
     and i.status in ('sent','viewed');
  return null;
end $$;
create trigger t_payments_recalc after insert or update or delete on payments
  for each row execute function app.recalc_invoice_paid();

create view v_job_profitability as
select j.id as job_id, j.company_id, j.number, j.title, j.status,
       j.contract_cents as revenue_cents,
       coalesce(mat.material_cost_cents,0) as material_cost_cents,
       coalesce(lab.labor_cost_cents,0)    as labor_cost_cents,
       coalesce(exp.expense_cents,0)       as expense_cents,
       j.contract_cents - coalesce(mat.material_cost_cents,0)
         - coalesce(lab.labor_cost_cents,0) - coalesce(exp.expense_cents,0) as gross_profit_cents,
       coalesce(lab.labor_minutes,0) as labor_minutes,
       coalesce(inv.invoiced_cents,0) as invoiced_cents,
       coalesce(inv.collected_cents,0) as collected_cents
  from jobs j
  left join lateral (select sum(m.total_cost_cents + m.use_tax_cents) as material_cost_cents
                       from job_materials m where m.job_id = j.id) mat on true
  left join lateral (select sum(t.cost_cents) as labor_cost_cents, sum(t.duration_minutes) as labor_minutes
                       from time_entries t where t.job_id = j.id and t.ended_at is not null) lab on true
  left join lateral (select sum(e.amount_cents + e.tax_cents) as expense_cents
                       from expenses e where e.job_id = j.id) exp on true
  left join lateral (select sum(i.total_cents) as invoiced_cents, sum(i.amount_paid_cents) as collected_cents
                       from invoices i where i.job_id = j.id and i.status <> 'void') inv on true;

-- ============================================================ comms

create table conversations (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  client_id  uuid references clients(id) on delete cascade,
  channel    msg_channel not null,
  external_address text not null,
  subject    text,
  job_id     uuid references jobs(id) on delete set null,
  last_message_at timestamptz,
  unread_count integer not null default 0,
  assigned_to uuid references users(id) on delete set null,
  status     text not null default 'open' check (status in ('open','snoozed','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, channel, external_address)
);
create trigger t_conversations_upd before update on conversations for each row execute function app.set_updated_at();

create table messages (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  client_id     uuid references clients(id) on delete set null,
  channel       msg_channel not null,
  direction     msg_direction not null,
  status        text not null default 'queued'
    check (status in ('queued','sending','sent','delivered','received','failed','bounced')),
  from_address  text not null,
  to_address    text not null,
  subject       text,
  body_text     text,
  body_html     text,
  job_id     uuid references jobs(id) on delete set null,
  visit_id   uuid references visits(id) on delete set null,
  quote_id   uuid references quotes(id) on delete set null,
  invoice_id uuid references invoices(id) on delete set null,
  provider   text check (provider in ('telnyx','resend','manual','system')),
  provider_message_id text,
  error_code text, error_message text,
  segments   integer,
  cost_cents bigint not null default 0,
  template_key text,
  automation_id text,
  sent_by    uuid references users(id) on delete set null,
  sent_at timestamptz, delivered_at timestamptz, read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index messages_provider_uk on messages (provider, provider_message_id)
  where provider_message_id is not null;
create index messages_conversation_idx on messages (conversation_id, created_at desc);
create trigger t_messages_upd before update on messages for each row execute function app.set_updated_at();

-- ==================== THE SAFETY TABLES ====================
--
-- The CRM carries thousands of dormant contacts. A naive "everyone with status
-- X" cron would mail a four-figure list on its first run and burn the sending
-- domain. Four gates prevent it, and they live in data so they are auditable:
--   1. epoch_at     — nothing older than this is ever eligible (null = nothing sends)
--   2. exact-day    — offsets_days matched exactly; past due is not due
--   3. dedupe       — message_sends row per step+occurrence, reserved BEFORE sending
--   4. armed        — false produces a dry run that logs who WOULD be mailed
-- Plus a per-run cap. Do not weaken any of them.

create table automation_config (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  automation_id text not null,
  name          text not null,
  trigger_event text not null,
  epoch_at      timestamptz,
  armed         boolean not null default false,
  max_sends_per_run integer not null default 25,
  max_sends_per_day integer not null default 100,
  offsets_days  integer[] not null default '{}',
  channels      msg_channel[] not null default '{email}',
  quiet_hours_start time not null default '08:00',
  quiet_hours_end   time not null default '21:00',
  requires_consent  consent_channel,               -- null = transactional
  updated_by    uuid references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, automation_id),
  -- Arming without an epoch is refused outright.
  constraint armed_requires_epoch check (armed = false or epoch_at is not null)
);
create trigger t_automation_upd before update on automation_config for each row execute function app.set_updated_at();

create table automation_runs (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  automation_id text not null,
  armed      boolean not null,
  epoch_at   timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  considered integer not null default 0,
  due        integer not null default 0,
  sent       integer not null default 0,
  suppressed integer not null default 0,
  errors     integer not null default 0,
  planned    jsonb not null default '[]'::jsonb,   -- dry-run output, verbatim
  error      text
);

-- Reserve-then-send: the row is inserted BEFORE the provider call, so two
-- concurrent crons cannot double-send. A failed send frees the key for retry.
create table message_sends (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  dedupe_key text not null,                        -- 'reminder:24h:visit:<uuid>'
  automation_id text not null,
  step_id    text,
  occurrence integer,
  client_id  uuid references clients(id) on delete cascade,
  visit_id   uuid references visits(id) on delete cascade,
  job_id     uuid references jobs(id) on delete cascade,
  channel    msg_channel not null,
  anchor_date date,
  status     text not null default 'reserved'
    check (status in ('reserved','sent','failed','suppressed')),
  suppression_reason text,                         -- no_consent | unsubscribed | dry_run | cap_reached | quiet_hours
  message_id uuid references messages(id) on delete set null,
  run_id     uuid references automation_runs(id) on delete set null,
  reserved_at timestamptz not null default now(),
  sent_at    timestamptz,
  created_at timestamptz not null default now()
);
create unique index message_sends_dedupe_uk on message_sends (company_id, dedupe_key)
  where status <> 'failed';
create index message_sends_client_idx on message_sends (client_id, automation_id, sent_at desc);

-- STOP replies, hard bounces, manual do-not-contact.
create table suppressions (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  channel    msg_channel not null,
  address    text not null,
  reason     text not null,
  source_message_id uuid references messages(id) on delete set null,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  unique (company_id, channel, address)
);

-- ============================================================ system

create table attachments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  kind         text not null default 'other'
    check (kind in ('photo_before','photo_after','photo_progress','document','signature','receipt','cut_sheet','other')),
  client_id  uuid references clients(id) on delete cascade,
  property_id uuid references properties(id) on delete cascade,
  quote_id   uuid references quotes(id) on delete cascade,
  job_id     uuid references jobs(id) on delete cascade,
  visit_id   uuid references visits(id) on delete cascade,
  form_submission_id uuid references form_submissions(id) on delete cascade,
  agreement_id uuid references agreements(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete cascade,
  expense_id uuid references expenses(id) on delete cascade,
  bucket     text not null default 'job-media',
  storage_path text not null,
  file_name  text not null,
  content_type text not null,
  byte_size  bigint not null check (byte_size >= 0),
  checksum_sha256 text,
  taken_at timestamptz, lat numeric(9,6), lng numeric(9,6),
  caption    text,
  visible_to_client boolean not null default false,
  uploaded_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (bucket, storage_path),
  constraint attachments_has_parent check (num_nonnulls(
    client_id, property_id, quote_id, job_id, visit_id,
    form_submission_id, agreement_id, invoice_id, expense_id) >= 1)
);
create index attachments_job_idx on attachments (job_id) where job_id is not null;

create table activity_log (
  id         bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  actor_user_id uuid references users(id) on delete set null,
  actor_type text not null default 'user'
    check (actor_type in ('user','client','system','automation','webhook')),
  actor_label text,
  verb       text not null,                        -- 'quote.approved', 'payment.succeeded'
  entity_type text not null,
  entity_id  uuid not null,
  client_id  uuid references clients(id) on delete set null,
  job_id     uuid references jobs(id) on delete set null,
  summary    text not null,
  changes    jsonb not null default '{}'::jsonb,
  ip_address inet,
  occurred_at timestamptz not null default now()
);
create index activity_entity_idx on activity_log (entity_type, entity_id, occurred_at desc);
create index activity_company_idx on activity_log (company_id, occurred_at desc);

-- Transactional outbox. Nothing calls Stripe, HubSpot, Telnyx or Resend inline;
-- a status change enqueues here in the same transaction and a cron drains it.
-- That is what makes "HubSpot is down" a non-event.
create table event_outbox (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  topic         text not null,
  idempotency_key text not null,
  entity_type text, entity_id uuid,
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'pending'
    check (status in ('pending','processing','done','failed','dead')),
  attempts      integer not null default 0,
  max_attempts  integer not null default 8,
  available_at  timestamptz not null default now(),
  locked_at timestamptz, locked_by text,
  processed_at timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  unique (company_id, idempotency_key)
);
create index outbox_ready_idx on event_outbox (available_at) where status in ('pending','failed');

-- One-way mirror to HubSpot. The token has crm.objects write but NOT
-- crm.schemas write, so no custom property can ever be created — structured
-- data with no stock home goes in the note body, in the readable "Key: value"
-- grammar the owner already reads on the deal timeline.
create table hubspot_sync_state (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  entity_type text not null,
  entity_id   uuid not null,
  hubspot_object_type text not null check (hubspot_object_type in ('contacts','deals','notes','companies')),
  hubspot_object_id text,
  payload_hash text,                               -- skip the push when nothing changed
  note_kind   text,
  status      text not null default 'pending' check (status in ('pending','synced','failed','skipped')),
  attempts    integer not null default 0,
  last_pushed_at timestamptz,
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- A UNIQUE table constraint cannot contain an expression; this needs an index.
create unique index hubspot_sync_state_uk on hubspot_sync_state
  (company_id, entity_type, entity_id, hubspot_object_type, coalesce(note_kind,''));
create trigger t_hubspot_upd before update on hubspot_sync_state for each row execute function app.set_updated_at();

create table hubspot_import_map (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  hubspot_object_type text not null,
  hubspot_object_id   text not null,
  hubspot_note_id     text,
  entity_type text not null,
  entity_id   uuid not null,
  imported_at timestamptz not null default now(),
  raw        jsonb
);
-- Expression in the key, so a unique index rather than a table constraint.
create unique index hubspot_import_map_uk on hubspot_import_map
  (company_id, hubspot_object_type, hubspot_object_id, coalesce(hubspot_note_id,''), entity_type);

-- Client portal links. The old scheme derived the token from a record id and
-- had no expiry and no per-link revocation — rotating the secret killed every
-- outstanding link at once. These are opaque and individually revocable.
create table portal_links (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  token_hash text not null unique,                 -- sha256 of the token; never the token
  client_id  uuid not null references clients(id) on delete cascade,
  scope      text[] not null default '{client}',
  job_id     uuid references jobs(id) on delete cascade,
  quote_id   uuid references quotes(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete cascade,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  use_count  integer not null default 0,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index portal_links_client_idx on portal_links (client_id) where revoked_at is null;

create table portal_access_log (
  id         bigint generated always as identity primary key,
  company_id uuid references companies(id) on delete cascade,
  token_hash text,
  ok         boolean not null,
  ip_address inet,
  user_agent text,
  path       text,
  occurred_at timestamptz not null default now()
);
create index portal_access_ip_idx on portal_access_log (ip_address, occurred_at desc);

-- ============================================================ state machine

-- Legal transitions are data, so adding one is an INSERT, not a deploy.
create table status_transitions (
  entity      text not null,
  from_status text not null,
  to_status   text not null,
  allows_portal boolean not null default false,
  effects     text[] not null default '{}',
  primary key (entity, from_status, to_status)
);

create or replace function app.enforce_status_transition() returns trigger
language plpgsql as $$
declare v_entity text := tg_argv[0];
begin
  if new.status is not distinct from old.status then return new; end if;
  if not exists (select 1 from status_transitions
                  where entity = v_entity and from_status = old.status::text
                    and to_status = new.status::text) then
    raise exception '% cannot move from % to %', v_entity, old.status, new.status using errcode = '23514';
  end if;
  return new;
end $$;

create trigger t_quotes_status   before update on quotes   for each row execute function app.enforce_status_transition('quote');
create trigger t_jobs_status     before update on jobs     for each row execute function app.enforce_status_transition('job');
create trigger t_invoices_status before update on invoices for each row execute function app.enforce_status_transition('invoice');
create trigger t_visits_status   before update on visits   for each row execute function app.enforce_status_transition('visit');
create trigger t_requests_status before update on requests for each row execute function app.enforce_status_transition('request');

insert into status_transitions (entity, from_status, to_status, allows_portal, effects) values
('quote','draft','sent',               false,'{email.quote_sent,sms.quote_sent,hubspot.deal.presentationscheduled,portal_link.mint}'),
('quote','sent','viewed',              true, '{activity,notify.owner}'),
('quote','sent','approved',            true, '{signature.required,invoice.generate_deposit,hubspot.deal.decisionmakerboughtin}'),
('quote','sent','declined',            true, '{hubspot.deal.closedlost}'),
('quote','sent','expired',             false,'{email.quote_expiring}'),
('quote','sent','draft',               false,'{}'),
('quote','viewed','approved',          true, '{signature.required,invoice.generate_deposit,hubspot.deal.decisionmakerboughtin}'),
('quote','viewed','declined',          true, '{hubspot.deal.closedlost}'),
('quote','viewed','expired',           false,'{}'),
('quote','approved','converted',       false,'{job.create,hubspot.deal.contractsent,hubspot.note.agreement}'),
('quote','expired','sent',             false,'{email.quote_sent}'),
('quote','declined','sent',            false,'{email.quote_sent}'),
('job','pending','scheduled',          false,'{email.visit_scheduled,sms.visit_scheduled}'),
('job','pending','cancelled',          false,'{hubspot.deal.closedlost}'),
('job','scheduled','in_progress',      false,'{}'),
('job','scheduled','pending',          false,'{}'),
('job','scheduled','on_hold',          false,'{email.internal}'),
('job','in_progress','completed',      false,'{checklist.required,invoice.generate_final,hubspot.deal.closedwon,warranty.start,schedule.thirty_day_check}'),
('job','in_progress','on_hold',        false,'{email.internal}'),
('job','on_hold','scheduled',          false,'{}'),
('job','on_hold','in_progress',        false,'{}'),
('job','completed','invoiced',         false,'{email.invoice_sent,stripe.payment_link}'),
('job','completed','in_progress',      false,'{}'),
('job','invoiced','closed',            false,'{automation.review_request}'),
('job','invoiced','completed',         false,'{}'),
('invoice','draft','sent',             false,'{email.invoice_sent,stripe.payment_link,hubspot.note.invoice}'),
('invoice','draft','void',             false,'{}'),
('invoice','sent','viewed',            true, '{}'),
('invoice','sent','partially_paid',    false,'{email.payment_receipt}'),
('invoice','sent','paid',              false,'{email.payment_receipt,hubspot.note.payment}'),
('invoice','sent','void',              false,'{stripe.payment_link_deactivate}'),
('invoice','viewed','partially_paid',  false,'{email.payment_receipt}'),
('invoice','viewed','paid',            false,'{email.payment_receipt,hubspot.note.payment}'),
('invoice','viewed','void',            false,'{}'),
('invoice','partially_paid','paid',    false,'{email.payment_receipt,hubspot.note.payment}'),
('invoice','partially_paid','void',    false,'{}'),
-- an ACH return arrives days later and must be able to reopen a paid invoice
('invoice','paid','partially_paid',    false,'{email.internal}'),
('visit','unscheduled','scheduled',    false,'{email.visit_scheduled,sms.visit_scheduled,schedule.reminder_24h}'),
('visit','scheduled','confirmed',      true, '{}'),
('visit','scheduled','en_route',       false,'{sms.on_my_way}'),
('visit','scheduled','cancelled',      true, '{email.visit_cancelled}'),
('visit','scheduled','unscheduled',    false,'{}'),
('visit','scheduled','no_show',        false,'{email.internal}'),
('visit','confirmed','en_route',       false,'{sms.on_my_way}'),
('visit','confirmed','cancelled',      true, '{email.visit_cancelled}'),
('visit','en_route','in_progress',     false,'{timer.start}'),
('visit','in_progress','completed',    false,'{checklist.required,timer.stop}'),
('visit','in_progress','scheduled',    false,'{}'),
('visit','cancelled','scheduled',      false,'{email.visit_scheduled}'),
('request','new','contacted',                  false,'{}'),
('request','new','assessment_scheduled',       false,'{visit.create,hubspot.deal.appointmentscheduled}'),
('request','new','unqualified',                false,'{hubspot.deal.closedlost}'),
('request','contacted','assessment_scheduled', false,'{visit.create,hubspot.deal.appointmentscheduled}'),
('request','contacted','unqualified',          false,'{}'),
('request','assessment_scheduled','assessed',  false,'{hubspot.deal.qualifiedtobuy,hubspot.note.assessment}'),
('request','assessed','converted',             false,'{}'),
('request','assessed','unqualified',           false,'{}'),
('request','unqualified','contacted',          false,'{}');

-- A job cannot complete without a submitted QA checklist. This is the
-- 30-day-check clause of the terms of sale turned into a constraint.
create or replace function app.require_checklist_on_complete() returns trigger
language plpgsql as $$
begin
  if new.status = 'completed' and old.status <> 'completed' then
    if not exists (select 1 from form_submissions s
                    where s.job_id = new.id and s.template_key = 'qa_checklist'
                      and s.status = 'submitted') then
      raise exception 'job % cannot be completed without a submitted QA checklist', new.number
        using errcode = '23514';
    end if;
    new.completed_at := coalesce(new.completed_at, now());
    new.warranty_starts_on := coalesce(new.warranty_starts_on, current_date);
    new.warranty_ends_on   := coalesce(new.warranty_ends_on, current_date + interval '5 years');
    new.thirty_day_check_due_on := coalesce(new.thirty_day_check_due_on, current_date + 30);
  end if;
  return new;
end $$;
create trigger t_jobs_complete_guard before update on jobs
  for each row execute function app.require_checklist_on_complete();

-- A quote cannot be approved without a recorded signature.
create or replace function app.require_signature_on_approve() returns trigger
language plpgsql as $$
begin
  if new.status = 'approved' and old.status <> 'approved' then
    if not exists (select 1 from signatures s where s.quote_id = new.id)
       and not exists (select 1 from agreements a where a.quote_id = new.id and a.status = 'signed') then
      raise exception 'quote % cannot be approved without a recorded signature', new.number
        using errcode = '23514';
    end if;
    new.approved_at := coalesce(new.approved_at, now());
  end if;
  return new;
end $$;
create trigger t_quotes_approve_guard before update on quotes
  for each row execute function app.require_signature_on_approve();

-- Evidence tables are append-only.
create or replace function app.deny_mutation() returns trigger
language plpgsql as $$
begin raise exception '% is append-only', tg_table_name using errcode = '42501'; end $$;
create trigger t_signatures_immutable before update or delete on signatures
  for each row execute function app.deny_mutation();
create trigger t_consents_immutable before update or delete on consents
  for each row execute function app.deny_mutation();
create trigger t_activity_immutable before update or delete on activity_log
  for each row execute function app.deny_mutation();

-- ============================================================ RLS

-- Rule zero: the anon key gets nothing. Not "RLS will catch it" — no grant at
-- all, so a leaked anon key is inert. The browser talks to route handlers.
revoke all on schema public from anon;
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on schema app from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;

grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
grant execute on function app.current_user_id, app.current_company_id,
                          app.current_role, app.is_office, app.has_consent to authenticated;

do $$ declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- Tier 1 — office: everything in their company.
do $$ declare t text;
begin
  foreach t in array array[
    'clients','properties','openings','products','requests','quotes','quote_openings',
    'quote_line_items','jobs','job_openings','billing_milestones','conversations','messages',
    'form_templates','form_versions','form_groups','form_fields','agreement_templates',
    'agreements','portal_links','document_counters','suppressions'
  ] loop
    execute format($f$
      create policy %1$I_office on public.%1$I for all to authenticated
        using (company_id = app.current_company_id() and app.is_office())
        with check (company_id = app.current_company_id() and app.is_office());
    $f$, t);
  end loop;
end $$;

-- Tier 2 — crew: only what they are assigned to.
create policy visits_office on visits for all to authenticated
  using (company_id = app.current_company_id() and app.is_office())
  with check (company_id = app.current_company_id() and app.is_office());

create policy visits_crew_read on visits for select to authenticated
  using (company_id = app.current_company_id() and app.current_role() = 'crew'
     and exists (select 1 from visit_assignments va
                  where va.visit_id = visits.id and va.user_id = app.current_user_id()));

create policy visits_crew_update on visits for update to authenticated
  using (company_id = app.current_company_id() and app.current_role() = 'crew'
     and exists (select 1 from visit_assignments va
                  where va.visit_id = visits.id and va.user_id = app.current_user_id()))
  with check (company_id = app.current_company_id());

create policy jobs_crew_read on jobs for select to authenticated
  using (company_id = app.current_company_id() and app.current_role() = 'crew'
     and exists (select 1 from visits v join visit_assignments va on va.visit_id = v.id
                  where v.job_id = jobs.id and va.user_id = app.current_user_id()));

create policy clients_crew_read on clients for select to authenticated
  using (company_id = app.current_company_id() and app.current_role() = 'crew'
     and exists (select 1 from jobs j join visits v on v.job_id = j.id
                 join visit_assignments va on va.visit_id = v.id
                  where j.client_id = clients.id and va.user_id = app.current_user_id()));

create policy visit_assignments_rw on visit_assignments for all to authenticated
  using (company_id = app.current_company_id())
  with check (company_id = app.current_company_id() and app.is_office());

create policy time_entries_self on time_entries for all to authenticated
  using (company_id = app.current_company_id()
     and (app.is_office() or user_id = app.current_user_id()))
  with check (company_id = app.current_company_id()
     and (app.is_office() or user_id = app.current_user_id()));

create policy submissions_rw on form_submissions for all to authenticated
  using (company_id = app.current_company_id())
  with check (company_id = app.current_company_id());

create policy attachments_rw on attachments for all to authenticated
  using (company_id = app.current_company_id())
  with check (company_id = app.current_company_id());

create policy job_materials_rw on job_materials for all to authenticated
  using (company_id = app.current_company_id())
  with check (company_id = app.current_company_id());

create policy users_read_team on users for select to authenticated
  using (company_id = app.current_company_id());
create policy users_self_update on users for update to authenticated
  using (id = app.current_user_id() or app.current_role() = 'owner')
  with check (company_id = app.current_company_id());
create policy companies_read on companies for select to authenticated
  using (id = app.current_company_id());

-- Tier 3 — money. No 'crew' policy exists on these tables, so crew read zero
-- rows. This is why jobs carries no money column: Supabase gives every logged-in
-- user the same DB role, so column-level security cannot express "hide the
-- price from the installer". Money lives in tables crew simply cannot reach.
do $$ declare t text;
begin
  foreach t in array array['invoices','invoice_line_items','payments','expenses'] loop
    execute format($f$
      create policy %1$I_money on public.%1$I for all to authenticated
        using (company_id = app.current_company_id() and app.is_office())
        with check (company_id = app.current_company_id() and app.is_office());
    $f$, t);
  end loop;
end $$;

create policy signatures_read on signatures for select to authenticated
  using (company_id = app.current_company_id() and app.is_office());
create policy consents_read on consents for select to authenticated
  using (company_id = app.current_company_id() and app.is_office());
create policy activity_read on activity_log for select to authenticated
  using (company_id = app.current_company_id());

-- Tier 4 — RLS on with ZERO policies, so only the service role reaches them:
--   event_outbox, stripe_events, hubspot_sync_state, hubspot_import_map,
--   automation_config, automation_runs, message_sends, portal_access_log,
--   status_transitions
-- The office UI reads automation state through this definer view instead.
create view v_automation_status with (security_invoker = off) as
  select automation_id, name, trigger_event, armed, epoch_at,
         max_sends_per_run, offsets_days, channels, requires_consent, updated_at
    from automation_config where company_id = app.current_company_id();
grant select on v_automation_status to authenticated;
