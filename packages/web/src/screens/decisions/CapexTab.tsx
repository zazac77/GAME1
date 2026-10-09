import type { CapexOrder } from '@game/engine';
import { useState } from 'react';
import { Button, Card, Select, Table, Td } from '../../components/ui';
import { fmtDec, fmtInt, fmtMoney } from '../../i18n/format';
import { fr, regionName } from '../../i18n/fr';
import { useGame } from '../../store/game';

const sameOrder = (a: CapexOrder, b: CapexOrder) => JSON.stringify(a) === JSON.stringify(b);

function orderLabel(o: CapexOrder, siteRegion: (siteId: string) => string): string {
  const t = fr.decisions;
  switch (o.kind) {
    case 'build_site':
      return `${t.buildSite} · ${regionName(o.regionId)}`;
    case 'buy_farm':
      return `${t.buyFarm} · ${regionName(o.regionId)}`;
    case 'add_line':
      return `${t.addLine} · ${siteRegion(o.siteId)}`;
    case 'modernize_line':
      return `${t.modernizeLine} ${o.lineId} · ${siteRegion(o.siteId)}`;
    case 'sell_line':
      return `${t.sellLine} ${o.lineId} · ${siteRegion(o.siteId)}`;
    case 'sell_site':
      return `${t.sellSite} · ${siteRegion(o.siteId)}`;
  }
}

export function CapexTab() {
  const view = useGame((s) => s.view);
  const draft = useGame((s) => s.draft);
  const edit = useGame((s) => s.editDraft);
  const [region, setRegion] = useState('');
  if (!view || !draft) return null;
  const t = fr.decisions;
  const company = view.self.company;
  const costs = view.costs;
  const regions = Object.keys(view.regions).sort();
  const buildRegion = regions.includes(region) ? region : (regions[0] ?? '');
  const siteRegion = (siteId: string) => regionName(company.sites[siteId]?.regionId);

  const has = (o: CapexOrder) => draft.capex.some((x) => sameOrder(x, o));
  const toggle = (o: CapexOrder) =>
    edit((d) => {
      if (d.capex.some((x) => sameOrder(x, o))) d.capex = d.capex.filter((x) => !sameOrder(x, o));
      else d.capex.push(o);
    });
  const orderButton = (props: {
    order: CapexOrder;
    label: string;
    cost?: number;
    danger?: boolean;
  }) => (
    <Button
      variant={has(props.order) ? 'primary' : props.danger ? 'danger' : 'secondary'}
      onClick={() => toggle(props.order)}
      title={props.cost !== undefined ? fmtMoney(props.cost) : undefined}
    >
      {has(props.order) ? `✓ ${props.label}` : props.label}
      {props.cost !== undefined && (
        <span className="ml-1 opacity-70">({fmtMoney(props.cost)})</span>
      )}
    </Button>
  );

  return (
    <div className="space-y-4">
      <Card title={t.orders}>
        {draft.capex.length === 0 ? (
          <p className="text-sm text-slate-500">{t.noOrders}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {draft.capex.map((o, i) => (
              <li key={i} className="flex items-center gap-2">
                <span>{orderLabel(o, siteRegion)}</span>
                <Button variant="ghost" onClick={() => toggle(o)}>
                  {t.cancel}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span>{t.buildSite}</span>
          <Select
            ariaLabel={t.region}
            value={buildRegion}
            options={regions.map((r) => ({ value: r, label: regionName(r) }))}
            onChange={setRegion}
          />
          {orderButton({
            order: { kind: 'build_site', regionId: buildRegion },
            label: t.buildSite,
            cost: costs?.buildSite[buildRegion],
          })}
        </div>
      </Card>
      {Object.values(company.sites).map((site) => (
        <Card
          key={site.id}
          title={`${t.site} · ${regionName(site.regionId)} · ${fr.status[site.status]}`}
          actions={
            <span className="flex gap-2">
              {orderButton({
                order: { kind: 'add_line', siteId: site.id },
                label: t.addLine,
                cost: costs?.addLine,
              })}
              {site.status === 'operational' &&
                orderButton({
                  order: { kind: 'sell_site', siteId: site.id },
                  label: t.sellSite,
                  cost: costs?.saleValue[site.id],
                  danger: true,
                })}
            </span>
          }
        >
          {costs && (
            <p className="mb-2 text-sm text-slate-600">
              {t.modernizeCost(fmtMoney(costs.modernizeLine))}
            </p>
          )}
          <Table
            head={[t.line, t.status, t.age, t.techLevel, t.capacity, t.bookValue, t.proceeds, '']}
          >
            {Object.values(site.lines).map((line) => (
              <tr key={line.id}>
                <Td left>{line.id}</Td>
                <Td>{fr.status[line.status]}</Td>
                <Td>{fmtInt(line.age)}</Td>
                <Td>{fmtDec(line.techLevel, 2)}</Td>
                <Td>{fmtInt(line.capacity)}</Td>
                <Td>{fmtMoney(line.bookValue)}</Td>
                <Td>{fmtMoney(costs?.saleValue[line.id] ?? 0)}</Td>
                <Td>
                  {line.status === 'operational' && (
                    <span className="flex justify-end gap-1">
                      {orderButton({
                        order: { kind: 'modernize_line', siteId: site.id, lineId: line.id },
                        label: t.modernizeLine,
                      })}
                      {orderButton({
                        order: { kind: 'sell_line', siteId: site.id, lineId: line.id },
                        label: t.sellLine,
                        danger: true,
                      })}
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      ))}
    </div>
  );
}
