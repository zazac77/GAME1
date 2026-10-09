import type { HrDecision, LaborPoolKey } from '@game/engine';
import { useState } from 'react';
import { Button, Card, NumberField, Select, Stat, Table, Td } from '../../components/ui';
import { fmtDec, fmtInt, fmtMoney } from '../../i18n/format';
import { fr, occupationName, regionName } from '../../i18n/fr';
import { useGame } from '../../store/game';

const poolKey = (regionId: string, occupationId: string) =>
  `${regionId}:${occupationId}` as LaborPoolKey;

export function HrTab() {
  const view = useGame((s) => s.view);
  const draft = useGame((s) => s.draft);
  const edit = useGame((s) => s.editDraft);
  const [newGroup, setNewGroup] = useState('');
  if (!view || !draft) return null;
  const t = fr.decisions;
  const company = view.self.company;
  const occupations = view.config.labor.occupations;

  const update = (i: number, patch: Partial<HrDecision>) =>
    edit((d) => {
      const h = d.hr[i];
      if (h) d.hr[i] = { ...h, ...patch };
    });

  // Groups the player can add: an occupation in a region with a factory, not yet listed.
  const siteRegions = [...new Set(view.self.sites.map((s) => s.regionId))].sort();
  const listed = new Set(draft.hr.map((h) => poolKey(h.regionId, h.occupationId)));
  const addable = siteRegions.flatMap((r) =>
    Object.keys(occupations)
      .filter((o) => !listed.has(poolKey(r, o)))
      .map((o) => ({
        value: poolKey(r, o) as string,
        label: `${occupationName(o)} · ${regionName(r)}`,
      })),
  );
  const selected = addable.some((a) => a.value === newGroup) ? newGroup : (addable[0]?.value ?? '');

  return (
    <div className="space-y-4">
      <Card title={t.tabs.hr}>
        <Table
          head={[
            t.group,
            t.headcount,
            t.wageVsMarket,
            t.unemployed,
            t.hire,
            t.fireShort,
            t.wageOffer,
            t.train,
          ]}
        >
          {draft.hr.map((h, i) => {
            const key = poolKey(h.regionId, h.occupationId);
            const staff = company.workforce[key];
            const pool = view.labor[key];
            const level = occupations[h.occupationId]?.level ?? 0;
            const targets = Object.entries(occupations)
              .filter(([, o]) => o.level > level)
              .map(([id]) => ({ value: id, label: occupationName(id) }));
            return (
              <tr key={key}>
                <Td left>
                  <div className="font-medium">{occupationName(h.occupationId)}</div>
                  <div className="text-xs text-slate-500">{regionName(h.regionId)}</div>
                </Td>
                <Td>{fmtInt(staff?.headcount ?? 0)}</Td>
                <Td>
                  <div>{fmtMoney(staff?.wage ?? 0)}</div>
                  <div className="text-xs text-slate-500">{fmtMoney(pool?.marketWage ?? 0)}</div>
                </Td>
                <Td>{fmtInt(pool?.unemployed ?? 0)}</Td>
                <Td>
                  <NumberField
                    ariaLabel={`${t.hire} ${occupationName(h.occupationId)}`}
                    className="w-16"
                    min={0}
                    value={h.hire}
                    onChange={(v) => update(i, { hire: Math.floor(v ?? 0) })}
                  />
                </Td>
                <Td>
                  <NumberField
                    ariaLabel={`${t.fire} ${occupationName(h.occupationId)}`}
                    className="w-16"
                    min={0}
                    value={h.fire}
                    onChange={(v) => update(i, { fire: Math.floor(v ?? 0) })}
                  />
                </Td>
                <Td>
                  <NumberField
                    ariaLabel={`${t.wageOffer} ${occupationName(h.occupationId)}`}
                    className="w-24"
                    min={1}
                    value={h.wageOffer}
                    onChange={(v) => v !== undefined && update(i, { wageOffer: v })}
                  />
                </Td>
                <Td>
                  {targets.length > 0 && (
                    <span className="flex flex-col items-end gap-1">
                      <Select
                        className="w-36"
                        ariaLabel={t.train}
                        value={h.train?.toOccupationId ?? ''}
                        options={[{ value: '', label: t.none }, ...targets]}
                        onChange={(to) =>
                          edit((d) => {
                            const x = d.hr[i];
                            if (!x) return;
                            if (to === '') delete x.train;
                            else x.train = { toOccupationId: to, count: x.train?.count ?? 0 };
                          })
                        }
                      />
                      {h.train && (
                        <NumberField
                          ariaLabel={t.trainCount}
                          className="w-16"
                          min={0}
                          value={h.train.count}
                          onChange={(v) =>
                            edit((d) => {
                              const x = d.hr[i];
                              if (x?.train) x.train = { ...x.train, count: Math.floor(v ?? 0) };
                            })
                          }
                        />
                      )}
                    </span>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
        {addable.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span>{t.addGroup}</span>
            <Select
              value={selected}
              options={addable}
              onChange={setNewGroup}
              ariaLabel={t.addGroup}
            />
            <Button
              onClick={() =>
                edit((d) => {
                  const [regionId = '', occupationId = ''] = selected.split(':');
                  const pool = view.labor[poolKey(regionId, occupationId)];
                  d.hr.push({
                    regionId,
                    occupationId,
                    hire: 0,
                    fire: 0,
                    wageOffer: pool?.marketWage ?? 0,
                  });
                })
              }
            >
              {t.add}
            </Button>
          </div>
        )}
      </Card>
      <Card title={t.productivity}>
        {Object.entries(view.self.operatorProductivity).map(([regionId, p]) => (
          <Stat key={regionId} label={regionName(regionId)} value={`${fmtDec(p)} u./trim.`} />
        ))}
      </Card>
    </div>
  );
}
