import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell, ReferenceLine, LineChart, Line
} from 'recharts';
import {
  Shield, Globe, Bell, X, Activity, ArrowRight,
  AlertTriangle, CheckCircle, Clock, Map as MapIcon,
  Box, FileText, Anchor, TrendingUp, Zap, ChevronDown
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

const TREND_DATA = [
  { day: 'Mon', avgRisk: 65, activeIssues: 3 },
  { day: 'Tue', avgRisk: 68, activeIssues: 4 },
  { day: 'Wed', avgRisk: 62, activeIssues: 2 },
  { day: 'Thu', avgRisk: 71, activeIssues: 5 },
  { day: 'Fri', avgRisk: 58, activeIssues: 2 },
  { day: 'Sat', avgRisk: 61, activeIssues: 3 },
  { day: 'Sun', avgRisk: 64, activeIssues: 3 },
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
  const [expandedAlert, setExpandedAlert] = useState(null);

  useEffect(() => {
    if (document.getElementById('leaflet-css')) { setLeafletReady(true); return; }
    const css = document.createElement('link');
    css.id = 'leaflet-css';
    css.rel = 'stylesheet';
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
      .map-marker { border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 8px rgba(0,0,0,0.8); cursor: pointer; transition: transform 0.2s; }
      .map-marker:hover { transform: scale(1.3); }
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
      .scroll-smooth::-webkit-scrollbar { width: 6px; }
      .scroll-smooth::-webkit-scrollbar-track { background: transparent; }
      .scroll-smooth::-webkit-scrollbar-thumb { background: #475569; border-radius: 3px; }
      .scroll-smooth::-webkit-scrollbar-thumb:hover { background: #64748b; }
      @keyframes slideInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes slideInRight { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes scaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
      .animate-slide-up { animation: slideInUp 0.5s ease-out forwards; }
      .animate-slide-right { animation: slideInRight 0.5s ease-out forwards; }
      .animate-fade { animation: fadeIn 0.6s ease-out forwards; }
      .animate-scale { animation: scaleIn 0.4s ease-out forwards; }
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
  const criticalCount = VENDORS.filter(v => v.tier === 'red').length;
  const warningCount = VENDORS.filter(v => v.tier === 'yellow').length;
  const optimalCount = VENDORS.filter(v => v.tier === 'green').length;

  return (
    <div className="h-screen w-full bg-slate-950 text-slate-200 font-sans flex flex-col overflow-hidden selection:bg-blue-500/30">
      <nav className="h-16 flex items-center justify-between px-6 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-b border-slate-800 z-[1000] shadow-sm relative animate-fade">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600/20 p-2 rounded-lg border border-blue-500/30">
            <Globe className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">SupplyWatch</h1>
            <p className="text-[10px] text-slate-500">Global Supply Chain Intelligence</p>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm font-medium">
          <div className="flex gap-6">
            <a href="#" className="text-blue-400 border-b-2 border-blue-500 pb-5 pt-5 hover:text-blue-300 transition-colors">Dashboard</a>
            <a href="#" className="text-slate-400 hover:text-slate-200 transition-colors">Routes</a>
            <a href="#" className="text-slate-400 hover:text-slate-200 transition-colors">Vendors</a>
            <a href="#" className="text-slate-400 hover:text-slate-200 transition-colors">Reports</a>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-3">
            <div className="text-right text-xs hidden sm:block">
              <div className="font-semibold text-red-400">{criticalCount} Critical</div>
              <div className="text-slate-500">Risk Status</div>
            </div>
            <div className="relative cursor-pointer hover:bg-slate-800 p-2 rounded-full transition-colors">
              <Bell className="w-5 h-5 text-slate-300" />
              <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-slate-950 animate-pulse"></span>
            </div>
          </div>
        </div>
      </nav>

      <div className="flex-1 relative flex flex-col">
        <div className="flex-1 relative bg-slate-950">
          <div ref={mapRef} className="absolute inset-0 z-0"></div>
          <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-slate-950 via-slate-950/50 to-transparent pointer-events-none z-[10]"></div>
        </div>

        <div className="h-auto max-h-[340px] bg-slate-950 border-t border-slate-800 p-4 z-[20] grid grid-cols-1 md:grid-cols-4 gap-4 shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.5)] relative overflow-y-auto scroll-smooth">

          <div className="flex flex-col bg-gradient-to-br from-slate-900/80 to-slate-900/40 rounded-xl border border-slate-800/60 overflow-hidden backdrop-blur-sm animate-slide-up" style={{ animationDelay: '0.1s' }}>
            <div className="px-4 py-3 border-b border-slate-800/60 flex items-center justify-between bg-slate-900/80">
              <h3 className="font-semibold text-sm flex items-center gap-2"><MapIcon className="w-4 h-4 text-blue-400" /> Active Routes</h3>
              <span className="text-xs bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full font-semibold">{VENDORS.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {VENDORS.map((v, idx) => (
                <div
                  key={v.id}
                  onClick={() => focusVendor(v)}
                  className="flex items-center justify-between p-2.5 hover:bg-slate-800/60 rounded-lg cursor-pointer transition-all duration-200 group hover:scale-105 hover:shadow-lg"
                  style={{ animationDelay: `${idx * 0.05}s` }}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`w-2.5 h-2.5 rounded-full group-hover:scale-150 transition-transform`} style={{ backgroundColor: TIER_COLORS[v.tier] }}></span>
                    <div>
                      <p className="text-sm font-medium text-slate-200 group-hover:text-blue-300 transition-colors">{v.name}</p>
                      <p className="text-[10px] text-slate-500">{v.country}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-300">{v.leadTime ? `${v.leadTime}d` : 'N/A'}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col bg-gradient-to-br from-slate-900/80 to-slate-900/40 rounded-xl border border-slate-800/60 overflow-hidden backdrop-blur-sm animate-slide-up md:col-span-2" style={{ animationDelay: '0.2s' }}>
            <div className="px-4 py-3 border-b border-slate-800/60 flex items-center justify-between bg-slate-900/80">
              <h3 className="font-semibold text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-400" /> Weekly Risk Trend</h3>
            </div>
            <div className="flex-1 p-4 pb-2">
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={TREND_DATA}>
                  <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis domain={[0, 100]} hide />
                  <RechartsTooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '0.5rem' }}
                    cursor={{ stroke: '#64748b' }}
                  />
                  <Line type="monotone" dataKey="avgRisk" stroke="#3b82f6" strokeWidth={2.5} dot={{ fill: '#3b82f6', r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="flex flex-col bg-gradient-to-br from-slate-900/80 to-slate-900/40 rounded-xl border border-slate-800/60 overflow-hidden backdrop-blur-sm animate-slide-up" style={{ animationDelay: '0.3s' }}>
            <div className="px-4 py-3 border-b border-slate-800/60 bg-slate-900/80">
              <h3 className="font-semibold text-sm flex items-center gap-2"><Activity className="w-4 h-4 text-slate-400" /> Status Overview</h3>
            </div>
            <div className="flex-1 p-4 flex flex-col justify-center space-y-3">
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
                <span className="text-sm text-slate-300">Critical</span>
                <span className="text-2xl font-bold text-red-400">{criticalCount}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <span className="text-sm text-slate-300">Warning</span>
                <span className="text-2xl font-bold text-amber-400">{warningCount}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <span className="text-sm text-slate-300">Optimal</span>
                <span className="text-2xl font-bold text-emerald-400">{optimalCount}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="h-[200px] bg-slate-950 border-t border-slate-800 p-4 z-[20] flex gap-4 shadow-sm overflow-y-auto scroll-smooth">
          <div className="flex-1 flex flex-col bg-gradient-to-br from-slate-900/80 to-slate-900/40 rounded-xl border border-slate-800/60 overflow-hidden backdrop-blur-sm animate-slide-right" style={{ animationDelay: '0.4s' }}>
            <div className="px-4 py-3 border-b border-slate-800/60 flex items-center justify-between bg-slate-900/80 sticky top-0 z-10">
              <h3 className="font-semibold text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" /> Live Alerts</h3>
              <div className="flex items-center gap-1 text-[10px] text-slate-400 bg-slate-800 px-2 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span> {ALERTS.filter(a => a.tier === 'red').length} Critical
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5 scroll-smooth">
              {ALERTS.map((alert, idx) => {
                const vendor = VENDORS.find(v => v.id === alert.vendorId);
                const isExpanded = expandedAlert === alert.id;
                return (
                  <div
                    key={alert.id}
                    onClick={() => setExpandedAlert(isExpanded ? null : alert.id)}
                    className="bg-slate-800/40 hover:bg-slate-800/70 border border-slate-700/50 rounded-lg p-2.5 cursor-pointer transition-all duration-200 hover:scale-105 group animate-scale"
                    style={{ animationDelay: `${idx * 0.08}s` }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <div className="mt-0.5 shrink-0">
                          {alert.tier === 'red' && <AlertTriangle className="w-4 h-4 text-red-500" />}
                          {alert.tier === 'yellow' && <Clock className="w-4 h-4 text-amber-500" />}
                          {alert.tier === 'green' && <CheckCircle className="w-4 h-4 text-emerald-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-300">{alert.country}</p>
                          <p className="text-[11px] text-slate-400 leading-tight line-clamp-2">{alert.text}</p>
                          <p className="text-[9px] text-slate-500 mt-1">{alert.time}</p>
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); focusVendor(vendor); }}
                        className="text-blue-400 hover:text-blue-300 shrink-0 transition-colors"
                      >
                        <Zap className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="w-72 flex flex-col bg-gradient-to-br from-slate-900/80 to-slate-900/40 rounded-xl border border-slate-800/60 overflow-hidden backdrop-blur-sm animate-slide-right" style={{ animationDelay: '0.5s' }}>
            <div className="px-4 py-3 border-b border-slate-800/60 bg-slate-900/80">
              <h3 className="font-semibold text-sm flex items-center gap-2"><Activity className="w-4 h-4 text-slate-400" /> Risk Distribution</h3>
            </div>
            <div className="flex-1 p-4 pb-2 overflow-y-auto scroll-smooth">
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={VENDORS} layout="vertical" margin={{ top: 0, right: 20, left: -20, bottom: 0 }}>
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 9 }} width={70} />
                  <Bar dataKey="riskScore" radius={[0, 4, 4, 0]} barSize={10} onClick={(data) => focusVendor(data)}>
                    {VENDORS.map((entry) => (
                      <Cell key={entry.id} fill={TIER_COLORS[entry.tier]} className="cursor-pointer hover:opacity-80" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      <div className={`fixed right-0 top-16 bottom-0 w-full md:w-[420px] bg-gradient-to-b from-slate-900 to-slate-950 border-l border-slate-700 shadow-2xl z-[2000] transform transition-all duration-300 ease-out flex flex-col ${drawerOpen ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0 pointer-events-none'}`}>
        {activeVendor && (
          <>
            <div className="p-5 border-b border-slate-800 bg-slate-900/80 sticky top-0 z-10 flex justify-between items-start backdrop-blur-sm">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-3xl animate-bounce" style={{ animationDuration: '2s' }}>{activeVendor.flag}</span>
                  <h2 className="text-xl font-bold text-slate-100">{activeVendor.name}</h2>
                </div>
                <p className="text-sm text-slate-400 flex items-center gap-2">
                  <MapIcon className="w-3.5 h-3.5" /> {activeVendor.country} · <Box className="w-3.5 h-3.5" /> {activeVendor.material}
                </p>
              </div>
              <button onClick={() => setDrawerOpen(false)} className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-md text-slate-400 transition-all hover:scale-110">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6 scroll-smooth">
              <div className={`p-4 rounded-lg border flex items-start gap-3 ${TIER_STYLES[activeVendor.tier]} animate-scale`}>
                <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
                <div>
                  <h4 className="font-bold text-sm uppercase tracking-wide opacity-90">Status: {activeVendor.status}</h4>
                  <p className="text-xs opacity-80 mt-1">
                    {activeVendor.tier === 'red' ? 'Critical disruption. Alternative sourcing recommended immediately.' :
                     activeVendor.tier === 'yellow' ? 'Elevated risk detected. Prepare contingency plans.' :
                     'Operations optimal. Route efficiency excellent.'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-700/50 text-center hover:border-slate-600 transition-all hover:bg-slate-800 cursor-pointer transform hover:scale-105">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Risk</p>
                  <p className="text-2xl font-bold" style={{ color: TIER_COLORS[activeVendor.tier] }}>{activeVendor.riskScore}</p>
                  <p className="text-[9px] text-slate-500 mt-1">/100</p>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-700/50 text-center hover:border-slate-600 transition-all hover:bg-slate-800 cursor-pointer transform hover:scale-105">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Lead Time</p>
                  <p className="text-2xl font-bold text-slate-200">{activeVendor.leadTime || 'N/A'}</p>
                  <p className="text-[9px] text-slate-500 mt-1">Days</p>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-700/50 text-center hover:border-slate-600 transition-all hover:bg-slate-800 cursor-pointer transform hover:scale-105">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Cost Var</p>
                  <p className={`text-xl font-bold mt-1 ${activeVendor.costVar.startsWith('+') ? 'text-red-400' : activeVendor.costVar.startsWith('-') ? 'text-emerald-400' : 'text-slate-300'}`}>{activeVendor.costVar}</p>
                </div>
              </div>

              <button className="w-full bg-blue-600/30 hover:bg-blue-600/40 border border-blue-500/30 text-blue-300 p-3 rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-all hover:scale-105 group">
                <Zap className="w-4 h-4 group-hover:scale-125 transition-transform" /> Generate AI Brief
              </button>

              {ALTERNATIVES[activeVendor.id] && (
                <div className="animate-scale">
                  <h3 className="text-sm font-semibold text-slate-300 mb-3 border-b border-slate-800 pb-2 flex items-center gap-2">
                    <Anchor className="w-4 h-4 text-emerald-400" /> Better Alternatives
                  </h3>
                  <div className="space-y-3">
                    {ALTERNATIVES[activeVendor.id].map((alt, idx) => (
                      <div key={idx} className="bg-slate-800/30 border border-slate-700 rounded-lg p-3 relative overflow-hidden group hover:border-slate-600 transition-all hover:bg-slate-800/50 hover:scale-105 cursor-pointer">
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500"></div>
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h4 className="font-semibold text-slate-200 text-sm group-hover:text-emerald-400 transition-colors">{alt.name}</h4>
                            <p className="text-[10px] text-slate-400">{alt.country}</p>
                          </div>
                          <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-[10px] font-bold">Risk: {alt.risk}</span>
                        </div>
                        <div className="flex justify-between items-end mt-3">
                          <div className="flex gap-4 text-xs">
                            <div>
                              <span className="text-slate-500 block text-[9px]">Lead Time</span>
                              <span className="text-slate-300">{alt.leadTime}d</span>
                            </div>
                            <div>
                              <span className="text-slate-500 block text-[9px]">Cost</span>
                              <span className={alt.costDiff.startsWith('+') ? 'text-red-400' : 'text-emerald-400'}>{alt.costDiff}</span>
                            </div>
                          </div>
                          <button className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded transition-all flex items-center gap-1 opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0 duration-200">
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
