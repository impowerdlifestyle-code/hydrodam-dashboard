-- The Texts copilot's memory.
--
-- Every draft Claude writes for the office is a row, and so is what happened
-- to it: sent as drafted, edited then sent, or rejected with a reason. The
-- eight most recent decisions go back into the next prompt as examples, which
-- is how drafts learn the office's voice. `pending` is a draft nobody has
-- decided on yet (including one superseded by Regenerate); those are never
-- replayed.
--
-- The send itself is not recorded here. It goes through the same gated path
-- as every other text (consent ledger, quiet hours, a message_sends
-- reservation keyed on the draft id) and lands in `messages`; `message_id`
-- links the two.

do $$
begin
  create type sms_draft_action as enum ('pending','sent_as_is','sent_edited','rejected');
exception when duplicate_object then null;
end $$;

create table if not exists sms_drafts (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  client_id      uuid not null references clients(id) on delete cascade,
  kind           text not null
                 check (kind in ('assessment_reminder','assessment_booking_nudge','quote_followup',
                                 'install_scheduling','install_reminder','post_install_checkin',
                                 'review_request','reply_to_latest','custom')),
  prompt_version text not null,
  model          text,
  instruction    text,
  draft_text     text not null,
  final_text     text,
  action         sms_draft_action not null default 'pending',
  reject_reason  text,
  message_id     uuid references messages(id) on delete set null,
  created_by     text,
  created_at     timestamptz not null default now(),
  decided_at     timestamptz,
  constraint sms_drafts_sent_has_text check (action not in ('sent_as_is','sent_edited') or final_text is not null),
  constraint sms_drafts_decided_at check ((action = 'pending') = (decided_at is null))
);
create index if not exists sms_drafts_client_idx on sms_drafts (client_id, created_at desc);
create index if not exists sms_drafts_examples_idx on sms_drafts (kind, decided_at desc) where action <> 'pending';

-- Same grant model as everything else: service role only, anon sees nothing.
alter table public.sms_drafts enable row level security;
alter table public.sms_drafts force row level security;
revoke all on public.sms_drafts from anon, authenticated;
