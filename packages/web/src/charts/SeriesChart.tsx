import type { HistoryStore } from '@game/engine';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { quarterLabel } from '../i18n/format';

export interface SeriesSpec {
  /** Key in history.series, or values given directly (aligned on the latest turns). */
  key?: string;
  values?: number[];
  label: string;
  color: string;
}

export const PALETTE = ['#0284c7', '#e11d48', '#16a34a', '#d97706', '#7c3aed', '#0d9488'];

/**
 * Line chart of history series. A series shorter than `turns` is aligned on
 * the most recent quarters (as the engine records them).
 */
export function SeriesChart(props: {
  history: HistoryStore;
  series: SeriesSpec[];
  format: (x: number) => string;
  height?: number;
  /** Shows only the last N quarters. */
  last?: number;
}) {
  const { turns } = props.history;
  const rows = turns.map(
    (turn) => ({ turn, label: quarterLabel(turn) }) as Record<string, number | string>,
  );
  props.series.forEach((s, i) => {
    const values = s.values ?? (s.key ? props.history.series[s.key] : undefined) ?? [];
    const offset = turns.length - values.length;
    values.forEach((v, j) => {
      const row = rows[offset + j];
      if (row) row[`s${i}`] = v;
    });
  });
  const data = props.last ? rows.slice(-props.last) : rows;
  return (
    <div style={{ height: props.height ?? 220 }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={20} />
          <YAxis
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => props.format(v)}
            width={84}
            domain={['auto', 'auto']}
          />
          <Tooltip formatter={(v) => props.format(Number(v))} />
          {props.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {props.series.map((s, i) => (
            <Line
              key={s.label}
              type="monotone"
              dataKey={`s${i}`}
              name={s.label}
              stroke={s.color}
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
