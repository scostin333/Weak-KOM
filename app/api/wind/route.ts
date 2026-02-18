import { NextRequest, NextResponse } from 'next/server';
import { fetchWind } from '@/lib/wind';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get('lat') ?? '0');
  const lng = parseFloat(searchParams.get('lng') ?? '0');
  try {
    const wind = await fetchWind(lat, lng);
    return NextResponse.json(wind);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
