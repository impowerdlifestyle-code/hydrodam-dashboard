-- Things the team builds from inside the dashboard without a deploy: message
-- templates, automations, checklists, per-role overview layouts, and requests
-- for changes that do need code. One table, one jsonb spec per kind.
create table if not exists builder_items (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  kind        text not null check (kind in ('template','automation','checklist','layout','build_request')),
  key         text not null,
  name        text not null,
  spec        jsonb not null default '{}'::jsonb,
  status      text not null default 'live' check (status in ('draft','live','archived','sent','done')),
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, kind, key)
);
create index if not exists builder_items_kind_idx on builder_items (company_id, kind, created_at desc);
drop trigger if exists t_builder_items_upd on builder_items;
create trigger t_builder_items_upd before update on builder_items for each row execute function app.set_updated_at();
