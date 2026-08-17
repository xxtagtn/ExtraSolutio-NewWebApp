import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildWhatsAppTemplatePayload,
  buildWhatsAppTextPayload,
  normalizeWhatsAppRecipient,
  sendWhatsAppTemplateMessage,
  sendWhatsAppTextMessage,
  validateWhatsAppConfig,
} from './whatsappClient.js';

test('normalizes Portuguese WhatsApp recipients to international digits only', () => {
  assert.equal(normalizeWhatsAppRecipient('+351 933 811 286'), '351933811286');
  assert.equal(normalizeWhatsAppRecipient('00351 933 811 286'), '351933811286');
  assert.equal(normalizeWhatsAppRecipient('933811286'), '351933811286');
});

test('builds a WhatsApp template payload with safe defaults', () => {
  assert.deepEqual(
    buildWhatsAppTemplatePayload({ to: '+351 933 811 286' }),
    {
      messaging_product: 'whatsapp',
      to: '351933811286',
      type: 'template',
      template: {
        name: 'hello_world',
        language: { code: 'en_US' },
      },
    },
  );
});

test('builds a WhatsApp text payload without a preview', () => {
  assert.deepEqual(
    buildWhatsAppTextPayload({ to: '+351 933 811 286', body: '  Olá  ' }),
    {
      messaging_product: 'whatsapp',
      to: '351933811286',
      type: 'text',
      text: { preview_url: false, body: 'Olá' },
    },
  );
});

test('validates the required WhatsApp environment config', () => {
  assert.deepEqual(validateWhatsAppConfig({
    accessToken: 'token',
    phoneNumberId: '123',
  }), { ok: true });

  assert.deepEqual(validateWhatsAppConfig({
    accessToken: '',
    phoneNumberId: '123',
  }), {
    ok: false,
    missing: ['WHATSAPP_ACCESS_TOKEN'],
  });
});

test('sends a template message to the Meta messages endpoint', async () => {
  let requestedUrl = '';
  let requestedOptions = null;

  const result = await sendWhatsAppTemplateMessage({
    config: {
      accessToken: 'secret-token',
      phoneNumberId: '1225592500636551',
      graphVersion: 'v25.0',
    },
    message: { to: '933811286' },
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestedOptions = options;
      return {
        ok: true,
        status: 200,
        async json() {
          return { messages: [{ id: 'wamid.test' }] };
        },
      };
    },
  });

  assert.equal(requestedUrl, 'https://graph.facebook.com/v25.0/1225592500636551/messages');
  assert.equal(requestedOptions.method, 'POST');
  assert.equal(requestedOptions.headers.Authorization, 'Bearer secret-token');
  assert.equal(JSON.parse(requestedOptions.body).to, '351933811286');
  assert.deepEqual(result, { messages: [{ id: 'wamid.test' }] });
});

test('sends a WhatsApp text message to the Meta messages endpoint', async () => {
  let requestedBody = null;

  const result = await sendWhatsAppTextMessage({
    config: {
      accessToken: 'secret-token',
      phoneNumberId: '1225592500636551',
      graphVersion: 'v25.0',
    },
    message: { to: '933811286', body: 'Resposta automática' },
    fetchImpl: async (_url, options) => {
      requestedBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        async json() {
          return { messages: [{ id: 'wamid.reply' }] };
        },
      };
    },
  });

  assert.deepEqual(requestedBody, {
    messaging_product: 'whatsapp',
    to: '351933811286',
    type: 'text',
    text: { preview_url: false, body: 'Resposta automática' },
  });
  assert.deepEqual(result, { messages: [{ id: 'wamid.reply' }] });
});

test('reports Meta API errors without exposing the access token', async () => {
  await assert.rejects(
    sendWhatsAppTemplateMessage({
      config: {
        accessToken: 'secret-token',
        phoneNumberId: '1225592500636551',
      },
      message: { to: '933811286' },
      fetchImpl: async () => ({
        ok: false,
        status: 400,
        async json() {
          return {
            error: {
              message: 'Unsupported post request.',
              code: 100,
            },
          };
        },
      }),
    }),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.expose, true);
      assert.equal(error.message, 'WhatsApp: Unsupported post request.');
      assert.equal(error.message.includes('secret-token'), false);
      return true;
    },
  );
});
