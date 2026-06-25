# Time Validation Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize Time Validation around the real operational stages so recent Staff hours can be entered quickly without mixing them with rows waiting for Client confirmation.

**Architecture:** Extract stage classification and date presets into a tested utility. Keep the existing assignment and event persistence, but filter the page into Staff pending, Client pending, differences, ready and finalized stages. Require complete Staff and Client time pairs before accepting a row.

**Tech Stack:** React, Node.js test runner, existing REST API and CSS design system.

---

### Task 1: Operational workflow rules

**Files:**
- Create: `src/utils/timeValidationWorkflow.js`
- Create: `src/utils/timeValidationWorkflow.test.mjs`
- Modify: `src/utils/hourValidationBulk.js`
- Modify: `src/utils/hourValidationBulk.test.mjs`

- [ ] Write failing tests for the five workflow stages, seven-day period and newest-first sorting.
- [ ] Write a failing test proving that bulk validation requires complete Staff and Client time pairs.
- [ ] Run the focused tests and confirm the failures represent missing behavior.
- [ ] Implement the stage, period, counting and sorting helpers.
- [ ] Restrict accepted validation values to the Client time pair.
- [ ] Run the focused tests and confirm they pass.

### Task 2: Time Validation page

**Files:**
- Modify: `src/pages/TimeValidation.jsx`

- [ ] Replace the broad Pending/Validated scope with stage tabs and counters.
- [ ] Default the period to the last seven days through today.
- [ ] Add Today, Yesterday, Last 7 Days and This Month period shortcuts.
- [ ] Filter rows by stage and order dates from newest to oldest.
- [ ] Group visible rows under date headers.
- [ ] Adapt visible table columns to the selected stage.
- [ ] Add draft shortcuts to copy Planned to Staff and Staff to Client.
- [ ] Keep event finalization manual and enabled only when every billable assignment is accepted.

### Task 3: Responsive presentation

**Files:**
- Modify: `src/index.css`

- [ ] Add compact stage tabs with counters and horizontal overflow on small screens.
- [ ] Style date group headers, quick period buttons and copy actions.
- [ ] Preserve the existing responsive table behavior.

### Task 4: Verification

**Files:**
- Verify all modified files.

- [ ] Run `node --test`.
- [ ] Run `npm.cmd run lint`.
- [ ] Run `npm.cmd run build`.
- [ ] Scan modified files for malformed Portuguese characters.
