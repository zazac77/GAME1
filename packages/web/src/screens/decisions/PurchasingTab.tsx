import { useState } from 'react';
import { Button, Card, NumberField, Select, Table, Td } from '../../components/ui';
import { fmtInt, fmtPrice, quarterLabel } from '../../i18n/format';
import { commodityName, fr } from '../../i18n/fr';
import { useGame } from '../../store/game';

export function PurchasingTab() {
  const view = useGame((s) => s.view);
  const draft = useGame((s) => s.draft);
  const preview = useGame((s) => s.preview);
  const edit = useGame((s) => s.editDraft);
  const commodityIds = view ? Object.keys(view.commodities).sort() : [];
  const [contract, setContract] = useState({
    commodityId: commodityIds[0] ?? '',
    qty: 0,
    quarters: 4,
  });
  if (!view || !draft) return null;
  const t = fr.decisions;
  const company = view.self.company;
  const needs = preview?.companies[view.companyId]?.materialNeeds ?? {};
  const markets = view.config.commodities.markets;
  const { min, max } = view.config.commodities.contractQuarters;
  const active = company.contracts.filter((k) => k.startsAt <= view.turn && view.turn < k.endsAt);

  const setSpot = (commodityId: string, patch: { qty?: number; limitPrice?: number }) =>
    edit((d) => {
      const current = d.purchasing.spot.find((o) => o.commodityId === commodityId);
      const qty = patch.qty ?? current?.qty ?? 0;
      const limitPrice = 'limitPrice' in patch ? patch.limitPrice : current?.limitPrice;
      d.purchasing.spot = d.purchasing.spot.filter((o) => o.commodityId !== commodityId);
      if (qty > 0) {
        d.purchasing.spot.push(
          limitPrice === undefined ? { commodityId, qty } : { commodityId, qty, limitPrice },
        );
      }
    });

  return (
    <div className="space-y-4">
      <Card title={t.tabs.purchasing}>
        <Table
          head={[
            t.commodity,
            t.inStock,
            t.contracted,
            t.need,
            t.spotPrice,
            t.worldPrice,
            t.spotQty,
            t.limitPrice,
          ]}
        >
          {commodityIds.map((id) => {
            const market = view.commodities[id];
            const storable = markets[id]?.storable ?? true;
            const order = draft.purchasing.spot.find((o) => o.commodityId === id);
            const contracted = active
              .filter((k) => k.commodityId === id)
              .reduce((s, k) => s + k.qtyPerQuarter, 0);
            return (
              <tr key={id}>
                <Td left>
                  <div className="font-medium">{commodityName(id)}</div>
                  <div className="text-xs text-slate-500">
                    {market?.unit}
                    {!storable && ` · ${t.nonStorable}`}
                  </div>
                </Td>
                <Td>{storable ? fmtInt(company.inventory[id]?.qty ?? 0) : '–'}</Td>
                <Td>{fmtInt(contracted)}</Td>
                <Td>{fmtInt(needs[id] ?? 0)}</Td>
                <Td>{fmtPrice(market?.spotPrice ?? 0)}</Td>
                <Td>{fmtPrice(market?.worldPrice ?? 0)}</Td>
                <Td>
                  {storable && (
                    <NumberField
                      ariaLabel={`${t.spotQty} ${commodityName(id)}`}
                      min={0}
                      value={order?.qty ?? 0}
                      onChange={(v) => setSpot(id, { qty: v ?? 0 })}
                    />
                  )}
                </Td>
                <Td>
                  {storable && (
                    <NumberField
                      ariaLabel={`${t.limitPrice} ${commodityName(id)}`}
                      allowEmpty
                      min={0}
                      className="w-24"
                      placeholder="—"
                      value={order?.limitPrice}
                      onChange={(v) => setSpot(id, { limitPrice: v })}
                    />
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Card title={t.newContract}>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <Select
            ariaLabel={t.commodity}
            value={contract.commodityId}
            options={commodityIds.map((id) => ({ value: id, label: commodityName(id) }))}
            onChange={(commodityId) => setContract({ ...contract, commodityId })}
          />
          <label className="space-y-1">
            <span className="block text-slate-600">{t.qtyPerQuarter}</span>
            <NumberField
              min={0}
              value={contract.qty}
              onChange={(v) => setContract({ ...contract, qty: v ?? 0 })}
            />
          </label>
          <label className="space-y-1">
            <span className="block text-slate-600">
              {t.quarters} ({min}–{max})
            </span>
            <NumberField
              min={1}
              className="w-20"
              value={contract.quarters}
              onChange={(v) => setContract({ ...contract, quarters: Math.round(v ?? min) })}
            />
          </label>
          <Button
            disabled={contract.qty <= 0}
            onClick={() =>
              edit((d) => {
                d.purchasing.newContracts.push({
                  commodityId: contract.commodityId,
                  qtyPerQuarter: contract.qty,
                  quarters: contract.quarters,
                });
              })
            }
          >
            {t.add}
          </Button>
        </div>
        {draft.purchasing.newContracts.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {draft.purchasing.newContracts.map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                <span>
                  {commodityName(c.commodityId)} : {fmtInt(c.qtyPerQuarter)} / trim. × {c.quarters}{' '}
                  trim.
                </span>
                <Button
                  variant="ghost"
                  onClick={() => edit((d) => void d.purchasing.newContracts.splice(i, 1))}
                >
                  {t.cancel}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t.contracts}>
        {company.contracts.length === 0 ? (
          <p className="text-sm text-slate-500">{t.noContracts}</p>
        ) : (
          <Table head={[t.commodity, t.qtyPerQuarter, t.contractPrice, t.contractEnd]}>
            {company.contracts.map((k) => (
              <tr key={k.id}>
                <Td left>{commodityName(k.commodityId)}</Td>
                <Td>{fmtInt(k.qtyPerQuarter)}</Td>
                <Td>{fmtPrice(k.price)}</Td>
                <Td>{quarterLabel(k.endsAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
