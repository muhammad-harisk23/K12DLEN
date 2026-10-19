/*
# Gate 0 audit fix — user_resources insert for legitimate owners

1. Purpose
   The audit found authenticated users could not insert their own resources:
   `owner_id` had no default, so an insert omitting it (as the client does)
   arrived as NULL and failed the WITH CHECK (owner_id = auth.uid()).
   Also, `is_curated` defaulted false correctly, but a user could supply
   `is_curated = true` to mint curated-looking rows; the insert policy
   already forbids that — this migration adds the missing default and
   explicitly pins curation for client inserts.

2. Modified Tables
   - `user_resources`:
     * `owner_id` now defaults to auth.uid() (owner bootstrap works from the
       client without threading user ids).
     * The INSERT policy keeps WITH CHECK (owner_id = auth.uid() AND
       is_curated = false), so curated rows remain operator-only.

3. Security
   - No broadening of access; this unblocks legitimate owner inserts only.
*/

ALTER TABLE public.user_resources
  ALTER COLUMN owner_id SET DEFAULT auth.uid();

DROP POLICY IF EXISTS "resources_insert_own" ON public.user_resources;
CREATE POLICY "resources_insert_own" ON public.user_resources
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND is_curated = false);