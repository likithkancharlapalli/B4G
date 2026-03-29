create extension if not exists postgis;

-- routes.json coordinates are projected meters (looks like EPSG:3857),
-- even though keys are named "lon"/"lat".
create table if not exists public.routes (
  id bigint primary key generated always as identity,

  lane_id integer not null,
  lane_type text not null check (lane_type in ('Major', 'Minor', 'Intermediate')),
  distance_km numeric(10, 2) not null check (distance_km >= 0),

  -- Keep JSON shapes exactly as in routes.json
  geometry jsonb not null,
  origin_port jsonb not null,
  dest_port jsonb not null,

  -- Extracted convenience fields for filtering/joins
  origin_port_id bigint generated always as ((origin_port ->> 'id')::bigint) stored,
  dest_port_id bigint generated always as ((dest_port ->> 'id')::bigint) stored,
  origin_port_name text generated always as (origin_port ->> 'name') stored,
  dest_port_name text generated always as (dest_port ->> 'name') stored,

  -- Optional PostGIS columns for spatial operations
  source_srid integer not null default 3857,
  geom_line geometry(LineString, 3857),
  origin_geom geometry(Point, 3857),
  dest_geom geometry(Point, 3857),

  raw_record jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint routes_geometry_array check (jsonb_typeof(geometry) = 'array'),
  constraint routes_origin_port_object check (jsonb_typeof(origin_port) = 'object'),
  constraint routes_dest_port_object check (jsonb_typeof(dest_port) = 'object')
);

create index if not exists idx_routes_lane_type on public.routes (lane_type);
create index if not exists idx_routes_lane_id on public.routes (lane_id);
create index if not exists idx_routes_distance_km on public.routes (distance_km desc);
create index if not exists idx_routes_origin_port_id on public.routes (origin_port_id);
create index if not exists idx_routes_dest_port_id on public.routes (dest_port_id);

create index if not exists idx_routes_geom_line on public.routes using gist (geom_line);
create index if not exists idx_routes_origin_geom on public.routes using gist (origin_geom);
create index if not exists idx_routes_dest_geom on public.routes using gist (dest_geom);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_routes_updated_at on public.routes;
create trigger trg_routes_updated_at
before update on public.routes
for each row execute function public.set_updated_at();
