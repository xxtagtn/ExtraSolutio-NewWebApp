import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendarFeed, buildCalendarFeedUrls } from './calendarFeed.js';

test('buildCalendarFeed creates Outlook-compatible service occurrences and reminders', () => {
  const ics = buildCalendarFeed({
    generatedAt: new Date('2026-07-10T10:00:00.000Z'),
    services: [
      {
        id: 7,
        name: 'Restaurante Luz Chakall',
        client: { name: 'SSH - Supreme Sport Hospitality' },
        location: 'Lisboa, Portugal',
        date: '2026-06-21T00:00:00.000Z',
        endDate: '2026-06-23T00:00:00.000Z',
        isContinuous: true,
        startTime: '10:00',
        endTime: '16:30',
        status: 'team_complete',
        billingStatus: 'partial70',
        remainingPaymentDate: '2026-06-16T00:00:00.000Z',
      },
    ],
    budgets: [
      {
        id: 3,
        reference: 'ORC-2026-003',
        companyName: 'Cliente, Especial',
        followUpHistory: JSON.stringify([{ text: 'Ligar; confirmar proposta', reminderDate: '2026-06-18' }]),
      },
    ],
    collaborators: [
      {
        id: 5,
        shortName: 'Miriam Oliveira',
        name: 'Miriam Peçanha Oliveira',
        birthDate: '1995-07-16T00:00:00.000Z',
      },
    ],
    productId: '-//ExtraSolutio//Calendario//PT',
  });

  assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-\/\/ExtraSolutio\/\/Calendario\/\/PT\r\n/m);
  assert.match(ics, /UID:service-7-20260621@extrasolutio\r\n/);
  assert.match(ics, /UID:service-7-20260622@extrasolutio\r\n/);
  assert.match(ics, /UID:service-7-20260623@extrasolutio\r\n/);
  assert.match(ics, /DTSTART;TZID=Europe\/Lisbon:20260621T100000\r\n/);
  assert.match(ics, /DTEND;TZID=Europe\/Lisbon:20260621T163000\r\n/);
  assert.match(ics, /SUMMARY:Restaurante Luz Chakall\r\n/);
  assert.match(ics, /LOCATION:Lisboa\\, Portugal\r\n/);
  assert.match(ics, /UID:payment-7-20260616@extrasolutio\r\n/);
  assert.match(ics, /SUMMARY:Restante pagamento: Restaurante Luz Chakall\r\n/);
  assert.match(ics, /UID:budget-followup-3-20260618@extrasolutio\r\n/);
  assert.match(ics, /SUMMARY:Follow-up: ORC-2026-003\r\n/);
  assert.match(ics, /DESCRIPTION:Cliente: Cliente\\, Especial\\nLigar\\; confirmar proposta\r\n/);
  assert.match(ics, /UID:birthday-5@extrasolutio\r\n/);
  assert.match(ics, /RRULE:FREQ=YEARLY\r\n/);
  assert.match(ics, /SUMMARY:Aniversário: Miriam Oliveira\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});

test('buildCalendarFeed omits sensitive collaborator and financial fields from descriptions', () => {
  const ics = buildCalendarFeed({
    generatedAt: new Date('2026-07-10T10:00:00.000Z'),
    services: [
      {
        id: 9,
        name: 'Evento Interno',
        client: { name: 'Cliente' },
        date: '2026-07-11T00:00:00.000Z',
        startTime: '09:00',
        endTime: '12:00',
        notes: 'IBAN PT50 0000 0000 0000 0000',
        totalCost: 123.45,
        totalRevenue: 987.65,
      },
    ],
    budgets: [],
    collaborators: [],
  });

  assert.doesNotMatch(ics, /IBAN/);
  assert.doesNotMatch(ics, /123\.45/);
  assert.doesNotMatch(ics, /987\.65/);
});

test('buildCalendarFeed omits cancelled occurrences from continuous events', () => {
  const ics = buildCalendarFeed({
    generatedAt: new Date('2026-07-10T10:00:00.000Z'),
    services: [
      {
        id: 14,
        name: 'Evento contínuo',
        date: '2026-07-20T00:00:00.000Z',
        endDate: '2026-07-22T00:00:00.000Z',
        isContinuous: true,
        cancelledDays: JSON.stringify([{ date: '2026-07-21' }]),
        startTime: '09:00',
        endTime: '18:00',
      },
    ],
    budgets: [],
    collaborators: [],
  });

  assert.match(ics, /UID:service-14-20260720@extrasolutio\r\n/);
  assert.doesNotMatch(ics, /UID:service-14-20260721@extrasolutio\r\n/);
  assert.match(ics, /UID:service-14-20260722@extrasolutio\r\n/);
});

test('buildCalendarFeedUrls prefers a configured public URL for Outlook subscriptions', () => {
  const urls = buildCalendarFeedUrls({
    token: 'a'.repeat(64),
    requestProtocol: 'http',
    requestHost: '192.168.1.65:3001',
    publicBaseUrl: 'https://app.extrasolutio.pt',
  });

  assert.equal(urls.feedUrl, `https://app.extrasolutio.pt/api/calendar-feed/${'a'.repeat(64)}.ics`);
  assert.equal(urls.webcalUrl, `webcal://app.extrasolutio.pt/api/calendar-feed/${'a'.repeat(64)}.ics`);
  assert.equal(urls.isLocalUrl, false);
});

test('buildCalendarFeedUrls marks local/private links that Outlook cannot sync from the cloud', () => {
  const urls = buildCalendarFeedUrls({
    token: 'b'.repeat(64),
    requestProtocol: 'http',
    requestHost: '192.168.1.65:3001',
  });

  assert.equal(urls.feedUrl, `http://192.168.1.65:3001/api/calendar-feed/${'b'.repeat(64)}.ics`);
  assert.equal(urls.isLocalUrl, true);
});
