-- One row per automation, each anchored so that TODAY is exactly its offset.
-- If a rule's date arithmetic is wrong by a day, it silently sends nothing —
-- which looks identical to "nobody is due". This is what catches that.
--
--   psql -v ON_ERROR_STOP=1 -d hydrodam_migration_test -f supabase/test/automation-scenario.sql
--
-- Every address is delivered@resend.dev: Resend accepts it and no human is on
-- the other end, so the send path can be exercised for real.

do $t$
declare
  v_company uuid := public.company_id();
  v_crew uuid; v_client uuid; v_prop uuid;
  v_req uuid; v_quote uuid; v_job uuid; v_visit uuid; v_inv uuid;
begin
  insert into users (company_id, email, full_name, role, cost_rate_cents_per_hour)
  values (v_company, 'scenario.crew@thehydrodam.com', 'Scenario Crew', 'crew', 4000)
  on conflict (company_id, email) do update set full_name = excluded.full_name
  returning id into v_crew;

  insert into clients (company_id, type, first_name, last_name, email, phone, lead_source)
  values (v_company, 'residential', 'Dana', 'Scenario', 'delivered@resend.dev', '+17275550801', 'Website form')
  returning id into v_client;

  insert into properties (company_id, client_id, address_line1, city, postal_code, flood_zone, is_primary)
  values (v_company, v_client, '14 Scenario Way', 'St. Petersburg', '33701', 'AE', true)
  returning id into v_prop;

  -- speed_to_lead: offset 0, so the anchor is today.
  insert into requests (company_id, number, client_id, property_id, status, source, title, created_at)
  values (v_company, public.next_doc_number(v_company,'request'), v_client, v_prop, 'new', 'website_form',
          'Flood barrier assessment', now())
  returning id into v_req;

  -- reminder_24h: offset -1, so the visit is tomorrow.
  insert into visits (company_id, request_id, client_id, property_id, kind, status, title,
                      sequence, scheduled_start, scheduled_end)
  values (v_company, v_req, v_client, v_prop, 'assessment', 'scheduled', 'Assessment', 1,
          (current_date + 1) + time '14:00', (current_date + 1) + time '15:00')
  returning id into v_visit;

  -- quote_followup: offsets 3/7/14, so this was sent exactly 3 days ago.
  insert into quotes (company_id, number, client_id, property_id, status, title, primary_series,
                      subtotal_cents, total_cents, deposit_percent_bps, deposit_due_cents,
                      valid_until, sent_at)
  values (v_company, public.next_doc_number(v_company,'quote'), v_client, v_prop, 'sent',
          'Sentinel — front door', 'sentinel', 120350, 120350, 5000, 60175,
          current_date + 27, now() - interval '3 days')
  returning id into v_quote;

  -- review_request: offset 7, so the job closed a week ago. Statuses are walked
  -- one at a time because the transition trigger refuses a jump.
  insert into jobs (company_id, number, client_id, property_id, status, title, contract_cents)
  values (v_company, public.next_doc_number(v_company,'job'), v_client, v_prop, 'pending',
          'Sentinel install', 120350)
  returning id into v_job;

  insert into form_submissions (company_id, version_id, template_key, status, client_id, job_id, answers)
  select v_company, fv.id, 'qa_checklist', 'draft', v_client, v_job,
         (select jsonb_object_agg(f.key, case f.type when 'check' then 'true'
                                                     when 'select' then f.options[1]
                                                     else 'ok' end)
            from form_fields f where f.version_id = fv.id and f.required)
    from form_versions fv join form_templates ft on ft.id = fv.template_id
   where ft.key = 'qa_checklist' order by fv.version desc limit 1;
  update form_submissions set status = 'submitted', submitted_by_name = 'Scenario Crew'
   where job_id = v_job;

  update jobs set status = 'scheduled' where id = v_job;
  update jobs set status = 'in_progress' where id = v_job;
  update jobs set status = 'completed' where id = v_job;
  update jobs set status = 'invoiced' where id = v_job;
  update jobs set status = 'closed', closed_at = now() - interval '7 days' where id = v_job;

  -- invoice_reminders: offsets -3/0/7/14/30 anchored on the due date, so this
  -- one is due in 3 days.
  insert into invoices (company_id, number, kind, status, client_id, job_id, title,
                        subtotal_cents, total_cents, issue_date, due_date, sent_at)
  values (v_company, public.next_doc_number(v_company,'invoice'), 'final', 'sent', v_client, v_job,
          'Balance due', 60175, 60175, current_date, current_date + 3, now() - interval '1 day')
  returning id into v_inv;

  -- Arm everything that has a rule, with an epoch old enough to cover the
  -- anchors above. dormant_nurture stays disarmed: it is the one that could
  -- reach thousands, and it is consent-gated besides.
  update automation_config
     set armed = true, epoch_at = now() - interval '60 days'
   where automation_id in ('speed_to_lead','reminder_24h','quote_followup',
                           'invoice_reminders','review_request');

  raise notice 'scenario ready: request/visit/quote/job/invoice all anchored for today';
end $t$;
