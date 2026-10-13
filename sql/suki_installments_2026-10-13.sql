-- =====================================================================
-- suki_installments_2026-10-13.sql
-- Suki (loyal) customers and installment payment plans.
--
-- Additive and safe to apply on the live database:
--   * every new column has a default, so existing rows read as before
--     (is_suki = false, payment_plan = 'Standard');
--   * no existing booking changes status, amount or overdue state;
--   * v_booking_money / v_customer_balance / v_customer_summary keep every
--     existing column, in the same order, with new columns APPENDED;
--   * installment rows can only be written through the RPCs below, which
--     validate everything; there is no direct INSERT/UPDATE/DELETE grant.
--
-- Apply as ONE migration. Dry run first: suki_installments_2026-10-13_dryrun.sql. Rollback: suki_installments_2026-10-13_rollback.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------
create schema if not exists private;

-- "Today" for due dates is the business's calendar day, not UTC.
create or replace function private.f_today_manila()
returns date language sql stable set search_path = ''
as $$ select (now() at time zone 'Asia/Manila')::date $$;

-- The manager row of whoever is calling, or null.
create or replace function private.f_current_manager_id()
returns uuid language sql stable security definer set search_path = ''
as $$ select m.manager_id from public.manager m where m.user_id = auth.uid() limit 1 $$;

-- Verified money in, net of refunds (same rule as v_booking_money.net_paid).
create or replace function private.f_booking_net_paid(p_booking_id uuid)
returns numeric language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(l.amount_paid) filter (where l.counts_in_ledger), 0)
  from public.v_payment_ledger l where l.booking_id = p_booking_id
$$;

revoke all on function private.f_current_manager_id()    from public;
revoke all on function private.f_booking_net_paid(uuid)  from public;
-- f_today_manila stays executable by everyone (it only returns a date): the
-- security_invoker views call it, and anon/service_role read those views too.
grant execute on function private.f_today_manila()         to anon, authenticated, service_role;
grant execute on function private.f_current_manager_id()   to authenticated;
grant execute on function private.f_booking_net_paid(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------
alter table public.customer
  add column if not exists is_suki     boolean not null default false,
  add column if not exists suki_since  timestamptz,
  add column if not exists suki_set_by uuid references public.manager(manager_id) on delete set null,
  add column if not exists suki_note   text;

alter table public.booking
  add column if not exists payment_plan varchar(12) not null default 'Standard';
alter table public.booking drop constraint if exists booking_payment_plan_check;
alter table public.booking add constraint booking_payment_plan_check
  check (payment_plan in ('Standard', 'Installment'));

-- ---------------------------------------------------------------------
-- 2. Installment schedule + its change log
-- ---------------------------------------------------------------------
create table if not exists public.booking_installment (
  installment_id  uuid primary key default gen_random_uuid(),
  booking_id      uuid not null references public.booking(booking_id) on delete cascade,
  installment_no  smallint not null check (installment_no between 1 and 12),
  due_date        date not null,
  amount          numeric(10,2) not null check (amount > 0),
  created_at      timestamptz not null default now(),
  created_by      uuid references public.manager(manager_id) on delete set null,
  constraint booking_installment_no_uniq  unique (booking_id, installment_no),
  constraint booking_installment_due_uniq unique (booking_id, due_date)
);
create index if not exists booking_installment_booking_idx on public.booking_installment (booking_id);

create table if not exists public.booking_installment_log (
  log_id        uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.booking(booking_id) on delete cascade,
  action        varchar(10) not null check (action in ('Created', 'Updated', 'Ended')),
  before_plan   jsonb,
  after_plan    jsonb,
  reason        text,
  changed_by    uuid references public.manager(manager_id) on delete set null,
  changed_at    timestamptz not null default now()
);
create index if not exists booking_installment_log_booking_idx on public.booking_installment_log (booking_id, changed_at);

alter table public.booking_installment     enable row level security;
alter table public.booking_installment_log enable row level security;

drop policy if exists "Manager read installments" on public.booking_installment;
create policy "Manager read installments" on public.booking_installment
  for select to authenticated using (public.is_manager());
drop policy if exists "Customer reads own installments" on public.booking_installment;
create policy "Customer reads own installments" on public.booking_installment
  for select to authenticated using (exists (
    select 1 from public.booking b join public.customer c on c.customer_id = b.customer_id
    where b.booking_id = booking_installment.booking_id and c.user_id = (select auth.uid())));
drop policy if exists "Manager read installment log" on public.booking_installment_log;
create policy "Manager read installment log" on public.booking_installment_log
  for select to authenticated using (public.is_manager());

-- Reads only. Every write goes through the SECURITY DEFINER functions in §5.
revoke all on public.booking_installment     from anon, authenticated;
revoke all on public.booking_installment_log from anon, authenticated;
-- anon keeps SELECT because v_booking_money (security_invoker, readable by
-- anon today) reads this table; RLS gives anon no rows.
grant select on public.booking_installment     to anon, authenticated;
grant select on public.booking_installment_log to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.booking_installment;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 3. Invariants (traps) that hold whoever writes
-- ---------------------------------------------------------------------

-- 3.1 A booking's payment_plan always matches its schedule.
--     * Only the plan functions (which set app.plan_write = 'on') may flip
--       payment_plan. Any other attempt is refused with a readable message.
--     * If the manager changes the TOTAL of an Installment booking (pax, menu,
--       delivery fee...), the difference is put on the LAST installment and
--       the change is written to booking_installment_log, so the schedule
--       always adds up to the total. If that would make the last installment
--       zero or negative, the change is refused and the manager is told to
--       edit the schedule first.
create or replace function public.trg_booking_plan_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_sum numeric; v_delta numeric; v_last_id uuid; v_last_amt numeric;
  v_before jsonb; v_after jsonb;
begin
  if tg_op = 'INSERT' then
    new.payment_plan := 'Standard';
    return new;
  end if;

  if coalesce(current_setting('app.plan_write', true), '') = 'on' then
    return new;   -- the plan functions validate for themselves
  end if;

  if new.payment_plan is distinct from old.payment_plan then
    raise exception 'The payment plan can only be changed from the installment plan screen.'
      using errcode = 'check_violation';
  end if;

  if new.payment_plan = 'Installment' and new.total_amount is distinct from old.total_amount then
    select coalesce(sum(i.amount), 0) into v_sum
      from public.booking_installment i where i.booking_id = new.booking_id;
    v_delta := round(coalesce(new.total_amount, 0) - v_sum, 2);
    if v_delta <> 0 then
      select i.installment_id, i.amount into v_last_id, v_last_amt
        from public.booking_installment i where i.booking_id = new.booking_id
       order by i.installment_no desc limit 1;
      if v_last_id is null or v_last_amt + v_delta <= 0 then
        raise exception 'The new total (₱%) is too small for the current installment schedule. Edit the schedule (or end the plan) first.',
          to_char(coalesce(new.total_amount, 0), 'FM999,999,990.00') using errcode = 'check_violation';
      end if;
      select jsonb_agg(jsonb_build_object('no', i.installment_no, 'due_date', i.due_date, 'amount', i.amount) order by i.installment_no)
        into v_before from public.booking_installment i where i.booking_id = new.booking_id;
      update public.booking_installment set amount = amount + v_delta where installment_id = v_last_id;
      select jsonb_agg(jsonb_build_object('no', i.installment_no, 'due_date', i.due_date, 'amount', i.amount) order by i.installment_no)
        into v_after from public.booking_installment i where i.booking_id = new.booking_id;
      insert into public.booking_installment_log (booking_id, action, before_plan, after_plan, reason, changed_by)
      values (new.booking_id, 'Updated', v_before, v_after,
              'Booking total changed from ₱' || to_char(coalesce(old.total_amount, 0), 'FM999,999,990.00')
              || ' to ₱' || to_char(coalesce(new.total_amount, 0), 'FM999,999,990.00')
              || '; the last installment was adjusted automatically.',
              private.f_current_manager_id());
    end if;
  end if;
  return new;
end $$;
drop trigger if exists b0_booking_plan_guard on public.booking;
create trigger b0_booking_plan_guard before insert or update on public.booking
  for each row execute function public.trg_booking_plan_guard();

-- 3.2 Suki stamps, and a Blocked customer is never a suki.
create or replace function public.trg_customer_suki()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.is_suki := coalesce(new.is_suki, false) and public.is_manager();
  end if;
  if new.account_status = 'Blocked' then
    new.is_suki := false;
  end if;
  if tg_op = 'INSERT' then
    if new.is_suki then
      new.suki_since := now(); new.suki_set_by := private.f_current_manager_id();
    else
      new.suki_since := null; new.suki_set_by := null;
    end if;
  elsif new.is_suki is distinct from old.is_suki then
    if new.is_suki then
      new.suki_since := now(); new.suki_set_by := private.f_current_manager_id();
    else
      new.suki_since := null; new.suki_set_by := null;
    end if;
  else
    -- stamps only move with is_suki
    new.suki_since := old.suki_since; new.suki_set_by := old.suki_set_by;
  end if;
  return new;
end $$;
-- b1_ runs after a0_guard_customer_write (triggers fire in name order).
drop trigger if exists b1_customer_suki on public.customer;
create trigger b1_customer_suki before insert or update on public.customer
  for each row execute function public.trg_customer_suki();

-- 3.3 App writes cannot touch suki fields (customer guard).
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
    new.is_suki           := false;
    new.suki_note         := null;
    return new;
  end if;
  new.account_status    := old.account_status;
  new.status_reason     := old.status_reason;
  new.status_changed_at := old.status_changed_at;
  new.status_changed_by := old.status_changed_by;
  new.source            := old.source;
  new.user_id           := old.user_id;
  new.created_at        := old.created_at;
  new.is_suki           := old.is_suki;
  new.suki_since        := old.suki_since;
  new.suki_set_by       := old.suki_set_by;
  new.suki_note         := old.suki_note;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------
-- 4. Views
-- ---------------------------------------------------------------------

-- 4.1 One row per installment, with what has been covered so far.
--     Verified net payments are applied oldest installment first.
create or replace view public.v_booking_installments with (security_invoker = on) as
with s as (
  select i.installment_id, i.booking_id, i.installment_no, i.due_date, i.amount,
         sum(i.amount) over (partition by i.booking_id order by i.installment_no) as cum_due
  from public.booking_installment i
), paid as (
  select l.booking_id, coalesce(sum(l.amount_paid) filter (where l.counts_in_ledger), 0) as net_paid
  from public.v_payment_ledger l group by l.booking_id
)
select s.installment_id, s.booking_id, b.booking_number, b.booking_status,
       s.installment_no, s.due_date, s.amount, s.cum_due,
       least(s.amount, greatest(0::numeric, coalesce(p.net_paid, 0) - (s.cum_due - s.amount))) as covered,
       s.amount - least(s.amount, greatest(0::numeric, coalesce(p.net_paid, 0) - (s.cum_due - s.amount))) as remaining,
       case
         when coalesce(p.net_paid, 0) >= s.cum_due - 0.005 then 'Paid'
         when b.booking_status in ('Rejected', 'Cancelled') then 'Closed'
         when s.due_date < private.f_today_manila() then 'Overdue'
         when s.due_date = private.f_today_manila() then 'Due'
         when coalesce(p.net_paid, 0) > s.cum_due - s.amount + 0.005 then 'Partly paid'
         else 'Upcoming'
       end as status,
       (b.booking_status in ('Confirmed', 'Completed')
        and s.due_date < private.f_today_manila()
        and coalesce(p.net_paid, 0) < s.cum_due - 0.005) as is_overdue,
       case when b.booking_status in ('Confirmed', 'Completed')
             and s.due_date < private.f_today_manila()
             and coalesce(p.net_paid, 0) < s.cum_due - 0.005
            then private.f_today_manila() - s.due_date else 0 end as days_overdue
from s
join public.booking b on b.booking_id = s.booking_id
left join paid p on p.booking_id = s.booking_id;

revoke all on public.v_booking_installments from anon, authenticated;
grant select on public.v_booking_installments to authenticated;

-- 4.2 v_booking_money: identical columns in identical order, plus five new
--     ones at the end. is_overdue / days_overdue follow the installment
--     schedule for Installment bookings and are unchanged for Standard ones.
create or replace view public.v_booking_money with (security_invoker = on) as
 WITH l AS (
         SELECT pl.booking_id,
            sum(pl.amount_paid) FILTER (WHERE (pl.counts_in_ledger AND (pl.amount_paid > (0)::numeric))) AS verified_paid,
            abs(COALESCE(sum(pl.amount_paid) FILTER (WHERE (pl.counts_in_ledger AND (pl.amount_paid < (0)::numeric))), (0)::numeric)) AS refunded,
            sum(pl.amount_paid) FILTER (WHERE pl.counts_in_ledger) AS net_paid,
            sum(pl.amount_paid) FILTER (WHERE (((pl.pay_status)::text = 'Pending Verification'::text) AND (pl.amount_paid > (0)::numeric))) AS awaiting_verification,
            count(*) FILTER (WHERE (pl.counts_in_ledger AND (pl.amount_paid > (0)::numeric))) AS payment_count,
            count(*) FILTER (WHERE ((pl.pay_status)::text = 'Pending Verification'::text)) AS awaiting_count,
            max(pl.pay_datetime) FILTER (WHERE pl.counts_in_ledger) AS last_payment_at
           FROM v_payment_ledger pl
          GROUP BY pl.booking_id
        ), inst AS (
         SELECT i.booking_id,
            count(*) AS n,
            sum(i.amount) FILTER (WHERE i.due_date <= private.f_today_manila()) AS due_to_date
           FROM booking_installment i
          GROUP BY i.booking_id
        ), base AS (
         SELECT b.*, COALESCE(l.net_paid, (0)::numeric) AS net_paid_c, l.verified_paid, l.refunded, l.net_paid,
            l.awaiting_verification, l.payment_count, l.awaiting_count, l.last_payment_at,
            inst.n AS inst_n, inst.due_to_date
           FROM booking b
             LEFT JOIN l ON l.booking_id = b.booking_id
             LEFT JOIN inst ON inst.booking_id = b.booking_id
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
    COALESCE(b.delivery_fee, (0)::numeric) AS delivery_fee,
    COALESCE(b.base_amount, b.total_amount) AS base_amount,
    b.approval_fee,
    COALESCE(b.verified_paid, (0)::numeric) AS verified_paid,
    COALESCE(b.refunded, (0)::numeric) AS refunded,
    b.net_paid_c AS net_paid,
    COALESCE(b.awaiting_verification, (0)::numeric) AS awaiting_verification,
    COALESCE(b.payment_count, (0)::bigint) AS payment_count,
    COALESCE(b.awaiting_count, (0)::bigint) AS awaiting_count,
    b.last_payment_at,
    GREATEST((b.total_amount - b.net_paid_c), (0)::numeric) AS outstanding,
    ((b.total_amount - b.net_paid_c) < (0)::numeric) AS is_overpaid,
    (b.net_paid_c >= b.total_amount) AS is_fully_paid,
        CASE
            WHEN (b.total_amount > (0)::numeric) THEN (b.net_paid_c >= (b.total_amount * 0.5))
            ELSE true
        END AS meets_confirm_threshold,
        CASE
            WHEN (b.total_amount > (0)::numeric) THEN round((LEAST((b.net_paid_c / b.total_amount), (1)::numeric) * (100)::numeric), 1)
            ELSE (0)::numeric
        END AS paid_pct,
    ((b.booking_status)::text = ANY (ARRAY['Rejected'::text, 'Cancelled'::text])) AS is_closed,
    ((b.booking_status)::text = ANY (ARRAY['Approved'::text, 'Confirmed'::text])) AS is_active,
    ((b.booking_status)::text = ANY (ARRAY['Confirmed'::text, 'Completed'::text])) AS counts_toward_revenue,
    ((b.booking_status)::text = ANY (ARRAY['Approved'::text, 'Confirmed'::text, 'Completed'::text])) AS is_receivable,
        CASE
            WHEN b.payment_plan = 'Installment' THEN
              ((b.booking_status)::text = ANY (ARRAY['Confirmed'::text, 'Completed'::text]))
              AND nx.next_due_date IS NOT NULL AND nx.next_due_date < private.f_today_manila()
            ELSE
              (((b.booking_status)::text = ANY (ARRAY['Confirmed'::text, 'Completed'::text])) AND (b.event_datetime < now()) AND (GREATEST((b.total_amount - b.net_paid_c), (0)::numeric) > (0)::numeric))
        END AS is_overdue,
        CASE
            WHEN b.payment_plan = 'Installment' THEN
              CASE WHEN ((b.booking_status)::text = ANY (ARRAY['Confirmed'::text, 'Completed'::text]))
                        AND nx.next_due_date IS NOT NULL AND nx.next_due_date < private.f_today_manila()
                   THEN (private.f_today_manila() - nx.next_due_date) ELSE 0 END
            WHEN (((b.booking_status)::text = ANY (ARRAY['Confirmed'::text, 'Completed'::text])) AND (b.event_datetime < now()) AND (GREATEST((b.total_amount - b.net_paid_c), (0)::numeric) > (0)::numeric)) THEN (floor((EXTRACT(epoch FROM (now() - b.event_datetime)) / (86400)::numeric)))::integer
            ELSE 0
        END AS days_overdue,
    COALESCE(b.flagged_for_review, false) AS flagged_for_review,
    b.flag_reason,
    b.flagged_at,
    (((b.booking_status)::text = ANY (ARRAY['Pending'::text, 'Approved'::text])) AND (b.event_datetime IS NOT NULL) AND (b.event_datetime < (now() - make_interval(hours => f_accept_grace_hours())))) AS is_lapsed,
    (((b.booking_status)::text = ANY (ARRAY['Pending'::text, 'Approved'::text])) AND (b.event_datetime IS NOT NULL) AND (b.event_datetime < now()) AND (b.event_datetime >= (now() - make_interval(hours => f_accept_grace_hours())))) AS is_in_grace,
    -- ---- new columns (appended) ----
    b.payment_plan,
    COALESCE(b.inst_n, 0)::integer AS installment_count,
        CASE WHEN b.payment_plan = 'Installment'
             THEN GREATEST(COALESCE(b.due_to_date, 0) - b.net_paid_c, (0)::numeric)
             ELSE NULL END AS amount_due_now,
    nx.next_due_date,
    nx.next_due_amount
   FROM base b
     -- The first installment not yet fully covered by verified net payments
     -- (applied oldest first). If its due date has passed, the plan is overdue.
     LEFT JOIN LATERAL (
       SELECT x.due_date AS next_due_date, LEAST(x.amount, x.cum - b.net_paid_c) AS next_due_amount
         FROM (SELECT i.installment_no, i.due_date, i.amount,
                      sum(i.amount) OVER (ORDER BY i.installment_no) AS cum
                 FROM booking_installment i
                WHERE i.booking_id = b.booking_id) x
        WHERE x.cum > b.net_paid_c + 0.005
        ORDER BY x.installment_no
        LIMIT 1
     ) nx ON (b.payment_plan = 'Installment');

-- 4.3 Customer views: same columns, is_suki appended.
create or replace view public.v_customer_balance with (security_invoker = on) as
 SELECT c.customer_id,
    (((c.first_name)::text || ' '::text) || (c.last_name)::text) AS full_name,
    c.account_status,
    COALESCE(sum(m.total_amount) FILTER (WHERE (NOT m.is_closed)), (0)::numeric) AS total_billed,
    COALESCE(sum(m.net_paid) FILTER (WHERE (NOT m.is_closed)), (0)::numeric) AS total_paid,
    COALESCE(sum(m.outstanding) FILTER (WHERE (NOT m.is_closed)), (0)::numeric) AS balance_due,
    COALESCE(sum(m.awaiting_verification), (0)::numeric) AS awaiting_verification,
    COALESCE(sum(m.refunded), (0)::numeric) AS total_refunded,
    count(*) FILTER (WHERE (m.is_active AND (m.outstanding > (0)::numeric))) AS unpaid_active_bookings,
    min(m.event_datetime) FILTER (WHERE ((m.outstanding > (0)::numeric) AND (m.event_datetime >= now()) AND (NOT m.is_closed))) AS next_unpaid_event_at,
    COALESCE(sum(m.outstanding) FILTER (WHERE m.counts_toward_revenue), (0)::numeric) AS receivable_due,
    COALESCE(sum(m.outstanding) FILTER (WHERE ((m.booking_status)::text = ANY ((ARRAY['Pending'::character varying, 'Approved'::character varying])::text[]))), (0)::numeric) AS pipeline_due,
    c.is_suki
   FROM (customer c
     LEFT JOIN v_booking_money m ON ((m.customer_id = c.customer_id)))
  GROUP BY c.customer_id, c.first_name, c.last_name, c.account_status, c.is_suki;

create or replace view public.v_customer_summary with (security_invoker = on) as
 SELECT c.customer_id,
    c.first_name,
    c.last_name,
    (((c.first_name)::text || ' '::text) || (c.last_name)::text) AS full_name,
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
    ((c.source)::text = 'Walk-in'::text) AS is_walk_in,
    (c.user_id IS NOT NULL) AS has_login,
    c.created_at,
    c.updated_at,
    COALESCE(b.total_bookings, (0)::bigint) AS total_bookings,
    COALESCE(b.package_bookings, (0)::bigint) AS package_bookings,
    COALESCE(b.short_orders, (0)::bigint) AS short_orders,
    COALESCE(b.pending_count, (0)::bigint) AS pending_count,
    COALESCE(b.approved_count, (0)::bigint) AS approved_count,
    COALESCE(b.confirmed_count, (0)::bigint) AS confirmed_count,
    COALESCE(b.completed_count, (0)::bigint) AS completed_count,
    COALESCE(b.rejected_count, (0)::bigint) AS rejected_count,
    COALESCE(b.cancelled_count, (0)::bigint) AS cancelled_count,
    COALESCE(b.active_count, (0)::bigint) AS active_count,
    COALESCE(b.lifetime_gross, (0)::numeric) AS lifetime_gross,
    COALESCE(b.lifetime_paid, (0)::numeric) AS lifetime_paid,
    COALESCE(b.lifetime_refunded, (0)::numeric) AS lifetime_refunded,
    COALESCE(b.lifetime_outstanding, (0)::numeric) AS lifetime_outstanding,
    b.first_booking_at,
    b.last_booking_at,
    b.next_event_at,
    b.last_event_at,
    (COALESCE(b.total_bookings, (0)::bigint) >= 2) AS is_repeat,
    (COALESCE(b.active_count, (0)::bigint) > 0) AS has_active_bookings,
    (COALESCE(b.lifetime_outstanding, (0)::numeric) > (0)::numeric) AS has_outstanding_balance,
    (COALESCE(b.total_bookings, (0)::bigint) = 0) AS is_deletable,
    COALESCE(b.receivable_due, (0)::numeric) AS receivable_due,
    COALESCE(b.pipeline_due, (0)::numeric) AS pipeline_due,
    (COALESCE(b.receivable_due, (0)::numeric) > (0)::numeric) AS has_receivable_due,
    COALESCE(b.contracted_gross, (0)::numeric) AS contracted_gross,
    COALESCE(b.contracted_paid, (0)::numeric) AS contracted_paid,
    c.is_suki,
    c.suki_since,
    c.suki_set_by,
    c.suki_note,
    COALESCE(b.installment_bookings, (0)::bigint) AS installment_bookings,
    COALESCE(b.overdue_installment_bookings, (0)::bigint) AS overdue_installment_bookings
   FROM (customer c
     LEFT JOIN ( SELECT m.customer_id,
            count(*) AS total_bookings,
            count(*) FILTER (WHERE ((m.booking_type)::text = 'Package'::text)) AS package_bookings,
            count(*) FILTER (WHERE ((m.booking_type)::text = 'Short Order'::text)) AS short_orders,
            count(*) FILTER (WHERE ((m.booking_status)::text = 'Pending'::text)) AS pending_count,
            count(*) FILTER (WHERE ((m.booking_status)::text = 'Approved'::text)) AS approved_count,
            count(*) FILTER (WHERE ((m.booking_status)::text = 'Confirmed'::text)) AS confirmed_count,
            count(*) FILTER (WHERE ((m.booking_status)::text = 'Completed'::text)) AS completed_count,
            count(*) FILTER (WHERE ((m.booking_status)::text = 'Rejected'::text)) AS rejected_count,
            count(*) FILTER (WHERE ((m.booking_status)::text = 'Cancelled'::text)) AS cancelled_count,
            count(*) FILTER (WHERE m.is_active) AS active_count,
            sum(m.total_amount) FILTER (WHERE (NOT m.is_closed)) AS lifetime_gross,
            sum(m.net_paid) FILTER (WHERE (NOT m.is_closed)) AS lifetime_paid,
            sum(m.refunded) AS lifetime_refunded,
            sum(m.outstanding) FILTER (WHERE (NOT m.is_closed)) AS lifetime_outstanding,
            sum(m.outstanding) FILTER (WHERE m.counts_toward_revenue) AS receivable_due,
            sum(m.outstanding) FILTER (WHERE ((m.booking_status)::text = ANY (ARRAY['Pending'::text, 'Approved'::text]))) AS pipeline_due,
            sum(m.total_amount) FILTER (WHERE m.counts_toward_revenue) AS contracted_gross,
            sum(m.net_paid) FILTER (WHERE m.counts_toward_revenue) AS contracted_paid,
            min(m.book_datetime) AS first_booking_at,
            max(m.book_datetime) AS last_booking_at,
            min(m.event_datetime) FILTER (WHERE ((m.event_datetime >= now()) AND (NOT m.is_closed))) AS next_event_at,
            max(m.event_datetime) FILTER (WHERE ((m.event_datetime < now()) AND (NOT m.is_closed))) AS last_event_at,
            count(*) FILTER (WHERE m.payment_plan = 'Installment' AND NOT m.is_closed) AS installment_bookings,
            count(*) FILTER (WHERE m.payment_plan = 'Installment' AND m.is_overdue) AS overdue_installment_bookings
           FROM v_booking_money m
          GROUP BY m.customer_id) b ON ((b.customer_id = c.customer_id)));

-- ---------------------------------------------------------------------
-- 5. Manager functions (the only way to write suki / plan data)
-- ---------------------------------------------------------------------

-- 5.1 Set or clear suki status.
create or replace function public.f_set_customer_suki(p_customer_id uuid, p_is_suki boolean, p_note text default null)
returns public.customer language plpgsql security definer set search_path = ''
as $$
declare v_row public.customer;
begin
  if not public.is_manager() then
    raise exception 'Only the manager can change suki status.' using errcode = '42501';
  end if;
  select * into v_row from public.customer where customer_id = p_customer_id for update;
  if not found then raise exception 'Customer not found.' using errcode = 'P0002'; end if;
  if coalesce(p_is_suki, false) and v_row.account_status = 'Blocked' then
    raise exception 'A blocked customer cannot be marked as suki. Unblock the account first.' using errcode = 'check_violation';
  end if;
  update public.customer
     set is_suki = coalesce(p_is_suki, false),
         suki_note = case when coalesce(p_is_suki, false) then nullif(btrim(coalesce(p_note, '')), '') else suki_note end
   where customer_id = p_customer_id
  returning * into v_row;
  return v_row;
end $$;

-- 5.2 Validate a schedule. Returns the rows sorted by due date, or raises.
--     p_installments: [{ "due_date": "YYYY-MM-DD", "amount": 1234.50 }, ...]
create or replace function private.f_check_installments(p_total numeric, p_installments jsonb, p_new_plan boolean)
returns table (installment_no smallint, due_date date, amount numeric)
language plpgsql stable set search_path = ''
as $$
declare
  v_n int; v_sum numeric := 0; v_prev date; r record; v_today date := private.f_today_manila();
begin
  if p_installments is null or jsonb_typeof(p_installments) <> 'array' then
    raise exception 'The installment schedule is missing.' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_installments);
  if v_n < 2 or v_n > 12 then
    raise exception 'An installment plan needs 2 to 12 installments (got %).', v_n using errcode = '22023';
  end if;
  if p_total is null or p_total <= 0 then
    raise exception 'The booking has no total amount yet, so it cannot be split into installments.' using errcode = '22023';
  end if;

  for r in
    select (e->>'due_date') as d_txt, (e->>'amount') as a_txt, ord
    from jsonb_array_elements(p_installments) with ordinality as t(e, ord)
    order by ord
  loop
    begin
      if r.d_txt is null or r.d_txt !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'bad date'; end if;
      due_date := r.d_txt::date;
    exception when others then
      raise exception 'Installment % has an invalid due date.', r.ord using errcode = '22023';
    end;
    begin
      amount := r.a_txt::numeric;
    exception when others then
      raise exception 'Installment % has an invalid amount.', r.ord using errcode = '22023';
    end;
    if amount is null or amount <= 0 then
      raise exception 'Installment % must be more than ₱0.', r.ord using errcode = '22023';
    end if;
    if amount <> round(amount, 2) then
      raise exception 'Installment % has more than two decimal places.', r.ord using errcode = '22023';
    end if;
    if v_prev is not null and due_date <= v_prev then
      raise exception 'Due dates must be in order with no two on the same day (installment %).', r.ord using errcode = '22023';
    end if;
    if p_new_plan and r.ord = 1 and due_date < v_today then
      raise exception 'The first installment cannot be due before today.' using errcode = '22023';
    end if;
    v_prev := due_date;
    v_sum := v_sum + amount;
    installment_no := r.ord::smallint;
    return next;
  end loop;

  if round(v_sum, 2) <> round(p_total, 2) then
    raise exception 'The installments add up to ₱% but the booking total is ₱%. They must match exactly.',
      to_char(v_sum, 'FM999,999,990.00'), to_char(p_total, 'FM999,999,990.00') using errcode = '22023';
  end if;
end $$;

-- 5.3 Create or replace a plan.
--     New plan  : booking must be Approved or Confirmed, customer must be an
--                 active suki. An Approved booking becomes Confirmed.
--     Edit plan : booking already on a plan (Approved is impossible, so
--                 Confirmed or Completed). A reason is required. The number of
--                 installments, dates and amounts may all change.
create or replace function public.f_save_installment_plan(p_booking_id uuid, p_installments jsonb, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  b public.booking; c public.customer; v_new boolean; v_before jsonb; v_after jsonb;
  v_mgr uuid := private.f_current_manager_id();
begin
  if not public.is_manager() then
    raise exception 'Only the manager can set an installment plan.' using errcode = '42501';
  end if;

  select * into b from public.booking where booking_id = p_booking_id for update;
  if not found then raise exception 'Booking not found.' using errcode = 'P0002'; end if;
  v_new := b.payment_plan <> 'Installment';

  if v_new then
    if b.booking_status not in ('Approved', 'Confirmed') then
      raise exception 'An installment plan can only be started on an Approved or Confirmed booking (this one is %).', b.booking_status using errcode = 'check_violation';
    end if;
    select * into c from public.customer where customer_id = b.customer_id;
    if not found or not c.is_suki then
      raise exception 'Only suki customers can pay in installments. Mark the customer as suki first.' using errcode = 'check_violation';
    end if;
    if c.account_status = 'Blocked' then
      raise exception 'This customer is blocked.' using errcode = 'check_violation';
    end if;
    if b.booking_status = 'Approved' and b.event_datetime is not null
       and b.event_datetime < now() - make_interval(hours => public.f_accept_grace_hours()) then
      raise exception 'Cannot confirm %: its event date has passed.', b.booking_number using errcode = 'check_violation';
    end if;
  else
    if b.booking_status not in ('Confirmed', 'Completed') then
      raise exception 'This plan can no longer be edited because the booking is %.', b.booking_status using errcode = 'check_violation';
    end if;
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'Give a reason for changing the installment schedule.' using errcode = '22023';
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('no', installment_no, 'due_date', due_date, 'amount', amount) order by installment_no), '[]'::jsonb)
    into v_before from public.booking_installment where booking_id = p_booking_id;

  perform set_config('app.plan_write', 'on', true);

  delete from public.booking_installment where booking_id = p_booking_id;
  -- f_check_installments validates and raises before anything is kept: the
  -- whole function is one statement, so an error rolls the delete back too.
  insert into public.booking_installment (booking_id, installment_no, due_date, amount, created_by)
    select p_booking_id, x.installment_no, x.due_date, x.amount, v_mgr
    from private.f_check_installments(b.total_amount, p_installments, v_new) x;

  if v_new then
    if b.booking_status = 'Approved' then
      perform set_config('app.status_source', 'Suki installment plan', true);
      perform set_config('app.status_reason', nullif(btrim(coalesce(p_reason, '')), ''), true);
      update public.booking
         set payment_plan = 'Installment', booking_status = 'Confirmed', status_order = 3,
             confirmed_at = coalesce(confirmed_at, now())
       where booking_id = p_booking_id;
      perform set_config('app.status_source', '', true);
      perform set_config('app.status_reason', '', true);
    else
      update public.booking set payment_plan = 'Installment' where booking_id = p_booking_id;
    end if;
  end if;

  perform set_config('app.plan_write', '', true);

  select jsonb_agg(jsonb_build_object('no', installment_no, 'due_date', due_date, 'amount', amount) order by installment_no)
    into v_after from public.booking_installment where booking_id = p_booking_id;

  insert into public.booking_installment_log (booking_id, action, before_plan, after_plan, reason, changed_by)
  values (p_booking_id, case when v_new then 'Created' else 'Updated' end,
          case when v_new then null else v_before end, v_after,
          nullif(btrim(coalesce(p_reason, '')), ''), v_mgr);

  select * into b from public.booking where booking_id = p_booking_id;
  return jsonb_build_object('booking_id', b.booking_id, 'booking_status', b.booking_status,
                            'payment_plan', b.payment_plan, 'installments', v_after);
end $$;

-- 5.4 End a plan and go back to the Standard rules.
--     If the event is still ahead and less than 50% is paid, the booking goes
--     back to Approved (flagged for review) — the same place a Standard booking
--     with that much paid would be. Otherwise its status is kept.
create or replace function public.f_end_installment_plan(p_booking_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare b public.booking; v_before jsonb; v_net numeric; v_mgr uuid := private.f_current_manager_id(); v_reverted boolean := false;
begin
  if not public.is_manager() then
    raise exception 'Only the manager can end an installment plan.' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Give a reason for ending the installment plan.' using errcode = '22023';
  end if;
  select * into b from public.booking where booking_id = p_booking_id for update;
  if not found then raise exception 'Booking not found.' using errcode = 'P0002'; end if;
  if b.payment_plan <> 'Installment' then
    raise exception 'This booking is not on an installment plan.' using errcode = 'check_violation';
  end if;

  select jsonb_agg(jsonb_build_object('no', installment_no, 'due_date', due_date, 'amount', amount) order by installment_no)
    into v_before from public.booking_installment where booking_id = p_booking_id;
  v_net := private.f_booking_net_paid(p_booking_id);

  perform set_config('app.plan_write', 'on', true);
  delete from public.booking_installment where booking_id = p_booking_id;
  update public.booking set payment_plan = 'Standard' where booking_id = p_booking_id;

  if b.booking_status = 'Confirmed' and b.event_datetime > now()
     and b.total_amount > 0 and v_net < b.total_amount * 0.5 then
    perform set_config('app.status_source', 'Installment plan ended', true);
    perform set_config('app.status_reason', p_reason, true);
    update public.booking
       set booking_status = 'Approved', status_order = 2, confirmed_at = null,
           flagged_for_review = true, flagged_at = now(),
           flag_reason = 'Installment plan ended with less than 50% paid.'
     where booking_id = p_booking_id;
    perform set_config('app.status_source', '', true);
    perform set_config('app.status_reason', '', true);
    v_reverted := true;
  end if;
  perform set_config('app.plan_write', '', true);

  insert into public.booking_installment_log (booking_id, action, before_plan, after_plan, reason, changed_by)
  values (p_booking_id, 'Ended', v_before, null, btrim(p_reason), v_mgr);

  select * into b from public.booking where booking_id = p_booking_id;
  return jsonb_build_object('booking_id', b.booking_id, 'booking_status', b.booking_status,
                            'payment_plan', b.payment_plan, 'reverted_to_approved', v_reverted);
end $$;

revoke all on function public.f_set_customer_suki(uuid, boolean, text)         from public, anon;
revoke all on function public.f_save_installment_plan(uuid, jsonb, text)       from public, anon;
revoke all on function public.f_end_installment_plan(uuid, text)               from public, anon;
revoke all on function private.f_check_installments(numeric, jsonb, boolean)   from public, anon;
grant execute on function public.f_set_customer_suki(uuid, boolean, text)      to authenticated;
grant execute on function public.f_save_installment_plan(uuid, jsonb, text)    to authenticated;
grant execute on function public.f_end_installment_plan(uuid, text)            to authenticated;
revoke all on function public.trg_booking_plan_guard() from public, anon, authenticated;
revoke all on function public.trg_customer_suki()      from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Existing functions made plan-aware
-- ---------------------------------------------------------------------

-- 6.1 A reversal never un-confirms an Installment booking (it was confirmed
--     by the manager's trust, not by the 50% rule).
create or replace function public.f_maybe_unconfirm_booking(p_booking_id uuid)
returns void language plpgsql security definer set search_path to ''
as $function$
declare
  v_total numeric; v_status text; v_event timestamptz; v_net numeric; v_plan text;
begin
  if p_booking_id is null then return; end if;

  select b.total_amount, b.booking_status, b.event_datetime, b.payment_plan
    into v_total, v_status, v_event, v_plan
  from public.booking b where b.booking_id = p_booking_id for update;

  if v_plan = 'Installment' then return; end if;
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

-- 6.2 Manager override cannot push an Installment booking back to
--     Pending/Approved — the plan has to be ended first, so the two never
--     disagree. Everything else is unchanged.
create or replace function public.f_override_booking_status(p_booking_id uuid, p_new_status character varying, p_reason text)
returns booking language plpgsql security definer set search_path to ''
as $function$
declare v_row public.booking; v_plan text;
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

  select payment_plan into v_plan from public.booking where booking_id = p_booking_id;
  if v_plan = 'Installment' and p_new_status in ('Pending', 'Approved') then
    raise exception 'This booking is on an installment plan. End the plan first, then change its status.'
      using errcode = 'check_violation';
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

-- 6.3 Operations Manager app: an Installment booking may be completed once its
--     event has started even if installments remain (they stay receivable).
--     Also: app writes can never change payment_plan.
create or replace function public.f_guard_booking_write()
returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  if current_user not in ('authenticated', 'anon') or public.is_manager() then return new; end if;
  if tg_op = 'INSERT' then
    new.booking_status := 'Pending'; new.approval_fee := 0; new.approved_at := null; new.confirmed_at := null;
    new.completed_at := null; new.closed_at := null; new.flagged_for_review := false; new.flag_reason := null; new.flagged_at := null;
    new.payment_plan := 'Standard';
    return new;
  end if;
  new.customer_id := old.customer_id; new.booking_number := old.booking_number; new.book_datetime := old.book_datetime;
  new.approval_fee := old.approval_fee; new.approved_at := old.approved_at; new.confirmed_at := old.confirmed_at;
  new.flagged_for_review := old.flagged_for_review; new.flag_reason := old.flag_reason; new.flagged_at := old.flagged_at;
  new.payment_plan := old.payment_plan;
  if public.is_operations_manager() then
    -- Confirmed -> Completed only once the event has started and nothing is owed
    -- (or the booking is on an installment plan).
    if new.booking_status is distinct from old.booking_status
       and not (new.booking_status = 'Completed' and old.booking_status = 'Confirmed'
                and old.event_datetime <= now()
                and (old.payment_plan = 'Installment' or private.f_booking_outstanding(old.booking_id) <= 0)) then
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

-- 6.4 Completion check (used by the Ops app and the web) knows about plans.
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

  select booking_status, event_datetime, payment_plan into b from public.booking where booking_id = p_booking_id;
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
  elsif v_owed > 0 and b.payment_plan <> 'Installment' then
    v_reason  := 'balance_due';
    v_message := '₱' || to_char(v_owed, 'FM999,999,990.00') || ' balance still due.';
  end if;

  return jsonb_build_object(
    'can_complete',  v_reason is null,
    'reason',        v_reason,
    'message',       v_message,
    'outstanding',   v_owed,
    'event_started', v_started,
    'status',        b.booking_status,
    'payment_plan',  b.payment_plan
  );
end;
$function$;
