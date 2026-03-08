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
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Predict how long an athlete would take on `target`, given a pool of their
 * recent PR efforts on other segments.
 *
 * Returns `null` if there are insufficient similar reference PRs.
 */
export function predictSegmentTime(
  target:     Pick<ScoredSegment, 'distance' | 'average_grade' | 'kom_time'>,
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
  const predictedTime = Math.round(target.distance / predictedPace);
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
