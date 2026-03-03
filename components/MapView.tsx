'use client';
/**
 * MapView — Leaflet map with a Draw control restricted to rectangles.
 *
 * Leaflet and leaflet-draw are loaded as plain <script>/<link> tags injected
 * into <head> once, then accessed via window.L. This sidesteps the ESM /
 * SSR quirks that make `import('leaflet-draw')` unreliable in Next.js.
 */

import { useEffect, useRef, useState } from 'react';
import { ScoredSegment, BBox } from '@/types';

/**
 * Compute three points forming a "V" arrowhead at path[0] pointing toward
 * path[look].  Returns [leftWing, tip, rightWing] in [lat,lng] form, or null
 * if the path is too short / has no measurable direction.
 *
 * SIZE is in decimal degrees.  0.002 ≈ 220 m ≈ 15 px at zoom 13, which is
 * clearly visible as a V at every typical viewing zoom.
 */
function makeArrowhead(path: any[]): [number, number][] | null {
  if (path.length < 2) return null;
  const look = Math.min(3, path.length - 1);
  const lat0 = path[0][0], lng0 = path[0][1];
  const lat1 = path[look][0], lng1 = path[look][1];
  const dlat = lat1 - lat0, dlng = lng1 - lng0;
  const len = Math.sqrt(dlat * dlat + dlng * dlng);
  if (len < 1e-10) return null;

  const fx = dlng / len, fy = dlat / len;   // forward unit vector (east, north)
  const SIZE = 0.005;                        // ~550 m — large test size
  const ca = Math.cos(Math.PI / 5), sa = Math.sin(Math.PI / 5); // 36°

  const w1: [number, number] = [
    lat0 - SIZE * (fx * sa + fy * ca),
    lng0 - SIZE * (fx * ca - fy * sa),
  ];
  const w2: [number, number] = [
    lat0 + SIZE * (fx * sa - fy * ca),
    lng0 - SIZE * (fx * ca + fy * sa),
  ];
  return [w1, [lat0, lng0], w2];
}

interface Props {
  segments: ScoredSegment[];
  selected: number | null;
  onSelect: (id: number) => void;
  onBBoxDrawn: (bbox: BBox) => void;
  loading?: boolean;
}

const LEAFLET_VERSION = '1.9.4';
const DRAW_VERSION    = '1.0.4';

function getArrowPosition(seg: ScoredSegment): [number, number] {
  const [lat1, lng1] = seg.start_latlng;
  const [lat2, lng2] = seg.end_latlng;
  const dlat = (lat2 - lat1) * 111000;
  const dlng = (lng2 - lng1) * 111000 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const endDist = Math.sqrt(dlat * dlat + dlng * dlng);
  if (endDist < 50) return seg.start_latlng; // circular — use start/finish point
  if (seg.polyline && seg.polyline.length > 1)
    return seg.polyline[Math.floor(seg.polyline.length / 2)];
  return [(lat1 + lat2) / 2, (lng1 + lng2) / 2];
}

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
  const arrowMarkers = useRef<Map<number, any>>(new Map());
  const startDots   = useRef<Map<number, any>>(new Map());

  const [hint, setHint] = useState<'draw' | 'loading' | 'done'>('draw');

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
        const arrow = arrowMarkers.current.get(id);
        if (arrow) { layer.removeLayer(arrow); arrowMarkers.current.delete(id); }
        const dot = startDots.current.get(id);
        if (dot) { layer.removeLayer(dot); startDots.current.delete(id); }
      }
    }

    for (const seg of segments) {
      const isSelected = selected === seg.id;
      const color      = isSelected ? '#a855f7' : seg.color;
      const weight     = isSelected ? 7 : 4;
      const opacity    = isSelected ? 1 : 0.85;

      const komFmt = (seg.kom_time != null && seg.kom_time !== 0 && seg.kom_time !== '')
        ? `${seg.kom_time}s (raw)`
        : '—';
      const speedMph = seg.kom_time > 0 && seg.distance > 0
        ? ((seg.distance / 1609.34) / (seg.kom_time / 3600)).toFixed(1)
        : null;
      const tooltip =
        `<div style="font-family:sans-serif;font-size:12px;line-height:1.5">` +
        `<b>${seg.name}</b><br>` +
        `Score: <b style="color:${seg.color}">${seg.opportunityScore}/100</b><br>` +
        `KOM: ${komFmt} · ${(seg.distance / 1000).toFixed(1)} km${speedMph ? ` · ${speedMph} mph` : ''}<br>` +
        `Wind: ${seg.tailwindComponent > 0 ? '↑ tailwind' : seg.tailwindComponent < 0 ? '↓ headwind' : '→ cross'} ` +
        `${Math.abs(seg.tailwindComponent).toFixed(1)} km/h` +
        `</div>`;

      const gradeStr = `${seg.average_grade > 0 ? '+' : ''}${seg.average_grade.toFixed(1)}%`;
      const windStr  = `${seg.tailwindComponent > 0 ? '↑ tailwind' : seg.tailwindComponent < 0 ? '↓ headwind' : '→ cross'} ${Math.abs(seg.tailwindComponent).toFixed(1)} km/h`;
      const popup =
        `<div style="font-family:sans-serif;font-size:12px;line-height:1.6;min-width:180px">` +
        `<b style="font-size:13px">${seg.name}</b><br>` +
        `<span style="color:${seg.color};font-weight:600">Score: ${seg.opportunityScore}/100</span>` +
        `<div style="margin:6px 0;padding:6px 8px;background:#f0fdf4;border-left:3px solid ${seg.color};border-radius:3px">` +
        (speedMph
          ? `<span style="font-size:18px;font-weight:700;color:#111">${speedMph}</span>` +
            `<span style="font-size:11px;color:#555"> mph avg speed</span>`
          : `<span style="font-size:12px;color:#888">Speed unavailable</span>`) +
        `</div>` +
        `KOM: <b>${komFmt}</b> &nbsp;·&nbsp; ${(seg.distance / 1000).toFixed(1)} km<br>` +
        `Grade: ${gradeStr} &nbsp;·&nbsp; Wind: ${windStr}` +
        `</div>`;

      if (existing.has(seg.id)) {
        const line = existing.get(seg.id)!;
        line.setStyle({ color, weight, opacity });
        line.setTooltipContent(tooltip);
        line.setPopupContent(popup);
        const arrow = arrowMarkers.current.get(seg.id);
        if (arrow) {
          arrow.setLatLng(getArrowPosition(seg));
          arrow.setIcon(createArrowIcon(L, seg.bearing, color));
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
        const arrow = L.marker(getArrowPosition(seg), {
          icon: createArrowIcon(L, seg.bearing, color),
          interactive: false,
          zIndexOffset: 500,
        });
        layer.addLayer(arrow);
        arrowMarkers.current.set(seg.id, arrow);

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
    draw:    '>>> CODE_V9 <<< Click the rectangle tool to search',
    loading: '⏳  Fetching segments…',
    done:    `>>> CODE_V9 <<< ${segments.length} segments found`,
  }[hint];

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

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
