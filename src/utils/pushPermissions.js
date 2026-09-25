import { hasPermission, PERMISSIONS } from './accessPermissions.js';

export function canReceiveAttendancePush(user) {
  return hasPermission(user, PERMISSIONS.SERVICES_VIEW)
    && hasPermission(user, PERMISSIONS.COMMUNICATION_MANAGE_QR_CODES);
}

export function pushReturnPath(value) {
  return typeof value === 'string' && /^\/services\/[1-9]\d*\?tab=team&day=\d{4}-\d{2}-\d{2}&push=1$/.test(value)
    ? value : null;
}
