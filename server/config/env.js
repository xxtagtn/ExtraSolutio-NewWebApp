import 'dotenv/config';

process.env.DATABASE_URL ||= 'file:./dev.db';
process.env.JWT_SECRET ||= 'dev-secret-change-me';
process.env.PORT ||= '3001';
