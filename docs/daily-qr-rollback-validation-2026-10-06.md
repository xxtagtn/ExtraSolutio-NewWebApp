# Daily QR rollback validation - 2026-10-06

> Historical checkpoint. Superseded by [Monthly pending links validation](monthly-pending-links-validation-2026-10-06.md).
> Daily QR functionality remains; newly issued monthly punching links are now
> available without history. Old monthly tokens remain disabled.

## Current Behavior

- Communication QR tools generate daily links per collaborator/day again,
  using the existing event filter and collaborator/day grouping. Shifts on
  the same day share the same URL; different days have different URLs.
- Already-issued monthly tokens return HTTP 410 for consultation, check-in
  and check-out. Administrative monthly listing endpoints also return 410.
  Rejection happens before token resolution or database access.
- The monthly browser route displays a disabled-link notice without fetching
  any services. There is no redirection or replacement-token disclosure.
- Daily links show current punch candidates only, not completed-service
  history or an agenda of other confirmed shifts/days. Overlapping candidates
  retain the necessary service selection under the existing attendance rules.
- Pre-day access exposes availability metadata only. It does not reveal a
  future-service list or authorize punching. The existing Communication QR
  visibility window remains unchanged.
- Daily and legacy individual links use their original punching expiry;
  extended historical consultation and the copied hours summary are removed.
- Actual punches, validated clocks, payment values, database schema, sessions,
  notification behavior and unrelated pages were not changed by this rollback.
- Checkout cooldown, request revisions, double-tap protection, service-switch
  delay, administrative corrections and overnight checkout remain operational.

## Final Local Checks

| Check | Result |
| --- | --- |
| Every `*.test.mjs` in server/src/shared | 789 passed, no failures/skips |
| Auth session browser suite | Passed |
| Daily QR browser suite with isolated SQLite | Passed |
| Push notifications browser suite | Passed with simulated requests |
| Dashboard attendance browser suite | Passed |
| Communication QR grouping browser suite | Passed |
| Communication mobile browser suite | Passed |
| Staff travel/finance browser suite | Passed at desktop/mobile/compact mobile |
| Retired monthly QR browser suite | Passed at 320/360/390/1280px; no API calls |
| No-consultation daily/legacy browser suite | Passed at 320/360/390/1280px |
| Balance browser suite | Passed |
| ESLint | Passed |
| Production build | Passed; existing large Excel chunk warning remains |
| PWA build verification | Passed |
| SQLite and MySQL schema validation | Passed; no connection or migration |
| Diff whitespace check | Passed |

Public API regression tests cover valid already-issued monthly tokens before
and after former expiry boundaries; GET/POST requests return 410 without
altering assignments, QR codes or punch logs. Daily tests verify omission of
future/history/validation/payment fields, unchanged revisions, no writes on
read, collaborator/day isolation, cancelled/revoked services and all existing
punch safeguards. Browser tests cover completion, expiration during refresh,
24-hour preview metadata and automatic midnight unlocking.

Obsolete monthly HTTP/browser expectations were replaced with retirement
coverage. Dormant monthly helper unit tests remain available but those helpers
are not imported by public routes or the public page.

All database integration fixtures used temporary SQLite databases. Browser
checks used intercepted requests or those isolated fixtures. No production
database access, real message delivery, migration or deployment was performed.

Local logs are in `.codex-tmp/daily-rollback-tests.log`,
`.codex-tmp/daily-rollback-browser.log` and `.codex-tmp/rollback-*.log`.

## Publishing Requirements

Update both the frontend build and the API, and restart the API. Updating only
the frontend does not disable monthly tokens on an older server. Once updated,
send the daily URLs from Communication instead of the retired monthly URLs.
No database migration, deletion of attendance records or signing-secret change
is required.

Before production deployment, verify the same API build on staging with the
production MySQL/MariaDB runtime, HTTPS routing and timezone configuration.
Schema validation alone does not test that runtime. Real-device PWA updating
and actual notification delivery still need staging/device verification.
Preserve environment configuration and uploads, prepare a verified backup and
rollback path, and smoke-test a daily link plus a retired monthly link after
deployment. Monthly links on the current online build have not been disabled
by local edits alone.
