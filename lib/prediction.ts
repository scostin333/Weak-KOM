/**
 * Athlete Performance Prediction
 * ───────────────────────────────
 * Estimates how long an athlete would take on a target segment by performing
 * similarity-weighted interpolation across their recent PR efforts on segments
 * with comparable grade and distance.
 */

import { AthletePREffort, PredictionResult, ScoredSegment } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// Hyperparameters
// ─────────────────────────────────────────────────────────────────────────────

const SIGMA = 0.25;
const RIGHT_TURN_PENALTY_SECS = 4;
/** Minimum deflection angle (degrees) for a turn to count as a right-hand turn. */
const RIGHT_TURN_MIN_DEG = 45;
const UTURN_PENALTY_SECS = 15;
/** Cumulative deflection (degrees) within the window to qualify as a U-turn. */
const UTURN_MIN_DEG = 150;
/** Maximum path distance (metres) over which cumulative angle is measured. */
const UTURN_WINDOW_M = 75;
const MIN_WEIGHT = 0.05;
const MIN_TOTAL_WEIGHT = 0.10;
const GRADE_MIN = -5;
const GRADE_MAX = 15;
const DIST_MIN = 200;
const DIST_MAX = 20_000;

// ─────────────────────────────────────────────────────────────────────────────
// Feature normalisation helpers
// ─────────────────────────────────────────────────────────────────────────────

function normDist(d: number): number {
  return Math.min(1, Math.max(0, (d - DIST_MIN) / (DIST_MAX - DIST_MIN)));
}

function normGrade(g: number): number {
  return Math.min(1, Math.max(0, (g - GRADE_MIN) / (GRADE_MAX - GRADE_MIN)));
}

function featureDist(
  d1: number, g1: number,
  d2: number, g2: number,
): number {
  return Math.sqrt(
    (normDist(d1) - normDist(d2)) ** 2 +
    (normGrade(g1) - normGrade(g2)) ** 2,
  );
}

function kernelWeight(fDist: number): number {
  return Math.exp(-(fDist ** 2) / (2 * SIGMA ** 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Grade-adjusted pace model
// ─────────────────────────────────────────────────────────────────────────────

export function gradeSpeedMultiplier(grade: number): number {
  const g = Math.min(20, Math.max(-5, grade)) / 100;
  return 1 / (1 + 17 * g + 55 * g * g);
}

function predictPaceForGrade(
  refPace:   number,
  refGrade:  number,
  targetGrade: number,
): number {
  const refMult    = gradeSpeedMultiplier(refGrade);
  const targetMult = gradeSpeedMultiplier(targetGrade);
  return refPace * (targetMult / refMult);
}

// ─────────────────────────────────────────────────────────────────────────────
// Confidence model
// ─────────────────────────────────────────────────────────────────────────────

function calcConfidence(
  weightedPaces: number[],
  weights:       number[],
  totalWeight:   number,
  refCount:      number,
): number {
  const coverageScore  = Math.min(40, refCount * 8);
  const proximityScore = Math.min(40, Math.round(totalWeight * 40));

  let consistencyScore = 20;
  if (weightedPaces.length > 1) {
    const wMean = weightedPaces.reduce((s, p, i) => s + p * weights[i], 0) / totalWeight;
    const wVar  = weightedPaces.reduce((s, p, i) => s + weights[i] * (p - wMean) ** 2, 0) / totalWeight;
    const cv    = wMean > 0 ? Math.sqrt(wVar) / wMean : 1;
    consistencyScore = Math.max(0, Math.round((1 - cv / 0.20) * 20));
  }

  return Math.min(100, coverageScore + proximityScore + consistencyScore);
}

// ─────────────────────────────────────────────────────────────────────────────
// Right-hand turn detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Counts the number of significant right-hand turns in a decoded GPS polyline.
 * Uses the signed cross-product of consecutive bearing vectors to determine
 * turn direction; only turns >= RIGHT_TURN_MIN_DEG are counted.
 *
 * Coordinate convention: lng = x (east +), lat = y (north +), which matches
 * a standard right-handed Cartesian system so a clockwise (right) turn
 * produces a negative cross-product.
 */
function countRightHandTurns(polyline: [number, number][]): number {
  if (polyline.length < 3) return 0;
  const minRad = (RIGHT_TURN_MIN_DEG * Math.PI) / 180;
  let count = 0;

  for (let i = 1; i < polyline.length - 1; i++) {
    const [lat0, lng0] = polyline[i - 1];
    const [lat1, lng1] = polyline[i];
    const [lat2, lng2] = polyline[i + 1];

    const dx1 = lng1 - lng0, dy1 = lat1 - lat0;
    const dx2 = lng2 - lng1, dy2 = lat2 - lat1;

    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    if (len1 < 1e-9 || len2 < 1e-9) continue;

    // cross < 0 → clockwise → right turn
    const cross = dx1 * dy2 - dy1 * dx2;
    const dot   = dx1 * dx2 + dy1 * dy2;
    const angle = Math.atan2(Math.abs(cross), dot);

    if (cross < 0 && angle >= minRad) count++;
  }

  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// U-turn detection
// ─────────────────────────────────────────────────────────────────────────────

/** Flat-earth distance in metres between two [lat, lng] points. */
function approxDistM(p1: [number, number], p2: [number, number]): number {
  const dlat = (p2[0] - p1[0]) * 111000;
  const dlng = (p2[1] - p1[1]) * 111000 *
    Math.cos(((p1[0] + p2[0]) / 2) * (Math.PI / 180));
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

/** Absolute deflection angle in degrees at point p1 (regardless of direction). */
function absTurnDeg(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
): number {
  const dx1 = p1[1] - p0[1], dy1 = p1[0] - p0[0];
  const dx2 = p2[1] - p1[1], dy2 = p2[0] - p1[0];
  const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
  const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
  if (len1 < 1e-9 || len2 < 1e-9) return 0;
  const cross = Math.abs(dx1 * dy2 - dy1 * dx2);
  const dot   = dx1 * dx2 + dy1 * dy2;
  return Math.atan2(cross, dot) * (180 / Math.PI);
}

/**
 * Counts the number of U-turns in a polyline.
 * A U-turn is defined as a cumulative heading change >= UTURN_MIN_DEG
 * (either direction) occurring within UTURN_WINDOW_M metres of path.
 * Once a U-turn is detected, the scan resumes after its end point to
 * avoid double-counting.
 */
function countUTurns(polyline: [number, number][]): number {
  if (polyline.length < 3) return 0;
  let count = 0;
  let i = 0;

  while (i < polyline.length - 1) {
    let pathDist   = 0;
    let cumulAngle = 0;
    let uTurnEnd   = -1;

    for (let j = i + 1; j < polyline.length; j++) {
      pathDist += approxDistM(polyline[j - 1], polyline[j]);
      if (pathDist > UTURN_WINDOW_M) break;

      if (j < polyline.length - 1) {
        cumulAngle += absTurnDeg(polyline[j - 1], polyline[j], polyline[j + 1]);
      }

      if (cumulAngle >= UTURN_MIN_DEG) {
        uTurnEnd = j;
        break;
      }
    }

    if (uTurnEnd >= 0) {
      count++;
      i = uTurnEnd + 1; // skip past this U-turn
    } else {
      i++;
    }
  }

  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Predict how long an athlete would take on `target`, given a pool of their
 * recent PR efforts on other segments.
 *
 * Returns `null` if there are insufficient similar reference PRs.
 */
export function predictSegmentTime(
  target:     Pick<ScoredSegment, 'distance' | 'average_grade' | 'kom_time' | 'polyline'>,
  references: AthletePREffort[],
): PredictionResult | null {
  if (!references.length) return null;

  const activePaces:    number[] = [];
  const activeWeights:  number[] = [];
  const activeFeatureDists: number[] = [];

  for (const ref of references) {
    const fd = featureDist(
      ref.distance, ref.grade,
      target.distance, target.average_grade,
    );
    const w = kernelWeight(fd);
    if (w < MIN_WEIGHT) continue;

    const adjustedPace = predictPaceForGrade(ref.pace, ref.grade, target.average_grade);

    activePaces.push(adjustedPace);
    activeWeights.push(w);
    activeFeatureDists.push(fd);
  }

  const totalWeight = activeWeights.reduce((s, w) => s + w, 0);
  if (totalWeight < MIN_TOTAL_WEIGHT) return null;

  const predictedPace = activePaces.reduce((s, p, i) => s + p * activeWeights[i], 0) / totalWeight;
  const rightTurns    = target.polyline ? countRightHandTurns(target.polyline) : 0;
  const uTurns        = target.polyline ? countUTurns(target.polyline) : 0;
  const predictedTime = Math.round(
    target.distance / predictedPace +
    rightTurns * RIGHT_TURN_PENALTY_SECS +
    uTurns     * UTURN_PENALTY_SECS,
  );
  const gapToKom      = predictedTime - target.kom_time;

  const confidence = calcConfidence(activePaces, activeWeights, totalWeight, activePaces.length);

  const avgFeatureDistance =
    activeFeatureDists.reduce((s, d, i) => s + d * activeWeights[i], 0) / totalWeight;

  return {
    predictedTime,
    confidence,
    gapToKom,
    referenceCount: activePaces.length,
    avgFeatureDistance: Math.round(avgFeatureDistance * 1000) / 1000,
  };
}

/**
 * Builds an `AthletePREffort` array from raw Strava segment efforts.
 * Only efforts from the last 12 months are included.
 */
export function buildPRLibrary(rawEfforts: any[]): AthletePREffort[] {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);

  return rawEfforts
    .filter(e =>
      typeof e.elapsed_time === 'number' &&
      typeof e.distance     === 'number' &&
      e.distance > 0 &&
      e.segment?.average_grade !== undefined &&
      e.start_date && new Date(e.start_date) >= cutoff
    )
    .map(e => ({
      segmentId:   e.segment?.id   ?? e.id,
      segmentName: e.segment?.name ?? e.name ?? 'Unknown',
      distance:    e.distance,
      grade:       e.segment.average_grade,
      elapsedTime: e.elapsed_time,
      pace:        e.distance / e.elapsed_time,
    }));
}
