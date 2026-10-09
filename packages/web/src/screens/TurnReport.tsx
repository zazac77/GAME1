import type { CompanyPreview, PlayerTurnSummary } from '@game/engine';
import type { ReactNode } from 'react';
import { AlertList, EventList, IssueList } from '../components/lists';
import { Card, Table, Td } from '../components/ui';
import { fmtChange, fmtInt, fmtMoney, fmtPct, fmtPrice, quarterLabel } from '../i18n/format';
import { effectText, eventName, fr, targetName } from '../i18n/fr';
import { useGame } from '../store/game';

function rows(
  s: PlayerTurnSummary,
  p: CompanyPreview | undefined,
): [string, ReactNode, ReactNode][] {
  const t = fr.report;
  const dash = '–';
  return [
    [t.revenue, p ? fmtMoney(p.expectedRevenue) : dash, fmtMoney(s.revenue)],
    [t.ebitda, p ? fmtMoney(p.expectedEbitda) : dash, fmtMoney(s.ebitda)],
    [t.netIncome, dash, fmtMoney(s.netIncome)],
    [t.cash, p ? fmtMoney(p.expectedCashEnd) : dash, fmtMoney(s.cashEnd)],
    [t.output, fmtInt(p?.plannedOutput ?? s.plannedOutput), fmtInt(s.unitsProduced)],
    [t.demand, p ? fmtInt(p.expectedDemand) : dash, fmtInt(s.demand)],
    [t.sold, p ? fmtInt(p.expectedUnitsSold) : dash, fmtInt(s.unitsSold)],
    [t.lostSales, dash, fmtInt(s.lostSales)],
    [
      t.share,
      dash,
      `${fmtPct(s.marketShare)} (${fmtChange(s.marketShareChange).replace(' %', ' pt')})`,
    ],
    [t.hires, fmtInt(s.hiresRequested), fmtInt(s.hired)],
    [t.quits, dash, fmtInt(s.quits)],
    [t.dismissed, dash, fmtInt(s.dismissed)],
    [t.sharePrice, dash, `${fmtPrice(s.sharePrice)} (${fmtChange(s.sharePriceChange)})`],
    [t.index, dash, fmtChange(s.indexChange)],
  ];
}

export function TurnReportScreen() {
  const view = useGame((s) => s.view);
  const report = useGame((s) => s.report);
  const planned = useGame((s) => s.planned);
  if (!view) return null;
  const t = fr.report;
  if (!report) {
    return (
      <Card title={t.heading}>
        <p className="text-sm text-slate-500">{t.none}</p>
      </Card>
    );
  }
  const s = report.summary;
  const preview = planned?.turn === report.turn ? planned.preview : undefined;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">
        {t.heading} · {quarterLabel(report.turn)}
      </h1>
      <div className="grid gap-4 xl:grid-cols-2">
        {s && (
          <Card title={t.plannedVsActual}>
            <Table head={['', t.planned, t.actual]}>
              {rows(s, preview).map(([label, a, b]) => (
                <tr key={label}>
                  <Td left>{label}</Td>
                  <Td className="text-slate-500">{a}</Td>
                  <Td className="font-medium">{b}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        )}
        <div className="space-y-4">
          {s && s.events.length > 0 && (
            <Card title={t.events}>
              <ul className="space-y-2 text-sm">
                {s.events.map((e, i) => (
                  <li key={i}>
                    <span className="font-medium">{eventName(e.eventId)}</span>
                    {e.target.id && <span> ({targetName(e.target.kind, e.target.id)})</span>}
                    {e.concernsPlayer && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                        {t.eventsConcerning}
                      </span>
                    )}
                    <div className="text-slate-600">
                      {e.effects.map((x) => effectText(x.key, x.op, x.value)).join(', ')} ·{' '}
                      {fmtInt(e.durationQuarters)} trim.
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title={t.journal}>
            <EventList view={view} events={report.events.filter((e) => e.kind !== 'event')} />
          </Card>
          <Card title={t.issues}>
            <IssueList issues={report.issues} />
          </Card>
          <Card title={t.nextAlerts}>
            <AlertList alerts={report.alerts} />
          </Card>
        </div>
      </div>
    </div>
  );
}
