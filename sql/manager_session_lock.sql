-- Run this in the Supabase SQL Editor for the CaterSync project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run).
-- Nothing here runs automatically; the app code only *uses* these once
-- they exist. Safe to re-run except where noted.
--
-- Backs:
--  - the "single active device/tab per manager account" feature in
--    src/utils/managerSession.js and src/contexts/AuthContext.jsx
--  - Row Level Security on public.manager, restricting every manager to
--    their own row (every query in the app already only touches its own
--    row, so this doesn't break anything currently working)

-- 1. Columns that track which tab/device currently "owns" a manager's session.
alter table public.manager
  add column if not exists active_session_id uuid,
  add column if not exists active_session_started_at timestamptz;

-- 2. Realtime must be enabled on this table so an already-open tab is
--    notified the instant a different device/tab claims the session.
--    If it's already added to the publication, this line will error
--    ("relation ... is already member of publication") — that's fine,
--    just skip it and run the rest.
alter publication supabase_realtime add table public.manager;

-- 3. Row Level Security: a manager can only ever see/update their own row.
alter table public.manager enable row level security;

drop policy if exists "managers can read own row" on public.manager;
create policy "managers can read own row"
  on public.manager for select
  using (auth.uid() = user_id);

drop policy if exists "managers can update own row" on public.manager;
create policy "managers can update own row"
  on public.manager for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
