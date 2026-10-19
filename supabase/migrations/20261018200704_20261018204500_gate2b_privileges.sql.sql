/*
# Gate 2B — Tighten table privileges on conversation tables

1. Purpose
   The default Postgres role grants gave anon and authenticated more
   privileges than needed on the new conversation tables. This migration
   narrows them to the intended surface.

2. Changes
   - `room_messages`: anon loses all privileges (RLS already blocks every
     anon read; SELECT grant removed for defense in depth). authenticated
     keeps only SELECT (gated by RLS). INSERT/UPDATE/DELETE/TRUNCATE stay
     revoked for both. service_role keeps full access for the server-side
     persistence path. postgres keeps full access (supabase admin).
   - `room_ai_request_log`: same narrowing — anon and authenticated lose all
     privileges (RLS enabled with no policies already denies everything;
     grants removed for defense in depth). service_role keeps full access.
*/

REVOKE ALL ON public.room_messages FROM anon;
REVOKE ALL ON public.room_ai_request_log FROM anon;
REVOKE ALL ON public.room_ai_request_log FROM authenticated;