const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== '';

const toNumber = (value, fallback = null) => {
  if (!hasValue(value)) return fallback;
  const normalized = String(value).replace(/\s/g, '').replace('€', '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : fallback;
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();

export function parseClientRoleRates(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') {
    return Object.entries(value).map(([role, rate]) => ({ role, rate }));
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed).map(([role, rate]) => ({ role, rate }));
    }
  } catch {
    return [];
  }
  return [];
}

export function clientRuleRate(client, role) {
  const wanted = normalizeText(role);
  if (!wanted) return null;
  const match = parseClientRoleRates(client?.roleRates).find((item) => normalizeText(item.role) === wanted);
  return toNumber(match?.rate, null);
}

export function clientDefaultContact(client) {
  return {
    onsiteContactName:
      client?.representativeName ||
      client?.contactPerson ||
      '',
    onsiteContactPhone: client?.phone || '',
  };
}

export function clientPrepaymentRule(client) {
  return {
    enabled: client?.billingMethod === 'prepaid',
    percent: toNumber(client?.prepaymentPercent, 70),
    remainingDaysBefore: Math.max(0, Math.trunc(toNumber(client?.prepaymentRemainingDaysBefore, 7))),
  };
}

function resolveUniform(defaultUniform, uniformOptions = []) {
  if (!hasValue(defaultUniform)) return { uniform: '', uniformOther: '' };
  const exact = uniformOptions.find((option) => normalizeText(option) === normalizeText(defaultUniform));
  if (exact) return { uniform: exact, uniformOther: '' };
  const other = uniformOptions.find((option) => normalizeText(option) === 'outros' || normalizeText(option) === 'outro');
  return other
    ? { uniform: other, uniformOther: String(defaultUniform).trim() }
    : { uniform: String(defaultUniform).trim(), uniformOther: '' };
}

function shouldApplyClientRate(item, fallbackRoleRates) {
  if (!hasValue(item?.rate)) return true;
  const fallbackRate = fallbackRoleRates?.[item.role];
  if (!hasValue(fallbackRate)) return false;
  return toNumber(item.rate, null) === toNumber(fallbackRate, null);
}

export function applyClientRulesToServiceForm(form, client, options = {}) {
  const contact = clientDefaultContact(client);
  const uniformDefaults = resolveUniform(client?.defaultUniform, options.uniformOptions);

  return {
    ...form,
    clientId: client?.id || '',
    minimumHoursSnapshot: toNumber(client?.minimumHours, 0) || 0,
    location: form?.useDefaultLocation ? (client?.address || '') : (form?.location || ''),
    onsiteContactName: hasValue(form?.onsiteContactName) ? form.onsiteContactName : contact.onsiteContactName,
    onsiteContactPhone: hasValue(form?.onsiteContactPhone) ? form.onsiteContactPhone : contact.onsiteContactPhone,
    uniform: hasValue(form?.uniform) ? form.uniform : uniformDefaults.uniform,
    uniformOther: hasValue(form?.uniformOther) ? form.uniformOther : uniformDefaults.uniformOther,
    requiredRoles: (form?.requiredRoles || []).map((item) => {
      const clientRate = clientRuleRate(client, item.role);
      return {
        ...item,
        agreedRate: hasValue(item.agreedRate) || clientRate === null ? item.agreedRate : clientRate,
      };
    }),
  };
}

export function applyClientRulesToBudgetForm(form, client, options = {}) {
  const uniformDefaults = resolveUniform(client?.defaultUniform, options.uniformOptions);
  const fallbackRoleRates = options.fallbackRoleRates || {};

  return {
    ...form,
    clientId: client?.id || '',
    leadName: client?.representativeName || client?.contactPerson || form?.leadName || '',
    companyName: client?.name || form?.companyName || '',
    phone: client?.phone || form?.phone || '',
    email: client?.email || form?.email || '',
    nif: client?.nif || form?.nif || '',
    budgetType: client?.type === 'particular' ? 'individual' : form?.budgetType,
    regularClient: Boolean(client?.id),
    minimumHours: hasValue(client?.minimumHours) ? String(client.minimumHours) : (form?.minimumHours || ''),
    categories: (form?.categories || []).map((item) => {
      const clientRate = clientRuleRate(client, item.role);
      const fallbackRate = fallbackRoleRates[item.role];
      const applyClientRate = clientRate !== null && shouldApplyClientRate(item, fallbackRoleRates);
      return {
        ...item,
        rate: applyClientRate
          ? clientRate
          : (hasValue(item.rate) ? item.rate : fallbackRate || item.rate),
        uniform: hasValue(item.uniform) ? item.uniform : uniformDefaults.uniform,
      };
    }),
  };
}
