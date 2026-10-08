# Staff VAT and payment presentation validation

Date: 2026-10-08. Changes are local; nothing was deployed online.

## Root cause and shared correction

`src/utils/staffPayment.js`, `staffPaymentTotal`, previously calculated
`base * 1.23 + paymentAdjustment`. This applied taxable adjustments after VAT.
It is consumed by staff payments, event costs on the server and service cost
forecasts. The correction is in that shared calculation, not a display override.

The shared `staffPaymentBreakdown` now calculates:

1. Adjusted base: service base plus adjustment, capped at zero.
2. VAT: adjusted base times 23%, when the collaborator has VAT enabled.
3. Gross: adjusted base plus VAT.

Money uses the existing two-decimal `toFixed(2)` convention. The adjusted base
and VAT are rounded per service; collaborator/state summaries add integer cents
from those records rather than distributing VAT from a global total.

## Exact regression case

| Hours | Rate | Adjustment | Adjusted base | VAT | Gross |
| --- | --- | --- | --- | --- | --- |
| 5:00 | 8.50 | -2.50 | 40.00 | 9.20 | 49.20 |
| 12:00 | 8.00 | -12.00 | 84.00 | 19.32 | 103.32 |
| 10:00 | 8.00 | 0.00 | 80.00 | 18.40 | 98.40 |
| 11:30 | 8.00 | 0.00 | 92.00 | 21.16 | 113.16 |
| **38:30** | | **-14.50** | **296.00** | **68.08** | **364.08** |

The original base is 310.50. The regression test also reproduces the exact old
367.41 result using the original formula and per-service rounding.

## Presentation and financial semantics

- VAT collaborators retain their existing VAT badge. Total, already paid,
  outstanding and service detail show the net amount first and gross in orange
  with `c/ IVA`.
- Paid/outstanding summaries use the actual records and their current states.
- Non-VAT collaborators keep the existing single amount presentation.
- Salary advances remain cash deductions after VAT, not taxable discounts.
  For an advanced service, the net remaining salary balance is decomposed per
  record, and the full service receipt base is also shown explicitly.
- Cars retain their existing untaxed treatment and payment/cost behavior.
- Company costs and margins still use gross amounts, not the net display value.
- Existing affected event cost snapshots are corrected in service API read
  payloads without database writes. Only events with active billable VAT staff
  and nonzero adjustments receive this projection. Existing incomplete-pricing
  snapshot protections remain in place. Normal payment mutations continue to
  recalculate persisted event totals through the existing workflow.
- Issued client revenue/tax, hours, clocking, validation, payment dates, states,
  selection, filtering, bulk transactions and QR/link rules are unchanged.

## Verification

- All 848 unit/integration tests passed, including no VAT, positive/negative
  adjustments, the exact case above, mixed states, advances/cars, cent rounding,
  event costs, margins and historical read payloads.
- 13 browser verification suites passed: staff payment tabs, balance staff,
  authentication sessions, push notifications, dashboard attendance,
  communication QR groups, communication mobile, daily QR, staff travel,
  balance UI, monthly pending UI, monthly QR UI and QR consultation UI.
- Staff payment tests cover 1440, 768, 390 and 320 px, individual changes,
  25-record bulk updates, failed saves, filters, reload, 50 collaborators,
  positive adjustments, actual-state net/gross summaries and gross Balancete
  costs. VAT screenshots are in
  `node_modules/.cache/staff-payment-tabs/staff-iva-*.png`.
- A staff travel mobile assertion initially combined overdue-payment styling
  with advance styling. The test now isolates advance styling and restores the
  original classes; application styling was not changed for that assertion.
- ESLint, production build, PWA verification and `git diff --check` passed.
  The build retains the existing large-chunk warning.
- Test logs are in `.codex-tmp/staff-vat-*.log`. Browser traffic was mocked;
  no production records, messages or sessions were modified.

These checks validate local code and isolated test data, not the online
deployment or individual production records.
