-- Desktop core-use return by weekly entry cohort (UTC, Monday start)
WITH
core_days AS (
  SELECT person_id, toDate(toTimeZone(timestamp, 'UTC')) AS day
  FROM events
  WHERE event IN ('document_engaged', 'agent_turn_started')
    AND toInt(properties.schema_version) >= 3
  GROUP BY person_id, day
),
entries AS (
  SELECT person_id, min(day) AS entry_day
  FROM core_days
  GROUP BY person_id
),
people AS (
  SELECT
    toStartOfWeek(e.entry_day, 1) AS cohort_week,
    countIf(dateDiff('day', e.entry_day, c.day) >= 1
        AND dateDiff('day', e.entry_day, c.day) <= 7) > 0 AS returned_7d,
    countIf(dateDiff('day', e.entry_day, c.day) >= 30
        AND dateDiff('day', e.entry_day, c.day) <= 59) > 0 AS returned_next_month
  FROM entries AS e
  INNER JOIN core_days AS c ON c.person_id = e.person_id
  GROUP BY e.person_id, e.entry_day
),
cohorts AS (
  SELECT
    cohort_week,
    count() AS new_people,
    round(100 * countIf(returned_7d) / count(), 1) AS pct_7d,
    round(100 * countIf(returned_next_month) / count(), 1) AS pct_next_month,
    dateDiff('day', cohort_week, toDate(toTimeZone(now(), 'UTC'))) AS age
  FROM people
  GROUP BY cohort_week
)
SELECT
  cohort_week,
  new_people,
  multiIf(age < 1, NULL,
          age < 14, concat(toString(pct_7d), '% (in progress)'),
          concat(toString(pct_7d), '%')) AS return_7d,
  multiIf(age < 30, NULL,
          age < 66, concat(toString(pct_next_month), '% (in progress)'),
          concat(toString(pct_next_month), '%')) AS return_next_month
FROM cohorts
ORDER BY cohort_week DESC
LIMIT 26
