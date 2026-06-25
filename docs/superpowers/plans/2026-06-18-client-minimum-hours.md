# Client Minimum Hours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a client-specific minimum number of billable hours to every collaborator day/shift while preserving real hours and finalized-event history.

**Architecture:** Store the current rule on the client and snapshot it on each event. Centralize real/billable hour calculation in `serviceFinance.js`, persist assignment and event totals during validation, and update open event snapshots when the client rule changes.

**Tech Stack:** React 18, Express 5, Prisma 6, SQLite, MySQL, Node test runner.

---

### Task 1: Financial calculation

**Files:**
- Modify: `src/utils/serviceFinance.js`
- Modify: `src/utils/serviceFinance.test.mjs`

- [ ] Add failing tests for real hours and per-assignment minimum hours.
- [ ] Implement `clientRealHours` and minimum-aware `clientChargeHours`.
- [ ] Run focused tests.

### Task 2: Database and API

**Files:**
- Modify: `prisma/sqlite/schema.prisma`
- Modify: `prisma/mysql/schema.prisma`
- Create: `prisma/sqlite/migrations/20260618090000_client_minimum_hours/migration.sql`
- Create: `prisma/mysql/migrations/20260618090000_client_minimum_hours/migration.sql`
- Modify: `server/routes/crud.js`
- Modify: `server/routes/index.js`
- Modify: `server/routes/crud.test.mjs`

- [ ] Add fields for client minimum, event snapshot/real total, and assignment real hours.
- [ ] Normalize the new decimal fields.
- [ ] Snapshot the client rule when creating/opening events.
- [ ] Propagate client changes only to non-finalized events.
- [ ] Run route tests and Prisma validation.

### Task 3: Client and event interfaces

**Files:**
- Modify: `src/pages/Clients.jsx`
- Modify: `src/pages/Services.jsx`
- Modify: `src/pages/TimeValidation.jsx`
- Modify: `src/pages/Accounting.jsx`

- [ ] Add the optional decimal field to client create/edit and details.
- [ ] Apply the event snapshot to forecast and actual revenue.
- [ ] Persist real and billable assignment/event totals during validation.
- [ ] Display real and billable event hours in the event financial summary.
- [ ] Ensure Finance uses billable hours for revenue and real/payable hours for staff costs.

### Task 4: Verification

- [ ] Deploy the SQLite migration and generate Prisma Client.
- [ ] Run the full test suite.
- [ ] Run lint.
- [ ] Run the production build.
- [ ] Scan touched files for invalid characters.
