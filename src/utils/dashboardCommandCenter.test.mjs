import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardCommandCenter } from './dashboardCommandCenter.js';

const today = new Date('2026-06-30T12:00:00');

test('builds operational dashboard metrics from current app data', () => {
  const overview = buildDashboardCommandCenter({
    services: [
      {
        id: 1,
        name: 'Restaurante Luz Chakall',
        date: '2026-06-30',
        startTime: '11:30',
        endTime: '16:00',
        status: 'team_complete',
        totalRevenue: '284',
        client: { name: 'SSH' },
        requiredRoles: JSON.stringify([{ role: 'Emp.Mesa', qty: 2 }]),
        assignments: [
          { status: 'confirmed', validationStatus: 'pending' },
          { status: 'confirmed', validationStatus: 'validated' },
        ],
      },
      {
        id: 2,
        name: 'Hotel Altis',
        date: '2026-07-01',
        startTime: '10:00',
        endTime: '22:00',
        status: 'drafting',
        client: { name: 'Hotel Altis' },
        requiredRoles: [{ role: 'Barman', qty: 3 }],
        assignments: [
          { status: 'confirmed', validationStatus: 'pending' },
          { status: 'pending_confirmation', validationStatus: 'pending' },
        ],
      },
      {
        id: 3,
        name: 'Evento faturável',
        date: '2026-06-28',
        status: 'finalized',
        totalRevenue: '1000',
        billingStatus: 'pending',
        assignments: [{ status: 'confirmed', validationStatus: 'validated' }],
      },
    ],
    collaborators: [
      { id: 1, status: 'active' },
      { id: 2, status: 'inactive' },
      { id: 3, status: 'active' },
    ],
    budgets: [
      { id: 1, status: 'sent', followUpHistory: JSON.stringify([{ reminderDate: '2026-06-30', text: 'Ligar' }]) },
      { id: 2, status: 'accepted' },
    ],
    actions: [
      { id: 'a1', category: 'Validação de Horas', title: 'Validar horários Cliente', dueDate: '2026-06-30', priority: 'critical', tone: 'danger', to: '/time-validation' },
      { id: 'a2', category: 'Eventos/Serviços', title: 'Enviar lembrete 24h', dueDate: '2026-07-01', priority: 'high', tone: 'warning', to: '/services/2' },
    ],
  }, { today });

  assert.equal(overview.kpis.eventsToday.value, 1);
  assert.equal(overview.kpis.staffPending.value, 1);
  assert.equal(overview.kpis.hoursPending.value, 2);
  assert.equal(overview.kpis.readyToInvoice.value, 1000);
  assert.equal(overview.quickSummary.nextSevenDays, 2);
  assert.equal(overview.quickSummary.activeStaff, 2);
  assert.equal(overview.quickSummary.openBudgets, 1);
  assert.equal(overview.quickSummary.pendingFollowUps, 1);
  assert.equal(overview.todayItems[0].title, 'Restaurante Luz Chakall');
  assert.equal(overview.next48Items[0].title, 'Hotel Altis');
  assert.equal(overview.pendingActions.length, 2);
});

test('keeps today and next 48h lists ordered by service date and time', () => {
  const overview = buildDashboardCommandCenter({
    services: [
      { id: 1, name: 'Tarde', date: '2026-06-30', startTime: '18:00', assignments: [] },
      { id: 2, name: 'Manhã', date: '2026-06-30', startTime: '09:00', assignments: [] },
      { id: 3, name: 'Amanhã', date: '2026-07-01', startTime: '08:00', assignments: [] },
    ],
  }, { today });

  assert.deepEqual(overview.todayItems.map((item) => item.title), ['Manhã', 'Tarde']);
  assert.deepEqual(overview.next48Items.map((item) => item.title), ['Amanhã']);
});

test('uses custom action button labels in timeline items', () => {
  const overview = buildDashboardCommandCenter({
    actions: [
      {
        id: 'staff-reminder-1',
        category: 'Staff',
        title: 'Enviar lembrete 24h ao staff',
        dueDate: '2026-06-30',
        buttonLabel: 'Preparar',
        to: '/services/1',
      },
    ],
  }, { today });

  assert.equal(overview.todayItems[0].actionLabel, 'Preparar');
});
