'use client';
import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import SegmentList from '@/components/SegmentList';
import LoginButton from '@/components/LoginButton';
import { ScoredSegment, BBox, AthletePREffort } from '@/types';

const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

interface Athlete {
  firstname: string;
  lastname: string;
  profile_medium: string;
}

type PRStatus = 'idle' | 'loading' | 'ready' | 'error';

export default function HomePage() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [athlete,     setAthlete    ] = useState<Athlete | null>(null);
  const [segments,    setSegments   ] = useState<ScoredSegment[]>([]);
  const [selected,    setSelected   ] = useState<number | null>(null);
  const [loading,     setLoading    ] = useState(false);
  const [error,       setError      ] = useState<string | null>(null);
  const [wind,        setWind       ] = useState<{ windspeed: number; winddirection: number } | null>(null);

  const [prLibrary,  setPrLibrary ] = useState<AthletePREffort[]>([]);
  const [prStatus,   setPrStatus  ] = useState<PRStatus>('idle');
  const [prCount,    setPrCount   ] = useState(0);

  // ── OAuth token ingestion from URL ───────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const at          = params.get('access_token');
    const athleteStr  = params.get('athlete');
    const err         = params.get('error');

    if (at) {
      setAccessToken(at);
      if (athleteStr) {
        try { setAthlete(JSON.parse(athleteStr)); } catch {}
      }
      window.history.replaceState({}, '', '/');
    }
    if (err) setError('Authentication failed. Please try again.');
  }, []);

  // ── Fetch PR library whenever we get a token ─────────────────────────────
  useEffect(() => {
    if (!accessToken) return;

    setPrStatus('loading');
    setPrLibrary([]);
    setPrCount(0);

    fetch(`/api/athlete/prs?access_token=${accessToken}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setPrLibrary(data.prs ?? []);
        setPrCount(data.count ?? 0);
        setPrStatus('ready');
      })
      .catch(e => {
        console.warn('[PRs]', e);
        setPrStatus('error');
      });
  }, [accessToken]);

  const handleLogin = () => {
    window.location.href = '/api/auth/login';
  };

  const handleLogout = () => {
    setAccessToken(null);
    setAthlete(null);
    setSegments([]);
    setPrLibrary([]);
    setPrStatus('idle');
    setPrCount(0);
  };

  const handleBBoxDrawn = useCallback(async (bbox: BBox) => {
    if (!accessToken) {
      setError('Please connect with Strava first to search for segments.');
      return;
    }
    setLoading(true);
    setError(null);
    setSegments([]);

    try {
      const res = await fetch('/api/segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bbox, accessToken, prLibrary }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'API error');
      setSegments(data.segments ?? []);
      if (data.wind) setWind(data.wind);
      if ((data.segments ?? []).length === 0) {
        setError('No segments found in this area. Try a different region.');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [accessToken, prLibrary]);

  const windDirLabel = (deg: number) => {
    const dirs = ['N','NE','E','SE','S','SW','W','NW'];
    return dirs[Math.round(deg / 45) % 8];
  };

  const predictedCount = segments.filter(s => s.prediction).length;

  return (
    <div className="flex flex-col h-screen bg-gray-900">
      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 24 24" className="w-6 h-6 fill-orange-500">
            <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
          </svg>
          <span className="text-lg font-bold text-white">KOM Hunter</span>

          {wind && (
            <span className="text-xs text-gray-400 hidden sm:block">
              Wind: {wind.windspeed} km/h {windDirLabel(wind.winddirection)}
            </span>
          )}

          {/* PR status pill */}
          {accessToken && (
            <span className={`
              text-xs px-2 py-0.5 rounded-full font-medium hidden sm:inline-block
              ${prStatus === 'loading' ? 'bg-yellow-900/60 text-yellow-300 animate-pulse' : ''}
              ${prStatus === 'ready'   ? 'bg-green-900/60  text-green-300'  : ''}
              ${prStatus === 'error'   ? 'bg-red-900/60    text-red-300'    : ''}
            `}>
              {prStatus === 'loading' && '⏳ Loading PRs…'}
              {prStatus === 'ready'   && `✓ ${prCount} PRs loaded`}
              {prStatus === 'error'   && '⚠ PR load failed'}
            </span>
          )}
        </div>

        <LoginButton athlete={athlete} onLogin={handleLogin} onLogout={handleLogout} />
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-80 shrink-0 bg-gray-800 border-r border-gray-700 flex flex-col">
          <div className="p-3 border-b border-gray-700 shrink-0 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-200">
                Segments
                {segments.length > 0 && (
                  <span className="ml-1 text-gray-400">({segments.length})</span>
                )}
                {predictedCount > 0 && (
                  <span className="ml-1 text-blue-400 text-xs">· {predictedCount} predicted</span>
                )}
              </h2>
              {loading && (
                <div className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
              )}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-1 flex-wrap">
              {[
                { color: '#ef4444', label: 'Hard' },
                { color: '#f97316', label: '' },
                { color: '#eab308', label: '' },
                { color: '#84cc16', label: '' },
                { color: '#22c55e', label: 'Easy' },
              ].map(({ color, label }) => (
                <div key={color} className="flex items-center gap-0.5">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
                  {label && <span className="text-xs text-gray-400">{label}</span>}
                </div>
              ))}
              <span className="text-xs text-gray-500 ml-1">Opportunity</span>
            </div>

            {/* Login prompt when logged out */}
            {!accessToken && (
              <p className="text-xs text-gray-500 italic">
                Connect Strava to unlock PR predictions
              </p>
            )}
          </div>

          {error && (
            <div className="m-3 p-2 bg-red-900/40 border border-red-700 rounded text-xs text-red-300">
              {error}
            </div>
          )}

          <SegmentList
            segments={segments}
            selected={selected}
            onSelect={setSelected}
            showPredictions={prStatus === 'ready'}
          />
        </aside>

        {/* Map */}
        <main className="flex-1 relative">
          <MapView
            segments={segments}
            selected={selected}
            onSelect={setSelected}
            onBBoxDrawn={handleBBoxDrawn}
            loading={loading}
          />
        </main>
      </div>
    </div>
  );
}
