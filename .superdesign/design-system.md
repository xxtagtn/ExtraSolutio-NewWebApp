# ExtraSolutio Design System

## Product
Portuguese (Portugal) operations and finance web app for event staffing. Users manage services, collaborators, attendance, hour validation, billing, and payments. The finance audience needs dense but legible operational facts and clear arithmetic.

## Visual Language
- Preserve the existing dark admin appearance, sidebar/topbar shell, teal primary accent, amber attention accent, and compact modal surfaces.
- Use Inter/system sans-serif typography, existing CSS variables, restrained borders, low elevation, and 6–8px corners.
- Use lucide icons for actions. Never invent a new logo or alter brand assets.
- Keep information scan-friendly: labels secondary, amounts tabular and right-aligned, totals visually distinct.
- Responsive behavior must avoid horizontal scrolling; on mobile, stack each day summary and its breakdown into readable rows.

## Finance Event Reconciliation Target
Show how the event total is composed without changing financial rules: existing billed hours by day and role, client rate, minimum-hours effect, client-billable travel, billable extras, tax, event adjustments, and final total. Keep event-level totals visibly reconciled to the line items. Do not present staff travel compensation as client-billable travel. If a value cannot be attributed to a day from source records, keep it in the event-level breakdown rather than inventing a daily allocation.

## Interaction
- A day is the primary expandable unit; details reveal each collaborator, role, schedule, billed hours, and applicable rate.
- Event-level cost components expand separately, with subtotals and a final total.
- Retain existing modal close/focus behavior and do not alter production code as part of a visual draft.

## Responsive and Accessibility
Use semantic headings, buttons/disclosures, visible keyboard focus, sufficient contrast, and stable mobile layouts. Keep money and time values readable without clipping.
