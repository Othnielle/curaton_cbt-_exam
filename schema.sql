-- Run once in the Neon SQL Editor. To seed a different admin email, change it below first.
create table if not exists settings (
  id int primary key default 1 check (id = 1),
  open boolean not null default false,
  code text not null default '',
  minutes int not null default 15
);
insert into settings default values on conflict do nothing;

create table if not exists admins (
  id serial primary key,
  email text unique not null,
  pw text,                         -- empty until first login, then a salted scrypt hash
  failed int not null default 0,
  locked_until timestamptz
);
insert into admins (email) values ('othnielchuks@gmail.com') on conflict do nothing;

create table if not exists attempts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cls text,
  started_at timestamptz not null default now(),
  last_seen timestamptz,
  answered int not null default 0,
  submitted_at timestamptz,
  score int, total int, pct int, used int,
  auto boolean not null default false,
  late boolean not null default false,
  detail jsonb                     -- [[topic, 1|0], ...] for topic analytics
);
create index if not exists attempts_started on attempts (started_at desc);
