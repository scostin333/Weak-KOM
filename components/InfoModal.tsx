'use client';

interface Props {
  onClose: () => void;
}

function ColorRow({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </span>
  );
}

function Factor({ name, weight, color, children }: {
  name: string;
  weight: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="w-1 rounded-full shrink-0 mt-1 self-stretch" style={{ backgroundColor: color }} />
      <div>
        <p className="text-sm font-semibold text-white">
          {name}{' '}
          <span className="text-xs font-normal text-gray-400">({weight} weight)</span>
        </p>
        <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{children}</p>
      </div>
    </div>
  );
}

export default function InfoModal({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 sticky top-0 bg-gray-800 z-10">
          <h2 className="text-base font-bold text-white">How the Score Works</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition text-xl leading-none px-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-5 text-sm">
          {/* Overview */}
          <p className="text-gray-300 leading-relaxed">
            The{' '}
            <span className="text-white font-semibold">Opportunity Score</span> (0–100)
            estimates how beatable the current KOM is on each segment. Higher = easier to
            take. It combines three data factors and a wind bonus.
          </p>

          {/* Colour legend */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Score colours
            </p>
            <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-xs text-gray-300">
              <ColorRow color="#22c55e" label="75–100 · Easy opportunity" />
              <ColorRow color="#84cc16" label="55–74 · Moderate" />
              <ColorRow color="#eab308" label="40–54 · Challenging" />
              <ColorRow color="#f97316" label="25–39 · Difficult" />
              <ColorRow color="#ef4444" label="0–24 · Unlikely" />
            </div>
          </div>

          {/* Three factors */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
              Base score — weighted average of 3 factors
            </p>
            <div className="space-y-4">
              <Factor name="Pace" weight="40%" color="#f97316">
                Measures how slow the current KOM pace is (KOM time ÷ distance, in s/m).
                A slow KOM — e.g. a steep climb averaging ~12 km/h — scores 100.
                A fast KOM averaging ~36 km/h or more scores 0. The harder the record is
                to beat on pure speed, the lower this score.
              </Factor>
              <Factor name="Efforts" weight="30%" color="#a78bfa">
                Inverse of total attempt count, capped at 5,000. A segment with very few
                attempts has a KOM that hasn&apos;t been seriously challenged yet —
                a big opportunity. Once a segment has been tried 5,000+ times this
                factor scores 0.
              </Factor>
              <Factor name="Age" weight="30%" color="#38bdf8">
                Based on when the segment was created. Newer segments tend to have
                less-optimised records because fewer riders have specifically targeted them,
                making it easier to set the benchmark. Segments older than 8 years score 0
                on this factor.
              </Factor>
            </div>
          </div>

          {/* Wind bonus */}
          <div className="rounded-lg bg-gray-900/60 border border-gray-700 p-3 space-y-1.5">
            <p className="text-sm font-semibold text-white">
              Wind bonus{' '}
              <span className="text-xs font-normal text-gray-400">(up to +15 pts)</span>
            </p>
            <p className="text-xs text-gray-400 leading-relaxed">
              A tailwind along the segment bearing adds up to +15 points on top of the
              base score. A direct 40 km/h tailwind gives the full +15 bonus. Crosswinds
              and headwinds give no bonus (but headwinds are still shown in the list so
              you can avoid them).
            </p>
          </div>

          {/* Formula */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Formula
            </p>
            <div className="rounded-lg bg-gray-900/60 border border-gray-700 px-3 py-2.5">
              <pre className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap font-mono">
{`base  = pace×0.4 + efforts×0.3 + age×0.3
score = clamp(base×100 + wind_bonus, 0, 100)`}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
