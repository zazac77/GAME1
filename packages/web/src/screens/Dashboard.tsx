import { useState } from 'react';
import { PALETTE, SeriesChart } from '../charts/SeriesChart';
import { AlertList, EventList } from '../components/lists';
import { Button, Card, Kpi, Stat } from '../components/ui';
import { fmtDec, fmtInt, fmtMoney, fmtPct, fmtPrice } from '../i18n/format';
import { effectText, eventName, fr, marketName, targetName } from '../i18n/fr';
import { useGame } from '../store/game';

const change = (now: number, before: number | undefined) =>
  before !== undefined && Math.abs(before) > 1e-9
    ? now / Math.abs(before) - Math.sign(before)
    : undefined;

export function Dashboard() {
  const view = useGame((s) => s.view);
  const [details, setDetails] = useState(false);
  if (!view) return null;
  const company = view.self.company;
  const { pnl, balance } = company.books.current;
  const previous = company.books.history.at(-2);
  const line = Object.values(company.productLines)[0];
  const market = line ? view.productMarkets[line.marketId] : undefined;
  const share = line ? (market?.lastResult.shares[line.id] ?? 0) : 0;
  const quote = view.stock.quotes[company.id];
  const quoteBefore = quote?.history.at(-2);
  const key = (k: string) => `company.${company.id}.${k}`;
  const headcount = Object.values(company.workforce).reduce((s, w) => s + w.headcount, 0);
  const t = fr.dashboard;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi
          label={fr.app.cash}
          value={fmtMoney(balance.cash)}
          change={change(balance.cash, previous?.balance.cash)}
          hint={t.trend}
        />
        <Kpi
          label={t.revenue}
          value={fmtMoney(pnl.revenue)}
          change={change(pnl.revenue, previous?.pnl.revenue)}
          hint={t.trend}
        />
        <Kpi
          label={t.netIncome}
          value={fmtMoney(pnl.netIncome)}
          change={change(pnl.netIncome, previous?.pnl.netIncome)}
          hint={t.trend}
        />
        <Kpi label={t.marketShare} value={fmtPct(share)} />
        <Kpi
          label={t.sharePrice}
          value={fmtPrice(quote?.price ?? 0)}
          change={change(quote?.price ?? 0, quoteBefore)}
          hint={t.trend}
        />
        <Kpi label={t.score} value={fmtMoney(view.score)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t.alerts}>
          <AlertList alerts={view.alerts} />
        </Card>
        <Card title={t.news}>
          {view.news.length === 0 ? (
            <p className="text-sm text-slate-500">{t.noNews}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {view.news.map((n, i) => (
                <li key={i}>
                  <span className="font-medium">{eventName(n.eventId)}</span>
                  {n.target.id && (
                    <span className="text-slate-500">
                      {' '}
                      ({targetName(n.target.kind, n.target.id)})
                    </span>
                  )}{' '}
                  : {effectText(n.key, n.op, n.value)}, {fmtInt(n.remaining)} trim.
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title={t.charts}
        actions={
          <Button variant="ghost" onClick={() => setDetails(!details)}>
            {details ? t.hideDetails : t.details}
          </Button>
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <SeriesChart
            history={view.history}
            format={fmtMoney}
            series={[
              { key: key('revenue'), label: t.revenue, color: PALETTE[0] ?? '' },
              { key: key('netIncome'), label: t.netIncome, color: PALETTE[1] ?? '' },
            ]}
          />
          <SeriesChart
            history={view.history}
            format={fmtMoney}
            series={[
              { key: key('cash'), label: fr.app.cash, color: PALETTE[2] ?? '' },
              { key: key('equity'), label: 'Fonds propres', color: PALETTE[3] ?? '' },
            ]}
          />
        </div>
        {details && (
          <div className="mt-4 grid gap-6 md:grid-cols-3">
            <div>
              <h3 className="mb-1 text-sm font-semibold">{t.macro}</h3>
              <Stat label="Régime" value={t.regime[view.macro.regime]} />
              <Stat label={t.gdp} value={fmtPct(view.macro.gdpGrowth)} />
              <Stat label={t.inflation} value={fmtPct(view.macro.inflation)} />
              <Stat label={t.policyRate} value={fmtPct(view.macro.policyRate, 1)} />
              <Stat label={t.demandIndex} value={fmtDec(view.macro.demandIndex, 2)} />
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold">{t.operations}</h3>
              <Stat label={t.capacity} value={`${fmtInt(view.self.outputCeiling)} u./trim.`} />
              <Stat label={t.staff} value={fmtInt(headcount)} />
              {line && (
                <Stat
                  label={`${t.quality} (${marketName(line.marketId)})`}
                  value={fmtDec(line.quality)}
                />
              )}
              <Stat label={t.brand} value={fmtDec(company.brand)} />
              <Stat label={t.employerBrand} value={fmtDec(company.employerBrand)} />
              <Stat label={t.rating} value={company.credit.rating} />
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold">{t.journal}</h3>
              <EventList view={view} events={view.log.slice(-8).reverse()} showTurn />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
