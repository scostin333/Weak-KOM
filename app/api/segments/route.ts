import { NextRequest, NextResponse } from 'next/server';
import { fetchSegmentsInBBox, fetchSegmentDetail } from '@/lib/strava';
import { fetchWind, getSegmentTailwind } from '@/lib/wind';
import { scoreSegments } from '@/lib/scoring';
import { BBox } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const {
      bbox,
      accessToken,
      prLibrary = [],
      athleteSex,
    }: { bbox: BBox; accessToken: string; prLibrary?: any[]; athleteSex?: string } = await req.json();

    if (!accessToken) {
      return NextResponse.json({ error: 'No access token' }, { status: 401 });
    }

    const exploreSegments = await fetchSegmentsInBBox(bbox, accessToken);
    if (!exploreSegments.length) {
      return NextResponse.json({ segments: [] });
    }

    // Enrich explore results with full segment details (average_grade,
    // effort_count, kom_time, created_at) and wind — all in parallel.
    const [detailResults, windResults] = await Promise.all([
      Promise.all(
        exploreSegments.map(seg =>
          fetchSegmentDetail(seg.id, accessToken, athleteSex).catch(() => ({}))
        )
      ),
      Promise.all(
        exploreSegments.map(seg =>
          getSegmentTailwind(seg.start_latlng, seg.end_latlng).catch(() => null)
        )
      ),
    ]);

    // Merge explore + detail fields (detail wins on any overlap), then keep only paved/unknown.
    // Only label a segment "Paved" when Strava explicitly says so; anything else is "Unknown".
    const segments = exploreSegments
      .map((seg, i) => ({ ...seg, ...detailResults[i] }))
      .filter(seg => !seg.private)
      .filter(seg => !seg.surface || seg.surface.toLowerCase() === 'paved')
      .map(seg => ({
        ...seg,
        surface: seg.surface
          ? seg.surface.charAt(0).toUpperCase() + seg.surface.slice(1).toLowerCase()
          : 'Unknown',
      }));

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
    if (e.message === 'RATE_LIMIT') {
      return NextResponse.json(
        { error: 'Strava rate limit reached. Please wait a minute and try again.' },
        { status: 429 },
      );
    }
    if (e.message === 'UNAUTHORIZED') {
      return NextResponse.json(
        { error: 'Strava session expired. Please disconnect and reconnect your account.' },
        { status: 401 },
      );
    }
    console.error('[/api/segments]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
