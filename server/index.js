import './config/env.js';
import { fileURLToPath, URL } from 'node:url';
import cors from 'cors';
import express from 'express';
import { apiRouter } from './routes/index.js';
import { startBackupScheduler } from './utils/backupScheduler.js';
import { startWhatsAppReminderScheduler } from './utils/whatsappReminderScheduler.js';

const uploadsDir = fileURLToPath(new URL('../public/uploads', import.meta.url));

const app = express();
const port = process.env.PORT || 3001;

const corsOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors(corsOrigins.length ? { origin: corsOrigins } : {}));
app.use(express.json({ limit: '8mb' }));
app.use('/uploads', express.static(uploadsDir, {
  fallthrough: true,
  maxAge: '7d',
}));
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

app.listen(port, () => {
  console.log(`API ExtraSolutio em http://localhost:${port}`);
  console.log(`Base de dados: ${process.env.DATABASE_URL}`);
  if (corsOrigins.length) {
    console.log(`CORS restrito a: ${corsOrigins.join(', ')}`);
  }
});

startBackupScheduler();
startWhatsAppReminderScheduler();
