-- =====================================================================
-- Operations Manager app: no completing, returning or closing trips
-- before the event has started, and no completing an unpaid booking.
-- (1 Oct 2026 run-through: BKG-110/111/116/117 were marked Completed by
-- the Ops app before their event date and/or with a balance still due;
-- equipment was marked returned and trips closed days before the event.)
-- Same rule as the web: Mark Completed needs a Confirmed, fully paid
-- booking. Blocked changes are kept silently, like the other guards, so
-- the app never errors; the row simply stays as it was.
-- =====================================================================

-- What is still owed on a booking, readable from the guards whatever the
-- caller may see (the Operations Manager cannot read payments). Kept in a
-- schema the API does not expose, so no app user can call it directly.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
create or replace function private.f_booking_outstanding(p_booking_id uuid)
returns numeric
language sql stable security definer
set search_path = public
as $$
  select coalesce((select m.outstanding from public.v_booking_money m where m.booking_id = p_booking_id), 0);
$$;
revoke all on function private.f_booking_outstanding(uuid) from public, anon;
grant execute on function private.f_booking_outstanding(uuid) to authenticated;

create or replace function public.f_guard_booking_write()
returns trigger
language plpgsql security invoker
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_manager() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.booking_status     := 'Pending';
    new.approval_fee       := 0;
    new.approved_at        := null;
    new.confirmed_at       := null;
    new.completed_at       := null;
    new.closed_at          := null;
    new.flagged_for_review := false;
    new.flag_reason        := null;
    new.flagged_at         := null;
    return new;
  end if;

  new.customer_id        := old.customer_id;
  new.booking_number     := old.booking_number;
  new.book_datetime      := old.book_datetime;
  new.approval_fee       := old.approval_fee;
  new.approved_at        := old.approved_at;
  new.confirmed_at       := old.confirmed_at;
  new.flagged_for_review := old.flagged_for_review;
  new.flag_reason        := old.flag_reason;
  new.flagged_at         := old.flagged_at;

  if public.is_operations_manager() then
    -- Closing out an event: Confirmed -> Completed, and only once the event
    -- has started and nothing is still owed (the web's Mark Completed rule).
    if new.booking_status is distinct from old.booking_status
       and not (new.booking_status = 'Completed'
                and old.booking_status = 'Confirmed'
                and old.event_datetime <= now()
                and private.f_booking_outstanding(old.booking_id) <= 0) then
      new.booking_status := old.booking_status;
      new.completed_at   := old.completed_at;
      new.closed_at      := old.closed_at;
    end if;
    new.total_amount    := old.total_amount;
    new.base_amount     := old.base_amount;
    new.delivery_fee    := old.delivery_fee;
    new.package_id      := old.package_id;
    new.booking_type    := old.booking_type;
    new.pax_count       := old.pax_count;
    new.event_datetime  := old.event_datetime;
    new.venue           := old.venue;
    new.menu_selections := old.menu_selections;
    return new;
  end if;

  if new.booking_status is distinct from old.booking_status
     and not (new.booking_status = 'Cancelled'
              and old.booking_status in ('Pending', 'Approved', 'Confirmed')) then
    new.booking_status := old.booking_status;
  end if;
  new.completed_at := old.completed_at;
  new.closed_at    := old.closed_at;

  if old.booking_status <> 'Pending' then
    new.total_amount    := old.total_amount;
    new.base_amount     := old.base_amount;
    new.delivery_fee    := old.delivery_fee;
    new.package_id      := old.package_id;
    new.booking_type    := old.booking_type;
    new.pax_count       := old.pax_count;
    new.event_datetime  := old.event_datetime;
    new.venue           := old.venue;
    new.menu_selections := old.menu_selections;
  end if;
  return new;
end;
$$;

-- Equipment returns from the app: only once the event has started, and the
-- app cannot change what was allocated.
create or replace function public.f_guard_booking_equipment_write()
returns trigger
language plpgsql security invoker
set search_path = public
as $$
declare v_event timestamptz;
begin
  if current_user not in ('authenticated', 'anon') or public.is_manager() then
    return new;
  end if;
  new.booking_id        := old.booking_id;
  new.equipment_id      := old.equipment_id;
  new.quantity          := old.quantity;
  new.assigned_at       := old.assigned_at;
  new.assignment_number := old.assignment_number;

  select b.event_datetime into v_event from public.booking b where b.booking_id = old.booking_id;
  if v_event is null or v_event > now() then
    new.returned          := old.returned;
    new.returned_at       := old.returned_at;
    new.returned_quantity := old.returned_quantity;
    new.return_checked_at := old.return_checked_at;
  end if;
  return new;
end;
$$;
drop trigger if exists a0_guard_booking_equipment_write on public.booking_equipment;
create trigger a0_guard_booking_equipment_write before update on public.booking_equipment
  for each row execute function public.f_guard_booking_equipment_write();

-- Vehicle runs from the app: a run can be closed once it has started; the
-- app cannot move a run to another vehicle, booking or time.
create or replace function public.f_guard_vehicle_assign_write()
returns trigger
language plpgsql security invoker
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_manager() then
    return new;
  end if;
  new.booking_id        := old.booking_id;
  new.vehicle_id        := old.vehicle_id;
  new.manager_id        := old.manager_id;
  new.dispatch_datetime := old.dispatch_datetime;
  new.window_start      := old.window_start;
  new.window_end        := old.window_end;
  if new.assignment_status is distinct from old.assignment_status
     and coalesce(old.window_start, old.dispatch_datetime) > now() then
    new.assignment_status := old.assignment_status;
  end if;
  return new;
end;
$$;
drop trigger if exists a0_guard_vehicle_assign_write on public.vehicle_assign;
create trigger a0_guard_vehicle_assign_write before update on public.vehicle_assign
  for each row execute function public.f_guard_vehicle_assign_write();

revoke all on function public.f_guard_booking_write()           from public, anon, authenticated;
revoke all on function public.f_guard_booking_equipment_write() from public, anon, authenticated;
revoke all on function public.f_guard_vehicle_assign_write()    from public, anon, authenticated;
