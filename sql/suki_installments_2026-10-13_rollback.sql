-- =====================================================================
-- suki_installments_rollback.sql
-- Undoes suki_installments.sql and puts every object back exactly as it
-- was on 2026-10-13 (definitions copied from the live database).
--
-- WARNING: this permanently removes all suki flags, installment schedules
-- and the installment change log. Payments are NOT touched.
-- Bookings that were confirmed through a plan stay Confirmed.
-- Run as ONE transaction.
-- =====================================================================

-- 1. Views (dependents first)
drop view if exists public.v_customer_totals;
drop view if exists public.v_customer_summary;
drop view if exists public.v_customer_balance;
drop view if exists public.v_booking_installments;
drop view if exists public.v_booking_money;

-- 2. New functions, triggers, tables, columns
drop trigger if exists b0_booking_plan_guard on public.booking;
drop trigger if exists b1_customer_suki on public.customer;
drop function if exists public.trg_booking_plan_guard();
drop function if exists public.trg_customer_suki();
drop function if exists public.f_set_customer_suki(uuid, boolean, text);
drop function if exists public.f_save_installment_plan(uuid, jsonb, text);
drop function if exists public.f_end_installment_plan(uuid, text);
drop function if exists private.f_check_installments(numeric, jsonb, boolean);
drop function if exists private.f_booking_net_paid(uuid);
drop function if exists private.f_current_manager_id();
drop function if exists private.f_today_manila();

do $$ begin
  alter publication supabase_realtime drop table public.booking_installment;
exception when undefined_object or undefined_table then null; end $$;
drop table if exists public.booking_installment_log;
drop table if exists public.booking_installment;

alter table public.booking  drop constraint if exists booking_payment_plan_check;
alter table public.booking  drop column if exists payment_plan;
alter table public.customer drop column if exists is_suki,
                            drop column if exists suki_since,
                            drop column if exists suki_set_by,
                            drop column if exists suki_note;

-- 3. Original views
create view public.v_booking_money with (security_invoker = on) as
 WITH l AS (
         SELECT pl.booking_id,
            sum(pl.amount_paid) FILTER (WHERE pl.counts_in_ledger AND pl.amount_paid > 0::numeric) AS verified_paid,
            abs(COALESCE(sum(pl.amount_paid) FILTER (WHERE pl.counts_in_ledger AND pl.amount_paid < 0::numeric), 0::numeric)) AS refunded,
            sum(pl.amount_paid) FILTER (WHERE pl.counts_in_ledger) AS net_paid,
            sum(pl.amount_paid) FILTER (WHERE pl.pay_status::text = 'Pending Verification'::text AND pl.amount_paid > 0::numeric) AS awaiting_verification,
            count(*) FILTER (WHERE pl.counts_in_ledger AND pl.amount_paid > 0::numeric) AS payment_count,
            count(*) FILTER (WHERE pl.pay_status::text = 'Pending Verification'::text) AS awaiting_count,
            max(pl.pay_datetime) FILTER (WHERE pl.counts_in_ledger) AS last_payment_at
           FROM v_payment_ledger pl
          GROUP BY pl.booking_id
        )
 SELECT b.booking_id,
    b.booking_number,
    b.booking_type,
    b.booking_status,
    b.customer_id,
    b.package_id,
    b.event_datetime,
    b.book_datetime,
    b.venue,
    b.pax_count,
    b.total_amount,
    COALESCE(b.delivery_fee, 0::numeric) AS delivery_fee,
    COALESCE(b.base_amount, b.total_amount) AS base_amount,
    b.approval_fee,
    COALESCE(l.verified_paid, 0::numeric) AS verified_paid,
    COALESCE(l.refunded, 0::numeric) AS refunded,
    COALESCE(l.net_paid, 0::numeric) AS net_paid,
    COALESCE(l.awaiting_verification, 0::numeric) AS awaiting_verification,
    COALESCE(l.payment_count, 0::bigint) AS payment_count,
    COALESCE(l.awaiting_count, 0::bigint) AS awaiting_count,
    l.last_payment_at,
    GREATEST(b.total_amount - COALESCE(l.net_paid, 0::numeric), 0::numeric) AS outstanding,
    (b.total_amount - COALESCE(l.net_paid, 0::numeric)) < 0::numeric AS is_overpaid,
    COALESCE(l.net_paid, 0::numeric) >= b.total_amount AS is_fully_paid,
        CASE
            WHEN b.total_amount > 0::numeric THEN COALESCE(l.net_paid, 0::numeric) >= (b.total_amount * 0.5)
            ELSE true
        END AS meets_confirm_threshold,
        CASE
            WHEN b.total_amount > 0::numeric THEN round(LEAST(COALESCE(l.net_paid, 0::numeric) / b.total_amount, 1::numeric) * 100::numeric, 1)
            ELSE 0::numeric
        END AS paid_pct,
    b.booking_status::text = ANY (ARRAY['Rejected'::text, 'Cancelled'::text]) AS is_closed,
    b.booking_status::text = ANY (ARRAY['Approved'::text, 'Confirmed'::text]) AS is_active,
    b.booking_status::text = ANY (ARRAY['Confirmed'::text, 'Completed'::text]) AS counts_toward_revenue,
    b.booking_status::text = ANY (ARRAY['Approved'::text, 'Confirmed'::text, 'Completed'::text]) AS is_receivable,
    (b.booking_status::text = ANY (ARRAY['Confirmed'::text, 'Completed'::text])) AND b.event_datetime < now() AND GREATEST(b.total_amount - COALESCE(l.net_paid, 0::numeric), 0::numeric) > 0::numeric AS is_overdue,
        CASE
            WHEN (b.booking_status::text = ANY (ARRAY['Confirmed'::text, 'Completed'::text])) AND b.event_datetime < now() AND GREATEST(b.total_amount - COALESCE(l.net_paid, 0::numeric), 0::numeric) > 0::numeric THEN floor(EXTRACT(epoch FROM now() - b.event_datetime) / 86400::numeric)::integer
            ELSE 0
        END AS days_overdue,
    COALESCE(b.flagged_for_review, false) AS flagged_for_review,
    b.flag_reason,
    b.flagged_at,
    (b.booking_status::text = ANY (ARRAY['Pending'::text, 'Approved'::text])) AND b.event_datetime IS NOT NULL AND b.event_datetime < (now() - make_interval(hours => f_accept_grace_hours())) AS is_lapsed,
    (b.booking_status::text = ANY (ARRAY['Pending'::text, 'Approved'::text])) AND b.event_datetime IS NOT NULL AND b.event_datetime < now() AND b.event_datetime >= (now() - make_interval(hours => f_accept_grace_hours())) AS is_in_grace
   FROM booking b
     LEFT JOIN l ON l.booking_id = b.booking_id;

create view public.v_customer_balance with (security_invoker = on) as
 SELECT c.customer_id,
    (c.first_name::text || ' '::text) || c.last_name::text AS full_name,
    c.account_status,
    COALESCE(sum(m.total_amount) FILTER (WHERE NOT m.is_closed), 0::numeric) AS total_billed,
    COALESCE(sum(m.net_paid) FILTER (WHERE NOT m.is_closed), 0::numeric) AS total_paid,
    COALESCE(sum(m.outstanding) FILTER (WHERE NOT m.is_closed), 0::numeric) AS balance_due,
    COALESCE(sum(m.awaiting_verification), 0::numeric) AS awaiting_verification,
    COALESCE(sum(m.refunded), 0::numeric) AS total_refunded,
    count(*) FILTER (WHERE m.is_active AND m.outstanding > 0::numeric) AS unpaid_active_bookings,
    min(m.event_datetime) FILTER (WHERE m.outstanding > 0::numeric AND m.event_datetime >= now() AND NOT m.is_closed) AS next_unpaid_event_at,
    COALESCE(sum(m.outstanding) FILTER (WHERE m.counts_toward_revenue), 0::numeric) AS receivable_due,
    COALESCE(sum(m.outstanding) FILTER (WHERE m.booking_status::text = ANY (ARRAY['Pending'::character varying, 'Approved'::character varying]::text[])), 0::numeric) AS pipeline_due
   FROM customer c
     LEFT JOIN v_booking_money m ON m.customer_id = c.customer_id
  GROUP BY c.customer_id, c.first_name, c.last_name, c.account_status;

create view public.v_customer_summary with (security_invoker = on) as
 SELECT c.customer_id,
    c.first_name,
    c.last_name,
    (c.first_name::text || ' '::text) || c.last_name::text AS full_name,
    c.email_address,
    c.contact_no,
    c.cus_address,
    c.account_status,
    c.status_reason,
    c.status_changed_at,
    c.status_changed_by,
    c.username,
    c.user_id,
    c.source,
    c.source::text = 'Walk-in'::text AS is_walk_in,
    c.user_id IS NOT NULL AS has_login,
    c.created_at,
    c.updated_at,
    COALESCE(b.total_bookings, 0::bigint) AS total_bookings,
    COALESCE(b.package_bookings, 0::bigint) AS package_bookings,
    COALESCE(b.short_orders, 0::bigint) AS short_orders,
    COALESCE(b.pending_count, 0::bigint) AS pending_count,
    COALESCE(b.approved_count, 0::bigint) AS approved_count,
    COALESCE(b.confirmed_count, 0::bigint) AS confirmed_count,
    COALESCE(b.completed_count, 0::bigint) AS completed_count,
    COALESCE(b.rejected_count, 0::bigint) AS rejected_count,
    COALESCE(b.cancelled_count, 0::bigint) AS cancelled_count,
    COALESCE(b.active_count, 0::bigint) AS active_count,
    COALESCE(b.lifetime_gross, 0::numeric) AS lifetime_gross,
    COALESCE(b.lifetime_paid, 0::numeric) AS lifetime_paid,
    COALESCE(b.lifetime_refunded, 0::numeric) AS lifetime_refunded,
    COALESCE(b.lifetime_outstanding, 0::numeric) AS lifetime_outstanding,
    b.first_booking_at,
    b.last_booking_at,
    b.next_event_at,
    b.last_event_at,
    COALESCE(b.total_bookings, 0::bigint) >= 2 AS is_repeat,
    COALESCE(b.active_count, 0::bigint) > 0 AS has_active_bookings,
    COALESCE(b.lifetime_outstanding, 0::numeric) > 0::numeric AS has_outstanding_balance,
    COALESCE(b.total_bookings, 0::bigint) = 0 AS is_deletable,
    COALESCE(b.receivable_due, 0::numeric) AS receivable_due,
    COALESCE(b.pipeline_due, 0::numeric) AS pipeline_due,
    COALESCE(b.receivable_due, 0::numeric) > 0::numeric AS has_receivable_due,
    COALESCE(b.contracted_gross, 0::numeric) AS contracted_gross,
    COALESCE(b.contracted_paid, 0::numeric) AS contracted_paid
   FROM customer c
     LEFT JOIN ( SELECT m.customer_id,
            count(*) AS total_bookings,
            count(*) FILTER (WHERE m.booking_type::text = 'Package'::text) AS package_bookings,
            count(*) FILTER (WHERE m.booking_type::text = 'Short Order'::text) AS short_orders,
            count(*) FILTER (WHERE m.booking_status::text = 'Pending'::text) AS pending_count,
            count(*) FILTER (WHERE m.booking_status::text = 'Approved'::text) AS approved_count,
            count(*) FILTER (WHERE m.booking_status::text = 'Confirmed'::text) AS confirmed_count,
            count(*) FILTER (WHERE m.booking_status::text = 'Completed'::text) AS completed_count,
            count(*) FILTER (WHERE m.booking_status::text = 'Rejected'::text) AS rejected_count,
            count(*) FILTER (WHERE m.booking_status::text = 'Cancelled'::text) AS cancelled_count,
            count(*) FILTER (WHERE m.is_active) AS active_count,
            sum(m.total_amount) FILTER (WHERE NOT m.is_closed) AS lifetime_gross,
            sum(m.net_paid) FILTER (WHERE NOT m.is_closed) AS lifetime_paid,
            sum(m.refunded) AS lifetime_refunded,
            sum(m.outstanding) FILTER (WHERE NOT m.is_closed) AS lifetime_outstanding,
            sum(m.outstanding) FILTER (WHERE m.counts_toward_revenue) AS receivable_due,
            sum(m.outstanding) FILTER (WHERE m.booking_status::text = ANY (ARRAY['Pending'::text, 'Approved'::text])) AS pipeline_due,
            sum(m.total_amount) FILTER (WHERE m.counts_toward_revenue) AS contracted_gross,
            sum(m.net_paid) FILTER (WHERE m.counts_toward_revenue) AS contracted_paid,
            min(m.book_datetime) AS first_booking_at,
            max(m.book_datetime) AS last_booking_at,
            min(m.event_datetime) FILTER (WHERE m.event_datetime >= now() AND NOT m.is_closed) AS next_event_at,
            max(m.event_datetime) FILTER (WHERE m.event_datetime < now() AND NOT m.is_closed) AS last_event_at
           FROM v_booking_money m
          GROUP BY m.customer_id) b ON b.customer_id = c.customer_id;

create view public.v_customer_totals with (security_invoker = on) as
 SELECT count(*)::integer AS total_customers,
    count(*) FILTER (WHERE source::text = 'Mobile'::text)::integer AS mobile_customers,
    count(*) FILTER (WHERE source::text = 'Walk-in'::text)::integer AS walk_in_customers,
    count(*) FILTER (WHERE source::text = 'Unknown'::text)::integer AS unknown_source_customers,
    count(*) FILTER (WHERE has_outstanding_balance)::integer AS with_balance,
    COALESCE(sum(lifetime_outstanding), 0::numeric) AS total_outstanding,
    count(*) FILTER (WHERE is_repeat)::integer AS repeat_customers,
        CASE
            WHEN count(*) > 0 THEN round(count(*) FILTER (WHERE is_repeat)::numeric / count(*)::numeric * 100::numeric, 1)
            ELSE 0::numeric
        END AS repeat_pct,
    count(*) FILTER (WHERE date_trunc('month'::text, (created_at AT TIME ZONE 'Asia/Manila'::text)) = date_trunc('month'::text, (now() AT TIME ZONE 'Asia/Manila'::text)))::integer AS new_this_month,
    count(*) FILTER (WHERE account_status::text = 'Active'::text)::integer AS active_accounts,
    count(*) FILTER (WHERE account_status::text = 'Inactive'::text)::integer AS inactive_accounts,
    count(*) FILTER (WHERE account_status::text = 'Blocked'::text)::integer AS blocked_accounts,
    COALESCE(sum(lifetime_gross), 0::numeric) AS total_lifetime_gross,
    count(*) FILTER (WHERE has_receivable_due)::integer AS with_receivable,
    COALESCE(sum(receivable_due), 0::numeric) AS total_receivable,
    COALESCE(sum(pipeline_due), 0::numeric) AS total_pipeline,
    COALESCE(sum(contracted_gross), 0::numeric) AS total_contracted_gross,
    COALESCE(sum(contracted_paid), 0::numeric) AS total_contracted_paid
   FROM v_customer_summary s;

-- Grants as they were (anon never had SELECT on v_customer_balance)
grant all on public.v_booking_money, public.v_customer_balance, public.v_customer_summary, public.v_customer_totals
  to anon, authenticated, service_role;
revoke select on public.v_customer_balance from anon;

-- 4. Original functions
create or replace function public.f_maybe_unconfirm_booking(p_booking_id uuid)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare
  v_total numeric; v_status text; v_event timestamptz; v_net numeric;
begin
  if p_booking_id is null then return; end if;
  select b.total_amount, b.booking_status, b.event_datetime
    into v_total, v_status, v_event
  from public.booking b where b.booking_id = p_booking_id for update;
  if v_status is distinct from 'Confirmed' then return; end if;
  if v_event is null or v_event <= now() then return; end if;
  if v_total is null or v_total <= 0 then return; end if;
  select coalesce(sum(l.amount_paid) filter (where l.counts_in_ledger), 0)
    into v_net
  from public.v_payment_ledger l where l.booking_id = p_booking_id;
  if v_net < (v_total * 0.5) then
    perform set_config('app.status_source', 'Auto-revert (reversal below 50% threshold)', true);
    perform set_config('app.status_reason', 'Receipts fell below 50% after a reversal', true);
    update public.booking
       set booking_status     = 'Approved',
           confirmed_at       = null,
           flagged_for_review = true,
           flagged_at         = now(),
           flag_reason        = 'Payment reversed. Assignments kept.'
     where booking_id = p_booking_id and booking_status = 'Confirmed';
    perform set_config('app.status_source', '', true);
    perform set_config('app.status_reason', '', true);
  end if;
end;
$function$;

create or replace function public.f_override_booking_status(p_booking_id uuid, p_new_status character varying, p_reason text)
 returns booking language plpgsql security definer set search_path to ''
as $function$
declare v_row public.booking;
begin
  if auth.uid() is null or auth.uid() not in (select m.user_id from public.manager m) then
    raise exception 'Managers only.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required.';
  end if;
  if p_new_status not in ('Pending','Approved','Confirmed','Completed','Rejected','Cancelled') then
    raise exception 'Invalid status: %', p_new_status;
  end if;
  perform set_config('app.status_source', 'Manager override', true);
  perform set_config('app.status_reason', p_reason, true);
  update public.booking
     set booking_status     = p_new_status,
         confirmed_at       = case when p_new_status = 'Confirmed' then coalesce(confirmed_at, now())
                                   when p_new_status in ('Pending','Approved') then null
                                   else confirmed_at end,
         flagged_for_review = false,
         flag_reason        = null,
         flagged_at         = null
   where booking_id = p_booking_id
   returning * into v_row;
  perform set_config('app.status_source', '', true);
  perform set_config('app.status_reason', '', true);
  if v_row.booking_id is null then
    raise exception 'Booking not found.';
  end if;
  return v_row;
end;
$function$;

create or replace function public.f_guard_booking_write()
 returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  if current_user not in ('authenticated', 'anon') or public.is_manager() then return new; end if;
  if tg_op = 'INSERT' then
    new.booking_status := 'Pending'; new.approval_fee := 0; new.approved_at := null; new.confirmed_at := null;
    new.completed_at := null; new.closed_at := null; new.flagged_for_review := false; new.flag_reason := null; new.flagged_at := null;
    return new;
  end if;
  new.customer_id := old.customer_id; new.booking_number := old.booking_number; new.book_datetime := old.book_datetime;
  new.approval_fee := old.approval_fee; new.approved_at := old.approved_at; new.confirmed_at := old.confirmed_at;
  new.flagged_for_review := old.flagged_for_review; new.flag_reason := old.flag_reason; new.flagged_at := old.flagged_at;
  if public.is_operations_manager() then
    -- Confirmed -> Completed only once the event has started and nothing is owed.
    if new.booking_status is distinct from old.booking_status
       and not (new.booking_status = 'Completed' and old.booking_status = 'Confirmed'
                and old.event_datetime <= now() and private.f_booking_outstanding(old.booking_id) <= 0) then
      new.booking_status := old.booking_status; new.completed_at := old.completed_at; new.closed_at := old.closed_at;
    end if;
    new.total_amount := old.total_amount; new.base_amount := old.base_amount; new.delivery_fee := old.delivery_fee;
    new.package_id := old.package_id; new.booking_type := old.booking_type; new.pax_count := old.pax_count;
    new.event_datetime := old.event_datetime; new.venue := old.venue; new.menu_selections := old.menu_selections;
    return new;
  end if;
  if new.booking_status is distinct from old.booking_status
     and not (new.booking_status = 'Cancelled' and old.booking_status in ('Pending', 'Approved', 'Confirmed')) then
    new.booking_status := old.booking_status;
  end if;
  new.completed_at := old.completed_at; new.closed_at := old.closed_at;
  if old.booking_status <> 'Pending' then
    new.total_amount := old.total_amount; new.base_amount := old.base_amount; new.delivery_fee := old.delivery_fee;
    new.package_id := old.package_id; new.booking_type := old.booking_type; new.pax_count := old.pax_count;
    new.event_datetime := old.event_datetime; new.venue := old.venue; new.menu_selections := old.menu_selections;
  end if;
  return new;
end; $function$;

create or replace function public.f_guard_customer_write()
 returns trigger language plpgsql set search_path to 'public'
as $function$
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
$function$;

create or replace function public.f_completion_check(p_booking_id uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
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
$function$;
