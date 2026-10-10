import type { RndType } from '@game/engine';
import { Card, NumberField, ProgressBar, Stat } from '../../components/ui';
import { fmtDec, fmtInt, fmtMoney, fmtPct } from '../../i18n/format';
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
  const tech = company.sector === 'tech';
  const listed = Object.values(company.productLines).filter((l) => l.distribution !== undefined);
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
      {listed.length > 0 && (
        <Card title={t.listingFees}>
          <p className="mb-2 text-xs text-slate-500">{t.listingHint}</p>
          {listed.map((line) => (
            <div key={line.id} className="space-y-1 py-1">
              <label className="flex items-center justify-between gap-2 text-sm">
                <span>{marketName(line.marketId)}</span>
                <NumberField
                  ariaLabel={t.listingFees}
                  min={0}
                  value={draft.listing[line.id] ?? 0}
                  onChange={(v) =>
                    edit((d) => {
                      if (!v) d.listing = omit(d.listing, line.id);
                      else d.listing[line.id] = v;
                    })
                  }
                />
              </label>
              <Stat label={t.distribution} value={fmtPct(line.distribution ?? 0)} />
            </div>
          ))}
        </Card>
      )}
      <Card title={t.rnd}>
        <div className="grid gap-6 md:grid-cols-2">
          {RND_TYPES.map((type) => {
            const quote = view.costs?.rnd[type];
            if (!quote) return null;
            const entry = draft.rnd.find((r) => r.type === type);
            const budget = entry?.budget ?? 0;
            const developers = entry?.developers ?? 0;
            return (
              <div key={type} className="space-y-2" data-testid={`rnd-${type}`}>
                <h3 className="font-semibold">
                  {tech ? fr.rndTypesTech[type] : fr.rndTypes[type]}
                </h3>
                <p className="text-xs text-slate-500">
                  {tech ? fr.rndEffectsTech[type] : fr.rndEffects[type]}
                </p>
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
                  <p className="text-sm text-slate-500">
                    {tech ? t.rndNoProjectTech : t.rndNoProject}
                  </p>
                )}
                {tech ? (
                  <Stat label={t.rndEffort} value={fmtInt(quote.effort ?? 0)} />
                ) : (
                  <Stat label={t.rndCost} value={fmtMoney(quote.cost)} />
                )}
                {tech ? (
                  (quote.maxDevelopers ?? 0) > 0 ? (
                    <label className="flex items-center justify-between gap-2 text-sm">
                      <span>
                        {t.rndDevelopers}{' '}
                        <span className="text-slate-500">
                          ({t.rndMax} {fmtInt(quote.maxDevelopers ?? 0)})
                        </span>
                      </span>
                      <NumberField
                        ariaLabel={`${t.rndDevelopers} ${fr.rndTypesTech[type]}`}
                        min={0}
                        value={developers}
                        onChange={(v) =>
                          edit((d) => {
                            d.rnd = d.rnd.filter((r) => r.type !== type);
                            const n = Math.floor(v ?? 0);
                            if (n > 0) d.rnd.push({ type, budget: 0, developers: n });
                          })
                        }
                      />
                    </label>
                  ) : (
                    <p className="text-sm text-slate-500">{t.rndMaxed}</p>
                  )
                ) : quote.maxBudget > 0 ? (
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
        {tech && view.costs?.tech && (
          <p className="mt-3 text-sm text-slate-600">
            {t.rndDevelopersAvailable(view.costs.tech.developers)}
          </p>
        )}
      </Card>
    </div>
  );
}
