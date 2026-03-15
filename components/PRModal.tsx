'use client';
import { AthletePREffort } from '@/types';

interface Props {
  prs: AthletePREffort[];
  speedUnit: 'mph' | 'kph';
  onClose: () => void;
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function formatSpeed(paceMs: number, unit: 'mph' | 'kph') {
  const val = unit === 'mph' ? paceMs * 2.237 : paceMs * 3.6;
  return `${val.toFixed(1)} ${unit}`;
}

export default function PRModal({ prs, speedUnit, onClose }: Props) {
  const sorted = [...prs].sort((a, b) => a.distance - b.distance);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
          <div>
            <h2 className="text-base font-bold text-white">Your Reference PRs</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {prs.length} effort{prs.length !== 1 ? 's' : ''} used to predict your segment times
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition text-xl leading-none px-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Table */}
        <div className="overflow-y-auto flex-1">
          {prs.length === 0 ? (
            <p className="text-gray-400 text-sm p-4 text-center">No PR efforts loaded.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-800 border-b border-gray-700">
                <tr className="text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-2 font-semibold">Segment</th>
                  <th className="text-right px-3 py-2 font-semibold">Dist</th>
                  <th className="text-right px-3 py-2 font-semibold">Grade</th>
                  <th className="text-right px-3 py-2 font-semibold">Your Time</th>
                  <th className="text-right px-4 py-2 font-semibold">Speed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/60">
                {sorted.map(pr => (
                  <tr key={pr.segmentId} className="hover:bg-gray-700/40 transition-colors">
                    <td className="px-4 py-2 text-white max-w-[180px]">
                      <span className="block truncate" title={pr.segmentName}>
                        {pr.segmentName}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-300 text-right whitespace-nowrap">
                      {(pr.distance / 1000).toFixed(1)} km
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap"
                        style={{ color: pr.grade > 0 ? '#f97316' : pr.grade < 0 ? '#38bdf8' : '#9ca3af' }}>
                      {pr.grade > 0 ? '+' : ''}{pr.grade.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-gray-300 text-right whitespace-nowrap font-mono">
                      {formatTime(pr.elapsedTime)}
                    </td>
                    <td className="px-4 py-2 text-gray-400 text-right whitespace-nowrap">
                      {formatSpeed(pr.pace, speedUnit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
