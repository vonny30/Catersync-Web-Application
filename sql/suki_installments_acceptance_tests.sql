-- Acceptance tests for suki customers and installment plans
-- (docs/feature-suki-installments.md §7), 14 Oct 2026.
--
-- Safe to run on the live database. It creates its own test rows (two
-- customers named ZZTEST, four short orders picked up at the branch), acts as
-- the manager the way the web app does, deletes the test rows again (§7.12),
-- then raises an error at the end so EVERYTHING is rolled back. Nothing is
-- committed, so the mobile and Operations Manager apps never see the rows.
-- The results are printed in that final error message, one line per check.
-- Same pattern as security_role_tests.sql.
--
-- Acts as manager 2fac82eb… (the account security_role_tests.sql uses);
-- update it if that account changes. Writes mirror the web app: the approval
-- UPDATE in useApprovalHandlers, receipts and reversals as Receivables inserts
-- them, the block/unblock UPDATE in Customers, the Complete UPDATE. Steps the
-- spec does "by seed data" (moving an event to yesterday) run as the owner.

create temp table r(t text);
grant all on r to public;

-- One-line snapshots, read as the manager.
create function pg_temp.inst(p uuid) returns text language sql stable as $f$
  select coalesce(string_agg(format('#%s %s P%s covered P%s %s', installment_no, to_char(due_date, 'Mon FMDD'), amount, covered, status),
                             '; ' order by installment_no), 'none')
  from public.v_booking_installments where booking_id = p
$f$;
create function pg_temp.money(p uuid) returns text language sql stable as $f$
  select format('%s/%s, %s inst, outstanding P%s, due now %s, next %s, overdue=%s (%s d), flagged=%s',
                booking_status, payment_plan, installment_count, outstanding,
                coalesce('P' || amount_due_now, '-'),
                coalesce('P' || next_due_amount || ' on ' || to_char(next_due_date, 'Mon FMDD'), '-'),
                is_overdue, days_overdue, flagged_for_review)
  from public.v_booking_money where booking_id = p
$f$;
create function pg_temp.slog(p uuid) returns text language sql stable as $f$
  select coalesce(string_agg(format('%s->%s (%s)', from_status, to_status, source), ', ' order by seq), 'none')
  from public.booking_status_log where booking_id = p
$f$;
-- Schedule rows as the web sends them (toRpcRows): [{due_date, amount}].
create function pg_temp.rows(p_amounts numeric[]) returns jsonb language sql stable as $f$
  select jsonb_agg(jsonb_build_object(
           'due_date', to_char((private.f_today_manila() + make_interval(months => (i - 1)::int))::date, 'YYYY-MM-DD'),
           'amount', p_amounts[i]) order by i)
  from generate_subscripts(p_amounts, 1) i
$f$;

-- ================= SEED (owner) =================
do $$ declare a uuid; n uuid; v uuid;
  -- a short order needs at least one menu line (check_short_order_menu_selections)
  sel jsonb := jsonb_build_array(jsonb_build_object('menu_item_id', (select menu_item_id from public.menu_item order by menu_item_id limit 1), 'quantity', 1));
begin
  insert into public.customer (first_name, last_name, contact_no, cus_address, email_address, username)
  values ('ZZTEST', 'Suki Acceptance', '09990001001', 'Acceptance test', 'zztest-suki-a@example.test', 'zztest_suki_a')
  returning customer_id into a;
  insert into public.customer (first_name, last_name, contact_no, cus_address, email_address, username)
  values ('ZZTEST', 'Standard Acceptance', '09990001002', 'Acceptance test', 'zztest-standard-n@example.test', 'zztest_standard_n')
  returning customer_id into n;
  perform set_config('test.a', a::text, true);
  perform set_config('test.n', n::text, true);

  insert into public.booking (booking_type, venue, event_datetime, pax_count, customer_id, booking_status, total_amount, delivery_fee, notes, menu_selections)
  values ('Short Order', 'Pickup - Main Branch', now() + interval '30 days', 20, a, 'Pending', 10000, 0, 'ACCEPTANCE TEST (rolled back)', sel)
  returning booking_id into v; perform set_config('test.b1', v::text, true);
  insert into public.booking (booking_type, venue, event_datetime, pax_count, customer_id, booking_status, total_amount, delivery_fee, notes, menu_selections)
  values ('Short Order', 'Pickup - Main Branch', now() + interval '20 days', 20, a, 'Pending', 8000, 0, 'ACCEPTANCE TEST (rolled back)', sel)
  returning booking_id into v; perform set_config('test.b2', v::text, true);
  insert into public.booking (booking_type, venue, event_datetime, pax_count, customer_id, booking_status, total_amount, delivery_fee, notes, menu_selections)
  values ('Short Order', 'Pickup - Main Branch', now() + interval '25 days', 20, n, 'Pending', 6000, 0, 'ACCEPTANCE TEST (rolled back)', sel)
  returning booking_id into v; perform set_config('test.b3', v::text, true);
  insert into public.booking (booking_type, venue, event_datetime, pax_count, customer_id, booking_status, total_amount, delivery_fee, notes, menu_selections)
  values ('Short Order', 'Pickup - Main Branch', now() + interval '26 days', 20, n, 'Pending', 6000, 0, 'ACCEPTANCE TEST (rolled back)', sel)
  returning booking_id into v; perform set_config('test.b4', v::text, true);

  insert into r select 'T00 seed: 2 test customers; short orders ' || string_agg(booking_number || ' ' || payment_plan, ', ' order by total_amount desc)
    from public.booking where notes = 'ACCEPTANCE TEST (rolled back)';
end $$;  -- no handler: a failed seed stops the run with its own error

-- ================= MANAGER =================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2fac82eb-cce5-40bb-9c30-3e379f9d6440","role":"authenticated"}', true);

-- §7.2 mark suki, block (flag clears), unblock, mark again
do $$ declare a uuid := current_setting('test.a')::uuid; c record; s record; begin
  perform public.f_set_customer_suki(a, true, 'Acceptance test: pays monthly');
  select is_suki, suki_since, suki_set_by, suki_note into c from public.customer where customer_id = a;
  select is_suki, suki_since, suki_note into s from public.v_customer_summary where customer_id = a;
  insert into r values ('T02a mark suki -> is_suki=' || c.is_suki || ', since set=' || (c.suki_since is not null)
    || ', set_by is this manager=' || coalesce((c.suki_set_by = private.f_current_manager_id())::text, 'null')
    || ', note=' || coalesce(c.suki_note, '-') || ' | v_customer_summary is_suki=' || coalesce(s.is_suki::text, 'no row')
    || ', since set=' || (s.suki_since is not null) || ', note=' || coalesce(s.suki_note, '-'));

  update public.customer set account_status = 'Blocked', status_reason = 'Acceptance test block', status_changed_by = private.f_current_manager_id()
   where customer_id = a;
  select account_status, is_suki, suki_since, suki_set_by into c from public.customer where customer_id = a;
  insert into r values ('T02b block -> status=' || c.account_status || ', is_suki=' || c.is_suki
    || ', since cleared=' || (c.suki_since is null) || ', set_by cleared=' || (c.suki_set_by is null));
  begin
    perform public.f_set_customer_suki(a, true, null);
    insert into r values ('T02c mark a blocked customer suki: ALLOWED (bad)');
  exception when others then insert into r values ('T02c mark a blocked customer suki refused: ' || sqlerrm); end;

  update public.customer set account_status = 'Active', status_reason = null, status_changed_by = private.f_current_manager_id()
   where customer_id = a;
  select account_status, is_suki into c from public.customer where customer_id = a;
  insert into r values ('T02d unblock -> status=' || c.account_status || ', is_suki=' || c.is_suki);
  perform public.f_set_customer_suki(a, true, 'Acceptance test: pays monthly');
  select is_suki, suki_since into c from public.customer where customer_id = a;
  insert into r values ('T02e mark suki again -> is_suki=' || c.is_suki || ', since set=' || (c.suki_since is not null));
exception when others then insert into r values ('T02 ERROR ' || sqlerrm); end $$;

-- §7.3 approve a short order on a 3-row plan (the default even split from today)
do $$ declare b uuid := current_setting('test.b1')::uuid; res jsonb; bk record; begin
  update public.booking
     set booking_status = 'Approved', status_order = 2, is_read = true, total_amount = 10000, delivery_fee = 0,
         notes = notes || E'\n[APPROVAL] Adjusted total: ₱10000'
   where booking_id = b;
  res := public.f_save_installment_plan(b, pg_temp.rows(array[3333.33, 3333.33, 3333.34]), null);
  select booking_status, payment_plan, confirmed_at is not null as conf into bk from public.booking where booking_id = b;
  insert into r values ('T03a approve + plan -> rpc says ' || (res->>'booking_status') || '; booking ' || bk.booking_status
    || '/' || bk.payment_plan || ', confirmed_at set=' || bk.conf);
  insert into r values ('T03b status history: ' || pg_temp.slog(b));
  insert into r values ('T03c card rows: ' || pg_temp.inst(b));
  insert into r values ('T03d money: ' || pg_temp.money(b));
exception when others then insert into r values ('T03 ERROR ' || sqlerrm); end $$;

-- §7.4 a 10% receipt (stage chosen the way stageForReceipt does)
do $$ declare b uuid := current_setting('test.b1')::uuid; a uuid := current_setting('test.a')::uuid; m record; p record; v_stage text; begin
  select verified_paid, total_amount into m from public.v_booking_money where booking_id = b;
  v_stage := case when m.verified_paid + 1000 >= m.total_amount - 0.005 then 'Fully Settled'
                  when m.verified_paid <= 0 then 'Deposit Collected' else 'Partially Settled' end;
  insert into public.payment (booking_id, customer_id, amount_paid, pay_method, pay_status, entry_type, receipt_reference, pay_datetime, pay_proof)
  values (b, a, 1000, 'Cash', v_stage, 'Receipt', 'ZZTEST-0001', now(), null)
  returning payment_id, pay_status into p;
  perform set_config('test.p1', p.payment_id::text, true);
  insert into r values ('T04a 10% receipt (P1000 of P10000) -> stored as ' || p.pay_status || '; booking '
    || (select booking_status from public.booking where booking_id = b));
  insert into r values ('T04b card rows: ' || pg_temp.inst(b));
  insert into r values ('T04c money: ' || pg_temp.money(b));
exception when others then insert into r values ('T04 ERROR ' || sqlerrm); end $$;

-- §7.5 edit to 5 installments with a reason; a wrong sum is refused
do $$ declare b uuid := current_setting('test.b1')::uuid; lg record; v_after int; begin
  begin
    perform public.f_save_installment_plan(b, pg_temp.rows(array[2000, 2000, 2000, 2000, 2000]::numeric[]), null);
    insert into r values ('T05a edit without a reason: ALLOWED (bad)');
  exception when others then insert into r values ('T05a edit without a reason refused: ' || sqlerrm); end;

  perform public.f_save_installment_plan(b, pg_temp.rows(array[2000, 2000, 2000, 2000, 2000]::numeric[]), 'Acceptance test: customer asked for smaller payments');
  select action, reason, jsonb_array_length(before_plan) nb, jsonb_array_length(after_plan) na into lg
    from public.booking_installment_log where booking_id = b and action = 'Updated';
  select count(*) into v_after from public.booking_installment i join public.booking bk on bk.booking_id = i.booking_id
   where i.booking_id = b and i.due_date > (bk.event_datetime at time zone 'Asia/Manila')::date;
  insert into r values ('T05b edit to 5 rows with a reason -> log ' || lg.action || ', reason "' || lg.reason || '", '
    || lg.nb || ' rows before -> ' || lg.na || ' after; ' || v_after || ' row(s) due after the event, accepted');
  insert into r values ('T05c card rows: ' || pg_temp.inst(b));

  begin
    perform public.f_save_installment_plan(b, pg_temp.rows(array[2000, 2000, 2000, 2000, 1999]::numeric[]), 'wrong sum');
    insert into r values ('T05d wrong sum: ALLOWED (bad)');
  exception when others then insert into r values ('T05d wrong sum refused: ' || sqlerrm); end;
  begin
    perform public.f_save_installment_plan(b, pg_temp.rows(array[5000.005, 4999.995]), 'three decimals');
    insert into r values ('T05e 3-decimal amounts: ALLOWED (bad)');
  exception when others then insert into r values ('T05e 3-decimal amounts refused: ' || sqlerrm); end;
  insert into r select 'T05f after the refused saves: ' || count(*) || ' rows, total P' || sum(amount)
    || ', log entries ' || (select count(*) from public.booking_installment_log where booking_id = b)
    from public.booking_installment where booking_id = b;
exception when others then insert into r values ('T05 ERROR ' || sqlerrm); end $$;

-- §7.6 reverse the receipt: the booking stays Confirmed
do $$ declare b uuid := current_setting('test.b1')::uuid; a uuid := current_setting('test.a')::uuid; bk record; begin
  insert into public.payment (booking_id, customer_id, amount_paid, pay_method, pay_status, entry_type,
                              reverses_payment_id, reversal_reason, pay_datetime, pay_proof)
  values (b, a, -1000, 'Cash', 'Reversed', 'Reversal', current_setting('test.p1')::uuid,
          'Acceptance test reversal of the 10% receipt', now(), null);
  select booking_status, coalesce(flagged_for_review, false) fl into bk from public.booking where booking_id = b;
  insert into r values ('T06a reverse the receipt -> booking ' || bk.booking_status || ', flagged=' || bk.fl);
  insert into r values ('T06b card rows: ' || pg_temp.inst(b));
  insert into r values ('T06c money: ' || pg_temp.money(b));
exception when others then insert into r values ('T06 ERROR ' || sqlerrm); end $$;

-- §7.7 override to Approved (and Pending) is refused
do $$ declare b uuid := current_setting('test.b1')::uuid; begin
  begin
    perform public.f_override_booking_status(b, 'Approved', 'Acceptance test override');
    insert into r values ('T07a override to Approved: ALLOWED (bad)');
  exception when others then insert into r values ('T07a override to Approved refused: ' || sqlerrm); end;
  begin
    perform public.f_override_booking_status(b, 'Pending', 'Acceptance test override');
    insert into r values ('T07b override to Pending: ALLOWED (bad)');
  exception when others then insert into r values ('T07b override to Pending refused: ' || sqlerrm); end;
  insert into r values ('T07c still ' || (select booking_status || '/' || payment_plan from public.booking where booking_id = b));
end $$;

-- §7.9 second booking: end the plan with less than 50% paid and a future event
do $$ declare b uuid := current_setting('test.b2')::uuid; a uuid := current_setting('test.a')::uuid; res jsonb; bk record; begin
  update public.booking
     set booking_status = 'Approved', status_order = 2, is_read = true, total_amount = 8000, delivery_fee = 0
   where booking_id = b;
  perform public.f_save_installment_plan(b, pg_temp.rows(array[2666.66, 2666.66, 2666.68]), null);
  insert into public.payment (booking_id, customer_id, amount_paid, pay_method, pay_status, entry_type, receipt_reference, pay_datetime, pay_proof)
  values (b, a, 1000, 'Cash', 'Deposit Collected', 'Receipt', 'ZZTEST-0002', now(), null);
  begin
    perform public.f_end_installment_plan(b, '   ');
    insert into r values ('T09a end plan without a reason: ALLOWED (bad)');
  exception when others then insert into r values ('T09a end plan without a reason refused: ' || sqlerrm); end;

  res := public.f_end_installment_plan(b, 'Acceptance test: customer will pay the standard way');
  select booking_status, payment_plan, coalesce(flagged_for_review, false) fl, flag_reason into bk from public.booking where booking_id = b;
  insert into r values ('T09b end plan (P1000 of P8000 paid, event in 20 days) -> reverted_to_approved=' || (res->>'reverted_to_approved')
    || '; booking ' || bk.booking_status || '/' || bk.payment_plan || ', flagged=' || bk.fl || ' (' || coalesce(bk.flag_reason, '-') || ')');
  insert into r select 'T09c installments left ' || (select count(*) from public.booking_installment where booking_id = b)
    || '; plan log ' || string_agg(action || coalesce(' "' || reason || '"', ''), ', ' order by changed_at, action)
    from public.booking_installment_log where booking_id = b;
  insert into r values ('T09d status history: ' || pg_temp.slog(b));
exception when others then insert into r values ('T09 ERROR ' || sqlerrm); end $$;

-- §7.10/§7.11 a non-suki customer: Standard approval, deposit, confirm
do $$ declare b uuid := current_setting('test.b3')::uuid; n uuid := current_setting('test.n')::uuid; chk jsonb; s text; begin
  update public.booking
     set booking_status = 'Approved', status_order = 2, is_read = true, total_amount = 6000, delivery_fee = 0
   where booking_id = b;
  insert into r values ('T10a approve (non-suki) -> ' || (select booking_status || '/' || payment_plan from public.booking where booking_id = b));
  begin
    perform public.f_save_installment_plan(b, pg_temp.rows(array[2000, 2000, 2000]::numeric[]), null);
    insert into r values ('T10b plan for a non-suki customer: ALLOWED (bad)');
  exception when others then insert into r values ('T10b plan for a non-suki customer refused: ' || sqlerrm); end;
  begin
    update public.booking set payment_plan = 'Installment' where booking_id = b;
    insert into r values ('T10c direct payment_plan write: ALLOWED (bad)');
  exception when others then insert into r values ('T10c direct payment_plan write refused: ' || sqlerrm); end;
  insert into r values ('T10d after both refusals: ' || (select booking_status || '/' || payment_plan from public.booking where booking_id = b));

  insert into public.payment (booking_id, customer_id, amount_paid, pay_method, pay_status, entry_type, receipt_reference, pay_datetime, pay_proof)
  values (b, n, 3000, 'Cash', 'Deposit Collected', 'Receipt', 'ZZTEST-0003', now(), null);
  select booking_status into s from public.booking where booking_id = b;
  insert into r values ('T11a Standard 50% deposit -> ' || s || '; history: ' || pg_temp.slog(b));
  if s = 'Approved' then  -- the web's Confirm step, if the trigger did not
    update public.booking set booking_status = 'Confirmed', status_order = 3, is_read = true where booking_id = b;
  end if;
  insert into r values ('T11b Standard money: ' || pg_temp.money(b));
  chk := public.f_completion_check(b);
  insert into r values ('T11c Standard completion check before the event: ' || coalesce(chk->>'reason', 'can complete') || ' - ' || coalesce(chk->>'message', ''));
exception when others then insert into r values ('T10/T11 ERROR ' || sqlerrm); end $$;

-- §7.11 Standard: a reversal below 50% still sends a future booking back to Approved
do $$ declare b uuid := current_setting('test.b4')::uuid; n uuid := current_setting('test.n')::uuid; p uuid; bk record; begin
  update public.booking
     set booking_status = 'Approved', status_order = 2, is_read = true, total_amount = 6000, delivery_fee = 0
   where booking_id = b;
  insert into public.payment (booking_id, customer_id, amount_paid, pay_method, pay_status, entry_type, receipt_reference, pay_datetime, pay_proof)
  values (b, n, 3000, 'Cash', 'Deposit Collected', 'Receipt', 'ZZTEST-0005', now(), null)
  returning payment_id into p;
  if (select booking_status from public.booking where booking_id = b) = 'Approved' then
    update public.booking set booking_status = 'Confirmed', status_order = 3, is_read = true where booking_id = b;
  end if;
  insert into public.payment (booking_id, customer_id, amount_paid, pay_method, pay_status, entry_type,
                              reverses_payment_id, reversal_reason, pay_datetime, pay_proof)
  values (b, n, -3000, 'Cash', 'Reversed', 'Reversal', p, 'Acceptance test Standard reversal', now(), null);
  select booking_status, coalesce(flagged_for_review, false) fl, flag_reason into bk from public.booking where booking_id = b;
  insert into r values ('T11f Standard reversal below 50% -> ' || bk.booking_status || ', flagged=' || bk.fl
    || ' (' || coalesce(bk.flag_reason, '-') || '); history: ' || pg_temp.slog(b));
exception when others then insert into r values ('T11f ERROR ' || sqlerrm); end $$;

-- ================= SEED: events to yesterday (owner) =================
reset role;
do $$ begin
  update public.booking set event_datetime = now() - interval '1 day'
   where booking_id in (current_setting('test.b1')::uuid, current_setting('test.b3')::uuid);
exception when others then insert into r values ('T08 SEED ERROR ' || sqlerrm); end $$;
set local role authenticated;

-- §7.8 complete the plan booking after the event, with a balance
do $$ declare b uuid := current_setting('test.b1')::uuid; chk jsonb; m record; begin
  chk := public.f_completion_check(b);
  insert into r values ('T08a event yesterday, nothing paid; completion check: can_complete=' || (chk->>'can_complete')
    || ', reason=' || coalesce(chk->>'reason', '-') || ', outstanding P' || (chk->>'outstanding'));
  update public.booking set booking_status = 'Completed', status_order = 4, is_read = true where booking_id = b;
  select booking_status, counts_toward_revenue, outstanding into m from public.v_booking_money where booking_id = b;
  insert into r values ('T08b Complete -> ' || m.booking_status || '; counts toward Receivables=' || m.counts_toward_revenue
    || ', outstanding P' || m.outstanding || '; money: ' || pg_temp.money(b));
  perform public.f_save_installment_plan(b, pg_temp.rows(array[5000, 5000]::numeric[]), 'Acceptance test: edit after completion');
  insert into r values ('T08c edit after completion with a reason -> ' || pg_temp.inst(b));
exception when others then insert into r values ('T08 ERROR ' || sqlerrm); end $$;

-- §7.11 Standard after the event: overdue by event date; complete only when paid
do $$ declare b uuid := current_setting('test.b3')::uuid; n uuid := current_setting('test.n')::uuid; chk jsonb; begin
  chk := public.f_completion_check(b);
  insert into r values ('T11d Standard, event yesterday, P3000 owed -> ' || pg_temp.money(b)
    || '; completion check: ' || coalesce(chk->>'reason', 'can complete') || ' - ' || coalesce(chk->>'message', ''));
  insert into public.payment (booking_id, customer_id, amount_paid, pay_method, pay_status, entry_type, receipt_reference, pay_datetime, pay_proof)
  values (b, n, 3000, 'Cash', 'Fully Settled', 'Receipt', 'ZZTEST-0004', now(), null);
  chk := public.f_completion_check(b);
  update public.booking set booking_status = 'Completed', status_order = 4, is_read = true where booking_id = b;
  insert into r values ('T11e Standard paid in full -> can_complete=' || (chk->>'can_complete') || '; after Complete: ' || pg_temp.money(b));
exception when others then insert into r values ('T11d/e ERROR ' || sqlerrm); end $$;

-- ================= §7.12 CLEAN UP (owner) =================
reset role;
do $$
declare
  ids uuid[] := array[current_setting('test.b1')::uuid, current_setting('test.b2')::uuid,
                      current_setting('test.b3')::uuid, current_setting('test.b4')::uuid];
  cs  uuid[] := array[current_setting('test.a')::uuid, current_setting('test.n')::uuid];
  np int; nb int; nc int;
begin
  insert into r select 'T12a before clean-up: installment rows ' || (select count(*) from public.booking_installment where booking_id = any(ids))
    || ', plan log rows ' || (select count(*) from public.booking_installment_log where booking_id = any(ids))
    || ', status log rows ' || (select count(*) from public.booking_status_log where booking_id = any(ids));
  -- payment -> booking is RESTRICT, so the entries go first (receipts and
  -- their reversals in one statement); the rest cascades from booking.
  delete from public.payment where booking_id = any(ids);
  get diagnostics np = row_count;
  delete from public.booking where booking_id = any(ids);
  get diagnostics nb = row_count;
  delete from public.customer where customer_id = any(cs);
  get diagnostics nc = row_count;
  insert into r values ('T12b deleted ' || np || ' payment entries, ' || nb || ' bookings, ' || nc || ' customers');
  insert into r values ('T12c left for the test ids: installments ' || (select count(*) from public.booking_installment where booking_id = any(ids))
    || ', plan log ' || (select count(*) from public.booking_installment_log where booking_id = any(ids))
    || ', status log ' || (select count(*) from public.booking_status_log where booking_id = any(ids))
    || ', payments ' || (select count(*) from public.payment where booking_id = any(ids))
    || ', bookings ' || (select count(*) from public.booking where booking_id = any(ids))
    || ', customers ' || (select count(*) from public.customer where customer_id = any(cs)));
  insert into r values ('T12d orphans anywhere: installments without a booking '
    || (select count(*) from public.booking_installment i where not exists (select 1 from public.booking b where b.booking_id = i.booking_id))
    || ', plan log without a booking '
    || (select count(*) from public.booking_installment_log l where not exists (select 1 from public.booking b where b.booking_id = l.booking_id)));
exception when others then insert into r values ('T12 ERROR ' || sqlerrm); end $$;

do $$ begin
  raise exception E'SUKI ACCEPTANCE TESTS (rolled back):\n%', (select string_agg(t, E'\n' order by t) from r);
end $$;
