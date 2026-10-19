/*
# Gate 0 — Fix typo: chapter code 's03' should be 'S03'

1. Purpose
   Corrects a case typo in a seeded chapter code so codes stay uniform.
2. Modified Tables
   - chapters: one row code 's03' -> 'S03' (Metals and Non-metals).
3. Security
   - No policy changes.
*/

UPDATE public.chapters SET code = 'S03' WHERE code = 's03';