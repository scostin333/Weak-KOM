import { StravaSegment, BBox } from '@/types';

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

export async function fetchSegmentsInBBox(
  bbox: BBox,
  accessToken: string
): Promise<StravaSegment[]> {
  const bounds = `${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng}`;
  const url = `${BASE}/segments/explore?bounds=${bounds}&activity_type=riding`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Strava API error: ${res.status}`);
  const data = await res.json();
  return data.segments ?? [];
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
