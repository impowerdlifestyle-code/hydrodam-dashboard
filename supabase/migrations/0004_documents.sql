-- Files the office attaches to a client and the customer sees in their portal:
-- the website estimate, Emma's project plan, the itemized estimate, anything
-- else worth showing. Bytes live in Supabase Storage (private bucket
-- client-docs); this is the index the portal and the office read.
create table if not exists client_documents (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  client_id   uuid not null references clients(id) on delete cascade,
  kind        text not null default 'other'
              check (kind in ('website_estimate','project_plan','itemized_estimate','agreement','photo','other')),
  title       text not null,
  storage_path text not null unique,
  mime        text not null default 'application/pdf',
  size_bytes  bigint not null default 0,
  visible_to_client boolean not null default true,
  uploaded_by text,
  created_at  timestamptz not null default now()
);
create index if not exists client_documents_client_idx on client_documents (client_id, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-docs', 'client-docs', false, 26214400,
        array['application/pdf','image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;
