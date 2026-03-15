'use client';
import { ScoredSegment, PredictionResult } from '@/types';

type SpeedUnit = 'mph' | 'kph';

interface Props {
  segments: ScoredSegment[];
  selected: number | null;
  onSelect: (id: number) => void;
  showPredictions?: boolean;
  crLabel?: string;
  speedUnit?: SpeedUnit;
}

function formatSpeed(distanceM: number, timeSecs: number, unit: SpeedUnit): string {
  if (timeSecs <= 0 || distanceM <= 0) return '';
  const ms = distanceM / timeSecs;
  const val = unit === 'mph' ? ms * 2.237 : ms * 3.6;
  return `${val.toFixed(1)} ${unit}`;
}

function WindBadge({ component, speedUnit }: { component: number; speedUnit: SpeedUnit }) {
  const abs = Math.abs(component);
  const spd = speedUnit === 'mph'
    ? `${(abs * 0.6214).toFixed(1)} mph`
    : `${abs.toFixed(1)} kph`;
  if (component > 2)  return <span className="text-green-400">↑ {spd} tail</span>;
  if (component < -2) return <span className="text-red-400">↓ {spd} head</span>;
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

// ─────────────────────────────────────────────────────────────────────────────
// Power-balance tailwind model
//
// At the athlete's predicted pace the total resistive power equals:
//   P = F_aero(v, v_wind) · v  +  F_roll · v  +  F_mech · v
//
// A tailwind reduces only the aero term. Rolling resistance and mechanical
// drag are unaffected, so the speed gain is always less than the raw wind
// speed — unlike the naive linear addition.
//
// Constants to adjust if real-world results don't match:
//   CDA      — the PRIMARY tuning dial. Drag coefficient × frontal area (m²).
//              Lower CDA (more aero) → larger speed gain from tailwind.
//              Higher CDA (upright) → smaller gain.
//   CRR      — rolling resistance coefficient. Higher = more tyre/surface drag,
//              less relative benefit from wind.
//   C_MECH   — mechanical loss coefficient (drivetrain friction). Treated as an
//              additional constant force = C_MECH · MASS · G.
//   MASS_KG  — combined rider + bike mass. Affects rolling & mechanical terms.
// ─────────────────────────────────────────────────────────────────────────────
const CDA     = 0.30;   // m²  — road cyclist on hoods; drop to ~0.22 for full aero tuck
const RHO     = 1.225;  // kg/m³ — air density at sea level, 15 °C
const CRR     = 0.004;  // rolling resistance coefficient (road tyre on tarmac)
const C_MECH  = 0.0025; // mechanical drag coefficient (≈ 2–3 % drivetrain loss as force)
const MASS_KG = 80;     // kg — rider (75 kg) + bike (5 kg)
const G       = 9.81;   // m/s²

/**
 * Returns the equilibrium speed (m/s) a cyclist achieves with a tailwind,
 * given their base (no-wind) speed. Uses Newton's method to solve the
 * power-balance cubic for the new speed at the same power output.
 */
function tailwindSpeed(baseMs: number, tailwindMs: number): number {
  const rollMech = (CRR + C_MECH) * MASS_KG * G;
  // Total power at base speed (zero wind)
  const P = (0.5 * CDA * RHO * baseMs * baseMs + rollMech) * baseMs;

  // Solve f(v) = (0.5·CDA·RHO·(v - v_w)² + rollMech)·v − P = 0
  let v = baseMs + tailwindMs * 0.3; // conservative initial guess
  for (let i = 0; i < 15; i++) {
    const rel  = v - tailwindMs;
    const aero = 0.5 * CDA * RHO * rel * rel;
    const fv   = (aero + rollMech) * v - P;
    const dfv  = (aero + rollMech) + v * (CDA * RHO * rel); // df/dv
    if (Math.abs(dfv) < 1e-12) break;
    const step = fv / dfv;
    v -= step;
    if (Math.abs(step) < 1e-7) break;
  }
  return Math.max(v, baseMs);
}

function PredictionPanel({ p, komTime, tailwindComponent, distance, speedUnit }: {
  p: PredictionResult;
  komTime: number;
  tailwindComponent: number;
  distance: number;
  speedUnit: SpeedUnit;
}) {
  const gapSign  = p.gapToKom >= 0 ? '+' : '';
  const canKom   = p.gapToKom <= 0;
  const absGap   = Math.abs(p.gapToKom);

  // Recover turn penalties baked into predictedTime, then compute tailwind time
  // using the physics-based speed model above.
  const tailwindMs    = tailwindComponent > 2 ? tailwindComponent / 3.6 : 0;
  const turnPenalties = p.predictedTime - Math.round(distance / p.basePaceMs);
  const tailwindTime  = tailwindMs > 0
    ? Math.round(distance / tailwindSpeed(p.basePaceMs, tailwindMs) + turnPenalties)
    : null;
  const tailwindGap   = tailwindTime !== null ? tailwindTime - komTime : null;

  const confLabel =
    p.confidence >= 70 ? 'High confidence'   :
    p.confidence >= 45 ? 'Medium confidence' :
                         'Low confidence';

  return (
    <div className="mt-2 rounded-lg border border-gray-600 bg-gray-900/50 p-2.5 space-y-2">
      <div className="space-y-1">
        <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold">
          Predicted time
        </p>
        <p className="text-base font-bold text-white leading-tight whitespace-nowrap">
          {formatTime(p.predictedTime)}
          <span className="text-xs font-normal text-gray-400 ml-1.5">
            {formatSpeed(distance, p.predictedTime, speedUnit)}
          </span>
        </p>
        {tailwindTime !== null && (
          <p className="text-sm whitespace-nowrap overflow-hidden text-ellipsis">
            <span className="text-green-400 text-xs font-medium">↑ tailwind&nbsp;</span>
            <span className="font-bold text-green-300">{formatTime(tailwindTime)}</span>
            <span className="text-xs text-green-600 ml-1">{formatSpeed(distance, tailwindTime, speedUnit)}</span>
            {tailwindGap !== null && (
              <span className="text-xs text-gray-400 ml-1">
                ({tailwindGap <= 0
                  ? `KOM by ${formatTime(Math.abs(tailwindGap))}`
                  : `+${formatTime(tailwindGap)} vs KOM`})
              </span>
            )}
          </p>
        )}
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

export default function SegmentList({ segments, selected, onSelect, showPredictions, crLabel = 'KOM', speedUnit = 'mph' }: Props) {
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
        const komSpeed = seg.kom_time > 0 && seg.distance > 0
          ? formatSpeed(seg.distance, seg.kom_time, speedUnit)
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
                className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold shrink-0"
                style={
                  seg.userTimeDelta != null && seg.userTimeDelta <= 0
                    ? { backgroundColor: '#000', color: '#fff' }
                    : { backgroundColor: seg.color, color: '#fff' }
                }
                title={seg.userTimeDelta != null && seg.userTimeDelta <= 0 ? 'You hold the KOM' : 'Opportunity score'}
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
                    {crLabel} {formatTime(seg.kom_time)}{komSpeed ? ` · ${komSpeed}` : ''}
                  </span>
                : <span className="text-gray-500">{crLabel} —</span>
              }
              {seg.userBestTime && seg.userTimeDelta != null && seg.userTimeDelta <= 0 && (
                <span className="text-yellow-300 font-semibold">
                  👑 You hold the {crLabel}
                </span>
              )}
              {seg.userBestTime && seg.userTimeDelta != null && seg.userTimeDelta > 0 && (
                <span className="text-blue-400">
                  PR {formatTime(seg.userBestTime)} (+{formatTime(seg.userTimeDelta)})
                </span>
              )}
              <WindBadge component={seg.tailwindComponent} speedUnit={speedUnit} />
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
                  <PredictionPanel
                    p={seg.prediction}
                    komTime={seg.kom_time}
                    tailwindComponent={seg.tailwindComponent}
                    distance={seg.distance}
                    speedUnit={speedUnit}
                  />
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
