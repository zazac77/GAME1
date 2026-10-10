import { Card, NumberField, Select, Stat, Table, Td } from '../../components/ui';
import { fmtInt, fmtMoney, fmtPct, fmtPrice, quarterLabel } from '../../i18n/format';
import { fr } from '../../i18n/fr';
import { useGame } from '../../store/game';

export function FinanceTab() {
  const view = useGame((s) => s.view);
  const draft = useGame((s) => s.draft);
  const edit = useGame((s) => s.editDraft);
  if (!view || !draft) return null;
  const t = fr.decisions;
  const company = view.self.company;
  const { balance } = company.books.current;
  const listed = view.competitors.filter(
    (c) => c.listed && (c.status === 'active' || c.status === 'distressed'),
  );

  const setOrder = (
    targetId: string,
    patch: { side?: 'buy' | 'sell'; shares?: number; limitPrice?: number },
  ) =>
    edit((d) => {
      const current = d.stockOrders.find((o) => o.targetId === targetId);
      const side = patch.side ?? current?.side ?? 'buy';
      const shares = patch.shares ?? current?.shares ?? 0;
      const limitPrice = 'limitPrice' in patch ? patch.limitPrice : current?.limitPrice;
      d.stockOrders = d.stockOrders.filter((o) => o.targetId !== targetId);
      if (shares > 0) {
        d.stockOrders.push(
          limitPrice === undefined
            ? { targetId, side, shares }
            : { targetId, side, shares, limitPrice },
        );
      }
    });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t.loans}>
          <Stat label={fr.app.cash} value={fmtMoney(balance.cash)} />
          <Stat label={t.debt} value={fmtMoney(balance.debt)} />
          <Stat label={t.rating} value={company.credit.rating} />
          <Stat
            label={t.covenant}
            value={company.credit.covenantBreached ? t.covenantBreached : t.covenantOk}
          />
          <Stat label={t.borrowingCapacity} value={fmtMoney(view.self.borrowingCapacity)} strong />
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <label className="space-y-1">
              <span className="block text-slate-600">{t.borrow}</span>
              <NumberField
                ariaLabel={t.borrow}
                min={0}
                value={draft.finance.borrow ?? 0}
                onChange={(v) =>
                  edit((d) => {
                    if (!v) delete d.finance.borrow;
                    else d.finance.borrow = v;
                  })
                }
              />
            </label>
            <label className="space-y-1">
              <span className="block text-slate-600">{t.repay}</span>
              <NumberField
                ariaLabel={t.repay}
                min={0}
                value={draft.finance.repay ?? 0}
                onChange={(v) =>
                  edit((d) => {
                    if (!v) delete d.finance.repay;
                    else d.finance.repay = v;
                  })
                }
              />
            </label>
          </div>
        </Card>
        <Card title={t.loans}>
          {company.loans.length === 0 ? (
            <p className="text-sm text-slate-500">{t.noLoans}</p>
          ) : (
            <Table head={['', t.principal, t.spread, t.maturity]}>
              {company.loans.map((l) => (
                <tr key={l.id}>
                  <Td left>{l.kind === 'overdraft' ? 'Découvert' : 'Prêt'}</Td>
                  <Td>{fmtMoney(l.principal)}</Td>
                  <Td>{fmtPct(l.spread, 1)}</Td>
                  <Td>{l.kind === 'term' ? quarterLabel(l.maturity) : '–'}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      <CapitalCard />
      <Card title={t.stockOrders}>
        <p className="mb-2 text-sm text-slate-600">{fr.bourse.orderHint}</p>
        <Table
          head={[
            fr.bourse.company,
            fr.bourse.price,
            fr.bourse.float,
            t.held,
            t.side,
            t.shares,
            t.limitPrice,
          ]}
        >
          {listed.map((c) => {
            const order = draft.stockOrders.find((o) => o.targetId === c.companyId);
            return (
              <tr key={c.companyId}>
                <Td left>{c.name}</Td>
                <Td>{fmtPrice(view.stock.quotes[c.companyId]?.price ?? 0)}</Td>
                <Td>{fmtInt(view.stock.float[c.companyId] ?? 0)}</Td>
                <Td>{fmtInt(view.stock.holdings[c.companyId] ?? 0)}</Td>
                <Td>
                  <Select
                    ariaLabel={t.side}
                    value={order?.side ?? 'buy'}
                    options={[
                      { value: 'buy', label: t.buy },
                      { value: 'sell', label: t.sell },
                    ]}
                    onChange={(side) => setOrder(c.companyId, { side })}
                  />
                </Td>
                <Td>
                  <NumberField
                    ariaLabel={`${t.shares} ${c.name}`}
                    min={0}
                    value={order?.shares ?? 0}
                    onChange={(v) => setOrder(c.companyId, { shares: Math.floor(v ?? 0) })}
                  />
                </Td>
                <Td>
                  <NumberField
                    ariaLabel={`${t.limitPrice} ${c.name}`}
                    allowEmpty
                    min={0}
                    className="w-24"
                    placeholder="—"
                    value={order?.limitPrice}
                    onChange={(v) => setOrder(c.companyId, { limitPrice: v })}
                  />
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </div>
  );
}

/** Equity transactions: dividend, capital increase, buyback, public offering. */
function CapitalCard() {
  const view = useGame((s) => s.view);
  const draft = useGame((s) => s.draft);
  const edit = useGame((s) => s.editDraft);
  const quotes = view?.costs?.capital;
  if (!view || !draft || !quotes) return null;
  const t = fr.capital;
  const company = view.self.company;
  const setFinance = (key: 'dividend' | 'issueShares' | 'buyback', v: number | undefined) =>
    edit((d) => {
      const x = key === 'dividend' ? (v ?? 0) : Math.floor(v ?? 0);
      const rest = Object.fromEntries(
        Object.entries(d.finance).filter(([k]) => k !== key),
      ) as typeof d.finance;
      d.finance = x > 0 ? { ...rest, [key]: x } : rest;
    });
  return (
    <Card title={t.heading}>
      <div className="grid gap-x-8 gap-y-3 text-sm md:grid-cols-2">
        <label className="flex items-center justify-between gap-2">
          <span>
            {t.dividend}{' '}
            <span className="text-slate-500">(max {fmtMoney(quotes.maxDividend)})</span>
          </span>
          <NumberField
            ariaLabel={t.dividend}
            min={0}
            value={draft.finance.dividend ?? 0}
            onChange={(v) => setFinance('dividend', v)}
          />
        </label>
        {company.listed ? (
          <>
            <label className="flex items-center justify-between gap-2">
              <span>
                {t.issue}{' '}
                <span className="text-slate-500">
                  ({t.atPrice(fmtPrice(quotes.issuePrice))}, max {fmtInt(quotes.maxIssue)})
                </span>
              </span>
              <NumberField
                ariaLabel={t.issue}
                min={0}
                value={draft.finance.issueShares ?? 0}
                onChange={(v) => setFinance('issueShares', v)}
              />
            </label>
            <label className="flex items-center justify-between gap-2">
              <span>
                {t.buyback}{' '}
                <span className="text-slate-500">
                  ({t.atPrice(fmtPrice(quotes.buybackPrice))}, max {fmtInt(quotes.maxBuyback)})
                </span>
              </span>
              <NumberField
                ariaLabel={t.buyback}
                min={0}
                value={draft.finance.buyback ?? 0}
                onChange={(v) => setFinance('buyback', v)}
              />
            </label>
          </>
        ) : quotes.ipo ? (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.finance.ipo === true}
              onChange={(e) =>
                edit((d) => {
                  if (e.target.checked) d.finance.ipo = true;
                  else delete d.finance.ipo;
                })
              }
            />
            <span>
              {t.ipo(
                fmtInt(quotes.ipo.newShares),
                fmtPrice(quotes.ipo.pricePerShare),
                fmtMoney(quotes.ipo.proceeds),
              )}
            </span>
          </label>
        ) : (
          <p className="text-slate-500">{t.ipoUnavailable}</p>
        )}
      </div>
      <p className="mt-3 text-xs text-slate-500">{t.hint}</p>
    </Card>
  );
}
