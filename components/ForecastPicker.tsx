'use client';

export interface ForecastSlot {
  dayOffset: 1 | 2 | 3;
  period: 'morning' | 'midday' | 'afternoon';
}

interface Props {
  value: ForecastSlot | null;
  onChange: (slot: ForecastSlot | null) => void;
  loading?: boolean;
}

const PERIODS: { key: ForecastSlot['period']; label: string }[] = [
  { key: 'morning',   label: 'AM'  },
  { key: 'midday',    label: 'Mid' },
  { key: 'afternoon', label: 'PM'  },
];

function dayLabel(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  if (offset === 1) return 'Tomorrow';
  return d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function ForecastPicker({ value, onChange, loading }: Props) {
  const selected = value ? `${value.dayOffset}-${value.period}` : 'now';

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Wind forecast
        </span>
        {loading && (
          <div className="w-3 h-3 border-2 border-orange-500 border-t-transparent rounded-full animate-spin shrink-0" />
        )}
      </div>

      {/* Now */}
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="radio"
          name="forecast-slot"
          value="now"
          checked={selected === 'now'}
          onChange={() => onChange(null)}
          className="accent-orange-500"
        />
        <span className={`text-xs ${selected === 'now' ? 'text-orange-400 font-semibold' : 'text-gray-400'}`}>
          Now (current)
        </span>
      </label>

      {/* 3-day grid: day label | AM | Mid | PM */}
      <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-x-2 gap-y-1.5 items-center">
        {/* Column headers */}
        <div />
        {PERIODS.map(p => (
          <span key={p.key} className="text-[10px] text-gray-500 text-center font-medium">
            {p.label}
          </span>
        ))}

        {/* Rows for each day */}
        {([1, 2, 3] as const).map(day => (
          <>
            <span key={`lbl-${day}`} className="text-[10px] text-gray-400 whitespace-nowrap">
              {dayLabel(day)}
            </span>
            {PERIODS.map(p => {
              const id = `${day}-${p.key}`;
              return (
                <div key={id} className="flex justify-center">
                  <input
                    type="radio"
                    name="forecast-slot"
                    value={id}
                    checked={selected === id}
                    onChange={() => onChange({ dayOffset: day, period: p.key })}
                    className="accent-orange-500 cursor-pointer"
                  />
                </div>
              );
            })}
          </>
        ))}
      </div>
    </div>
  );
}
