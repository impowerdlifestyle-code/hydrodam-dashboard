# Leaving HubSpot: what has to be true first

HubSpot costs HydroDam about $1,800 a month. The dashboard already reads every contact
and every lead status from it, writes stage changes back, and holds the things HubSpot
never had: quotes by opening, jobs, visits, invoices, SMS with consent, the client portal.
So the question is not "can the dashboard replace HubSpot" but "what still only lives
in HubSpot". As of 2 September 2026 that list is short.

## What HubSpot still does that the dashboard does not

| HubSpot job | Dashboard today | Gap to close |
|---|---|---|
| System of record for 3,106 contacts | Reads them live, promotes one to Postgres the first time the office touches it | Bulk-promote everyone once, then stop reading |
| Lead status pipeline Mady works | Mirrored and written back | Nothing; the request status is already the same pipeline |
| Facebook lead-gen intake | Not wired | Point the Facebook lead API at `/api/intake` |
| Website form intake | Already posts to `/api/intake` alongside HubSpot | Turn off the HubSpot half |
| Notes and call history on a contact | Timeline notes are pushed to HubSpot, not stored here | Add a notes table on the client and stop pushing |
| Email sequences and marketing email | Not built; dormant nurture exists but is email-only and unarmed | Decide whether HydroDam needs email marketing at all. If yes, Resend audiences cover it |
| Deal pipeline and forecasting | Quotes page, pipeline by stage, won this month | Nothing; deals were never used, 160 sit untouched at the first stage |
| Reporting | Reports page plus the Overview panels | Compare against whichever HubSpot report Mady actually opens |
| Team logins and permissions | One shared password plus a name picker | Real per-user logins before anyone relies on "who did what" |

## Order of work

1. **Stop creating things in HubSpot** (one week). Website and Facebook leads land in the dashboard first. HubSpot keeps receiving a copy so nothing is lost while the office builds trust in the new list.
2. **Bulk promotion** (one evening). Every HubSpot contact becomes a Postgres client with its lead status, address, source and the HubSpot id kept for reference. The dashboard stops merging live HubSpot data and reads its own table. Speed goes up, the five-minute lag disappears.
3. **Notes and history** (one week). A notes panel on every client, the last twelve months of HubSpot notes imported once.
4. **Per-user logins** (one week). Supabase Auth with the three roles already in the schema. Needed for queues, audit trails and for Emma's access to mean something.
5. **Two weeks in parallel.** Both systems run. If nobody opens HubSpot in that time except to confirm the dashboard matches, cancel it.

## What not to do

Do not migrate deals. They carry no information the requests do not. Do not rebuild
HubSpot's email marketing on day one; it has never been used here. Do not turn off the
HubSpot copy of website leads until step 2 is done and checked.

## Cost

Steps 1 to 4 are roughly three weeks of Voreli build time. After that the running cost
of what replaces HubSpot is Supabase, Resend, Telnyx and Vercel, which today total under
$100 a month for this account.
