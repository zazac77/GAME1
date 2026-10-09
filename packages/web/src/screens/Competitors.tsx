import { PALETTE, SeriesChart } from '../charts/SeriesChart';
import { Card, Notice, Stat, Table, Td } from '../components/ui';
import { fmtDec, fmtMoney, fmtPct, fmtPrice, quarterLabel } from '../i18n/format';
import { fr, regionName } from '../i18n/fr';
import { useGame } from '../store/game';

export function Competitors() {
  const view = useGame((s) => s.view);
  if (!view) return null;
  const t = fr.competitors;
  return (
    <div className="space-y-4">
      <Notice severity="info">{t.partialView}</Notice>
      <Card title={t.heading}>
        <Table
          head={['', t.price, t.quality, t.share, t.stockout, t.brand, t.rating, t.sharePrice]}
        >
          {view.competitors.map((c) => {
            const p = c.products[0];
            return (
              <tr key={c.companyId}>
                <Td left>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-slate-500">
                    {fr.status[c.status]} · {regionName(c.hqRegionId)}
                  </div>
                </Td>
                <Td>{p ? fmtPrice(p.price) : '–'}</Td>
                <Td>{p ? fmtDec(p.quality) : '–'}</Td>
                <Td>{p ? fmtPct(p.marketShare) : '–'}</Td>
                <Td>{p?.stockout ? t.yes : t.no}</Td>
                <Td>{fmtDec(c.brand)}</Td>
                <Td>{c.creditRating}</Td>
                <Td>{fmtPrice(view.stock.quotes[c.companyId]?.price ?? 0)}</Td>
              </tr>
            );
          })}
        </Table>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        {view.competitors.map((c, i) => {
          const last = c.published.at(-1);
          return (
            <Card key={c.companyId} title={c.name}>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Stat label={t.ceo} value={c.actorName} />
                  <Stat label={t.hq} value={regionName(c.hqRegionId)} />
                  <Stat
                    label={t.sites}
                    value={c.sites
                      .map(
                        (s) =>
                          `${regionName(s.regionId)} (${s.lines} ${t.lines}${s.status === 'under_construction' ? ', ' + fr.status.under_construction.toLowerCase() : ''})`,
                      )
                      .join(', ')}
                  />
                  <h4 className="mt-3 text-sm font-semibold">
                    {t.published}
                    {last ? ` · ${quarterLabel(last.quarter)}` : ''}
                  </h4>
                  {last ? (
                    <>
                      <Stat label={t.revenue} value={fmtMoney(last.pnl.revenue)} />
                      <Stat label={t.ebitda} value={fmtMoney(last.pnl.ebitda)} />
                      <Stat label={t.netIncome} value={fmtMoney(last.pnl.netIncome)} />
                      <Stat label={t.cash} value={fmtMoney(last.balance.cash)} />
                      <Stat label={t.debt} value={fmtMoney(last.balance.debt)} />
                      <Stat label={t.equity} value={fmtMoney(last.balance.equity)} />
                    </>
                  ) : (
                    <p className="text-sm text-slate-500">{t.noPublished}</p>
                  )}
                </div>
                <div>
                  <h4 className="text-sm font-semibold">{t.sharePrice}</h4>
                  <SeriesChart
                    history={view.history}
                    format={fmtPrice}
                    height={180}
                    series={[
                      {
                        key: `quote.${c.companyId}.price`,
                        label: t.sharePrice,
                        color: PALETTE[(i + 1) % PALETTE.length] ?? '',
                      },
                    ]}
                  />
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
