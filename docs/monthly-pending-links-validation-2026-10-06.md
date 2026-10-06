# Monthly pending links validation - 2026-10-06

## Current Behavior

- In Communication, the main copy-link action copies the new monthly punching
  link. Its tooltip/label identifies it as monthly. QR viewing, printing,
  downloading and the daily link in the QR dialog retain their existing daily
  URLs and rules. Existing daily and individual links continue to work.
- Monthly URLs are derived from the existing collaborator identifier and
  assignment's calendar month. The same collaborator/month has the same link,
  including services in different events; a new month has a new token.
- New `month2` tokens are valid from local midnight on the first through the
  last instant of that calendar month, using the application timezone.
  There is no consultation extension into the following month. The bounded
  checkout-only exception documented below handles already-started closing shifts.
- Previously retired `month1` tokens remain blocked, even before their former
  expiry. A separate token signature version prevents accidental reactivation.
- Only confirmed, non-cancelled, non-revoked services still requiring a punch
  and within an existing/current-or-future usage window are returned by the new
  API. Completed services and expired uncompleted services are excluded there,
  not merely hidden in the browser. Other people/months remain isolated.
- Current eligible punches are shown above a compact, searchable, chronological
  day list. At most five pending days appear per page; one day expands at a time.
  Future detail shows the planned schedule, role and location, not punch history,
  validation information, totals or payment fields. Active candidates are not
  duplicated in that list.
- Entry keeps a service available for its pending checkout. Once checkout
  completes it, the service disappears immediately. Newly confirmed services
  appear on refresh without generating records or reissuing the link.
- The new month's link can finish a previously opened overnight shift only
  within the original usage window. It does not import earlier history or
  unstarted previous-month services. The previous link can now also finish
  that shift under the checkout-only conditions below.

## Attendance Rules And Storage

Monthly punching delegates to the existing daily registration and individual
attendance transaction. Request revisions, overlap selection, 30-minute
checkout cooldown, double-tap serialization, service-switch delay, cancellation,
revocation, administrative corrections, server clock and existing pay/validation
calculations are reused. Listing a future shift does not authorize an early
entry; the backend enforces the existing service-day rules for every POST.

No schema, table, persistent expiry field or copied assignment record was added.
The extra administrative URL/expiry fields are derived response values only.
No payment calculation, login duration, notification delivery or unrelated page
was changed by this implementation.

## Final Local Checks

| Check | Result |
| --- | --- |
| All server/src/shared `*.test.mjs` | 798 passed; no failures or skips |
| Auth session browser suite | Passed |
| Daily and new monthly punching browser suite | Passed with isolated SQLite |
| Push notifications browser suite | Passed with simulated requests |
| Dashboard attendance browser suite | Passed |
| Communication QR grouping/copy-link browser suite | Passed |
| Communication mobile browser suite | Passed |
| Staff travel/finance browser suite | Passed desktop/mobile/compact mobile |
| Retired monthly link browser suite | Passed; no requests for old link UI |
| Daily/legacy no-consultation browser suite | Passed |
| New monthly pending-view browser suite | Passed |
| Balance browser suite | Passed |
| ESLint | Passed |
| Production build | Passed; existing large Excel chunk warning remains |
| PWA build verification | Passed |
| SQLite/MySQL schema validation | Passed; no connection or migration |
| Diff whitespace check | Passed |

New backend coverage includes the user's 15th-of-month example, expired
uncompleted services, inherited schedules, late confirmation, cancellations,
revoked access, collaborator isolation, immediate disappearance after checkout,
empty pending view, reopening, overlapping/concurrent requests, spoofed IDs,
stale revisions, untouched client/validation/payment fields, month rollover,
overnight checkout and valid/invalid/retired token HTTP requests.

Token boundary tests include the first/last millisecond, leap-year February,
December/January and Lisbon daylight-saving transitions. The token expiry
itself is unchanged; closing-shift authorization is checked separately.
New monthly browser checks cover widths 320/360/390/768/1280/1440 where applicable,
25 pending days, pagination, accent-insensitive search, refresh, shrinking results,
empty view, loaded company logo, no text clipping/overflow and expiry during use.
Real attendance-browser requests use isolated fixtures, not the live database.
Communication tests verify copying the monthly URL while QR pixels still match
the daily URL. The QR dialog identifies its own copy action as daily.

Logs: `.codex-tmp/monthly-pending-tests.log`,
`.codex-tmp/monthly-pending-attendance-browser.log`,
`.codex-tmp/monthly-pending-build.log` and `.codex-tmp/pending-*.log`.

## Next Services Label Follow-Up

- Renamed the visible list heading from `Serviços pendentes` to `Próximos Serviços`.
  Updated its accessible region/navigation labels to match. Service selection,
  listing, empty-state behavior and attendance logic are unchanged.
- Added explicit browser assertions for the heading and accessible region.
  Re-ran all 798 unit/integration tests and all 11 browser suites listed above:
  all passed, with no unit test failures/skips or browser suite failures.
- Re-ran lint, production build, PWA verification, SQLite/MySQL schema
  validation and the whitespace check: all passed. The existing large Excel
  bundle warning remains. Reviewed the updated 320px screenshot for clipping.
- Latest follow-up logs use `.codex-tmp/next-services-*.log`. Fixtures remained
  isolated; no online deployment, production database access or migration was
  performed. The staging/device checks below remain necessary before release.

## Month-End Checkout Follow-Up - 2026-10-07

- An overnight service on the final day of the link's month, with entry
  already recorded before month-end, can finish checkout through that same
  link on the following day. The normal monthly expiry is not extended for
  new entries, unstarted services, completed records or next-month services.
- Eligibility reuses the original service usage window and current confirmed,
  cancellation and revocation checks. Entry logs establish the actual entry
  timestamp; existing schedule fallback supports manually entered times.
  An entry recorded after month-end cannot reactivate the old monthly link.
- The backend checks this authorization again inside the existing attendance
  transaction. Cooldown, revisions, duplicate protection, rounding, client
  times, validation fields and daily/individual QR behavior remain unchanged.
- After checkout, the POST returns a successful, empty closure acknowledgment.
  Further access is rejected as expired when no eligible checkout remains.
  There is no indefinite access: the existing service window remains the cap.
- The UI identifies this mode as `Apenas saída do turno em curso`, shows no
  future/history list or entry button, and confirms closure after checkout.
  Reviewed real browser screenshots at 320px and 1440px.
- Re-ran all 806 unit/integration tests: passed, zero failures/skips.
  All 11 browser suites listed above passed. The attendance browser suite
  additionally checks an 18:00 to 04:00 same-link checkout across month-end
  at 320/390/1440px, double-tap handling and immediate expiry after checkout.
- Backend/HTTP coverage checks successful closure versus subsequent HTTP 410,
  unchanged next-month services, cooldown across midnight, cancellations,
  revocation, non-overnight rejection, original window expiry, actual entries
  after month-end, concurrent exits, transaction-time cancellation, manual
  entries, inherited schedules, leap February, year rollover and summer time.
- Lint, production build, PWA verification and SQLite/MySQL schema validation
  passed. The existing large Excel bundle warning remains. No schema changes,
  production database writes, messages or deployment were performed.
- Logs use `.codex-tmp/overnight-*.log`. Attendance tests used isolated SQLite;
  other browser suites intercepted API traffic. These are local automated
  checks, not a production MySQL runtime or actual-device validation.

## Publishing

No production deployment, database access, message delivery or schema migration
was performed. These are automated local checks, not validation of the online
MySQL/MariaDB runtime or real-device notification delivery.

Deploy both the frontend build and API and restart the API. Keep environment
configuration, the signing secret and timezone consistent; preserve uploads and
prepare a verified backup/rollback path. No schema migration is required. Send
the new link from Communication; old retired monthly links will not be restored.
Verify on staging with the production runtime before release, then smoke-test
monthly copying, a daily QR, pending entry/checkout and expiry online. Verify
the month-end checkout-only exception as well. Verify PWA updating on actual
devices separately.
