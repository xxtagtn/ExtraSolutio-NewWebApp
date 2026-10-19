import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for (const timeZone of ['Europe/Lisbon', 'Atlantic/Azores', 'UTC', 'America/New_York', 'Asia/Tokyo']) {
  test(`service days include both endpoints without DST drift in ${timeZone}`, () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { serviceAssignmentDays, normalizeDailyRoleRequirements, buildEditableTeamRows, roleRequirementsForDay } from ${JSON.stringify(new URL('./serviceDetail.js', import.meta.url).href)};
      for (const [start, end, count] of [
        ['2026-10-01', '2026-10-31', 31],
        ['2026-03-01', '2026-03-31', 31],
        ['2026-10-24', '2026-10-26', 3],
        ['2026-03-28', '2026-03-30', 3],
        ['2028-02-01', '2028-02-29', 29],
        ['2026-12-30', '2027-01-02', 4],
        ['2026-10-31', '2026-10-31', 1],
      ]) {
        const event = { date: start + 'T00:00:00.000Z', endDate: end + 'T00:00:00.000Z', isContinuous: true,
          requiredRoles: [{ role: 'Emp.Mesa', qty: 2, agreedRate: 12 }],
          assignments: [{ id: 1, collaboratorId: 7, assignmentDate: start, role: 'Emp.Mesa', status: 'confirmed' }],
        };
        const snapshot = structuredClone(event);
        const days = serviceAssignmentDays(event);
        assert.equal(days.length, count, start);
        assert.equal(days[0], start);
        assert.equal(days.at(-1), end);
        assert.equal(new Set(days).size, count);
        for (let index = 1; index < days.length; index++) {
          assert.equal(Date.parse(days[index]) - Date.parse(days[index - 1]), 86400000);
        }
        assert.equal(normalizeDailyRoleRequirements(event).length, count);
        assert.equal(roleRequirementsForDay(event, end)[0].qty, 2);
        const rows = buildEditableTeamRows(event);
        assert.equal(rows.filter(row => row.assignmentDate === end).length, 2);
        assert.ok(rows.some(row => row.id === 1 && row.collaboratorId === '7'));
        assert.deepEqual(event, snapshot);
      }
      assert.deepEqual(serviceAssignmentDays({ date: '2026-10-01', endDate: '2026-10-02',
        assignments: [{ assignmentDate: '2026-10-03' }] }), ['2026-10-01', '2026-10-02', '2026-10-03']);
      assert.deepEqual(serviceAssignmentDays({ date: '2026-10-31', endDate: '2026-10-01' }), ['2026-10-31']);
      assert.deepEqual(serviceAssignmentDays({}), []);
    `], { env: { ...process.env, TZ: timeZone }, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}
