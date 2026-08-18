import { Router } from 'express';
import { asyncHandler } from '../utils/http.js';
import { processWhatsAppIncomingMessages } from '../utils/whatsappInbound.js';
import { sendWhatsAppTemplateMessage } from '../utils/whatsappClient.js';
import { applyWhatsAppDeliveryStatuses } from '../utils/whatsappDeliveryStatus.js';

function webhookVerifyToken() {
  return String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '');
}

export const whatsappWebhookRouter = Router();

whatsappWebhookRouter.get('/webhook', (req, res) => {
  const mode = String(req.query['hub.mode'] || '');
  const token = String(req.query['hub.verify_token'] || '');
  const challenge = String(req.query['hub.challenge'] || '');

  if (mode === 'subscribe' && token && token === webhookVerifyToken()) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

whatsappWebhookRouter.post('/webhook', (req, res) => {
  // Meta expects a quick 2xx response for webhook deliveries.
  const changes = (Array.isArray(req.body?.entry) ? req.body.entry : [])
    .flatMap((entry) => Array.isArray(entry?.changes) ? entry.changes : [])
    .map((change) => change?.value || {})
    .filter(Boolean);
  const statuses = changes.flatMap((value) => Array.isArray(value.statuses) ? value.statuses : []);
  const messages = changes.flatMap((value) => Array.isArray(value.messages) ? value.messages : []);

  console.info('[whatsapp-webhook]', JSON.stringify({
    object: req.body?.object || null,
    entries: Array.isArray(req.body?.entry) ? req.body.entry.length : 0,
    statuses: statuses.map((status) => ({
      id: status.id || null,
      status: status.status || null,
      recipient: status.recipient_id || null,
      errors: Array.isArray(status.errors)
        ? status.errors.map((error) => ({ code: error.code || null, title: error.title || null }))
        : [],
    })),
    incomingMessages: messages.map((message) => ({
      id: message.id || null,
      type: message.type || null,
      from: message.from || null,
    })),
  }));

  void processWhatsAppIncomingMessages(req.body).then((summary) => {
    if (summary.received > 0) {
      console.info('[whatsapp-auto-reply]', JSON.stringify(summary));
    }
  }).catch((error) => {
    console.error('[whatsapp-auto-reply]', error?.message || error);
  });

  void applyWhatsAppDeliveryStatuses(req.body).then((summary) => {
    if (summary.received > 0) {
      console.info('[whatsapp-delivery]', JSON.stringify(summary));
    }
  }).catch((error) => {
    console.error('[whatsapp-delivery]', error?.message || error);
  });

  return res.sendStatus(200);
});

export const whatsappRouter = Router();

whatsappRouter.post('/template', asyncHandler(async (req, res) => {
  const result = await sendWhatsAppTemplateMessage({
    message: {
      to: req.body.to,
      templateName: req.body.templateName || 'hello_world',
      languageCode: req.body.languageCode || 'en_US',
      components: req.body.components,
    },
  });

  res.status(202).json({
    ok: true,
    provider: result,
  });
}));
