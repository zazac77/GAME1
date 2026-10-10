import { Card, Notice, NumberField, Stat, Table, Td } from '../../components/ui';
import { fmtDec, fmtInt, fmtPct, fmtPrice } from '../../i18n/format';
import { fr, marketName, regionName } from '../../i18n/fr';
import { omit } from '../../store/draft';
import { useGame } from '../../store/game';

export function ProductionTab() {
  const view = useGame((s) => s.view);
  const draft = useGame((s) => s.draft);
  const edit = useGame((s) => s.editDraft);
  if (!view || !draft) return null;
  const t = fr.decisions;
  const company = view.self.company;
  const tech = company.sector === 'tech';
  const factories = view.self.sites.filter(
    (s) => s.status === 'operational' && company.sites[s.siteId]?.kind === 'factory',
  );
  return (
    <div className="space-y-4">
      {Object.values(company.productLines).map((line) => {
        const market = view.productMarkets[line.marketId];
        const entry = draft.pricing[line.id];
        const price = entry?.price ?? line.price;
        const qualityTarget = entry?.qualityTarget ?? line.qualityTarget;
        const setEntry = (patch: { price?: number; qualityTarget?: number }) =>
          edit((d) => {
            d.pricing[line.id] = {
              price: d.pricing[line.id]?.price ?? line.price,
              qualityTarget: d.pricing[line.id]?.qualityTarget ?? line.qualityTarget,
              ...patch,
            };
          });
        return (
          <Card key={line.id} title={`${t.product} · ${marketName(line.marketId)}`}>
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-3">
                <label className="flex items-center justify-between gap-2 text-sm">
                  <span>{t.price}</span>
                  <NumberField
                    ariaLabel={t.price}
                    value={price}
                    min={0.01}
                    onChange={(v) => v !== undefined && setEntry({ price: v })}
                  />
                </label>
                {!tech && (
                  <label className="block space-y-1 text-sm">
                    <span className="flex justify-between">
                      <span>{t.qualityTarget}</span>
                      <span className="tabular-nums">{fmtDec(qualityTarget)}</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={qualityTarget}
                      aria-label={t.qualityTarget}
                      className="w-full"
                      onChange={(e) => setEntry({ qualityTarget: Number(e.target.value) })}
                    />
                    <span className="block text-xs text-slate-500">{t.qualityHint}</span>
                  </label>
                )}
                {tech && <p className="text-xs text-slate-500">{t.techPriceHint}</p>}
              </div>
              <div>
                <Stat
                  label={t.refPrice}
                  value={fmtPrice((market?.refPrice ?? 0) * view.macro.priceLevel)}
                />
                <Stat label={t.marketAvg} value={fmtPrice(market?.lastResult.avgPrice ?? 0)} />
                <Stat label={t.quality} value={fmtDec(line.quality)} />
                {tech ? (
                  <>
                    <Stat label={t.users} value={fmtInt(line.users ?? 0)} />
                    <Stat label={t.acquired} value={fmtInt(line.acquired ?? 0)} />
                    <Stat label={t.churn} value={fmtPct(line.churn ?? 0)} />
                    <Stat
                      label={t.techVsFrontier}
                      value={`${fmtDec(line.techLevel ?? 0, 2)} / ${fmtDec(market?.techFrontier ?? 0, 2)}`}
                    />
                  </>
                ) : (
                  <Stat label={t.stock} value={fmtInt(company.inventory[line.id]?.qty ?? 0)} />
                )}
                {line.distribution !== undefined && (
                  <Stat label={t.distribution} value={fmtPct(line.distribution)} />
                )}
              </div>
            </div>
          </Card>
        );
      })}
      {tech ? (
        <Notice severity="info">{t.techNoProduction}</Notice>
      ) : (
        <Card title={t.sites}>
          <Table head={[t.site, t.capacity, t.ceiling, t.targetOutput]}>
            {factories.map((s) => (
              <tr key={s.siteId}>
                <Td left>{regionName(s.regionId)}</Td>
                <Td>{fmtInt(s.capacity)}</Td>
                <Td>{fmtInt(s.ceiling)}</Td>
                <Td>
                  <NumberField
                    ariaLabel={t.targetOutput}
                    allowEmpty
                    min={0}
                    placeholder={t.fullCapacity}
                    value={draft.production[s.siteId]?.targetOutput}
                    onChange={(v) =>
                      edit((d) => {
                        if (v === undefined) d.production = omit(d.production, s.siteId);
                        else d.production[s.siteId] = { targetOutput: v };
                      })
                    }
                  />
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
