import { normalizeWhatsAppRecipient, sendWhatsAppTextMessage, whatsappConfigFromEnv } from './whatsappClient.js';

const DEFAULT_REPLY = 'Olá. Este número é utilizado apenas para enviar notificações de serviço e não recebe respostas. Para esclarecer alguma questão, contacte a ExtraSolutio através dos canais habituais.';
const DEFAULT_COOLDOWN_MINUTES = 24 * 60;

const defaultState = {
  lastReplyAtByRecipient: new Map(),
  processedMessageIds: new Map(),
  processingMessageIds: new Set(),
};

export function createWhatsAppAutoReplyState() {
  return {
    lastReplyAtByRecipient: new Map(),
    processedMessageIds: new Map(),
    processingMessageIds: new Set(),
  };
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function whatsappAutoReplyConfig(env = process.env) {
  const enabled = String(env.WHATSAPP_AUTO_REPLY_ENABLED ?? 'true').toLowerCase() !== 'false';
  const cooldownMinutes = positiveNumber(
    env.WHATSAPP_AUTO_REPLY_COOLDOWN_MINUTES,
    DEFAULT_COOLDOWN_MINUTES,
  );

  return {
    enabled,
    cooldownMs: cooldownMinutes * 60 * 1000,
    message: String(env.WHATSAPP_AUTO_REPLY_MESSAGE || DEFAULT_REPLY).trim() || DEFAULT_REPLY,
  };
}

export function extractIncomingWhatsAppMessages(payload) {
  const messages = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const incoming = Array.isArray(change?.value?.messages) ? change.value.messages : [];
      for (const message of incoming) {
        const from = normalizeWhatsAppRecipient(message?.from);
        if (from) {
          messages.push({
            id: String(message?.id || ''),
            from,
            type: String(message?.type || 'unknown'),
          });
        }
      }
    }
  }

  return messages;
}

function removeExpiredState(state, now, cooldownMs) {
  for (const [recipient, timestamp] of state.lastReplyAtByRecipient) {
    if (now - timestamp >= cooldownMs) state.lastReplyAtByRecipient.delete(recipient);
  }
  for (const [messageId, timestamp] of state.processedMessageIds) {
    if (now - timestamp >= cooldownMs) state.processedMessageIds.delete(messageId);
  }
}

export async function processWhatsAppIncomingMessages(
  payload,
  {
    config = whatsappConfigFromEnv(),
    env = process.env,
    state = defaultState,
    sendText = sendWhatsAppTextMessage,
    now = Date.now(),
  } = {},
) {
  const settings = whatsappAutoReplyConfig(env);
  const messages = extractIncomingWhatsAppMessages(payload);

  if (!settings.enabled || messages.length === 0) {
    return { received: messages.length, replied: 0, skipped: messages.length };
  }

  removeExpiredState(state, now, settings.cooldownMs);

  let replied = 0;
  let skipped = 0;
  for (const message of messages) {
    const cooldownActive = state.lastReplyAtByRecipient.has(message.from);
    const alreadyProcessed = message.id && state.processedMessageIds.has(message.id);
    const alreadyProcessing = message.id && state.processingMessageIds.has(message.id);

    if (cooldownActive || alreadyProcessed || alreadyProcessing) {
      skipped += 1;
      continue;
    }

    if (message.id) state.processingMessageIds.add(message.id);
    try {
      await sendText({
        config,
        message: { to: message.from, body: settings.message },
      });
      state.lastReplyAtByRecipient.set(message.from, now);
      if (message.id) state.processedMessageIds.set(message.id, now);
      replied += 1;
    } catch (error) {
      console.error('[whatsapp-auto-reply]', error?.message || error);
    } finally {
      if (message.id) state.processingMessageIds.delete(message.id);
    }
  }

  return { received: messages.length, replied, skipped };
}
