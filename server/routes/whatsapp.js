import { Router } from 'express';
import { asyncHandler } from '../utils/http.js';
import { sendWhatsAppTemplateMessage } from '../utils/whatsappClient.js';

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
