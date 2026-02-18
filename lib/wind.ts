import { WindData } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SegmentWindResult {
  /** Bearing of the segment in degrees, 0 = N, 90 = E, clockwise. */
  bearing: number;
  /** Raw wind data at the midpoint from Open-Meteo. */
  wind: WindData;
  /**
   * Tailwind component in km/h along the segment's travel direction.
   *   > 0  → tailwind  (wind is pushing you forward)
   *   < 0  → headwind  (wind is pushing against you)
   *   ≈ 0  → crosswind (wind is perpendicular, no net benefit)
   */
  tailwindKmh: number;
  /** Human-readable label: "tailwind", "headwind", or "crosswind". */
  label: 'tailwind' | 'headwind' | 'crosswind';
}

// ─────────────────────────────────────────────────────────────────────────────
// 1.  Bearing calculation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates the initial bearing (forward azimuth) from one geographic
 * coordinate to another using the spherical law of cosines.
 *
 * @returns Bearing in degrees [0, 360), clockwise from true North.
 */
export function calcBearing(
  startLat: number,
  startLng: number,
  endLat:   number,
  endLng:   number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const φ1 = toRad(startLat);
  const φ2 = toRad(endLat);
  const Δλ = toRad(endLng - startLng);

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2.  Open-Meteo fetch
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches current wind speed and direction from Open-Meteo for a single
 * lat/lng point. Results are cached for 30 minutes by Next.js's fetch cache.
 */
export async function fetchWind(lat: number, lng: number): Promise<WindData> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude',        lat.toFixed(4));
  url.searchParams.set('longitude',       lng.toFixed(4));
  url.searchParams.set('current_weather', 'true');
  url.searchParams.set('windspeed_unit',  'kmh');

  const res = await fetch(url.toString(), {
    next: { revalidate: 1800 }, // 30-minute server-side cache
  });

  if (!res.ok) {
    throw new Error(
      `Open-Meteo error ${res.status} for (${lat.toFixed(4)}, ${lng.toFixed(4)})`
    );
  }

  const data = await res.json();
  const cw = data?.current_weather;

  if (typeof cw?.windspeed !== 'number' || typeof cw?.winddirection !== 'number') {
    throw new Error('Unexpected Open-Meteo response shape');
  }

  return {
    windspeed:     cw.windspeed,
    winddirection: cw.winddirection,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3.  Tailwind component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Projects the wind vector onto the segment's travel direction and returns
 * the scalar component in km/h.
 *
 * @param segmentBearing  Bearing of travel in degrees [0, 360).
 * @param windDirection   Meteorological wind direction in degrees (blowing FROM).
 * @param windSpeed       Wind speed in km/h.
 * @returns Signed tailwind component in km/h.
 */
export function calcTailwind(
  segmentBearing: number,
  windDirection:  number,
  windSpeed:      number,
): number {
  const windTo    = (windDirection + 180) % 360;
  const θDeg      = ((windTo - segmentBearing) + 360) % 360;
  const θRad      = (θDeg * Math.PI) / 180;
  return windSpeed * Math.cos(θRad);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4.  Combined entry-point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given a segment's start and end coordinates, calculates bearing, fetches
 * wind, and returns a fully annotated SegmentWindResult.
 */
export async function getSegmentTailwind(
  startLatlng: [number, number],
  endLatlng:   [number, number],
): Promise<SegmentWindResult> {
  const [startLat, startLng] = startLatlng;
  const [endLat,   endLng  ] = endLatlng;

  const bearing = calcBearing(startLat, startLng, endLat, endLng);

  const midLat = (startLat + endLat) / 2;
  const midLng = (startLng + endLng) / 2;

  const wind = await fetchWind(midLat, midLng);

  const raw = calcTailwind(bearing, wind.winddirection, wind.windspeed);
  const tailwindKmh = Math.round(raw * 10) / 10;

  const label: SegmentWindResult['label'] =
    tailwindKmh >  2 ? 'tailwind'  :
    tailwindKmh < -2 ? 'headwind'  :
                       'crosswind';

  return { bearing, wind, tailwindKmh, label };
}
