import type { RndType } from '@game/engine';
import { Card, NumberField, ProgressBar, Stat } from '../../components/ui';
import { fmtDec, fmtMoney, fmtPct } from '../../i18n/format';
import { fr, marketName } from '../../i18n/fr';
import { omit } from '../../store/draft';
import { useGame } from '../../store/game';

const RND_TYPES: RndType[] = ['process', 'product'];

export function MarketingTab() {
  const view = useGame((s) => s.view);
  const draft = useGame((s) => s.draft);
  const edit = useGame((s) => s.editDraft);
  if (!view || !draft) return null;
  const t = fr.decisions;
  const company = view.self.company;
  return (
    <div className="space-y-4">
      <Card title={t.marketingBudget}>
        {Object.values(company.productLines).map((line) => (
          <label key={line.id} className="flex items-center justify-between gap-2 py-1 text-sm">
            <span>{marketName(line.marketId)}</span>
            <NumberField
              ariaLabel={t.marketingBudget}
              min={0}
              value={draft.marketing[line.id] ?? 0}
              onChange={(v) =>
                edit((d) => {
                  if (!v) d.marketing = omit(d.marketing, line.id);
                  else d.marketing[line.id] = v;
                })
              }
            />
          </label>
        ))}
        <Stat label={t.brand} value={fmtDec(company.brand)} />
      </Card>
      <Card title={t.rnd}>
        <div className="grid gap-6 md:grid-cols-2">
          {RND_TYPES.map((type) => {
            const quote = view.costs?.rnd[type];
            if (!quote) return null;
            const budget = draft.rnd.find((r) => r.type === type)?.budget ?? 0;
            return (
              <div key={type} className="space-y-2" data-testid={`rnd-${type}`}>
                <h3 className="font-semibold">{fr.rndTypes[type]}</h3>
                <p className="text-xs text-slate-500">{fr.rndEffects[type]}</p>
                <Stat
                  label={t.rndLevel}
                  value={`${fmtDec(quote.level, 2)} / ${fmtDec(quote.maxLevel)}`}
                />
                {quote.projectId ? (
                  <>
                    <Stat label={t.rndProject} value={quote.projectId} />
                    <Stat label={t.rndProgress} value={fmtPct(quote.progress)} />
                    <ProgressBar value={quote.progress} />
                  </>
                ) : (
                  <p className="text-sm text-slate-500">{t.rndNoProject}</p>
                )}
                <Stat label={t.rndCost} value={fmtMoney(quote.cost)} />
                {quote.maxBudget > 0 ? (
                  <label className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      {t.rndBudget}{' '}
                      <span className="text-slate-500">
                        ({t.rndMax} {fmtMoney(quote.maxBudget)})
                      </span>
                    </span>
                    <NumberField
                      ariaLabel={`${t.rndBudget} ${fr.rndTypes[type]}`}
                      min={0}
                      value={budget}
                      onChange={(v) =>
                        edit((d) => {
                          d.rnd = d.rnd.filter((r) => r.type !== type);
                          if (v) d.rnd.push({ type, budget: v });
                        })
                      }
                    />
                  </label>
                ) : (
                  <p className="text-sm text-slate-500">{t.rndMaxed}</p>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
