import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell, ReferenceLine
} from 'recharts';
import { 
  Shield, Globe, Bell, User, X, Activity, ArrowRight, 
  AlertTriangle, CheckCircle, Clock, Search, Map as MapIcon, 
  Box, FileText, Anchor, Settings
} from 'lucide-react';

const HQ = { lat: 40.7128, lng: -74.0060, name: "HQ — New York" };

const VENDORS = [
  { id: 'v1', name: 'Iran Petro', country: 'Iran', flag: '🇮🇷', lat: 35.6892, lng: 51.3890, tier: 'red', material: 'Petrochemicals', riskScore: 88, leadTime: 42, costVar: '+15%', status: 'Major Delays' },
  { id: 'v2', name: 'Shenzhen Tech', country: 'China', flag: '🇨🇳', lat: 22.5431, lng: 114.0579, tier: 'yellow', material: 'Rare Earth Metals', riskScore: 62, leadTime: 28, costVar: '+4%', status: 'Export Review' },
  { id: 'v3', name: 'Hsinchu Semi', country: 'Taiwan', flag: '🇹🇼', lat: 24.8138, lng: 120.9675, tier: 'yellow', material: 'Semiconductors', riskScore: 58, leadTime: 21, costVar: 'Stable', status: 'Elevated Watch' },
  { id: 'v4', name: 'Dhaka Textiles', country: 'Bangladesh', flag: '🇧🇩', lat: 23.8103, lng: 90.4125, tier: 'green', material: 'Textiles', riskScore: 25, leadTime: 35, costVar: '-2%', status: 'On Schedule' },
  { id: 'v5', name: 'Kharkiv Steel', country: 'Ukraine', flag: '🇺🇦', lat: 49.9935, lng: 36.2304, tier: 'red', material: 'Steel', riskScore: 95, leadTime: null, costVar: 'Unknown', status: 'Plant Suspended' },
  { id: 'v6', name: 'Seoul Electronics', country: 'South Korea', flag: '🇰🇷', lat: 37.5665, lng: 126.9780, tier: 'green', material: 'Electronics', riskScore: 18, leadTime: 14, costVar: 'Stable', status: 'Optimal' },
  { id: 'v7', name: 'Antofagasta Lithium', country: 'Chile', flag: '🇨🇱', lat: -23.6509, lng: -70.3975, tier: 'green', material: 'Lithium', riskScore: 30, leadTime: 18, costVar: 'Stable', status: 'Optimal' },
  { id: 'v8', name: 'Vancouver Timber', country: 'Canada', flag: '🇨🇦', lat: 49.2827, lng: -123.1207, tier: 'green', material: 'Timber', riskScore: 12, leadTime: 8, costVar: '-1%', status: 'Optimal' },
];

const ALERTS = [
  { id: 'a1', vendorId: 'v1', country: 'Iran', text: 'Strait of Hormuz delays — +18 day impact', time: '2h ago', tier: 'red' },
  { id: 'a2', vendorId: 'v5', country: 'Ukraine', text: 'Kharkiv plant suspended', time: '5h ago', tier: 'red' },
  { id: 'a3', vendorId: 'v2', country: 'China', text: 'Rare earth export review underway', time: '1d ago', tier: 'yellow' },
  { id: 'a4', vendorId: 'v3', country: 'Taiwan', text: 'Regional monitoring elevated', time: '1d ago', tier: 'yellow' },
  { id: 'a5', vendorId: 'v7', country: 'Chile', text: 'Q3 lithium quotas confirmed stable', time: '2d ago', tier: 'green' },
  { id: 'a6', vendorId: 'v8', country: 'Canada', text: 'No disruptions reported', time: '3d ago', tier: 'green' },
];

const ALTERNATIVES = {
  v1: [
    { name: 'Houston Chem', country: 'USA', risk: 15, leadTime: 4, costDiff: '+8%' },
    { name: 'Rotterdam Synth', country: 'Netherlands', risk: 22, leadTime: 12, costDiff: '+12%' }
  ],
  v5: [
    { name: 'Pittsburgh Forge', country: 'USA', risk: 10, leadTime: 6, costDiff: '+25%' },
    { name: 'Tata Steel', country: 'India', risk: 40, leadTime: 30, costDiff: '-5%' }
  ]
};

const TIER_COLORS = { red: '#ef4444', yellow: '#f59e0b', green: '#10b981' };
const TIER_STYLES = {
  red: 'bg-red-500 text-red-100 border-red-600',
  yellow: 'bg-amber-500 text-amber-950 border-amber-600',
  green: 'bg-emerald-500 text-emerald-100 border-emerald-600'
};

function getBezierPoints(p1, p2, numPoints = 25, curveFactor = 0.25) {
  const direction = p1.lng > p2.lng ? 1 : -1;
  const mid = { lat: (p1.lat + p2.lat) / 2, lng: (p1.lng + p2.lng) / 2 };
  const diff = { lat: p2.lat - p1.lat, lng: p2.lng - p1.lng };
  const perp = { lat: -diff.lng * direction, lng: diff.lat * direction };
  const control = { lat: mid.lat + perp.lat * curveFactor, lng: mid.lng + perp.lng * curveFactor };
  const points = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const lat = (1 - t) * (1 - t) * p1.lat + 2 * (1 - t) * t * control.lat + t * t * p2.lat;
    const lng = (1 - t) * (1 - t) * p1.lng + 2 * (1 - t) * t * control.lng + t * t * p2.lng;
    points.push([lat, lng]);
  }
  return points;
}

export default function App() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markersRef = useRef({});
  const [leafletReady, setLeafletReady] = useState(false);
  const [activeVendorId, setActiveVendorId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (document.getElementById('leaflet-css')) { setLeafletReady(true); return; }
    const css = document.createElement('link');
    css.id = 'leaflet-css'; css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const script = document.createElement('script');
    script.id = 'leaflet-js';
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => setLeafletReady(true);
    document.head.appendChild(script);
    const style = document.createElement('style');
    style.innerHTML = `
      .leaflet-container { background: #020617 !important; font-family: inherit; }
      .map-marker { border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 8px rgba(0,0,0,0.8); }
      .marker-hq { background-color: #3b82f6; box-shadow: 0 0 15px 5px rgba(59,130,246,0.4); }
      .marker-green { background-color: #10b981; }
      .marker-yellow { background-color: #f59e0b; }
      .marker-red { background-color: #ef4444; animation: pulse-red 2s infinite; }
      @keyframes pulse-red {
        0% { box-shadow: 0 0 0 0 rgba(239,68,68,0.7); }
        70% { box-shadow: 0 0 0 15px rgba(239,68,68,0); }
        100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
      }
      .route-path { stroke-dasharray: 6 8; animation: flow 1.5s linear infinite; }
      .route-path-solid { stroke-dasharray: 100 100; animation: flow-solid 3s linear infinite; }
      @keyframes flow { to { stroke-dashoffset: -14; } }
      @keyframes flow-solid { to { stroke-dashoffset: -200; } }
      .route-path:hover, .route-path-solid:hover { stroke-width: 4px; filter: brightness(1.5); cursor: pointer; }
      .dark-popup .leaflet-popup-content-wrapper { background: #0f172a; color: #f8fafc; border: 1px solid #334155; border-radius: 0.5rem; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); }
      .dark-popup .leaflet-popup-tip { background: #0f172a; border-top: 1px solid #334155; border-left: 1px solid #334155; }
      .leaflet-control-attribution { display: none !important; }
      .alert-item { opacity: 0; animation: fade-in 0.5s forwards; }
      @keyframes fade-in { to { opacity: 1; } }
    `;
    document.head.appendChild(style);
  }, []);

  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstance.current) return;
    const L = window.L;
    const map = L.map(mapRef.current, { center: [30, 0], zoom: 2.5, zoomControl: false, worldCopyJump: true });
    mapInstance.current = map;
    L.tileLayer('https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    const hqIcon = L.divIcon({ className: 'map-marker marker-hq', iconSize: [16, 16] });
    L.marker([HQ.lat, HQ.lng], { icon: hqIcon, zIndexOffset: 1000 })
      .addTo(map)
      .bindTooltip(HQ.name, { permanent: true, direction: 'right', className: 'bg-transparent border-0 text-blue-400 font-bold shadow-none' });

    VENDORS.forEach(v => {
      const icon = L.divIcon({ className: `map-marker marker-${v.tier}`, iconSize: [14, 14] });
      const marker = L.marker([v.lat, v.lng], { icon }).addTo(map);
      markersRef.current[v.id] = marker;
      const popupContent = `
        <div class="p-1 min-w-[200px] font-sans">
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-bold text-base text-slate-100">${v.name}</h3>
            <span class="text-xl">${v.flag}</span>
          </div>
          <p class="text-sm text-slate-400 mb-3 border-b border-slate-700 pb-2">${v.material}</p>
          <div class="flex justify-between items-center mb-4">
            <div class="flex flex-col">
              <span class="text-[10px] text-slate-500 uppercase tracking-wider">Risk Score</span>
              <span class="text-${v.tier === 'yellow' ? 'amber' : v.tier}-400 font-bold text-lg">${v.riskScore}/100</span>
            </div>
            <div class="flex flex-col text-right">
              <span class="text-[10px] text-slate-500 uppercase tracking-wider">Lead Time</span>
              <span class="text-slate-200 font-medium">${v.leadTime ? v.leadTime + 'd' : 'N/A'}</span>
            </div>
          </div>
          <button id="btn-report-${v.id}" class="w-full bg-slate-800 hover:bg-blue-600 text-white text-xs font-semibold py-2 rounded transition-colors flex items-center justify-center gap-2 border border-slate-700 hover:border-blue-500">
            View Full Report <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </button>
        </div>`;
      marker.bindPopup(popupContent, { className: 'dark-popup', closeButton: false });
      marker.on('popupopen', () => {
        const btn = document.getElementById(`btn-report-${v.id}`);
        if (btn) btn.addEventListener('click', () => { setActiveVendorId(v.id); setDrawerOpen(true); });
      });
      const isSolid = v.tier === 'green';
      const points = getBezierPoints(v, HQ);
      const polyline = L.polyline(points, {
        color: TIER_COLORS[v.tier], weight: isSolid ? 2 : 2.5, opacity: isSolid ? 0.6 : 0.8,
        className: isSolid ? 'route-path-solid' : 'route-path'
      }).addTo(map);
      polyline.bindTooltip(
        `<div class="text-xs"><strong>${v.country} &rarr; NY</strong><br/>Status: ${v.status}<br/>Est. Lead: ${v.leadTime ? v.leadTime + ' days' : 'Unknown'}</div>`,
        { sticky: true, className: 'bg-slate-900 text-slate-200 border-slate-700' }
      );
    });
  }, [leafletReady]);

  const focusVendor = (v) => {
    if (!mapInstance.current || !markersRef.current[v.id]) return;
    mapInstance.current.flyTo([v.lat, v.lng], 5, { duration: 1.5 });
    setTimeout(() => markersRef.current[v.id].openPopup(), 1500);
  };

  const activeVendor = useMemo(() => VENDORS.find(v => v.id === activeVendorId), [activeVendorId]);

  return (
    <div className="h-screen w-full bg-slate-950 text-slate-200 font-sans flex flex-col overflow-hidden selection:bg-blue-500/30">
      <nav className="h-16 flex items-center justify-between px-6 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-b border-slate-800 z-[1000] shadow-sm relative">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600/20 p-2 rounded-lg border border-blue-500/30">
            <Globe className="w-6 h-6 text-blue-400" />
          </div>
          <h1 className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">SupplyWatch</h1>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-400">
          <a href="#" className="text-blue-400 border-b-2 border-blue-500 pb-5 pt-5">Dashboard</a>
          <a href="#" className="hover:text-slate-200 transition-colors">Routes</a>
          <a href="#" className="hover:text-slate-200 transition-colors">Vendors</a>
          <a href="#" className="hover:text-slate-200 transition-colors">Reports</a>
          <a href="#" className="hover:text-slate-200 transition-colors flex items-center gap-1"><Shield className="w-4 h-4" /> Intelligence</a>
        </div>
        <div className="flex items-center gap-5">
          <div className="relative cursor-pointer hover:bg-slate-800 p-2 rounded-full transition-colors">
            <Bell className="w-5 h-5 text-slate-300" />
            <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-slate-950"></span>
          </div>
          <div className="flex items-center gap-2 cursor-pointer bg-slate-800/50 hover:bg-slate-800 border border-slate-700 py-1.5 px-3 rounded-full transition-colors">
            <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white">PM</div>
          </div>
        </div>
      </nav>

      <div className="flex-1 relative flex flex-col">
        <div className="flex-1 relative bg-slate-950">
          <div ref={mapRef} className="absolute inset-0 z-0"></div>
          <div className="absolute bottom-0 left-0 w-full h-24 bg-gradient-to-t from-slate-950 to-transparent pointer-events-none z-[10]"></div>
        </div>

        <div className="h-[280px] bg-slate-950 border-t border-slate-800 p-4 z-[20] grid grid-cols-1 md:grid-cols-3 gap-6 shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.5)] relative">
          
          <div className="flex flex-col bg-slate-900/50 rounded-xl border border-slate-800/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800/60 flex items-center justify-between bg-slate-900/80">
              <h3 className="font-semibold text-sm flex items-center gap-2"><MapIcon className="w-4 h-4 text-slate-400" /> Active Routes</h3>
              <span className="text-xs bg-slate-800 px-2 py-0.5 rounded-full text-slate-400">{VENDORS.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {VENDORS.map((v) => (
                <div key={v.id} onClick={() => focusVendor(v)} className="flex items-center justify-between p-2 hover:bg-slate-800/80 rounded cursor-pointer transition-colors group">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full`} style={{ backgroundColor: TIER_COLORS[v.tier] }}></span>
                    <div>
                      <p className="text-sm font-medium text-slate-200 group-hover:text-blue-400 transition-colors">{v.name}</p>
                      <p className="text-[10px] text-slate-500">{v.country}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-300">{v.leadTime ? `${v.leadTime} days` : 'Offline'}</p>
                    <p className="text-[10px]" style={{ color: TIER_COLORS[v.tier] }}>{v.status}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col bg-slate-900/50 rounded-xl border border-slate-800/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800/60 flex items-center justify-between bg-slate-900/80">
              <h3 className="font-semibold text-sm flex items-center gap-2"><Activity className="w-4 h-4 text-slate-400" /> Risk Assessment</h3>
            </div>
            <div className="flex-1 p-4 pb-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={VENDORS} layout="vertical" margin={{ top: 0, right: 20, left: -20, bottom: 0 }}>
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} width={90} />
                  <RechartsTooltip cursor={{ fill: '#1e293b' }} content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const d = payload[0].payload;
                      return (
                        <div className="bg-slate-800 border border-slate-700 p-2 rounded shadow-xl text-xs">
                          <p className="font-bold mb-1">{d.name}</p>
                          <p>Risk Score: <span style={{ color: TIER_COLORS[d.tier] }}>{d.riskScore}</span></p>
                        </div>
                      );
                    }
                    return null;
                  }} />
                  <ReferenceLine x={50} stroke="#334155" strokeDasharray="3 3" />
                  <ReferenceLine x={75} stroke="#334155" strokeDasharray="3 3" />
                  <Bar dataKey="riskScore" radius={[0, 4, 4, 0]} barSize={12} onClick={(data) => focusVendor(data)}>
                    {VENDORS.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={TIER_COLORS[entry.tier]} className="cursor-pointer" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex justify-between text-[9px] text-slate-500 mt-1 pl-[70px] pr-5">
                <span>0</span><span>50 (Watch)</span><span>75 (Critical)</span><span>100</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col bg-slate-900/50 rounded-xl border border-slate-800/60 overflow-hidden relative">
            <div className="px-4 py-3 border-b border-slate-800/60 flex items-center justify-between bg-slate-900/80 sticky top-0 z-10">
              <h3 className="font-semibold text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" /> Live Intelligence</h3>
              <div className="flex items-center gap-1 text-[10px] text-slate-400 bg-slate-800 px-2 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span> Live Feed
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
              {ALERTS.map((alert, idx) => {
                const vendor = VENDORS.find(v => v.id === alert.vendorId);
                return (
                  <div key={alert.id} className="alert-item bg-slate-800/40 hover:bg-slate-800 border border-slate-700/50 rounded-lg p-2.5 cursor-pointer transition-colors" style={{ animationDelay: `${idx * 0.15}s` }} onClick={() => focusVendor(vendor)}>
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5">
                        {alert.tier === 'red' && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
                        {alert.tier === 'yellow' && <Clock className="w-3.5 h-3.5 text-amber-500" />}
                        {alert.tier === 'green' && <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline mb-0.5">
                          <span className="text-xs font-semibold text-slate-300 truncate">{alert.country}</span>
                          <span className="text-[9px] text-slate-500 whitespace-nowrap">{alert.time}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-tight">{alert.text}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className={`fixed right-0 top-16 bottom-0 w-full md:w-[420px] bg-slate-900 border-l border-slate-700 shadow-2xl z-[2000] transform transition-transform duration-300 ease-in-out flex flex-col ${drawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        {activeVendor && (
          <>
            <div className="p-5 border-b border-slate-800 bg-slate-900/80 sticky top-0 z-10 flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-2xl">{activeVendor.flag}</span>
                  <h2 className="text-xl font-bold text-slate-100">{activeVendor.name}</h2>
                </div>
                <p className="text-sm text-slate-400 flex items-center gap-2">
                  <MapIcon className="w-3.5 h-3.5" /> {activeVendor.country} &bull; <Box className="w-3.5 h-3.5 ml-1" /> {activeVendor.material}
                </p>
              </div>
              <button onClick={() => setDrawerOpen(false)} className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-md text-slate-400 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              <div className={`p-3 rounded-lg border flex items-start gap-3 ${TIER_STYLES[activeVendor.tier]}`}>
                <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
                <div>
                  <h4 className="font-bold text-sm uppercase tracking-wide opacity-90">Current Status: {activeVendor.status}</h4>
                  <p className="text-xs opacity-80 mt-1">
                    {activeVendor.tier === 'red' ? 'Critical disruption active. Alternative sourcing highly recommended immediately.' :
                     activeVendor.tier === 'yellow' ? 'Monitoring elevated risk factors. Prepare contingency plans.' :
                     'Operations normal. Route efficiency is currently optimal.'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-700/50 text-center">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Risk Score</p>
                  <p className="text-2xl font-bold" style={{ color: TIER_COLORS[activeVendor.tier] }}>{activeVendor.riskScore}</p>
                  <p className="text-[9px] text-slate-500 mt-1">/100 Index</p>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-700/50 text-center">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Lead Time</p>
                  <p className="text-2xl font-bold text-slate-200">{activeVendor.leadTime || 'N/A'}</p>
                  <p className="text-[9px] text-slate-500 mt-1">Days to HQ</p>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-700/50 text-center">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Cost Var.</p>
                  <p className={`text-xl font-bold mt-1 ${activeVendor.costVar.startsWith('+') ? 'text-red-400' : activeVendor.costVar.startsWith('-') ? 'text-emerald-400' : 'text-slate-300'}`}>{activeVendor.costVar}</p>
                  <p className="text-[9px] text-slate-500 mt-1">vs Benchmark</p>
                </div>
              </div>

              <button className="w-full bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 p-3 rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-colors">
                <FileText className="w-4 h-4" /> Generate AI Supply Chain Brief
              </button>

              {ALTERNATIVES[activeVendor.id] && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-300 mb-3 border-b border-slate-800 pb-2 flex items-center gap-2">
                    <Anchor className="w-4 h-4 text-blue-400" /> Recommended Alternatives
                  </h3>
                  <div className="space-y-3">
                    {ALTERNATIVES[activeVendor.id].map((alt, idx) => (
                      <div key={idx} className="bg-slate-800/30 border border-slate-700 rounded-lg p-3 relative overflow-hidden group">
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500"></div>
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h4 className="font-semibold text-slate-200 text-sm">{alt.name}</h4>
                            <p className="text-[10px] text-slate-400">{alt.country}</p>
                          </div>
                          <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-[10px] font-bold">Risk: {alt.risk}</span>
                        </div>
                        <div className="flex justify-between items-end mt-3">
                          <div className="flex gap-4 text-xs">
                            <div>
                              <span className="text-slate-500 block text-[9px]">Lead Time</span>
                              <span className="text-slate-300">{alt.leadTime} days</span>
                            </div>
                            <div>
                              <span className="text-slate-500 block text-[9px]">Est. Cost Impact</span>
                              <span className={alt.costDiff.startsWith('+') ? 'text-red-400' : 'text-emerald-400'}>{alt.costDiff}</span>
                            </div>
                          </div>
                          <button className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded transition-colors flex items-center gap-1 opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0 duration-200">
                            Switch <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
