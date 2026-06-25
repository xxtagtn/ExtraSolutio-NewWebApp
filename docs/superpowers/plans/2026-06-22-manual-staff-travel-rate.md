# Manual Staff Travel Rate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed EUR 10 hourly staff travel rate in Events/Services kilometer calculations with a manually entered rate.

**Architecture:** Keep the shared travel calculator backward-compatible for Budgets while Events explicitly provide a persisted `travelStaffHourlyRate`. The existing `travelExpenseAmount` remains the calculated total consumed by Finance, so no Finance layout or data-flow changes are needed.

**Tech Stack:** React, Node.js, Prisma, SQLite, MySQL, Node test runner.

---

### Task 1: Travel calculation

**Files:**
- Modify: `src/utils/travelCalculator.js`
- Test: `src/utils/travelCalculator.test.mjs`

- [ ] Add failing tests proving that kilometer travel uses `durationHours * travelPeople * travelStaffHourlyRate`, including the existing 50/50 rule.
- [ ] Run `node --test src/utils/travelCalculator.test.mjs` and confirm the new assertions fail because the calculator still uses EUR 10.
- [ ] Replace the fixed rate in the kilometer branch with the supplied rate while preserving the legacy default for callers that do not provide the new property.
- [ ] Run the focused test and confirm all travel calculator tests pass.

### Task 2: Event persistence

**Files:**
- Modify: `prisma/sqlite/schema.prisma`
- Modify: `prisma/mysql/schema.prisma`
- Create: `prisma/sqlite/migrations/20260622090000_event_staff_travel_hourly_rate/migration.sql`
- Create: `prisma/mysql/migrations/20260622090000_event_staff_travel_hourly_rate/migration.sql`
- Create: `prisma/sqlite/migrations/20260622091000_backfill_event_staff_travel_hourly_rate/migration.sql`
- Create: `prisma/mysql/migrations/20260622091000_backfill_event_staff_travel_hourly_rate/migration.sql`
- Modify: `server/routes/crud.js`
- Test: `server/routes/crud.test.mjs`

- [ ] Add a failing normalization test for a decimal `travelStaffHourlyRate`.
- [ ] Run `node --test server/routes/crud.test.mjs` and confirm the field is missing.
- [ ] Add the decimal event field to both Prisma schemas and equivalent migrations.
- [ ] Infer and backfill the effective rate already used by existing kilometer events so their totals do not change.
- [ ] Parse and persist the field in `normalizeEvent`.
- [ ] Run the focused route tests.

### Task 3: Events/Services form

**Files:**
- Modify: `src/pages/Services.jsx`

- [ ] Add `travelStaffHourlyRate` to the empty form, event edit mapping, templates, template application and save payload.
- [ ] Show “Valor Deslocação Staff (€/h)” only when “Quilómetros” is selected.
- [ ] Keep the existing kilometer, duration, people and 50/50 controls.
- [ ] Continue saving the calculated result to `travelExpenseAmount`, preserving all current Finance calculations.

### Task 4: Verification

**Files:**
- Verify all modified files.

- [ ] Apply/generate the SQLite schema against the development database.
- [ ] Run `node --test`.
- [ ] Run `npm.cmd run lint`.
- [ ] Run `npm.cmd run build`.
- [ ] Scan modified files for malformed Portuguese characters.
