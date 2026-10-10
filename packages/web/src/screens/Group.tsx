import { useState } from 'react';
import type { ConsolidatedStatements, IntraGroupTransfer, PlayerView } from '@game/engine';
import { companyNamer } from '../components/lists';
import { Button, Card, Kpi, Notice, NumberField, Select, Stat, Table, Td } from '../components/ui';
import { fmtInt, fmtMoney, fmtPct, quarterLabel } from '../i18n/format';
import { fr } from '../i18n/fr';
import { playerCompanyId, useGame } from '../store/game';

type Kind = IntraGroupTransfer['kind'];
const KINDS: Kind[] = ['dividend', 'loan', 'cash_pool', 'stake'];

/**
 * The player's group: companies (who holds them, economic share, figures,
 * intra-group positions), consolidated accounts, intra-group loans, the
 * transfers of the quarter and the creation of a holding company.
 */
export function Group() {
  const view = useGame((s) => s.view);
  const drafts = useGame((s) => s.drafts);
  const game = useGame((s) => s.game);
  const activeCompanyId = useGame((s) => s.activeCompanyId);
  const selectCompany = useGame((s) => s.selectCompany);
  const setManaged = useGame((s) => s.setManaged);
  const navigate = useGame((s) => s.navigate);
  const editGroup = useGame((s) => s.editGroupDraft);
  if (!view || !game) return null;
  const t = fr.group;
  const name = companyNamer(view);
  const companies = view.groupCompanies;
  const rootId = playerCompanyId(game);
  const rootDraft = drafts[rootId];
  const holderName = (id: string) => (id === view.actor.id ? view.actor.name : name(id));
  const running = view.status === 'running';
  const operating = (status: string) => status === 'active' || status === 'distressed';
  const cons = view.consolidated?.at(-1);
  const total = (pick: (c: (typeof companies)[number]) => number) =>
    companies.reduce((s, c) => s + pick(c), 0);

  return (
    <div className="space-y-4">
      <Notice severity="info">{t.intro}</Notice>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label={t.companies} value={String(companies.length)} />
        <Kpi label={fr.dashboard.score} value={fmtMoney(view.score)} />
        <Kpi
          label={t.revenue}
          value={fmtMoney(cons ? cons.pnl.revenue : total((c) => c.revenue))}
        />
        <Kpi
          label={cons ? t.groupNetIncome : t.netIncome}
          value={fmtMoney(
            cons ? cons.pnl.netIncome - cons.minorityNetIncome : total((c) => c.netIncome),
          )}
        />
      </div>
      {!cons && <p className="text-xs text-slate-500">{t.notConsolidated}</p>}
      <Card title={t.heading}>
        <Table
          head={[
            t.company,
            t.parent,
            t.stake,
            t.groupShare,
            t.value,
            t.revenue,
            t.netIncome,
            t.contribution,
            t.cash,
            t.groupLoans,
            t.groupDebt,
            t.runBy,
            '',
          ]}
        >
          {companies.map((c) => {
            const managed = c.isRoot || drafts[c.companyId] !== undefined;
            return (
              <tr key={c.companyId} className={c.companyId === activeCompanyId ? 'bg-sky-50' : ''}>
                <Td left>
                  <div className="font-medium">
                    {c.name}
                    {c.isRoot && <span className="ml-1 text-xs text-slate-500">{t.root}</span>}
                  </div>
                  <div className="text-xs text-slate-500">
                    {fr.sectors[c.sector]} · {fr.status[c.status]} ·{' '}
                    {c.listed ? t.listed : t.unlisted}
                    {c.integrationUntil !== undefined &&
                      ` · ${t.integration(quarterLabel(c.integrationUntil))}`}
                  </div>
                </Td>
                <Td>{holderName(c.parentId)}</Td>
                <Td>{fmtPct(c.stake)}</Td>
                <Td>{fmtPct(c.groupShare)}</Td>
                <Td>{fmtMoney(c.value)}</Td>
                <Td>{fmtMoney(c.revenue)}</Td>
                <Td>{fmtMoney(c.netIncome)}</Td>
                <Td>{fmtMoney(c.contribution)}</Td>
                <Td>{fmtMoney(c.cash)}</Td>
                <Td>{fmtMoney(c.groupLoans)}</Td>
                <Td>{fmtMoney(c.groupDebt)}</Td>
                <Td>{managed ? t.you : t.management}</Td>
                <Td>
                  {operating(c.status) && (
                    <span className="flex justify-end gap-1">
                      {!c.isRoot && running && (
                        <Button onClick={() => setManaged(c.companyId, !managed)}>
                          {managed ? t.delegate : t.takeOver}
                        </Button>
                      )}
                      {c.companyId !== activeCompanyId && (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            selectCompany(c.companyId);
                            navigate('dashboard');
                          }}
                        >
                          {t.open}
                        </Button>
                      )}
                    </span>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
        {companies.length === 1 && <p className="mt-3 text-sm text-slate-500">{t.alone}</p>}
        <div className="mt-3">
          <Button onClick={() => navigate('deals')}>{t.toDeals}</Button>
        </div>
      </Card>

      {cons && <Consolidated cons={cons} />}

      {running && rootDraft && (view.canCreateHolding || rootDraft.createHolding) && (
        <Card title={t.holding}>
          <p className="mb-3 text-sm text-slate-600">{t.holdingHint}</p>
          {rootDraft.createHolding && (
            <div className="mb-3">
              <Notice severity="info">{t.holdingPlanned}</Notice>
            </div>
          )}
          <Button
            variant={rootDraft.createHolding ? 'secondary' : 'primary'}
            onClick={() =>
              editGroup((d) => {
                if (d.createHolding) delete d.createHolding;
                else d.createHolding = true;
              })
            }
          >
            {rootDraft.createHolding ? t.cancelHolding : t.createHolding}
          </Button>
        </Card>
      )}

      <Card title={t.loans}>
        {view.groupLoans.length === 0 ? (
          <p className="text-sm text-slate-500">{t.noLoans}</p>
        ) : (
          <Table head={[t.lender, t.borrower, t.principal, t.rate]}>
            {view.groupLoans.map((l) => (
              <tr key={`${l.lenderId}-${l.borrowerId}`}>
                <Td left>{name(l.lenderId)}</Td>
                <Td>{name(l.borrowerId)}</Td>
                <Td>{fmtMoney(l.principal)}</Td>
                <Td>{fmtPct(l.rate)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {running && rootDraft && companies.length > 1 && (
        <Transfers
          view={view}
          transfers={rootDraft.intraGroup ?? []}
          onChange={(next) =>
            editGroup((d) => {
              if (next.length > 0) d.intraGroup = next;
              else delete d.intraGroup;
            })
          }
        />
      )}
    </div>
  );
}

function Consolidated(props: { cons: ConsolidatedStatements }) {
  const t = fr.group;
  const { pnl, balance, eliminations } = props.cons;
  return (
    <Card title={`${t.consolidated} · ${quarterLabel(props.cons.quarter)}`}>
      <p className="mb-3 text-xs text-slate-500">{t.consolidatedHint}</p>
      <div className="grid gap-6 lg:grid-cols-3">
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">{t.pnl}</h3>
          <Stat label={t.revenue} value={fmtMoney(pnl.revenue)} />
          <Stat label={t.ebitda} value={fmtMoney(pnl.ebitda)} />
          <Stat label={t.financial} value={fmtMoney(pnl.financial)} />
          <Stat label={t.netIncome} value={fmtMoney(pnl.netIncome)} />
          <Stat label={t.minorityNetIncome} value={fmtMoney(props.cons.minorityNetIncome)} />
          <Stat
            label={t.groupNetIncome}
            value={fmtMoney(pnl.netIncome - props.cons.minorityNetIncome)}
            strong
          />
        </div>
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">{t.balance}</h3>
          <Stat label={t.cash} value={fmtMoney(balance.cash)} />
          <Stat label={t.inventory} value={fmtMoney(balance.inventory)} />
          <Stat label={t.fixedAssets} value={fmtMoney(balance.fixedAssets)} />
          <Stat label={t.financialAssets} value={fmtMoney(balance.financialAssets)} />
          <Stat label={t.debt} value={fmtMoney(balance.debt)} />
          <Stat label={t.groupEquity} value={fmtMoney(balance.equity)} strong />
          <Stat label={t.minorities} value={fmtMoney(balance.minorityInterests)} />
        </div>
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">{t.eliminations}</h3>
          <Stat label={t.elimLoans} value={fmtMoney(eliminations.loans)} />
          <Stat label={t.elimStakes} value={fmtMoney(eliminations.stakes)} />
          <Stat label={t.elimFinancial} value={fmtMoney(eliminations.financial)} />
        </div>
      </div>
    </Card>
  );
}

function Transfers(props: {
  view: PlayerView;
  transfers: IntraGroupTransfer[];
  onChange: (next: IntraGroupTransfer[]) => void;
}) {
  const t = fr.group;
  const { view, transfers } = props;
  const name = companyNamer(view);
  const ids = view.groupCompanies
    .filter((c) => c.status === 'active' || c.status === 'distressed')
    .map((c) => c.companyId);
  const options = ids.map((id) => ({ value: id, label: name(id) }));
  const [kind, setKind] = useState<Kind>('loan');
  const [fromId, setFrom] = useState(ids[1] ?? ids[0] ?? '');
  const [toId, setTo] = useState(ids[0] ?? '');
  const [amount, setAmount] = useState<number | undefined>(1_000_000);
  const stakes = view.groupCompanies.find((c) => c.companyId === fromId)?.stakes ?? [];
  const [targetId, setTarget] = useState('');
  const [shares, setShares] = useState<number | undefined>(undefined);
  const target = stakes.find((s) => s.targetId === targetId) ?? stakes[0];

  const describe = (x: IntraGroupTransfer): string =>
    x.kind === 'stake'
      ? t.transferText.stake(
          name(x.fromId),
          name(x.toId),
          x.shares !== undefined ? fmtInt(x.shares) : t.allShares,
          name(x.targetId),
        )
      : t.transferText[x.kind](name(x.fromId), name(x.toId), fmtMoney(x.amount));

  const add = () => {
    if (!fromId || !toId || fromId === toId) return;
    let next: IntraGroupTransfer;
    if (kind === 'stake') {
      if (!target) return;
      next = { kind, fromId, toId, targetId: target.targetId };
      if (shares !== undefined && shares > 0) next.shares = Math.floor(shares);
    } else {
      if (amount === undefined || amount < 0) return;
      next = { kind, fromId, toId, amount };
    }
    props.onChange([...transfers, next]);
  };

  return (
    <Card title={t.transfers}>
      <p className="mb-3 text-xs text-slate-500">{t.transfersHint}</p>
      {transfers.length === 0 ? (
        <p className="mb-3 text-sm text-slate-500">{t.noTransfers}</p>
      ) : (
        <ul className="mb-3 space-y-1 text-sm">
          {transfers.map((x, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1"
            >
              <span>{describe(x)}</span>
              <Button
                variant="ghost"
                onClick={() => props.onChange(transfers.filter((_, j) => j !== i))}
              >
                {t.remove}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">{t.kind}</span>
          <Select
            value={kind}
            options={KINDS.map((k) => ({ value: k, label: t.kinds[k] }))}
            onChange={setKind}
            ariaLabel={t.kind}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">{t.from}</span>
          <Select value={fromId} options={options} onChange={setFrom} ariaLabel={t.from} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">{t.to}</span>
          <Select value={toId} options={options} onChange={setTo} ariaLabel={t.to} />
        </label>
        {kind === 'stake' ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500">{t.target}</span>
              <Select
                value={target?.targetId ?? ''}
                options={stakes.map((s) => ({ value: s.targetId, label: name(s.targetId) }))}
                onChange={setTarget}
                ariaLabel={t.target}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500">{t.shares}</span>
              <NumberField
                value={shares}
                onChange={setShares}
                allowEmpty
                min={0}
                placeholder={t.allShares}
                ariaLabel={t.shares}
              />
            </label>
          </>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">{t.amount}</span>
            <NumberField value={amount} onChange={setAmount} min={0} ariaLabel={t.amount} />
          </label>
        )}
        <Button variant="primary" onClick={add}>
          {t.add}
        </Button>
      </div>
    </Card>
  );
}
