-- Desktop weekly active people (core use, UTC weeks starting Monday)
SELECT
  toStartOfWeek(toDate(toTimeZone(timestamp, 'UTC')), 1) AS week,
  count(DISTINCT person_id) AS active_people,
  if(week = toStartOfWeek(toDate(toTimeZone(now(), 'UTC')), 1),
     'in progress', NULL) AS status
FROM events
WHERE event IN ('document_engaged', 'agent_turn_started')
  AND toInt(properties.schema_version) >= 3
  AND timestamp >= now() - INTERVAL 26 WEEK
GROUP BY week
ORDER BY week DESC
