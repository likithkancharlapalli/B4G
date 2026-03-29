import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyEventType,
  computeBaseRouteRisk,
  estimateImpactDirection,
  estimateSeverity,
  freshnessMultiplier,
  scoreRouteMatch,
} from "../news-risk-ingest.mjs";

test("classifyEventType detects congestion", () => {
  const eventType = classifyEventType("Severe congestion and backlog reported at major port");
  assert.equal(eventType, "congestion");
});

test("estimateImpactDirection detects positive resolution language", () => {
  const direction = estimateImpactDirection("Port operations resumed after closure was resolved", "closure");
  assert.equal(direction, "down");
});

test("scoreRouteMatch prioritizes exact port names", () => {
  const score = scoreRouteMatch(
    "Delays reported between singapore and rotterdam after weather disruptions",
    { origin_port_name: "Singapore", dest_port_name: "Rotterdam" },
  );
  assert.ok(score >= 8);
});

test("freshnessMultiplier decays with age", () => {
  const today = freshnessMultiplier(new Date().toISOString());
  const old = freshnessMultiplier(new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString());
  assert.ok(today > old);
});

test("computeBaseRouteRisk is bounded", () => {
  const risk = computeBaseRouteRisk({ lane_type: "Major", distance_km: 9999 }, 9999);
  assert.ok(risk <= 99);
  assert.ok(risk >= 1);
});

test("estimateSeverity responds to critical wording", () => {
  const severity = estimateSeverity("critical indefinite closure after conflict", "closure");
  assert.equal(severity, 5);
});
