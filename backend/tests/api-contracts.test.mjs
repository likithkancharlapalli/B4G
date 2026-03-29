import test from "node:test";
import assert from "node:assert/strict";
import {
  buildJobStatusResponse,
  buildRiskHistoryResponse,
  buildRoutesApiResponse,
  normalizeJobRun,
} from "../http-contracts.mjs";

test("normalizeJobRun returns expected contract keys", () => {
  const run = normalizeJobRun(
    {
      id: 42,
      job_name: "news-risk-ingest",
      started_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      ended_at: new Date().toISOString(),
      status: "success",
      summary_json: { impactsUpserted: 12 },
      error_text: null,
    },
    8,
  );

  assert.equal(typeof run.id, "number");
  assert.equal(typeof run.jobName, "string");
  assert.equal(typeof run.startedAt, "string");
  assert.equal(typeof run.status, "string");
  assert.equal(typeof run.summary, "object");
  assert.equal(typeof run.stale, "boolean");
  assert.equal(run.staleThresholdHours, 8);
});

test("buildRoutesApiResponse returns paginated contract when requested", () => {
  const payload = buildRoutesApiResponse({
    items: [{ id: 1, riskPercentage: 71 }],
    page: 2,
    limit: 10,
    total: 35,
    includePagination: true,
  });

  assert.ok(Array.isArray(payload.items));
  assert.equal(payload.pagination.page, 2);
  assert.equal(payload.pagination.limit, 10);
  assert.equal(payload.pagination.total, 35);
  assert.equal(payload.pagination.totalPages, 4);
});

test("buildRoutesApiResponse returns legacy array when unpaginated", () => {
  const payload = buildRoutesApiResponse({
    items: [{ id: 5 }],
    page: 1,
    limit: 1000,
    total: 1,
    includePagination: false,
  });
  assert.ok(Array.isArray(payload));
  assert.equal(payload.length, 1);
});

test("buildRiskHistoryResponse returns ascending timeline", () => {
  const rows = [
    { snapshot_at: "2026-01-03T00:00:00Z" },
    { snapshot_at: "2026-01-02T00:00:00Z" },
    { snapshot_at: "2026-01-01T00:00:00Z" },
  ];
  const history = buildRiskHistoryResponse(rows);
  assert.equal(history[0].snapshot_at, "2026-01-01T00:00:00Z");
  assert.equal(history[2].snapshot_at, "2026-01-03T00:00:00Z");
});

test("buildJobStatusResponse includes success/failure timestamps", () => {
  const payload = buildJobStatusResponse({
    latestRun: {
      id: 7,
      job_name: "news-risk-ingest",
      started_at: "2026-01-05T00:00:00Z",
      ended_at: "2026-01-05T00:01:00Z",
      status: "success",
      summary_json: {},
      error_text: null,
    },
    latestSuccessRun: {
      id: 7,
      job_name: "news-risk-ingest",
      started_at: "2026-01-05T00:00:00Z",
      ended_at: "2026-01-05T00:01:00Z",
      status: "success",
      summary_json: {},
      error_text: null,
    },
    latestFailureRun: {
      id: 5,
      job_name: "news-risk-ingest",
      started_at: "2026-01-03T00:00:00Z",
      ended_at: "2026-01-03T00:01:00Z",
      status: "failed",
      summary_json: {},
      error_text: "boom",
    },
    staleRiskHours: 8,
  });
  assert.equal(payload.ok, true);
  assert.equal(typeof payload.lastSuccessAt, "string");
  assert.equal(typeof payload.lastFailureAt, "string");
});
