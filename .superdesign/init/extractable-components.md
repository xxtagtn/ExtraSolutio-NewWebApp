# Extractable Components

## Layout Components

### AppLayout
- Source: `src/components/Layout/Layout.jsx`
- Category: layout
- Description: Shared application shell with sidebar, topbar, page outlet, reminders, and back-to-top control.
- Extractable props: none required for finance summary mockup.
- Hardcoded: navigation behavior and product labels.

### Sidebar
- Source: `src/components/Layout/Sidebar.jsx`
- Category: layout
- Description: Responsive product navigation with collapse and mobile-open states.
- Extractable props: `mobileOpen`, `collapsed`, `onClose`, `onToggleCollapsed`.
- Hardcoded: navigation labels, icon mapping, logo path.

## Basic Components

### Modal
- Source: `src/components/UI/Modal.jsx`
- Category: basic
- Description: Accessible modal with focus management, escape close, backdrop close, and optional wide/stable desktop sizing.
- Extractable props: `title`, `size`, `stableDesktop`, `onClose`.
- Hardcoded: close icon and modal class names.

### Badge
- Source: `src/components/UI/Badge.jsx`
- Category: basic
- Description: Compact status and count badge with semantic tone variants.
- Extractable props: `children`, `tone`.
- Hardcoded: badge class names.

### Card
- Source: `src/components/UI/Card.jsx`
- Category: basic
- Description: Shared bordered content section with optional title and action.
- Extractable props: `title`, `action`, `className`, `children`.
- Hardcoded: card structure and classes.
