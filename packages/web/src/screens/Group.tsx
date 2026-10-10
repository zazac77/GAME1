import { companyNamer } from '../components/lists';
import { Button, Card, Kpi, Notice, Table, Td } from '../components/ui';
import { fmtMoney, fmtPct, quarterLabel } from '../i18n/format';
import { fr } from '../i18n/fr';
import { useGame } from '../store/game';

/** The player's group (simple version): its companies, who runs them, their figures. */
export function Group() {
  const view = useGame((s) => s.view);
  const drafts = useGame((s) => s.drafts);
  const activeCompanyId = useGame((s) => s.activeCompanyId);
  const selectCompany = useGame((s) => s.selectCompany);
  const setManaged = useGame((s) => s.setManaged);
  const navigate = useGame((s) => s.navigate);
  if (!view) return null;
  const t = fr.group;
  const name = companyNamer(view);
  const companies = view.groupCompanies;
  const holderName = (id: string) => (id === view.actor.id ? view.actor.name : name(id));
  const running = view.status === 'running';
  const operating = (status: string) => status === 'active' || status === 'distressed';
  const total = (pick: (c: (typeof companies)[number]) => number) =>
    companies.reduce((s, c) => s + pick(c), 0);

  return (
    <div className="space-y-4">
      <Notice severity="info">{t.intro}</Notice>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label={t.companies} value={String(companies.length)} />
        <Kpi label={t.value} value={fmtMoney(total((c) => c.value))} />
        <Kpi label={t.revenue} value={fmtMoney(total((c) => c.revenue))} />
        <Kpi label={t.netIncome} value={fmtMoney(total((c) => c.netIncome))} />
      </div>
      <p className="text-xs text-slate-500">{t.notConsolidated}</p>
      <Card title={t.heading}>
        <Table
          head={[
            t.company,
            t.parent,
            t.stake,
            t.value,
            t.cost,
            t.revenue,
            t.netIncome,
            t.cash,
            t.equity,
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
                <Td>{c.isRoot ? '–' : holderName(c.parentId)}</Td>
                <Td>{fmtPct(c.stake)}</Td>
                <Td>{fmtMoney(c.value)}</Td>
                <Td>{c.cost !== undefined ? fmtMoney(c.cost) : '–'}</Td>
                <Td>{fmtMoney(c.revenue)}</Td>
                <Td>{fmtMoney(c.netIncome)}</Td>
                <Td>{fmtMoney(c.cash)}</Td>
                <Td>{fmtMoney(c.equity)}</Td>
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
    </div>
  );
}
