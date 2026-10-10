import { PALETTE, SeriesChart } from '../charts/SeriesChart';
import { companyNamer } from '../components/lists';
import { Button, Card, Notice, Stat, Table, Td } from '../components/ui';
import {
  fmtChange,
  fmtDec,
  fmtInt,
  fmtMoney,
  fmtPct,
  fmtPrice,
  quarterLabel,
} from '../i18n/format';
import { fr } from '../i18n/fr';
import { useGame } from '../store/game';

export function Bourse() {
  const view = useGame((s) => s.view);
  const navigate = useGame((s) => s.navigate);
  if (!view) return null;
  const t = fr.bourse;
  const name = companyNamer(view);
  const quotes = Object.entries(view.stock.quotes).sort(([a], [b]) => a.localeCompare(b));
  const index = view.stock.index;
  const indexBefore = index.history.at(-2);
  const own = view.companyId;
  const holdings = Object.entries(view.stock.holdings);
  // Declared stakes, founders and controlling holders of their own company left aside.
  const founders = new Set(view.competitors.flatMap((c) => (c.actorId ? [c.actorId] : [])));
  founders.add(view.actor.id);
  const declared = Object.entries(view.stock.declared)
    .flatMap(([targetId, levels]) =>
      Object.entries(levels).map(([holderId, level]) => ({ targetId, holderId, level })),
    )
    .filter(
      (d) =>
        !(
          founders.has(d.holderId) &&
          (view.competitors.find((c) => c.companyId === d.targetId)?.actorId === d.holderId ||
            (d.holderId === view.actor.id && d.targetId === view.actor.rootCompanyId))
        ),
    );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t.index}>
          <div className="text-3xl font-semibold tabular-nums">{fmtDec(index.value, 1)}</div>
          {indexBefore !== undefined && (
            <div className="text-sm text-slate-500">{fmtChange(index.value / indexBefore - 1)}</div>
          )}
          <SeriesChart
            history={view.history}
            format={(x) => fmtInt(x)}
            height={160}
            series={[{ key: 'stock.index', label: t.index, color: PALETTE[0] ?? '' }]}
          />
        </Card>
        <Card title={t.holdings} className="lg:col-span-2">
          <Stat label={t.ownStake} value={fmtMoney(view.score)} strong />
          {holdings.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">{t.noHoldings}</p>
          ) : (
            <Table head={[t.company, fr.decisions.held, t.price, t.value]} className="mt-2">
              {holdings.map(([id, n]) => {
                const price = view.stock.quotes[id]?.price ?? 0;
                return (
                  <tr key={id}>
                    <Td left>{name(id)}</Td>
                    <Td>{fmtInt(n)}</Td>
                    <Td>{fmtPrice(price)}</Td>
                    <Td>{fmtMoney(n * price)}</Td>
                  </tr>
                );
              })}
            </Table>
          )}
          <div className="mt-3">
            <Notice severity="info">{t.orderHint}</Notice>
            <Button className="mt-2" onClick={() => navigate('decisions')}>
              {t.order}
            </Button>
          </div>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t.declared}>
          {declared.length === 0 ? (
            <p className="text-sm text-slate-500">{t.noDeclared}</p>
          ) : (
            <Table head={[t.company, t.holder, t.level]}>
              {declared.map((d) => (
                <tr key={`${d.targetId}-${d.holderId}`}>
                  <Td left>{name(d.targetId)}</Td>
                  <Td>{name(d.holderId)}</Td>
                  <Td>{fmtPct(d.level, 0)}</Td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-2 text-xs text-slate-500">{t.declaredHint}</p>
        </Card>
        {view.stock.campaigns.length > 0 && (
          <Card title={t.campaigns}>
            <ul className="space-y-1 text-sm">
              {view.stock.campaigns.map((c) => (
                <li key={`${c.fundId}-${c.targetId}`}>
                  <span className="font-medium">{name(c.targetId)}</span> :{' '}
                  {t.campaign(name(c.fundId), t.demands[c.demand])}{' '}
                  <span className="text-slate-500">
                    ({t.since} {quarterLabel(c.since)})
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      <Card title={t.quotes}>
        <Table head={[t.company, t.price, t.change, t.fundamental, t.float]}>
          {quotes.map(([id, q]) => {
            const before = q.history.at(-2);
            const float = view.stock.float[id] ?? 0;
            return (
              <tr key={id} className={id === own ? 'bg-sky-50' : ''}>
                <Td left>
                  {name(id)} {id === own && <span className="text-xs text-slate-500">{t.you}</span>}
                </Td>
                <Td>{fmtPrice(q.price)}</Td>
                <Td>{before ? fmtChange(q.price / before - 1) : '–'}</Td>
                <Td>{fmtPrice(q.fundamental)}</Td>
                <Td>{fmtInt(float)}</Td>
              </tr>
            );
          })}
        </Table>
        <div className="mt-4">
          <SeriesChart
            history={view.history}
            format={fmtPrice}
            series={quotes.map(([id], i) => ({
              key: `quote.${id}.price`,
              label: name(id),
              color: PALETTE[i % PALETTE.length] ?? '',
            }))}
          />
        </div>
      </Card>
    </div>
  );
}
