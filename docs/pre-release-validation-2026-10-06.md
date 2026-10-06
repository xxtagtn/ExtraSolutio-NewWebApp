# Pre-release validation - 2026-10-06

## Result

All available automated local checks passed after the corrections below.
No deployment, production database access, schema migration, real message or
push delivery was performed. This is a local verification report, not a claim
that the production infrastructure has been validated.

## Checks Executed

| Check | Result |
| --- | --- |
| All `*.test.mjs` files in `server`, `src` and `shared` | 774 passed; zero failures or skips |
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
  Recorded times, separately identified validated times and on-page validation
  remain unchanged. Added regression checks for individual, daily and monthly
  links, and verified clipboard output plus the manual-copy fallback.
- Re-ran all listed checks after this summary change; all passed locally.
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

No payment calculations, attendance rules, login duration or database structure
were changed by these verification corrections.

## Monthly Link Regression Coverage

- A new link is generated for each calendar month.
- Punching ends at the end of that month in Europe/Lisbon.
- The old monthly link remains read-only through the following 14th, inclusive.
- Old links reject both entry and exit during consultation, including direct
  API requests, and stop consultation at midnight starting the 15th.
- The old link does not expose the next month's services or replacement token.
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
- Verify PWA updating from the currently installed version on real devices.
- Test actual push delivery on a real phone, including background/closed app.
- Preserve uploads and environment configuration, and prepare a verified backup
  and rollback path before any deployment.

Do not use the real production database for destructive test fixtures.

The final local test output is in `.codex-tmp/pre-release-tests.log`; individual
browser suite logs are also in `.codex-tmp`. These are generated local artifacts.
