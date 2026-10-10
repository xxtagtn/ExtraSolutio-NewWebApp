# Preserving duplicated staff work locations

## Cause

`buildServiceDuplicateForm` copied work location names but initialized every
copied assignment with an empty `workLocationId`. Source location IDs cannot be
reused because work locations belong to an event and creation allocates new IDs.
There was no correspondence between copied planning and these newly created
locations when assignments were submitted.

## Correction

- Copied locations and eligible copied team rows share temporary draft keys.
  These are neither original database IDs nor new persisted fields.
- When the new event is saved, locations are resolved by their current normalized
  names against the locations returned by the existing creation API. Each
  assignment receives its new event's actual location ID, independent of the
  order of the returned locations.
- Renaming preserves the draft key. Removing a location clears that association
  rather than selecting the next location by its index. Disabling locations or
  an invalid source association does not guess a replacement.
- Draft keys survive the existing date trimming/restoration/relocation logic.
  Only active final-period rows are submitted; excluded days do not reappear.
- Temporary keys are stripped before any payload is sent. If an eligible copied
  row becomes an empty slot under the existing inactive-staff protection, its
  assignment draft is updated with the new location ID after event creation.
- Missing destination locations produce an error rather than silently replacing
  a known association with "unassigned". Source records are never updated.
- No backend, schema, confirmation, payment, calculation, template, cancellation
  or layout changes. Ordinary creation/editing uses the existing flow.

## Tests

- `node --test`: 880 passed, 0 failed, 0 skipped. Includes 32 focused duplication
  tests (9 new location tests) and all existing regression coverage.
- Single-day event: four collaborators across three lounges, including two
  collaborators sharing one lounge. New IDs are different from source IDs and
  returned in a different order.
- Multi-day event: per-day and per-function location associations, including the
  same collaborator on different dates. Date trimming, restoration, relocation,
  disabled/unknown locations and original event isolation are covered.
- Renaming, deleting and editing an association are covered. Missing or foreign
  destination locations are rejected. Copying without a team retains existing
  empty-slot behavior.
- `tests/service-duplication-days.browser.mjs`: 20 scenarios passed on desktop
  (1440px) and mobile (390px). Normal/single-day duplication, trimmed dates,
  interleaved cancelled source days, repeated copying, repeated period changes,
  the October 15-25 period, copying without a team, renamed and removed locations.
- Browser save/reopen uses the existing backend event/assignment normalizers.
  Payloads use new location IDs, including renamed areas. Existing Excel row
  generation shows the correct names for each day.
- Single- and multi-day browser cases open the saved event's detail page,
  verify that the location is selected rather than unassigned, change it, save,
  reload and verify persistence. The original event remains unchanged.
- `tests/service-duplication.browser.mjs`: desktop, mobile and compact (320px)
  passed. Covers prepayment protection, creation/editing, templates, cancellation,
  controlled failure/retry and inactive staff becoming unassigned planning slots
  with correct newly created location IDs. No draft keys reach stored data.
- Excel test generates and serializes actual XLSX workbooks for single-day and
  multi-day duplicates, reads them back and verifies each collaborator's location
  name in the worksheet. Existing export code was not changed.
- `tests/staffTravel.browser.mjs`: desktop, mobile and compact passed, including
  totals, clocks, validation, Financeiro, save/reopen and 50/50 travel allocation.
- Lint, production build and PWA validation passed. The production build retains
  its existing non-blocking warning about the large XLSX bundle.

## Boundaries

Browser API requests use simulated storage, not a real database. New location
IDs are simulated and checked through the existing storage normalizers and UI.
No production database writes, messages, notifications or online deployment.
Tests use Chromium; physical devices and Safari were not tested. XLSX contents
were verified programmatically, not by opening Microsoft Excel manually.

Existing events are not repaired retroactively; the correction applies to new
duplications. Existing multi-request event/assignment saving behavior is not
replaced with a new transaction or workflow.
