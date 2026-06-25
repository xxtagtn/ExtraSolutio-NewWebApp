UPDATE `Event`
SET `travelStaffHourlyRate` = CASE
  WHEN `split5050` = true
    THEN ((`travelExpenseAmount` - (COALESCE(`km`, 0) * COALESCE(`kmRate`, 0))) * 2)
      / (`durationHours` * `travelPeople`)
  ELSE (`travelExpenseAmount` - (COALESCE(`km`, 0) * COALESCE(`kmRate`, 0)))
      / (`durationHours` * `travelPeople`)
END
WHERE `travelType` = 'kilometers'
  AND COALESCE(`durationHours`, 0) > 0
  AND COALESCE(`travelPeople`, 0) > 0
  AND `travelExpenseAmount` > (COALESCE(`km`, 0) * COALESCE(`kmRate`, 0));
