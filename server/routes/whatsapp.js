import { Router } from 'express';
import { asyncHandler } from '../utils/http.js';
import { sendWhatsAppTemplateMessage } from '../utils/whatsappClient.js';

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
  console.info('[whatsapp-webhook]', JSON.stringify({
    object: req.body?.object || null,
    entries: Array.isArray(req.body?.entry) ? req.body.entry.length : 0,
  }));
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
