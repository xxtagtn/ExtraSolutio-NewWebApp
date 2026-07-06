import bcrypt from 'bcryptjs';
import '../server/config/env.js';
import { prisma } from '../server/prisma.js';
import { validatePasswordStrength } from '../server/security/passwordPolicy.js';

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME || 'Administrador';

if (!email || !password) {
  console.error('Define ADMIN_EMAIL e ADMIN_PASSWORD antes de correr este script.');
  process.exit(1);
}

const passwordStrength = validatePasswordStrength(password);
if (!passwordStrength.valid) {
  console.error(`ADMIN_PASSWORD inválida. ${passwordStrength.message}`);
  process.exit(1);
}

const passwordHash = await bcrypt.hash(password, 12);

const user = await prisma.user.upsert({
  where: { email },
  update: {
    name,
    password: passwordHash,
    role: 'admin',
  },
  create: {
    email,
    name,
    password: passwordHash,
    role: 'admin',
  },
});

await prisma.$disconnect();

console.log(`Utilizador admin pronto: ${user.email}`);
