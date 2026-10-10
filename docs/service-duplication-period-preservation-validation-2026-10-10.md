# Duplicate period editing and temporary team preservation

This follow-up supersedes the destructive draft filtering and implicit end-date
movement described in service-duplication-days-validation-2026-10-10.md.

## Cause

The previous date-change handler coupled start and end dates when moving copied
planning. Its synchronization also permanently removed assignment rows and dated
requirements outside the selected interval. Extending the interval recreated day
tabs, but could not recover those deleted draft rows or their manual edits.

## Correction

- Start and end are edited independently. A temporarily empty or reversed period
  leaves the draft intact; existing date validation still prevents invalid saves.
- Out-of-period assignments and dated requirements are retained only in a
  temporary modal reference. Growing the period restores the same row objects,
  including planned times, roles, rates, confirmation status and manual edits.
- Active rows are matched by date, not by their position in the day tabs. Repeated
  reductions and expansions do not append duplicate rows. Explicitly deleted
  active rows are not restored.
- Moving the complete period outside its previous planning range shifts the
  copied planning only after a valid start/end pair has been entered. The end
  remains the value explicitly selected by the user.
- The retained rows never enter the event payload. Submission still filters the
  active draft against the final interval. Removed days remain absent after save
  and reload when they were not restored before saving.
- Closing the modal, opening another event or applying a template clears the
  temporary cache. Templates retain their existing empty-team behavior.
- Copy-team toggling replaces the copied team rather than appending it, preserving
  the existing confirmation reset and current staff-rate selection rules.
- No backend, schema, payment, validation, cancellation or layout changes.

## Verification

- Full `node --test` suite: 871 passed, 0 failed, 0 skipped. Includes 23 focused
  duplication tests and existing template, financial and cancellation coverage.
- `tests/service-duplication-days.browser.mjs`: 16 passing scenarios, 8 each on
  desktop (1440px) and mobile (390px). Normal duplication, last-day removal,
  first/last trimming, copying after trimming, interleaved source cancellations,
  single-day events, a 16-day source trimmed to October 15-25, and repeated
  reductions/expansions without copying a team.
- The October 15-25 scenario verifies that start editing does not overwrite end.
  It edits a planned time, hourly rate and confirmation, then shrinks, clears and
  expands the end three times. Each day retains its correct team and edits. A
  valid move to November, save and normalized reload are also verified.
- Browser fixtures avoid overlapping manual schedules with the source event;
  the existing overlap protection is not bypassed or modified.
- `tests/service-duplication.browser.mjs`: desktop (1440px), mobile (390px) and
  compact (320px) passed. Includes independent dates, pending copied team,
  cancellation, controlled save failure/retry, prepayment protection, original
  event isolation, creation/editing and applying a template after caching a day.
- `tests/staffTravel.browser.mjs`: desktop, mobile and compact passed. Covers
  save/reopen, 50/50 travel, clocks, totals, hour validation and Financeiro.
- Lint, production build and PWA validation passed. Build still reports its
  existing non-blocking warning about the large XLSX bundle.
- Desktop/mobile screenshots inspected; no new horizontal page overflow.

## Test Boundaries

Browser APIs are mocked, using the existing backend event/assignment normalizers
for save/reload. No real database records, messages or notifications are written.
The production database and production deployment were not tested or changed.
Browser coverage used Chromium, not Safari or a physical mobile device.

The cache exists only during editing. After saving a reduced interval and closing
the modal, excluded days are not retained in storage or recoverable by reopening
that saved event; restoring them requires expanding the draft before saving.

No online deployment was performed.
