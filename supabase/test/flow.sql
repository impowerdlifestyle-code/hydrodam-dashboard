-- Drives one job from lead to paid through nothing but the public API, the
-- same way the app does. If a status transition, a guard or a generated column
-- is wrong, this fails here rather than in front of the owner.
--
--   psql -v ON_ERROR_STOP=1 -d hydrodam_migration_test -f supabase/test/flow.sql

\set ON_ERROR_STOP on
\timing off
\pset tuples_only on
\pset format unaligned

do $t$
declare
  v_company uuid := public.company_id();
  v_client uuid; v_prop uuid; v_open uuid; v_req uuid;
  v_quote uuid; v_job uuid; v_visit uuid; v_inv uuid; v_pay uuid;
  v_crew uuid; v_entry uuid; v_sub uuid;
  v_answers jsonb;
  v_status text;
  v_balance bigint;
begin
  insert into users (company_id, email, full_name, role, cost_rate_cents_per_hour)
  values (v_company, 'flowtest.crew@thehydrodam.com', 'Flow Test Crew', 'crew', 4200)
  on conflict (company_id, email) do update set full_name = excluded.full_name
  returning id into v_crew;

  insert into clients (company_id, type, first_name, last_name, email, phone, lead_source)
  values (v_company, 'residential', 'Flow', 'Tester', 'flow.tester@example.com', '+17275550999', 'Test')
  returning id into v_client;

  insert into properties (company_id, client_id, address_line1, city, postal_code, flood_zone, is_primary)
  values (v_company, v_client, '1 Test Way', 'St. Petersburg', '33701', 'AE', true)
  returning id into v_prop;

  insert into openings (company_id, property_id, label, type, width_in, protection_height_in)
  values (v_company, v_prop, 'Front door', 'door', 36, 30)
  returning id into v_open;

  insert into requests (company_id, number, client_id, property_id, source, title)
  values (v_company, public.next_doc_number(v_company,'request'), v_client, v_prop, 'website_form', 'Flood barrier assessment')
  returning id into v_req;

  -- request → assessment on the calendar
  perform public.api_visit_create(null, v_req, 'assessment', 'Assessment', now() + interval '1 day', now() + interval '1 day 1 hour', array[v_crew]);
  select status into v_status from requests where id = v_req;
  if v_status <> 'assessment_scheduled' then raise exception 'request should be assessment_scheduled, got %', v_status; end if;

  update requests set status = 'assessed' where id = v_req;

  -- quote
  v_quote := public.api_quote_create(
    v_client, v_prop, v_req, 'Sentinel — front door', 'sentinel',
    jsonb_build_array(jsonb_build_object(
      'opening_id', v_open, 'label','Front door','type','door','width_in',36,
      'protection_height_in',30,'quantity',1,'series','sentinel',
      'panel_count',5,'post_count',2,'center_post_required',false,'line_total_cents',101850)),
    jsonb_build_array(
      jsonb_build_object('kind','material','name','Sentinel barrier — Front door','quantity',1,'unit','each','unit_price_cents',101850,'unit_cost_cents',45000,'is_taxable',false),
      jsonb_build_object('kind','labor','name','Installation labor','quantity',1,'unit','opening','unit_price_cents',18500,'unit_cost_cents',9000,'is_taxable',false)),
    5000, 0, 30);

  select total_cents, deposit_due_cents into v_balance, v_balance from quotes where id = v_quote;
  if (select total_cents from quotes where id = v_quote) <> 120350 then
    raise exception 'quote total should be 120350, got %', (select total_cents from quotes where id = v_quote);
  end if;
  if (select deposit_due_cents from quotes where id = v_quote) <> 60175 then
    raise exception 'deposit should be 60175, got %', (select deposit_due_cents from quotes where id = v_quote);
  end if;

  -- approval without a signature must be refused
  begin
    update quotes set status = 'sent' where id = v_quote;
    update quotes set status = 'approved' where id = v_quote;
    raise exception 'approving without a signature should have failed';
  exception when check_violation then null;
  end;

  perform public.api_quote_approve(v_quote, 'Flow Tester', '203.0.113.9', 'flow-test', '2026-07-28', 'consent text');
  if (select status from quotes where id = v_quote) <> 'approved' then raise exception 'quote not approved'; end if;

  -- job
  v_job := public.api_quote_to_job(v_quote);
  if (select contract_cents from jobs where id = v_job) <> 120350 then raise exception 'contract not frozen at quote total'; end if;
  if (select count(*) from job_openings where job_id = v_job) <> 1 then raise exception 'openings did not carry across'; end if;
  if public.api_quote_to_job(v_quote) <> v_job then raise exception 'converting twice made a second job'; end if;

  -- install visit
  v_visit := public.api_visit_create(v_job, null, 'install', 'Install', now() + interval '7 days', now() + interval '7 days 4 hours', array[v_crew]);
  if (select status from jobs where id = v_job) <> 'scheduled' then raise exception 'job should be scheduled'; end if;

  -- double-booking the same person over the same window must be refused
  begin
    perform public.api_visit_create(v_job, null, 'service', 'Clash', now() + interval '7 days 1 hour', now() + interval '7 days 2 hours', array[v_crew]);
    raise exception 'overlapping assignment should have failed';
  exception when exclusion_violation then null;
  end;

  -- clock
  v_entry := public.api_clock_in(v_crew, v_job, v_visit, 'install');
  if public.api_clock_in(v_crew, v_job, v_visit, 'install') <> v_entry then raise exception 'double clock-in made a second entry'; end if;
  perform pg_sleep(0.05);
  perform public.api_clock_out(v_crew, 0);
  if (select ended_at from time_entries where id = v_entry) is null then raise exception 'clock out did not close the entry'; end if;

  update visits set status = 'en_route' where id = v_visit;
  update visits set status = 'in_progress' where id = v_visit;
  update jobs set status = 'in_progress' where id = v_job;

  -- completing without a checklist must be refused
  begin
    update jobs set status = 'completed' where id = v_job;
    raise exception 'completing without a checklist should have failed';
  exception when check_violation then null;
  end;

  -- every required field, keyed by field id
  select jsonb_object_agg(f.key, case f.type
           when 'check' then 'true'
           when 'select' then f.options[1]
           else 'ok' end)
    into v_answers
    from form_fields f
    join form_versions fv on fv.id = f.version_id
    join form_templates ft on ft.id = fv.template_id
   where ft.key = 'qa_checklist' and f.required;

  v_sub := public.api_checklist_save(v_visit, v_answers, false, 'Flow Test Crew');
  v_sub := public.api_checklist_save(v_visit, '{"issues":"none"}'::jsonb, true, 'Flow Test Crew');
  if (select status from form_submissions where id = v_sub) <> 'submitted' then raise exception 'checklist not submitted'; end if;

  -- a label-keyed answer must still be impossible
  begin
    perform public.api_checklist_save(v_visit, '{"Installer name":"Nope"}'::jsonb, true, 'x');
    raise exception 'label-keyed answers should have been refused';
  exception when check_violation then null;
  end;

  update visits set status = 'completed', completed_at = now() where id = v_visit;
  update jobs set status = 'completed' where id = v_job;
  if (select warranty_ends_on from jobs where id = v_job) <> current_date + interval '5 years' then
    raise exception 'five-year warranty was not stamped';
  end if;
  if (select thirty_day_check_due_on from jobs where id = v_job) <> current_date + 30 then
    raise exception '30-day check was not scheduled';
  end if;

  -- billing: deposit then balance
  v_inv := public.api_invoice_create(v_job, 'deposit', null, null, 7);
  if (select total_cents from invoices where id = v_inv) <> 60175 then
    raise exception 'deposit invoice should be 60175, got %', (select total_cents from invoices where id = v_inv);
  end if;
  perform public.api_payment_record(v_inv, 'check', 60175, '1042');
  if (select status from invoices where id = v_inv) <> 'paid' then
    raise exception 'deposit invoice should be paid, got %', (select status from invoices where id = v_inv);
  end if;

  v_inv := public.api_invoice_create(v_job, 'final', null, null, 7);
  if (select total_cents from invoices where id = v_inv) <> 60175 then
    raise exception 'balance invoice should be 60175, got %', (select total_cents from invoices where id = v_inv);
  end if;

  -- ACH is initiated, not received: the invoice must NOT read as paid yet
  v_pay := public.api_payment_record(v_inv, 'ach', 60175, null);
  if (select status from payments where id = v_pay) <> 'processing' then raise exception 'ACH should be processing'; end if;
  if (select status from invoices where id = v_inv) = 'paid' then raise exception 'ACH must not mark an invoice paid on initiation'; end if;

  update payments set status = 'succeeded', settled_at = now() where id = v_pay;
  if (select status from invoices where id = v_inv) <> 'paid' then raise exception 'settled ACH did not close the invoice'; end if;

  -- card fee, on the published rate
  update jobs set status = 'invoiced' where id = v_job;
  if (select balance_cents from invoices where job_id = v_job and kind = 'final') <> 0 then
    raise exception 'final invoice still has a balance';
  end if;

  -- automations stay disarmed until someone arms them, and arming stamps an epoch
  if exists (select 1 from automation_config where armed) then raise exception 'an automation shipped armed'; end if;
  perform public.api_automation_toggle((select id from automation_config where automation_id = 'review_request'), true);
  if (select epoch_at from automation_config where automation_id = 'review_request') is null then
    raise exception 'arming did not stamp an epoch';
  end if;

  raise notice 'flow ok — job % contract % invoiced and collected',
    (select number from jobs where id = v_job), (select contract_cents from jobs where id = v_job);
end $t$;
