import './config/env.js';
import cors from 'cors';
import express from 'express';
import { apiRouter } from './routes/index.js';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use('/api', apiRouter);

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Imagem demasiado grande. Usa uma fotografia menor.' });
  }
  const status = error?.code === 'P2025' ? 404 : error?.code === 'P2002' ? 409 : 500;
  res.status(status).json({
    message: status === 404
      ? 'Registo não encontrado.'
      : status === 409
        ? 'Já existe um registo com estes dados.'
        : 'Erro interno.',
  });
});

app.listen(port, () => {
  console.log(`API ExtraSolutio em http://localhost:${port}`);
});
