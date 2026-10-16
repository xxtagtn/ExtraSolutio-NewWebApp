import './config/env.js';
import cors from 'cors';
import express from 'express';
import { apiRouter } from './routes/index.js';
import { startBackupScheduler } from './utils/backupScheduler.js';
import { startWhatsAppReminderScheduler } from './utils/whatsappReminderScheduler.js';
import { startAttendancePushScheduler } from './services/attendancePush.js';
import { prisma } from './prisma.js';
import { captureWhatsAppBody } from './security/whatsappSignature.js';

const app = express();
const port = process.env.PORT || 3001;
const host = process.env.NODE_ENV === 'production' ? '127.0.0.1' : undefined;

const corsOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors(corsOrigins.length ? { origin: corsOrigins } : {}));
app.use(express.json({ limit: '8mb', verify: captureWhatsAppBody }));
app.use('/uploads', (_req, res) => res.set('Cache-Control', 'no-store').sendStatus(404));
app.use('/api', apiRouter);

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Imagem demasiado grande. Usa uma fotografia menor.' });
  }
  const status = Number(error?.statusCode)
    || (error?.code === 'P2025'
      ? 404
      : error?.code === 'P2002'
        ? 409
        : error?.code === 'P2003'
          ? 409
          : 500);
  if (error?.expose && error?.message) {
    return res.status(status).json({ message: error.message });
  }
  res.status(status).json({
    message: status === 404
      ? 'Registo não encontrado.'
      : status === 409
        ? error?.code === 'P2003'
          ? 'Não é possível concluir a operação: existem registos associados. Remove ou atualiza primeiro esses registos.'
          : 'Já existe um registo com estes dados.'
        : 'Erro interno.',
  });
});

app.listen(port, host, () => {
  console.log(`API ExtraSolutio em http://localhost:${port}`);
  if (corsOrigins.length) {
    console.log(`CORS restrito a: ${corsOrigins.join(', ')}`);
  }
});

startBackupScheduler();
startWhatsAppReminderScheduler();
startAttendancePushScheduler(prisma);
