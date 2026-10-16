import { createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import jwt from 'jsonwebtoken';
import { publicRole } from './roles.js';

export function credentialVersion(user, secret = process.env.JWT_SECRET) {
  if (!user?.password || !secret) throw new Error('Missing session credentials.');
  // An opaque fingerprint, never the password hash itself, is included in JWTs.
  return createHmac('sha256', secret)
    .update(`extrasolutio:session:v1:${user.id}:${user.password}`)
    .digest('hex');
}

export function credentialVersionMatches(value, user) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return false;
  return timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(credentialVersion(user), 'hex'));
}

export function issueSessionToken(user, { version, expiresIn = process.env.JWT_EXPIRES_IN || '4h' } = {}) {
  return jwt.sign(
    { id: user.id, email: user.email, role: publicRole(user.role), cv: version || credentialVersion(user) },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn },
  );
}
