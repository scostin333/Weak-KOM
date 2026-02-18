import { NextRequest, NextResponse } from 'next/server';
import { buildPRLibrary } from '@/lib/prediction';

const BASE = 'https://www.strava.com/api/v3';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const accessToken = searchParams.get('access_token');

  if (!accessToken) {
    return NextResponse.json({ error: 'No access token' }, { status: 401 });
  }

  try {
    // Fetch starred segments
    const starredRes = await fetch(`${BASE}/segments/starred?per_page=50`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!starredRes.ok) {
      throw new Error(`Strava API error: ${starredRes.status}`);
    }

    const starredSegments: any[] = await starredRes.json();

    // For each starred segment, fetch the athlete's best effort
    const effortPromises = starredSegments.map(async (seg: any) => {
      const effortRes = await fetch(
        `${BASE}/segment_efforts?segment_id=${seg.id}&per_page=1`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!effortRes.ok) return null;
      const efforts: any[] = await effortRes.json();
      if (!efforts.length) return null;
      // Merge segment data into the effort object
      return { ...efforts[0], segment: seg };
    });

    const rawEfforts = (await Promise.all(effortPromises)).filter(Boolean);
    const prs = buildPRLibrary(rawEfforts as any[]);

    return NextResponse.json({ prs, count: prs.length });
  } catch (e: any) {
    console.error('[/api/athlete/prs]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
