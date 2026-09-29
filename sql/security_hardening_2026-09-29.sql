-- =====================================================================
-- CaterSync security hardening — 29 September 2026
--
-- Closes the holes found in the pre-handover security review without
-- changing what the mobile apps do. Every rule below was checked against
-- the requests the customer, Operations Manager and Main Cook apps
-- actually made on the 27 September testing day (API logs).
--
-- Guiding rule: writes made by the apps run as the database roles
-- `authenticated` / `anon`. Writes made inside the system's own
-- SECURITY DEFINER functions and triggers (auto-confirm, status log,
-- sync_current_customer, ...) run as the function owner, so the guards
-- below leave them alone. Managers are never restricted.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Helper: is the caller a manager?
--    SECURITY DEFINER so it works for customers, who cannot read `manager`.
-- ---------------------------------------------------------------------
create or replace function public.is_manager()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.manager m where m.user_id = auth.uid());
$$;
revoke all on function public.is_manager() from public, anon;
grant execute on function public.is_manager() to authenticated;


-- ---------------------------------------------------------------------
-- 2. CRITICAL — any signed-in user could insert themselves into `manager`
--    ("Manager own record" was FOR ALL with check auth.uid() = user_id).
--    The web app only ever reads and updates its own row; both remain
--    covered by the existing SELECT and UPDATE policies.
-- ---------------------------------------------------------------------
drop policy if exists "Manager own record" on public.manager;


-- ---------------------------------------------------------------------
-- 3. Remove the old "anyone, even signed out" insert policies.
--    Policies are OR-ed, so these overrode the strict "own records" ones.
--    Every mobile insert on 27 Sep was made signed in and is still covered
--    by: "Customers can create their own bookings / payments / profile".
-- ---------------------------------------------------------------------
drop policy if exists "Customers can submit pending bookings" on public.booking;
drop policy if exists "Customers can create customer records" on public.customer;
drop policy if exists "Customers can submit payment proof"    on public.payment;


-- ---------------------------------------------------------------------
-- 4. Booking guard — what a customer or the Operations Manager may change.
--    Protected fields are silently kept, never rejected, so an app that
--    sends a whole record back still saves the fields it is allowed to.
-- ---------------------------------------------------------------------
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
    -- A new booking from the app is always a request for the manager to review.
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

  -- Never changeable from an app
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
    -- Operations Manager app: closes out an event (Approved/Confirmed -> Completed).
    if new.booking_status is distinct from old.booking_status
       and not (new.booking_status = 'Completed'
                and old.booking_status in ('Approved', 'Confirmed')) then
      new.booking_status := old.booking_status;
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

  -- Customer app (RLS already limits this to the customer's own bookings).
  -- The only status change a customer makes is cancelling their booking.
  if new.booking_status is distinct from old.booking_status
     and not (new.booking_status = 'Cancelled'
              and old.booking_status in ('Pending', 'Approved', 'Confirmed')) then
    new.booking_status := old.booking_status;
  end if;
  new.completed_at := old.completed_at;
  new.closed_at    := old.closed_at;

  -- Once the manager has accepted a booking, its price and event details
  -- are the manager's to change.
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

-- "a0_" so it runs before the existing BEFORE triggers (they fire alphabetically)
drop trigger if exists a0_guard_booking_write on public.booking;
create trigger a0_guard_booking_write
  before insert or update on public.booking
  for each row execute function public.f_guard_booking_write();


-- ---------------------------------------------------------------------
-- 5. Customer guard — a customer can edit their profile, not their
--    account status (e.g. un-block themselves) or who owns the record.
-- ---------------------------------------------------------------------
create or replace function public.f_guard_customer_write()
returns trigger
language plpgsql security invoker
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_manager() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.account_status    := 'Active';
    new.status_reason     := null;
    new.status_changed_at := null;
    new.status_changed_by := null;
    return new;
  end if;

  new.account_status    := old.account_status;
  new.status_reason     := old.status_reason;
  new.status_changed_at := old.status_changed_at;
  new.status_changed_by := old.status_changed_by;
  new.source            := old.source;
  new.user_id           := old.user_id;
  new.created_at        := old.created_at;
  return new;
end;
$$;

drop trigger if exists a0_guard_customer_write on public.customer;
create trigger a0_guard_customer_write
  before insert or update on public.customer
  for each row execute function public.f_guard_customer_write();


-- ---------------------------------------------------------------------
-- 6. Payment guard — a customer's payment is always a claim waiting for
--    the manager to verify, and only against their own booking.
--    (Before this, a customer could insert a payment already marked
--    'Fully Settled', which would auto-confirm the booking.)
-- ---------------------------------------------------------------------
create or replace function public.f_guard_payment_insert()
returns trigger
language plpgsql security invoker
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_manager() then
    return new;
  end if;

  if new.amount_paid is null or new.amount_paid <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;

  if new.booking_id is not null and not exists (
       select 1 from public.booking b
        where b.booking_id = new.booking_id
          and b.customer_id = new.customer_id) then
    raise exception 'This booking does not belong to your account.';
  end if;

  new.pay_status          := 'Pending Verification';
  new.entry_type          := 'Receipt';
  new.verified_at         := null;
  new.verified_by         := null;
  new.reverses_payment_id := null;
  new.reversal_reason     := null;
  return new;
end;
$$;

drop trigger if exists a0_guard_payment_insert on public.payment;
create trigger a0_guard_payment_insert
  before insert on public.payment
  for each row execute function public.f_guard_payment_insert();

revoke all on function public.f_guard_booking_write()  from public, anon, authenticated;
revoke all on function public.f_guard_customer_write() from public, anon, authenticated;
revoke all on function public.f_guard_payment_insert() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 7. File storage.
--    Before: one policy let ANYONE, signed out, upload, overwrite, list or
--    delete every file in `images` — including customers' payment proofs.
--    After:
--      * managers manage everything in `images`
--      * signed-in app users may upload into payments/ only (that is the
--        only folder the mobile app writes to)
--      * payment and refund proofs cannot be listed or downloaded through
--        the API except by a manager or the person who uploaded them
--      * menu / package / QR images stay readable
--    The bucket stays public so every existing image link keeps working.
-- ---------------------------------------------------------------------
drop policy if exists "Public Access"               on storage.objects;
drop policy if exists "Allow authenticated uploads" on storage.objects;

create policy "images: managers manage all files"
  on storage.objects for all to authenticated
  using      (bucket_id = 'images' and public.is_manager())
  with check (bucket_id = 'images' and public.is_manager());

create policy "images: app users upload payment proofs"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'images' and (storage.foldername(name))[1] = 'payments');

create policy "images: uploaders read their own files"
  on storage.objects for select to authenticated
  using (bucket_id = 'images' and owner_id = (select auth.uid())::text);

create policy "images: catalogue images are readable"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'images'
         and coalesce((storage.foldername(name))[1], '') not in ('payments', 'refunds'));

-- Only real images / PDFs, and a size cap. Largest file stored today: 5.1 MB.
update storage.buckets
   set file_size_limit    = 10485760,  -- 10 MB
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif',
                                  'image/heic','image/heif','application/pdf']
 where id = 'images';

update storage.buckets
   set file_size_limit    = 5242880,   -- 5 MB
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif',
                                  'image/heic','image/heif']
 where id = 'avatars';


-- ---------------------------------------------------------------------
-- 8. Database functions callable through the API.
-- ---------------------------------------------------------------------
-- Trigger-only functions: nobody needs to call these directly.
revoke all on function public.trg_booking_total_confirm()     from public, anon, authenticated;
revoke all on function public.trg_log_booking_status()        from public, anon, authenticated;
revoke all on function public.trg_payment_confirm_booking()   from public, anon, authenticated;
revoke all on function public.log_booking_equipment_change()  from public, anon, authenticated;

-- Called only from the payment trigger above (which runs as the owner).
revoke all on function public.f_maybe_confirm_booking(uuid)   from public, anon, authenticated;
revoke all on function public.f_maybe_unconfirm_booking(uuid) from public, anon, authenticated;

-- Used by the apps once signed in: keep for signed-in users, remove for the public.
revoke all on function public.f_override_booking_status(uuid, character varying, text) from public, anon;
grant execute on function public.f_override_booking_status(uuid, character varying, text) to authenticated;

revoke all on function public.replace_menu_ingredients(uuid, integer, jsonb) from public, anon;
grant execute on function public.replace_menu_ingredients(uuid, integer, jsonb) to authenticated;

revoke all on function public.is_main_cook()                from public, anon;
revoke all on function public.is_operations_manager()       from public, anon;
revoke all on function public.can_manage_menu_ingredients() from public, anon;
grant execute on function public.is_main_cook()                to authenticated;
grant execute on function public.is_operations_manager()       to authenticated;
grant execute on function public.can_manage_menu_ingredients() to authenticated;


-- ---------------------------------------------------------------------
-- 9. Move btree_gist out of the public API schema (advisor warning).
--    The vehicle no-overlap constraint keeps working; it references the
--    operator class by id, not by schema.
-- ---------------------------------------------------------------------
create schema if not exists extensions;
alter extension btree_gist set schema extensions;
