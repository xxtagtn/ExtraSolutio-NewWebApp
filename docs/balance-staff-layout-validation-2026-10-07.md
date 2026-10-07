# Balancete Staff And Dashboard-Style Layout

## Implemented Scope

- Moved Custos por Colaborador and Evolucao Mensal Staff out of Financeiro
  into the new Balancete Staff tab. Payment editing, grouping, filters,
  selection, individual/bulk updates and other Financeiro controls remain.
- Staff analysis reuses the existing finance-ready/billable filters and staff
  calculators. The two former Accounting wrappers now delegate to shared
  functions containing their original formulas, without changing the results.
- Monthly/annual analysis uses each assignment's work date, not its deferred
  payment month or payment date. The annual chart and expandable monthly detail
  cover all twelve months. Year options include assignment dates across years.
- Added collaborator selection, name/NIF search and pagination. Client,
  operational status, year and month filters remain available. Monthly costs
  and annual evolution are clearly distinguished. Search and collaborator
  selection affect the analysis totals as well as the displayed rows.
- Only Paid contributes to the paid balance. Penhorado and Ganho remain
  outstanding. Cost includes existing service amounts, applicable VAT, travel,
  adjustments and car payments. Paid/outstanding use the existing remaining
  balance after salary advances, not a new cash-ledger calculation.
- Applied approved visual proposal 1 to the overview: flat Dashboard-style
  KPI surfaces with colored framed icons, a delimited attention strip,
  adjacent chart/margin tools and the existing forecast disclosure. This visual
  follow-up changes CSS only; no financial formulas or data sources changed.
- Responsive KPIs adapt between side-by-side and stacked layouts. Small
  screens preserve complete amounts, readable controls and all actions.

## Final Local Verification

- All server/src/shared unit and integration tests: 829 passed, zero failures,
  cancellations or skips.
- All 13 browser suites passed: auth-session, push-notifications,
  dashboard-attendance, communication-qr-groups, communication-mobile, qr-daily,
  staffTravel, staff-payment-tabs, balance-staff, verify-balance-ui,
  verify-monthly-pending-ui, verify-monthly-qr-ui, verify-qr-consultation-ui.
- Overview checks cover 320/360/390/768/1024/1280/1600px, all four tabs,
  exact unchanged fixture KPI values, framed KPI/icon styles, single-line
  ordinary KPI amounts, huge amounts/negative margin, keyboard disclosure,
  pending links, forecasts, permissions, loading and failures.
- Staff checks cover 320/390/768/1024/1440px, collaborator/date/client/status
  and name/NIF filters, pagination, month/year boundaries, all twelve months,
  real chart bar geometry, empty/loading/error states and changed payment state
  after reload. The travel suite checks moved staff costs against the unchanged
  payment and client reconciliation values.
- Financial regression suite verifies individual success/failure, adjustments,
  25-service bulk updates, tab counts and monetary totals, filters, 50
  collaborators across pagination, VAT, travel, advances and car amounts.
- ESLint, production build, PWA verification and SQLite/MySQL schema validation
  passed. Existing large Excel chunk warning remains; it is not a build error.
- Screenshots reviewed: `node_modules/.cache/balance-dashboard-style/` and
  `node_modules/.cache/balance-staff/`. Logs: `.codex-tmp/balance-style-*.log`.

Browser mutations are mocked or use isolated test SQLite files. No production
records, schema migrations, external messages or online deployment were made.
These results validate the local application, not the production infrastructure.

## Follow-Up: All Balancete Tabs

- Extended the approved visual style to Clientes, Eventos and Staff. Extracted
  the existing KPI rendering into BalanceKpi so all tabs share the same icon,
  border, spacing and typography. Existing computations remain unchanged.
- Eventos now presents period metrics using the existing overview values;
  its service links and table contents are preserved. Client selection and
  Staff filters, pagination and charts retain their behavior.
- Responsive client/event rows use labeled two-column layouts, without
  horizontal scrolling. Reset inherited inner event-cell grid tracks to a
  single column after screenshot review identified compressed mobile text.
  Added a regression assertion for those computed grid tracks.
- Re-ran all 829 unit/integration tests and all 13 browser suites successfully.
  Extended Balancete checks cover each tab at 320, 360, 390, 768, 1024, 1280
  and 1600px, shared KPI styles, exact fixture totals, client selection and
  event links. Final screenshot review includes mobile Clientes, Eventos and
  Staff as well as desktop views.
- ESLint, build, PWA verification, SQLite/MySQL schema validation and
  git diff whitespace checks passed. The existing bundle-size warning remains.
- Updated screenshots: node_modules/.cache/balance-all-tabs/. Verification
  logs: .codex-tmp/balance-tabs-*.log. No online deployment or production writes.
