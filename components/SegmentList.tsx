'use client';
import { ScoredSegment, PredictionResult } from '@/types';

interface Props {
  segments: ScoredSegment[];
  selected: number | null;
  onSelect: (id: number) => void;
  showPredictions?: boolean;
  crLabel?: string;
}

function WindBadge({ component }: { component: number }) {
  const abs = Math.abs(component);
  if (component > 2)  return <span className="text-green-400">↑ {abs} km/h tail</span>;
  if (component < -2) return <span className="text-red-400">↓ {abs} km/h head</span>;
  return <span className="text-yellow-400">→ crosswind</span>;
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function ScoreBar({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-gray-500 w-12 text-right shrink-0">{label}</span>
      <div className="flex-1 bg-gray-700 rounded-full h-1.5 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
      <span className="text-gray-400 w-6 text-right shrink-0">{value}</span>
    </div>
  );
}

function confidenceColor(c: number): string {
  if (c >= 70) return '#22c55e';
  if (c >= 45) return '#eab308';
  return '#f97316';
}

function ConfidenceRing({ value }: { value: number }) {
  const r       = 14;
  const circ    = 2 * Math.PI * r;
  const filled  = circ * (value / 100);
  const color   = confidenceColor(value);
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" className="shrink-0">
      <circle cx="18" cy="18" r={r} fill="none" stroke="#374151" strokeWidth="3" />
      <circle
        cx="18" cy="18" r={r}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeLinecap="round"
        transform="rotate(-90 18 18)"
      />
      <text x="18" y="22" textAnchor="middle" fontSize="9" fill={color} fontWeight="bold">
        {value}%
      </text>
    </svg>
  );
}

function PredictionPanel({ p, komTime }: { p: PredictionResult; komTime: number }) {
  const gapSign  = p.gapToKom >= 0 ? '+' : '';
  const canKom   = p.gapToKom <= 0;
  const absGap   = Math.abs(p.gapToKom);

  const confLabel =
    p.confidence >= 70 ? 'High confidence'   :
    p.confidence >= 45 ? 'Medium confidence' :
                         'Low confidence';

  return (
    <div className="mt-2 rounded-lg border border-gray-600 bg-gray-900/50 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold">
            Predicted time
          </p>
          <p className="text-base font-bold text-white leading-tight">
            {formatTime(p.predictedTime)}
          </p>
        </div>
        <ConfidenceRing value={p.confidence} />
      </div>

      <div className={`flex items-center gap-1.5 text-xs font-medium
        ${canKom ? 'text-green-400' : 'text-orange-300'}`}>
        {canKom
          ? `🏆 Predicted KOM by ${formatTime(absGap)}`
          : `${gapSign}${formatTime(p.gapToKom)} vs KOM (${formatTime(komTime)})`}
      </div>

      <div className="text-xs text-gray-500 flex items-center justify-between">
        <span>{confLabel} · {p.referenceCount} reference PR{p.referenceCount !== 1 ? 's' : ''}</span>
        <span
          className="underline decoration-dotted cursor-help"
          title={`Avg feature distance: ${p.avgFeatureDistance.toFixed(3)}\nBased on grade/distance similarity to your recent PRs.`}
        >
          ℹ
        </span>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 bg-gray-700 rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${p.confidence}%`, backgroundColor: confidenceColor(p.confidence) }}
          />
        </div>
      </div>
    </div>
  );
}

export default function SegmentList({ segments, selected, onSelect, showPredictions, crLabel = 'KOM' }: Props) {
  if (!segments.length) {
    return (
      <div className="text-gray-400 text-sm p-4 text-center">
        Draw a bounding box on the map to find segments.
      </div>
    );
  }

  return (
    <div className="overflow-y-auto flex-1 divide-y divide-gray-700">
      {segments.map((seg) => {
        const d        = seg.komWeaknessDetail;
        const sel      = selected === seg.id;
        const speedMph = seg.kom_time > 0 && seg.distance > 0
          ? ((seg.distance / 1609.34) / (seg.kom_time / 3600)).toFixed(1)
          : null;
        return (
          <div
            key={seg.id}
            onClick={() => onSelect(seg.id)}
            className={`p-3 cursor-pointer transition hover:bg-gray-700/60 ${sel ? 'bg-gray-700' : ''}`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-white truncate leading-tight">
                {seg.name}
              </p>
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold text-white shrink-0"
                style={{ backgroundColor: seg.color }}
                title="Opportunity score"
              >
                {seg.opportunityScore}
              </div>
            </div>

            <p className="text-xs text-gray-400 mt-0.5">
              {(seg.distance / 1000).toFixed(1)} km ·{' '}
              {seg.average_grade > 0 ? '+' : ''}{seg.average_grade.toFixed(1)}% ·{' '}
              {seg.effort_count.toLocaleString()} efforts
              {seg.surface ? ` · ${seg.surface}` : ''}
            </p>

            <div className="flex items-center gap-2 mt-1 text-xs flex-wrap">
              {seg.kom_time > 0
                ? <span className="text-gray-300">
                    {crLabel} {formatTime(seg.kom_time)}{speedMph ? ` · ${speedMph} mph` : ''}
                  </span>
                : <span className="text-gray-500">{crLabel} —</span>
              }
              {seg.userBestTime && (
                <span className="text-blue-400">
                  PR {formatTime(seg.userBestTime)} (+{formatTime(seg.userTimeDelta ?? 0)})
                </span>
              )}
              <WindBadge component={seg.tailwindComponent} />
            </div>

            {sel && (
              <div className="mt-2 space-y-2">
                {d && (
                  <div className="space-y-1 text-xs">
                    <ScoreBar value={d.pace}    label="Pace"    color="#f97316" />
                    <ScoreBar value={d.efforts} label="Efforts" color="#a78bfa" />
                    <ScoreBar value={d.age}     label="Age"     color="#38bdf8" />
                  </div>
                )}

                {showPredictions && seg.prediction && (
                  <PredictionPanel p={seg.prediction} komTime={seg.kom_time} />
                )}

                {!showPredictions && (
                  <p className="text-xs text-gray-500 italic">
                    Connect Strava to see your predicted time on this segment.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
