# Client receipt management and actual VAT breakdown

## Existing behavior and cause

The event stores a cumulative paid amount, signal fields and a versioned JSON
receipt journal. Its existing protection deliberately prevents aggregate signal
edits from erasing later receipts. The old screen offered aggregate fields and
global reversal, but no operation identifying an individual receipt. A final
settlement therefore made earlier corrections impractical even without an issued
invoice. Removing that protection would have risked silently deleting cash.

## Implementation

- Retained the existing JSON field and original receipt entries. Individual
  changes append linked edit/reverse/delete operations; the current independent
  receipts are projected from that immutable journal.
- Recalculate the existing paid/signal fields, dates and financial status from
  active movements in the same transaction. A computed outstanding adjustment is
  not appended as a receipt. Actual overpayments remain visible, not silently
  reduced to the event total.
- Added an individual receipt action menu and a short edit/confirmation dialog.
  Deletion removes an eligible receipt from the regular list and totals, but
  always leaves an audit tombstone. Linked receipts remain independently
  manageable; issued accounting records remain protected.
- Issued invoices (direct and grouped), legacy invoiced records, both existing
  permissions, event ownership of receipt IDs, stale versions, journal revision,
  confirmed amount and transactional compare-and-update are checked server-side.
  Browser in-flight guards also prevent double clicks.
- New receipts and corrections retain the authenticated author's ID/name and
  recording timestamp. Audit displays original and changed amount/date, plus
  changed type/description. Legacy authors/dates are not invented.
- Global reversal remains guarded and is explicitly named "Reverter todos os
  recebimentos", with confirmation naming ALL receipts and their total.
- Total, received and outstanding show base, actual VAT and gross. Fiscal
  snapshots reuse existing event sales totals and component tax rules; no new
  pricing, margin or VAT formula is introduced.
- Following the user's explicit choice, mixed partial receipts can be allocated
  manually to the components actually paid. The server validates the exact
  distributed gross total and saves the fiscal snapshot with the receipt.
  There is no automatic proportional split across different components.
- Single-treatment receipts use that actual treatment; full receipts use exact
  snapshot values. A final uniform-tax receipt carries a possible rounding cent
  without rewriting earlier entries.
- Unknown legacy/mixed partial tax allocation is shown as pending, not guessed.
  It can be completed through the individual editor when the journal is safely
  identifiable. Ambiguous old unlinked corrections remain protected/read-only.
- Receipt disclosures remain closed by default. Individual saves, like ordinary
  payment saves, keep the card mounted and preserve expanded history and scroll.

## Files

- Server: `server/services/clientReceiptMovements.js`,
  `server/services/clientPaymentRecord.js`, `server/services/clientPayment.js`,
  `server/routes/index.js`. The CRUD update hook additionally receives the
  authenticated request in `server/routes/crud.js` for author attribution.
- Shared calculations: `src/utils/clientReceiptMovements.js`,
  `src/utils/clientReceiptTax.js`; reuse existing payment summary, financial
  snapshot, invoice lifecycle and event tax utilities.
- UI: `src/components/Finance/ClientReceiptEditor.jsx`,
  `src/components/Finance/ClientReceiptAllocation.jsx`,
  `src/components/UI/ClientPaymentTax.jsx`, `src/pages/ServiceDetail.jsx`,
  scoped rules in `src/index.css`.
- Tests: `src/utils/clientReceiptTax.test.mjs`,
  `server/services/clientPayment.test.mjs`,
  `tests/receipt-movements.browser.mjs`. Existing browser tests were adapted to
  the explicitly renamed global command.

## Verification

- Full Node regression suite: **1,131 passed, zero failures/skips**.
- Focused utility/HTTP coverage includes independent edits and reversals after
  a final receipt, date-only/type/description changes, mixed explicit allocation,
  invalid input rollback, same-version concurrent submissions, stale revisions,
  cross-event receipt IDs, both permissions, issued direct/grouped invoices,
  rollback after a database write/readback failure, deletion eligibility,
  legacy consultation/materialization, and rounding cents.
- Main example: 200 + corrected 1,200 = 1,400 actually received; 1,426.80 total
  leaves 26.80 outstanding (21.79 base + 5.01 VAT). Neither the old 34.44 balance
  nor the new 26.80 balance becomes cash without explicit registration.
- Mixed example: selected Staff 123 + exempt partner 27 = 150 received,
  with 127 base + 23 VAT. Editing that signal to 160, allocated as 123 + 37,
  changes received base to 137 and keeps VAT at 23. Other financial data is
  unchanged.
- Browser suites passed at **320, 390, 768 and 1440 px**: `receipt-movements`,
  `client-payment`, `client-adjustment`, `client-payment-reference`,
  `client-signal-reversal`, `advance-payment`, `staff-vat-delete`,
  `external-cost-editing`, `event-cost-summary`, and `payment-scroll`.
  These cover actual isolated API writes for the new menus, audit, selected
  components, cancel, double click, immutable originals, responsive layout,
  no JavaScript errors and no horizontal overflow. Scroll suite has 20 cases;
  individual editing also checks preserved position and expanded receipts.
- ESLint, production build, PWA verification and whitespace checks passed.
- Screenshots reviewed under `node_modules/.cache/receipt-movements/`, including
  mobile corrected balances and desktop component allocation.

## Boundaries and limitations

No schema migration, real customer data changes, live API/scheduler startup,
production release, or pricing/payroll/operational state changes were performed.
Node HTTP and integrated browser tests use disposable SQLite databases; other
browser regression suites intercept API requests. Live MariaDB and production
deployment remain unverified. Legacy records without reliable per-receipt fiscal
data intentionally need explicit allocation rather than fabricated VAT values.
Issued accounting records must still be corrected through the existing Finance
workflow. The pre-existing large XLSX build-chunk warning remains.

Frontend-only local preview: http://127.0.0.1:5187.

## Follow-up: compact figures, reversal VAT and deletion

The three summary metrics now match the supplied reference: a primary net value
and a smaller amber gross value marked "c/ IVA". The separate VAT row was removed
only from these three metrics; the actual fiscal calculations are unchanged.
Accessible labels identify the primary figure as excluding VAT. Unknown fiscal
allocations retain a dash and an explanatory accessible label rather than a
fabricated net amount.

An untouched legacy receipt previously lost its fiscal breakdown after reversing
another receipt: the aggregate reference only matched the former full balance.
The read-only summary now reuses that receipt's saved snapshot or the preserved
uniform-tax reference independently. Unknown mixed-tax partial receipts still
require explicit allocation. Reversing all receipts presents zero net/gross
received and the event's original net/gross outstanding, without losing totals.

Per the subsequent request, Delete is available for independent active receipts,
including a remaining payment after final settlement, subject to invoice and
permission guards. It removes only that receipt from the regular list and cash
totals; the original and authenticated deletion remain in audit. Nothing is
physically erased. Tests include cancel, repeated deletion, other receipts kept
intact, full reversal, zero amounts, persisted values after reopening Costs and
the reference example 296.00 net / 364.08 gross. Compact screenshots at desktop
and mobile sizes were inspected.

## Follow-up: delete already reversed receipts

Reversed receipts now expose only Delete in their individual action menu. After
confirmation, they leave the regular receipt list, including receipts from older
global reversal batches. The operation appends a linked zero-value audit entry;
it cannot subtract cash for a second time. The original receipt and reversal,
author, dates and original reference amount remain in audit.

The transaction updates only the journal and event modification timestamp for
this cleanup. All other stored fields, fiscal snapshots and active receipt
amounts remain identical. Invoice protection is shared with ordinary receipt
corrections but separated from the global reversal requirement for positive cash;
an event with zero received can therefore clean up reverted rows without enabling
a new reversal. Editing/reversing a reverted row and deleting it twice stay
blocked. Permissions, issued invoices, stale versions and concurrent requests
remain protected.

Five additional Node tests cover individual/global reversals, later active cash,
immutable originals, a zero-value tombstone, duplicate submissions, permissions
and issued invoices. The integrated browser suite passed at 320/390/768/1440 px,
including the six reported historical amounts, cancel, double click, removal of
only one row, exact preservation of all financial fields, and persistence after
reopening Costs. ESLint, production build, PWA and whitespace checks passed. No
production data or schema changes were made and nothing was published online.
