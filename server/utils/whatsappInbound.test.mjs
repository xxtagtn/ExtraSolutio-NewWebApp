import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createWhatsAppAutoReplyState,
  extractIncomingWhatsAppMessages,
  processWhatsAppIncomingMessages,
  whatsappAutoReplyConfig,
} from './whatsappInbound.js';

const payload = {
  object: 'whatsapp_business_account',
  entry: [{
    changes: [{
      value: {
        messages: [{ id: 'wamid.incoming-1', from: '+351 963 680 415', type: 'text' }],
      },
    }],
  }],
};

test('extracts incoming messages without logging message content', () => {
  assert.deepEqual(extractIncomingWhatsAppMessages(payload), [{
    id: 'wamid.incoming-1',
    from: '351963680415',
    type: 'text',
  }]);
});

test('configures the automatic reply and allows disabling it', () => {
  assert.deepEqual(whatsappAutoReplyConfig({
    WHATSAPP_AUTO_REPLY_ENABLED: 'false',
    WHATSAPP_AUTO_REPLY_COOLDOWN_MINUTES: '30',
    WHATSAPP_AUTO_REPLY_MESSAGE: 'Não responder',
  }), {
    enabled: false,
    cooldownMs: 30 * 60 * 1000,
    message: 'Não responder',
  });
});

test('replies once per recipient during the cooldown window', async () => {
  const sent = [];
  const state = createWhatsAppAutoReplyState();
  const options = {
    config: { accessToken: 'token', phoneNumberId: '123' },
    env: {
      WHATSAPP_AUTO_REPLY_ENABLED: 'true',
      WHATSAPP_AUTO_REPLY_COOLDOWN_MINUTES: '60',
      WHATSAPP_AUTO_REPLY_MESSAGE: 'Número apenas para notificações.',
    },
    state,
    sendText: async ({ message }) => sent.push(message),
    now: 100000,
  };

  assert.deepEqual(await processWhatsAppIncomingMessages(payload, options), {
    received: 1,
    replied: 1,
    skipped: 0,
  });
  assert.deepEqual(await processWhatsAppIncomingMessages(payload, {
    ...options,
    now: 100001,
  }), { received: 1, replied: 0, skipped: 1 });
  assert.deepEqual(await processWhatsAppIncomingMessages({ ...payload, entry: [{ changes: [{ value: { messages: [{ id: 'wamid.incoming-2', from: '351963680415' }] } }] }] }, {
    ...options,
    now: 100000 + (60 * 60 * 1000),
  }), { received: 1, replied: 1, skipped: 0 });
  assert.deepEqual(sent, [
    { to: '351963680415', body: 'Número apenas para notificações.' },
    { to: '351963680415', body: 'Número apenas para notificações.' },
  ]);
});
