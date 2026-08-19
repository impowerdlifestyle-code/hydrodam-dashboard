-- HydroDam Ops — the API surface PostgREST can actually reach.
--
-- 0001 put the business rules in the database: a status-transition table with an
-- enforcing trigger, a checklist gate on job completion, a signature gate on
-- quote approval, an overlap constraint on crew assignment. Those rules only
-- hold if the writes that must happen together happen together.
--
-- PostgREST exposes one schema (public) and one statement per request, so a
-- multi-row operation issued from the app is neither atomic nor reachable when
-- the helper lives in `app`. Everything below is the small set of compound
-- writes the UI performs, each as one transaction, in public where the service
-- role can call it.
--
-- Only service_role may execute these. The anon key has no grant on public at
-- all (0001, "rule zero") and nothing here loosens that.

-- The counter in `app` is unreachable over PostgREST; this is the doorway.
create or replace function public.next_doc_number(p_company uuid, p_type text)
returns bigint language sql security definer set search_path = public, pg_temp as
$$ select app.next_doc_number(p_company, p_type) $$;

create or replace function public.company_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as
$$ select id from companies where slug = 'hydrodam' limit 1 $$;

-- ============================================================ sales

/**
 * A quote and everything under it, in one transaction.
 *
 * Pricing stays in the app — the price book is TypeScript and the estimator on
 * the marketing site shares it — so this takes already-priced rows and is only
 * responsible for the totals arithmetic and the deposit, which must agree with
 * what the client signs.
 */
create or replace function public.api_quote_create(
  p_client uuid, p_property uuid, p_request uuid,
  p_title text, p_series product_series,
  p_openings jsonb, p_lines jsonb,
  p_deposit_bps integer default 5000,
  p_discount_cents bigint default 0,
  p_valid_days integer default 30
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := public.company_id();
  v_quote   uuid;
  v_subtotal bigint;
  v_total    bigint;
begin
  select coalesce(sum((round((l->>'quantity')::numeric * (l->>'unit_price_cents')::numeric))::bigint), 0)
    into v_subtotal
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
   where coalesce((l->>'selected')::boolean, true);

  -- Lump-sum real property improvement: no sales tax to the customer. The
  -- schema supports the retail regime, but this company is not on it.
  v_total := greatest(0, v_subtotal - coalesce(p_discount_cents, 0));

  insert into quotes (
    company_id, number, request_id, client_id, property_id, status, title,
    primary_series, subtotal_cents, discount_cents, tax_cents, total_cents,
    deposit_percent_bps, deposit_due_cents, valid_until
  ) values (
    v_company, app.next_doc_number(v_company, 'quote'), p_request, p_client, p_property,
    'draft', p_title, p_series, v_subtotal, coalesce(p_discount_cents, 0), 0, v_total,
    p_deposit_bps, (v_total * p_deposit_bps / 10000)::bigint,
    current_date + coalesce(p_valid_days, 30)
  ) returning id into v_quote;

  insert into quote_openings (
    company_id, quote_id, opening_id, label, type, width_in, protection_height_in,
    quantity, series, panel_count, post_count, center_post_required, line_total_cents, sort_order
  )
  select v_company, v_quote, nullif(o->>'opening_id','')::uuid, o->>'label',
         (o->>'type')::opening_type, (o->>'width_in')::numeric, (o->>'protection_height_in')::numeric,
         coalesce((o->>'quantity')::integer, 1), (o->>'series')::product_series,
         (o->>'panel_count')::integer, coalesce((o->>'post_count')::integer, 2),
         coalesce((o->>'center_post_required')::boolean, false),
         coalesce((o->>'line_total_cents')::bigint, 0), (ord - 1)::integer
    from jsonb_array_elements(coalesce(p_openings, '[]'::jsonb)) with ordinality as t(o, ord);

  insert into quote_line_items (
    company_id, quote_id, kind, name, quantity, unit, unit_price_cents,
    unit_cost_cents, is_taxable, optional, selected, sort_order
  )
  select v_company, v_quote, coalesce(l->>'kind','material'), l->>'name',
         coalesce((l->>'quantity')::numeric, 1), coalesce(l->>'unit','each'),
         coalesce((l->>'unit_price_cents')::bigint, 0), coalesce((l->>'unit_cost_cents')::bigint, 0),
         coalesce((l->>'is_taxable')::boolean, true), coalesce((l->>'optional')::boolean, false),
         coalesce((l->>'selected')::boolean, true), (ord - 1)::integer
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(l, ord);

  if p_request is not null then
    update requests set converted_quote_id = v_quote where id = p_request;
  end if;

  return v_quote;
end $$;

/**
 * Approval, with the signature that makes it legal.
 *
 * 0001 refuses `approved` without a recorded signature, and rightly so: the
 * approval IS the contract. Recording the two separately from the app would
 * leave a window where one exists without the other.
 */
create or replace function public.api_quote_approve(
  p_quote uuid, p_signer_name text, p_ip text, p_user_agent text,
  p_agreement_version text, p_esign_consent text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := public.company_id();
  v_status  quote_status;
begin
  select status into v_status from quotes where id = p_quote;
  if v_status is null then raise exception 'no quote %', p_quote; end if;
  if v_status = 'approved' then return p_quote; end if;

  -- draft was never presented to anyone; send it first.
  if v_status = 'draft' then
    update quotes set status = 'sent', sent_at = coalesce(sent_at, now()) where id = p_quote;
  end if;

  insert into signatures (
    company_id, quote_id, purpose, signer_name, signer_role, ip_address, user_agent,
    agreement_version, esign_consent_text, consent_checked
  ) values (
    v_company, p_quote, 'quote_approval', p_signer_name, 'customer',
    coalesce(nullif(p_ip,''), '0.0.0.0')::inet, coalesce(nullif(p_user_agent,''), 'unknown'),
    p_agreement_version, p_esign_consent, true
  );

  update quotes
     set status = 'approved', approved_at = now(), approved_by_name = p_signer_name
   where id = p_quote;

  return p_quote;
end $$;

/**
 * Approved quote becomes a job, carrying its openings across as the build list.
 *
 * The contract value is frozen here. Repricing the price book later must not
 * change what this job was sold for.
 */
create or replace function public.api_quote_to_job(p_quote uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := public.company_id();
  v_q       quotes%rowtype;
  v_job     uuid;
begin
  select * into v_q from quotes where id = p_quote;
  if v_q.id is null then raise exception 'no quote %', p_quote; end if;
  if v_q.converted_job_id is not null then return v_q.converted_job_id; end if;
  if v_q.status <> 'approved' then
    raise exception 'quote % is % — only an approved quote becomes a job', v_q.number, v_q.status
      using errcode = '23514';
  end if;

  insert into jobs (
    company_id, number, quote_id, request_id, client_id, property_id, status,
    title, contract_cents, owner_id
  ) values (
    v_company, app.next_doc_number(v_company, 'job'), v_q.id, v_q.request_id,
    v_q.client_id, v_q.property_id, 'pending', v_q.title, v_q.total_cents, v_q.owner_id
  ) returning id into v_job;

  insert into job_openings (
    company_id, job_id, quote_opening_id, label, series, ordered_width_in,
    ordered_height_in, panel_count, post_count, center_post_required, sort_order
  )
  select v_company, v_job, qo.id, qo.label, qo.series, qo.width_in, qo.protection_height_in,
         qo.panel_count, qo.post_count, qo.center_post_required, qo.sort_order
    from quote_openings qo where qo.quote_id = p_quote;

  update quotes set status = 'converted', converted_job_id = v_job where id = p_quote;
  if v_q.request_id is not null then
    update requests set status = 'converted'
     where id = v_q.request_id and status = 'assessed';
  end if;

  return v_job;
end $$;

-- ============================================================ scheduling

/**
 * Book a visit onto the calendar and staff it.
 *
 * Assignments are replaced rather than merged, because the UI presents a crew
 * picker, not a diff. The overlap trigger in 0001 fires on the inserts, so a
 * double-booking raises 23P01 and the whole call rolls back — the visit does
 * not silently keep its old crew.
 */
create or replace function public.api_visit_schedule(
  p_visit uuid, p_start timestamptz, p_end timestamptz, p_users uuid[]
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := public.company_id();
  v_status  visit_status;
begin
  select status into v_status from visits where id = p_visit;
  if v_status is null then raise exception 'no visit %', p_visit; end if;

  update visits
     set scheduled_start = p_start,
         scheduled_end   = p_end,
         status = case when v_status = 'unscheduled' then 'scheduled'::visit_status else v_status end
   where id = p_visit;

  delete from visit_assignments where visit_id = p_visit;
  insert into visit_assignments (company_id, visit_id, user_id, is_lead)
  select v_company, p_visit, u, (ord = 1)
    from unnest(coalesce(p_users, '{}'::uuid[])) with ordinality as t(u, ord);

  return p_visit;
end $$;

create or replace function public.api_visit_create(
  p_job uuid, p_request uuid, p_kind visit_kind, p_title text,
  p_start timestamptz, p_end timestamptz, p_users uuid[]
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := public.company_id();
  v_client  uuid;
  v_prop    uuid;
  v_seq     integer;
  v_visit   uuid;
begin
  if p_job is not null then
    select client_id, property_id into v_client, v_prop from jobs where id = p_job;
  elsif p_request is not null then
    select r.client_id, coalesce(r.property_id, (select id from properties where client_id = r.client_id order by is_primary desc limit 1))
      into v_client, v_prop from requests r where r.id = p_request;
  end if;
  if v_client is null or v_prop is null then
    raise exception 'a visit needs a client and a property on file' using errcode = '23514';
  end if;

  select coalesce(max(sequence), 0) + 1 into v_seq from visits
   where (p_job is not null and job_id = p_job) or (p_job is null and request_id = p_request);

  insert into visits (
    company_id, job_id, request_id, client_id, property_id, kind, status, title,
    sequence, scheduled_start, scheduled_end
  ) values (
    v_company, p_job, p_request, v_client, v_prop, p_kind,
    case when p_start is null then 'unscheduled'::visit_status else 'scheduled'::visit_status end,
    p_title, v_seq, p_start, p_end
  ) returning id into v_visit;

  insert into visit_assignments (company_id, visit_id, user_id, is_lead)
  select v_company, v_visit, u, (ord = 1)
    from unnest(coalesce(p_users, '{}'::uuid[])) with ordinality as t(u, ord);

  -- A job with work on the calendar is scheduled, not pending.
  if p_job is not null and p_start is not null then
    update jobs set status = 'scheduled', scheduled_start = least(coalesce(scheduled_start, p_start), p_start)
     where id = p_job and status = 'pending';
  end if;
  if p_request is not null then
    update requests set status = 'assessment_scheduled'
     where id = p_request and status in ('new','contacted');
  end if;

  return v_visit;
end $$;

-- ============================================================ time clock

create or replace function public.api_clock_in(
  p_user uuid, p_job uuid, p_visit uuid, p_activity text default 'install'
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := public.company_id();
  v_rate    bigint;
  v_open    uuid;
  v_entry   uuid;
begin
  select id into v_open from time_entries where user_id = p_user and ended_at is null limit 1;
  if v_open is not null then return v_open; end if;

  select cost_rate_cents_per_hour into v_rate from users where id = p_user;

  -- clock_timestamp(), not now(): a time clock records wall time, and now() is
  -- frozen for the whole transaction, which makes a clock-out in the same
  -- statement batch collide with its own start.
  insert into time_entries (company_id, user_id, job_id, visit_id, started_at, activity, cost_rate_cents_per_hour, source)
  values (v_company, p_user, p_job, p_visit, clock_timestamp(), coalesce(p_activity, 'install'), coalesce(v_rate, 0), 'mobile')
  returning id into v_entry;

  return v_entry;
end $$;

create or replace function public.api_clock_out(p_user uuid, p_break_minutes integer default 0)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_entry uuid;
begin
  select id into v_entry from time_entries
   where user_id = p_user and ended_at is null order by started_at desc limit 1;
  if v_entry is null then return null; end if;

  update time_entries
     set ended_at = clock_timestamp(),
         break_minutes = greatest(break_minutes, coalesce(p_break_minutes, 0))
   where id = v_entry;
  return v_entry;
end $$;

-- ============================================================ checklist

/**
 * Save or submit the QA checklist for a visit.
 *
 * Answers merge rather than replace so "Save progress" from a phone with a bad
 * signal cannot wipe what the crew already entered. The database validates the
 * required set and the key space on submit; this only decides what is stored.
 */
create or replace function public.api_checklist_save(
  p_visit uuid, p_answers jsonb, p_submit boolean, p_by text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := public.company_id();
  v_version uuid;
  v_job     uuid;
  v_client  uuid;
  v_sub     uuid;
begin
  select fv.id into v_version
    from form_versions fv join form_templates ft on ft.id = fv.template_id
   where ft.key = 'qa_checklist' and ft.company_id = v_company
   order by fv.version desc limit 1;
  if v_version is null then
    raise exception 'no published qa_checklist version — run the reference seed' using errcode = '23514';
  end if;

  select job_id, client_id into v_job, v_client from visits where id = p_visit;

  select id into v_sub from form_submissions
   where visit_id = p_visit and template_key = 'qa_checklist' order by created_at desc limit 1;

  if v_sub is null then
    insert into form_submissions (company_id, version_id, template_key, status, client_id, job_id, visit_id, answers)
    values (v_company, v_version, 'qa_checklist', 'draft', v_client, v_job, p_visit, coalesce(p_answers, '{}'::jsonb))
    returning id into v_sub;
  else
    update form_submissions set answers = answers || coalesce(p_answers, '{}'::jsonb) where id = v_sub;
  end if;

  if p_submit then
    update form_submissions
       set status = 'submitted', submitted_at = now(), submitted_by_name = p_by
     where id = v_sub;
  end if;

  return v_sub;
end $$;

-- ============================================================ billing

/**
 * Raise an invoice against a job.
 *
 * A deposit invoice is a percentage of the contract; a final invoice is the
 * balance of everything not already invoiced. Passing an explicit amount wins,
 * which is what the office needs for a one-off.
 */
create or replace function public.api_invoice_create(
  p_job uuid, p_kind invoice_kind, p_amount_cents bigint,
  p_title text default null, p_net_days integer default 7
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := public.company_id();
  v_j       jobs%rowtype;
  v_already bigint;
  v_amount  bigint;
  v_invoice uuid;
  v_name    text;
begin
  select * into v_j from jobs where id = p_job;
  if v_j.id is null then raise exception 'no job %', p_job; end if;

  select coalesce(sum(total_cents), 0) into v_already
    from invoices where job_id = p_job and status <> 'void';

  v_amount := coalesce(p_amount_cents, case
    when p_kind = 'deposit' then (v_j.contract_cents * coalesce(
      (select deposit_percent_bps from quotes where id = v_j.quote_id), 5000) / 10000)::bigint
    else greatest(0, v_j.contract_cents - v_already)
  end);

  if v_amount <= 0 then
    raise exception 'job % has nothing left to invoice', v_j.number using errcode = '23514';
  end if;

  v_name := coalesce(p_title, case p_kind
    when 'deposit' then 'Deposit — ' || v_j.title
    when 'final'   then 'Balance due — ' || v_j.title
    else v_j.title end);

  insert into invoices (
    company_id, number, kind, status, client_id, job_id, quote_id, title,
    subtotal_cents, tax_cents, total_cents, issue_date, due_date, net_terms_days
  ) values (
    v_company, app.next_doc_number(v_company, 'invoice'), p_kind, 'draft',
    v_j.client_id, p_job, v_j.quote_id, v_name,
    v_amount, 0, v_amount, current_date, current_date + coalesce(p_net_days, 7), coalesce(p_net_days, 7)
  ) returning id into v_invoice;

  insert into invoice_line_items (company_id, invoice_id, kind, name, quantity, unit, unit_price_cents, is_taxable)
  values (v_company, v_invoice, 'fee', v_name, 1, 'each', v_amount, false);

  return v_invoice;
end $$;

create or replace function public.api_payment_record(
  p_invoice uuid, p_method payment_method, p_amount_cents bigint,
  p_reference text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := public.company_id();
  v_client  uuid;
  v_status  invoice_status;
  v_fee     bigint;
  v_pay     uuid;
begin
  select client_id, status into v_client, v_status from invoices where id = p_invoice;
  if v_client is null then raise exception 'no invoice %', p_invoice; end if;

  -- A draft invoice has never been presented; recording money against it would
  -- leave the client without the document they are paying.
  if v_status = 'draft' then
    update invoices set status = 'sent', sent_at = coalesce(sent_at, now()),
                        issue_date = coalesce(issue_date, current_date),
                        due_date   = coalesce(due_date, current_date + net_terms_days)
     where id = p_invoice;
  end if;

  -- Stripe's published rates. Cash, check and wire cost nothing to receive.
  v_fee := case p_method
    when 'card' then (p_amount_cents * 29 / 1000)::bigint + 30
    when 'ach'  then least(50000, (p_amount_cents * 8 / 1000)::bigint)
    else 0 end;

  insert into payments (
    company_id, invoice_id, client_id, status, method, amount_cents, fee_cents,
    received_on, expected_settlement_on, check_number, notes
  ) values (
    v_company, p_invoice, v_client,
    -- ACH is initiated, not settled. Treating it as received is how a business
    -- books revenue that later bounces.
    case when p_method = 'ach' then 'processing'::payment_status else 'succeeded'::payment_status end,
    p_method, p_amount_cents, v_fee, current_date,
    case when p_method = 'ach' then current_date + 4 end,
    case when p_method = 'check' then p_reference end,
    case when p_method <> 'check' then p_reference end
  ) returning id into v_pay;

  return v_pay;
end $$;

-- ============================================================ automations

create or replace function public.api_automation_toggle(p_id uuid, p_armed boolean)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- `armed_requires_epoch` refuses arming without an epoch, and the epoch is
  -- what stops a first run mailing every dormant lead in the CRM. Stamping it
  -- at arming time means "from now on", which is the only safe default.
  update automation_config
     set armed = p_armed,
         epoch_at = case when p_armed then coalesce(epoch_at, now()) else epoch_at end
   where id = p_id;
  return p_id;
end $$;

-- ============================================================ grants

do $$ declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'api\_%' or p.proname in ('next_doc_number','company_id'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
