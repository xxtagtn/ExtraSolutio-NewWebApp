# Personal Event Ordering

Events/Services supports date-descending and personal manual ordering. Each
authenticated account with Services read access owns its active and archive
preferences independently. Changing the mode to date retains the saved manual
order. New events precede known events in manual mode; deleted IDs are ignored.

The 14px grip is the only drag activator, with a larger touch target. Mouse,
delayed touch, keyboard and a small move menu are supported. The event body
remains a separate open button. Cancelled and unchanged drags do not save.
Reordering a filtered list or archive page replaces only those visible slots
in the full order, preserving all hidden events.

Preferences use `GET /auth/service-order` and `PUT /auth/service-order/:scope`.
The owner always comes from the authenticated session. Version checks prevent
stale tabs/devices from silently overwriting a newer order. Failed writes show
an error, restore the last confirmed state and reconcile against the server.
Focus refresh synchronizes other devices without page reloads or service writes.

## Database and Deployment

Migration `20261030010000_user_service_order` adds only `UserServiceOrder`.
It has a `(userId, scope)` primary key, mode, ordered IDs, revision and update
timestamp. It does not update events, assignments, invoices, receipts or themes.
The user relation cascades deletion of preferences only.

Deploy with the normal backup and update procedure, including:

```sh
npm ci
npm run db:generate:mysql
npm run db:deploy:mysql
npm run build
```

Restart the API through the existing service manager. An unavailable preferences
endpoint leaves the event list usable but disables personal-order changes and
shows a retry action; it never claims a local-only order is saved to the account.

## Verification

```sh
node --test src/utils/serviceOrder.test.mjs server/services/userServiceOrder.test.mjs
node tests/service-order.browser.mjs
node tests/service-search.browser.mjs
```

Browser tests accept `PLAYWRIGHT_MODULE` and `TEST_BASE_URL`. All requests are
simulated; no real attendance, event or financial changes are made.
