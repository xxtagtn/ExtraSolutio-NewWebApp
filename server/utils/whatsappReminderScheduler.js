import { clearInterval, clearTimeout, setInterval, setTimeout } from 'node:timers';
import { prisma } from '../prisma.js';
import {
  normalizeWhatsAppRecipient,
  sendWhatsAppTemplateMessage,
  validateWhatsAppConfig,
  whatsappConfigFromEnv,
} from './whatsappClient.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const CONFIRMED_STATUSES = new Set(['confirmed', 'confirmado']);
const CANCELLED_STATUSES = new Set(['cancelled', 'cancelado']);
const DEFAULT_TEMPLATE_FIELDS = ['collaborator', 'event', 'date', 'start', 'end', 'location', 'role'];

function text(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return text(value).toLowerCase();
}

export function reminderDayKey(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  }
  return text(value).slice(0, 10);
}

function timeParts(value) {
  const match = text(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

export function eventStartInstant(dayValue, timeValue, timeZone = 'Europe/Lisbon') {
  const day = reminderDayKey(dayValue);
  const time = timeParts(timeValue);
  const match = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match || !time) return null;

  const targetUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), time.hours, time.minutes);
  let instant = new Date(targetUtc);

  // Two passes resolve the UTC offset, including daylight-saving transitions.
  for (let pass = 0; pass < 2; pass += 1) {
    const represented = zonedParts(instant, timeZone);
    const representedUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
      represented.second,
    );
    instant = new Date(instant.getTime() + (targetUtc - representedUtc));
  }

  return Number.isNaN(instant.getTime()) ? null : instant;
}

function cancelledDayKeys(event = {}) {
  if (!event.cancelledDays) return new Set();
  try {
    const values = Array.isArray(event.cancelledDays) ? event.cancelledDays : JSON.parse(event.cancelledDays);
    return new Set((Array.isArray(values) ? values : [])
      .map((item) => reminderDayKey(typeof item === 'string' ? item : item?.date || item?.day))
      .filter(Boolean));
  } catch {
    return new Set();
  }
}

function assignmentDay(assignment = {}) {
  return reminderDayKey(assignment.assignmentDate || assignment.event?.date);
}

function assignmentStart(assignment = {}) {
  return text(assignment.plannedCheckIn || assignment.checkIn || assignment.event?.startTime);
}

function assignmentEnd(assignment = {}) {
  return text(assignment.plannedCheckOut || assignment.checkOut || assignment.event?.endTime);
}

export function reminderDedupeKey(assignment = {}) {
  return `whatsapp_reminder_24h:${assignment.id}:${assignmentDay(assignment)}`;
}

export function evaluateReminderCandidate(assignment = {}, {
  now = new Date(),
  timeZone = 'Europe/Lisbon',
} = {}) {
  const event = assignment.event || {};
  const day = assignmentDay(assignment);
  const startsAt = eventStartInstant(day, assignmentStart(assignment), timeZone);

  if (!assignment.id || !assignment.collaboratorId || !event.id) return { eligible: false, reason: 'missing_relation' };
  if (assignment.whatsappEnabled !== true) return { eligible: false, reason: 'disabled' };
  if (!CONFIRMED_STATUSES.has(normalized(assignment.status))) return { eligible: false, reason: 'not_confirmed' };
  if (CANCELLED_STATUSES.has(normalized(event.status))) return { eligible: false, reason: 'event_cancelled' };
  if (!day || cancelledDayKeys(event).has(day)) return { eligible: false, reason: 'day_cancelled' };
  if (!normalizeWhatsAppRecipient(assignment.collaborator?.phone)) return { eligible: false, reason: 'missing_phone' };
  if (!startsAt) return { eligible: false, reason: 'missing_start' };

  const remainingMs = startsAt.getTime() - new Date(now).getTime();
  if (remainingMs < 0) return { eligible: false, reason: 'already_started', startsAt };
  if (remainingMs > DAY_MS) return { eligible: false, reason: 'too_early', startsAt };

  return { eligible: true, reason: 'due', startsAt, day };
}

function formatDatePt(day) {
  const [year, month, date] = reminderDayKey(day).split('-');
  return year && month && date ? `${date}/${month}/${year}` : '';
}

function collaboratorName(assignment = {}) {
  return text(assignment.collaborator?.shortName) || text(assignment.collaborator?.name) || 'Colaborador';
}

function eventName(assignment = {}) {
  return text(assignment.event?.serviceReference) || text(assignment.event?.name) || 'Serviço';
}

export function buildReminderText(assignment = {}) {
  const start = assignmentStart(assignment);
  const end = assignmentEnd(assignment);
  return [
    `Olá ${collaboratorName(assignment)}, lembramos que tens um serviço confirmado amanhã.`,
    `Evento: ${eventName(assignment)}`,
    `Data: ${formatDatePt(assignmentDay(assignment))}`,
    `Horário: ${[start, end].filter(Boolean).join(' → ')}`,
    `Local: ${text(assignment.event?.location) || 'A confirmar'}`,
    'Informa a equipa ExtraSolutio, caso não consigas.',
  ].join('\n');
}

function templateFieldValue(field, assignment) {
  const start = assignmentStart(assignment);
  const end = assignmentEnd(assignment);
  const values = {
    collaborator: collaboratorName(assignment),
    event: eventName(assignment),
    date: formatDatePt(assignmentDay(assignment)),
    start: start || 'A confirmar',
    end: end || 'A confirmar',
    schedule: [start, end].filter(Boolean).join(' → ') || 'A confirmar',
    location: text(assignment.event?.location) || 'A confirmar',
    role: text(assignment.role) || 'A confirmar',
    client: text(assignment.event?.client?.name || assignment.event?.clientName) || 'A confirmar',
  };
  return values[field] || '';
}

export function buildReminderTemplateMessage(assignment = {}, env = process.env) {
  const fields = text(env.WHATSAPP_REMINDER_TEMPLATE_FIELDS)
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);
  const selectedFields = fields.length ? fields : DEFAULT_TEMPLATE_FIELDS;

  return {
    to: assignment.collaborator?.phone,
    templateName: env.WHATSAPP_REMINDER_TEMPLATE_NAME || 'lembrete_servico_24h',
    languageCode: env.WHATSAPP_REMINDER_LANGUAGE_CODE || 'pt_PT',
    components: [{
      type: 'body',
      parameters: selectedFields.map((field) => ({
        type: 'text',
        text: templateFieldValue(field, assignment),
      })),
    }],
  };
}

function providerResponse(result) {
  return JSON.stringify({
    messageId: result?.messages?.[0]?.id || null,
    contact: result?.contacts?.[0]?.wa_id || null,
  });
}

export async function processWhatsAppReminders({
  db = prisma,
  now = new Date(),
  timeZone = process.env.WHATSAPP_REMINDER_TIMEZONE || 'Europe/Lisbon',
  env = process.env,
  sendMessage = sendWhatsAppTemplateMessage,
  logger = console,
} = {}) {
  const from = new Date(now);
  from.setUTCHours(0, 0, 0, 0);
  const until = new Date(from.getTime() + (3 * DAY_MS));
  const candidates = await db.eventAssignment.findMany({
    where: {
      whatsappEnabled: true,
      OR: [
        { assignmentDate: { gte: from, lt: until } },
        { assignmentDate: null, event: { date: { gte: from, lt: until } } },
      ],
    },
    include: {
      collaborator: true,
      event: { include: { client: true } },
    },
  });

  const summary = { checked: candidates.length, sent: 0, skipped: 0, failed: 0 };

  for (const assignment of candidates) {
    const decision = evaluateReminderCandidate(assignment, { now, timeZone });
    if (!decision.eligible) {
      summary.skipped += 1;
      continue;
    }

    const dedupeKey = reminderDedupeKey(assignment);
    let log;
    try {
      log = await db.communicationLog.create({
        data: {
          eventId: assignment.eventId,
          assignmentId: assignment.id,
          collaboratorId: assignment.collaboratorId,
          type: 'reminder_24h',
          channel: 'automatic_whatsapp',
          status: 'sending',
          message: buildReminderText(assignment),
          dedupeKey,
        },
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        summary.skipped += 1;
        continue;
      }
      throw error;
    }

    try {
      const result = await sendMessage({ message: buildReminderTemplateMessage(assignment, env) });
      await db.communicationLog.update({
        where: { id: log.id },
        data: { status: 'accepted', sentAt: new Date(), response: providerResponse(result) },
      });
      summary.sent += 1;
    } catch (error) {
      await db.communicationLog.update({
        where: { id: log.id },
        data: { status: 'failed', response: text(error?.message || error) },
      });
      logger.error?.(`[whatsapp-reminder] Falha no envio da atribuição ${assignment.id}.`, error?.message || error);
      summary.failed += 1;
    }
  }

  return summary;
}

export function startWhatsAppReminderScheduler({
  enabled = process.env.WHATSAPP_REMINDER_ENABLED !== 'false',
  intervalMinutes = Number(process.env.WHATSAPP_REMINDER_INTERVAL_MINUTES || 5),
  startupDelayMs = Number(process.env.WHATSAPP_REMINDER_STARTUP_DELAY_MS || 15_000),
  logger = console,
} = {}) {
  if (!enabled || !Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return null;

  const configState = validateWhatsAppConfig(whatsappConfigFromEnv());
  if (!configState.ok) {
    logger.warn?.(`[whatsapp-reminder] Agendador inativo: falta ${configState.missing.join(', ')}.`);
    return null;
  }

  let running = false;
  async function run() {
    if (running) return;
    running = true;
    try {
      const result = await processWhatsAppReminders({ logger });
      if (result.sent || result.failed) logger.info?.('[whatsapp-reminder]', result);
    } catch (error) {
      logger.error?.('[whatsapp-reminder] Falha na verificação automática.', error);
    } finally {
      running = false;
    }
  }

  const startupTimer = setTimeout(run, startupDelayMs);
  startupTimer.unref?.();
  const interval = setInterval(run, intervalMinutes * 60 * 1000);
  interval.unref?.();

  return {
    runNow: run,
    stop() {
      clearTimeout(startupTimer);
      clearInterval(interval);
    },
  };
}
