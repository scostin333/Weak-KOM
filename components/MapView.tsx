'use client';
/**
 * MapView — Leaflet map with a Draw control restricted to rectangles.
 *
 * Leaflet and leaflet-draw are loaded as plain <script>/<link> tags injected
 * into <head> once, then accessed via window.L. This sidesteps the ESM /
 * SSR quirks that make `import('leaflet-draw')` unreliable in Next.js.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { ScoredSegment, BBox } from '@/types';
import { calcBearing } from '@/lib/wind';

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

const MILE_M = 1609.34;

function haversineDist(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/**
 * Returns one { latlng, bearing } entry per mile along the segment polyline.
 * Segments shorter than one mile get a single arrow at the midpoint.
 */
function getMileArrowPositions(seg: ScoredSegment): { latlng: [number, number]; bearing: number }[] {
  const path: [number, number][] = (seg.polyline && seg.polyline.length > 1)
    ? seg.polyline
    : [seg.start_latlng, seg.end_latlng];

  // Accumulate total distance to decide how many arrows to place.
  let totalDist = 0;
  for (let i = 1; i < path.length; i++) totalDist += haversineDist(path[i - 1], path[i]);

  // Shorter than one mile → single arrow at polyline midpoint.
  if (totalDist < MILE_M) {
    const midIdx = Math.floor(path.length / 2);
    const lookIdx = Math.min(midIdx + 4, path.length - 1);
    return [{ latlng: path[midIdx], bearing: calcBearing(path[midIdx][0], path[midIdx][1], path[lookIdx][0], path[lookIdx][1]) }];
  }

  // Walk the polyline, dropping an arrow at every mile mark.
  const results: { latlng: [number, number]; bearing: number }[] = [];
  let accumulated = 0;
  let nextMile = MILE_M;

  for (let i = 1; i < path.length; i++) {
    const segDist = haversineDist(path[i - 1], path[i]);
    while (accumulated + segDist >= nextMile) {
      const t = (nextMile - accumulated) / segDist;
      const latlng: [number, number] = [
        path[i - 1][0] + t * (path[i][0] - path[i - 1][0]),
        path[i - 1][1] + t * (path[i][1] - path[i - 1][1]),
      ];
      results.push({ latlng, bearing: calcBearing(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]) });
      nextMile += MILE_M;
    }
    accumulated += segDist;
  }
  return results;
}

interface Props {
  segments: ScoredSegment[];
  selected: number | null;
  onSelect: (id: number) => void;
  onBBoxDrawn: (bbox: BBox) => void;
  loading?: boolean;
  crLabel?: string;
  speedUnit?: 'mph' | 'kph';
}

const LEAFLET_VERSION = '1.9.4';
const DRAW_VERSION    = '1.0.4';


function createArrowIcon(L: any, bearing: number, color: string) {
  return L.divIcon({
    className: '',
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" style="transform:rotate(${bearing}deg);display:block;filter:drop-shadow(0 0 1px rgba(0,0,0,0.5))"><polygon points="8,1 14,15 8,11 2,15" fill="${color}"/></svg>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function createStartDotIcon(L: any) {
  return L.divIcon({
    className: '',
    html: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" style="display:block;filter:drop-shadow(0 0 2px rgba(0,0,0,0.6))"><circle cx="7" cy="7" r="5" fill="#22c55e" stroke="#fff" stroke-width="2"/></svg>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function ensureAssets(): Promise<void> {
  if (typeof window !== 'undefined' && (window as any).L?.Draw) {
    return Promise.resolve();
  }

  const injectLink = (id: string, href: string) => {
    if (document.getElementById(id)) return;
    const el = document.createElement('link');
    el.id = id; el.rel = 'stylesheet'; el.href = href;
    document.head.appendChild(el);
  };

  const injectScript = (id: string, src: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (document.getElementById(id)) { resolve(); return; }
      const el = document.createElement('script');
      el.id = id; el.src = src; el.async = false;
      el.onload  = () => resolve();
      el.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(el);
    });

  injectLink('leaflet-css',      `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`);
  injectLink('leaflet-draw-css', `https://unpkg.com/leaflet-draw@${DRAW_VERSION}/dist/leaflet.draw.css`);

  return injectScript('leaflet-js', `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`)
    .then(() => injectScript(
      'leaflet-draw-js',
      `https://unpkg.com/leaflet-draw@${DRAW_VERSION}/dist/leaflet.draw.js`,
    ));
}

export default function MapView({
  segments,
  selected,
  onSelect,
  onBBoxDrawn,
  loading = false,
  crLabel = 'KOM',
  speedUnit = 'mph',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const onBBoxDrawnRef = useRef(onBBoxDrawn);
  const onSelectRef    = useRef(onSelect);
  useEffect(() => { onBBoxDrawnRef.current = onBBoxDrawn; }, [onBBoxDrawn]);
  useEffect(() => { onSelectRef.current    = onSelect;    }, [onSelect]);

  const mapRef      = useRef<any>(null);
  const drawLayer   = useRef<any>(null);
  const segLayer    = useRef<any>(null);
  const segLines    = useRef<Map<number, any>>(new Map());
  const arrowMarkers = useRef<Map<number, any[]>>(new Map());
  const startDots   = useRef<Map<number, any>>(new Map());

  const [hint, setHint] = useState<'draw' | 'loading' | 'done'>('draw');

  // ── Location search ──────────────────────────────────────────────────────
  const [searchQuery,   setSearchQuery  ] = useState('');
  const [suggestions,   setSuggestions  ] = useState<NominatimResult[]>([]);
  const [searchBusy,    setSearchBusy   ] = useState(false);
  const [dropdownOpen,  setDropdownOpen ] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchInput = useCallback((value: string) => {
    setSearchQuery(value);
    setDropdownOpen(true);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (value.trim().length < 2) { setSuggestions([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearchBusy(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(value)}&limit=5`,
          { headers: { 'Accept-Language': 'en' } },
        );
        const data: NominatimResult[] = await res.json();
        setSuggestions(data);
      } catch { /* ignore */ } finally {
        setSearchBusy(false);
      }
    }, 320);
  }, []);

  const handleSelectSuggestion = useCallback((s: NominatimResult) => {
    setSearchQuery(s.display_name);
    setSuggestions([]);
    setDropdownOpen(false);
    if (mapRef.current) {
      mapRef.current.flyTo([parseFloat(s.lat), parseFloat(s.lon)], 13, { duration: 1.2 });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    ensureAssets().then(() => {
      if (cancelled || mapRef.current || !containerRef.current) return;

      const L: any = (window as any).L;

      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/images/marker-icon-2x.png`,
        iconUrl:        `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/images/marker-icon.png`,
        shadowUrl:      `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/images/marker-shadow.png`,
      });

      const map = L.map(containerRef.current, {
        zoomControl: true,
        preferCanvas: true,
      }).setView([42.0884, -87.9806], 13);

      // Fly to user's current location if available
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          pos => { if (!cancelled) map.setView([pos.coords.latitude, pos.coords.longitude], 13); },
          () => { /* keep default */ },
          { timeout: 6000 },
        );
      }

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      const drawnItems = new L.FeatureGroup().addTo(map);
      drawLayer.current = drawnItems;

      const drawControl = new L.Control.Draw({
        position: 'topleft',
        draw: {
          rectangle: {
            shapeOptions: {
              color:     '#f97316',
              fillColor: '#f97316',
              fillOpacity: 0.08,
              weight: 2,
              dashArray: '6 4',
            },
            showArea: false,
            metric: true,
          },
          polyline:     false,
          polygon:      false,
          circle:       false,
          marker:       false,
          circlemarker: false,
        },
        edit: {
          featureGroup: drawnItems,
          edit:   false,
          remove: false,
        },
      });
      map.addControl(drawControl);

      map.on(L.Draw.Event.DRAWSTART, () => {
        setHint('draw');
      });

      map.on(L.Draw.Event.CREATED, (e: any) => {
        drawnItems.clearLayers();
        const layer = e.layer;
        drawnItems.addLayer(layer);

        const b = layer.getBounds();
        const bbox: BBox = {
          minLat: b.getSouth(),
          minLng: b.getWest(),
          maxLat: b.getNorth(),
          maxLng: b.getEast(),
        };

        setHint('loading');
        onBBoxDrawnRef.current(bbox);
      });

      segLayer.current = new L.FeatureGroup().addTo(map);
      mapRef.current = map;
    }).catch(err => {
      console.error('[MapView] asset load failed:', err);
    });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        drawLayer.current = null;
        segLayer.current  = null;
        segLines.current.clear();
        arrowMarkers.current.clear();
        startDots.current.clear();
      }
    };
  }, []);

  useEffect(() => {
    if (!loading && hint === 'loading') setHint('done');
  }, [loading, hint]);

  useEffect(() => {
    if (!mapRef.current || !segLayer.current) return;
    const L: any = (window as any).L;
    if (!L) return;

    const layer    = segLayer.current;
    const existing = segLines.current;

    const incoming = new Map(segments.map(s => [s.id, s]));

    for (const [id, line] of Array.from(existing)) {
      if (!incoming.has(id)) {
        layer.removeLayer(line);
        existing.delete(id);
        const arrows = arrowMarkers.current.get(id);
        if (arrows) { arrows.forEach(a => layer.removeLayer(a)); arrowMarkers.current.delete(id); }
        const dot = startDots.current.get(id);
        if (dot) { layer.removeLayer(dot); startDots.current.delete(id); }
      }
    }

    for (const seg of segments) {
      const isSelected = selected === seg.id;
      const color      = isSelected ? '#a855f7' : seg.color;
      const weight     = isSelected ? 7 : 4;
      const opacity    = isSelected ? 1 : 0.85;

      const komFmt = seg.kom_time > 0
        ? `${Math.floor(seg.kom_time / 60)}:${String(seg.kom_time % 60).padStart(2, '0')}`
        : '—';
      const komSpeedVal = seg.kom_time > 0 && seg.distance > 0
        ? speedUnit === 'mph'
          ? `${((seg.distance / MILE_M) / (seg.kom_time / 3600)).toFixed(1)} mph`
          : `${((seg.distance / seg.kom_time) * 3.6).toFixed(1)} kph`
        : null;
      const windAbs    = Math.abs(seg.tailwindComponent);
      const windSpd    = speedUnit === 'mph'
        ? `${(windAbs * 0.6214).toFixed(1)} mph`
        : `${windAbs.toFixed(1)} kph`;
      const windDir    = seg.tailwindComponent > 2 ? '↑ tailwind' : seg.tailwindComponent < -2 ? '↓ headwind' : '→ cross';
      const tooltip =
        `<div style="font-family:sans-serif;font-size:12px;line-height:1.5">` +
        `<b>${seg.name}</b><br>` +
        `Score: <b style="color:${seg.color}">${seg.opportunityScore}/100</b><br>` +
        `${crLabel}: ${komFmt} · ${(seg.distance / 1000).toFixed(1)} km${komSpeedVal ? ` · ${komSpeedVal}` : ''}<br>` +
        `Wind: ${windDir} ${windSpd}` +
        (seg.surface ? `<br>Surface: ${seg.surface}` : '') +
        `</div>`;

      const gradeStr = `${seg.average_grade > 0 ? '+' : ''}${seg.average_grade.toFixed(1)}%`;
      const windStr  = `${windDir} ${windSpd}`;
      const popup =
        `<div style="font-family:sans-serif;font-size:12px;line-height:1.6;min-width:180px">` +
        `<b style="font-size:13px">${seg.name}</b><br>` +
        `<span style="color:${seg.color};font-weight:600">Score: ${seg.opportunityScore}/100</span>` +
        `<div style="margin:6px 0;padding:6px 8px;background:#f0fdf4;border-left:3px solid ${seg.color};border-radius:3px">` +
        (komSpeedVal
          ? `<span style="font-size:18px;font-weight:700;color:#111">${komSpeedVal}</span>` +
            `<span style="font-size:11px;color:#555"> avg speed</span>`
          : `<span style="font-size:12px;color:#888">Speed unavailable</span>`) +
        `</div>` +
        `${crLabel}: <b>${komFmt}</b> &nbsp;·&nbsp; ${(seg.distance / 1000).toFixed(1)} km<br>` +
        `Grade: ${gradeStr} &nbsp;·&nbsp; Wind: ${windStr}` +
        (seg.surface ? `<br>Surface: ${seg.surface}` : '') +
        `</div>`;

      if (existing.has(seg.id)) {
        const line = existing.get(seg.id)!;
        line.setStyle({ color, weight, opacity });
        line.setTooltipContent(tooltip);
        line.setPopupContent(popup);
        const arrows = arrowMarkers.current.get(seg.id);
        if (arrows) {
          arrows.forEach(a => a.setIcon(createArrowIcon(L, a._bearing, color)));
        }
      } else {
        const path = seg.polyline && seg.polyline.length > 1
          ? seg.polyline
          : [seg.start_latlng, seg.end_latlng];
        const line = L.polyline(
          path,
          { color, weight, opacity },
        );
        line.bindTooltip(tooltip, { sticky: true, direction: 'top' });
        line.bindPopup(popup, { maxWidth: 260 });
        line.on('click', () => onSelectRef.current(seg.id));
        layer.addLayer(line);
        existing.set(seg.id, line);
        const milePositions = getMileArrowPositions(seg);
        const arrows = milePositions.map(({ latlng, bearing }) => {
          const a = L.marker(latlng, {
            icon: createArrowIcon(L, bearing, color),
            interactive: false,
            zIndexOffset: 500,
          });
          a._bearing = bearing;
          layer.addLayer(a);
          return a;
        });
        arrowMarkers.current.set(seg.id, arrows);

        const dot = L.marker(seg.start_latlng, {
          icon: createStartDotIcon(L),
          interactive: false,
          zIndexOffset: 600,
        });
        layer.addLayer(dot);
        startDots.current.set(seg.id, dot);
      }
    }
  }, [segments, selected]);

  const hintContent = {
    draw:    'Click the rectangle tool to search',
    loading: '⏳  Fetching segments…',
    done:    `${segments.length} segments found`,
  }[hint];

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {/* ── Location search bar ── */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] w-72 sm:w-96">
        <div className="relative">
          <div className="flex items-center bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-gray-400 shrink-0 ml-3">
              <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={e => handleSearchInput(e.target.value)}
              onFocus={() => setDropdownOpen(true)}
              onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
              placeholder="Search location…"
              className="flex-1 px-2.5 py-2.5 text-sm text-gray-800 placeholder-gray-400 bg-transparent outline-none"
            />
            {searchBusy && (
              <div className="w-4 h-4 border-2 border-orange-400 border-t-transparent rounded-full animate-spin mr-3 shrink-0" />
            )}
            {searchQuery && !searchBusy && (
              <button
                onMouseDown={e => { e.preventDefault(); setSearchQuery(''); setSuggestions([]); }}
                className="text-gray-400 hover:text-gray-600 mr-3 shrink-0 text-lg leading-none"
              >
                ×
              </button>
            )}
          </div>

          {dropdownOpen && suggestions.length > 0 && (
            <ul className="absolute top-full mt-1 w-full bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden max-h-60 overflow-y-auto">
              {suggestions.map((s, i) => (
                <li key={i}>
                  <button
                    onMouseDown={e => { e.preventDefault(); handleSelectSuggestion(s); }}
                    className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-700 transition-colors border-b border-gray-100 last:border-0"
                  >
                    {s.display_name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div
        className={`
          absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000]
          px-4 py-2 rounded-full text-xs font-medium shadow-lg
          backdrop-blur-sm pointer-events-none select-none transition-all
          ${hint === 'loading'
            ? 'bg-orange-500/90 text-white'
            : 'bg-gray-900/80 text-gray-200'}
        `}
      >
        {hintContent}
      </div>
    </div>
  );
}
