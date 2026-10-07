# Staff Payment Tab Values - 2026-10-07

## Scope And Calculation

- Added a monetary total alongside the existing count in all eight Staff
  payment tabs. Count semantics are unchanged: unpaid/paid tabs count unique
  collaborators; the remaining tabs and All count services.
- Totals use the same filtered/searched workflow entries as the counts, before
  pagination or the presentation snapshot. Each service contributes to its
  current workflow state only. All is the sum across that filtered dataset.
- The amount callback reuses Accounting's `assignmentOutstandingPay`, the
  existing staff payment calculator and advance rules. This is the same final
  value displayed in A pagar and the grouped paid/outstanding summaries:
  existing hours/rates, travel, applicable VAT, adjustments, salary advances
  and car payments are retained. No separate gross-payment or cash-ledger
  calculation was introduced. Paid contains only services in the paid state;
  Penhorado and Ganho are not treated as paid.
- Values follow the current editable row preview, successful individual/bulk
  status updates and normal service reloads. Failed status updates leave the
  badges unchanged. No new polling, backend endpoint or persisted total was
  introduced. Empty tabs show zero; aggregation uses integer cents.
- Existing filters, selection, expansion, grouping, pagination, status rules,
  payment dates, database schema and backend payment transactions are unchanged.
- Reused existing tab styling with inline currency and a restrained separator.
  Mobile labels wrap only when needed to fit large amounts inside the controls;
  the existing horizontal tab navigation remains unchanged.

## Automated Local Validation

- All server/src/shared unit and integration tests: 818 passed, no failures/skips.
- Existing 11 browser suites passed; new Staff payment tab browser suite passed
  at 320, 390, 768 and 1440px. All browser writes used intercepted in-memory
  fixtures or the existing attendance suite's isolated SQLite fixture.
- New tests cover empty states, mixed states for the same collaborator, unique
  counts, exact cents across 1001 services, validated hours, legacy explicit
  totals, VAT/travel/adjustments/advances/car amounts, filters and validation.
- State transitions cover 1, 5, 10, 25 and 50 services across all payable states.
  Browser cases cover individual success/failure, 25-service bulk transfers to
  Aguardar RV and Paid, Paid to Validado ES, saved adjustment and page reload.
- Browser totals include all 50 collaborators despite only ten visible groups;
  large values remain contained at 320px. Screenshots reviewed at desktop/mobile.
- ESLint, production build, PWA verification, SQLite/MySQL schema validation
  and whitespace checks passed. Existing large Excel bundle warning remains.
- Logs: `.codex-tmp/staff-tab-values-*.log`. Screenshots:
  `node_modules/.cache/staff-payment-tabs/`.

No production data changes, deployment, messages or migrations were performed.
Validate the frontend update on staging before online release.
