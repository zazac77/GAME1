import { PALETTE, SeriesChart } from '../charts/SeriesChart';
import type { CompetitorView, IntelReport, PlayerView } from '@game/engine';
import { Button, Card, Notice, Stat, Table, Td } from '../components/ui';
import { fmtDec, fmtInt, fmtMoney, fmtPct, fmtPrice, quarterLabel } from '../i18n/format';
import { commodityName, fr, occupationName, regionName } from '../i18n/fr';
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
                  <Stat
                    label={t.jobOffers}
                    value={
                      c.jobOffers
                        .map(
                          (o) =>
                            `${occupationName(o.occupationId)} (${regionName(o.regionId)}) ${fmtMoney(o.wage)}`,
                        )
                        .join(', ') || t.noJobOffers
                    }
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
                  <Espionage view={view} competitor={c} />
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

/** Espionage on a competitor (option of the game): the order of the quarter and the last report. */
function Espionage({ view, competitor }: { view: PlayerView; competitor: CompetitorView }) {
  const draft = useGame((s) => s.draft);
  const edit = useGame((s) => s.editDraft);
  const quote = view.costs?.espionage;
  const report = view.intel.filter((r) => r.targetId === competitor.companyId).at(-1);
  if (!quote && !report) return null;
  const t = fr.competitors;
  const ordered = draft?.espionage?.some((o) => o.targetId === competitor.companyId) ?? false;
  const operating = competitor.status === 'active' || competitor.status === 'distressed';
  const canOrder =
    quote !== undefined &&
    operating &&
    view.status === 'running' &&
    (draft?.espionage?.length ?? 0) < quote.maxPerQuarter;
  return (
    <div className="mb-4 space-y-2 rounded border border-slate-200 p-2">
      <h4 className="text-sm font-semibold">{t.espionage}</h4>
      {quote && draft && (
        <div className="space-y-1 text-sm">
          {ordered ? (
            <div className="flex items-center gap-2">
              <span>{t.spyPlanned}</span>
              <Button
                variant="ghost"
                onClick={() =>
                  edit((d) => {
                    d.espionage = (d.espionage ?? []).filter(
                      (o) => o.targetId !== competitor.companyId,
                    );
                    if (d.espionage.length === 0) delete d.espionage;
                  })
                }
              >
                {t.cancelSpy}
              </Button>
            </div>
          ) : (
            <Button
              disabled={!canOrder}
              onClick={() =>
                edit((d) => {
                  d.espionage = [...(d.espionage ?? []), { targetId: competitor.companyId }];
                })
              }
            >
              {t.spy(fmtMoney(quote.cost))}
            </Button>
          )}
          <p className="text-xs text-slate-500">
            {t.spyHint(
              fmtPct(quote.successProbability, 0),
              fmtPct(quote.detectionProbability, 0),
              fmtMoney(quote.fine),
            )}
          </p>
        </div>
      )}
      {report ? (
        <IntelDetails report={report} />
      ) : (
        <p className="text-xs text-slate-500">{t.noIntel}</p>
      )}
    </div>
  );
}

function IntelDetails({ report }: { report: IntelReport }) {
  const t = fr.competitors;
  const s = report.statements;
  return (
    <div className="text-sm">
      <h5 className="font-medium">{t.intelOf(quarterLabel(report.turn))}</h5>
      <Stat label={t.intelCash} value={fmtMoney(report.cash)} />
      <Stat label={t.intelDebt} value={fmtMoney(report.debt)} />
      {s && (
        <>
          <div className="mt-1 text-xs text-slate-500">
            {t.intelStatements(quarterLabel(s.quarter))}
          </div>
          <Stat label={t.revenue} value={fmtMoney(s.pnl.revenue)} />
          <Stat label={t.ebitda} value={fmtMoney(s.pnl.ebitda)} />
          <Stat label={t.netIncome} value={fmtMoney(s.pnl.netIncome)} />
        </>
      )}
      <Stat
        label={t.intelLines}
        value={report.lines
          .map((l) => `${fmtPrice(l.price)} · ${fmtDec(l.quality)} · ${fmtDec(l.qualityTarget)}`)
          .join(' ; ')}
      />
      <Stat
        label={t.intelStaff}
        value={report.workforce
          .filter((w) => w.headcount > 0)
          .map((w) => {
            const [regionId, occupationId] = w.key.split(':');
            return `${occupationName(occupationId)} (${regionName(regionId)}) ${fmtInt(w.headcount)} · ${fmtMoney(w.wage)}`;
          })
          .join(', ')}
      />
      <Stat
        label={t.intelStock}
        value={Object.entries(report.inventory)
          .filter(([, qty]) => qty > 0)
          .map(
            ([id, qty]) =>
              `${report.lines.some((l) => l.lineId === id) ? t.intelFinished : commodityName(id)} ${fmtInt(qty)}`,
          )
          .join(', ')}
      />
      {report.rnd.length > 0 && (
        <Stat
          label={t.intelRnd}
          value={report.rnd
            .map((p) => `${fr.rndTypes[p.type]} ${fmtPct(p.progress, 0)}`)
            .join(', ')}
        />
      )}
    </div>
  );
}
