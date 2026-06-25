# Collaborator Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stable client-side pagination to the Collaborators page with page sizes of 10, 20, and 50.

**Architecture:** Keep filtering and ordering in `Collaborators.jsx`, then paginate the resulting collection through a small pure utility. Render the page-size selector and navigation below the collaborator cards, resetting to page 1 whenever filters or page size change.

**Tech Stack:** React 18, JavaScript, Node test runner, CSS.

---

### Task 1: Pagination utility

**Files:**
- Create: `src/utils/pagination.js`
- Create: `src/utils/pagination.test.mjs`

- [ ] Write tests covering slicing, page bounds, totals, and empty collections.
- [ ] Run `node --test src/utils/pagination.test.mjs` and confirm failure because the utility does not exist.
- [ ] Implement `paginateItems(items, requestedPage, pageSize)`.
- [ ] Run the focused test and confirm it passes.

### Task 2: Collaborator page controls

**Files:**
- Modify: `src/pages/Collaborators.jsx`
- Modify: `src/index.css`

- [ ] Add page and page-size state with a default size of 10.
- [ ] Reset the page when filters or page size change and clamp it when records are removed.
- [ ] Render only the current page while preserving the existing filtered/favourite/alphabetical order.
- [ ] Add the result range, 10/20/50 selector, numbered pages, Previous, and Next controls.
- [ ] Add responsive styles so pagination wraps cleanly on mobile.

### Task 3: Verification

**Files:**
- Verify all files changed by Tasks 1 and 2.

- [ ] Run `node --test`.
- [ ] Run `npm.cmd run lint`.
- [ ] Run `npm.cmd run build`.
- [ ] Run the character scan on touched source files.
