# Client adjustment VAT detail

## Scope and cause

The outstanding balance was already correct. The receipt journal retained amounts,
dates and the expected gross total, but not the settled sale's net/VAT breakdown.
A historical gross amount alone cannot identify the VAT base of a mixed-rate
adjustment safely.

## Implementation

- `src/utils/clientPaymentAdjustment.js`: captures the existing sales total and
  its recorded VAT in integer cents. Uses the existing partner/VAT helpers to
  itemize Staff, travel and partner differences when their taxes reconcile.
  No gross-balance division by 1.23 and no new sales/pricing formula.
- `server/services/clientPaymentRecord.js`: saves optional `settledFinancials`
  metadata in the existing version-1 JSON journal when a total is fully received.
  New adjustment entries retain `financialAdjustment` metadata. Existing entries,
  receipt amounts and dates are not rewritten. No schema migration.
- `src/components/UI/ClientPaymentAdjustment.jsx`, `src/pages/ServiceDetail.jsx`
  and scoped rules in `src/index.css`: show net base, VAT and outstanding total
  in the existing payment summary and receipt dialog; expose the saved breakdown
  in receipt history. The actual outstanding field remains gross.
- Partial adjustment receipts show the whole adjustment's base/VAT, amount already
  received towards it, and remaining gross balance separately. No arbitrary VAT
  allocation to a partial receipt is presented as an invoice base.
- Unsaved receipt edits suppress the recorded breakdown to avoid mismatched values.

## Compatibility and limitations

- An old fully covered total can acquire its fiscal reference on its next normal
  write, before the total changes. Old journal entries are preserved.
- If an old event already has an outstanding adjustment but no original fiscal
  reference, the UI explicitly reports that the base/VAT are unavailable. It must
  not invent an original tax amount using the current rate or planned hours.
- No historical database backfill or live-event edits were performed.
- Financial states, invoicing, payment validation, revenue, margins, partner costs,
  hours, Staff payroll and event closure rules remain unchanged.

## Verification

- Full Node suite: 1,103 passed, zero failures. Includes temporary-database HTTP
  regression in `server/services/eventCostRegression.test.mjs` and focused unit
  cases in `src/utils/clientPaymentAdjustment.test.mjs`.
- Exact example: 1,392.36 received, initial 1,132.00 base + 260.36 VAT;
  +2 hours at 14 produces +28.00 base +6.44 VAT; final total 1,426.80;
  outstanding 34.44. Receiving 34.44 produces zero outstanding and preserves
  the original 200.00 and 1,192.36 entries and their dates.
- Unit coverage includes exempt and mixed partner VAT, catering's existing split,
  partial additional receipts, second adjustment cycles, cent rounding, excess,
  missing legacy fiscal data and read-only/idempotent metadata handling.
- `tests/client-adjustment.browser.mjs`: Chrome at 320, 390, 768 and 1440 px;
  summary, receipt dialog, double-submit protection, saved history, reopening,
  safe legacy fallback, no horizontal overflow and no JavaScript errors.
  Mixed VAT and partial receipts also checked at 390 and 1440 px.
- Existing `tests/advance-payment.browser.mjs` also passed at all four widths
  (advance payment, Staff validation, additional receipt and excess). Its history
  selector now targets the outer disclosure specifically, since adjustment
  details introduce another nested disclosure. Both browser suites were confirmed
  on an isolated Vite frontend at `http://127.0.0.1:5187`; the old frontend at
  port 5176 stalled while loading the validation page during the first run.
- `npm run lint`, `npm run build` and `npm run verify:pwa` passed.
- Build retains the existing large XLSX chunk warning.
- Browser API traffic is mocked; HTTP suites use disposable SQLite databases.
  Production MariaDB and deployment were not tested or modified.

Local screenshots: `node_modules/.cache/client-adjustment/`.
