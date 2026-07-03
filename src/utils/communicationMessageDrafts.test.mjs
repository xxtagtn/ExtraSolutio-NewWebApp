import test from 'node:test';
import assert from 'node:assert/strict';
import { communicationMessageForTask, withCommunicationMessageDraft } from './communicationMessageDrafts.js';

test('uses the generated message when no draft exists', () => {
  const task = { id: 'confirmation-1', message: 'Mensagem original' };

  assert.equal(communicationMessageForTask(task, {}), 'Mensagem original');
});

test('uses the edited draft when it exists', () => {
  const task = { id: 'confirmation-1', message: 'Mensagem original' };
  const drafts = { 'confirmation-1': 'Mensagem alterada' };

  assert.equal(communicationMessageForTask(task, drafts), 'Mensagem alterada');
});

test('updates the WhatsApp link with the edited draft', () => {
  const task = {
    id: 'confirmation-1',
    message: 'Mensagem original',
    rawPhone: '963 680 415',
  };
  const drafts = { 'confirmation-1': 'Mensagem alterada' };

  const taskWithDraft = withCommunicationMessageDraft(task, drafts);

  assert.equal(taskWithDraft.message, 'Mensagem alterada');
  assert.match(taskWithDraft.whatsappUrl, /351963680415/);
  assert.match(taskWithDraft.whatsappUrl, /Mensagem%20alterada/);
});
