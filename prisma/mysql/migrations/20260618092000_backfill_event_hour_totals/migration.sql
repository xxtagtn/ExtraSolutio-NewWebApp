UPDATE `Event` AS event_row
SET
  `realHours` = COALESCE((
    SELECT SUM(assignment_row.`clientRealHours`)
    FROM `EventAssignment` AS assignment_row
    WHERE assignment_row.`eventId` = event_row.`id`
      AND LOWER(COALESCE(assignment_row.`status`, '')) NOT IN ('missed_justified', 'missed_unjustified', 'cancelled')
  ), event_row.`realHours`, 0),
  `billableHours` = COALESCE((
    SELECT SUM(assignment_row.`clientBillableHours`)
    FROM `EventAssignment` AS assignment_row
    WHERE assignment_row.`eventId` = event_row.`id`
      AND LOWER(COALESCE(assignment_row.`status`, '')) NOT IN ('missed_justified', 'missed_unjustified', 'cancelled')
  ), event_row.`billableHours`, 0);
