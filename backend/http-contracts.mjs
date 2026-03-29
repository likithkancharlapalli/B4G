export function normalizeJobRun(row, staleRiskHours) {
  if (!row) return null;
  const startedAtTs = new Date(row.started_at).getTime();
  const ageMs = Number.isFinite(startedAtTs) ? Math.max(0, Date.now() - startedAtTs) : null;
  const stale = ageMs === null ? true : ageMs > staleRiskHours * 60 * 60 * 1000;
  return {
    id: row.id,
    jobName: row.job_name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    summary: row.summary_json ?? {},
    errorText: row.error_text ?? null,
    stale,
    staleThresholdHours: staleRiskHours,
  };
}

export function buildJobStatusResponse({
  latestRun,
  latestSuccessRun,
  latestFailureRun,
  staleRiskHours,
}) {
  const normalizedLatest = normalizeJobRun(latestRun, staleRiskHours);
  const normalizedSuccess = normalizeJobRun(latestSuccessRun, staleRiskHours);
  const normalizedFailure = normalizeJobRun(latestFailureRun, staleRiskHours);
  return {
    ok: true,
    latestRun: normalizedLatest,
    lastSuccessAt: normalizedSuccess?.startedAt ?? null,
    lastFailureAt: normalizedFailure?.startedAt ?? null,
  };
}

export function buildRoutesApiResponse({
  items,
  page,
  limit,
  total,
  includePagination,
}) {
  if (!includePagination) return items;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.min(page, totalPages);
  return {
    items,
    pagination: {
      page: currentPage,
      limit,
      total,
      totalPages,
    },
  };
}

export function buildRiskHistoryResponse(rows) {
  return [...(rows ?? [])].reverse();
}
