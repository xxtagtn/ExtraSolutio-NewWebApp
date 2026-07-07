import assert from 'node:assert/strict';
import { test } from 'node:test';

let templateFormModule = {};
try {
  templateFormModule = await import('./serviceTemplateForm.js');
} catch {
  templateFormModule = {};
}

test('applying a second service template replaces values loaded by the first template', () => {
  assert.equal(typeof templateFormModule.applyServiceTemplateToForm, 'function');

  const firstTemplate = {
    name: 'Template Restaurante',
    payload: JSON.stringify({
      eventName: 'Jantar A',
      eventType: 'Restaurante',
      startTime: '10:00',
      endTime: '16:00',
      uniform: 'Camisa Branca',
      uniformOther: '',
      meetingPoint: 'Porta A',
      onsiteContactName: 'Ana',
      onsiteContactPhone: '910000000',
      travelExpenseEnabled: true,
      travelType: 'manual',
      travelExpenseAmount: 25,
      travelManualAmount: 25,
      description: 'Primeiro template',
      requiredRoles: [{ role: 'Emp.Mesa', qty: 3, agreedRate: '10,00' }],
    }),
  };

  const secondTemplate = {
    name: 'Template Bar',
    payload: JSON.stringify({
      eventName: 'Cocktail B',
      eventType: 'Corporate',
      startTime: '18:30',
      endTime: '23:00',
      uniform: 'Outros',
      uniformOther: 'Avental preto',
      meetingPoint: 'Receção',
      onsiteContactName: 'Bruno',
      onsiteContactPhone: '920000000',
      travelExpenseEnabled: false,
      travelType: 'none',
      travelExpenseAmount: '',
      travelManualAmount: '',
      description: 'Segundo template',
      requiredRoles: [{ role: 'Barman', qty: 2, agreedRate: '14,50' }],
    }),
  };

  const baseForm = {
    name: '',
    eventType: '',
    isContinuous: false,
    endDate: '',
    useDefaultLocation: true,
    location: 'Local original',
    guestsCount: '',
    startTime: '',
    endTime: '',
    uniform: '',
    uniformOther: '',
    meetingPoint: '',
    onsiteContactName: '',
    onsiteContactPhone: '',
    travelExpenseEnabled: false,
    travelExpenseAmount: '',
    travelType: 'none',
    travelPeople: 1,
    km: 0,
    kmRate: 0.4,
    durationHours: 0,
    travelStaffHourlyRate: '',
    travelCars: [],
    split5050: false,
    travelManualAmount: '',
    description: '',
    requiredRoles: [],
    assignments: [{ collaboratorId: '1' }],
  };

  const afterFirst = templateFormModule.applyServiceTemplateToForm(baseForm, firstTemplate, {
    uniformOptions: ['Camisa Branca', 'Outros'],
    selectedClient: null,
  });
  const afterSecond = templateFormModule.applyServiceTemplateToForm(afterFirst, secondTemplate, {
    uniformOptions: ['Camisa Branca', 'Outros'],
    selectedClient: null,
  });

  assert.equal(afterSecond.name, 'Cocktail B');
  assert.equal(afterSecond.eventType, 'Corporate');
  assert.equal(afterSecond.startTime, '18:30');
  assert.equal(afterSecond.endTime, '23:00');
  assert.equal(afterSecond.uniform, 'Outros');
  assert.equal(afterSecond.uniformOther, 'Avental preto');
  assert.equal(afterSecond.meetingPoint, 'Receção');
  assert.equal(afterSecond.onsiteContactName, 'Bruno');
  assert.equal(afterSecond.onsiteContactPhone, '920000000');
  assert.equal(afterSecond.travelExpenseEnabled, false);
  assert.equal(afterSecond.travelType, 'none');
  assert.deepEqual(afterSecond.requiredRoles, [{ role: 'Barman', qty: 2, agreedRate: '14,50' }]);
  assert.deepEqual(afterSecond.assignments, []);
});
