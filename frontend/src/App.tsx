import { useState, useEffect, useRef, useCallback } from "react";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import "@fontsource/share-tech-mono/400.css";
import * as THREE from "three";
import { AlertTriangle, Bell, ChevronRight, X, TrendingUp, Clock, DollarSign, Globe, BarChart2, Zap, RefreshCw, Radio, Shield } from "lucide-react";
import { getAlerts, getPorts, getVendors } from "./lib/api";

// ─── DATA ────────────────────────────────────────────────────────────────────

const HQ = { name: "HQ — New York", lat: 40.7128, lng: -74.006 };

const FALLBACK_VENDORS = [
  { id: 1, name: "PetroSource Iran", country: "Iran", flag: "🇮🇷", lat: 35.6892, lng: 51.389, material: "Petrochemicals", risk: 91, leadTime: 48, costDelta: +22, status: "Critical", tier: "red", alternatives: [2, 7] },
  { id: 2, name: "SinoEarth Shenzhen", country: "China", flag: "🇨🇳", lat: 22.5431, lng: 114.0579, material: "Rare Earth Metals", risk: 64, leadTime: 28, costDelta: +8, status: "Caution", tier: "yellow", alternatives: [6, 8] },
  { id: 3, name: "TaiwanChip Hsinchu", country: "Taiwan", flag: "🇹🇼", lat: 24.8138, lng: 120.9675, material: "Semiconductors", risk: 58, leadTime: 21, costDelta: +5, status: "Watch", tier: "yellow", alternatives: [6, 2] },
  { id: 4, name: "DhakaThread Co.", country: "Bangladesh", flag: "🇧🇩", lat: 23.8103, lng: 90.4125, material: "Textiles", risk: 24, leadTime: 18, costDelta: -3, status: "Stable", tier: "green", alternatives: [] },
  { id: 5, name: "KharkivSteel UA", country: "Ukraine", flag: "🇺🇦", lat: 49.9935, lng: 36.2304, material: "Steel", risk: 88, leadTime: 62, costDelta: +31, status: "Critical", tier: "red", alternatives: [9, 10] },
  { id: 6, name: "SeoulTech Korea", country: "South Korea", flag: "🇰🇷", lat: 37.5665, lng: 126.978, material: "Electronics", risk: 18, leadTime: 14, costDelta: -1, status: "Stable", tier: "green", alternatives: [] },
  { id: 7, name: "AntoLithium Chile", country: "Chile", flag: "🇨🇱", lat: -23.6509, lng: -70.3975, material: "Lithium", risk: 15, leadTime: 22, costDelta: -5, status: "Stable", tier: "green", alternatives: [] },
  { id: 8, name: "VanForest Canada", country: "Canada", flag: "🇨🇦", lat: 49.2827, lng: -123.1207, material: "Timber", risk: 9, leadTime: 10, costDelta: -8, status: "Stable", tier: "green", alternatives: [] },
];

const ALT_VENDORS = {
  9: { name: "TataSteelworks India", country: "India", flag: "🇮🇳", material: "Steel", risk: 29, leadTime: 24, costDelta: +4 },
  10: { name: "CSN Brazil Steel", country: "Brazil", flag: "🇧🇷", material: "Steel", risk: 22, leadTime: 31, costDelta: +2 },
};

const FALLBACK_ALERTS = [
  { id: 1, vendorId: 1, tier: "red", region: "Iran", msg: "Strait of Hormuz delays — est. +18 day lead time impact", time: "2h ago" },
  { id: 2, vendorId: 5, tier: "red", region: "Ukraine", msg: "Kharkiv plant operations suspended indefinitely", time: "5h ago" },
  { id: 3, vendorId: 2, tier: "yellow", region: "China", msg: "Rare earth export licensing reviews underway", time: "1d ago" },
  { id: 4, vendorId: 3, tier: "yellow", region: "Taiwan", msg: "Regional military monitoring elevated", time: "1d ago" },
  { id: 5, vendorId: 7, tier: "green", region: "Chile", msg: "Q3 lithium quotas confirmed stable", time: "2d ago" },
  { id: 6, vendorId: 8, tier: "green", region: "Canada", msg: "No disruptions — exports proceeding normally", time: "3d ago" },
];

// ─── THEME ───────────────────────────────────────────────────────────────────

const T = {
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

// ─── GLOBE ───────────────────────────────────────────────────────────────────

function GlobeScene({ vendors, ports, selectedVendor, onSelectVendor }) {
  const mountRef = useRef(null);
  const animFrameRef = useRef(null);
  const isDragging = useRef(false);
  const prevMouse = useRef({ x: 0, y: 0 });
  const autoRotate = useRef(true);
  const markerMeshes = useRef([]);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const W = el.clientWidth, H = el.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
          color: 0xd4a030,
          size: 0.006,
          transparent: true,
          opacity: 0.65,
        });
        globe.add(new THREE.Points(portGeometry, portMaterial));
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
      if (autoRotate.current) globe.rotation.y += 0.0015;
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
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [vendors, ports, onSelectVendor]);

  useEffect(() => {
    markerMeshes.current.forEach(m => {
      const v = vendors.find(v => v.id === m.userData.vendorId);
      if (!v) return;
      m.material.color.set(selectedVendor === v.id ? "#ffffff" : TIER_COLOR[v.tier]);
      m.scale.setScalar(selectedVendor === v.id ? 1.9 : 1);
    });
  }, [selectedVendor, vendors]);

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

function VendorDrawer({ vendor, onClose }) {
  if (!vendor) return null;
  const altList = (vendor.alternatives || []).map(id => ALT_VENDORS[id]).filter(Boolean).sort((a, b) => a.risk - b.risk);
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
        <button className="w-full py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all hover:opacity-90" style={{ background: T.gold, color: "#0e0b07" }}>
          <Zap size={14} /> Generate AI Report
        </button>
        <button className="w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all hover:bg-white/5" style={{ color: T.green, border: `1px solid ${T.green}40` }}>
          <RefreshCw size={14} /> Switch to Best Vendor
        </button>
      </div>
    </div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────────────────────

export default function App() {
  const [vendors, setVendors] = useState(FALLBACK_VENDORS);
  const [alerts, setAlerts] = useState(FALLBACK_ALERTS);
  const [ports, setPorts] = useState([]);
  const [apiConnected, setApiConnected] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [drawerVendor, setDrawerVendor] = useState(null);
  const [activeTab, setActiveTab] = useState("routes");

  useEffect(() => {
    let alive = true;

    async function loadFromApi() {
      try {
        const [vendorsResult, alertsResult, portsResult] = await Promise.allSettled([
          getVendors(),
          getAlerts(),
          getPorts(),
        ]);

        if (!alive) return;
        let successfulCalls = 0;

        if (vendorsResult.status === "fulfilled") {
          successfulCalls += 1;
          if (Array.isArray(vendorsResult.value) && vendorsResult.value.length > 0) {
            setVendors(vendorsResult.value);
          }
        } else {
          console.warn("[API] Vendors unavailable, using fallback vendors:", vendorsResult.reason);
        }

        if (alertsResult.status === "fulfilled") {
          successfulCalls += 1;
          if (Array.isArray(alertsResult.value) && alertsResult.value.length > 0) {
            setAlerts(alertsResult.value);
          }
        } else {
          console.warn("[API] Alerts unavailable, using fallback alerts:", alertsResult.reason);
        }

        if (portsResult.status === "fulfilled") {
          successfulCalls += 1;
          if (Array.isArray(portsResult.value)) {
            setPorts(portsResult.value);
          }
        } else {
          console.warn("[API] Ports unavailable:", portsResult.reason);
        }

        setApiConnected(successfulCalls > 0);
      } catch (error) {
        if (alive) {
          setApiConnected(false);
          console.warn("[API] Using fallback data:", error);
        }
      }
    }

    loadFromApi();

    return () => {
      alive = false;
    };
  }, []);

  const handleSelectVendor = useCallback((id) => setSelectedVendor(id), []);
  const openDrawer = (v) => setDrawerVendor(v);
  const closeDrawer = () => setDrawerVendor(null);
  const handleAlertClick = (a) => {
    const v = vendors.find((vendor) => vendor.id === a.vendorId);
    if (v) setSelectedVendor(v.id);
  };

  const criticalCount = vendors.filter((v) => v.tier === "red").length;
  const cautionCount = vendors.filter((v) => v.tier === "yellow").length;
  const stableCount = vendors.filter((v) => v.tier === "green").length;
  const totalExposure = vendors
    .filter((v) => v.tier === "red")
    .reduce((a, v) => a + v.costDelta * 80000, 0);
  const selV = vendors.find((v) => v.id === selectedVendor);

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
          <span className="text-xs ml-1 px-1.5 py-0.5 rounded font-mono" style={{ background: T.goldFaint, color: T.goldDim, border: `1px solid ${T.border}` }}>BETA</span>
        </div>

        <div className="flex items-center gap-0.5">
          {["Dashboard", "Routes", "Vendors", "Reports", "Alerts"].map(nav => (
            <button key={nav} className="px-3 py-1 text-xs rounded transition-all font-medium" style={{ color: nav === "Dashboard" ? T.gold : T.textDim, background: nav === "Dashboard" ? T.goldFaint : "transparent" }}>
              {nav}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Live indicator */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded" style={{ background: T.goldFaint, border: `1px solid ${T.border}` }}>
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: apiConnected ? T.green : T.yellow }} />
            <span className="text-xs mono" style={{ color: apiConnected ? T.green : T.yellow }}>
              {apiConnected ? "API LIVE" : "FALLBACK"}
            </span>
          </div>
          <button className="relative p-1.5 rounded hover:bg-white/5 transition-all">
            <Bell size={16} style={{ color: T.textDim }} />
            <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full text-white text-[9px] flex items-center justify-center font-bold" style={{ background: T.red }}>3</span>
          </button>
          <div className="w-7 h-7 rounded font-bold text-xs flex items-center justify-center" style={{ background: T.goldFaint, color: T.gold, border: `1px solid ${T.border}` }}>JD</div>
        </div>
      </nav>

      {/* ── KPI STRIP ── */}
      <div className="grid grid-cols-4" style={{ borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        {[
          { label: "Active Vendors",   value: vendors.length,                          icon: <Globe size={14} />,       color: T.gold, sub: "across 8 regions" },
          { label: "Critical Routes",  value: criticalCount,                           icon: <AlertTriangle size={14}/>, color: T.red,  sub: `${cautionCount} on watch` },
          { label: "Lead Variance",    value: "+12%",                                  icon: <TrendingUp size={14} />,   color: T.yellow,sub: "vs last quarter" },
          { label: "Cost Exposure",    value: `$${(totalExposure/1000000).toFixed(1)}M`,icon: <DollarSign size={14}/>,   color: T.red,  sub: "disrupted routes" },
        ].map((k, i) => (
          <div key={k.label} className="flex items-center gap-3 px-5 py-3" style={{ borderRight: i < 3 ? `1px solid ${T.border}` : "none" }}>
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

          {/* Routes */}
          {activeTab === "routes" && (
            <div className="flex-1 overflow-y-auto">
              {vendors.map(v => (
                <div key={v.id} onClick={() => setSelectedVendor(v.id)} className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-all" style={{ borderBottom: `1px solid ${T.border}`, background: selectedVendor === v.id ? T.goldFaint : "transparent" }}>
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: TIER_COLOR[v.tier] }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold truncate" style={{ color: selectedVendor === v.id ? T.gold : T.text }}>{v.name}</div>
                    <div className="text-xs truncate" style={{ color: T.textDim }}>{v.country} · {v.material}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-xs font-bold mono" style={{ color: TIER_COLOR[v.tier] }}>{v.risk}</div>
                    <div className="text-xs mono" style={{ color: T.textDim }}>{v.leadTime}d</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Alerts */}
          {activeTab === "alerts" && (
            <div className="flex-1 overflow-y-auto">
              {alerts.map(a => (
                <div key={a.id} onClick={() => handleAlertClick(a)} className="px-3 py-2.5 cursor-pointer transition-all hover:bg-white/5 flex gap-2" style={{ borderBottom: `1px solid ${T.border}` }}>
                  <div className="w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0" style={{ background: TIER_COLOR[a.tier] }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold mb-0.5" style={{ color: TIER_COLOR[a.tier] }}>{a.region}</div>
                    <div className="text-xs leading-snug" style={{ color: T.textMid }}>{a.msg}</div>
                    <div className="text-xs mt-1" style={{ color: T.textDim }}>{a.time}</div>
                  </div>
                </div>
              ))}
            </div>
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

          {/* Steel comparison pinned at bottom */}
          <div className="p-3" style={{ borderTop: `1px solid ${T.border}` }}>
            <div className="flex items-center gap-1.5 mb-2">
              <Zap size={11} style={{ color: T.gold }} />
              <span className="text-xs font-bold tracking-widest uppercase" style={{ color: T.gold }}>Steel Routes</span>
            </div>
            <div className="space-y-1.5">
              {[
                { ...(vendors.find(v => v.id === 5) || FALLBACK_VENDORS.find(v => v.id === 5)), isActive: true },
                { name: "TataSteel India",  flag: "🇮🇳", risk: 29, leadTime: 24, costDelta: 4, tier: "green" },
                { name: "CSN Brazil",       flag: "🇧🇷", risk: 22, leadTime: 31, costDelta: 2, tier: "green" },
              ].map((v, i) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded-lg" style={{ background: T.panel, border: `1px solid ${i === 0 ? `${T.red}30` : `${T.green}25`}` }}>
                  <span className="text-sm">{v.flag}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate" style={{ color: T.text }}>{v.name || v.country}</div>
                    <div className="text-xs font-mono" style={{ color: TIER_COLOR[v.tier] }}>Risk {v.risk}</div>
                  </div>
                  <span className="text-xs font-bold" style={{ color: i === 0 ? T.red : T.green }}>{i === 0 ? "Active" : "Alt"}</span>
                </div>
              ))}
            </div>
            <button className="mt-2 w-full py-2 rounded-lg text-xs font-bold transition-all hover:opacity-90" style={{ background: T.gold, color: "#0e0b07" }}>
              Full Report
            </button>
          </div>
        </div>

        {/* ── GLOBE ── */}
        <div className="flex-1 relative">
          <GlobeScene vendors={vendors} ports={ports} selectedVendor={selectedVendor} onSelectVendor={handleSelectVendor} />

          <div className="absolute top-3 left-3 z-10 rounded px-2 py-1 text-xs mono" style={{ background: "rgba(14,11,7,0.85)", color: T.gold, border: `1px solid ${T.borderHi}` }}>
            {ports.length.toLocaleString()} Ports
          </div>

          {/* Legend */}
          <div className="absolute bottom-5 left-5 flex gap-3 z-10">
            {[{ label: "Optimal", color: T.green, count: stableCount }, { label: "Caution", color: T.yellow, count: cautionCount }, { label: "Critical", color: T.red, count: criticalCount }].map(l => (
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
        </div>
      </div>

      {/* Drawer */}
      {drawerVendor && (
        <>
          <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={closeDrawer} />
          <VendorDrawer vendor={drawerVendor} onClose={closeDrawer} />
        </>
      )}
    </div>
  );
}