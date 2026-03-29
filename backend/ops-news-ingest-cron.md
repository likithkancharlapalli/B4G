# News Ingestion Scheduling

Use one of these options to trigger `POST /api/jobs/news-risk-ingest` every 2-4 hours.

## Option A: cron + curl (server-hosted)

1. Export `NEWS_JOB_TOKEN` where cron can read it.
2. Add this to crontab (`crontab -e`) for every 3 hours:

```
0 */3 * * * curl -sS -X POST "http://localhost:4000/api/jobs/news-risk-ingest" -H "x-job-token: $NEWS_JOB_TOKEN" >/tmp/b4g-news-ingest.log 2>&1
```

## Option B: run from CLI (same cadence)

```
0 */3 * * * cd /path/to/B4G/backend && /usr/bin/env node news-risk-ingest.mjs >> /tmp/b4g-news-ingest.log 2>&1
```

## Recommended cadence

- High activity periods: every 2 hours
- Normal operation: every 3-4 hours

## Verify

- Check latest run via `GET /api/jobs/news-risk-status`
- Confirm `job_runs.status` transitions `running -> success/failed`
