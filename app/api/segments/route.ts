import { NextRequest, NextResponse } from 'next/server';
import { fetchSegmentsInBBox } from '@/lib/strava';
import { fetchWind, getSegmentTailwind } from '@/lib/wind';
import { scoreSegments } from '@/lib/scoring';
import { BBox } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const {
      bbox,
      accessToken,
      prLibrary = [],
    }: { bbox: BBox; accessToken: string; prLibrary?: any[] } = await req.json();

    if (!accessToken) {
      return NextResponse.json({ error: 'No access token' }, { status: 401 });
    }

    const segments = await fetchSegmentsInBBox(bbox, accessToken);
    if (!segments.length) {
      return NextResponse.json({ segments: [] });
    }

    const windResults = await Promise.all(
      segments.map(seg =>
        getSegmentTailwind(seg.start_latlng, seg.end_latlng).catch(() => null)
      )
    );

    const anySucceeded = windResults.some(r => r !== null);
    const fallbackWind = anySucceeded
      ? null
      : await fetchWind(
          (bbox.minLat + bbox.maxLat) / 2,
          (bbox.minLng + bbox.maxLng) / 2,
        ).catch(() => ({ windspeed: 0, winddirection: 0 }));

    const segmentsWithWind = segments.map((seg, i) => ({
      ...seg,
      _wind: windResults[i] ?? (fallbackWind
        ? { bearing: 0, wind: fallbackWind, tailwindKmh: 0, label: 'crosswind' as const }
        : null),
    }));

    const displayWind =
      windResults.find(r => r !== null)?.wind ??
      fallbackWind ??
      { windspeed: 0, winddirection: 0 };

    const scored = scoreSegments(segmentsWithWind, displayWind, prLibrary);
    scored.sort((a, b) => b.opportunityScore - a.opportunityScore);

    return NextResponse.json({ segments: scored, wind: displayWind });
  } catch (e: any) {
    console.error('[/api/segments]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
