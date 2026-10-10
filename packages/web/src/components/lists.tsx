import type { Alert, GameEvent, PlayerView, ValidationIssue } from '@game/engine';
import { quarterLabel } from '../i18n/format';
import { alertText, eventText, fr, issueText } from '../i18n/fr';
import { Notice } from './ui';

/** Company (or listing) id → display name, from what the player can see. */
export function companyNamer(view: PlayerView): (id: string) => string {
  const names: Record<string, string> = {};
  for (const l of view.mna.listings) names[l.id] = l.name;
  for (const c of view.competitors) names[c.companyId] = c.name;
  for (const c of view.groupCompanies) names[c.companyId] = c.name;
  names[view.companyId] = view.self.company.name;
  return (id) => names[id] ?? id;
}

export function AlertList(props: { alerts: Alert[]; empty?: string }) {
  if (props.alerts.length === 0) {
    return <p className="text-sm text-slate-500">{props.empty ?? fr.dashboard.noAlerts}</p>;
  }
  return (
    <ul className="space-y-2">
      {props.alerts.map((a, i) => (
        <li key={`${a.kind}-${i}`}>
          <Notice severity={a.severity}>{alertText(a)}</Notice>
        </li>
      ))}
    </ul>
  );
}

export function IssueList(props: { issues: ValidationIssue[]; empty?: string }) {
  if (props.issues.length === 0) {
    return <p className="text-sm text-slate-500">{props.empty ?? fr.decisions.noIssues}</p>;
  }
  return (
    <ul className="space-y-1 text-sm">
      {props.issues.map((issue, i) => (
        <li key={i} className="rounded bg-amber-50 px-2 py-1 text-amber-900">
          {issueText(issue)}
        </li>
      ))}
    </ul>
  );
}

const DOT = { info: 'bg-sky-400', warning: 'bg-amber-400', critical: 'bg-rose-500' };

export function EventList(props: { events: GameEvent[]; view: PlayerView; showTurn?: boolean }) {
  const name = companyNamer(props.view);
  return (
    <ul className="space-y-1 text-sm">
      {props.events.map((e, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[e.severity]}`} />
          {props.showTurn && (
            <span className="shrink-0 text-xs tabular-nums text-slate-400">
              {quarterLabel(e.turn)}
            </span>
          )}
          <span>{eventText(e, name)}</span>
        </li>
      ))}
    </ul>
  );
}
