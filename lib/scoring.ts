import { StravaSegment, ScoredSegment, WindData, AthletePREffort, WeaknessBreakdown } from '@/types';
import { calcBearing, calcTailwind, SegmentWindResult } from './wind';
import { predictSegmentTime, gradeSpeedMultiplier } from './prediction';

// ─────────────────────────────────────────────────────────────────────────────
// Domain constants
// ─────────────────────────────────────────────────────────────────────────────

// Reference: max expected flat speed at 1 km effort for a strong club cyclist.
// Riegel exponent models how max sustainable speed drops with distance.
const PACE_REF_SPEED_KMH = 56;
const PACE_RIEGEL_EXP    = 0.07;
const PACE_WEIGHT        = 0.50;

const EFFORT_CAP    = 5_000;
const EFFORT_WEIGHT = 0.20;

const AGE_WEIGHT        = 0.30;

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation helper
// ─────────────────────────────────────────────────────────────────────────────

function normInvert(value: number, lo: number, hi: number): number {
  if (hi === lo) return 0;
  return Math.min(1, Math.max(0, (hi - value) / (hi - lo)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual factor scorers
// ─────────────────────────────────────────────────────────────────────────────

function paceFactorCorrected(seg: StravaSegment): number {
  const d = Math.max(seg.distance, 100);

  // Convert KOM pace to grade-adjusted flat-equivalent speed (km/h).
  const rawKmh = (d / Math.max(seg.kom_time, 1)) * 3.6;
  const gapKmh = rawKmh / gradeSpeedMultiplier(seg.average_grade);

  // Riegel model: max expected speed at this distance on flat.
  const maxKmh = PACE_REF_SPEED_KMH * Math.pow(1000 / d, PACE_RIEGEL_EXP);

  // Score = how far below the max expected the KOM is.
  // Near 0 → KOM matches expected max (hard to beat). Near 1 → well below max (easy).
  return Math.min(1, Math.max(0, 1 - gapKmh / maxKmh));
}

function effortFactor(seg: StravaSegment): number {
  return normInvert(seg.effort_count, 0, EFFORT_CAP);
}

function ageFactor(_seg: StravaSegment): number {
  // Strava's leaderboard API restricts KOM-date data to Summit subscribers,
  // so we can't reliably compute an age factor. Return 0.5 (neutral).
  return 0.5;
}

// ─────────────────────────────────────────────────────────────────────────────
// Combined weakness score
// ─────────────────────────────────────────────────────────────────────────────

function komWeaknessScore(seg: StravaSegment): WeaknessBreakdown {
  const pF = paceFactorCorrected(seg);
  const eF = effortFactor(seg);
  const aF = ageFactor(seg);

  const weighted =
    pF * PACE_WEIGHT +
    eF * EFFORT_WEIGHT +
    aF * AGE_WEIGHT;

  const total = Math.round(Math.min(1, weighted) * 100);

  return {
    total,
    pace:    Math.round(pF * 100),
    efforts: Math.round(eF * 100),
    age:     Math.round(aF * 100),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Colour mapping
// ─────────────────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 75) return '#22c55e';
  if (score >= 55) return '#84cc16';
  if (score >= 40) return '#eab308';
  if (score >= 25) return '#f97316';
  return '#ef4444';
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

export function scoreSegments(
  segments: (StravaSegment & { _wind?: SegmentWindResult | null })[],
  wind: WindData,
  prLibrary: AthletePREffort[] = [],
): ScoredSegment[] {
  return segments.map((seg) => {
    const windResult = seg._wind ?? null;

    const dlat = (seg.end_latlng[0] - seg.start_latlng[0]) * 111000;
    const dlng = (seg.end_latlng[1] - seg.start_latlng[1]) * 111000 *
      Math.cos(((seg.start_latlng[0] + seg.end_latlng[0]) / 2) * (Math.PI / 180));
    const isLooped = Math.sqrt(dlat * dlat + dlng * dlng) < 200;

    // For looped segments derive bearing from the first few polyline points so
    // the arrow icon shows the actual travel direction instead of defaulting to 0°.
    const loopedBearing = (() => {
      const poly = seg.polyline;
      if (poly && poly.length >= 2) {
        const look = Math.min(4, poly.length - 1);
        return calcBearing(poly[0][0], poly[0][1], poly[look][0], poly[look][1]);
      }
      return 0;
    })();

    const bearing = isLooped
      ? loopedBearing
      : (windResult?.bearing ?? calcBearing(
          seg.start_latlng[0], seg.start_latlng[1],
          seg.end_latlng[0],   seg.end_latlng[1],
        ));

    const tailwindComponent = isLooped
      ? 0
      : windResult
        ? windResult.tailwindKmh
        : calcTailwind(bearing, wind.winddirection, wind.windspeed);

    const breakdown = komWeaknessScore(seg);
    const windBonus = Math.round((tailwindComponent / 40) * 30);
    const opportunityScore = Math.min(100, Math.max(0, breakdown.total + windBonus));

    const prediction = prLibrary.length > 0
      ? predictSegmentTime(seg, prLibrary) ?? undefined
      : undefined;

    const { _wind, ...rest } = seg as any;

    const userBestTime  = rest.userBestTime;
    const userTimeDelta = userBestTime != null && seg.kom_time > 0
      ? userBestTime - seg.kom_time
      : undefined;

    return {
      ...rest,
      bearing,
      isLooped,
      tailwindComponent:  Math.round(tailwindComponent * 10) / 10,
      komWeaknessScore:   breakdown.total,
      komWeaknessDetail:  breakdown,
      opportunityScore,
      color: scoreColor(opportunityScore),
      prediction,
      ...(userBestTime  !== undefined ? { userBestTime  } : {}),
      ...(userTimeDelta !== undefined ? { userTimeDelta } : {}),
    };
  });
}
