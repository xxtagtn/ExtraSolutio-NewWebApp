# Event Staff cost versus client sale: analysis and validation

Date: 2026-10-15. Scope: Events/Services -> Costs -> Financial summary.

## Findings before implementation

The reported example does not reproduce an internal-Staff-cost pricing bug in the existing engine. Its displayed 808.90 already reconciles as 280.00 Staff sale + 430.00 partner sale + 98.90 partner VAT. Using the internal Staff cost would instead produce 752.90. The confirmed problem is ambiguous/incomplete presentation: the label Staff means internal cost, Staff sale is absent, and Expenses includes sales VAT.

Answers to the requested investigation:

1. The displayed 224.00 is Event.totalCost minus externalCostsTotals.costAmount: 654.00 - 430.00. The central calculation builds that Staff cost from Staff hours/rate plus the existing adjustments, compensation and applicable Staff VAT rules.
2. The 10.00 client tariff is the existing requiredRoles.agreedRate snapshot. clientRateForAssignment resolves it by function, then uses the existing rate history/client-configuration fallbacks. No second tariff field was added.
3. The central engine does not use the 8.00 Staff tariff to price client revenue. It uses clientChargeHours multiplied by clientRateForAssignment. The screenshots' total is consistent with that calculation, not the suspected substitution.
4. server/utils/eventTotals.js::calculateEventTotals is the existing central persisted-total calculation. Creation, assignment mutations, hour validation and explicit recalculation already reuse it. Partner net sale/tax and own-service VAT remain separate.
5. Finance -> Clients consumes the persisted totalRevenue, not internal Staff cost. Its existing daily detail already calculates billable service values using client tariffs. Both the persisted API chain and the actual browser view were tested.
6. The new read-only eventCostSummary view model reuses financeEventOperationalSummary and buildClientEventReconciliation, the helpers already used by Finance -> Clients. It separates internal cost, itemized Staff sale, partner cost/sale, net sale, sales VAT, gross revenue and expenses without writing data.
7. Existing tariffs, hours/minimums/rounding, partner markup and tax formulas are reused. No database, pricing engine, payroll, invoice, payment or validation rule was changed.

## Implemented presentation

The Costs summary now shows explicit Custo Staff and Staff cobrado ao cliente, along with Custo Real Parceiros and Parceiros cobrados ao cliente. Venda sem IVA, IVA de venda and Receita com IVA reconcile the customer total. Despesas now shows Staff cost + partner cost, with sales VAT displayed separately rather than hidden inside that label.

Existing margin arithmetic is preserved: gross revenue - internal costs - sales VAT. Its percentage still uses gross revenue as denominator, explicitly identified as Sobre receita com IVA. This avoids silently changing percentage conventions elsewhere in the application.

| FIC Restaurante - FIXOS, 16/10/2026 fixture | Value |
| --- | ---: |
| Billable Staff hours | 28.00 |
| Internal Staff tariff | 8.00 |
| Client Staff tariff | 10.00 |
| Staff cost | 224.00 |
| Staff sale before sales VAT | 280.00 |
| Partner cost | 430.00 |
| Partner net sale | 430.00 |
| Total net sale | 710.00 |
| Sales VAT, per existing configuration | 98.90 |
| Client gross total | 808.90 |
| Company expenses | 654.00 |
| Margin | 56.00 |
| Existing gross-revenue margin percentage | 6.9% |
| Staff payroll | 112.00 per person, 224.00 total |

Travel charged to the client is itemized when present. Historical amounts that cannot be reconciled from available itemization remain visibly undiscriminated. Missing client tariffs do not cause an internal Staff rate to be substituted or a historical total to be rewritten.

## Files changed for this request

- src/pages/ServiceDetail.jsx: explicit financial fields and existing-source view model integration.
- src/utils/eventCostSummary.js: read-only composition of existing client itemization, partner, tax and margin helpers.
- src/index.css: scoped compact two-column summary, wrapping labels/amounts without affecting other pages.
- src/utils/eventCostSummary.test.mjs: 16 dedicated calculation/propagation regressions.
- server/services/eventCostRegression.test.mjs: 3 real HTTP/Prisma temporary-database regressions.
- tests/event-cost-summary.browser.mjs: event summary, Finance Clients and Finance Staff browser checks.

Other pre-existing uncommitted work was retained.

## Test results

- Full Node suite: 985 passed, 0 failed, 0 skipped.
- The 16 dedicated unit tests cover Staff-only, partner-only, mixed events, differing internal/client tariffs, multiple functions, multiple same-function collaborators, zero/nonzero partner markup, Staff adjustments/advances, existing client billing adjustments, real versus billable minimum hours, own-service VAT, all supported partner tax modes, Client totals, Staff payroll, protected historical snapshots, travel and cancelled days.
- The HTTP tests use real authenticated routes against disposable SQLite schema fixtures. They cover client-rate snapshot creation, two 14-hour assignments, stored/reopened totals, client summary, unchanged 8.00 payroll rates, stability when the current client tariff changes, explicit event sale-price updates, independent internal-rate changes, partner-margin updates, separate VAT and issued-invoice protections.
- Browser checks passed at 320/390/768/1440px. They verify all FIC summary fields, 808.90 in Finance Clients, client daily subtotal 280.00, partner net 430.00, VAT 98.90 and Finance Staff at 8.00/hour with 112.00 per person. They also cover partner markup, own-service VAT and missing-price snapshots.
- Browser regressions passed: client-payment, external-cost-editing and client-payment-reference, each at 320/390/768/1440px.
- Browser tests intercept every API request and assert no writes to application data. No uncaught errors/console errors, clipped metric text or page/panel horizontal overflow were found. Desktop/mobile screenshots under node_modules/.cache/event-cost-summary were visually inspected.
- npm run lint, npm run build, npm run verify:pwa and git diff --check passed. The existing XLSX bundle-size warning remains unchanged.

## Validation boundaries

- The FIC example was recreated from the supplied values in isolated fixtures; the production event/database was not inspected or modified.
- Live MySQL and real accounting documents were not exercised. API tests use temporary SQLite; browser tests use intercepted fixtures.
- Existing historical totals and issued invoices are not force-repriced on read. Itemization differences remain explicit rather than silently fabricating or overwriting prices.
- Existing client billing adjustments remain in the current Finance adjustment path. They are not folded into Staff tariffs or automatically rewritten by this summary.
- Staff payment-hour rules were deliberately preserved: client-real payment hours and client-billable minimum hours are not interchangeable. The differing-hours test verifies that a minimum does not inflate Staff payroll.
- There is no online deployment or schema migration. Local frontend: http://localhost:5176/services.
