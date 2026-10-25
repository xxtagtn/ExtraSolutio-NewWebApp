import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyClientRulesToBudgetForm,
  applyClientRulesToServiceForm,
  clientPrepaymentRule,
  clientRuleRate,
} from './clientRules.js';

const client = {
  id: 42,
  name: 'SSH - Supreme Sport Hospitality',
  type: 'empresarial',
  address: 'Avenida Eusebio da Silva Ferreira',
  phone: '963914058',
  representativeName: 'Ines Abreu',
  minimumHours: '4.5',
  billingMethod: 'prepaid',
  paymentTerm: '30d',
  defaultUniform: 'Camisa Preta',
  defaultOnsiteContactName: 'Paulo Martins',
  defaultOnsiteContactPhone: '912345678',
  prepaymentPercent: '70',
  prepaymentRemainingDaysBefore: 7,
  roleRates: JSON.stringify([
    { role: 'Emp.Mesa', rate: 10.5 },
    { role: 'Barman', rate: 12.75 },
  ]),
};

test('clientRuleRate reads configured client role rates', () => {
  assert.equal(clientRuleRate(client, 'Emp.Mesa'), 10.5);
  assert.equal(clientRuleRate(client, 'Barman'), 12.75);
  assert.equal(clientRuleRate(client, 'Copa'), null);
});

test('applyClientRulesToServiceForm fills event defaults without overwriting manual values', () => {
  const form = {
    clientId: '',
    useDefaultLocation: true,
    location: '',
    uniform: '',
    uniformOther: '',
    onsiteContactName: '',
    onsiteContactPhone: '',
    minimumHoursSnapshot: '',
    requiredRoles: [
      { role: 'Emp.Mesa', qty: 2, agreedRate: '' },
      { role: 'Barman', qty: 1, agreedRate: '14' },
    ],
  };

  const next = applyClientRulesToServiceForm(form, client, {
    uniformOptions: ['Camisa Branca', 'Camisa Preta', 'Fato'],
  });

  assert.equal(next.clientId, 42);
  assert.equal(next.location, client.address);
  assert.equal(next.minimumHoursSnapshot, 4.5);
  assert.equal(next.uniform, 'Camisa Preta');
  assert.equal(next.uniformOther, '');
  assert.equal(next.onsiteContactName, 'Ines Abreu');
  assert.equal(next.onsiteContactPhone, '963914058');
  assert.equal(next.requiredRoles[0].agreedRate, 10.5);
  assert.equal(next.requiredRoles[1].agreedRate, '14');
});

test('applyClientRulesToServiceForm uses Outros when the client uniform is not in the event list', () => {
  const next = applyClientRulesToServiceForm(
    {
      clientId: '',
      useDefaultLocation: false,
      location: 'Local manual',
      uniform: '',
      uniformOther: '',
      onsiteContactName: '',
      onsiteContactPhone: '',
      minimumHoursSnapshot: '',
      requiredRoles: [],
    },
    { ...client, defaultUniform: 'Uniforme especial' },
    { uniformOptions: ['Camisa Branca', 'Camisa Preta', 'Fato', 'Outros'] },
  );

  assert.equal(next.location, 'Local manual');
  assert.equal(next.uniform, 'Outros');
  assert.equal(next.uniformOther, 'Uniforme especial');
});

test('switching clients replaces inherited defaults and rates, but not user-entered event data', () => {
  const options = { uniformOptions: ['Camisa Preta', 'Camisa Branca', 'Outros'] };
  const form = { name: 'Evento em criacao', date: '2026-10-25', useDefaultLocation: true,
    requiredRoles: [{ role: 'Emp.Mesa', qty: 3, agreedRate: '' }, { role: 'Barman', qty: 2, agreedRate: 18 }],
    assignments: [{ collaboratorId: 7, hourlyRate: 8, status: 'confirmed', clientSynced: true }] };
  const first = applyClientRulesToServiceForm(form, client, options);
  const nextClient = { ...client, id: 43, address: 'Rua Cliente B', representativeName: 'Contacto B', phone: '222222222',
    defaultUniform: 'Camisa Branca', minimumHours: 8, roleRates: [{ role: 'Emp.Mesa', rate: 16 }, { role: 'Barman', rate: 20 }] };
  const next = applyClientRulesToServiceForm(first, nextClient, { ...options, previousClient: client });
  assert.equal(next.onsiteContactName, 'Contacto B'); assert.equal(next.onsiteContactPhone, '222222222');
  assert.equal(next.uniform, 'Camisa Branca'); assert.equal(next.location, 'Rua Cliente B');
  assert.equal(next.minimumHoursSnapshot, 8); assert.equal(next.requiredRoles[0].agreedRate, 16);
  assert.equal(next.requiredRoles[1].agreedRate, 18, 'Manual client sale price is preserved');
  assert.deepEqual(next.assignments, form.assignments); assert.equal(next.name, form.name); assert.equal(next.date, form.date);
});

test('client switches preserve manual contacts, location, uniform and custom rates', () => {
  const options = { uniformOptions: ['Camisa Preta', 'Outros'] };
  const first = applyClientRulesToServiceForm({ useDefaultLocation: false, location: 'Local manual', requiredRoles: [] }, client, options);
  const customized = { ...first, onsiteContactName: 'Responsavel manual', uniform: 'Outros', uniformOther: 'Uniforme manual' };
  const next = applyClientRulesToServiceForm(customized, { ...client, id: 43, address: 'Rua B', phone: '222222222', defaultUniform: 'Outro uniforme' },
    { ...options, previousClient: client });
  assert.equal(next.onsiteContactName, 'Responsavel manual'); assert.equal(next.onsiteContactPhone, '222222222');
  assert.equal(next.location, 'Local manual'); assert.equal(next.uniform, 'Outros'); assert.equal(next.uniformOther, 'Uniforme manual');
});

test('switching to missing defaults clears old inherited values, including after deselection', () => {
  const options = { uniformOptions: ['Camisa Preta', 'Outros'] };
  const first = applyClientRulesToServiceForm({ useDefaultLocation: true, requiredRoles: [{ role: 'Emp.Mesa', qty: 2 }] }, client, options);
  const emptyClient = { id: 43 };
  const next = applyClientRulesToServiceForm(first, emptyClient, { ...options, previousClient: client });
  assert.equal(next.location, ''); assert.equal(next.onsiteContactName, ''); assert.equal(next.onsiteContactPhone, '');
  assert.equal(next.uniform, ''); assert.equal(next.uniformOther, ''); assert.equal(next.requiredRoles[0].agreedRate, '');
  const cleared = applyClientRulesToServiceForm(first, undefined, { ...options, previousClient: client });
  assert.equal(cleared.clientId, ''); assert.equal(cleared.onsiteContactName, '');
  const restored = applyClientRulesToServiceForm(cleared, client, options);
  assert.equal(restored.onsiteContactName, client.representativeName); assert.equal(restored.location, client.address);
});

test('applyClientRulesToBudgetForm applies commercial defaults to budget categories', () => {
  const form = {
    clientId: '',
    leadName: '',
    companyName: '',
    phone: '',
    email: '',
    nif: '',
    budgetType: 'company',
    regularClient: false,
    minimumHours: '',
    categories: [
      { role: 'Emp.Mesa', qty: 4, rate: '12', uniform: '' },
      { role: 'Barman', qty: 1, rate: '15', uniform: 'Fato' },
    ],
  };

  const next = applyClientRulesToBudgetForm(form, client, {
    uniformOptions: ['Camisa Branca', 'Camisa Preta', 'Fato'],
    fallbackRoleRates: { 'Emp.Mesa': 12, Barman: 14 },
  });

  assert.equal(next.clientId, 42);
  assert.equal(next.leadName, 'Ines Abreu');
  assert.equal(next.companyName, client.name);
  assert.equal(next.minimumHours, '4.5');
  assert.equal(next.regularClient, true);
  assert.equal(next.categories[0].rate, 10.5);
  assert.equal(next.categories[0].uniform, 'Camisa Preta');
  assert.equal(next.categories[1].rate, '15');
  assert.equal(next.categories[1].uniform, 'Fato');
});

test('clientPrepaymentRule returns configurable prepayment defaults', () => {
  assert.deepEqual(clientPrepaymentRule(client), {
    enabled: true,
    percent: 70,
    remainingDaysBefore: 7,
  });

  assert.deepEqual(clientPrepaymentRule({ billingMethod: 'event' }), {
    enabled: false,
    percent: 70,
    remainingDaysBefore: 7,
  });
});
