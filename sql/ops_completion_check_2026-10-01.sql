-- ops_completion_check_2026-10-01.sql
--
-- APPLIED 1 Oct 2026 (migration ops_completion_check).
--
-- The Operations Manager cannot read `payment`, so in its app
-- v_booking_money shows every booking as still owing its full total. This
-- function gives the app the one answer it needs before showing "Complete":
-- may this booking be closed out now, and if not, why. Same rule as the web
-- (utils/completion.js) and the database guard (ops_app_completion_guards).
--
--   select public.f_completion_check('<booking_id>');
--   -> {"can_complete": false, "reason": "balance_due",
--       "message": "₱4,250 balance still due", "outstanding": 4250,
--       "event_started": true, "status": "Confirmed"}
--
-- reason: null | not_confirmed | event_not_started | balance_due
-- Callable by managers and the Operations Manager only.

create or replace function public.f_completion_check(p_booking_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  b record;
  v_owed numeric;
  v_started boolean;
  v_reason text;
  v_message text;
begin
  if not (public.is_manager() or public.is_operations_manager()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select booking_status, event_datetime into b from public.booking where booking_id = p_booking_id;
  if not found then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;

  v_owed    := greatest(private.f_booking_outstanding(p_booking_id), 0);
  v_started := b.event_datetime is not null and b.event_datetime <= now();

  if b.booking_status <> 'Confirmed' then
    v_reason  := 'not_confirmed';
    v_message := 'Only a Confirmed booking can be completed (this one is ' || b.booking_status || ').';
  elsif not v_started then
    v_reason  := 'event_not_started';
    v_message := 'The event is on ' || to_char(b.event_datetime at time zone 'Asia/Manila', 'Mon FMDD, YYYY FMHH12:MI AM') || '.';
  elsif v_owed > 0 then
    v_reason  := 'balance_due';
    v_message := '₱' || to_char(v_owed, 'FM999,999,990.00') || ' balance still due.';
  end if;

  return jsonb_build_object(
    'can_complete',  v_reason is null,
    'reason',        v_reason,
    'message',       v_message,
    'outstanding',   v_owed,
    'event_started', v_started,
    'status',        b.booking_status
  );
end;
$$;

revoke all on function public.f_completion_check(uuid) from public, anon;
grant execute on function public.f_completion_check(uuid) to authenticated;
