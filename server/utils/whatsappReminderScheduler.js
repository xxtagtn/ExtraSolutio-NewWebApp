import { clearInterval, clearTimeout, setInterval, setTimeout } from 'node:timers';
import { prisma } from '../prisma.js';
import { eventStartInstant, reminderDayKey } from './eventTime.js';
export { eventStartInstant, reminderDayKey } from './eventTime.js';
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
  return `whatsapp_reminder_24h:collaborator:${assignment.collaboratorId}:${assignmentDay(assignment)}`;
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
  const groupAssignments = assignment.groupAssignments || [assignment];
  return [
    `Olá ${collaboratorName(assignment)}, lembramos que tens ${groupAssignments.length === 1 ? 'um serviço confirmado' : 'serviços confirmados'} nesse dia.`,
    `Data: ${formatDatePt(assignmentDay(assignment))}`,
    ...groupAssignments.map((item) => [
      `Evento: ${eventName(item)}`,
      `Horário: ${[assignmentStart(item), assignmentEnd(item)].filter(Boolean).join(' → ') || 'A confirmar'}`,
      `Função: ${text(item.role) || 'A confirmar'}`,
      `Local: ${text(item.event?.location) || 'A confirmar'}`,
    ].join('\n')),
    'Informa a equipa ExtraSolutio, caso não consigas.',
  ].join('\n\n');
}

function templateFieldValue(field, assignment) {
  const groupAssignments = assignment.groupAssignments || [assignment];
  const start = assignmentStart(groupAssignments[0] || assignment);
  const end = assignmentEnd(groupAssignments[0] || assignment);
  const uniqueValues = (getValue) => [...new Set(groupAssignments.map(getValue).map(text).filter(Boolean))].join(' · ');
  const values = {
    collaborator: collaboratorName(assignment),
    event: uniqueValues((item) => eventName(item)),
    date: formatDatePt(assignmentDay(assignment)),
    start: start || 'A confirmar',
    end: groupAssignments.length > 1
      ? ([end, ...groupAssignments.slice(1).map((item) => [assignmentStart(item), assignmentEnd(item)].filter(Boolean).join(' → '))].filter(Boolean).join('; ') || 'A confirmar')
      : end || 'A confirmar',
    schedule: groupAssignments.map((item) => [assignmentStart(item), assignmentEnd(item)].filter(Boolean).join(' → ')).filter(Boolean).join('; ') || 'A confirmar',
    location: uniqueValues((item) => item.event?.location) || 'A confirmar',
    role: uniqueValues((item) => item.role) || 'A confirmar',
    client: uniqueValues((item) => item.event?.client?.name || item.event?.clientName) || 'A confirmar',
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

function groupableConfirmedAssignment(assignment, timing) {
  const decision = evaluateReminderCandidate({ ...assignment, whatsappEnabled: true }, timing);
  if (!['due', 'too_early', 'already_started'].includes(decision.reason)) return null;
  if (!decision.startsAt) return null;
  return {
    day: assignmentDay(assignment),
    startsAt: decision.startsAt,
    upcoming: decision.reason !== 'already_started',
  };
}

function reminderGroupKey(assignment, day) {
  return `${assignment.collaboratorId}:${day}`;
}

function groupReminderAssignments(assignments, timing) {
  const groups = new Map();
  for (const assignment of assignments) {
    const schedule = groupableConfirmedAssignment(assignment, timing);
    if (!schedule) continue;
    const key = reminderGroupKey(assignment, schedule.day);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ assignment, ...schedule });
  }

  return [...groups.values()].map((rows) => {
    const ordered = rows.sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
    return {
      assignments: ordered.filter((row) => row.upcoming).map((row) => row.assignment),
      relatedAssignments: ordered.map((row) => row.assignment),
    };
  });
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
  const groups = groupReminderAssignments(candidates, { now, timeZone });
  const groupedCount = groups.reduce((sum, group) => sum + group.relatedAssignments.length, 0);
  summary.skipped += candidates.length - groupedCount;

  for (const { assignments, relatedAssignments } of groups) {
    if (!assignments.length) {
      summary.skipped += relatedAssignments.length;
      continue;
    }
    const dueAssignments = assignments.filter((assignment) => (
      evaluateReminderCandidate(assignment, { now, timeZone }).eligible
    ));
    if (!dueAssignments.length || assignments.some((assignment) => assignment.whatsappEnabled !== true)) {
      summary.skipped += relatedAssignments.length;
      continue;
    }

    const assignment = assignments[0];
    const groupedAssignment = { ...assignment, groupAssignments: assignments };
    const dedupeKey = reminderDedupeKey(assignment);
    let log;
    try {
      const previousAutomaticReminder = await db.communicationLog.findFirst({
        where: {
          assignmentId: { in: relatedAssignments.map((item) => item.id) },
          type: 'reminder_24h',
          channel: 'automatic_whatsapp',
        },
        select: { id: true },
      });
      if (previousAutomaticReminder) {
        summary.skipped += relatedAssignments.length;
        continue;
      }
      log = await db.communicationLog.create({
        data: {
          eventId: assignment.eventId,
          assignmentId: assignment.id,
          collaboratorId: assignment.collaboratorId,
          type: 'reminder_24h',
          channel: 'automatic_whatsapp',
          status: 'sending',
          message: buildReminderText(groupedAssignment),
          dedupeKey,
        },
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        summary.skipped += relatedAssignments.length;
        continue;
      }
      throw error;
    }

    try {
      const result = await sendMessage({ message: buildReminderTemplateMessage(groupedAssignment, env) });
      await db.communicationLog.update({
        where: { id: log.id },
        data: { status: 'accepted', sentAt: new Date(), response: providerResponse(result) },
      });
      summary.sent += 1;
      summary.skipped += relatedAssignments.length - 1;
    } catch (error) {
      await db.communicationLog.update({
        where: { id: log.id },
        data: { status: 'failed', response: text(error?.message || error) },
      });
      logger.error?.(`[whatsapp-reminder] Falha no envio da atribuição ${assignment.id}.`, error?.message || error);
      summary.failed += 1;
      summary.skipped += relatedAssignments.length - 1;
    }
  }

  return summary;
}

export function startWhatsAppReminderScheduler({
  // Automatic reminders stay in standby unless explicitly enabled.
  enabled = process.env.WHATSAPP_REMINDER_ENABLED === 'true',
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
