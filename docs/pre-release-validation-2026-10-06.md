# Pre-release validation - 2026-10-06

## Result

All available automated local checks passed after the corrections below.
No deployment, production database access, schema migration, real message or
push delivery was performed. This is a local verification report, not a claim
that the production infrastructure has been validated.

## Checks Executed

| Check | Result |
| --- | --- |
| All `*.test.mjs` files in `server`, `src` and `shared` | 787 passed; zero failures or skips |
| `tests/auth-session.e2e.mjs` | Passed |
| `tests/qr-daily.e2e.mjs` | Passed |
| `tests/push-notifications.e2e.mjs` | Passed |
| `tests/dashboard-attendance.e2e.mjs` | Passed |
| `tests/communication-qr-groups.e2e.mjs` | Passed |
| `tests/communication-mobile.e2e.mjs` | Passed |
| `tests/staffTravel.browser.mjs` | Passed: desktop, mobile and compact mobile |
| `scripts/verify-monthly-qr-ui.mjs` | Passed |
| `scripts/verify-qr-consultation-ui.mjs` | Passed |
| `scripts/verify-balance-ui.mjs` | Passed |
| `npm run lint` | Passed |
| `npm run build` | Passed; existing large Excel bundle warning remains |
| `npm run verify:pwa` | Passed: manifest, service worker and icons |
| Prisma SQLite and MySQL schema validation | Both passed; no database connection or migration |

Browser checks used Chrome/Edge with simulated API requests or isolated SQLite
fixtures. Responsive checks covered widths from 320 to 1600 pixels, depending
on the suite. Backend database integration tests used temporary SQLite files.

## Corrections During Verification

- Removed the validation-status line from the copied QR hours summary only.
  Recorded times remained unchanged. Validated times and on-page validation
  were subsequently removed from the public presentation as described below.
  Added regression checks for individual, daily and monthly
  links, and verified clipboard output plus the manual-copy fallback.
- Fixed monthly history boundaries to the link's origin calendar month. The
  first 14 days no longer append the previous month to the current link.
  Previous-month history remains available through its own read-only link.
- Previously issued 16th-to-15th links also list only their origin calendar
  month, preserving their original consultation expiry. Punching now ends at
  that month's end, rather than admitting services from the following month.
- An eligible overnight service from the previous day can appear temporarily
  in the new link's punching area, but never in its monthly history or copied
  summary. Checkout also works without any new-month assignments.
- Re-ran all listed checks after the planned/punched schedule distinction; all
  passed locally.
- Updated client-normalization fixtures to include the existing required
  billing conditions. Added assertions that missing conditions remain rejected
  and partial updates preserve existing conditions.
- Updated assignment-draft expectations to include the existing work-location
  field.
- Updated financial-action fixtures to use issued invoices and explicit client
  terms instead of inventing deadlines from service dates. Added incomplete-data
  and draft-invoice regression cases.
- Updated Communication browser fixtures for monthly QR endpoints and labels.
- Updated the staff-travel browser workflow to expand collaborator groups and
  use the event-name button. Verified adjustment clicks do not open the summary,
  both payment actions remain readable, and billed hours/rates stay unchanged.
- Fixed Profile notification status refresh after returning from browser/OS
  settings, permission changes and server configuration changes. Added a retry
  button. Refresh does not request permission automatically or discard unsaved
  notification preferences.

No payment calculations, recorded hours, login duration or database structure
were changed. Monthly link access is limited to its origin month; eligible
overnight checkout retains the existing service-level protections.

## Compact Monthly Link Presentation

- Upcoming and recorded-service lists display at most five days per page,
  chronologically. Every shift remains available inside its day.
- Recorded-service search supports event names, dates, accents and existing
  service fields. A matching day retains all its shifts.
- Only one day is expanded at a time, with native keyboard disclosure support.
  Silent refresh preserves search, pagination and the expanded day when present.
- Daily raw intervals reuse the consultation interval calculation, including
  overnight and incomplete records; they are not billed or validated hours.
- The compact header retains the company logo and separate access deadlines.
  Active punches remain above the paginated lists; existing checkout cooldown
  and submission protections remain unchanged.
- Copying the monthly summary always uses the full original payload, ignoring
  search and pagination and excluding future services and validation status.
- Added six presentation unit tests and browser cases with 25 recorded days,
  multiple shifts, six upcoming days, empty search results, refresh, shrinking
  results, copy output and layouts at 320/360/390/1280 pixels.
- The initial compact-layout step touched frontend code only. No server routes,
  database schema, payment rules or attendance validation rules were modified.

### Worked-Hours Label Follow-Up

- Renamed the consultation duration label and copied-summary field to
  `Horas trabalhadas`, including the monthly daily-total tooltip. The existing
  raw clock-difference calculation is unchanged (19:42 to 21:08 remains 1:26h).
- Compact field headings reserve two lines so the three values stay aligned
  on narrow screens without clipping the longer label.
- Re-ran all 784 unit/integration tests, lint, build, PWA and both monthly and
  individual/daily consultation browser suites. The other eight browser suites
  above were run for the compact presentation before this label-only follow-up.

### Planned And Punched Schedules

- Removed validation status and validated schedules from the public link's
  service detail and copied summary. Internal validation data and rules remain
  unchanged.
- Each detail now identifies `Horário previsto` separately from `Horário de
  picagem`. Worked hours still use only the raw entry/exit interval.
- Public payloads explicitly expose existing planned assignment times, falling
  back to the event's start/end when absent, never actual or validated punches.
  Existing schedule fields and attendance logic remain untouched.
- Added planned-schedule unit tests and isolated SQLite coverage for both daily
  and monthly payloads, including inherited event schedules and no record writes.
- Re-ran all 787 unit/integration tests, all ten browser suites, lint, build and
  PWA. Screenshots/checks cover absent punches, different planned/actual times,
  upcoming services, copy fallback, layout, cooldown, legacy links and expiry.
- Deploy the API update together with the frontend so planned-time origins are
  explicit in the payload. No schema change or migration is required.

## Monthly Link Regression Coverage

- A new link is generated for each calendar month.
- Punching ends at the end of that month in Europe/Lisbon.
- The old monthly link remains read-only through the following 14th, inclusive.
- Old links reject both entry and exit during consultation, including direct
  API requests, and stop consultation at midnight starting the 15th.
- The old link does not expose the next month's services or replacement token.
- Month history stays fixed on the 1st, 14th, 15th and throughout the following
  month's consultation period. September and October links remain separate,
  including Communication reads, without changing assignment records.
- The new month's link can complete an eligible overnight service under the
  existing checkout rules.
- Year rollover, February/leap years, daylight saving, isolated collaborators,
  cancelled/revoked services, stale requests and concurrent punches are covered.
- Previously issued 16th-to-15th monthly links retain their original expiry.

## Before Publishing Online

Still required in a separate staging environment matching production:

- Test the API against MariaDB/MySQL, including transaction rollback and bulk
  payment updates. Schema validation does not prove database/runtime behavior.
- Verify production configuration, stable signing secret, application timezone,
  HTTPS public URLs, Apache route fallback/proxy and API startup/restart.
- Deploy and restart the updated API as well as updating the frontend. The
  month-isolation correction is server-side; replacing `dist` alone is not
  sufficient.
- Verify PWA updating from the currently installed version on real devices.
- Test actual push delivery on a real phone, including background/closed app.
- Preserve uploads and environment configuration, and prepare a verified backup
  and rollback path before any deployment.

Do not use the real production database for destructive test fixtures.

The final local test output is in `.codex-tmp/pre-release-tests.log`; individual
browser suite logs are also in `.codex-tmp`. These are generated local artifacts.
