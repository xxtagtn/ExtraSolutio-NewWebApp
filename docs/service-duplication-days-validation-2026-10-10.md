# Duplicate event day/team synchronization

## Cause

The day tabs were derived from the edited start/end dates, but the full assignment
and requirement arrays were retained. Saving could therefore include rows for
days that were no longer visible. Toggling the copy-team checkbox rebuilt the
original team without checking the edited period. Advancing the start date also
shifted every original team, even when the intention was to remove the first days.

## Scoped correction

- `src/utils/serviceDuplication.js`: an idempotent synchronizer filters assignment
  rows (including empty slots) and dated requirements by actual active day keys.
- `src/pages/Services.jsx`: synchronization on duplicate period changes, repeated
  team copying, other draft updates and immediately before submission.
- Within the mapped period, changing the first date resizes the period without
  moving teams to different days. Moving the event to a different period retains
  the previous date-shift behavior, with a separate reference for recopy mapping.
- Cancelled source days are excluded from copied teams and explicit requirements.
  Original cancellation history, assignment identities and financial history are
  not copied to the new event. Existing cancellation actions are unchanged.
- Ordinary event creation/editing, templates, overlap validation, missing-date
  validation, confirmation rules, pricing, payments, schema and layout unchanged.

## Verification

- `node --test`: 867 passed, zero failures; 19 duplication unit tests.
- Unit cases cover all days, one removed day, interleaved cancelled day keys,
  reduced duration, repeated copying, exact date/team associations, moving a
  trimmed event, restoring its first date, single-day conversion, missing dates
  and preservation of the original data.
- `tests/service-duplication-days.browser.mjs`: 12 passing scenarios, six each on
  desktop (1440px) and mobile (390px). Includes teams that differ by day, empty
  planned slots, planned times, repeated copying before/after trimming and source
  cancellations on interleaved days.
- Save/reopen checks use mocked API storage with the existing backend event and
  assignment normalizers. The page is reloaded from stored responses; deleted
  period days and their records do not return. No production/database writes.
- Browser save fixtures move to another month to respect existing overlap rules.
  The current modal has start/end period controls; no new non-contiguous day
  selector was introduced. Interleaved removals are covered via existing
  cancellation data and synchronizer unit tests, not a new modal workflow.
- `tests/service-duplication.browser.mjs`: all three viewports passed, including
  ordinary creation/editing, prepayment protection, controlled save failure and
  cancellation without writes.
- `tests/staffTravel.browser.mjs`: desktop, mobile and compact passed; includes
  save/reopen, totals, hour validation and Financeiro.
- Lint, production build and PWA verification passed. Build retains its existing
  warning for the large XLSX chunk.

No deployment was performed. Existing records and the original event were not
modified; this correction applies while preparing a new duplicate.
