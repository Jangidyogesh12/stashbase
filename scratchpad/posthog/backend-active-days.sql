-- PostgreSQL: retained original hosted AI requests by account and UTC day.
-- Run against the backend database, not the PostHog events database.
-- Prepared from stashbase-api 15d1a54; production execution is still pending.
-- All ledger statuses count: activity does not require successful billing.
-- created_at is the original request time. Settlement/reconciliation updates
-- must not create another active day. Idempotent replays remain one request.
-- Limitation: a later embedding retry/replay can reuse this row, so created_at
-- alone cannot reconstruct every actual provider-call day. The final activity
-- source also needs admission/call-attempt timestamps; never substitute updated_at.
-- These are retained records, not proof of a user's first-ever activity;
-- embedding request history can be pruned by backend maintenance.
WITH ai_requests AS (
  SELECT account_id, created_at, 'agent' AS source
  FROM app_private.agent_usage_requests
  UNION ALL
  SELECT account_id, created_at, purpose AS source
  FROM app_private.usage_requests
)
SELECT
  a.auth_subject::text AS user_id,
  (r.created_at AT TIME ZONE 'UTC')::date AS day,
  count(*) FILTER (WHERE r.source = 'agent') AS agent_requests,
  count(*) FILTER (WHERE r.source = 'index') AS index_requests,
  count(*) FILTER (WHERE r.source = 'query') AS query_requests,
  min(r.created_at) AT TIME ZONE 'UTC' AS first_requested_at_utc,
  max(r.created_at) AT TIME ZONE 'UTC' AS last_requested_at_utc
FROM ai_requests AS r
INNER JOIN app_private.accounts AS a ON a.account_id = r.account_id
GROUP BY a.auth_subject, (r.created_at AT TIME ZONE 'UTC')::date
ORDER BY day DESC, user_id;
