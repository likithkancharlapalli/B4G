# SupplyWatch

AI-powered mission control for resilient maritime supply chains.

SupplyWatch helps logistics teams detect route risk early, understand why risk changed, and act fast with safer route recommendations between the same origin and destination ports.

## Table of Contents

- [Overview](#overview)
- [Core Features](#core-features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Repository Structure](#repository-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Runbook](#runbook)
- [API Reference](#api-reference)
- [Data and Schema](#data-and-schema)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Security Notes](#security-notes)
- [Roadmap](#roadmap)
- [License](#license)

## Overview

Global shipping disruptions can propagate quickly across supply networks. Most operations teams have fragmented sources (news feeds, manual alerts, internal notes), which slows decision-making.

SupplyWatch consolidates this into a single operational surface:

- Real-time route and port visualization on a 3D globe
- Dynamic route risk scoring (base risk + intelligence delta)
- Explainable risk drivers
- Safer route suggestions with clear map highlighting
- Alert-driven operations workflow

## Core Features

- **Global route visibility**
  - Visualizes ports and shipping lanes on an interactive globe.
- **Route intelligence panel**
  - Shows base risk, final risk, risk delta, update recency, and driver links.
- **AI-assisted risk updates**
  - Ingests disruption signals and updates route risk snapshots.
- **Safer route recommendation**
  - Suggests alternatives for critical routes and highlights them as dotted lines.
  - Supports demo-mode synthetic detours for specific route pairs.
- **Actionable alerts**
  - Route-level news impacts are surfaced in a paginated alerts panel.
- **Operational status**
  - News ingest job status endpoint and UI status indicators.

## Architecture

```text
Frontend (React + Vite + Three.js)
        |
        | HTTP (REST)
        v
Backend (Node.js + Express)
        |
        | Supabase client
        v
Supabase (PostgreSQL/PostGIS)
        ^
        | scheduled or manual ingest
News + Risk Ingestion Pipeline
```

### Runtime Flow

1. Frontend fetches routes, ports, alerts, and job status from backend endpoints.
2. Backend normalizes route geometry, computes base risk, and merges latest AI/news risk snapshot.
3. Backend attaches recommendation metadata (including demo detours when enabled).
4. Frontend renders selected route vs safer dotted route with route intelligence and alerts.

## Tech Stack

- **Frontend:** React, TypeScript, Vite, Three.js, Tailwind CSS, `lucide-react`
- **Backend:** Node.js (ESM), Express, `@supabase/supabase-js`, `fast-xml-parser`
- **Database:** Supabase PostgreSQL (+ PostGIS support via schema)
- **Testing:** Node test runner (`node --test`)
- **Optional AI integration:** Gemini API (route selection), optional OpenAI path in ingestion config

## Repository Structure

```text
B4G/
  backend/
    server.mjs                      # Main REST API
    news-risk-ingest.mjs            # News/risk ingestion pipeline
    http-contracts.mjs              # API response contract builders
    supabase-news-risk-schema.sql   # DB schema/migrations for risk pipeline
    tests/
      api-contracts.test.mjs
      news-risk-ingest.test.mjs
    ops-news-ingest-cron.md         # Scheduling examples
  frontend/
    src/
      App.tsx
      lib/api.ts
      components/
      types/
  pre_processing_layer/
    fetch_routes.py                 # Data preparation helper
```

## Getting Started

### Prerequisites

- Node.js 18+ (recommended 20+)
- npm
- Supabase project (URL + API keys)

### 1) Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2) Configure environment files

Backend:

```bash
cp backend/.env.example backend/.env
```

Frontend:

```bash
cp frontend/.env.example frontend/.env
```

Fill required values (see [Environment Variables](#environment-variables)).

### 3) Run backend

```bash
cd backend
npm run start
```

> Note: `npm run dev` uses file watching and can hit `EMFILE` on some machines. Use `npm run start` if that occurs.

### 4) Run frontend

```bash
cd frontend
npm run dev
```

Open `http://localhost:5173`.

## Environment Variables

### Backend (`backend/.env`)

Required:

- `PORT` (default `4000`)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (or fallback `SUPABASE_ANON_KEY`)

Core tables:

- `SUPABASE_VENDORS_TABLE`
- `SUPABASE_ALERTS_TABLE`
- `SUPABASE_PORTS_TABLE`
- `SUPABASE_ROUTES_TABLE`

News/risk pipeline:

- `NEWS_JOB_TOKEN`
- `NEWS_JOB_MIN_INTERVAL_SEC`
- `NEWS_STALE_THRESHOLD_HOURS`
- `NEWS_MAX_ARTICLES`
- `NEWS_MIN_ROUTE_MATCH_SCORE`
- `NEWS_RSS_FEEDS`

Gemini route optimizer:

- `GEMINI_API_KEY`
- `GEMINI_MODEL` (default `gemini-2.5-flash`)
- `GEMINI_ROUTE_OPTIMIZER_ENABLED`
- `GEMINI_TIMEOUT_MS`
- `GEMINI_MAX_CANDIDATES`
- `GEMINI_MAX_DECISIONS_PER_REQUEST`

Demo routing mode:

- `DEMO_SYNTHETIC_SAFER_ROUTE_ENABLED=true|false`

### Frontend (`frontend/.env`)

- `VITE_API_BASE_URL` (e.g. `http://localhost:4000`)
- `VITE_NEWS_JOB_TOKEN` (optional; demo trigger only)

## Runbook

- **Import routes data**
  - `cd backend && npm run import:routes`
  - `npm run import:routes:replace` to replace existing route records.
- **Run news ingest once**
  - `cd backend && npm run ingest:news`
- **Check Supabase connectivity**
  - `cd backend && npm run check:supabase`

## API Reference

Health:

- `GET /health`

Core data:

- `GET /api/vendors`
- `GET /api/alerts`
- `GET /api/dashboard`
- `GET /api/ports`
- `GET /api/routes`
- `GET /api/v2/routes` (explicit pagination default)

Risk and jobs:

- `GET /api/routes/:id/risk-history`
- `GET /api/jobs/news-risk-status`
- `POST /api/jobs/news-risk-ingest` (requires header `x-job-token`)

## Data and Schema

- Apply `backend/supabase-news-risk-schema.sql` in Supabase SQL editor to create required risk/news tables and indexes.
- Recommendation output includes:
  - route-level risk metadata
  - recommendation source (`gemini`, `heuristic`, or `demo`)
  - optional synthetic geometry points for demo-mode detours

## Testing

Backend tests:

```bash
cd backend
npm test
```

Frontend production build check:

```bash
cd frontend
npm run build
```

## Troubleshooting

- **Frontend cannot load `RouteDetailPanel.tsx`**
  - Ensure file exists under `frontend/src/components/RouteDetailPanel.tsx`.
- **Backend fails with `EADDRINUSE`**
  - Port `4000` is already occupied. Stop previous backend process and restart.
- **Backend fails with `EMFILE` during `npm run dev`**
  - Use `npm run start` (non-watch mode).
- **No safer route visible**
  - Verify recommendation exists in `/api/routes` response.
  - Confirm `DEMO_SYNTHETIC_SAFER_ROUTE_ENABLED=true` for demo behavior.
- **AI status shows unavailable**
  - Validate `NEWS_JOB_TOKEN`, schema migration, and job run history table.

## Security Notes

- Do not commit real keys/tokens.
- Keep service-role keys server-side only.
- Treat exposed keys as compromised: rotate immediately.
- For production, avoid exposing job trigger tokens to frontend clients.

## Roadmap

- Integrate richer real-time maritime feeds (AIS, weather, port ops)
- Multi-objective optimization (risk, cost, transit time, reliability)
- Team workflow features (assignment, escalation, acknowledgements)
- Enhanced observability and SLA-backed job scheduling

## License

No license file is currently included. Add one if you plan to open-source this repository.

