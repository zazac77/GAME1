import { PALETTE, SeriesChart } from '../charts/SeriesChart';
import { companyNamer } from '../components/lists';
import { Button, Card, Notice, Stat, Table, Td } from '../components/ui';
import { fmtChange, fmtDec, fmtInt, fmtMoney, fmtPrice } from '../i18n/format';
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
