import { useEffect, useState, type ReactNode } from 'react';
import { fmtChange, parseNumber } from '../i18n/format';

export function Card(props: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${props.className ?? ''}`}
    >
      {(props.title || props.actions) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            {props.title}
          </h2>
          {props.actions}
        </header>
      )}
      {props.children}
    </section>
  );
}

export function Kpi(props: { label: string; value: string; change?: number; hint?: string }) {
  const { change } = props;
  const color =
    change === undefined || Math.abs(change) < 1e-9
      ? 'text-slate-500'
      : change > 0
        ? 'text-emerald-600'
        : 'text-rose-600';
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {props.label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{props.value}</div>
      {change !== undefined && Number.isFinite(change) && (
        <div className={`mt-1 text-xs tabular-nums ${color}`}>
          {fmtChange(change)} {props.hint}
        </div>
      )}
    </div>
  );
}

/** A number input that accepts French notation and only reports valid numbers. */
export function NumberField(props: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  /** Empty input means undefined (e.g. "full capacity", "market order"). */
  allowEmpty?: boolean;
  min?: number;
  placeholder?: string;
  /** Width class (default w-28). */
  className?: string;
  ariaLabel?: string;
}) {
  const format = (v: number | undefined) =>
    v === undefined || !Number.isFinite(v)
      ? ''
      : String(Math.round(v * 100) / 100).replace('.', ',');
  const [text, setText] = useState(format(props.value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(format(props.value));
  }, [props.value, focused]);
  const parsed = text.trim() === '' ? undefined : parseNumber(text);
  const invalid =
    (parsed === undefined && !props.allowEmpty) ||
    (parsed !== undefined &&
      (Number.isNaN(parsed) || (props.min !== undefined && parsed < props.min)));
  return (
    <input
      inputMode="decimal"
      aria-label={props.ariaLabel}
      placeholder={props.placeholder}
      className={`${props.className ?? 'w-28'} rounded border px-2 py-1 text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-400 ${
        invalid ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
      }`}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setText(format(props.value));
      }}
      onChange={(e) => {
        setText(e.target.value);
        const v = e.target.value.trim() === '' ? undefined : parseNumber(e.target.value);
        if (v === undefined) {
          if (props.allowEmpty) props.onChange(undefined);
          return;
        }
        if (Number.isNaN(v) || (props.min !== undefined && v < props.min)) return;
        props.onChange(v);
      }}
    />
  );
}

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  title?: string;
}) {
  const styles = {
    primary: 'bg-sky-600 text-white hover:bg-sky-700 disabled:bg-slate-300',
    secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    danger: 'border border-rose-300 bg-white text-rose-700 hover:bg-rose-50',
    ghost: 'text-sky-700 hover:underline',
  }[props.variant ?? 'secondary'];
  return (
    <button
      type={props.type ?? 'button'}
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      className={`whitespace-nowrap rounded px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${styles} ${props.className ?? ''}`}
    >
      {props.children}
    </button>
  );
}

export function Table(props: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto ${props.className ?? ''}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            {props.head.map((h, i) => (
              <th key={i} className={`px-2 py-2 font-medium ${i > 0 ? 'text-right' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{props.children}</tbody>
      </table>
    </div>
  );
}

/** A table cell: first column left-aligned, the others right-aligned numbers. */
export function Td(props: { children?: ReactNode; left?: boolean; className?: string }) {
  return (
    <td
      className={`px-2 py-1.5 ${props.left ? 'text-left' : 'whitespace-nowrap text-right tabular-nums'} ${props.className ?? ''}`}
    >
      {props.children}
    </td>
  );
}

const SEVERITY_STYLES = {
  info: 'border-sky-200 bg-sky-50 text-sky-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  critical: 'border-rose-200 bg-rose-50 text-rose-900',
};

export function Notice(props: { severity: keyof typeof SEVERITY_STYLES; children: ReactNode }) {
  return (
    <div className={`rounded border px-3 py-2 text-sm ${SEVERITY_STYLES[props.severity]}`}>
      {props.children}
    </div>
  );
}

export function Stat(props: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5 text-sm">
      <span className="text-slate-600">{props.label}</span>
      <span className={`tabular-nums ${props.strong ? 'font-semibold' : ''}`}>{props.value}</span>
    </div>
  );
}

export function Tabs<T extends string>(props: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-slate-200" role="tablist">
      {props.tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === props.active}
          onClick={() => props.onChange(t.id)}
          className={`-mb-px rounded-t border px-3 py-2 text-sm font-medium ${
            t.id === props.active
              ? 'border-slate-200 border-b-white bg-white text-sky-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <select
      aria-label={props.ariaLabel}
      className={`rounded border border-slate-300 bg-white px-2 py-1 text-sm ${props.className ?? ''}`}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as T)}
    >
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ProgressBar(props: { value: number }) {
  const pct = Math.max(0, Math.min(1, props.value)) * 100;
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-slate-200">
      <div className="h-full bg-sky-500" style={{ width: `${pct}%` }} />
    </div>
  );
}
