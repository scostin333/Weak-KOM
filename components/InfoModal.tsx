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
                Compares the KOM against the maximum speed a strong cyclist could
                realistically sustain on this specific segment. Two adjustments are made:
                (1) <span className="text-gray-300 font-medium">Grade</span> — the raw speed
                is converted to a flat-equivalent using a physiological grade model, so a
                12 km/h KOM on a 10% climb is treated very differently from 12 km/h on flat.
                (2) <span className="text-gray-300 font-medium">Distance</span> — max
                sustainable speed decreases with effort length (Riegel power law), so
                holding 35 km/h for 20 km is much harder than for 500 m.
                A KOM that matches or exceeds what&apos;s physically expected scores 0;
                one well below expected scores 100.
              </Factor>
              <Factor name="Efforts" weight="30%" color="#a78bfa">
                Inverse of total attempt count, capped at 5,000. A segment with very few
                attempts has a KOM that hasn&apos;t been seriously challenged yet —
                a big opportunity. Once a segment has been tried 5,000+ times this
                factor scores 0.
              </Factor>
              <Factor name="KOM Age" weight="30%" color="#38bdf8">
                How long the current KOM has been standing. A long-standing record has
                already withstood years of competition and is harder to beat. A recently
                set KOM hasn&apos;t been fully tested yet — scores 100 if set this week,
                dropping to 0 once it has stood for 5+ years.
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

          {/* Confidence */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
              Prediction confidence (0–100)
            </p>
            <p className="text-xs text-gray-400 leading-relaxed mb-3">
              When your Strava PR history is loaded, the app predicts your time on each
              segment by interpolating across your efforts on similar segments (matched by
              distance and grade). The <span className="text-white font-semibold">Confidence</span> score
              tells you how reliable that prediction is.
            </p>
            <div className="space-y-4">
              <Factor name="Coverage" weight="max 40 pts" color="#f97316">
                How many of your past PRs were close enough to use as references (up to 5).
                Each usable reference adds 8 pts. A prediction with only 1 reference is
                inherently less reliable than one backed by 5.
              </Factor>
              <Factor name="Proximity" weight="max 40 pts" color="#a78bfa">
                How well the reference segments match the target in distance and grade.
                Measured via a Gaussian kernel — references with very similar difficulty
                contribute more weight. A high total kernel weight means the references
                are a close match.
              </Factor>
              <Factor name="Consistency" weight="max 20 pts" color="#38bdf8">
                How consistent your pace is across the reference segments after
                grade-adjusting each effort to the target gradient. Low variation
                (coefficient of variation ≤ 0) scores the full 20 pts;
                above ~20% variation the score falls to 0.
              </Factor>
            </div>
            <div className="mt-3 rounded-lg bg-gray-900/60 border border-gray-700 px-3 py-2.5">
              <pre className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap font-mono">
{`confidence = coverage + proximity + consistency
High ≥ 70  ·  Medium ≥ 45  ·  Low < 45`}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
