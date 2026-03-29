create extension if not exists pg_trgm;

-- Operational logs for scheduled/background jobs.
create table if not exists public.job_runs (
  id bigint primary key generated always as identity,
  job_name text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null check (status in ('running', 'success', 'failed')),
  summary_json jsonb not null default '{}'::jsonb,
  error_text text,
  created_at timestamptz not null default now()
);

create index if not exists idx_job_runs_job_name_started_at
  on public.job_runs (job_name, started_at desc);

-- News items collected from external sources/APIs.
create table if not exists public.news_articles (
  id bigint primary key generated always as identity,
  external_id text,
  source_name text not null,
  source_url text,
  url text not null unique,
  title text not null,
  published_at timestamptz not null,
  language text not null default 'en',
  region text,
  summary text,
  content text,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_news_articles_published_at
  on public.news_articles (published_at desc);
create index if not exists idx_news_articles_source_name
  on public.news_articles (source_name);
create index if not exists idx_news_articles_title_trgm
  on public.news_articles using gin (title gin_trgm_ops);
create index if not exists idx_news_articles_content_trgm
  on public.news_articles using gin (content gin_trgm_ops);

-- AI-scored linkage between a route and a specific news article.
create table if not exists public.route_news_impacts (
  id bigint primary key generated always as identity,
  route_id bigint not null references public.routes (id) on delete cascade,
  article_id bigint not null references public.news_articles (id) on delete cascade,
  event_type text not null check (
    event_type in (
      'weather',
      'strike',
      'conflict',
      'piracy',
      'closure',
      'congestion',
      'regulatory',
      'accident',
      'other'
    )
  ),
  severity smallint not null check (severity between 1 and 5),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  impact_score numeric(8,3) not null,
  impact_direction text not null default 'up'
    check (impact_direction in ('up', 'down')),
  source_reliability numeric(4,3) not null default 0.6
    check (source_reliability between 0 and 1),
  reason text not null,
  model_explanation text,
  evidence jsonb not null default '[]'::jsonb,
  model_name text,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint route_news_impacts_unique_route_article unique (route_id, article_id)
);

create index if not exists idx_route_news_impacts_route_id
  on public.route_news_impacts (route_id);
create index if not exists idx_route_news_impacts_article_id
  on public.route_news_impacts (article_id);
create index if not exists idx_route_news_impacts_effective_window
  on public.route_news_impacts (effective_from desc, effective_to);
create index if not exists idx_route_news_impacts_event_type
  on public.route_news_impacts (event_type);
create index if not exists idx_route_news_impacts_effective_to
  on public.route_news_impacts (effective_to);

-- Audit trail of risk calculations over time.
create table if not exists public.route_risk_snapshots (
  id bigint primary key generated always as identity,
  route_id bigint not null references public.routes (id) on delete cascade,
  snapshot_at timestamptz not null default now(),
  base_risk_percentage smallint not null check (base_risk_percentage between 1 and 99),
  news_delta numeric(8,3) not null default 0,
  final_risk_percentage smallint not null check (final_risk_percentage between 1 and 99),
  explanation text,
  drivers jsonb not null default '[]'::jsonb,
  calculation_version text not null default 'v1',
  created_by text not null default 'system',
  created_at timestamptz not null default now()
);

create index if not exists idx_route_risk_snapshots_route_id_snapshot_at
  on public.route_risk_snapshots (route_id, snapshot_at desc);
create index if not exists idx_route_risk_snapshots_snapshot_at
  on public.route_risk_snapshots (snapshot_at desc);
create index if not exists idx_route_risk_snapshots_final_risk
  on public.route_risk_snapshots (final_risk_percentage desc);

alter table public.route_news_impacts
  add column if not exists impact_direction text not null default 'up'
    check (impact_direction in ('up', 'down'));
alter table public.route_news_impacts
  add column if not exists source_reliability numeric(4,3) not null default 0.6
    check (source_reliability between 0 and 1);
alter table public.route_news_impacts
  add column if not exists model_explanation text;

-- Convenience view: latest risk snapshot per route.
create or replace view public.v_route_current_risk as
select distinct on (s.route_id)
  s.route_id,
  s.snapshot_at,
  s.base_risk_percentage,
  s.news_delta,
  s.final_risk_percentage,
  s.explanation,
  s.drivers,
  s.calculation_version
from public.route_risk_snapshots s
order by s.route_id, s.snapshot_at desc;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_news_articles_updated_at on public.news_articles;
create trigger trg_news_articles_updated_at
before update on public.news_articles
for each row execute function public.set_updated_at();

drop trigger if exists trg_route_news_impacts_updated_at on public.route_news_impacts;
create trigger trg_route_news_impacts_updated_at
before update on public.route_news_impacts
for each row execute function public.set_updated_at();
