import { PERMISSIONS, hasPermission } from './accessPermissions.js';
import { BALANCETE_PATH, DEFAULT_AUTHENTICATED_PATH } from './navigation.js';

export const sidebarNavigationItems = [
  { key: 'dashboard', to: DEFAULT_AUTHENTICATED_PATH, label: 'Dashboard', permission: PERMISSIONS.DASHBOARD_VIEW },
  { key: 'calendar', to: '/calendar', label: 'Calendário', permission: PERMISSIONS.CALENDAR_VIEW },
  { key: 'collaborators', to: '/collaborators', label: 'Colaboradores', permission: PERMISSIONS.COLLABORATORS_VIEW },
  { key: 'clients', to: '/clients', label: 'Clientes', permission: PERMISSIONS.CLIENTS_VIEW },
  { key: 'budgets', to: '/budgets', label: 'Orçamentos', permission: PERMISSIONS.BUDGETS_VIEW },
  { key: 'services', to: '/services', label: 'Eventos/Serviços', permission: PERMISSIONS.SERVICES_VIEW },
  { key: 'timeValidation', to: '/time-validation', label: 'Validação de Horas', permission: PERMISSIONS.TIME_VALIDATION_VIEW },
  { key: 'finance', to: '/finance', label: 'Financeiro', permission: PERMISSIONS.FINANCE_VIEW },
  { key: 'communication', to: '/communication', label: 'Comunicação', permission: PERMISSIONS.COMMUNICATION_VIEW },
  { key: 'balancete', to: BALANCETE_PATH, label: 'Balancete', permission: PERMISSIONS.BALANCETE_VIEW },
];

export const profileMenuItems = [
  { key: 'profile', to: '/profile', label: 'O meu perfil' },
  { key: 'admin', to: '/admin', label: 'Administração', permission: PERMISSIONS.ADMIN_VIEW },
];

export function visibleSidebarItems(user) {
  return sidebarNavigationItems.filter((item) => !item.permission || hasPermission(user, item.permission));
}

export function visibleProfileMenuItems(user) {
  return profileMenuItems.filter((item) => !item.permission || hasPermission(user, item.permission));
}
