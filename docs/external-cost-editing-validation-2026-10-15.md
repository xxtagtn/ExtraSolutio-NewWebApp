# Event external-cost editing validation

Date: 2026-10-15. Scope: Events -> event detail -> Costs -> external costs/partners.

## Existing implementation and cause

- External costs already live in the Event.externalCosts JSON field. No migration is needed.
- Existing fields are id, type, supplier, description, costAmount, marginPercent, vatType and status, plus normalized financial breakdown fields.
- There are no quantity or unit-price fields in the current model. None were invented.
- Event creation/editing and budgets already share ExternalCostsEditor. The event-detail Costs card was read-only; it did not expose a per-cost save action.
- Existing source-of-truth calculations remain src/utils/externalCosts.js and server/utils/eventTotals.js. These files were not changed for this feature.
- The existing percentage is markup on partner cost, not margin divided by sale price. Net sale = cost + cost * percentage / 100.
- Existing tax options remain exempt, standard 23%, and Catering (85% of sale base at 13%, 15% at 23%). Staff/travel retain their existing separate tax handling.

## Changed files

- src/pages/ServiceDetail.jsx: per-row Edit action, Add external cost/partner action, reusable editor in a modal, local validation, save/error feedback and reload of event data.
- src/components/Finance/ExternalCostsEditor.jsx: optional add/remove controls and gross-total display; defaults preserve existing event/budget workflows. Existing zero values and legacy custom types stay visible.
- src/index.css: scoped external-cost rows, responsive financial breakdown and editor spacing; modal stays above fixed mobile controls.
- src/utils/externalCostEditing.js: strict stored-list validation, stable legacy IDs, draft validation, identity-preserving row updates and safe same-ID add retries.
- server/services/externalCostEditing.js: transactional per-event add/edit service, version checks, invoice protection, existing totals engine and existing workflow synchronization.
- server/routes/index.js: authenticated POST /services/:id/external-costs and PUT /services/:id/external-costs/:costId using the existing services.update permission and role-based response serialization.
- src/utils/externalCostEditing.test.mjs, server/services/externalCostEditing.test.mjs and tests/external-cost-editing.browser.mjs: dedicated tests.

Other dirty files in the workspace belong to earlier tasks and were not reverted.

## Data and calculation integrity

- Only the selected external-cost row is edited. Stable ID, partner settlement status and extra legacy metadata are retained. Other rows are preserved.
- A new row receives a stable ID before saving. Repeating an identical add with that ID is a no-op, including a retry after a lost response. A conflicting reuse of an ID is rejected.
- Malformed stored JSON, invalid rows and duplicate stored IDs are rejected rather than silently replaced.
- External costs and dependent event totals are saved in one serializable transaction using conditional updatedAt matching. Stale edits return 409; failed writes roll back both JSON and totals.
- Normalization recomputes financial breakdowns; computed fields supplied by a caller are not trusted.
- Non-finite results and totals outside the production DECIMAL(12,2) range are rejected.
- Existing invoice guards still block changes to invoiced/paid events and issued direct/grouped invoices. No invoices are rewritten or newly issued by this feature.
- The existing totals engine protects financial snapshots when Staff prices are incomplete. Changes that would leave changed external costs beside an unchanged protected snapshot are rejected, with a prompt to correct prices first. No alternative pricing formula is introduced.
- Assignments, Staff hours/rates/payments/advances, customer receipt amounts/dates, budgets and database schema are not written by this feature.
- Existing workflow synchronization is reused; no new operational status or fictitious Staff is created.

Examples verified using the existing engine:

| Scenario | Partner cost | Markup | Net sale | Tax | Gross sale |
| --- | ---: | ---: | ---: | ---: | ---: |
| Existing standard cost | 500.00 | 20% | 600.00 | 138.00 | 738.00 |
| Edit cost and markup | 600.00 | 25% | 750.00 | 172.50 | 922.50 |
| Add independent standard cost | 150.00 | 20% | 180.00 | 41.40 | 221.40 |
| Catering allocation | 500.00 | 20% | 600.00 | 87.00 | 687.00 |
| Exempt allocation | 500.00 | 20% | 600.00 | 0.00 | 600.00 |

The original 500 + added 150 scenario produces partner cost 650.00, tax 179.40 and gross sale 959.40, without counting either row twice.

## Tests and results

- Full Node suite: 955 passed, 0 failed, 0 skipped. Includes 5 dedicated pure tests and 10 dedicated API/transaction tests.
- API tests use real Express routes and Prisma against a temporary SQLite database created from the current schema. They verify edited cost/markup/tax, first/second/multiple partners, single-day/continuous events, exclusively external and mixed Staff events, budget conversion, database read-back, stable unrelated fields, authentication/permissions, direct/grouped invoice guards, stale requests, safe retry, rollback, missing Staff prices and storage limits.
- external-cost-editing.browser.mjs passed at 320, 390, 768 and 1440px: edit/reopen, add/reopen, three partners, all supported tax modes, preview/stored totals, invalid forms, double-submit, server errors, stale saves, retained drafts, unchanged receipts, no page/panel/control horizontal clipping and no uncaught browser errors.
- Browser regressions passed: client-payment (320/390/768/1440), client-signal-reversal (320/390/768/1440), client-payment-reference (320/390/768/1440), external-finance-archive (320/390/1440), service-duplication (1440/390/320).
- Screenshots inspected: mobile editor and desktop partner list. Captures are under node_modules/.cache/external-cost-editing.
- npm run lint: passed.
- npm run build: passed. Existing XLSX bundle-size warning remains; no unrelated bundling refactor was made.
- npm run verify:pwa: passed.
- git diff --check: passed; Git only reports existing Windows line-ending normalization notices.

## Validation boundaries

- No online deployment or production-data edits were made. Browser API traffic was fully intercepted; backend tests used a disposable database.
- Live production MySQL behavior and real issued accounting documents were not exercised. Tests cover the application guards and enforce the production decimal storage limit, but do not replace a staging MySQL check.
- Invoiced/paid event editing remains intentionally blocked by existing fiscal rules. Financial adjustments must follow the existing Finance path.
- Incomplete Staff prices must be corrected before changing external amounts when the existing engine would preserve incompatible historical totals.
- The frontend used for browser checks is available locally on port 5176. The production API, WhatsApp jobs and push jobs were not started for these tests.
