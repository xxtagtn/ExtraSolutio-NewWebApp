import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyWhatsAppDeliveryStatuses,
  extractWhatsAppDeliveryStatuses,
} from './whatsappDeliveryStatus.js';

function payload(status = 'delivered', errors = []) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        value: {
          statuses: [{
            id: 'wamid.test-123',
            status,
            recipient_id: '351963680415',
            timestamp: '1787065200',
            errors,
          }],
        },
      }],
    }],
  };
}

test('extracts WhatsApp delivery events from a webhook', () => {
  assert.deepEqual(extractWhatsAppDeliveryStatuses(payload()), [{
    id: 'wamid.test-123',
    status: 'delivered',
    recipient: '351963680415',
    timestamp: '1787065200',
    errors: [],
  }]);
});

test('updates the matching communication log to delivered', async () => {
  const updates = [];
  const db = {
    communicationLog: {
      findMany: async () => [{
        id: 9,
        response: JSON.stringify({ messageId: 'wamid.test-123', contact: '351963680415' }),
      }],
      update: async (args) => { updates.push(args); },
    },
  };

  const summary = await applyWhatsAppDeliveryStatuses(payload(), { db });
  assert.deepEqual(summary, { received: 1, updated: 1, unmatched: 0 });
  assert.equal(updates[0].data.status, 'delivered');
  assert.equal(JSON.parse(updates[0].data.response).delivery.status, 'delivered');
});

test('records provider failures instead of reporting a successful delivery', async () => {
  const updates = [];
  const db = {
    communicationLog: {
      findMany: async () => [{
        id: 10,
        response: JSON.stringify({ messageId: 'wamid.test-123' }),
      }],
      update: async (args) => { updates.push(args); },
    },
  };
  const errors = [{ code: 131026, title: 'Message undeliverable', message: 'Message undeliverable' }];

  await applyWhatsAppDeliveryStatuses(payload('failed', errors), { db });
  assert.equal(updates[0].data.status, 'failed');
  assert.equal(JSON.parse(updates[0].data.response).delivery.errors[0].code, 131026);
});
