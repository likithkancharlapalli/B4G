import { useState, useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { AlertTriangle, Bell, Shield, ChevronRight, X, TrendingUp, TrendingDown, Clock, DollarSign, Globe, BarChart2, Zap, RefreshCw } from "lucide-react";

// ─── DATA ────────────────────────────────────────────────────────────────────

const HQ = { name: "HQ — New York", lat: 40.7128, lng: -74.006, color: "#60a5fa" };

const VENDORS = [
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

const ALERTS = [
  { id: 1, vendorId: 1, tier: "red", region: "Iran", msg: "Strait of Hormuz shipping delays — est. +18 day lead time impact", time: "2h ago" },
  { id: 2, vendorId: 5, tier: "red", region: "Ukraine", msg: "Kharkiv plant operations suspended indefinitely", time: "5h ago" },
  { id: 3, vendorId: 2, tier: "yellow", region: "China", msg: "Rare earth export licensing reviews underway", time: "1d ago" },
  { id: 4, vendorId: 3, tier: "yellow", region: "Taiwan", msg: "Regional military monitoring elevated — shipping lanes affected", time: "1d ago" },
  { id: 5, vendorId: 7, tier: "green", region: "Chile", msg: "Q3 lithium export quotas confirmed stable", time: "2d ago" },
  { id: 6, vendorId: 8, tier: "green", region: "Canada", msg: "No disruptions — timber exports proceeding normally", time: "3d ago" },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const TIER_COLOR = { red: "#ef4444", yellow: "#f59e0b", green: "#10b981" };
const TIER_BG = { red: "bg-red-500/20 text-red-400 border-red-500/30", yellow: "bg-amber-500/20 text-amber-400 border-amber-500/30", green: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" };
const TIER_DOT = { red: "bg-red-500", yellow: "bg-amber-500", green: "bg-emerald-500" };

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
    const liftFactor = Math.sin(Math.PI * t) * lift;
    pos.normalize().multiplyScalar(1 + liftFactor);
    points.push(pos);
  }
  return points;
}

// ─── GLOBE COMPONENT ─────────────────────────────────────────────────────────

function GlobeScene({ vendors, selectedVendor, onSelectVendor, focusVendorId }) {
  const mountRef = useRef(null);
  const sceneRef = useRef({});
  const animFrameRef = useRef(null);
  const isDragging = useRef(false);
  const prevMouse = useRef({ x: 0, y: 0 });
  const autoRotate = useRef(true);
  const markerMeshes = useRef([]);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const W = el.clientWidth, H = el.clientHeight;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    // Scene & Camera
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
    camera.position.set(0, 0, 2.8);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const dirLight = new THREE.DirectionalLight(0x6699ff, 1.2);
    dirLight.position.set(5, 3, 5);
    scene.add(dirLight);
    const rimLight = new THREE.DirectionalLight(0x334466, 0.6);
    rimLight.position.set(-5, -3, -5);
    scene.add(rimLight);

    // Globe with Earth texture
    const globeGeo = new THREE.SphereGeometry(1, 64, 64);
    const textureLoader = new THREE.TextureLoader();

    const earthTexture = textureLoader.load(
      "https://unpkg.com/three-globe/example/img/earth-night.jpg",
      () => renderer.render(scene, camera)
    );
    const bumpTexture = textureLoader.load(
      "https://unpkg.com/three-globe/example/img/earth-topology.png"
    );

    const globeMat = new THREE.MeshPhongMaterial({
      map: earthTexture,
      bumpMap: bumpTexture,
      bumpScale: 0.008,
      specular: new THREE.Color(0x2a4a7a),
      shininess: 18,
    });
    const globe = new THREE.Mesh(globeGeo, globeMat);
    scene.add(globe);

    // Subtle grid lines on top
    const gridMat = new THREE.LineBasicMaterial({ color: 0x4a7aaa, transparent: true, opacity: 0.12 });
    for (let lat = -80; lat <= 80; lat += 20) {
      const pts = [];
      for (let lng = 0; lng <= 360; lng += 4) {
        pts.push(latLngToVec3(lat, lng - 180, 1.001));
      }
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
    }
    for (let lng = -180; lng < 180; lng += 20) {
      const pts = [];
      for (let lat = -90; lat <= 90; lat += 4) {
        pts.push(latLngToVec3(lat, lng, 1.001));
      }
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
    }

    // Atmosphere glow
    const atmGeo = new THREE.SphereGeometry(1.08, 64, 64);
    const atmMat = new THREE.MeshPhongMaterial({
      color: 0x1a4a8a,
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide,
    });
    scene.add(new THREE.Mesh(atmGeo, atmMat));

    // HQ marker
    const hqPos = latLngToVec3(HQ.lat, HQ.lng, 1.015);
    const hqGeo = new THREE.SphereGeometry(0.018, 16, 16);
    const hqMat = new THREE.MeshBasicMaterial({ color: 0x60a5fa });
    const hqMesh = new THREE.Mesh(hqGeo, hqMat);
    hqMesh.position.copy(hqPos);
    globe.add(hqMesh);

    // Vendor markers + arcs
    const meshes = [];
    vendors.forEach((v) => {
      const pos = latLngToVec3(v.lat, v.lng, 1.015);
      const color = TIER_COLOR[v.tier];
      const geo = new THREE.SphereGeometry(0.022, 16, 16);
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color) });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      mesh.userData = { vendorId: v.id };
      globe.add(mesh);
      meshes.push(mesh);

      // Outer ring pulse placeholder (ring)
      const ringGeo = new THREE.RingGeometry(0.028, 0.036, 24);
      const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.5, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(pos);
      ring.lookAt(new THREE.Vector3(0, 0, 0));
      ring.userData = { ring: true, baseOpacity: 0.5 };
      globe.add(ring);

      // Arc
      const arcPts = createArcPoints(v.lat, v.lng, HQ.lat, HQ.lng);
      const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPts);
      const arcMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: v.tier === "green" ? 0.55 : 0.8,
        linewidth: 1,
      });
      const arc = new THREE.Line(arcGeo, arcMat);
      arc.userData = { vendorId: v.id, arcMat };
      globe.add(arc);
    });
    markerMeshes.current = meshes;

    // Raycaster for clicking
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const onClick = (e) => {
      if (isDragging.current) return;
      const rect = el.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / W) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / H) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(meshes, true);
      if (hits.length > 0) {
        const vid = hits[0].object.userData.vendorId;
        onSelectVendor(vid);
        autoRotate.current = false;
        setTimeout(() => { autoRotate.current = true; }, 4000);
      }
    };

    // Drag to rotate
    const onMouseDown = (e) => { isDragging.current = false; prevMouse.current = { x: e.clientX, y: e.clientY }; autoRotate.current = false; };
    const onMouseMove = (e) => {
      if (e.buttons !== 1) return;
      const dx = e.clientX - prevMouse.current.x;
      const dy = e.clientY - prevMouse.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) isDragging.current = true;
      globe.rotation.y += dx * 0.005;
      globe.rotation.x += dy * 0.005;
      globe.rotation.x = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, globe.rotation.x));
      prevMouse.current = { x: e.clientX, y: e.clientY };
    };
    const onMouseUp = () => { setTimeout(() => { autoRotate.current = true; }, 2000); };

    el.addEventListener("click", onClick);
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("mousemove", onMouseMove);
    el.addEventListener("mouseup", onMouseUp);

    // Resize
    const onResize = () => {
      const nW = el.clientWidth, nH = el.clientHeight;
      camera.aspect = nW / nH;
      camera.updateProjectionMatrix();
      renderer.setSize(nW, nH);
    };
    window.addEventListener("resize", onResize);

    sceneRef.current = { scene, globe, camera, renderer };

    // Animate
    let t = 0;
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      t += 0.016;
      if (autoRotate.current) {
        globe.rotation.y += 0.0015;
      }
      // Pulse rings
      scene.children.forEach(c => {
        if (c.userData.ring) {
          c.userData.phase = (c.userData.phase || 0) + 0.04;
          c.material.opacity = 0.3 + 0.3 * Math.abs(Math.sin(c.userData.phase));
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
  }, []);

  // Highlight selected vendor
  useEffect(() => {
    markerMeshes.current.forEach(m => {
      const v = vendors.find(v => v.id === m.userData.vendorId);
      if (!v) return;
      const col = TIER_COLOR[v.tier];
      m.material.color.set(selectedVendor === v.id ? "#ffffff" : col);
      m.scale.setScalar(selectedVendor === v.id ? 1.8 : 1);
    });
  }, [selectedVendor]);

  return (
    <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
  );
}

// ─── MINI BAR ────────────────────────────────────────────────────────────────

function RiskBar({ value }) {
  const color = value >= 70 ? "#ef4444" : value >= 35 ? "#f59e0b" : "#10b981";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono w-6 text-right" style={{ color }}>{value}</span>
    </div>
  );
}

// ─── DRAWER ──────────────────────────────────────────────────────────────────

function VendorDrawer({ vendor, onClose }) {
  if (!vendor) return null;
  const altList = (vendor.alternatives || []).map(id => ALT_VENDORS[id]).filter(Boolean);
  const best = altList.sort((a, b) => a.risk - b.risk)[0];

  return (
    <div className="fixed right-0 top-0 h-full w-[420px] z-50 flex flex-col" style={{ background: "linear-gradient(135deg, #0d1b2e 0%, #0a1628 100%)", borderLeft: "1px solid rgba(96,165,250,0.15)", boxShadow: "-20px 0 60px rgba(0,0,0,0.6)" }}>
      {/* Header */}
      <div className="p-6 border-b border-white/10 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xl">{vendor.flag}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${TIER_BG[vendor.tier]}`}>{vendor.status}</span>
          </div>
          <h2 className="text-white font-bold text-lg leading-tight">{vendor.name}</h2>
          <p className="text-slate-400 text-sm">{vendor.country} · {vendor.material}</p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1">
          <X size={18} />
        </button>
      </div>

      {/* KPI Cards */}
      <div className="p-4 grid grid-cols-3 gap-3">
        {[
          { label: "Risk Score", value: vendor.risk, icon: <AlertTriangle size={14} />, color: TIER_COLOR[vendor.tier], suffix: "" },
          { label: "Lead Time", value: `${vendor.leadTime}d`, icon: <Clock size={14} />, color: "#60a5fa", suffix: "" },
          { label: "Cost Δ", value: `${vendor.costDelta > 0 ? "+" : ""}${vendor.costDelta}%`, icon: <DollarSign size={14} />, color: vendor.costDelta > 0 ? "#ef4444" : "#10b981", suffix: "" },
        ].map(k => (
          <div key={k.label} className="rounded-xl p-3 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="flex justify-center mb-1" style={{ color: k.color }}>{k.icon}</div>
            <div className="text-white font-bold text-lg" style={{ color: k.color }}>{k.value}</div>
            <div className="text-slate-500 text-xs">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="px-4 pb-2">
        <div className="text-slate-400 text-xs mb-1">Risk Score</div>
        <RiskBar value={vendor.risk} />
      </div>

      {/* Alternatives */}
      {altList.length > 0 && (
        <div className="p-4 flex-1 overflow-y-auto">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={14} className="text-amber-400" />
            <span className="text-amber-400 text-sm font-semibold tracking-wide uppercase">Recommended Alternatives</span>
          </div>
          <div className="space-y-3">
            {altList.map((alt, i) => (
              <div key={i} className="rounded-xl p-4 relative" style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${alt === best ? "rgba(16,185,129,0.4)" : "rgba(255,255,255,0.08)"}` }}>
                {alt === best && <span className="absolute top-3 right-3 text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-medium">Best Match</span>}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{alt.flag}</span>
                  <div>
                    <div className="text-white text-sm font-semibold">{alt.name}</div>
                    <div className="text-slate-400 text-xs">{alt.country}</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: "Risk", val: alt.risk, color: alt.risk < 35 ? "#10b981" : "#f59e0b" },
                    { label: "Lead", val: `${alt.leadTime}d`, color: "#60a5fa" },
                    { label: "Cost Δ", val: `${alt.costDelta > 0 ? "+" : ""}${alt.costDelta}%`, color: alt.costDelta <= 0 ? "#10b981" : "#f59e0b" },
                  ].map(s => (
                    <div key={s.label}>
                      <div className="font-bold text-sm" style={{ color: s.color }}>{s.val}</div>
                      <div className="text-slate-500 text-xs">{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="p-4 border-t border-white/10 space-y-2">
        <button className="w-full py-3 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2 transition-all hover:opacity-90" style={{ background: "linear-gradient(135deg, #1d4ed8, #3b82f6)" }}>
          <Zap size={15} />
          Generate AI Report
        </button>
        <button className="w-full py-3 rounded-xl font-semibold text-sm text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/10 transition-all flex items-center justify-center gap-2">
          <RefreshCw size={15} />
          Switch to Best Vendor
        </button>
      </div>
    </div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────────────────────

export default function App() {
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [drawerVendor, setDrawerVendor] = useState(null);
  const [activeTab, setActiveTab] = useState("routes");
  const [focusVendorId, setFocusVendorId] = useState(null);

  const handleSelectVendor = useCallback((id) => {
    setSelectedVendor(id);
  }, []);

  const openDrawer = (vendor) => setDrawerVendor(vendor);
  const closeDrawer = () => setDrawerVendor(null);

  const handleAlertClick = (alert) => {
    const v = VENDORS.find(v => v.id === alert.vendorId);
    if (v) { setSelectedVendor(v.id); setFocusVendorId(v.id); }
  };

  const criticalCount = VENDORS.filter(v => v.tier === "red").length;
  const cautionCount = VENDORS.filter(v => v.tier === "yellow").length;
  const stableCount = VENDORS.filter(v => v.tier === "green").length;
  const totalExposure = VENDORS.filter(v => v.tier === "red").reduce((a, v) => a + v.costDelta * 80000, 0);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#060e1a", fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>
      {/* ── NAV ── */}
      <nav className="flex items-center justify-between px-6 py-3 z-40 relative" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(6,14,26,0.95)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #1d4ed8, #3b82f6)" }}>
            <Globe size={16} className="text-white" />
          </div>
          <span className="text-white font-bold text-lg tracking-tight">Supply<span className="text-blue-400">Watch</span></span>
        </div>
        <div className="flex items-center gap-1">
          {["Dashboard", "Routes", "Vendors", "Reports", "Alerts"].map(nav => (
            <button key={nav} className="px-4 py-1.5 text-sm rounded-lg transition-all" style={{ color: nav === "Dashboard" ? "#60a5fa" : "#64748b", background: nav === "Dashboard" ? "rgba(96,165,250,0.1)" : "transparent" }}>
              {nav}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button className="relative p-2 rounded-lg hover:bg-white/5 transition-all">
            <Bell size={18} className="text-slate-400" />
            <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full text-white text-[10px] flex items-center justify-center font-bold">3</span>
          </button>
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold">JD</div>
        </div>
      </nav>

      {/* ── KPI STRIP ── */}
      <div className="grid grid-cols-4 gap-px" style={{ background: "rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        {[
          { label: "Active Vendors", value: VENDORS.length, icon: <Globe size={16} />, color: "#60a5fa", sub: "across 8 regions" },
          { label: "Critical Routes", value: criticalCount, icon: <AlertTriangle size={16} />, color: "#ef4444", sub: `${cautionCount} on watch` },
          { label: "Avg Lead Variance", value: "+12%", icon: <TrendingUp size={16} />, color: "#f59e0b", sub: "vs. last quarter" },
          { label: "Cost Exposure", value: `$${(totalExposure / 1000000).toFixed(1)}M`, icon: <DollarSign size={16} />, color: "#ef4444", sub: "from disrupted routes" },
        ].map(k => (
          <div key={k.label} className="flex items-center gap-4 px-6 py-4" style={{ background: "#070f1c" }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ color: k.color, background: `${k.color}18` }}>{k.icon}</div>
            <div>
              <div className="text-white font-bold text-xl">{k.value}</div>
              <div className="text-slate-400 text-xs">{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── MAIN ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden" style={{ height: "calc(100vh - 120px)" }}>
        {/* Globe */}
        <div className="flex-1 relative">
          <GlobeScene vendors={VENDORS} selectedVendor={selectedVendor} onSelectVendor={handleSelectVendor} focusVendorId={focusVendorId} />

          {/* Legend overlay */}
          <div className="absolute bottom-6 left-6 flex gap-4 z-10">
            {[
              { label: "Optimal", color: "#10b981", count: stableCount },
              { label: "Caution", color: "#f59e0b", count: cautionCount },
              { label: "Critical", color: "#ef4444", count: criticalCount },
            ].map(l => (
              <div key={l.label} className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium" style={{ background: "rgba(6,14,26,0.85)", border: `1px solid ${l.color}40`, color: l.color, backdropFilter: "blur(8px)" }}>
                <div className="w-2 h-2 rounded-full" style={{ background: l.color }} />
                {l.count} {l.label}
              </div>
            ))}
          </div>

          {/* Drag hint */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 text-slate-500 text-xs flex items-center gap-1.5 pointer-events-none">
            <RefreshCw size={11} />
            Drag to rotate · Click a node to inspect
          </div>

          {/* Selected vendor tooltip */}
          {selectedVendor && (() => {
            const v = VENDORS.find(v => v.id === selectedVendor);
            return (
              <div className="absolute top-4 right-4 z-10 rounded-2xl p-4 min-w-[220px]" style={{ background: "rgba(6,14,26,0.92)", border: "1px solid rgba(96,165,250,0.2)", backdropFilter: "blur(16px)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{v.flag}</span>
                  <div>
                    <div className="text-white font-semibold text-sm">{v.name}</div>
                    <div className="text-slate-400 text-xs">{v.material}</div>
                  </div>
                </div>
                <RiskBar value={v.risk} />
                <div className="flex justify-between text-xs mt-2 text-slate-400">
                  <span>Lead: <span className="text-white">{v.leadTime}d</span></span>
                  <span>Cost: <span className={v.costDelta > 0 ? "text-red-400" : "text-emerald-400"}>{v.costDelta > 0 ? "+" : ""}{v.costDelta}%</span></span>
                </div>
                <button onClick={() => openDrawer(v)} className="mt-3 w-full py-2 rounded-xl text-xs font-semibold text-blue-400 border border-blue-500/30 hover:bg-blue-500/10 transition-all flex items-center justify-center gap-1">
                  View Full Report <ChevronRight size={12} />
                </button>
              </div>
            );
          })()}
        </div>

        {/* ── SIDE PANEL ── */}
        <div className="w-80 flex flex-col border-l overflow-hidden" style={{ borderColor: "rgba(255,255,255,0.07)", background: "#070f1c" }}>
          {/* Tabs */}
          <div className="flex border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
            {[{ id: "routes", label: "Routes", icon: <Globe size={13} /> }, { id: "alerts", label: "Alerts", icon: <Bell size={13} /> }, { id: "chart", label: "Risk Chart", icon: <BarChart2 size={13} /> }].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)} className="flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all" style={{ color: activeTab === t.id ? "#60a5fa" : "#475569", borderBottom: activeTab === t.id ? "2px solid #60a5fa" : "2px solid transparent" }}>
                {t.icon}{t.label}
              </button>
            ))}
          </div>

          {/* Routes Tab */}
          {activeTab === "routes" && (
            <div className="flex-1 overflow-y-auto">
              {VENDORS.map(v => (
                <div key={v.id} onClick={() => { setSelectedVendor(v.id); }} className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-all hover:bg-white/5 border-b" style={{ borderColor: "rgba(255,255,255,0.04)", background: selectedVendor === v.id ? "rgba(96,165,250,0.08)" : "transparent" }}>
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${TIER_DOT[v.tier]}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium truncate">{v.name}</div>
                    <div className="text-slate-500 text-xs truncate">{v.country} · {v.material}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-xs font-mono" style={{ color: TIER_COLOR[v.tier] }}>{v.risk}</div>
                    <div className="text-slate-500 text-xs">{v.leadTime}d</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Alerts Tab */}
          {activeTab === "alerts" && (
            <div className="flex-1 overflow-y-auto">
              {ALERTS.map(a => (
                <div key={a.id} onClick={() => handleAlertClick(a)} className="px-4 py-3 cursor-pointer hover:bg-white/5 transition-all border-b flex gap-3" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${TIER_DOT[a.tier]}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold mb-0.5" style={{ color: TIER_COLOR[a.tier] }}>{a.region}</div>
                    <div className="text-slate-300 text-xs leading-snug">{a.msg}</div>
                    <div className="text-slate-600 text-xs mt-1">{a.time}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Chart Tab */}
          {activeTab === "chart" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              <div className="text-slate-400 text-xs mb-3 uppercase tracking-wider">Risk Score by Vendor</div>
              {[...VENDORS].sort((a, b) => b.risk - a.risk).map(v => (
                <div key={v.id} onClick={() => setSelectedVendor(v.id)} className="cursor-pointer p-3 rounded-xl hover:bg-white/5 transition-all" style={{ background: selectedVendor === v.id ? "rgba(96,165,250,0.08)" : "rgba(255,255,255,0.02)", border: selectedVendor === v.id ? "1px solid rgba(96,165,250,0.2)" : "1px solid rgba(255,255,255,0.05)" }}>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-white text-xs font-medium truncate mr-2">{v.flag} {v.name.split(" ")[0]}</span>
                    <span className="text-xs font-mono" style={{ color: TIER_COLOR[v.tier] }}>{v.risk}</span>
                  </div>
                  <RiskBar value={v.risk} />
                </div>
              ))}
            </div>
          )}

          {/* Bottom comparison */}
          <div className="p-4 border-t" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
            <div className="text-slate-400 text-xs uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Zap size={11} className="text-amber-400" />
              Steel Route Comparison
            </div>
            <div className="space-y-2">
              {[
                { ...VENDORS.find(v => v.id === 5), isActive: true },
                { name: "TataSteel India", flag: "🇮🇳", risk: 29, leadTime: 24, costDelta: 4, tier: "green" },
                { name: "CSN Brazil", flag: "🇧🇷", risk: 22, leadTime: 31, costDelta: 2, tier: "green" },
              ].map((v, i) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded-lg" style={{ background: i === 0 ? "rgba(239,68,68,0.08)" : "rgba(16,185,129,0.06)", border: `1px solid ${i === 0 ? "rgba(239,68,68,0.2)" : "rgba(16,185,129,0.15)"}` }}>
                  <span className="text-base">{v.flag}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-xs font-medium truncate">{v.name || v.country}</div>
                    <div className="text-xs" style={{ color: TIER_COLOR[v.tier] }}>Risk: {v.risk}</div>
                  </div>
                  {i === 0 ? <span className="text-red-400 text-xs font-bold">Active</span> : <span className="text-emerald-400 text-xs">Alt</span>}
                </div>
              ))}
            </div>
            <button className="mt-3 w-full py-2.5 rounded-xl text-xs font-semibold text-white transition-all hover:opacity-90" style={{ background: "linear-gradient(135deg, #1d4ed8, #3b82f6)" }}>
              Generate Full Report
            </button>
          </div>
        </div>
      </div>

      {/* Drawer */}
      {drawerVendor && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={closeDrawer} />
          <VendorDrawer vendor={drawerVendor} onClose={closeDrawer} />
        </>
      )}
    </div>
  );
}