-- The one row every other row hangs off. Safe to re-run.
insert into companies (name, legal_name, slug, timezone, phone, email, address_line1, city, postal_code)
values ('HydroDam', 'Hydro Dam LLC', 'hydrodam', 'America/New_York',
        '+17276131415', 'info@thehydrodam.com', null, 'St. Petersburg', '33701')
on conflict (slug) do nothing;
