create table if not exists public.vendors (
  id bigint primary key generated always as identity,
  name text not null,
  country text not null,
  flag text not null,
  lat double precision not null,
  lng double precision not null,
  material text not null,
  risk integer not null default 0,
  lead_time integer not null default 0,
  cost_delta integer not null default 0,
  status text not null default 'Stable',
  tier text not null default 'green',
  alternatives jsonb not null default '[]'::jsonb
);

create table if not exists public.alerts (
  id bigint primary key generated always as identity,
  vendor_id bigint references public.vendors (id) on delete cascade,
  tier text not null default 'yellow',
  region text not null,
  msg text not null,
  time text not null
);
