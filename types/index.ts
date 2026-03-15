export interface BBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface StravaSegment {
  id: number;
  name: string;
  distance: number;          // metres
  average_grade: number;     // %
  elevation_high: number;
  elevation_low: number;
  start_latlng: [number, number];
  end_latlng: [number, number];
  effort_count: number;
  athlete_count: number;
  kom_time: number;          // seconds
  starred: boolean;
  created_at?: string;
  polyline?: [number, number][];  // decoded GPS path (lat/lng pairs)
  surface?: string;               // e.g. "Paved", "Unpaved", "Gravel"
  private?: boolean;              // true = private segment, not publicly visible
}

export interface WindData {
  windspeed: number;         // km/h
  winddirection: number;     // degrees met convention, 0 = N
}

export interface WeaknessBreakdown {
  total:   number;           // 0–100 combined
  pace:    number;           // 0–100 pace sub-score
  efforts: number;           // 0–100 effort-count sub-score
  age:     number;           // 0–100 KOM-standing-age sub-score
}

// ── Athlete PR modelling ──────────────────────────────────────────────────────

/** One of the athlete's recent starred / PR segment efforts used as a datum. */
export interface AthletePREffort {
  segmentId:    number;
  segmentName:  string;
  distance:     number;      // metres
  grade:        number;      // average_grade %
  elapsedTime:  number;      // seconds (athlete's PR / best effort)
  pace:         number;      // m/s derived: distance / elapsedTime
}

/**
 * Predicted performance on a target segment, derived by interpolating
 * across the athlete's PR efforts on segments with similar grade and distance.
 */
export interface PredictionResult {
  /** Predicted time in seconds. */
  predictedTime: number;
  /**
   * Confidence 0–100.
   * Driven by how many similar PRs were found and how close they are in the
   * grade/distance feature space.
   */
  confidence: number;
  /** Gap to KOM in seconds (+ve = slower than KOM). */
  gapToKom: number;
  /** Number of reference PR efforts that contributed to this prediction. */
  referenceCount: number;
  /** Similarity-weighted average distance from target in feature space [0,1]. */
  avgFeatureDistance: number;
}

export interface ScoredSegment extends StravaSegment {
  bearing: number;
  isLooped: boolean;               // true if start/finish are within 200 m
  tailwindComponent: number;       // +ve = tailwind, -ve = headwind km/h
  komWeaknessScore: number;        // 0–100 combined weakness
  komWeaknessDetail: WeaknessBreakdown;
  opportunityScore: number;        // weakness + wind bonus, 0–100
  color: string;
  userBestTime?: number;           // seconds – athlete's existing PR if any
  userTimeDelta?: number;          // seconds behind KOM (existing PR)
  prediction?: PredictionResult;   // model-based prediction (post-login)
}
