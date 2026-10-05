-- Call values changed (CALL_RULES 2). call_settlements is derived: clear it and the next cron
-- run (apps/call/worker/settle.js) rebuilds it at the new values. Saves rescore themselves on load.
DELETE FROM call_settlements;
