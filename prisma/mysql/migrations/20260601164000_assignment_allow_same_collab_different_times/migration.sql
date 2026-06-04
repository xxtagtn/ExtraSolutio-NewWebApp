ALTER TABLE `EventAssignment`
  DROP INDEX `EventAssignment_eventId_collaboratorId_role_key`;

CREATE INDEX `EventAssignment_eventId_collaboratorId_role_idx`
  ON `EventAssignment`(`eventId`, `collaboratorId`, `role`);
