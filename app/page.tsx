'use client';
import { useState, useCallback, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import SegmentList from '@/components/SegmentList';
import LoginButton from '@/components/LoginButton';
import InfoModal from '@/components/InfoModal';
import PRModal from '@/components/PRModal';
import ForecastPicker, { ForecastSlot } from '@/components/ForecastPicker';
import { ScoredSegment, BBox, AthletePREffort, WindData } from '@/types';
import { calcTailwind } from '@/lib/wind';

function scoreColor(score: number): string {
  if (score >= 75) return '#22c55e';
  if (score >= 55) return '#84cc16';
  if (score >= 40) return '#eab308';
  if (score >= 25) return '#f97316';
  return '#ef4444';
}

const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

interface Athlete {
  firstname: string;
  lastname: string;
  profile_medium: string;
  sex?: string;   // 'M' or 'F' from Strava
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
  const [infoOpen,    setInfoOpen   ] = useState(false);
  const [prModalOpen, setPrModalOpen] = useState(false);
  const [prLibrary,   setPrLibrary  ] = useState<AthletePREffort[]>([]);
  const [prStatus,    setPrStatus   ] = useState<PRStatus>('idle');
  const [prCount,     setPrCount    ] = useState(0);
  const [mobileTab,   setMobileTab  ] = useState<'map' | 'list'>('map');
  const [speedUnit,       setSpeedUnit      ] = useState<'mph' | 'kph'>('mph');
  const [windWeight,      setWindWeight     ] = useState(1.0);
  const [forecastSlot,    setForecastSlot   ] = useState<ForecastSlot | null>(null);
  const [forecastWind,    setForecastWind   ] = useState<WindData | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [bboxCenter,      setBboxCenter     ] = useState<{ lat: number; lng: number } | null>(null);

  // ── OAuth token ingestion from URL ───────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const at         = params.get('access_token');
    const athleteStr = params.get('athlete');
    const err        = params.get('error');

    if (at) {
      setAccessToken(at);
      if (athleteStr) {
        try { setAthlete(JSON.parse(athleteStr)); } catch {}
      }
      window.history.replaceState({}, '', '/');
    }
    if (err === 'athlete_limit') {
      setError('This app has reached Strava\'s limit for connected athletes. The owner needs to apply for Strava API production access to allow more users.');
    } else if (err) {
      setError('Authentication failed. Please try again.');
    }
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

  // ── Fetch forecast wind whenever slot or bbox changes ────────────────────
  useEffect(() => {
    if (!forecastSlot || !bboxCenter) {
      setForecastWind(null);
      return;
    }

    const PERIOD_HOURS: Record<ForecastSlot['period'], number> = {
      morning: 7, midday: 12, afternoon: 17,
    };

    const d = new Date();
    d.setDate(d.getDate() + forecastSlot.dayOffset);
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    const hh   = String(PERIOD_HOURS[forecastSlot.period]).padStart(2, '0');
    const datetime = `${yyyy}-${mm}-${dd}T${hh}:00`;

    setForecastLoading(true);
    fetch(
      `/api/wind-forecast?lat=${bboxCenter.lat.toFixed(4)}&lng=${bboxCenter.lng.toFixed(4)}&datetime=${encodeURIComponent(datetime)}`
    )
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setForecastWind({ windspeed: data.windspeed, winddirection: data.winddirection });
      })
      .catch(e => console.warn('[forecast wind]', e))
      .finally(() => setForecastLoading(false));
  }, [forecastSlot, bboxCenter]);

  const handleLogin  = () => { window.location.href = '/api/auth/login'; };
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
    setBboxCenter({ lat: (bbox.minLat + bbox.maxLat) / 2, lng: (bbox.minLng + bbox.maxLng) / 2 });
    setForecastSlot(null);
    setForecastWind(null);

    try {
      const res = await fetch('/api/segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bbox, accessToken, prLibrary, athleteSex: athlete?.sex }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'API error');
      setSegments(data.segments ?? []);
      if (data.wind) setWind(data.wind);
      if ((data.segments ?? []).length === 0) {
        setError('No segments found in this area. Try a different region.');
      }
      // Auto-show segment list on mobile once results arrive
      setMobileTab('list');
    } catch (e: any) {
      setError(e.message);
      setMobileTab('list');
    } finally {
      setLoading(false);
    }
  }, [accessToken, prLibrary]);

  const windDirLabel = (deg: number) => {
    const dirs = ['N','NE','E','SE','S','SW','W','NW'];
    return dirs[Math.round(deg / 45) % 8];
  };

  const predictedCount = segments.filter(s => s.prediction).length;

  const displaySegments = useMemo<ScoredSegment[]>(() =>
    segments.map(seg => {
      const tailwindComponent = (forecastWind && !seg.isLooped)
        ? calcTailwind(seg.bearing, forecastWind.winddirection, forecastWind.windspeed)
        : seg.tailwindComponent;
      const windBonus = Math.round((tailwindComponent / 40) * 30 * windWeight);
      const opportunityScore = Math.min(100, Math.max(0, seg.komWeaknessScore + windBonus));
      return { ...seg, tailwindComponent, opportunityScore, color: scoreColor(opportunityScore) };
    }),
    [segments, windWeight, forecastWind],
  );

  // ── Sidebar panel (shared by desktop aside + mobile overlay) ─────────────
  const sidebarPanel = (
    <>
      <div className="p-3 border-b border-gray-700 shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5">
            Segments
            {segments.length > 0 && (
              <span className="text-gray-400">({segments.length})</span>
            )}
            {predictedCount > 0 && (
              <span className="text-blue-400 text-xs">· {predictedCount} predicted</span>
            )}
            <button
              onClick={() => setInfoOpen(true)}
              className="text-gray-500 hover:text-gray-300 transition text-xl leading-none ml-1 p-0.5"
              aria-label="How scoring works"
              title="How scoring works"
            >
              ⓘ
            </button>
            {prStatus === 'ready' && prLibrary.length > 0 && (
              <button
                onClick={() => setPrModalOpen(true)}
                className="text-xs text-blue-400 hover:text-blue-300 transition font-medium ml-1 px-1.5 py-0.5 rounded border border-blue-700 hover:border-blue-500"
                title="View your reference PR efforts"
              >
                See your PR&apos;s
              </button>
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

        {/* Wind influence slider */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 shrink-0">Wind</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={windWeight}
            onChange={e => setWindWeight(parseFloat(e.target.value))}
            className="flex-1 accent-orange-500 h-1"
          />
          <span className="text-xs text-gray-300 w-6 text-right">
            {windWeight === 0 ? 'Off' : `${windWeight.toFixed(1)}×`}
          </span>
        </div>

        {segments.length > 0 && (
          <div className="border-t border-gray-700 pt-2">
            <ForecastPicker
              value={forecastSlot}
              onChange={setForecastSlot}
              loading={forecastLoading}
            />
          </div>
        )}

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
        segments={displaySegments}
        selected={selected}
        onSelect={setSelected}
        showPredictions={prStatus === 'ready'}
        crLabel={athlete?.sex === 'F' ? 'QOM' : 'KOM'}
        speedUnit={speedUnit}
      />
    </>
  );

  return (
    <div className="flex flex-col h-screen bg-gray-900">
      {/* ── Header ── */}
      <header className="flex items-center justify-between px-3 py-2 md:px-4 md:py-3 bg-gray-800 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <svg viewBox="0 0 24 24" className="w-6 h-6 fill-orange-500 shrink-0">
            <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
          </svg>
          <span className="text-base md:text-lg font-bold text-white">Weak KOM</span>
          {(forecastWind ?? wind) && (() => {
            const w = forecastWind ?? wind!;
            const spd = speedUnit === 'mph'
              ? `${(w.windspeed * 0.6214).toFixed(1)} mph`
              : `${w.windspeed} kph`;
            return (
              <span className="text-xs text-gray-400 hidden sm:block">
                {forecastWind
                  ? <><span className="text-orange-400 font-medium">Forecast</span>{': '}{spd} {windDirLabel(w.winddirection)}</>
                  : <>Wind: {spd} {windDirLabel(w.winddirection)}</>
                }
              </span>
            );
          })()}

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

        {/* Speed unit toggle */}
        <div className="flex items-center gap-1 bg-gray-700 rounded-lg p-0.5 mr-2">
          {(['mph', 'kph'] as const).map(unit => (
            <button
              key={unit}
              onClick={() => setSpeedUnit(unit)}
              className={`px-2 py-0.5 rounded text-xs font-semibold transition-colors ${
                speedUnit === unit
                  ? 'bg-orange-500 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {unit}
            </button>
          ))}
        </div>

        <LoginButton athlete={athlete} onLogin={handleLogin} onLogout={handleLogout} />
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0 relative">

        {/* Desktop sidebar — always visible on md+ */}
        <aside className="hidden md:flex w-80 shrink-0 bg-gray-800 border-r border-gray-700 flex-col">
          {sidebarPanel}
        </aside>

        {/* Map — always rendered so Leaflet stays initialised */}
        <main className="flex-1 relative">
          <MapView
            segments={displaySegments}
            selected={selected}
            onSelect={setSelected}
            onBBoxDrawn={handleBBoxDrawn}
            loading={loading}
            crLabel={athlete?.sex === 'F' ? 'QOM' : 'KOM'}
            speedUnit={speedUnit}
          />
        </main>

        {/* Mobile segment list overlay */}
        {mobileTab === 'list' && (
          <div className="md:hidden absolute inset-0 z-[400] bg-gray-800 flex flex-col">
            {sidebarPanel}
          </div>
        )}
      </div>

      {/* ── Mobile bottom tab bar ── */}
      <nav className="md:hidden flex shrink-0 bg-gray-800 border-t border-gray-700">
        <button
          onClick={() => setMobileTab('map')}
          className={`flex-1 py-3 text-sm font-semibold transition-colors ${
            mobileTab === 'map' ? 'text-orange-400' : 'text-gray-400'
          }`}
        >
          Map
        </button>
        <button
          onClick={() => setMobileTab('list')}
          className={`flex-1 py-3 text-sm font-semibold transition-colors ${
            mobileTab === 'list' ? 'text-orange-400' : 'text-gray-400'
          }`}
        >
          Segments{segments.length > 0 ? ` (${segments.length})` : ''}
        </button>
      </nav>

      {infoOpen    && <InfoModal onClose={() => setInfoOpen(false)} />}
      {prModalOpen && (
        <PRModal
          prs={prLibrary}
          speedUnit={speedUnit}
          onClose={() => setPrModalOpen(false)}
        />
      )}
    </div>
  );
}
