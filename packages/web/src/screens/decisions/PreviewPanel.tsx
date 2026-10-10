import { IssueList } from '../../components/lists';
import { Card, Notice, Stat } from '../../components/ui';
import { fmtInt, fmtMoney } from '../../i18n/format';
import { fr } from '../../i18n/fr';
import { useGame } from '../../store/game';

export function PreviewPanel() {
  const view = useGame((s) => s.view);
  const preview = useGame((s) => s.preview);
  if (!view || !preview) return null;
  const p = preview.companies[view.companyId];
  const t = fr.decisions;
  return (
    <div className="space-y-3 xl:sticky xl:top-16 xl:self-start">
      <Card title={t.preview}>
        {p && (
          <div data-testid="preview">
            {p.expectedUsers !== undefined ? (
              <>
                <Stat label={t.serviceCeiling} value={fmtInt(p.outputCeiling)} />
                <Stat label={t.expectedBilled} value={fmtInt(p.expectedUnitsSold)} />
                <Stat label={t.expectedUsers} value={fmtInt(p.expectedUsers)} />
              </>
            ) : (
              <>
                <Stat label={t.outputCeiling} value={fmtInt(p.outputCeiling)} />
                <Stat label={t.plannedOutput} value={fmtInt(p.plannedOutput)} />
                <Stat label={t.expectedDemand} value={fmtInt(p.expectedDemand)} />
                <Stat label={t.expectedSold} value={fmtInt(p.expectedUnitsSold)} />
              </>
            )}
            <Stat label={t.expectedRevenue} value={fmtMoney(p.expectedRevenue)} strong />
            <Stat label={t.expectedEbitda} value={fmtMoney(p.expectedEbitda)} strong />
            <details className="my-2 text-sm">
              <summary className="cursor-pointer text-slate-600">{t.costs}</summary>
              <div className="pl-2">
                {(Object.keys(p.costs) as (keyof typeof p.costs)[]).map((k) => (
                  <Stat key={k} label={fr.costs[k]} value={fmtMoney(p.costs[k])} />
                ))}
              </div>
            </details>
            {p.capex > 0 && <Stat label={t.capexTotal} value={fmtMoney(p.capex)} />}
            {p.disposals > 0 && <Stat label={t.disposals} value={fmtMoney(p.disposals)} />}
            {p.borrowing > 0 && <Stat label={t.borrowing} value={fmtMoney(p.borrowing)} />}
            {p.repayment > 0 && <Stat label={t.repayment} value={fmtMoney(p.repayment)} />}
            {p.installments > 0 && <Stat label={t.installments} value={fmtMoney(p.installments)} />}
            {p.equity !== 0 && <Stat label={t.equityFlows} value={fmtMoney(p.equity)} />}
            {p.mnaCosts > 0 && <Stat label={t.mnaCosts} value={fmtMoney(p.mnaCosts)} />}
            {p.acquisitions > 0 && <Stat label={t.acquisitions} value={fmtMoney(p.acquisitions)} />}
            {p.acquisitionDebt > 0 && (
              <Stat label={t.acquisitionDebt} value={fmtMoney(p.acquisitionDebt)} />
            )}
            <Stat label={t.expectedCash} value={fmtMoney(p.expectedCashEnd)} strong />
            {p.overdraftRisk && (
              <div className="mt-2">
                <Notice severity="critical">{t.overdraftRisk}</Notice>
              </div>
            )}
          </div>
        )}
      </Card>
      <Card title={t.issues}>
        <IssueList issues={preview.issues.filter((i) => i.companyId === view.companyId)} />
      </Card>
    </div>
  );
}
