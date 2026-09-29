-- Role-by-role security checks for CaterSync (29 Sep 2026).
-- Safe to run on the live database: it acts as each app user in turn, records
-- what happened, then raises an error at the end so EVERYTHING is rolled back.
-- The results are printed in that final error message.
-- Uses real account ids from the Sep 2026 data; update them if those accounts change.

create temp table r(t text);
grant all on r to public;

-- ================= CUSTOMER (own customer d8391a6c) =================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"181df233-4de0-48b0-9063-c561bf56d1b2","role":"authenticated"}', true);

do $$ declare v uuid; b record; begin
  insert into booking (booking_type, venue, event_datetime, pax_count, customer_id, package_id,
                       booking_status, total_amount, delivery_fee, menu_selections, notes, approval_fee)
  select booking_type, venue, now() + interval '20 days', pax_count, customer_id, package_id,
         'Confirmed', total_amount, delivery_fee, menu_selections, 'dry-run', 999
    from booking where booking_id = '3616fd3a-4aa6-48cb-ba79-57cd03ca3456'
  returning booking_id into v;
  select * into b from booking where booking_id = v;
  insert into r values ('C01 customer creates booking asking for Confirmed: status='||b.booking_status||' approval_fee='||b.approval_fee);
  perform set_config('test.newbk', v::text, true);
exception when others then insert into r values ('C01 ERROR '||sqlerrm); end $$;

do $$ declare v uuid := current_setting('test.newbk')::uuid; b record; begin
  update booking set pax_count = pax_count + 10, total_amount = 1234 where booking_id = v;
  update booking set booking_status = 'Confirmed' where booking_id = v;
  select * into b from booking where booking_id = v;
  insert into r values ('C02 edit own Pending booking: pax='||b.pax_count||' total='||b.total_amount||' status after asking Confirmed='||b.booking_status);
  update booking set booking_status = 'Cancelled' where booking_id = v;
  select * into b from booking where booking_id = v;
  insert into r values ('C03 customer cancels own booking: status='||b.booking_status);
exception when others then insert into r values ('C02/03 ERROR '||sqlerrm); end $$;

do $$ declare b record; n int; begin
  update booking set total_amount = 1, notes = coalesce(notes,'')||' ' where booking_id = '3036dc6e-fb61-400c-b6e5-bd0481a0cc29';
  get diagnostics n = row_count;
  select * into b from booking where booking_id = '3036dc6e-fb61-400c-b6e5-bd0481a0cc29';
  insert into r values ('C04 customer sets total=1 on own Confirmed booking: rows='||n||' total='||b.total_amount||' status='||b.booking_status);
exception when others then insert into r values ('C04 ERROR '||sqlerrm); end $$;

do $$ begin
  insert into booking (booking_type, venue, event_datetime, pax_count, customer_id, package_id, booking_status, total_amount)
  values ('Package','x', now()+interval '20 days', 50, (select customer_id from booking where booking_id='f2069a82-befa-4cb3-aa1c-7ac166d25ab6'), '947d8637-aed4-436a-9ef9-542a331134ee','Pending', 100);
  insert into r values ('C05 booking for SOMEONE ELSE: ALLOWED (bad)');
exception when others then insert into r values ('C05 booking for someone else blocked: '||sqlerrm); end $$;

do $$ declare p record; bs text; begin
  insert into payment (amount_paid, pay_method, pay_status, pay_proof, pay_datetime, booking_id, customer_id)
  values (100, 'GCash', 'Fully Settled', 'payments/dryrun.jpg', now(), '3036dc6e-fb61-400c-b6e5-bd0481a0cc29', 'd8391a6c-2854-4454-b8dd-fcb3cc15d8ed')
  returning * into p;
  select booking_status into bs from booking where booking_id = '3036dc6e-fb61-400c-b6e5-bd0481a0cc29';
  insert into r values ('C06 customer pays own booking claiming Fully Settled: stored pay_status='||p.pay_status||' entry='||p.entry_type||' booking still '||bs);
exception when others then insert into r values ('C06 ERROR '||sqlerrm); end $$;

do $$ begin
  insert into payment (amount_paid, pay_method, pay_status, pay_proof, pay_datetime, booking_id, customer_id)
  values (100, 'GCash', 'Pending Verification', 'payments/dryrun.jpg', now(), 'f2069a82-befa-4cb3-aa1c-7ac166d25ab6', 'd8391a6c-2854-4454-b8dd-fcb3cc15d8ed');
  insert into r values ('C07 payment against someone else''s booking: ALLOWED (bad)');
exception when others then insert into r values ('C07 payment on other booking blocked: '||sqlerrm); end $$;

do $$ begin
  insert into manager (first_name, last_name, contact_no, username, user_id)
  values ('Evil','Customer','09000000000','evil','181df233-4de0-48b0-9063-c561bf56d1b2');
  insert into r values ('C08 customer made themselves MANAGER (bad)');
exception when others then insert into r values ('C08 customer->manager blocked: '||sqlerrm); end $$;

do $$ declare c record; begin
  update customer set contact_no = '09111111111', account_status = 'Blocked', source = 'Walk-in'
   where user_id = '181df233-4de0-48b0-9063-c561bf56d1b2';
  select * into c from customer where user_id = '181df233-4de0-48b0-9063-c561bf56d1b2';
  insert into r values ('C09 profile edit: contact='||c.contact_no||' status='||c.account_status||' source='||c.source);
exception when others then insert into r values ('C09 ERROR '||sqlerrm); end $$;

do $$ begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('images', 'payments/dryrun-181df233.jpg', '181df233-4de0-48b0-9063-c561bf56d1b2', '{"mimetype":"image/jpeg"}');
  insert into r values ('C10 upload into payments/: allowed');
exception when others then insert into r values ('C10 upload into payments/ ERROR '||sqlerrm); end $$;

do $$ begin
  insert into storage.objects (bucket_id, name, owner_id) values ('images', 'menu/dryrun-evil.jpg', '181df233-4de0-48b0-9063-c561bf56d1b2');
  insert into r values ('C11 customer upload into menu/: ALLOWED (bad)');
exception when others then insert into r values ('C11 customer upload into menu/ blocked: '||sqlerrm); end $$;

do $$ declare n int; m int; begin
  select count(*) into n from storage.objects where bucket_id='images' and name like 'payments/%';
  select count(*) into m from storage.objects where bucket_id='images' and name like 'menu/%';
  insert into r values ('C12 customer can list payments/ files: '||n||' (own only), menu/ files: '||m);
exception when others then insert into r values ('C12 ERROR '||sqlerrm); end $$;

do $$ declare x boolean; begin
  perform public.f_maybe_confirm_booking('3036dc6e-fb61-400c-b6e5-bd0481a0cc29');
  insert into r values ('C13 customer can call f_maybe_confirm_booking (unexpected)');
exception when others then insert into r values ('C13 f_maybe_confirm_booking from app blocked: '||sqlerrm); end $$;

do $$ declare n int; begin
  select count(*) into n from v_customer_balance;
  insert into r values ('C14 v_customer_balance rows visible to customer: '||n);
exception when others then insert into r values ('C14 ERROR '||sqlerrm); end $$;
reset role;

-- ================= NEW SIGN-UP (user with no customer row yet) =================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8e4b81b7-b119-40f9-8ff0-5eb9e7e87a25","role":"authenticated"}', true);
do $$ declare c record; begin
  insert into customer (first_name, last_name, account_status, cus_address, email_address, contact_no, user_id, username)
  values ('Dry','Run','Active','Bayawan','dryrun-signup@example.com','09123456789','8e4b81b7-b119-40f9-8ff0-5eb9e7e87a25','dryrun')
  returning * into c;
  insert into r values ('S01 mobile sign-up creates own customer row: status='||c.account_status||' source='||c.source);
exception when others then insert into r values ('S01 ERROR '||sqlerrm); end $$;
reset role;

-- ================= SIGNED OUT (anon) =================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  insert into customer (first_name, last_name, email_address, contact_no, cus_address) values ('Anon','Spam','spam@example.com','09000000001','x');
  insert into r values ('A01 signed-out customer insert: ALLOWED (bad)');
exception when others then insert into r values ('A01 signed-out customer insert blocked: '||sqlerrm); end $$;
do $$ begin
  insert into booking (booking_type, venue, event_datetime, pax_count, booking_status, total_amount)
  values ('Package','x', now()+interval '20 days', 50, 'Pending', 1);
  insert into r values ('A02 signed-out booking insert: ALLOWED (bad)');
exception when others then insert into r values ('A02 signed-out booking insert blocked: '||sqlerrm); end $$;
do $$ declare p int; c int; m int; pa int; begin
  select count(*) into p from package; select count(*) into c from category;
  select count(*) into m from menu_item; select count(*) into pa from payment_account;
  insert into r values ('A03 signed-out browsing still works: packages='||p||' categories='||c||' menu='||m||' payment accounts='||pa);
exception when others then insert into r values ('A03 ERROR '||sqlerrm); end $$;
do $$ declare n int; m int; begin
  select count(*) into n from storage.objects where bucket_id='images' and name like 'payments/%';
  select count(*) into m from storage.objects where bucket_id='images' and name like 'packages/%';
  insert into r values ('A04 signed-out can list payment proofs: '||n||', package images: '||m);
exception when others then insert into r values ('A04 ERROR '||sqlerrm); end $$;
reset role;

-- ================= OPERATIONS MANAGER =================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cd262791-bb6d-45bf-8d0f-6272d1afee8b","role":"authenticated"}', true);
do $$ declare b record; n int; begin
  update booking set booking_status = 'Completed', total_amount = 1 where booking_id = '39d1b967-8243-4e3c-8fa3-443fb8fe9ffe';
  get diagnostics n = row_count;
  select * into b from booking where booking_id = '39d1b967-8243-4e3c-8fa3-443fb8fe9ffe';
  insert into r values ('O01 ops completes Confirmed booking (and tries total=1): rows='||n||' status='||b.booking_status||' total='||b.total_amount);
exception when others then insert into r values ('O01 ERROR '||sqlerrm); end $$;
do $$ declare n int; begin
  update booking_equipment set return_checked_at = return_checked_at where booking_id = '3036dc6e-fb61-400c-b6e5-bd0481a0cc29';
  get diagnostics n = row_count;
  update vehicle_assign set assignment_status = assignment_status where booking_id = '3036dc6e-fb61-400c-b6e5-bd0481a0cc29';
  insert into r values ('O02 ops can still update equipment returns: rows='||n);
exception when others then insert into r values ('O02 ERROR '||sqlerrm); end $$;
reset role;

-- ================= MAIN COOK =================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e0f1b4d3-068e-4651-bd47-5c979a775a81","role":"authenticated"}', true);
do $$ declare x boolean; n int; begin
  select public.is_main_cook() into x;
  select count(*) into n from booking;
  insert into r values ('M01 main cook: is_main_cook='||x||' bookings visible='||n||' can call replace_menu_ingredients='||has_function_privilege('replace_menu_ingredients(uuid,integer,jsonb)','execute'));
exception when others then insert into r values ('M01 ERROR '||sqlerrm); end $$;
reset role;

-- ================= MANAGER =================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2fac82eb-cce5-40bb-9c30-3e379f9d6440","role":"authenticated"}', true);
do $$ declare b record; n int; begin
  update booking set total_amount = total_amount + 1 where booking_id = '3036dc6e-fb61-400c-b6e5-bd0481a0cc29';
  select * into b from booking where booking_id = '3036dc6e-fb61-400c-b6e5-bd0481a0cc29';
  select count(*) into n from storage.objects where bucket_id='images' and name like 'payments/%';
  insert into r values ('G01 manager edits total: total='||b.total_amount||'; sees payment proofs: '||n);
exception when others then insert into r values ('G01 ERROR '||sqlerrm); end $$;
do $$ begin
  insert into storage.objects (bucket_id, name, owner_id) values ('images', 'menu/dryrun-manager.jpg', '2fac82eb-cce5-40bb-9c30-3e379f9d6440');
  insert into r values ('G02 manager upload into menu/: allowed');
exception when others then insert into r values ('G02 ERROR '||sqlerrm); end $$;
reset role;

do $$ begin
  raise exception E'DRY-RUN RESULTS (rolled back):\n%', (select string_agg(t, E'\n' order by t) from r);
end $$;
