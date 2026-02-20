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

function lerpColor(a: string, b: string, t: number): string {
  const hr = (n: number) => n.toString(16).padStart(2, '0');
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 0xff, ag = (pa >> 8) & 0xff, ab = pa & 0xff;
  const br = (pb >> 16) & 0xff, bg = (pb >> 8) & 0xff, bb = pb & 0xff;
  return `#${hr(Math.round(ar + (br - ar) * t))}${hr(Math.round(ag + (bg - ag) * t))}${hr(Math.round(ab + (bb - ab) * t))}`;
}

function buildGradientLines(L: any, path: any[], baseColor: string, weight: number, opacity: number): any[] {
  const n = path.length;
  if (n < 2) return [];
  const STEPS = Math.min(30, n - 1);
  const light = lerpColor('#ffffff', baseColor, 0.3);
  const dark  = lerpColor(baseColor, '#111111', 0.5);
  const lines: any[] = [];
  for (let i = 0; i < STEPS; i++) {
    const t = STEPS === 1 ? 0.5 : i / (STEPS - 1);
    const color = lerpColor(light, dark, t);
    const startIdx = Math.round(i * (n - 1) / STEPS);
    const endIdx   = Math.round((i + 1) * (n - 1) / STEPS);
    const chunk = path.slice(startIdx, endIdx + 1);
    if (chunk.length >= 2) {
      lines.push(L.polyline(chunk, { color, weight, opacity, interactive: false }));
    }
  }
  return lines;
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

  const mapRef        = useRef<any>(null);
  const drawLayer     = useRef<any>(null);
  const segLayer      = useRef<any>(null);
  const segLines      = useRef<Map<number, any>>(new Map());     // hitbox polyline per segment
  const segGradients  = useRef<Map<number, any[]>>(new Map());  // gradient mini-polylines per segment

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
        segGradients.current.clear();
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

    for (const [id, hitbox] of Array.from(existing)) {
      if (!incoming.has(id)) {
        layer.removeLayer(hitbox);
        existing.delete(id);
        for (const gl of segGradients.current.get(id) ?? []) layer.removeLayer(gl);
        segGradients.current.delete(id);
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

      const path = seg.polyline && seg.polyline.length > 1
        ? seg.polyline
        : [seg.start_latlng, seg.end_latlng];

      // Remove old gradient lines and rebuild (covers both new and updated segments)
      for (const gl of segGradients.current.get(seg.id) ?? []) layer.removeLayer(gl);
      const gLines = buildGradientLines(L, path, color, weight, opacity);
      for (const gl of gLines) layer.addLayer(gl);
      segGradients.current.set(seg.id, gLines);

      if (existing.has(seg.id)) {
        // Update the invisible hitbox tooltip/popup
        const hitbox = existing.get(seg.id)!;
        hitbox.setTooltipContent(tooltip);
        hitbox.setPopupContent(popup);
      } else {
        // Invisible wide polyline for hover/click interaction, drawn on top of gradient
        const svgRenderer = L.svg();
        const hitbox = L.polyline(path, {
          color: 'transparent', weight: 20, opacity: 0.001,
          renderer: svgRenderer,
        });
        hitbox.bindTooltip(tooltip, { sticky: true, direction: 'top' });
        hitbox.bindPopup(popup, { maxWidth: 260 });
        hitbox.on('click', () => onSelectRef.current(seg.id));
        layer.addLayer(hitbox);
        existing.set(seg.id, hitbox);
      }
    }
  }, [segments, selected]);

  const hintContent = {
    draw:    '✏️  Click the rectangle tool (top-left) and drag to define a search area',
    loading: '⏳  Fetching segments…',
    done:    `✅  ${segments.length} segment${segments.length !== 1 ? 's' : ''} found — draw a new box to refresh`,
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
