/*
# Gate 3B: Drop the legacy single-arg practice_questions_for overload

1. Plain-English summary
The Gate 3B retry migration added a second optional parameter
(p_quiz_attempt_id uuid DEFAULT NULL) to practice_questions_for using
CREATE OR REPLACE — but OR REPLACE does not change a function's argument
signature, so Postgres kept the old practice_questions_for(text) AND added
practice_questions_for(text, uuid). RPC calls with a single named arg then
hit "Could not choose the best candidate function."

2. Changes
- DROP FUNCTION practice_questions_for(text) — the legacy overload.
- The two-arg practice_questions_for(text, uuid DEFAULT NULL) remains the
  only version. RPC calls work whether or not p_quiz_attempt_id is passed.
- No data changes. No policy changes.

3. Notes
- Idempotent: uses IF EXISTS.
*/

DROP FUNCTION IF EXISTS practice_questions_for(text);
