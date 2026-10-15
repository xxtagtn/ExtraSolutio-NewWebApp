# Advance payments, operational assessment and issued invoices

## Cause and boundaries

1. The existing remaining-payment action selects `paid` because the known total is covered.
2. `eventRevenueIsLocked` incorrectly treated payment status `paid` as invoice closure, blocking Staff/Client clock corrections and imports.
3. Recalculation and some financial views also inferred the current revenue as received merely from that status.
4. Switching back to a signal could drop the already received remaining parcel from the draft preview.

Payment status now describes receipts, not permission to edit operational hours. Issued direct/grouped invoices and explicit legacy invoice closure remain protected. The existing Staff workflow, billing formulas, rates, VAT, rounding, QR codes and attendance rules were not changed.

## Implementation

- Removes payment-only `paid` flags from invoice protection. Operational assessment still follows the existing validation workflow.
- Retains received amounts while recalculating actual Client billable hours and totals.
- Shows the current known/final total, actual receipts, outstanding balance and any overpayment without refunding or changing existing payments automatically.
- Adds an authenticated, finance-permission-protected additional-receipt action with validation, optimistic concurrency and transactional rollback.
- Keeps the initial signal, remaining planned payment and subsequent adjustments as separate entries.
- Keeps prepayments active in Finance until operationally assessed; a new outstanding balance is not archived as paid.
- Refreshes the global remaining-payment reminder after payment changes and excludes already covered balances.
- Preserves external invoice-paid projections without treating a standalone prepayment as a newly increased receipt.

### Optional persistence field

`Event.clientPaymentRecord` is nullable JSON stored as TEXT/LongText. Existing payment columns remain the source for cumulative received amounts. The record adds a frozen reference total, individual receipt/correction entries and proof of legacy invoice closure where no invoice row exists. It is server-managed and masked with the existing financial permissions.

This field is necessary because the previous schema only stored signal and cumulative received values; it could not distinguish the remaining parcel from later adjustments. Existing inferred legacy settlements are materialized against the old total before that total changes. Unknown payment dates stay null. Old separate movements that were never stored cannot be reconstructed beyond the available signal and cumulative amounts.

Migrations: `20261015020000_client_payment_record` for SQLite and MySQL. Applied only to the local SQLite database after a consistent backup at `node_modules/.cache/client-payment-record-migration/before-1792066661057.db`. No bulk recalculation or production writes were performed.

## Verification

- Node suite: 1,069 passed, zero failures, including the 20 requested advance-payment scenarios.
- Read-only comparison with the pre-migration backup: all payment columns of the 32 real local events are unchanged.
- HTTP tests use temporary SQLite databases and real API routes.
- Tested partial/full/week-early receipt, unchanged/more/fewer Staff hours, Client corrections, bulk copy, Excel import, revalidation, VAT, partners, excess, additional receipt, permissions, invalid input, duplicate submission, concurrency and rollback.
- Explicit example: 690.52 + 295.94 stays 986.46 after the total grows to 1016.46; the additional receipt appends 30.00 rather than replacing either prior parcel.
- Balance examples: 1050.00 - 986.46 = 63.54 outstanding; 950.00 against 986.46 received shows 36.46 excess.
- Chrome tests at 320/390/768/1440px cover remaining payment, Staff validation, additional balance, cancel/double click, history, excess and responsive layout.
- Existing cost summary, Staff VAT, external deletion, client-payment and explicit reversal browser regressions passed.
- Lint, production build, PWA checks and MySQL schema validation performed locally.

## Deployment And Limits

- No online deployment was performed. MySQL migration execution and production behaviour were not tested against a live MySQL server.
- Apply the new migration and regenerate Prisma before restarting the updated API; update frontend and API together.
- Standard local `prisma generate` could not replace the in-use Windows engine DLL (EPERM). Updated client metadata works in the fresh test API processes, but complete generation should be repeated with the local API stopped. No unrelated process was terminated.
- Production build retains the existing large-chunk warning.
