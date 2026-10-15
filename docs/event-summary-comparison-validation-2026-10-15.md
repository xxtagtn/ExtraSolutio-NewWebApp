# Event financial summary: comparison layout

## Scope

- Implements approved option 1 in Events > Costs > Financial summary.
- Hours remain above a semantic cost-versus-sale table.
- Staff and partner costs are compared against their existing client sale values.
- Travel sales and undiscriminated stored amounts remain visible when applicable.
- VAT itemization, total charged to the client, margin and margin percentage remain separate.
- Internal totals are labelled "Totais", not "Sem IVA": the existing internal cost basis is unchanged.
- Uses the existing eventCostSummary and financial rules without new financial formulas, API writes or database changes.

## Validation

- Full Node test suite: 1,037 passed, zero failures.
- Browser comparison tests: 320, 390, 768 and 1440px; no horizontal overflow or clipped cells.
- Cases: baseline Staff plus partner, Staff VAT, partner markup, missing sale price, partner-only service, negative margin, travel and large amounts.
- Existing Finance Clients and Staff payroll amounts verified by the browser regression.
- Dynamic financial refresh regression passed at 390 and 1440px, including stale-response protection.
- Browser tests intercept API requests; no real financial records are changed.
- Screenshots: node_modules/.cache/event-cost-summary/summary-{width}.png.
- Lint, production build and PWA verification run locally.

## Limits

- No online deployment or production database writes performed.
- Responsive checks use Chrome; other browser engines were not tested.
