import test from 'node:test';
import assert from 'node:assert/strict';
import { groupQrRowsByCollaboratorDay } from './communicationQrGroups.js';

test('group by collaborator ID and service day, retaining all individual punch data', () => {
  const rows = [
    { assignmentId: 1, collaboratorId: 9, collaboratorName: 'Ana', assignmentDate: '2026-09-25', checkIn: '07:02', checkOut: '15:00' },
    { assignmentId: 2, collaboratorId: 10, collaboratorName: 'Ana', assignmentDate: '2026-09-25' },
    { assignmentId: 3, collaboratorId: '9', collaboratorName: 'Ana', assignmentDate: '2026-09-25T00:00:00.000Z', checkIn: '16:00', checkOut: null },
    { assignmentId: 4, collaboratorId: 9, collaboratorName: 'Ana', assignmentDate: new Date('2026-09-26') },
    { assignmentId: 5, collaboratorId: 9, startTime: '23:00', endTime: '02:00' },
  ];
  const before = structuredClone(rows);
  const grouped = groupQrRowsByCollaboratorDay(rows, '2026-09-25');
  assert.deepEqual(grouped.map((group) => group.rows.map((row) => row.assignmentId)), [[1, 3, 5], [2], [4]]);
  assert.equal(grouped[0].rows[0], rows[0]);
  assert.equal(grouped[0].rows[1].checkOut, null);
  assert.deepEqual(rows, before);
});

test('missing collaborator IDs or service days never merge unrelated assignments', () => {
  const rows = [{ assignmentId: 1 }, { assignmentId: 2 }, { assignmentId: 3, collaboratorId: 1 }, { assignmentId: 4, collaboratorId: 1 }];
  assert.equal(groupQrRowsByCollaboratorDay(rows).length, 4);
  assert.deepEqual(groupQrRowsByCollaboratorDay([]), []);
});
