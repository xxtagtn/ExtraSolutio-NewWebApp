import { prisma } from '../prisma.js';

const DELIVERY_STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);
const DELIVERY_RANK = {
  accepted: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

function text(value) {
  return String(value ?? '').trim();
}

function statusEvents(payload = {}) {
  return (Array.isArray(payload.entry) ? payload.entry : [])
    .flatMap((entry) => Array.isArray(entry?.changes) ? entry.changes : [])
    .flatMap((change) => Array.isArray(change?.value?.statuses) ? change.value.statuses : [])
    .map((status) => ({
      id: text(status?.id),
      status: text(status?.status).toLowerCase(),
      recipient: text(status?.recipient_id),
      timestamp: text(status?.timestamp),
      errors: Array.isArray(status?.errors) ? status.errors : [],
    }))
    .filter((status) => status.id && DELIVERY_STATUSES.has(status.status));
}

function parseResponse(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function errorSummary(errors = []) {
  return errors.map((error) => ({
    code: error?.code ?? null,
    title: text(error?.title) || null,
    message: text(error?.message) || null,
    details: text(error?.error_data?.details) || null,
  }));
}

export async function applyWhatsAppDeliveryStatuses(payload, { db = prisma, logger = console } = {}) {
  const events = statusEvents(payload);
  const summary = { received: events.length, updated: 0, unmatched: 0 };

  for (const event of events) {
    const candidates = await db.communicationLog.findMany({
      where: {
        channel: 'automatic_whatsapp',
        response: { contains: event.id },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    const log = candidates.find((candidate) => parseResponse(candidate.response).messageId === event.id);

    if (!log) {
      summary.unmatched += 1;
      logger.warn?.(`[whatsapp-delivery] Mensagem ${event.id} sem registo local correspondente.`);
      continue;
    }

    const currentRank = DELIVERY_RANK[text(log.status).toLowerCase()] ?? -1;
    const nextRank = DELIVERY_RANK[event.status] ?? -1;
    if (event.status !== 'failed' && currentRank > nextRank) {
      continue;
    }

    const previousResponse = parseResponse(log.response);
    const providerTimestamp = event.timestamp
      ? new Date(Number(event.timestamp) * 1000).toISOString()
      : new Date().toISOString();
    const response = {
      ...previousResponse,
      delivery: {
        status: event.status,
        recipient: event.recipient || previousResponse.contact || null,
        timestamp: providerTimestamp,
        errors: errorSummary(event.errors),
      },
    };

    await db.communicationLog.update({
      where: { id: log.id },
      data: {
        status: event.status,
        response: JSON.stringify(response),
      },
    });
    summary.updated += 1;
  }

  return summary;
}

export { statusEvents as extractWhatsAppDeliveryStatuses };
