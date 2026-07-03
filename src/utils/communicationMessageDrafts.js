import { whatsappManualUrl } from './communicationCenter.js';

export function communicationMessageForTask(task, drafts = {}) {
  if (!task) return '';
  return drafts[task.id] ?? task.message ?? '';
}

export function withCommunicationMessageDraft(task, drafts = {}) {
  if (!task) return null;
  const message = communicationMessageForTask(task, drafts);
  return {
    ...task,
    message,
    whatsappUrl: whatsappManualUrl(task.rawPhone || task.phone, message),
  };
}
