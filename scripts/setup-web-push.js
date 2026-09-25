import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import webPush from 'web-push';
import { pushConfig } from '../server/services/pushSubscriptions.js';

export function setupWebPush(envPath, subject) {
  if (!subject || !/^(https:\/\/|mailto:)/.test(subject) || /[\r\n"\\]/.test(subject)) throw new Error('Indica --subject https://dominio-da-app ou mailto:email-de-contacto.');
  const original = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const values = dotenv.parse(original);
  if (values.WEB_PUSH_PUBLIC_KEY || values.WEB_PUSH_PRIVATE_KEY) {
    if (!pushConfig(values)) throw new Error('Já existem chaves incompletas/inválidas. Não foram substituídas. Revê a configuração antes de continuar.');
    return 'As chaves Web Push já estão configuradas. Não foram alteradas.';
  }
  const keys = webPush.generateVAPIDKeys();
  const additions = { WEB_PUSH_SUBJECT: subject, WEB_PUSH_PUBLIC_KEY: keys.publicKey, WEB_PUSH_PRIVATE_KEY: keys.privateKey };
  if (!pushConfig(additions)) throw new Error('Contacto VAPID inválido.');
  let content = original;
  for (const [key, value] of Object.entries(additions)) {
    const line = `${key}="${value}"`;
    const regex = new RegExp(`^${key}=.*$`, 'm');
    content = regex.test(content) ? content.replace(regex, line) : `${content.trimEnd()}\n${line}\n`;
  }
  writeFileSync(envPath, content, { mode: 0o600 });
  return 'Web Push configurado no .env. Reinicia a API. As chaves privadas não foram apresentadas.';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const index = process.argv.indexOf('--subject');
    console.log(setupWebPush(resolve('.env'), index >= 0 ? process.argv[index + 1] : null));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
