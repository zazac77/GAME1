import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PALETTE, SeriesChart } from '../charts/SeriesChart';
import { companyNamer } from '../components/lists';
import { Card, Select, Stat, Table, Td } from '../components/ui';
import { fmtDec, fmtInt, fmtMoney, fmtPct, fmtPrice } from '../i18n/format';
import { commodityName, fr, marketName, occupationName, regionName } from '../i18n/fr';
import { useGame } from '../store/game';

export function Markets() {
  const view = useGame((s) => s.view);
  const [region, setRegion] = useState<string>('all');
  if (!view) return null;
  const t = fr.markets;
  const name = companyNamer(view);
  const regions = Object.keys(view.regions).sort();
  const pools = Object.entries(view.labor)
    .filter(([, p]) => region === 'all' || p.regionId === region)
    .sort(([a], [b]) => a.localeCompare(b));

  // Owner of each product line (own and competitors').
  const owner: Record<string, string> = {};
  for (const id of Object.keys(view.self.company.productLines)) owner[id] = view.companyId;
  for (const c of view.competitors) for (const p of c.products) owner[p.lineId] = c.companyId;

  return (
    <div className="space-y-4">
      <Card title={t.products}>
        {Object.values(view.productMarkets).map((m) => {
          const shares = Object.entries(m.lastResult.shares)
            .map(([lineId, share]) => ({ name: name(owner[lineId] ?? lineId), share: share * 100 }))
            .sort((a, b) => b.share - a.share);
          return (
            <div key={m.id} className="grid gap-4 lg:grid-cols-3">
              <div>
                <h3 className="mb-1 font-semibold">{marketName(m.id)}</h3>
                <Stat label={t.volume} value={fmtInt(m.lastResult.volume)} />
                <Stat label={t.demand} value={fmtInt(m.lastResult.demand)} />
                <Stat label={t.avgPrice} value={fmtPrice(m.lastResult.avgPrice)} />
                <Stat label={t.refPrice} value={fmtPrice(m.refPrice * view.macro.priceLevel)} />
                <h4 className="mt-3 text-sm font-semibold">{t.segments}</h4>
                {m.segments.map((s) => (
                  <Stat
                    key={s.id}
                    label={fr.segments[s.id] ?? s.id}
                    value={`${t.weight} ${fmtPct(s.weight, 0)}`}
                  />
                ))}
              </div>
              <div className="h-56">
                <h4 className="text-sm font-semibold">{t.shares}</h4>
                <ResponsiveContainer width="100%" height="90%">
                  <BarChart data={shares} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" unit=" %" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => `${fmtDec(Number(v))} %`} />
                    <Bar dataKey="share" fill={PALETTE[0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div>
                <h4 className="text-sm font-semibold">{t.history}</h4>
                <SeriesChart
                  history={view.history}
                  format={fmtPrice}
                  height={200}
                  series={[
                    { key: `market.${m.id}.avgPrice`, label: t.avgPrice, color: PALETTE[0] ?? '' },
                  ]}
                />
              </div>
            </div>
          );
        })}
      </Card>

      <Card title={t.commodities}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Table head={[fr.decisions.commodity, t.unit, t.spot, t.world, t.demand]}>
            {Object.values(view.commodities).map((c) => (
              <tr key={c.id}>
                <Td left>{commodityName(c.id)}</Td>
                <Td>{c.unit}</Td>
                <Td>{fmtPrice(c.spotPrice)}</Td>
                <Td>{fmtPrice(c.worldPrice)}</Td>
                <Td>{fmtInt(c.lastSimDemand)}</Td>
              </tr>
            ))}
          </Table>
          <div>
            <h4 className="text-sm font-semibold">{t.spotIndex}</h4>
            <SeriesChart
              history={view.history}
              format={(x) => fmtInt(x)}
              series={Object.keys(view.commodities).map((id, i) => {
                // Base 100 at the first recorded quarter: the prices have different scales.
                const values = view.history.series[`commodity.${id}.spotPrice`] ?? [];
                const base = values[0] || 1;
                return {
                  values: values.map((v) => (100 * v) / base),
                  label: commodityName(id),
                  color: PALETTE[i % PALETTE.length] ?? '',
                };
              })}
            />
          </div>
        </div>
      </Card>

      <Card
        title={t.labor}
        actions={
          <Select
            value={region}
            onChange={setRegion}
            ariaLabel={fr.decisions.region}
            options={[
              { value: 'all', label: t.allRegions },
              ...regions.map((r) => ({ value: r, label: regionName(r) })),
            ]}
          />
        }
      >
        <Table
          head={[
            fr.decisions.group,
            fr.decisions.region,
            t.marketWage,
            t.tension,
            t.laborForce,
            t.outside,
            t.unemployed,
          ]}
        >
          {pools.map(([key, p]) => (
            <tr key={key}>
              <Td left>{occupationName(p.occupationId)}</Td>
              <Td>{regionName(p.regionId)}</Td>
              <Td>{fmtMoney(p.marketWage)}</Td>
              <Td>{fmtDec(p.tension, 2)}</Td>
              <Td>{fmtInt(p.laborForce)}</Td>
              <Td>{fmtInt(p.outsideEmployment)}</Td>
              <Td>{fmtInt(p.unemployed)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
