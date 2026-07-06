import crypto from 'node:crypto';
import { URL } from 'node:url';

export const QR_CHECK_ACTIONS = Object.freeze({
  checkIn: 'check_in',
  checkOut: 'check_out',
});

export function generateQrToken(randomBytes = crypto.randomBytes) {
  return randomBytes(32).toString('base64url');
}

export function qrCodeStateForAssignment(assignment = {}) {
  if (assignment.checkIn && assignment.checkOut) {
    return {
      key: 'servico_concluido',
      label: 'Serviço Concluído',
      nextAction: null,
    };
  }

  if (assignment.checkIn) {
    return {
      key: 'entrada_registada',
      label: 'Entrada Registada',
      nextAction: QR_CHECK_ACTIONS.checkOut,
    };
  }

  return {
    key: 'qr_generated',
    label: 'QR Gerado',
    nextAction: QR_CHECK_ACTIONS.checkIn,
  };
}

function dateFromValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfUtcDay(value) {
  const date = dateFromValue(value) || new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(value) {
  const date = startOfUtcDay(value);
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

export function qrUsageWindow({ event = {}, assignment = {} } = {}) {
  const referenceDate = assignment.assignmentDate || event.date;
  return {
    startsAt: startOfUtcDay(referenceDate),
    expiresAt: endOfUtcDay(referenceDate),
  };
}

export function validateQrUsage({ event = {}, assignment = {}, now = new Date() } = {}) {
  const current = dateFromValue(now) || new Date();
  const { startsAt, expiresAt } = qrUsageWindow({ event, assignment });

  if (current < startsAt) {
    const error = new Error('Este QR Code ainda não está ativo para este dia de serviço.');
    error.code = 'QR_NOT_ACTIVE';
    error.status = 400;
    throw error;
  }

  if (current > expiresAt) {
    const error = new Error('Este QR Code está expirado.');
    error.code = 'QR_EXPIRED';
    error.status = 410;
    throw error;
  }

  return true;
}

export function formatServerTime(value = new Date(), timeZone = process.env.APP_TIMEZONE || 'Europe/Lisbon') {
  const date = dateFromValue(value) || new Date();
  return new Intl.DateTimeFormat('pt-PT', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(date);
}

export function requestAuditMeta(req = {}) {
  return {
    ip: req.ip || req.socket?.remoteAddress || '',
    userAgent: req.get?.('user-agent') || req.headers?.['user-agent'] || '',
  };
}

function cleanBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function isLocalHostname(hostname) {
  const value = String(hostname || '').trim().toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '::1' || value === '[::1]';
}

function isPrivateIpv4(address) {
  const value = String(address || '').trim();
  if (/^10\./.test(value) || /^192\.168\./.test(value)) return true;
  const match = value.match(/^172\.(\d{1,2})\./);
  if (!match) return false;
  const second = Number(match[1]);
  return second >= 16 && second <= 31;
}

function preferredLanAddress(networkInterfaces = {}) {
  const addresses = Object.values(networkInterfaces)
    .flat()
    .filter(Boolean)
    .filter((address) => address.family === 'IPv4' && !address.internal && isPrivateIpv4(address.address))
    .map((address) => address.address);

  return addresses.find((address) => address.startsWith('192.168.'))
    || addresses.find((address) => address.startsWith('10.'))
    || addresses[0]
    || '';
}

function originFromReferer(referer) {
  const value = String(referer || '').trim();
  if (!value) return '';
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

export function resolveQrPublicBaseUrl({
  configured = '',
  origin = '',
  referer = '',
  protocol = 'http',
  host = '',
} = {}, networkInterfaces = {}) {
  const explicit = cleanBaseUrl(configured);
  if (explicit) return explicit;

  const rawBase = cleanBaseUrl(origin) || originFromReferer(referer) || `${protocol}://${host}`;

  try {
    const url = new URL(rawBase);
    const lanAddress = preferredLanAddress(networkInterfaces);
    if (lanAddress && isLocalHostname(url.hostname)) {
      url.hostname = lanAddress;
      return url.origin;
    }
    return url.origin;
  } catch {
    return rawBase;
  }
}
