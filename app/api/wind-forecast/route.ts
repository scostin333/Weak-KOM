import { NextRequest, NextResponse } from 'next/server';
import { fetchWindForecast } from '@/lib/wind';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat      = parseFloat(searchParams.get('lat')      ?? '');
  const lng      = parseFloat(searchParams.get('lng')      ?? '');
  const datetime = searchParams.get('datetime') ?? '';

  if (isNaN(lat) || isNaN(lng) || !datetime) {
    return NextResponse.json({ error: 'Missing or invalid params' }, { status: 400 });
  }

  try {
    const wind = await fetchWindForecast(lat, lng, datetime);
    return NextResponse.json(wind);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
