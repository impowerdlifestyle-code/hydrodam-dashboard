-- Cancelling a booked assessment has to put the request back where it was.
--
-- 0001 only let a request move forward out of assessment_scheduled, so a
-- cancelled visit left the lead parked at "assessment scheduled" with nothing
-- on the calendar, and the office's only way out was forward to "assessed",
-- which told HubSpot the assessment had happened.

insert into status_transitions (entity, from_status, to_status, allows_portal, effects) values
('request','assessment_scheduled','contacted', true, '{}')
on conflict do nothing;
