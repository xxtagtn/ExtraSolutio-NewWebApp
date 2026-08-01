import XLSXModule from 'xlsx-js-style';
import { createEventAttendanceWorkbook } from '../../src/utils/eventAttendanceExcel.js';

const XLSX = XLSXModule.default || XLSXModule;
const { workbook } = createEventAttendanceWorkbook({
  XLSX,
  event: {
    name: 'Jantar Institucional',
    client: { name: 'SSH - Supreme Sport Hospitality' },
    serviceReference: 'Lounge Premium',
    location: 'Estádio da Luz, Lisboa',
    isContinuous: true,
  },
  selectedDay: '2026-08-01',
  assignments: [
    {
      id: 1,
      collaboratorId: 1,
      assignmentDate: '2026-08-01',
      role: 'Emp.Mesa',
      workLocationId: 1,
      plannedCheckIn: '17:00',
      plannedCheckOut: '01:00',
    },
    {
      id: 2,
      collaboratorId: 2,
      assignmentDate: '2026-08-01',
      role: 'Emp.Mesa',
      workLocationId: 1,
      plannedCheckIn: '17:00',
      plannedCheckOut: '01:00',
    },
    {
      id: 3,
      collaboratorId: 3,
      assignmentDate: '2026-08-01',
      role: 'Barman',
      workLocationId: 2,
      plannedCheckIn: '16:00',
      plannedCheckOut: '00:00',
    },
  ],
  collaborators: [
    { id: 1, name: 'Ana Sofia Correia', nif: '123456789' },
    { id: 2, name: 'Bruno Miguel Santos', nif: '234567890' },
    { id: 3, name: 'Carla Alexandra Silva', nif: '345678901' },
  ],
  workLocations: [
    { id: 1, name: 'Lounge A' },
    { id: 2, name: 'Bar VIP' },
  ],
});

XLSX.writeFile(
  workbook,
  '.codex-tmp/attendance-reference/output/generated-attendance.xlsx',
  { compression: true, cellStyles: true },
);
