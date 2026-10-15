# Events/services search validation

Date: 2026-10-15.

## Analysis and scope

The Events/Services page already loads /services once through useApi, then filters locally by active/archive scope, minimum date, client, operational status and archive month/year. Archive pagination is applied afterwards. This implementation extends that pipeline rather than introducing a second API or filtering system.

Searchable fields are the existing event name, id and serviceReference. Dates use event.date and, only for continuous events, event.endDate, matching the page's existing date-range convention. No database, server, event lifecycle, financial calculation or save/delete workflow changes were needed for this request. Earlier uncommitted work was retained.

## Changed files

- src/pages/Services.jsx: live search, accessible clear button, integration with existing filters before pagination, matching-result count, empty state and page reset on search changes.
- src/utils/serviceSearch.js: accent/case normalization, all-terms matching, calendar-date parsing/range matching and exact identifier prioritization.
- src/index.css: scoped search controls and one-row desktop filter bar. Existing container-query pattern is reused; medium/small containers use two/one columns without horizontal scrolling.
- src/utils/serviceSearch.test.mjs: 11 dedicated unit tests.
- tests/service-search.browser.mjs: isolated browser tests with intercepted API traffic.

## Search behavior

- Supports partial event names, case-insensitively and without accents.
- Supports d/m, dd/mm, dd/mm/yyyy and their hyphen equivalents; ISO yyyy-mm-dd is also supported.
- Dates without a year match the same calendar day in any year. Explicit years must match.
- Start, intermediate and final dates of continuous events match, including month/year crossings and leap days.
- All space-separated criteria must match the same event. Exact identifiers never override another term or an existing filter.
- Numeric text matches a whole numeric segment in the event name/reference or an exact event ID. It is not interpreted as a day, year, amount, guest count or partial ID.
- Exact IDs rank first, followed by exact internal references. Other matching events preserve their previous order. Empty search restores the unchanged filtered order.
- Search and clear keep existing filters selected. Archive search resets to page one, and page counts reflect the complete filtered result before slicing.
- Active/archive tab badges retain their existing overall counts; the matching-result count and archive pagination describe filtered results.
- No debounced requests, remote service, AI service or extra dependencies are introduced.

## Validation results

- Full Node suite: 966 passed, 0 failed, 0 skipped, including the 11 new unit tests.
- Browser search tests passed at 320, 390, 768, 1024, 1201, 1280, 1366, 1440 and 1920px.
- Verified names/case/accents, every requested date format, combined criteria, intermediate dates, exact ID/reference behavior, every operational-state filter, client/date filters, archive month/year, clear/focus behavior, no results, correct counts, all page-size options and search from a later archive page.
- Verified unchanged source records, no write requests, no extra read requests while typing/filtering, no loading flicker and stable DOM identity for rows that remain matched.
- Verified no uncaught/browser-console errors, no horizontal page/filter overflow, no clipped control bounds and no text overlap with the search/clear icons.
- Asserted that the search and all filters share one row on wide desktop views, for both active and archived events. Desktop/archive and mobile screenshots were visually inspected under node_modules/.cache/service-search.
- service-duplication.browser.mjs passed at desktop/mobile/compact widths, covering create/edit/duplicate/cancel/retry and unchanged source events.
- external-finance-archive.browser.mjs passed at 320/390/1440px, covering existing billing/archive transitions and future-paid protections.
- npm run lint, npm run build, npm run verify:pwa and git diff --check passed. The pre-existing XLSX bundle-size warning remains.

## Boundaries

- Search is local to events already returned by the existing authorized /services query. No live production dataset or server deployment was used for validation.
- It is literal token-based search, not fuzzy typo correction or natural-language date interpretation.
- Names mean event names. Client selection remains the existing client filter; notes, collaborator details and financial values are intentionally not added to the search index.
- The date range remains the existing declared continuous-event period; this feature does not change cancellation/date rules or event duration.
- On constrained layouts controls wrap rather than introducing horizontal scrolling. Wide desktop layouts show all controls in one line, as requested.
- Local frontend: http://localhost:5176/services. No online update was published.
