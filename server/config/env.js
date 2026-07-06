import 'dotenv/config';

const WEAK_SECRETS = new Set(['dev-secret-change-me', 'change-me', 'secret', 'jwt-secret']);
const isProduction = process.env.NODE_ENV === 'production';

process.env.DATABASE_URL ||= 'file:./dev.db';
process.env.PORT ||= '3001';

if (!process.env.JWT_SECRET || WEAK_SECRETS.has(process.env.JWT_SECRET) || process.env.JWT_SECRET.length < 24) {
  if (isProduction) {
    throw new Error(
      'JWT_SECRET em falta ou fraco. Define um JWT_SECRET com pelo menos 24 caracteres aleatórios antes de arrancar em produção.',
    );
  }

  process.env.JWT_SECRET ||= 'dev-secret-change-me';
  console.warn(
    '[AVISO] JWT_SECRET fraco ou por omissão. Aceitável apenas em desenvolvimento. '
    + 'Define um segredo forte com pelo menos 24 caracteres antes de qualquer deploy.',
  );
}
