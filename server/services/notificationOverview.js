import { buildLayoutNotifications, layoutPaymentReminders } from '../../src/utils/layoutNotifications.js';
import { hasPermission, PERMISSIONS } from '../../src/utils/accessPermissions.js';
import { canViewFinancialData, canViewSensitiveCollaboratorData } from '../security/roles.js';
import { applicationWallClock } from '../utils/eventTime.js';

export async function readNotificationOverview(db, user, { now = applicationWallClock() } = {}) {
  const canFinance = canViewFinancialData(user);
  const [services, budgets, invoices, collaborators] = await Promise.all([
    hasPermission(user, PERMISSIONS.SERVICES_VIEW) ? db.event.findMany({
      select: {
        id: true, name: true, date: true, endDate: true, isContinuous: true, startTime: true,
        status: true, cancelledDays: true, requiredRoles: true, assignmentDrafts: true, notes: true,
        ...(canFinance ? { billingStatus: true, externalCosts: true, remainingPaymentDate: true } : {}),
        client: { select: { prepaymentRemainingDaysBefore: true } },
        assignments: { select: {
          id: true, collaboratorId: true, assignmentDate: true, status: true, role: true,
          validationStatus: true, clientCheckIn: true, clientCheckOut: true, validatedCheckIn: true, validatedCheckOut: true,
          ...(canFinance ? { paymentStatus: true, paymentDeferredMonth: true } : {}),
        } },
      },
    }) : [],
    hasPermission(user, PERMISSIONS.BUDGETS_VIEW) ? db.budget.findMany({
      select: { id: true, followUpHistory: true },
    }) : [],
    hasPermission(user, PERMISSIONS.FINANCE_VIEW) ? db.invoice.findMany({
      select: { id: true, number: true, status: true, issueDate: true, client: { select: { paymentTerm: true, paymentTermDays: true } } },
    }) : [],
    hasPermission(user, PERMISSIONS.COLLABORATORS_VIEW) && canViewSensitiveCollaboratorData(user) ? db.collaborator.findMany({
      select: { id: true, name: true, shortName: true, birthDate: true, documentType: true, documentExpiry: true },
    }) : [],
  ]);
  // Reuse exactly the browser's notification rules with the same serialized dates.
  const inputs = JSON.parse(JSON.stringify({ services, budgets, invoices, collaborators }));
  return {
    notifications: buildLayoutNotifications({ ...inputs, now }),
    reminders: layoutPaymentReminders(inputs.services, now).map(({ id, name }) => ({ id, name })),
  };
}
