# Client payment overview - approved option 1

## Changes

- Event Costs now opens with a read-only summary: event total, actual received
  amount, outstanding amount, receipt progress and the existing financial status.
- A contextual Register receipt command opens a short receipt form. Signal and
  integral/remaining payment submissions still use `buildClientPaymentPayload`
  and the existing service update endpoint. Subsequent adjustments still use the
  existing additional-receipt endpoint and permission requirements.
- The header's labelled edit icon opens the full existing payment fields for
  correcting dates, forecasts and financial status. Cancel/Escape discard the
  form draft. Unsaved values do not change the recorded overview.
- Receipt entries and their saved adjustment VAT detail are available under
  "Recebimentos registados", now a closed-by-default disclosure. Mouse and
  keyboard opening/closing are tested without payment writes.
  Legacy events display their existing signal/remaining amounts without creating
  journal entries or writing any data on consultation.
- 70/30 reference amounts and guarded correction actions are separate closed
  disclosures. Receipt reversals retain the existing confirmations and blockers.
- Additional amounts still show net base, VAT and gross amount, including the
  safe fallback for old records without a fiscal reference.
- Removed redundant global Costs save buttons: saving is now contextual to the
  open payment form. Other event tabs retain their save controls.
- Main changes: `src/pages/ServiceDetail.jsx` and scoped `src/index.css` styles.
  Existing browser suites were adapted to the new presentation and dialogs.

## Preserved behavior

No backend or schema changes were added for this layout request. No pricing,
invoicing, VAT, hours, partner margins, receipt validation, financial states,
event closure or Staff payment rules were modified. Prior uncommitted VAT-detail
work remains in place. The ordinary save also uses the existing in-flight ref to
prevent double submission before React updates its disabled state.

## Verification

- Full Node regression suite: 1,103 passed, zero failures.
- Lint, production build, PWA verification and whitespace checks passed.
- Chrome browser suites passed at 320, 390, 768 and 1440 px:
  `client-payment`, `client-adjustment`, `client-payment-reference`,
  `client-signal-reversal`, `advance-payment`, `staff-vat-delete`,
  `external-cost-editing`, `event-cost-summary` (all `.browser.mjs`).
- Coverage includes first signal/integral receipt, remaining payment, actual
  dates, validation failures, cancel/Escape, double click, paid forecast versus
  operational completion, subsequent VAT adjustments, mixed tax treatment,
  partial adjustments, history reopening, safe legacy consultation, reversals,
  stale/failed saves, issued invoice guards, updated partner costs and payroll
  invariance. No JavaScript errors in these suites.
- Reviewed desktop/mobile screenshots. Default cards have no editable controls;
  no horizontal overflow in the tested views. Browser requests are intercepted;
  Node HTTP tests use disposable SQLite databases, not real customer records.
- An isolated frontend remains at `http://127.0.0.1:5187`. The production API and
  schedulers were not started or deployed. Live MariaDB and deployment are not
  validated by these local tests. The existing XLSX large-chunk build warning
  remains outside this change.

Screenshot examples: `node_modules/.cache/client-payment/overview-390.png` and
`node_modules/.cache/client-adjustment/outstanding-1440.png`.

## Follow-up: preserve position after saving

Payment saves previously called the blocking `reload()`, which replaced the event
with its loading screen and reset page scroll/disclosure state. Signal/integral/
remaining and additional receipt saves now refresh in the background. The payment
card stays mounted, and a scoped layout effect restores the saved viewport before
paint when a settled balance removes content above the browser's scroll anchor.
The existing Modal supports an optional `preventFocusScroll` flag, enabled only
for these payment dialogs; other modals retain their previous focus behavior.

`tests/payment-scroll.browser.mjs` reproduced the old unmount and now passes all
20 cases (signal, integral, remaining, edit and additional receipt at 320/390/768/
1440 px), with a delayed data refresh. It checks card identity, expanded history,
final scroll position and absence of a transient jump to the top. Only unavoidable
clamping at the new page end is permitted. All API traffic is mocked.
