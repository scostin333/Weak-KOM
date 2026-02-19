import { StravaSegment, BBox } from '@/types';
import { decodePolyline } from './polyline';

const BASE = 'https://www.strava.com/api/v3';

export async function getStravaToken(code: string) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error('Token exchange failed');
  return res.json();
}

export async function refreshStravaToken(refreshToken: string) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error('Token refresh failed');
  return res.json();
}

/** Parse "M:SS" or "H:MM:SS" KOM time strings from Strava's xoms field. */
function parseKomTime(t: string | undefined): number {
  if (!t) return 0;
  const parts = t.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

/**
 * Fetch full segment details for a single ID.
 * The /segments/{id} response has average_grade, effort_count, athlete_count,
 * created_at, and xoms.overall (the KOM time as a formatted string).
 * Results are cached server-side for 1 hour.
 */
export async function fetchSegmentDetail(
  segmentId: number,
  accessToken: string,
): Promise<Partial<StravaSegment>> {
  const res = await fetch(`${BASE}/segments/${segmentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    next: { revalidate: 3600 },
  });
  if (!res.ok) return {};
  const s = await res.json();
  const encodedPolyline: string | undefined = s.map?.polyline;
  const polyline = encodedPolyline && encodedPolyline.length > 0
    ? decodePolyline(encodedPolyline)
    : undefined;
  // Fetch the overall all-time leaderboard (top 1 entry) to get the KOM time
  // and when it was set. date_range=overall forces the global leaderboard rather
  // than the default "following" view, which may have no entries.
  let kom_date: string | undefined;
  let kom_name: string | undefined;
  let kom_time_lb: number | undefined;
  const lbRes = await fetch(
    `${BASE}/segments/${segmentId}/leaderboard?per_page=1&date_range=overall`,
    { headers: { Authorization: `Bearer ${accessToken}` }, next: { revalidate: 3600 } },
  );
  if (lbRes.ok) {
    const lb = await lbRes.json();
    const top = lb.entries?.[0];
    kom_date    = top?.start_date    ?? undefined;
    kom_name    = top?.athlete_name  ?? undefined;
    kom_time_lb = top?.elapsed_time != null ? Math.round(top.elapsed_time) : undefined;
  }

  // Priority: raw number from detail → xoms string → leaderboard elapsed_time
  const xomsTime = parseKomTime(s.xoms?.overall ?? s.xoms?.kom);
  const rawTime  = typeof s.kom_time === 'number' && s.kom_time > 0 ? s.kom_time : 0;

  return {
    average_grade: s.average_grade  ?? 0,
    elevation_high: s.elevation_high ?? 0,
    elevation_low:  s.elevation_low  ?? 0,
    effort_count:   s.effort_count   ?? 0,
    athlete_count:  s.athlete_count  ?? 0,
    kom_time:       rawTime || xomsTime || kom_time_lb || 0,
    kom_name,
    created_at:     s.created_at,
    kom_date,
    polyline,
  };
}

/** Normalise and fetch segments for a single bounding box tile. */
async function fetchTile(bbox: BBox, accessToken: string): Promise<StravaSegment[]> {
  const bounds = `${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng}`;
  const url = `${BASE}/segments/explore?bounds=${bounds}&activity_type=riding`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return [];
  const data = await res.json();
  // Explore returns ExplorerSegment objects — normalise to our StravaSegment shape.
  return (data.segments ?? []).map((s: any): StravaSegment => ({
    id:             s.id,
    name:           s.name,
    distance:       s.distance       ?? 0,
    average_grade:  s.avg_grade      ?? s.average_grade ?? 0,
    elevation_high: s.elevation_high ?? 0,
    elevation_low:  s.elevation_low  ?? 0,
    start_latlng:   s.start_latlng,
    end_latlng:     s.end_latlng,
    effort_count:   s.effort_count   ?? 0,
    athlete_count:  s.athlete_count  ?? 0,
    kom_time:       s.kom_time       ?? 0,
    starred:        s.starred        ?? false,
    created_at:     s.created_at,
  }));
}

/**
 * Query the bbox split into 4 quadrant tiles in parallel (Strava's explore
 * endpoint is hard-capped at 10 results per request), deduplicate by ID,
 * and return up to 20 unique segments.
 */
export async function fetchSegmentsInBBox(
  bbox: BBox,
  accessToken: string,
): Promise<StravaSegment[]> {
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  const midLng = (bbox.minLng + bbox.maxLng) / 2;
  const tiles: BBox[] = [
    { minLat: bbox.minLat, maxLat: midLat, minLng: bbox.minLng, maxLng: midLng },
    { minLat: bbox.minLat, maxLat: midLat, minLng: midLng,      maxLng: bbox.maxLng },
    { minLat: midLat,      maxLat: bbox.maxLat, minLng: bbox.minLng, maxLng: midLng },
    { minLat: midLat,      maxLat: bbox.maxLat, minLng: midLng,      maxLng: bbox.maxLng },
  ];

  const results = await Promise.all(tiles.map(t => fetchTile(t, accessToken)));

  // Deduplicate by segment ID, preserve first-seen order, cap at 20.
  const seen = new Set<number>();
  const unique: StravaSegment[] = [];
  for (const seg of results.flat()) {
    if (!seen.has(seg.id)) {
      seen.add(seg.id);
      unique.push(seg);
      if (unique.length === 20) break;
    }
  }
  return unique;
}

export async function fetchAthleteSegmentEffort(
  segmentId: number,
  accessToken: string
): Promise<number | null> {
  const url = `${BASE}/segment_efforts?segment_id=${segmentId}&per_page=1`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const efforts = await res.json();
  return efforts[0]?.elapsed_time ?? null;
}
