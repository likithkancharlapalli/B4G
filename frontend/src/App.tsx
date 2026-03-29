import { useState, useEffect, useRef, useCallback } from "react";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import "@fontsource/share-tech-mono/400.css";
import * as THREE from "three";
import { AlertTriangle, Bell, ChevronRight, X, TrendingUp, Clock, DollarSign, Globe, BarChart2, Zap, RefreshCw, Radio, Shield } from "lucide-react";
import {
  getAlerts,
  getNewsRiskStatus,
  getPorts,
  getRouteRiskHistory,
  getRoutes,
  getVendors,
  triggerNewsIngest,
} from "./lib/api";
import RoutesPanel from "./components/RoutesPanel";
import AlertsPanel from "./components/AlertsPanel";
import RouteDetailPanel from "./components/RouteDetailPanel";
import type {
  AlertItem,
  JobRunStatus,
  NewsRiskStatusResponse,
  RouteItem,
  RouteRiskHistoryPoint,
  ThemeColors,
} from "./types/risk";

// ─── DATA ────────────────────────────────────────────────────────────────────

const HQ = { name: "HQ — New York", lat: 40.7128, lng: -74.006 };

// ─── THEME ───────────────────────────────────────────────────────────────────

const T: ThemeColors = {
  bg:       "#0e0b07",
  surface:  "#161009",
  panel:    "#1a1208",
  border:   "rgba(212,160,48,0.12)",
  borderHi: "rgba(212,160,48,0.3)",
  gold:     "#d4a030",
  goldDim:  "#96712a",
  goldFaint:"rgba(212,160,48,0.08)",
  text:     "#e8dcc8",
  textDim:  "#7a6a4e",
  textMid:  "#b09870",
  red:      "#e05252",
  yellow:   "#d4a030",
  green:    "#4caf7d",
};

const TIER_COLOR = { red: T.red, yellow: T.yellow, green: T.green };
const TIER_LABEL = { red: "Critical", yellow: "Caution", green: "Stable" };
const ROUTE_BASE_HUE = { Major: 38, Intermediate: 202, Minor: 132 };
const ROUTE_LANE_COLOR = { Major: "#ffc54d", Intermediate: "#5ec2ff", Minor: "#8fff9f" };
const ROUTES_PAGE_SIZE = 5;
const ALERTS_PAGE_SIZE = 5;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function latLngToVec3(lat, lng, r = 1) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

function createArcPoints(latA, lngA, latB, lngB, segments = 80, lift = 0.35) {
  const start = latLngToVec3(latA, lngA, 1);
  const end = latLngToVec3(latB, lngB, 1);
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const pos = new THREE.Vector3().lerpVectors(start, end, t);
    pos.normalize().multiplyScalar(1 + Math.sin(Math.PI * t) * lift);
    points.push(pos);
  }
  return points;
}

function routeSeed(route) {
  const idSeed = Number(route.id ?? route.laneId ?? 0);
  const distanceSeed = Math.round(Number(route.distanceKm ?? 0) * 10);
  return Math.abs(idSeed * 131 + distanceSeed * 17 + 97);
}

function routeColor(route, mode) {
  if (mode === "lane") {
    return new THREE.Color(ROUTE_LANE_COLOR[route.laneType] ?? ROUTE_LANE_COLOR.Major);
  }
  const seed = routeSeed(route);
  const baseHue = ROUTE_BASE_HUE[route.laneType] ?? 38;
  const hue = (baseHue + (seed % 90) - 45 + 360) % 360;
  const saturation = 78 - (seed % 10);
  const lightness = 62 - (seed % 14);
  return new THREE.Color(`hsl(${hue}, ${saturation}%, ${lightness}%)`);
}

function routeAltitude(route) {
  const seed = routeSeed(route);
  return 1.013 + (seed % 7) * 0.0032;
}

function formatRelativeTime(isoString) {
  if (!isoString) return "";
  const ts = new Date(isoString).getTime();
  if (Number.isNaN(ts)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function hoursSince(isoString) {
  if (!isoString) return null;
  const ts = new Date(isoString).getTime();
  if (Number.isNaN(ts)) return null;
  return (Date.now() - ts) / (1000 * 60 * 60);
}

// ─── GLOBE ───────────────────────────────────────────────────────────────────

function GlobeScene({
  vendors,
  ports,
  routes,
  routeColorMode,
  selectedVendor,
  selectedRoute,
  highlightedRecommendedPoints,
  selectedRoutePortFocus,
  onSelectVendor,
}) {
  const mountRef = useRef(null);
  const animFrameRef = useRef(null);
  const isDragging = useRef(false);
  const prevMouse = useRef({ x: 0, y: 0 });
  const autoRotate = useRef(true);
  const focusTimeoutRef = useRef(null);
  const globeRef = useRef(null);
  const targetRotationRef = useRef({ x: null, y: null });
  const markerMeshes = useRef([]);
  const routeEndpointMarkersRef = useRef({ origin: null, destination: null });

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const W = el.clientWidth, H = el.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(T.bg, 1);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
    camera.position.set(0, 0, 2.8);

    scene.add(new THREE.AmbientLight(0xffeedd, 0.5));
    const sun = new THREE.DirectionalLight(0xffd580, 1.1);
    sun.position.set(5, 3, 5);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x332200, 0.4);
    fill.position.set(-5, -3, -5);
    scene.add(fill);

    const globeGeo = new THREE.SphereGeometry(1, 64, 64);
    const loader = new THREE.TextureLoader();
    const earthTex = loader.load("https://unpkg.com/three-globe/example/img/earth-night.jpg", () => renderer.render(scene, camera));
    const bumpTex = loader.load("https://unpkg.com/three-globe/example/img/earth-topology.png");
    const globeMat = new THREE.MeshPhongMaterial({ map: earthTex, bumpMap: bumpTex, bumpScale: 0.008, specular: new THREE.Color(0x443322), shininess: 12 });
    const globe = new THREE.Mesh(globeGeo, globeMat);
    globeRef.current = globe;
    scene.add(globe);

    // Warm-tinted grid
    const gridMat = new THREE.LineBasicMaterial({ color: 0x5a4010, transparent: true, opacity: 0.18 });
    for (let lat = -80; lat <= 80; lat += 20) {
      const pts = [];
      for (let lng = 0; lng <= 360; lng += 4) pts.push(latLngToVec3(lat, lng - 180, 1.001));
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
    }
    for (let lng = -180; lng < 180; lng += 20) {
      const pts = [];
      for (let lat = -90; lat <= 90; lat += 4) pts.push(latLngToVec3(lat, lng, 1.001));
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
    }

    // Atmosphere — warm amber halo
    const atmMat = new THREE.MeshPhongMaterial({ color: 0x7a4a00, transparent: true, opacity: 0.07, side: THREE.BackSide });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.09, 64, 64), atmMat));

    // HQ marker — gold
    const hqPos = latLngToVec3(HQ.lat, HQ.lng, 1.015);
    const hqMesh = new THREE.Mesh(new THREE.SphereGeometry(0.02, 16, 16), new THREE.MeshBasicMaterial({ color: 0xd4a030 }));
    hqMesh.position.copy(hqPos);
    globe.add(hqMesh);

    const visibleRoutes = selectedRoute
      ? routes.filter((route) => route.id === selectedRoute.id)
      : routes;

    visibleRoutes.forEach((route) => {
      const altitude = routeAltitude(route);
      const points = Array.isArray(route.points)
        ? route.points
            .map((point) => latLngToVec3(point.lat, point.lng, altitude))
            .filter(Boolean)
        : [];
      if (points.length < 2) return;

      const routeMat = new THREE.LineBasicMaterial({
        color: routeColor(route, routeColorMode),
        transparent: true,
        opacity: 0.88,
        depthTest: true,
      });
      const routeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), routeMat);
      routeLine.renderOrder = 3;
      globe.add(routeLine);
    });

    if (Array.isArray(highlightedRecommendedPoints) && highlightedRecommendedPoints.length >= 2) {
      const recommendedPoints = highlightedRecommendedPoints
        .map((point) => latLngToVec3(point.lat, point.lng, 1.03))
        .filter(Boolean);
      if (recommendedPoints.length >= 2) {
        const recommendedMat = new THREE.LineDashedMaterial({
          color: 0x3bc15e,
          transparent: true,
          opacity: 1,
          depthTest: true,
          dashSize: 0.04,
          gapSize: 0.02,
        });
        const recommendedLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(recommendedPoints),
          recommendedMat,
        );
        recommendedLine.computeLineDistances();
        recommendedLine.renderOrder = 8;
        globe.add(recommendedLine);

        const first = highlightedRecommendedPoints[0];
        const last = highlightedRecommendedPoints[highlightedRecommendedPoints.length - 1];
        const firstPos = latLngToVec3(first.lat, first.lng, 1.03);
        const lastPos = latLngToVec3(last.lat, last.lng, 1.03);
        const markerMaterial = new THREE.MeshBasicMaterial({ color: 0x3bc15e, transparent: true, opacity: 1 });
        const startMarker = new THREE.Mesh(new THREE.SphereGeometry(0.018, 18, 18), markerMaterial);
        startMarker.position.copy(firstPos);
        startMarker.renderOrder = 8;
        globe.add(startMarker);
        const endMarker = new THREE.Mesh(new THREE.SphereGeometry(0.018, 18, 18), markerMaterial);
        endMarker.position.copy(lastPos);
        endMarker.renderOrder = 8;
        globe.add(endMarker);
      }
    }

    if (selectedRoute && Array.isArray(selectedRoute.points) && selectedRoute.points.length >= 2) {
      const first = selectedRoute.points[0];
      const last = selectedRoute.points[selectedRoute.points.length - 1];
      const originPos = latLngToVec3(first.lat, first.lng, 1.02);
      const destinationPos = latLngToVec3(last.lat, last.lng, 1.02);

      const originActive = selectedRoutePortFocus === null || selectedRoutePortFocus === "origin";
      const destinationActive =
        selectedRoutePortFocus === null || selectedRoutePortFocus === "destination";

      const originMarker = new THREE.Mesh(
        new THREE.SphereGeometry(0.02, 18, 18),
        new THREE.MeshBasicMaterial({
          color: 0x66d9ff,
          transparent: true,
          opacity: originActive ? 1 : 0.35,
        }),
      );
      originMarker.position.copy(originPos);
      originMarker.renderOrder = 7;
      globe.add(originMarker);
      routeEndpointMarkersRef.current.origin = originMarker;

      const destinationMarker = new THREE.Mesh(
        new THREE.SphereGeometry(0.02, 18, 18),
        new THREE.MeshBasicMaterial({
          color: 0xff8ac6,
          transparent: true,
          opacity: destinationActive ? 1 : 0.35,
        }),
      );
      destinationMarker.position.copy(destinationPos);
      destinationMarker.renderOrder = 7;
      globe.add(destinationMarker);
      routeEndpointMarkersRef.current.destination = destinationMarker;
    } else {
      routeEndpointMarkersRef.current.origin = null;
      routeEndpointMarkersRef.current.destination = null;
    }

    // Ports cloud (lightweight points for thousands of records)
    if (ports.length > 0) {
      const coords = [];
      ports.forEach((port) => {
        if (!Number.isFinite(port.lat) || !Number.isFinite(port.lng)) return;
        const p = latLngToVec3(port.lat, port.lng, 1.008);
        coords.push(p.x, p.y, p.z);
      });
      if (coords.length > 0) {
        const portGeometry = new THREE.BufferGeometry();
        portGeometry.setAttribute("position", new THREE.Float32BufferAttribute(coords, 3));
        const portMaterial = new THREE.PointsMaterial({
          color: 0xffde7a,
          size: 0.012,
          transparent: true,
          opacity: 0.98,
          depthTest: true,
          sizeAttenuation: true,
        });
        const portCloud = new THREE.Points(portGeometry, portMaterial);
        portCloud.renderOrder = 4;
        globe.add(portCloud);
      }
    }

    // Vendors
    const meshes = [];
    vendors.forEach(v => {
      const pos = latLngToVec3(v.lat, v.lng, 1.015);
      const col = new THREE.Color(TIER_COLOR[v.tier]);

      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 16), new THREE.MeshBasicMaterial({ color: col }));
      dot.position.copy(pos);
      dot.userData = { vendorId: v.id };
      globe.add(dot);
      meshes.push(dot);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.03, 0.038, 24),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
      );
      ring.position.copy(pos);
      ring.lookAt(new THREE.Vector3(0, 0, 0));
      ring.userData = { ring: true };
      globe.add(ring);

      const arcMat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: v.tier === "green" ? 0.45 : 0.75 });
      const arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(createArcPoints(v.lat, v.lng, HQ.lat, HQ.lng)), arcMat);
      arc.userData = { vendorId: v.id };
      globe.add(arc);
    });
    markerMeshes.current = meshes;

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const onClick = e => {
      if (isDragging.current) return;
      const rect = el.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / W) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / H) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(meshes, true);
      if (hits.length > 0) {
        onSelectVendor(hits[0].object.userData.vendorId);
        autoRotate.current = false;
        setTimeout(() => { autoRotate.current = true; }, 4000);
      }
    };
    const onMouseDown = e => { isDragging.current = false; prevMouse.current = { x: e.clientX, y: e.clientY }; autoRotate.current = false; };
    const onMouseMove = e => {
      if (e.buttons !== 1) return;
      const dx = e.clientX - prevMouse.current.x, dy = e.clientY - prevMouse.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) isDragging.current = true;
      globe.rotation.y += dx * 0.005;
      globe.rotation.x = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, globe.rotation.x + dy * 0.005));
      prevMouse.current = { x: e.clientX, y: e.clientY };
    };
    const onMouseUp = () => setTimeout(() => { autoRotate.current = true; }, 2000);
    const onResize = () => { camera.aspect = el.clientWidth / el.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(el.clientWidth, el.clientHeight); };

    el.addEventListener("click", onClick);
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("mousemove", onMouseMove);
    el.addEventListener("mouseup", onMouseUp);
    window.addEventListener("resize", onResize);

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      const target = targetRotationRef.current;
      if (target.y !== null && target.x !== null) {
        globe.rotation.y += (target.y - globe.rotation.y) * 0.09;
        globe.rotation.x += (target.x - globe.rotation.x) * 0.09;
        if (
          Math.abs(target.y - globe.rotation.y) < 0.002 &&
          Math.abs(target.x - globe.rotation.x) < 0.002
        ) {
          targetRotationRef.current = { x: null, y: null };
        }
      } else if (autoRotate.current) {
        globe.rotation.y += 0.0015;
      }
      globe.children.forEach(c => {
        if (c.userData.ring) {
          c.userData.phase = (c.userData.phase || 0) + 0.04;
          c.material.opacity = 0.25 + 0.3 * Math.abs(Math.sin(c.userData.phase));
        }
      });
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      el.removeEventListener("click", onClick);
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("mousemove", onMouseMove);
      el.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      globeRef.current = null;
      if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [
    vendors,
    ports,
    routes,
    routeColorMode,
    selectedRoute,
    highlightedRecommendedPoints,
    onSelectVendor,
  ]);

  useEffect(() => {
    const originMarker = routeEndpointMarkersRef.current.origin;
    const destinationMarker = routeEndpointMarkersRef.current.destination;
    if (!originMarker || !destinationMarker) return;

    const originActive = selectedRoutePortFocus === null || selectedRoutePortFocus === "origin";
    const destinationActive =
      selectedRoutePortFocus === null || selectedRoutePortFocus === "destination";
    originMarker.material.opacity = originActive ? 1 : 0.35;
    destinationMarker.material.opacity = destinationActive ? 1 : 0.35;
  }, [selectedRoutePortFocus]);

  useEffect(() => {
    markerMeshes.current.forEach(m => {
      const v = vendors.find(v => v.id === m.userData.vendorId);
      if (!v) return;
      m.material.color.set(selectedVendor === v.id ? "#ffffff" : TIER_COLOR[v.tier]);
      m.scale.setScalar(selectedVendor === v.id ? 1.9 : 1);
    });
  }, [selectedVendor, vendors]);

  useEffect(() => {
    if (!selectedRoute) {
      targetRotationRef.current = { x: null, y: null };
      if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
      autoRotate.current = true;
      return;
    }

    if (!Array.isArray(selectedRoute.points) || selectedRoute.points.length === 0) {
      return;
    }
    const globe = globeRef.current;
    if (!globe) return;

    const midPoint = selectedRoute.points[Math.floor(selectedRoute.points.length / 2)];
    const lat = Number(midPoint?.lat);
    const lng = Number(midPoint?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const desiredY = -((lng + 90) * Math.PI) / 180;
    const pointVec = latLngToVec3(lat, lng, 1);
    const alignToFront = pointVec.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), desiredY);
    const desiredX = Math.max(
      -Math.PI / 2.5,
      Math.min(Math.PI / 2.5, Math.atan2(alignToFront.y, alignToFront.z)),
    );

    targetRotationRef.current = { x: desiredX, y: desiredY };
    autoRotate.current = false;
    if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
    focusTimeoutRef.current = setTimeout(() => {
      autoRotate.current = true;
    }, 5000);
  }, [selectedRoute]);

  return <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />;
}

// ─── RISK BAR ────────────────────────────────────────────────────────────────

function RiskBar({ value }) {
  const color = value >= 70 ? T.red : value >= 35 ? T.yellow : T.green;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs mono w-5 text-right" style={{ color }}>{value}</span>
    </div>
  );
}

// ─── TIER BADGE ──────────────────────────────────────────────────────────────

function TierBadge({ tier }) {
  const color = TIER_COLOR[tier];
  return (
    <span className="text-xs px-2 py-0.5 rounded font-semibold tracking-wide uppercase" style={{ background: `${color}18`, color, border: `1px solid ${color}40` }}>
      {TIER_LABEL[tier]}
    </span>
  );
}

// ─── DRAWER ──────────────────────────────────────────────────────────────────

function VendorDrawer({ vendor, onClose, onGenerateReport, onSwitchBest }) {
  if (!vendor) return null;
  const altList = (Array.isArray(vendor.alternatives) ? vendor.alternatives : [])
    .map((alt) => (typeof alt === "object" && alt ? alt : null))
    .filter(Boolean)
    .sort((a, b) => (a.risk ?? 0) - (b.risk ?? 0));
  const best = altList[0];

  return (
    <div className="fixed right-0 top-0 h-full w-[400px] z-50 flex flex-col" style={{ background: T.panel, borderLeft: `1px solid ${T.borderHi}`, boxShadow: `-24px 0 80px rgba(0,0,0,0.7)` }}>
      {/* Header */}
      <div className="px-5 py-4 flex items-start justify-between" style={{ borderBottom: `1px solid ${T.border}` }}>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">{vendor.flag}</span>
            <TierBadge tier={vendor.tier} />
          </div>
          <h2 className="font-bold text-base leading-tight" style={{ color: T.text, fontFamily: "'Rajdhani', sans-serif", letterSpacing: '0.04em' }}>{vendor.name}</h2>
          <p className="text-xs mt-0.5" style={{ color: T.textDim }}>{vendor.country} · {vendor.material}</p>
        </div>
        <button onClick={onClose} className="p-1 rounded transition-colors hover:bg-white/5" style={{ color: T.textDim }}>
          <X size={16} />
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2 p-4">
        {[
          { label: "Risk Score", value: vendor.risk, icon: <AlertTriangle size={13} />, color: TIER_COLOR[vendor.tier] },
          { label: "Lead Time", value: `${vendor.leadTime}d`, icon: <Clock size={13} />, color: T.gold },
          { label: "Cost Δ", value: `${vendor.costDelta > 0 ? "+" : ""}${vendor.costDelta}%`, icon: <DollarSign size={13} />, color: vendor.costDelta > 0 ? T.red : T.green },
        ].map(k => (
          <div key={k.label} className="rounded-lg p-3 text-center" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
            <div className="flex justify-center mb-1" style={{ color: k.color }}>{k.icon}</div>
            <div className="font-bold text-base mono" style={{ color: k.color }}>{k.value}</div>
            <div className="text-xs mt-0.5" style={{ color: T.textDim }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div className="px-4 pb-3">
        <div className="text-xs mb-1" style={{ color: T.textDim }}>Risk Score</div>
        <RiskBar value={vendor.risk} />
      </div>

      {/* Alternatives */}
      {altList.length > 0 && (
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <div className="flex items-center gap-1.5 mb-3 mt-1">
            <Zap size={13} style={{ color: T.gold }} />
            <span className="text-xs label" style={{ color: T.gold }}>Alternatives</span>
          </div>
          <div className="space-y-2">
            {altList.map((alt, i) => (
              <div key={i} className="rounded-lg p-3 relative" style={{ background: T.surface, border: `1px solid ${alt === best ? T.borderHi : T.border}` }}>
                {alt === best && (
                  <span className="absolute top-2.5 right-2.5 text-xs font-semibold px-2 py-0.5 rounded" style={{ background: `${T.green}18`, color: T.green, border: `1px solid ${T.green}40` }}>Best</span>
                )}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-base">{alt.flag}</span>
                  <div>
                    <div className="text-sm font-semibold" style={{ color: T.text }}>{alt.name}</div>
                    <div className="text-xs" style={{ color: T.textDim }}>{alt.country}</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: "Risk", val: alt.risk, color: alt.risk < 35 ? T.green : T.yellow },
                    { label: "Lead", val: `${alt.leadTime}d`, color: T.gold },
                    { label: "Cost Δ", val: `${alt.costDelta > 0 ? "+" : ""}${alt.costDelta}%`, color: alt.costDelta <= 0 ? T.green : T.yellow },
                  ].map(s => (
                    <div key={s.label}>
                      <div className="font-bold text-sm" style={{ color: s.color }}>{s.val}</div>
                      <div className="text-xs" style={{ color: T.textDim }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTAs */}
      <div className="p-4 space-y-2" style={{ borderTop: `1px solid ${T.border}` }}>
        <button
          onClick={() => onGenerateReport?.(vendor)}
          className="w-full py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all hover:opacity-90"
          style={{ background: T.gold, color: "#0e0b07" }}
        >
          <Zap size={14} /> Generate AI Report
        </button>
        <button
          onClick={() => onSwitchBest?.(vendor, best)}
          className="w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all hover:bg-white/5"
          style={{ color: T.green, border: `1px solid ${T.green}40` }}
        >
          <RefreshCw size={14} /> Switch to Best Vendor
        </button>
      </div>
    </div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────────────────────

export default function App() {
  const [vendors, setVendors] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [ports, setPorts] = useState<any[]>([]);
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [selectedRoutePortFocus, setSelectedRoutePortFocus] = useState<"origin" | "destination" | null>(null);
  const [highlightedRecommendedRouteId, setHighlightedRecommendedRouteId] = useState<number | null>(null);
  const [routePage, setRoutePage] = useState(0);
  const [alertPage, setAlertPage] = useState(0);
  const [routeLaneFilter, setRouteLaneFilter] = useState("all");
  const [routeMinRiskFilter, setRouteMinRiskFilter] = useState(0);
  const [routeRecencyHours, setRouteRecencyHours] = useState(0);
  const [routeSearch, setRouteSearch] = useState("");
  const [routeColorMode, setRouteColorMode] = useState("distinct");
  const [apiConnected, setApiConnected] = useState(false);
  const [newsStatus, setNewsStatus] = useState<JobRunStatus | null>(null);
  const [riskHistoryByRoute, setRiskHistoryByRoute] = useState<Record<string, RouteRiskHistoryPoint[]>>({});
  const [selectedVendor, setSelectedVendor] = useState<number | null>(null);
  const [drawerVendor, setDrawerVendor] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState("routes");
  const [newsStatusLoading, setNewsStatusLoading] = useState(false);
  const [newsStatusError, setNewsStatusError] = useState<string | null>(null);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [routesError, setRoutesError] = useState<string | null>(null);
  const [ingestInFlight, setIngestInFlight] = useState(false);

  const loadFromApi = useCallback(async () => {
    setRoutesLoading(true);
    setRoutesError(null);
    setNewsStatusLoading(true);
    setNewsStatusError(null);

    try {
      const [
        vendorsResult,
        alertsResult,
        portsResult,
        routesResult,
        newsStatusResult,
      ] = await Promise.allSettled([
        getVendors(),
        getAlerts(),
        getPorts(),
        getRoutes(),
        getNewsRiskStatus(),
      ]);

      let successfulCalls = 0;

      if (vendorsResult.status === "fulfilled") {
        successfulCalls += 1;
        if (Array.isArray(vendorsResult.value)) {
          setVendors(vendorsResult.value);
        }
      } else {
        console.warn("[API] Vendors unavailable:", vendorsResult.reason);
      }

      if (alertsResult.status === "fulfilled") {
        successfulCalls += 1;
        if (Array.isArray(alertsResult.value)) {
          setAlerts(alertsResult.value);
        }
      } else {
        console.warn("[API] Alerts unavailable:", alertsResult.reason);
      }

      if (portsResult.status === "fulfilled") {
        successfulCalls += 1;
        if (Array.isArray(portsResult.value)) {
          setPorts(portsResult.value);
        }
      } else {
        console.warn("[API] Ports unavailable:", portsResult.reason);
      }

      if (routesResult.status === "fulfilled") {
        successfulCalls += 1;
        if (Array.isArray(routesResult.value)) {
          setRoutes(routesResult.value as RouteItem[]);
        } else {
          setRoutesError("Routes payload was invalid.");
        }
      } else {
        setRoutesError("Routes unavailable. Check backend routes API.");
        console.warn("[API] Routes unavailable:", routesResult.reason);
      }

      if (newsStatusResult.status === "fulfilled") {
        successfulCalls += 1;
        const payload = newsStatusResult.value as NewsRiskStatusResponse;
        setNewsStatus(payload?.latestRun ?? null);
      } else {
        setNewsStatusError("AI status unavailable.");
        console.warn("[API] News status unavailable:", newsStatusResult.reason);
      }

      setApiConnected(successfulCalls > 0);
    } catch (error) {
      setApiConnected(false);
      setRoutesError("Failed to load API data.");
      setNewsStatusError("Failed to load AI status.");
      console.warn("[API] Failed to load data:", error);
    } finally {
      setRoutesLoading(false);
      setNewsStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFromApi();
  }, [loadFromApi]);

  useEffect(() => {
    let active = true;
    async function refreshNewsStatus() {
      try {
        setNewsStatusLoading(true);
        const result = await getNewsRiskStatus();
        if (active) {
          setNewsStatus(result?.latestRun ?? null);
          setNewsStatusError(null);
        }
      } catch {
        if (active) setNewsStatusError("AI status polling failed.");
      } finally {
        if (active) setNewsStatusLoading(false);
      }
    }
    const timer = setInterval(refreshNewsStatus, 60 * 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selectedRouteId) return;
    const key = String(selectedRouteId);
    if (Array.isArray(riskHistoryByRoute[key]) && riskHistoryByRoute[key].length > 0) return;

    let active = true;
    async function loadHistory() {
      try {
        const history = await getRouteRiskHistory(selectedRouteId, 30);
        if (!active) return;
        setRiskHistoryByRoute((prev) => ({
          ...prev,
          [key]: Array.isArray(history) ? history : [],
        }));
      } catch {
        if (!active) return;
        setRiskHistoryByRoute((prev) => ({ ...prev, [key]: [] }));
      }
    }
    loadHistory();

    return () => {
      active = false;
    };
  }, [selectedRouteId]);

  useEffect(() => {
    setSelectedRoutePortFocus(null);
  }, [selectedRouteId]);

  const handleSelectVendor = useCallback((id) => setSelectedVendor(id), []);
  const openDrawer = (v) => setDrawerVendor(v);
  const closeDrawer = () => setDrawerVendor(null);
  const handleAlertClick = (a: AlertItem) => {
    if (a.routeId) {
      setSelectedRouteId(a.routeId);
      setActiveTab("routes");
      return;
    }
    const v = vendors.find((vendor) => vendor.id === a.vendorId);
    if (v) setSelectedVendor(v.id);
  };
  const handleGenerateVendorReport = (vendor) => {
    setSelectedVendor(vendor.id);
    setActiveTab("routes");
    closeDrawer();
  };
  const handleSwitchToBestVendor = (vendor, bestAlternative) => {
    if (!bestAlternative) return;
    const matched = vendors.find(
      (v) =>
        v.name === bestAlternative.name &&
        v.country === bestAlternative.country,
    );
    if (matched) {
      setSelectedVendor(matched.id);
      closeDrawer();
      return;
    }
    setDrawerVendor({
      ...vendor,
      ...bestAlternative,
      alternatives: vendor.alternatives,
    });
  };

  const handleRefreshIntelligence = async () => {
    const token = import.meta.env.VITE_NEWS_JOB_TOKEN?.trim();
    if (!token) {
      setNewsStatusError("Set VITE_NEWS_JOB_TOKEN in frontend env to trigger ingest.");
      return;
    }
    try {
      setIngestInFlight(true);
      setNewsStatusError(null);
      await triggerNewsIngest(token);
      await loadFromApi();
    } catch (error) {
      setNewsStatusError(error instanceof Error ? error.message : "Failed to trigger AI ingest.");
    } finally {
      setIngestInFlight(false);
    }
  };

  const criticalRouteCount = routes.filter(
    (route) => Number(route.riskPercentage ?? 0) >= 70,
  ).length;
  const cautionRouteCount = routes.filter((route) => {
    const risk = Number(route.riskPercentage ?? 0);
    return risk >= 40 && risk < 70;
  }).length;
  const optimalRouteCount = routes.filter(
    (route) => Number(route.riskPercentage ?? 0) < 40,
  ).length;
  const selV = vendors.find((v) => v.id === selectedVendor);
  const selectedRoute = routes.find((route) => route.id === selectedRouteId) || null;
  const highlightedRecommendedRoute =
    routes.find((route) => route.id === highlightedRecommendedRouteId) || null;
  const highlightedRecommendedPoints =
    highlightedRecommendedRoute?.points ??
    (selectedRoute?.recommendedRoute?.routeId === highlightedRecommendedRouteId
      ? selectedRoute?.recommendedRoute?.points
      : null);
  const lastAiUpdatedAgo = formatRelativeTime(newsStatus?.startedAt);
  const aiRunHoursAgo = hoursSince(newsStatus?.startedAt);
  const aiIsStale =
    Boolean(newsStatus?.stale) ||
    (Number.isFinite(aiRunHoursAgo) && aiRunHoursAgo > Number(newsStatus?.staleThresholdHours ?? 8));
  const routeRiskAlerts = routes
    .flatMap((route) => {
      const delta = Number(route.riskDelta ?? 0);
      const drivers = Array.isArray(route.riskDrivers) ? route.riskDrivers : [];
      if (Math.abs(delta) <= 0.01 || drivers.length === 0) return [];

      return drivers.slice(0, 3).map((driver, idx) => {
        const severity = Number(driver.severity ?? 0);
        const tier = severity >= 4 ? "red" : severity >= 2 ? "yellow" : "green";
        return {
          id: `${route.id}-driver-${idx}`,
          routeId: route.id,
          tier,
          region: route.routeName ?? `Route ${route.laneId}-${route.id}`,
          msg: driver.title ?? driver.reason ?? "Route risk adjusted from recent news",
          time: formatRelativeTime(driver.publishedAt) || "recent",
          url: driver.url ?? null,
          publishedTs: driver.publishedAt ? new Date(driver.publishedAt).getTime() : 0,
        };
      });
    })
    .sort((a, b) => (b.publishedTs ?? 0) - (a.publishedTs ?? 0));
  const sidebarAlerts = routeRiskAlerts.length > 0 ? routeRiskAlerts : alerts;
  const totalAlertPages = Math.max(
    1,
    Math.ceil(sidebarAlerts.length / ALERTS_PAGE_SIZE),
  );
  const currentAlertPage = Math.min(alertPage, totalAlertPages - 1);
  const alertStartIndex = currentAlertPage * ALERTS_PAGE_SIZE;
  const alertEndIndex = Math.min(
    alertStartIndex + ALERTS_PAGE_SIZE,
    sidebarAlerts.length,
  );
  const pagedAlerts = sidebarAlerts.slice(alertStartIndex, alertEndIndex);
  const routesByRisk = [...routes]
    .filter((route) => {
      if (routeLaneFilter !== "all" && route.laneType !== routeLaneFilter) return false;
      if (Number(route.riskPercentage ?? 0) < routeMinRiskFilter) return false;
      if (routeRecencyHours > 0) {
        const updatedTs = new Date(route.riskSnapshotAt ?? "").getTime();
        if (!Number.isFinite(updatedTs)) return false;
        const ageHours = (Date.now() - updatedTs) / (1000 * 60 * 60);
        if (ageHours > routeRecencyHours) return false;
      }
      if (routeSearch.trim()) {
        const haystack = `${route.routeName ?? ""} ${route.originPortName ?? ""} ${route.destPortName ?? ""}`.toLowerCase();
        if (!haystack.includes(routeSearch.trim().toLowerCase())) return false;
      }
      return true;
    })
    .sort(
    (a, b) => (b.riskPercentage ?? -1) - (a.riskPercentage ?? -1),
    );
  const totalRoutePages = Math.max(
    1,
    Math.ceil(routesByRisk.length / ROUTES_PAGE_SIZE),
  );
  const currentRoutePage = Math.min(routePage, totalRoutePages - 1);
  const routeStartIndex = currentRoutePage * ROUTES_PAGE_SIZE;
  const routeEndIndex = Math.min(
    routeStartIndex + ROUTES_PAGE_SIZE,
    routesByRisk.length,
  );
  const pagedRoutes = routesByRisk.slice(routeStartIndex, routeEndIndex);

  useEffect(() => {
    setRoutePage((p) => Math.min(p, totalRoutePages - 1));
  }, [totalRoutePages]);

  useEffect(() => {
    setAlertPage((p) => Math.min(p, totalAlertPages - 1));
  }, [totalAlertPages]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: T.bg, fontFamily: "'Rajdhani', 'Segoe UI', sans-serif", color: T.text }}>
      <style>{`
        * { box-sizing: border-box; }
        .mono { font-family: 'Share Tech Mono', monospace !important; letter-spacing: 0.05em; }
        .label { font-family: 'Rajdhani', sans-serif; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; }
        .heading { font-family: 'Rajdhani', sans-serif; font-weight: 700; letter-spacing: 0.06em; }
        ::-webkit-scrollbar { width: 4px; background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(212,160,48,0.2); border-radius: 2px; }
        input, button { font-family: 'Rajdhani', sans-serif; }
      `}</style>

      {/* ── NAV ── */}
      <nav className="flex items-center justify-between px-5 py-2.5 z-40 relative" style={{ borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded flex items-center justify-center" style={{ background: T.gold }}>
            <Shield size={14} color="#0e0b07" />
          </div>
          <span className="font-bold text-base heading" style={{ color: T.text }}>
            Supply<span style={{ color: T.gold }}>Watch</span>
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          {["Routes", "Alerts", "Risk"].map((nav) => {
            const isActive =
              (nav === "Routes" && activeTab === "routes") ||
              (nav === "Alerts" && activeTab === "alerts") ||
              (nav === "Risk" && activeTab === "chart");
            return (
            <button key={nav} onClick={() => setActiveTab(nav === "Risk" ? "chart" : nav.toLowerCase())} className="px-3 py-1 text-xs rounded transition-all font-medium" style={{ color: isActive ? T.gold : T.textDim, background: isActive ? T.goldFaint : "transparent" }}>
              {nav}
            </button>
          );})}
        </div>

        <div className="flex items-center gap-2">
          {/* Live indicator */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded" style={{ background: T.goldFaint, border: `1px solid ${T.border}` }}>
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: apiConnected ? T.green : T.yellow }} />
            <span className="text-xs mono" style={{ color: apiConnected ? T.green : T.yellow }}>
              {apiConnected ? "API LIVE" : "API OFFLINE"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded" style={{ background: T.goldFaint, border: `1px solid ${T.border}` }}>
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: newsStatus?.status === "failed"
                  ? T.red
                  : aiIsStale
                    ? T.yellow
                    : T.green,
              }}
            />
            <span
              className="text-xs mono"
              style={{
                color: newsStatus?.status === "failed"
                  ? T.red
                  : aiIsStale
                    ? T.yellow
                    : T.green,
              }}
            >
              {newsStatusLoading
                ? "AI CHECKING..."
                : newsStatus
                ? `AI ${newsStatus.status.toUpperCase()}${lastAiUpdatedAgo ? ` · ${lastAiUpdatedAgo}` : ""}`
                : "AI STATUS N/A"}
            </span>
          </div>
          <button
            onClick={handleRefreshIntelligence}
            disabled={ingestInFlight}
            className="px-2 py-1 rounded text-xs font-semibold transition-all"
            style={{
              color: ingestInFlight ? T.textDim : T.text,
              border: `1px solid ${T.border}`,
              opacity: ingestInFlight ? 0.6 : 1,
            }}
          >
            {ingestInFlight ? "Refreshing..." : "Refresh Intelligence"}
          </button>
          <button className="relative p-1.5 rounded hover:bg-white/5 transition-all">
            <Bell size={16} style={{ color: T.textDim }} />
            {sidebarAlerts.length > 0 && (
              <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full text-white text-[9px] flex items-center justify-center font-bold" style={{ background: T.red }}>
                {Math.min(sidebarAlerts.length, 9)}
              </span>
            )}
          </button>
          <div className="w-7 h-7 rounded font-bold text-xs flex items-center justify-center" style={{ background: T.goldFaint, color: T.gold, border: `1px solid ${T.border}` }}>JD</div>
        </div>
      </nav>

      {/* ── KPI STRIP ── */}
      <div className="grid grid-cols-3" style={{ borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        {[
          { label: "Active Vendors",   value: vendors.length,                          icon: <Globe size={14} />,       color: T.gold, sub: "across 8 regions" },
          { label: "Critical Routes",  value: criticalRouteCount,                      icon: <AlertTriangle size={14}/>, color: T.red,  sub: `${cautionRouteCount} on watch` },
          { label: "Active Routes",    value: routes.length,                            icon: <TrendingUp size={14} />,   color: T.yellow,sub: "tracked lanes" },
        ].map((k, i) => (
          <div key={k.label} className="flex items-center gap-3 px-5 py-3" style={{ borderRight: i < 2 ? `1px solid ${T.border}` : "none" }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ color: k.color, background: `${k.color}15` }}>{k.icon}</div>
            <div>
              <div className="font-bold text-lg leading-none mono" style={{ color: k.color }}>{k.value}</div>
              <div className="text-xs mt-0.5" style={{ color: T.textDim }}>{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── MAIN CONTENT ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden" style={{ height: "calc(100vh - 96px)" }}>

        {/* ── LEFT SIDEBAR ── */}
        <div className="w-64 flex flex-col flex-shrink-0" style={{ background: T.surface, borderRight: `1px solid ${T.border}` }}>
          {/* Tabs */}
          <div className="flex" style={{ borderBottom: `1px solid ${T.border}` }}>
            {[{ id: "routes", label: "Routes", icon: <Globe size={11} /> }, { id: "alerts", label: "Alerts", icon: <Radio size={11} /> }, { id: "chart", label: "Risk", icon: <BarChart2 size={11} /> }].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)} className="flex-1 py-2 text-xs font-semibold flex items-center justify-center gap-1 transition-all" style={{ color: activeTab === t.id ? T.gold : T.textDim, borderBottom: activeTab === t.id ? `2px solid ${T.gold}` : "2px solid transparent", background: activeTab === t.id ? T.goldFaint : "transparent" }}>
                {t.icon}{t.label}
              </button>
            ))}
          </div>
          {aiIsStale && (
            <div
              className="px-3 py-2 text-xs"
              style={{ color: T.yellow, background: `${T.yellow}14`, borderBottom: `1px solid ${T.border}` }}
            >
              AI risk data is stale. Last update {lastAiUpdatedAgo || "unknown"}.
            </div>
          )}
          {newsStatus?.status === "failed" && (
            <div
              className="px-3 py-2 text-xs"
              style={{ color: T.red, background: `${T.red}14`, borderBottom: `1px solid ${T.border}` }}
            >
              Last AI ingest failed. {newsStatus.errorText || "Check backend job logs."}
            </div>
          )}
          {newsStatusError && (
            <div
              className="px-3 py-2 text-xs"
              style={{ color: T.red, background: `${T.red}14`, borderBottom: `1px solid ${T.border}` }}
            >
              {newsStatusError}
            </div>
          )}
          {routesError && (
            <div
              className="px-3 py-2 text-xs"
              style={{ color: T.yellow, background: `${T.yellow}14`, borderBottom: `1px solid ${T.border}` }}
            >
              {routesError}
            </div>
          )}

          {/* Routes */}
          {activeTab === "routes" && (
            <RoutesPanel
              T={T}
              routesByRisk={routesByRisk}
              routeStartIndex={routeStartIndex}
              routeEndIndex={routeEndIndex}
              currentRoutePage={currentRoutePage}
              totalRoutePages={totalRoutePages}
              pagedRoutes={pagedRoutes}
              selectedRouteId={selectedRouteId}
              routeSearch={routeSearch}
              routeLaneFilter={routeLaneFilter}
              routeRecencyHours={routeRecencyHours}
              routeMinRiskFilter={routeMinRiskFilter}
              riskHistoryByRoute={riskHistoryByRoute}
              formatRelativeTime={formatRelativeTime}
              onPrevPage={() => setRoutePage((p) => Math.max(0, p - 1))}
              onNextPage={() => setRoutePage((p) => Math.min(totalRoutePages - 1, p + 1))}
              onSearchChange={(value) => {
                setRoutePage(0);
                setRouteSearch(value);
              }}
              onLaneFilterChange={(value) => {
                setRoutePage(0);
                setRouteLaneFilter(value);
              }}
              onRecencyChange={(value) => {
                setRoutePage(0);
                setRouteRecencyHours(value);
              }}
              onMinRiskChange={(value) => {
                setRoutePage(0);
                setRouteMinRiskFilter(value);
              }}
              onRouteClick={(routeId) => {
                setSelectedRouteId((prev) => {
                  if (prev === routeId) {
                    setHighlightedRecommendedRouteId(null);
                    return null;
                  }
                  const clicked = routes.find((route) => route.id === routeId);
                  setHighlightedRecommendedRouteId(clicked?.recommendedRoute?.routeId ?? null);
                  return routeId;
                });
              }}
            />
          )}

          {/* Alerts */}
          {activeTab === "alerts" && (
            <AlertsPanel
              T={T}
              TIER_COLOR={TIER_COLOR}
              sidebarAlerts={sidebarAlerts}
              pagedAlerts={pagedAlerts}
              alertStartIndex={alertStartIndex}
              alertEndIndex={alertEndIndex}
              currentAlertPage={currentAlertPage}
              totalAlertPages={totalAlertPages}
              onPrevPage={() => setAlertPage((p) => Math.max(0, p - 1))}
              onNextPage={() => setAlertPage((p) => Math.min(totalAlertPages - 1, p + 1))}
              onAlertClick={handleAlertClick}
            />
          )}

          {/* Chart */}
          {activeTab === "chart" && (
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              <div className="text-xs mb-2 label" style={{ color: T.textDim }}>Risk by Vendor</div>
              {[...vendors].sort((a, b) => b.risk - a.risk).map(v => (
                <div key={v.id} onClick={() => setSelectedVendor(v.id)} className="cursor-pointer p-2.5 rounded-lg transition-all" style={{ background: selectedVendor === v.id ? T.goldFaint : T.panel, border: `1px solid ${selectedVendor === v.id ? T.borderHi : T.border}` }}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-medium truncate mr-2" style={{ color: T.text }}>{v.flag} {v.name.split(" ")[0]}</span>
                    <span className="text-xs mono font-bold" style={{ color: TIER_COLOR[v.tier] }}>{v.risk}</span>
                  </div>
                  <RiskBar value={v.risk} />
                </div>
              ))}
            </div>
          )}

          {/* Network stats pinned at bottom */}
          <div className="p-3" style={{ borderTop: `1px solid ${T.border}` }}>
            <div className="flex items-center gap-1.5 mb-2">
              <Zap size={11} style={{ color: T.gold }} />
              <span className="text-xs font-bold tracking-widest uppercase" style={{ color: T.gold }}>Network</span>
            </div>
            <div className="space-y-1.5">
              {[
                { label: "Ports", value: ports.length, color: T.gold },
                { label: "Routes", value: routes.length, color: T.yellow },
                { label: "Alerts", value: sidebarAlerts.length, color: T.red },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-2 p-2 rounded-lg" style={{ background: T.panel, border: `1px solid ${T.border}` }}>
                  <span className="text-xs font-medium" style={{ color: T.text }}>{item.label}</span>
                  <span className="text-xs font-bold mono" style={{ color: item.color }}>{item.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── GLOBE ── */}
        <div className="flex-1 relative">
          <GlobeScene
            vendors={vendors}
            ports={ports}
            routes={routes}
            routeColorMode={routeColorMode}
            selectedVendor={selectedVendor}
            selectedRoute={selectedRoute}
            highlightedRecommendedPoints={highlightedRecommendedPoints}
            selectedRoutePortFocus={selectedRoutePortFocus}
            onSelectVendor={handleSelectVendor}
          />

          <div className="absolute top-3 left-3 z-10 rounded px-2 py-1 text-xs mono" style={{ background: "rgba(14,11,7,0.85)", color: T.gold, border: `1px solid ${T.borderHi}` }}>
            {ports.length.toLocaleString()} Ports
          </div>
          <div className="absolute top-3 left-32 z-10 rounded px-2 py-1 text-xs mono" style={{ background: "rgba(14,11,7,0.85)", color: T.gold, border: `1px solid ${T.borderHi}` }}>
            {routes.length.toLocaleString()} Routes
          </div>
          {routesLoading && (
            <div className="absolute top-3 left-[13.5rem] z-10 rounded px-2 py-1 text-xs mono" style={{ background: "rgba(14,11,7,0.85)", color: T.yellow, border: `1px solid ${T.borderHi}` }}>
              Loading routes...
            </div>
          )}
          <div className="absolute top-3 left-60 z-10 rounded p-0.5 text-xs" style={{ background: "rgba(14,11,7,0.9)", border: `1px solid ${T.borderHi}` }}>
            <div className="flex">
              <button
                onClick={() => setRouteColorMode("lane")}
                className="px-2 py-1 rounded text-xs font-semibold transition-all"
                style={{
                  color: routeColorMode === "lane" ? "#0e0b07" : T.textDim,
                  background: routeColorMode === "lane" ? T.gold : "transparent",
                }}
              >
                Lane Type
              </button>
              <button
                onClick={() => setRouteColorMode("distinct")}
                className="px-2 py-1 rounded text-xs font-semibold transition-all"
                style={{
                  color: routeColorMode === "distinct" ? "#0e0b07" : T.textDim,
                  background: routeColorMode === "distinct" ? T.gold : "transparent",
                }}
              >
                Distinct
              </button>
            </div>
          </div>

          {/* Legend */}
          <div className="absolute bottom-5 left-5 flex gap-3 z-10">
            {[{ label: "Optimal", color: T.green, count: optimalRouteCount }, { label: "Caution", color: T.yellow, count: cautionRouteCount }, { label: "Critical", color: T.red, count: criticalRouteCount }].map(l => (
              <div key={l.label} className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold" style={{ background: "rgba(14,11,7,0.85)", border: `1px solid ${l.color}35`, color: l.color, backdropFilter: "blur(8px)" }}>
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: l.color }} />
                {l.count} {l.label}
              </div>
            ))}
          </div>

          {/* Drag hint */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 text-xs flex items-center gap-1.5 pointer-events-none" style={{ color: T.textDim }}>
            <RefreshCw size={10} />
            DRAG TO ROTATE  ·  CLICK NODE TO INSPECT
          </div>

          {/* Selected vendor card */}
          {selV && (
            <div className="absolute top-3 right-3 z-10 rounded-xl p-4 w-56" style={{ background: "rgba(22,16,9,0.94)", border: `1px solid ${T.borderHi}`, backdropFilter: "blur(16px)" }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{selV.flag}</span>
                <div>
                  <div className="text-sm font-bold heading" style={{ color: T.text }}>{selV.name}</div>
                  <div className="text-xs" style={{ color: T.textDim }}>{selV.material}</div>
                </div>
              </div>
              <RiskBar value={selV.risk} />
              <div className="flex justify-between text-xs mt-2" style={{ color: T.textDim }}>
                <span>Lead: <span style={{ color: T.text }}>{selV.leadTime}d</span></span>
                <span>Cost: <span style={{ color: selV.costDelta > 0 ? T.red : T.green }}>{selV.costDelta > 0 ? "+" : ""}{selV.costDelta}%</span></span>
              </div>
              <button onClick={() => openDrawer(selV)} className="mt-3 w-full py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-all hover:opacity-90" style={{ background: T.gold, color: "#0e0b07" }}>
                View Report <ChevronRight size={11} />
              </button>
            </div>
          )}
          {selectedRoute && (
            <RouteDetailPanel
              T={T}
              route={selectedRoute}
              history={riskHistoryByRoute[String(selectedRoute.id)] ?? []}
              formatRelativeTime={formatRelativeTime}
              selectedPortFocus={selectedRoutePortFocus}
              onSelectPortFocus={setSelectedRoutePortFocus}
              highlightedRecommendedRouteId={highlightedRecommendedRouteId}
              onHighlightRecommendedRoute={(routeId) => setHighlightedRecommendedRouteId(routeId)}
              onClose={() => {
                setHighlightedRecommendedRouteId(null);
                setSelectedRouteId(null);
              }}
            />
          )}
        </div>
      </div>

      {/* Drawer */}
      {drawerVendor && (
        <>
          <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={closeDrawer} />
          <VendorDrawer
            vendor={drawerVendor}
            onClose={closeDrawer}
            onGenerateReport={handleGenerateVendorReport}
            onSwitchBest={handleSwitchToBestVendor}
          />
        </>
      )}
    </div>
  );
}