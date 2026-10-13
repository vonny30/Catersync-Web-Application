-- =====================================================================
-- suki_installments_dryrun.sql
-- Runs the whole migration + about 50 checks inside ONE transaction and then
-- raises an exception on purpose, so NOTHING is kept. The exception
-- message is the test report. Run it in the Supabase SQL editor (or via
-- execute_sql) BEFORE applying suki_installments.sql.
-- Every line of the report should say what it 'expects' or show a
-- refusal message; any line with FAIL or ERROR is a bug.
-- =====================================================================
-- DRY RUN: everything below is rolled back by the final RAISE.
create temp table r (n serial, t text); grant all on r to public; grant all on sequence r_n_seq to public;
create temp table ids (k text primary key, v uuid); grant all on ids to public;
create temp table before_m as select booking_id, is_overdue, days_overdue, outstanding, net_paid, is_lapsed, is_fully_paid, meets_confirm_threshold from public.v_booking_money;
create temp table before_c as select customer_id, receivable_due, lifetime_outstanding, total_bookings from public.v_customer_summary;
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

-- ===================== TESTS =====================
-- R0: existing data unchanged
insert into r(t) select 'R0 v_booking_money rows changed for existing bookings: ' || count(*)
from before_m o join public.v_booking_money m using (booking_id)
where (o.is_overdue, o.days_overdue, o.outstanding, o.net_paid, o.is_lapsed, o.is_fully_paid, o.meets_confirm_threshold)
  is distinct from (m.is_overdue, m.days_overdue, m.outstanding, m.net_paid, m.is_lapsed, m.is_fully_paid, m.meets_confirm_threshold);
insert into r(t) select 'R0 v_customer_summary rows changed: ' || count(*)
from before_c o join public.v_customer_summary m using (customer_id)
where (o.receivable_due, o.lifetime_outstanding, o.total_bookings) is distinct from (m.receivable_due, m.lifetime_outstanding, m.total_bookings);
insert into r(t) select 'R0 existing plans (expect all Standard): ' || string_agg(distinct payment_plan, ',') from public.booking;

-- fixtures (as postgres)
with c as (
  insert into public.customer (first_name, last_name, account_status, cus_address, email_address, contact_no, username, source)
  values ('DRY', 'Suki', 'Active', 'Bayawan', 'dry.suki@example.com', '09170000009', 'dry.suki.test', 'Walk-in') returning customer_id)
insert into ids select 'cus', customer_id from c;
with b as (
  insert into public.booking (booking_type, venue, event_datetime, pax_count, customer_id, booking_status, total_amount, delivery_fee, menu_selections, notes)
  select 'Short Order', 'DRY venue', now() + interval '20 days', 0, v, 'Approved', 9000, 0,
         '[{"quantity":1,"menu_item_id":"bf0bc7e3-7fb2-4f7b-9ae0-006a5c3ae7c3"}]'::jsonb, 'dry run'
  from ids where k = 'cus' returning booking_id, payment_plan)
insert into ids select 'bk', booking_id from b;
insert into r(t) select 'F1 new booking plan (expect Standard): ' || payment_plan from public.booking where booking_id = (select v from ids where k='bk');

-- become the manager
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2fac82eb-cce5-40bb-9c30-3e379f9d6440","role":"authenticated"}', true);

-- M1 plan refused while customer is not suki
do $$ begin
  perform public.f_save_installment_plan((select v from ids where k='bk'),
    jsonb_build_array(jsonb_build_object('due_date', to_char(private.f_today_manila(),'YYYY-MM-DD'), 'amount', 4500),
                      jsonb_build_object('due_date', to_char(private.f_today_manila()+30,'YYYY-MM-DD'), 'amount', 4500)));
  insert into r(t) values ('M1 FAIL: plan accepted for non-suki');
exception when others then insert into r(t) values ('M1 refused non-suki: ' || sqlerrm); end $$;

-- M2 mark suki
do $$ declare c public.customer; begin
  c := public.f_set_customer_suki((select v from ids where k='cus'), true, 'loyal since 2020');
  insert into r(t) values ('M2 suki set: is_suki=' || c.is_suki || ' since=' || (c.suki_since is not null) || ' by=' || coalesce(c.suki_set_by::text,'null') || ' note=' || coalesce(c.suki_note,''));
exception when others then insert into r(t) values ('M2 ERROR ' || sqlerrm); end $$;

-- M3 validation traps
do $$
declare bk uuid := (select v from ids where k='bk'); t date := private.f_today_manila();
  procedure_ok boolean;
begin
  begin perform public.f_save_installment_plan(bk, '[]'::jsonb); insert into r(t) values ('M3a FAIL empty'); exception when others then insert into r(t) values ('M3a empty: ' || sqlerrm); end;
  begin perform public.f_save_installment_plan(bk, jsonb_build_array(jsonb_build_object('due_date', to_char(t,'YYYY-MM-DD'), 'amount', 9000))); insert into r(t) values ('M3b FAIL one row'); exception when others then insert into r(t) values ('M3b one row: ' || sqlerrm); end;
  begin perform public.f_save_installment_plan(bk, jsonb_build_array(jsonb_build_object('due_date', to_char(t,'YYYY-MM-DD'), 'amount', 4000), jsonb_build_object('due_date', to_char(t+30,'YYYY-MM-DD'), 'amount', 4000))); insert into r(t) values ('M3c FAIL sum'); exception when others then insert into r(t) values ('M3c wrong sum: ' || sqlerrm); end;
  begin perform public.f_save_installment_plan(bk, jsonb_build_array(jsonb_build_object('due_date', to_char(t+30,'YYYY-MM-DD'), 'amount', 4500), jsonb_build_object('due_date', to_char(t,'YYYY-MM-DD'), 'amount', 4500))); insert into r(t) values ('M3d FAIL order'); exception when others then insert into r(t) values ('M3d out of order: ' || sqlerrm); end;
  begin perform public.f_save_installment_plan(bk, jsonb_build_array(jsonb_build_object('due_date', to_char(t-1,'YYYY-MM-DD'), 'amount', 4500), jsonb_build_object('due_date', to_char(t+30,'YYYY-MM-DD'), 'amount', 4500))); insert into r(t) values ('M3e FAIL past'); exception when others then insert into r(t) values ('M3e first in past: ' || sqlerrm); end;
  begin perform public.f_save_installment_plan(bk, jsonb_build_array(jsonb_build_object('due_date', 'abc', 'amount', 4500), jsonb_build_object('due_date', to_char(t+30,'YYYY-MM-DD'), 'amount', 4500))); insert into r(t) values ('M3f FAIL bad date'); exception when others then insert into r(t) values ('M3f bad date: ' || sqlerrm); end;
  begin perform public.f_save_installment_plan(bk, jsonb_build_array(jsonb_build_object('due_date', to_char(t,'YYYY-MM-DD'), 'amount', 4500.555), jsonb_build_object('due_date', to_char(t+30,'YYYY-MM-DD'), 'amount', 4499.445))); insert into r(t) values ('M3g FAIL decimals'); exception when others then insert into r(t) values ('M3g 3 decimals: ' || sqlerrm); end;
  begin perform public.f_save_installment_plan(bk, jsonb_build_array(jsonb_build_object('due_date', to_char(t,'YYYY-MM-DD'), 'amount', -1), jsonb_build_object('due_date', to_char(t+30,'YYYY-MM-DD'), 'amount', 9001))); insert into r(t) values ('M3h FAIL negative'); exception when others then insert into r(t) values ('M3h negative: ' || sqlerrm); end;
  begin perform public.f_save_installment_plan(bk, jsonb_build_array(jsonb_build_object('due_date', to_char(t,'YYYY-MM-DD'), 'amount', 4500), jsonb_build_object('due_date', to_char(t,'YYYY-MM-DD'), 'amount', 4500))); insert into r(t) values ('M3i FAIL same day'); exception when others then insert into r(t) values ('M3i same day: ' || sqlerrm); end;
  insert into r(t) select 'M3 rows written after failures (expect 0): ' || count(*) from public.booking_installment where booking_id = bk;
end $$;

-- M4 valid plan: 3 installments, first due today
do $$ declare bk uuid := (select v from ids where k='bk'); t date := private.f_today_manila(); res jsonb; begin
  res := public.f_save_installment_plan(bk, jsonb_build_array(
    jsonb_build_object('due_date', to_char(t,'YYYY-MM-DD'), 'amount', 3000),
    jsonb_build_object('due_date', to_char(t+30,'YYYY-MM-DD'), 'amount', 3000),
    jsonb_build_object('due_date', to_char(t+60,'YYYY-MM-DD'), 'amount', 3000)));
  insert into r(t) values ('M4 plan saved: status=' || (res->>'booking_status') || ' plan=' || (res->>'payment_plan') || ' n=' || jsonb_array_length(res->'installments'));
exception when others then insert into r(t) values ('M4 ERROR ' || sqlerrm); end $$;
insert into r(t) select 'M4 status log source: ' || source || ' (' || from_status || '->' || to_status || ')' from public.booking_status_log where booking_id = (select v from ids where k='bk') order by seq desc limit 1;
insert into r(t) select 'M4 plan log: ' || action from public.booking_installment_log where booking_id = (select v from ids where k='bk');
insert into r(t) select 'M4 money: plan=' || payment_plan || ' n=' || installment_count || ' due_now=' || amount_due_now || ' next=' || next_due_date || '/' || next_due_amount || ' overdue=' || is_overdue
  from public.v_booking_money where booking_id = (select v from ids where k='bk');

-- M5 manager traps on the booking row
do $$ declare bk uuid := (select v from ids where k='bk'); begin
  begin update public.booking set payment_plan = 'Standard' where booking_id = bk; insert into r(t) values ('M5a FAIL plan flipped directly'); exception when others then insert into r(t) values ('M5a direct plan change: ' || sqlerrm); end;
  begin update public.booking set total_amount = 9500 where booking_id = bk; insert into r(t) select 'M5b total 9000->9500, last installment now (expect 3500): ' || amount from public.booking_installment where booking_id = bk and installment_no = 3; exception when others then insert into r(t) values ('M5b FAIL ' || sqlerrm); end;
  begin update public.booking set total_amount = 9000 where booking_id = bk; insert into r(t) select 'M5b back to 9000, last (expect 3000): ' || amount from public.booking_installment where booking_id = bk and installment_no = 3; exception when others then insert into r(t) values ('M5b2 FAIL ' || sqlerrm); end;
  begin update public.booking set total_amount = 5000 where booking_id = bk; insert into r(t) values ('M5b3 FAIL total too small accepted'); exception when others then insert into r(t) values ('M5b3 total too small: ' || sqlerrm); end;
  insert into r(t) select 'M5b log reasons: ' || count(*) || ' auto-adjust entries' from public.booking_installment_log where booking_id = bk and reason like 'Booking total changed%';
  begin perform public.f_override_booking_status(bk, 'Approved', 'test'); insert into r(t) values ('M5c FAIL override to Approved'); exception when others then insert into r(t) values ('M5c override to Approved: ' || sqlerrm); end;
  begin insert into public.booking_installment (booking_id, installment_no, due_date, amount) values (bk, 9, current_date + 400, 1); insert into r(t) values ('M5d FAIL direct insert'); exception when others then insert into r(t) values ('M5d direct insert: ' || sqlerrm); end;
  begin update public.booking set notes = 'manager edit ok' where booking_id = bk; insert into r(t) values ('M5e unrelated edit OK'); exception when others then insert into r(t) values ('M5e FAIL ' || sqlerrm); end;
end $$;

reset role;
-- payments (as postgres, like the manager's Record Receipt)
with p as (insert into public.payment (amount_paid, pay_installment, pay_method, pay_status, receipt_reference, pay_datetime, booking_id, customer_id, entry_type)
  select 1000, 1, 'Cash', 'Deposit Collected', 'DRY-1', now(), (select v from ids where k='bk'), (select v from ids where k='cus'), 'Receipt' returning payment_id)
insert into ids select 'p1', payment_id from p;
insert into r(t) select 'P1 after 1,000: inst1 ' || status || ' covered=' || covered || ' | due_now=' || (select amount_due_now from public.v_booking_money where booking_id=(select v from ids where k='bk'))
  from public.v_booking_installments where booking_id = (select v from ids where k='bk') and installment_no = 1;

-- P2 reversal keeps the plan booking Confirmed
insert into public.payment (amount_paid, pay_installment, pay_method, pay_status, pay_datetime, booking_id, customer_id, entry_type, reverses_payment_id, reversal_reason)
select -1000, 1, 'Cash', 'Reversed', now(), (select v from ids where k='bk'), (select v from ids where k='cus'), 'Reversal', (select v from ids where k='p1'), 'dry run';
insert into r(t) select 'P2 after reversal: status=' || booking_status || ' net=' || (select net_paid from public.v_booking_money where booking_id=(select v from ids where k='bk')) from public.booking where booking_id = (select v from ids where k='bk');

-- P3 pay 4,000: inst1 paid, inst2 partly
insert into public.payment (amount_paid, pay_installment, pay_method, pay_status, receipt_reference, pay_datetime, booking_id, customer_id, entry_type)
select 4000, 2, 'Cash', 'Partially Settled', 'DRY-2', now(), (select v from ids where k='bk'), (select v from ids where k='cus'), 'Receipt';
insert into r(t) select 'P3 statuses: ' || string_agg(installment_no || '=' || status || '(' || covered || ')', ', ' order by installment_no)
  from public.v_booking_installments where booking_id = (select v from ids where k='bk');

-- become the manager again
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2fac82eb-cce5-40bb-9c30-3e379f9d6440","role":"authenticated"}', true);

-- E1 edit: needs a reason; then 4 installments with first one in the past (allowed on edit)
do $$ declare bk uuid := (select v from ids where k='bk'); t date := private.f_today_manila(); begin
  begin perform public.f_save_installment_plan(bk, jsonb_build_array(jsonb_build_object('due_date', to_char(t-10,'YYYY-MM-DD'), 'amount', 4500), jsonb_build_object('due_date', to_char(t+30,'YYYY-MM-DD'), 'amount', 4500))); insert into r(t) values ('E1a FAIL no reason'); exception when others then insert into r(t) values ('E1a edit without reason: ' || sqlerrm); end;
  perform public.f_save_installment_plan(bk, jsonb_build_array(
    jsonb_build_object('due_date', to_char(t-20,'YYYY-MM-DD'), 'amount', 2000),
    jsonb_build_object('due_date', to_char(t-10,'YYYY-MM-DD'), 'amount', 4000),
    jsonb_build_object('due_date', to_char(t+20,'YYYY-MM-DD'), 'amount', 1500),
    jsonb_build_object('due_date', to_char(t+40,'YYYY-MM-DD'), 'amount', 1500)), 'customer asked to spread it');
  insert into r(t) values ('E1b edited to 4 installments OK');
exception when others then insert into r(t) values ('E1 ERROR ' || sqlerrm); end $$;
insert into r(t) select 'E1 statuses: ' || string_agg(installment_no || '=' || status || '(' || covered || ',' || days_overdue || 'd)', ', ' order by installment_no)
  from public.v_booking_installments where booking_id = (select v from ids where k='bk');
insert into r(t) select 'E1 money: overdue=' || is_overdue || ' days=' || days_overdue || ' due_now=' || amount_due_now || ' next=' || next_due_date || '/' || next_due_amount
  from public.v_booking_money where booking_id = (select v from ids where k='bk');
insert into r(t) select 'E1 summary: suki=' || is_suki || ' inst_bookings=' || installment_bookings || ' overdue_inst=' || overdue_installment_bookings || ' receivable=' || receivable_due
  from public.v_customer_summary where customer_id = (select v from ids where k='cus');
insert into r(t) select 'E1 log actions: ' || string_agg(action, ',' order by changed_at) from public.booking_installment_log where booking_id = (select v from ids where k='bk');
reset role;

-- O1 Operations Manager: completion check before and after the event
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cd262791-bb6d-45bf-8d0f-6272d1afee8b","role":"authenticated"}', true);
insert into r(t) select 'O1a ops before event: ' || (public.f_completion_check((select v from ids where k='bk'))->>'reason');
reset role;
update public.booking set event_datetime = now() - interval '1 day' where booking_id = (select v from ids where k='bk');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cd262791-bb6d-45bf-8d0f-6272d1afee8b","role":"authenticated"}', true);
insert into r(t) select 'O1b ops after event, balance due: can_complete=' || (public.f_completion_check((select v from ids where k='bk'))->>'can_complete');
do $$ declare s text; begin
  update public.booking set booking_status = 'Completed' where booking_id = (select v from ids where k='bk');
  select booking_status into s from public.booking where booking_id = (select v from ids where k='bk');
  insert into r(t) values ('O1c ops completes plan booking with balance: ' || s);
exception when others then insert into r(t) values ('O1c ERROR ' || sqlerrm); end $$;
reset role;

-- C1 customer app cannot touch suki / plan fields (customer user 181df233)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"181df233-4de0-48b0-9063-c561bf56d1b2","role":"authenticated"}', true);
do $$ declare s boolean; p text; cid uuid; begin
  select customer_id into cid from public.customer where user_id = '181df233-4de0-48b0-9063-c561bf56d1b2';
  update public.customer set is_suki = true, suki_note = 'me' where customer_id = cid;
  select is_suki into s from public.customer where customer_id = cid;
  insert into r(t) values ('C1a customer self-suki (expect false): ' || s);
  update public.booking set payment_plan = 'Installment' where customer_id = cid;
  select string_agg(distinct payment_plan, ',') into p from public.booking where customer_id = cid;
  insert into r(t) values ('C1b customer plan change (expect Standard): ' || coalesce(p,'none'));
  begin perform public.f_save_installment_plan((select booking_id from public.booking where customer_id = cid limit 1), '[]'::jsonb); insert into r(t) values ('C1c FAIL rpc'); exception when others then insert into r(t) values ('C1c customer calls RPC: ' || sqlerrm); end;
  begin perform public.f_set_customer_suki(cid, true, null); insert into r(t) values ('C1d FAIL rpc'); exception when others then insert into r(t) values ('C1d customer sets suki: ' || sqlerrm); end;
  insert into r(t) select 'C1e customer sees others installments (expect 0): ' || count(*) from public.booking_installment;
exception when others then insert into r(t) values ('C1 ERROR ' || sqlerrm); end $$;
reset role;

-- X1 end plan on a second booking (future event, under 50% paid) -> back to Approved, flagged
with b as (
  insert into public.booking (booking_type, venue, event_datetime, pax_count, customer_id, booking_status, total_amount, delivery_fee, menu_selections, notes)
  select 'Short Order', 'DRY venue 2', now() + interval '25 days', 0, v, 'Approved', 4000, 0,
         '[{"quantity":1,"menu_item_id":"bf0bc7e3-7fb2-4f7b-9ae0-006a5c3ae7c3"}]'::jsonb, 'dry run 2'
  from ids where k = 'cus' returning booking_id)
insert into ids select 'bk2', booking_id from b;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2fac82eb-cce5-40bb-9c30-3e379f9d6440","role":"authenticated"}', true);
do $$ declare bk uuid := (select v from ids where k='bk2'); t date := private.f_today_manila(); res jsonb; begin
  perform public.f_save_installment_plan(bk, jsonb_build_array(jsonb_build_object('due_date', to_char(t+1,'YYYY-MM-DD'), 'amount', 2000), jsonb_build_object('due_date', to_char(t+15,'YYYY-MM-DD'), 'amount', 2000)));
  begin perform public.f_end_installment_plan(bk, ''); insert into r(t) values ('X1a FAIL no reason'); exception when others then insert into r(t) values ('X1a end without reason: ' || sqlerrm); end;
  res := public.f_end_installment_plan(bk, 'customer will pay normally');
  insert into r(t) values ('X1b ended: ' || res::text);
exception when others then insert into r(t) values ('X1 ERROR ' || sqlerrm); end $$;
insert into r(t) select 'X1c rows left (expect 0): ' || count(*) from public.booking_installment where booking_id = (select v from ids where k='bk2');
insert into r(t) select 'X1d flagged=' || flagged_for_review || ' plan=' || payment_plan || ' status=' || booking_status from public.booking where booking_id = (select v from ids where k='bk2');

-- S1 blocking a suki clears suki; blocked customer cannot be made suki
do $$ declare c public.customer; cid uuid := (select v from ids where k='cus'); begin
  update public.customer set account_status = 'Blocked', status_reason = 'dry run' where customer_id = cid;
  select * into c from public.customer where customer_id = cid;
  insert into r(t) values ('S1a after block: is_suki=' || c.is_suki || ' since_null=' || (c.suki_since is null));
  begin perform public.f_set_customer_suki(cid, true, null); insert into r(t) values ('S1b FAIL blocked suki'); exception when others then insert into r(t) values ('S1b blocked -> suki: ' || sqlerrm); end;
exception when others then insert into r(t) values ('S1 ERROR ' || sqlerrm); end $$;
reset role;

-- V2 other roles can still read the money views (no permission error)
set local role anon;
insert into r(t) select 'V2a anon reads v_booking_money: ' || count(*) || ' rows' from public.v_booking_money;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"181df233-4de0-48b0-9063-c561bf56d1b2","role":"authenticated"}', true);
insert into r(t) select 'V2b customer reads own v_booking_installments: ' || count(*) || ' rows, money rows ' || (select count(*) from public.v_booking_money) from public.v_booking_installments;
reset role;

-- V1 view still answers for everyone, quickly
insert into r(t) select 'V1 v_booking_money rows: ' || count(*) || ', installment plans: ' || count(*) filter (where payment_plan = 'Installment') from public.v_booking_money;

do $$ begin raise exception E'DRY RUN RESULTS (rolled back):\n%', (select string_agg(t, E'\n' order by n) from r); end $$;
