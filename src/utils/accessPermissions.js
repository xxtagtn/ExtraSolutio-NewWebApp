export const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard.view',
  CALENDAR_VIEW: 'calendar.view',

  CLIENTS_VIEW: 'clients.view',
  CLIENTS_CREATE: 'clients.create',
  CLIENTS_UPDATE: 'clients.update',
  CLIENTS_DELETE: 'clients.delete',
  CLIENTS_EXPORT: 'clients.export',
  CLIENTS_VIEW_SENSITIVE: 'clients.viewSensitive',

  COLLABORATORS_VIEW: 'collaborators.view',
  COLLABORATORS_CREATE: 'collaborators.create',
  COLLABORATORS_UPDATE: 'collaborators.update',
  COLLABORATORS_DELETE: 'collaborators.delete',
  COLLABORATORS_EXPORT: 'collaborators.export',
  COLLABORATORS_VIEW_SENSITIVE: 'collaborators.viewSensitive',
  COLLABORATORS_VIEW_PAY: 'collaborators.viewPay',

  BUDGETS_VIEW: 'budgets.view',
  BUDGETS_CREATE: 'budgets.create',
  BUDGETS_UPDATE: 'budgets.update',
  BUDGETS_DELETE: 'budgets.delete',
  BUDGETS_EXPORT: 'budgets.export',

  SERVICES_VIEW: 'services.view',
  SERVICES_CREATE: 'services.create',
  SERVICES_UPDATE: 'services.update',
  SERVICES_DELETE: 'services.delete',
  SERVICES_EXPORT: 'services.export',
  SERVICES_ASSIGN_STAFF: 'services.assignStaff',
  SERVICES_CHANGE_STATUS: 'services.changeStatus',

  TIME_VALIDATION_VIEW: 'timeValidation.view',
  TIME_VALIDATION_UPDATE: 'timeValidation.update',
  TIME_VALIDATION_VALIDATE: 'timeValidation.validate',
  TIME_VALIDATION_IMPORT: 'timeValidation.import',
  TIME_VALIDATION_EXPORT: 'timeValidation.export',

  FINANCE_VIEW: 'finance.view',
  FINANCE_VIEW_VALUES: 'finance.viewValues',
  FINANCE_APPROVE_PAYMENTS: 'finance.approvePayments',
  FINANCE_UPDATE_PAYMENTS: 'finance.updatePayments',
  FINANCE_EXPORT: 'finance.export',
  FINANCE_ISSUE_INVOICES: 'finance.issueInvoices',

  COMMUNICATION_VIEW: 'communication.view',
  COMMUNICATION_SEND: 'communication.send',
  COMMUNICATION_MANAGE_TEMPLATES: 'communication.manageTemplates',
  COMMUNICATION_MANAGE_QR_CODES: 'communication.manageQrCodes',

  BALANCETE_VIEW: 'balancete.view',
  BALANCETE_EXPORT: 'balancete.export',

  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',

  SETTINGS_VIEW: 'settings.view',
  SETTINGS_UPDATE: 'settings.update',
  BACKUPS_MANAGE: 'backups.manage',

  ADMIN_VIEW: 'admin.view',
  ADMIN_MANAGE_USERS: 'admin.manageUsers',
  ADMIN_MANAGE_PERMISSIONS: 'admin.managePermissions',
  ADMIN_VIEW_AUDIT: 'admin.viewAudit',
};

export const permissionCatalog = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    permissions: [
      { key: PERMISSIONS.DASHBOARD_VIEW, label: 'Visualizar' },
    ],
  },
  {
    key: 'calendar',
    label: 'Calendário',
    permissions: [
      { key: PERMISSIONS.CALENDAR_VIEW, label: 'Visualizar' },
    ],
  },
  {
    key: 'clients',
    label: 'Clientes',
    permissions: [
      { key: PERMISSIONS.CLIENTS_VIEW, label: 'Visualizar' },
      { key: PERMISSIONS.CLIENTS_CREATE, label: 'Criar' },
      { key: PERMISSIONS.CLIENTS_UPDATE, label: 'Editar' },
      { key: PERMISSIONS.CLIENTS_DELETE, label: 'Eliminar' },
      { key: PERMISSIONS.CLIENTS_EXPORT, label: 'Exportar' },
      { key: PERMISSIONS.CLIENTS_VIEW_SENSITIVE, label: 'Ver NIF e dados sensíveis' },
    ],
  },
  {
    key: 'collaborators',
    label: 'Colaboradores',
    permissions: [
      { key: PERMISSIONS.COLLABORATORS_VIEW, label: 'Visualizar' },
      { key: PERMISSIONS.COLLABORATORS_CREATE, label: 'Criar' },
      { key: PERMISSIONS.COLLABORATORS_UPDATE, label: 'Editar' },
      { key: PERMISSIONS.COLLABORATORS_DELETE, label: 'Eliminar' },
      { key: PERMISSIONS.COLLABORATORS_EXPORT, label: 'Exportar' },
      { key: PERMISSIONS.COLLABORATORS_VIEW_SENSITIVE, label: 'Ver NIF, IBAN e documentos' },
      { key: PERMISSIONS.COLLABORATORS_VIEW_PAY, label: 'Ver valores/hora' },
    ],
  },
  {
    key: 'budgets',
    label: 'Orçamentos',
    permissions: [
      { key: PERMISSIONS.BUDGETS_VIEW, label: 'Visualizar' },
      { key: PERMISSIONS.BUDGETS_CREATE, label: 'Criar' },
      { key: PERMISSIONS.BUDGETS_UPDATE, label: 'Editar' },
      { key: PERMISSIONS.BUDGETS_DELETE, label: 'Eliminar' },
      { key: PERMISSIONS.BUDGETS_EXPORT, label: 'Exportar' },
    ],
  },
  {
    key: 'services',
    label: 'Eventos/Serviços',
    permissions: [
      { key: PERMISSIONS.SERVICES_VIEW, label: 'Visualizar' },
      { key: PERMISSIONS.SERVICES_CREATE, label: 'Criar' },
      { key: PERMISSIONS.SERVICES_UPDATE, label: 'Editar dados' },
      { key: PERMISSIONS.SERVICES_ASSIGN_STAFF, label: 'Gerir colaboradores' },
      { key: PERMISSIONS.SERVICES_CHANGE_STATUS, label: 'Alterar estados' },
      { key: PERMISSIONS.SERVICES_DELETE, label: 'Eliminar' },
      { key: PERMISSIONS.SERVICES_EXPORT, label: 'Exportar' },
    ],
  },
  {
    key: 'timeValidation',
    label: 'Validação de Horas',
    permissions: [
      { key: PERMISSIONS.TIME_VALIDATION_VIEW, label: 'Visualizar' },
      { key: PERMISSIONS.TIME_VALIDATION_UPDATE, label: 'Editar horários' },
      { key: PERMISSIONS.TIME_VALIDATION_VALIDATE, label: 'Validar eventos' },
      { key: PERMISSIONS.TIME_VALIDATION_IMPORT, label: 'Importar Excel' },
      { key: PERMISSIONS.TIME_VALIDATION_EXPORT, label: 'Exportar PDF/Excel' },
    ],
  },
  {
    key: 'finance',
    label: 'Financeiro',
    permissions: [
      { key: PERMISSIONS.FINANCE_VIEW, label: 'Visualizar' },
      { key: PERMISSIONS.FINANCE_VIEW_VALUES, label: 'Ver valores financeiros' },
      { key: PERMISSIONS.FINANCE_UPDATE_PAYMENTS, label: 'Alterar pagamentos' },
      { key: PERMISSIONS.FINANCE_APPROVE_PAYMENTS, label: 'Aprovar pagamentos' },
      { key: PERMISSIONS.FINANCE_ISSUE_INVOICES, label: 'Emitir/anular faturas' },
      { key: PERMISSIONS.FINANCE_EXPORT, label: 'Exportar' },
    ],
  },
  {
    key: 'communication',
    label: 'Comunicação',
    permissions: [
      { key: PERMISSIONS.COMMUNICATION_VIEW, label: 'Visualizar' },
      { key: PERMISSIONS.COMMUNICATION_SEND, label: 'Enviar mensagens' },
      { key: PERMISSIONS.COMMUNICATION_MANAGE_TEMPLATES, label: 'Gerir modelos' },
      { key: PERMISSIONS.COMMUNICATION_MANAGE_QR_CODES, label: 'Gerir QR Codes' },
    ],
  },
  {
    key: 'balancete',
    label: 'Balancete',
    permissions: [
      { key: PERMISSIONS.BALANCETE_VIEW, label: 'Visualizar' },
      { key: PERMISSIONS.BALANCETE_EXPORT, label: 'Exportar' },
    ],
  },
  {
    key: 'reports',
    label: 'Relatórios',
    permissions: [
      { key: PERMISSIONS.REPORTS_VIEW, label: 'Visualizar' },
      { key: PERMISSIONS.REPORTS_EXPORT, label: 'Exportar' },
    ],
  },
  {
    key: 'settings',
    label: 'Configurações',
    permissions: [
      { key: PERMISSIONS.SETTINGS_VIEW, label: 'Visualizar' },
      { key: PERMISSIONS.SETTINGS_UPDATE, label: 'Alterar configurações' },
      { key: PERMISSIONS.BACKUPS_MANAGE, label: 'Gerir backups' },
    ],
  },
  {
    key: 'admin',
    label: 'Administração',
    permissions: [
      { key: PERMISSIONS.ADMIN_VIEW, label: 'Aceder' },
      { key: PERMISSIONS.ADMIN_MANAGE_USERS, label: 'Gerir utilizadores' },
      { key: PERMISSIONS.ADMIN_MANAGE_PERMISSIONS, label: 'Gerir permissões' },
      { key: PERMISSIONS.ADMIN_VIEW_AUDIT, label: 'Ver auditoria' },
    ],
  },
];

export const allPermissionKeys = permissionCatalog.flatMap((group) => group.permissions.map((permission) => permission.key));
const validPermissionSet = new Set(allPermissionKeys);

const baseReadPermissions = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.CALENDAR_VIEW,
  PERMISSIONS.CLIENTS_VIEW,
  PERMISSIONS.COLLABORATORS_VIEW,
  PERMISSIONS.BUDGETS_VIEW,
  PERMISSIONS.SERVICES_VIEW,
  PERMISSIONS.TIME_VALIDATION_VIEW,
];

const operationsPermissions = [
  ...baseReadPermissions,
  PERMISSIONS.SERVICES_CREATE,
  PERMISSIONS.SERVICES_UPDATE,
  PERMISSIONS.SERVICES_ASSIGN_STAFF,
  PERMISSIONS.SERVICES_CHANGE_STATUS,
  PERMISSIONS.SERVICES_EXPORT,
  PERMISSIONS.TIME_VALIDATION_UPDATE,
  PERMISSIONS.TIME_VALIDATION_VALIDATE,
  PERMISSIONS.TIME_VALIDATION_IMPORT,
  PERMISSIONS.TIME_VALIDATION_EXPORT,
  PERMISSIONS.COMMUNICATION_VIEW,
  PERMISSIONS.COMMUNICATION_SEND,
  PERMISSIONS.COMMUNICATION_MANAGE_QR_CODES,
];

const financePermissions = [
  ...baseReadPermissions,
  PERMISSIONS.CLIENTS_CREATE,
  PERMISSIONS.CLIENTS_UPDATE,
  PERMISSIONS.CLIENTS_EXPORT,
  PERMISSIONS.CLIENTS_VIEW_SENSITIVE,
  PERMISSIONS.COLLABORATORS_VIEW_SENSITIVE,
  PERMISSIONS.COLLABORATORS_VIEW_PAY,
  PERMISSIONS.SERVICES_EXPORT,
  PERMISSIONS.TIME_VALIDATION_EXPORT,
  PERMISSIONS.FINANCE_VIEW,
  PERMISSIONS.FINANCE_VIEW_VALUES,
  PERMISSIONS.FINANCE_UPDATE_PAYMENTS,
  PERMISSIONS.FINANCE_APPROVE_PAYMENTS,
  PERMISSIONS.FINANCE_ISSUE_INVOICES,
  PERMISSIONS.FINANCE_EXPORT,
  PERMISSIONS.BALANCETE_VIEW,
  PERMISSIONS.BALANCETE_EXPORT,
  PERMISSIONS.REPORTS_VIEW,
  PERMISSIONS.REPORTS_EXPORT,
];

const commercialPermissions = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.CALENDAR_VIEW,
  PERMISSIONS.CLIENTS_VIEW,
  PERMISSIONS.CLIENTS_CREATE,
  PERMISSIONS.CLIENTS_UPDATE,
  PERMISSIONS.BUDGETS_VIEW,
  PERMISSIONS.BUDGETS_CREATE,
  PERMISSIONS.BUDGETS_UPDATE,
  PERMISSIONS.BUDGETS_DELETE,
  PERMISSIONS.BUDGETS_EXPORT,
  PERMISSIONS.SERVICES_VIEW,
  PERMISSIONS.SERVICES_CREATE,
  PERMISSIONS.COMMUNICATION_VIEW,
  PERMISSIONS.COMMUNICATION_SEND,
  PERMISSIONS.COMMUNICATION_MANAGE_QR_CODES,
];

export const accessProfileTemplates = [
  {
    key: 'admin',
    name: 'Administrador',
    description: 'Acesso total à aplicação, permissões, utilizadores e configurações.',
    role: 'admin',
    permissions: allPermissionKeys,
  },
  {
    key: 'management',
    name: 'Gestão',
    description: 'Acesso operacional e financeiro completo, sem gestão técnica de permissões.',
    role: 'management',
    permissions: allPermissionKeys.filter((permission) => !permission.startsWith('admin.') && permission !== PERMISSIONS.BACKUPS_MANAGE),
  },
  {
    key: 'finance',
    name: 'Financeiro',
    description: 'Consulta e processamento financeiro, faturação, pagamentos e balancete.',
    role: 'finance',
    permissions: financePermissions,
  },
  {
    key: 'operations',
    name: 'Operacional',
    description: 'Gestão de eventos, equipas, validação de horas e comunicação operacional.',
    role: 'operations',
    permissions: operationsPermissions,
  },
  {
    key: 'coordinator',
    name: 'Coordenador',
    description: 'Coordenação de equipas e acompanhamento de eventos sem acesso financeiro.',
    role: 'operations',
    permissions: operationsPermissions.filter((permission) => permission !== PERMISSIONS.SERVICES_DELETE),
  },
  {
    key: 'human_resources',
    name: 'Recursos Humanos',
    description: 'Gestão de colaboradores, documentos, dados sensíveis e disponibilidade.',
    role: 'management',
    permissions: [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.CALENDAR_VIEW,
      PERMISSIONS.COLLABORATORS_VIEW,
      PERMISSIONS.COLLABORATORS_CREATE,
      PERMISSIONS.COLLABORATORS_UPDATE,
      PERMISSIONS.COLLABORATORS_EXPORT,
      PERMISSIONS.COLLABORATORS_VIEW_SENSITIVE,
      PERMISSIONS.COLLABORATORS_VIEW_PAY,
      PERMISSIONS.SERVICES_VIEW,
      PERMISSIONS.TIME_VALIDATION_VIEW,
    ],
  },
  {
    key: 'commercial',
    name: 'Comercial',
    description: 'Clientes, orçamentos, propostas e comunicação comercial.',
    role: 'management',
    permissions: commercialPermissions,
  },
  {
    key: 'supervisor',
    name: 'Supervisor',
    description: 'Consulta operacional e validação básica, sem gestão financeira.',
    role: 'operations',
    permissions: [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.CALENDAR_VIEW,
      PERMISSIONS.CLIENTS_VIEW,
      PERMISSIONS.COLLABORATORS_VIEW,
      PERMISSIONS.SERVICES_VIEW,
      PERMISSIONS.SERVICES_ASSIGN_STAFF,
      PERMISSIONS.TIME_VALIDATION_VIEW,
      PERMISSIONS.TIME_VALIDATION_UPDATE,
    ],
  },
  {
    key: 'read_only',
    name: 'Consulta',
    description: 'Acesso apenas de leitura aos módulos principais.',
    role: 'operations',
    permissions: baseReadPermissions,
  },
];

const roleProfileKey = {
  admin: 'admin',
  management: 'management',
  manager: 'management',
  finance: 'finance',
  financial: 'finance',
  operations: 'operations',
  operational: 'operations',
  commercial: 'commercial',
};

function uniqueValid(values) {
  const output = [];
  const seen = new Set();
  for (const value of values || []) {
    const key = String(value || '').trim();
    if (!validPermissionSet.has(key) || seen.has(key)) continue;
    seen.add(key);
    output.push(key);
  }
  return output;
}

export function normalizePermissionList(value) {
  if (Array.isArray(value)) return uniqueValid(value);
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return normalizePermissionList(parsed);
    } catch {
      return uniqueValid(value.split(','));
    }
  }
  return [];
}

export function parsePermissionOverrides(value) {
  if (!value) return { allow: [], deny: [] };
  if (typeof value === 'string') {
    try {
      return parsePermissionOverrides(JSON.parse(value));
    } catch {
      return { allow: [], deny: [] };
    }
  }
  if (typeof value !== 'object') return { allow: [], deny: [] };
  return {
    allow: normalizePermissionList(value.allow),
    deny: normalizePermissionList(value.deny),
  };
}

export function serializePermissionOverrides(value) {
  const overrides = parsePermissionOverrides(value);
  if (!overrides.allow.length && !overrides.deny.length) return null;
  return JSON.stringify(overrides);
}

export function permissionsForRole(role) {
  const key = roleProfileKey[String(role || '').trim().toLowerCase()] || 'read_only';
  const profile = accessProfileTemplates.find((item) => item.key === key) || accessProfileTemplates.at(-1);
  return normalizePermissionList(profile.permissions);
}

export function effectivePermissionsForUser(user) {
  if (!user) return [];
  const role = String(user.role || '').trim().toLowerCase();
  if (role === 'admin') return [...allPermissionKeys];
  if (Array.isArray(user.permissions)) return normalizePermissionList(user.permissions);

  const basePermissions = user.accessProfile?.permissions
    ? normalizePermissionList(user.accessProfile.permissions)
    : permissionsForRole(role);
  const overrides = parsePermissionOverrides(user.permissionOverrides);
  const merged = new Set(basePermissions);
  for (const permission of overrides.allow) merged.add(permission);
  for (const permission of overrides.deny) merged.delete(permission);
  return [...merged].filter((permission) => validPermissionSet.has(permission));
}

export function hasPermission(user, permission) {
  if (!permission) return true;
  return effectivePermissionsForUser(user).includes(permission);
}

export function hasAnyPermission(user, permissions = []) {
  return permissions.some((permission) => hasPermission(user, permission));
}
