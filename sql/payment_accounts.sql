-- payment_accounts.sql
--
-- NOT APPLIED. For Vaughn to run in the Supabase SQL editor.
--
-- The GCash and bank accounts customers pay into (29 Sep 2026). The manager
-- edits them on Settings -> Payment Details; the customer mobile app reads the
-- active ones and shows them when the customer pays online.
--
-- One row per account, so the business can list more than one (e.g. GCash and
-- two banks) and switch one off without deleting it.
--
-- SHARED DATABASE: the customer app reads this table. Contract for it:
--   select method, bank_name, account_name, account_number, qr_image_url,
--          instructions
--   from payment_account
--   where is_active
--   order by sort_order, method, account_name;
-- Anyone may read the ACTIVE rows (anon + authenticated) — the same exposure as
-- packages and menu items, and the details are meant to be given to customers.
-- Only a manager can add, change or remove rows.

begin;

create table public.payment_account (
  account_id     uuid primary key default gen_random_uuid(),
  method         varchar(20) not null
                 check (method in ('GCash', 'Bank Transfer')),
  bank_name      text,
  account_name   text not null check (btrim(account_name) <> ''),
  account_number text not null check (btrim(account_number) <> ''),
  qr_image_url   text,
  instructions   text,
  is_active      boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.manager(manager_id) on delete set null,
  -- A bank transfer is useless to the customer without the bank's name.
  constraint payment_account_bank_name_check
    check (method <> 'Bank Transfer' or (bank_name is not null and btrim(bank_name) <> ''))
);

alter table public.payment_account enable row level security;

-- Same expression as package / menu_item / vehicle "Manager full access".
create policy "Manager full access" on public.payment_account
  for all
  using (auth.uid() in (select manager.user_id from public.manager))
  with check (auth.uid() in (select manager.user_id from public.manager));

-- Customers (and the logged-out app) see only what is switched on.
create policy "Customers can read active payment accounts" on public.payment_account
  for select to anon, authenticated
  using (is_active);

grant select on public.payment_account to anon, authenticated;
grant insert, update, delete on public.payment_account to authenticated;

-- So an open customer app (or a second manager tab) sees an edit at once.
alter publication supabase_realtime add table public.payment_account;

commit;

-- Check after running (expect 0 rows, no error):
--   select * from public.payment_account;
