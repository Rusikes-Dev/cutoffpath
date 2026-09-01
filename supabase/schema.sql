-- =====================================================================
-- CutoffPath — Supabase schema
-- Run this once in Supabase → SQL Editor → New query → Run.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- students
create table if not exists public.students (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null default '',
  email               text not null,
  phone               text not null,
  access              boolean not null default false,
  access_token        text unique,
  source              text not null default 'payment',   -- 'payment' | 'admin'
  amount_paise        integer not null default 0,
  razorpay_order_id   text,
  razorpay_payment_id text,
  percentile          numeric,
  merit_rank          integer,
  category            text,
  gender              text,
  created_at          timestamptz not null default now(),
  last_seen_at        timestamptz not null default now()
);

create unique index if not exists students_email_phone_idx
  on public.students (lower(email), phone);
create index if not exists students_token_idx   on public.students (access_token);
create index if not exists students_created_idx on public.students (created_at desc);

-- ------------------------------------------------------------------ orders
create table if not exists public.orders (
  id                  uuid primary key default gen_random_uuid(),
  razorpay_order_id   text unique not null,
  razorpay_payment_id text,
  name                text,
  email               text,
  phone               text,
  amount_paise        integer not null default 4900,
  status              text not null default 'created',   -- created | paid | failed
  percentile          numeric,
  merit_rank          integer,
  category            text,
  gender              text,
  created_at          timestamptz not null default now()
);

create index if not exists orders_status_idx  on public.orders (status, created_at desc);

-- ------------------------------------------------------------------ events
create table if not exists public.events (
  id         bigserial primary key,
  type       text not null,
  student_id uuid references public.students(id) on delete set null,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_type_time_idx on public.events (type, created_at desc);
create index if not exists events_time_idx      on public.events (created_at desc);

-- ----------------------------------------------------------------- choices
-- Optional: server-side backup of a student's choice list.
create table if not exists public.choices (
  student_id uuid primary key references public.students(id) on delete cascade,
  payload    jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------- settings
-- Site-wide switches the owner flips from /admin. Currently just one:
--   access_mode = 'paid'  (default) or 'free'
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.settings (key, value)
values ('access_mode', '"paid"'::jsonb)
on conflict (key) do nothing;

-- =====================================================================
-- Row Level Security
-- Every table is locked down. The serverless functions use the
-- service_role key, which bypasses RLS. Nothing is reachable from the
-- browser with the anon key, which is exactly what we want.
-- =====================================================================
alter table public.students enable row level security;
alter table public.orders   enable row level security;
alter table public.events   enable row level security;
alter table public.choices  enable row level security;
alter table public.settings enable row level security;

-- (No policies are created on purpose: deny-by-default.)

-- =====================================================================
-- Optional: cutoff table, if you would rather query the data from
-- Postgres than ship the JSON shards. Import supabase/cutoffs.csv
-- through Table Editor → Import data from CSV after creating this.
-- The site does NOT need this table to work.
-- =====================================================================
create table if not exists public.cutoffs (
  id                 bigserial primary key,
  college_code       text not null,
  college_name       text not null,
  status             text,
  home_university    text,
  region             text,
  course_code        text not null,
  branch             text not null,
  branch_group       text,
  seat_type          text not null,
  cap_round          smallint not null,
  closing_rank       integer,
  closing_percentile numeric not null
);

create index if not exists cutoffs_lookup_idx
  on public.cutoffs (seat_type, closing_percentile);
create index if not exists cutoffs_college_idx on public.cutoffs (college_code);
create index if not exists cutoffs_branch_idx  on public.cutoffs (branch_group);

alter table public.cutoffs enable row level security;
create policy "cutoffs are public" on public.cutoffs for select using (true);
