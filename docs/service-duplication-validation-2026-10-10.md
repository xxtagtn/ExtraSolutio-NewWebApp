# Event duplication validation - 2026-10-10

## Scope

- The event detail offers `Duplicar evento`.
- The existing creation form opens with an independent planning-only copy.
- No event is created until `Guardar novo evento` is submitted. Cancellation discards the draft.
- The source event is never used as the update target.
- Team copying is opt-in. Active collaborators are awaiting confirmation, with current staff rates.
- The team can be reviewed and changed before saving. Existing overlap and prepayment rules apply.
- Changing the start date shifts the end date, daily requirements and planned shifts by the same calendar-day offset.

## Copied And Reset Fields

Copied: client, location, event type, dates, planned schedules, uniform, contacts, meeting point,
operational description, role requirements, agreed role tariffs, commercial travel configuration
and work-location names.

Not copied: event/assignment/work-location IDs, reference, invoices, billing/payment state,
payments, advances, adjustments, recorded hours, validations, validation notes, client synchronization,
QR/link tokens, external costs, rate history, cancellations or paid staff travel snapshots.
Cancelled/absent historical assignment rows are excluded; normal placeholders fill requested vacancies.
Work locations receive new IDs on creation. Copied staff must be allocated to those new locations separately.
The client's current minimum-hours policy is loaded before opening the copy.

## Checks

- `node --test`: 856 passing tests, including 8 duplication utility tests.
- `npm run lint`: passed.
- `npm run build`: passed; existing XLSX large-chunk warning remains.
- `npm run verify:pwa`: passed.
- `tests/service-duplication.browser.mjs`: desktop 1440 px, mobile 390 px and compact 320 px.
  Covers open/cancel without writes, save as new event, copied-team review, confirmation resets,
  overnight planned shifts, multi-day date shifting, cleared date inputs, slow client loading,
  failed-create retry, prepayment blocking, original-record protection, normal create/edit controls
  and horizontal overflow.
- `tests/staffTravel.browser.mjs`: existing regression passed on desktop, mobile and compact mobile.
  Covers event editing, commercial travel, staff travel, unchanged clocks, time validation and Finance.
- Desktop and compact-mobile screenshots inspected in `node_modules/.cache/service-duplication/`.

All browser API calls were intercepted and simulated. No production database, live messaging or
production deployment was used. The feature reuses the existing event/assignment create endpoints
and their save/error semantics; it does not add a database schema or a new transaction mechanism.

The restricted sandbox initially blocked local HTTP test connections. The suite was repeated
successfully with local HTTP access enabled.
