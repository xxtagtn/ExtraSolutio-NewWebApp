import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assignmentDraftsFromRows,
  normalizeAssignmentDrafts,
} from './serviceAssignmentDrafts.js';

test('extracts empty collaborator rows as event assignment drafts', () => {
  const drafts = assignmentDraftsFromRows([
    {
      role: 'Emp.Mesa',
      collaboratorId: '',
      assignmentDate: '2026-09-01',
      plannedCheckIn: '11:30',
      plannedCheckOut: '16:00',
      hourlyRate: '8,00',
      status: 'pending_confirmation',
      clientSynced: true,
      isDriver: true,
      validationNotes: 'Por preencher mais tarde',
    },
    { role: 'Barman', collaboratorId: '12', assignmentDate: '2026-09-01' },
    { role: '', collaboratorId: '', assignmentDate: '2026-09-02' },
  ]);

  assert.deepEqual(drafts, [
    {
      draftId: 'draft-1',
      role: 'Emp.Mesa',
      assignmentDate: '2026-09-01',
      plannedCheckIn: '11:30',
      plannedCheckOut: '16:00',
      hourlyRate: '8,00',
      status: 'pending_confirmation',
      clientSynced: true,
      isDriver: true,
      validationNotes: 'Por preencher mais tarde',
    },
  ]);
});

test('normalizes assignment drafts from stored JSON', () => {
  const stored = JSON.stringify([
    { draftId: 'slot-1', role: 'Barman', assignmentDate: '2026-09-02', plannedCheckIn: '19:00', collaboratorId: '' },
    { role: '', assignmentDate: '2026-09-02' },
  ]);

  assert.deepEqual(normalizeAssignmentDrafts(stored), [
    {
      draftId: 'slot-1',
      role: 'Barman',
      assignmentDate: '2026-09-02',
      plannedCheckIn: '19:00',
      plannedCheckOut: '',
      hourlyRate: '',
      status: 'pending_confirmation',
      clientSynced: false,
      isDriver: false,
      validationNotes: '',
    },
  ]);
});
