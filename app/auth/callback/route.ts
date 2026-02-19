import { NextRequest, NextResponse } from 'next/server';
import { getStravaToken } from '@/lib/strava';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  if (!code) {
    return NextResponse.redirect(new URL('/?error=no_code', req.url));
  }
  try {
    const token = await getStravaToken(code);
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? `https://${req.headers.get('host')}`;
    const url = new URL('/', base);
    url.searchParams.set('access_token', token.access_token);
    url.searchParams.set('refresh_token', token.refresh_token);
    url.searchParams.set('athlete', JSON.stringify(token.athlete));
    return NextResponse.redirect(url);
  } catch (e) {
    return NextResponse.redirect(new URL('/?error=auth_failed', req.url));
  }
}
