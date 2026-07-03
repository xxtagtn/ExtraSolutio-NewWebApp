const DEFAULT_GRAPH_VERSION = 'v25.0';
const DEFAULT_TEMPLATE_NAME = 'hello_world';
const DEFAULT_LANGUAGE_CODE = 'en_US';

export function normalizeWhatsAppRecipient(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('351')) return digits;
  if (digits.length === 9) return `351${digits}`;
  return digits;
}

export function buildWhatsAppTemplatePayload({
  to,
  templateName = DEFAULT_TEMPLATE_NAME,
  languageCode = DEFAULT_LANGUAGE_CODE,
  components,
} = {}) {
  const payload = {
    messaging_product: 'whatsapp',
    to: normalizeWhatsAppRecipient(to),
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
    },
  };

  if (Array.isArray(components) && components.length > 0) {
    payload.template.components = components;
  }

  return payload;
}

export function whatsappConfigFromEnv(env = process.env) {
  return {
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    graphVersion: env.WHATSAPP_GRAPH_VERSION || DEFAULT_GRAPH_VERSION,
  };
}

export function validateWhatsAppConfig(config = {}) {
  const missing = [];
  if (!config.accessToken) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (!config.phoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  return missing.length ? { ok: false, missing } : { ok: true };
}

function whatsappMessagesUrl(config) {
  const graphVersion = config.graphVersion || DEFAULT_GRAPH_VERSION;
  return `https://graph.facebook.com/${graphVersion}/${config.phoneNumberId}/messages`;
}

function createPublicError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

async function readMetaResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function sendWhatsAppTemplateMessage({
  config = whatsappConfigFromEnv(),
  message,
  fetchImpl = globalThis.fetch,
} = {}) {
  const configState = validateWhatsAppConfig(config);
  if (!configState.ok) {
    throw createPublicError(503, `Configuração WhatsApp incompleta: ${configState.missing.join(', ')}.`);
  }

  const payload = buildWhatsAppTemplatePayload(message);
  if (!payload.to) {
    throw createPublicError(400, 'Número WhatsApp inválido.');
  }

  const response = await fetchImpl(whatsappMessagesUrl(config), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await readMetaResponse(response);

  if (!response.ok) {
    const providerMessage = data?.error?.message || `Erro HTTP ${response.status}`;
    throw createPublicError(response.status || 502, `WhatsApp: ${providerMessage}`);
  }

  return data;
}
