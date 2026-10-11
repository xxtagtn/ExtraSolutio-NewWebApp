# Monthly open-checkout regression validation - 2026-10-11

## Cause

`qrMonthlyPunching.pending()` discarded every service after its original daily
window expired, including assignments with a saved entry and no exit. A planned
18:00-23:00 service therefore disappeared at midnight and the monthly selector
advanced to the next day. Daily candidate selection and the final attendance
validator also rejected the old service, so changing the list alone was not enough.

## Approved scope

The user explicitly authorized a late-checkout exception only through a still-valid
monthly punch link, for a confirmed assignment in that link's month with a current
entry and no exit. No late entry is authorized. Daily/individual QR links retain
their existing windows. Monthly expiry and the pre-existing month-end overnight
exception remain unchanged.

## Implementation

- Keep open entries in the pending list and prioritize them before new services.
- Pass a server-only permission predicate to daily selection and final validation;
  bypass only `QR_EXPIRED` for the authorized open checkout.
- Re-evaluate monthly priority inside the serializable attendance transaction.
  Administrative reopening of a prior day invalidates a stale next-day request.
- Preserve the existing two-second service-switch delay across service days,
  using saved checkout logs that match the current assignment's exit.
- Return the fresh monthly view after writing, rather than reading a now-expired
  daily view and incorrectly reporting a successful checkout as a failed request.
- Continue using the existing checkout calculations, 30-minute protection,
  atomic compare-and-write, audit logging and transaction conflict handling.
- No frontend production changes, schema changes, automatic exits or data migration.

## Verified results

- Before correction: the Elizabeth regression failed because `activeDay` was
  `2026-10-11`, rather than `2026-10-10`, at 00:30 with the 17:34 entry still open.
- Monthly integration tests: 25 passed, including nine new regression tests.
- Complete `node --test --test-reporter=spec` suite: 889 passed; zero failures,
  skips or cancellations.
- `npm run lint`: passed.
- `npm run build`: passed. Existing large XLSX chunk warning remains non-blocking.
- `npm run verify:pwa`: passed.
- `tests/qr-daily.e2e.mjs`: passed using the real attendance services against a
  temporary SQLite database, with API routing isolated from the real backend.
  The Elizabeth regression passed at 320, 390, 768 and 1440px, including the real
  exit, double-tap prevention, switch delay, admin exit deletion and entry deletion.
  Existing monthly, month-end overnight, daily, preview and overlapping-service
  browser workflows also passed, without browser errors or horizontal overflow.

Other scenarios covered: multiple open service dates; planned overnight shifts;
expired unopened/completed services; concurrent late checkouts; cancellation,
revocation, confirmation and collaborator isolation; stale revisions; link expiry;
same-day split shifts; no synthetic exits; unchanged client validation fields.

Screenshot evidence is in `node_modules/.cache/qr-daily/late-open-{width}.png`.
The full test output is in the ignored `qr-open-entry-full-tests.log`.

## Deployment boundary

Validation was local, with temporary fixtures only. No messages were sent, no real
attendance records were edited, and nothing was deployed online. The production
server and its MySQL database were not accessed during these tests.
