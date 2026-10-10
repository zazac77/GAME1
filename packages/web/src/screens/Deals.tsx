import type { DealAction, DealQuote, MnaAction, OfferView } from '@game/engine';
import { useState } from 'react';
import { companyNamer, IssueList } from '../components/lists';
import { Button, Card, Notice, NumberField, Select, Stat, Table, Td } from '../components/ui';
import { fmtInt, fmtMoney, fmtPct, fmtPrice, quarterLabel } from '../i18n/format';
import { fr } from '../i18n/fr';
import { useGame } from '../store/game';

type Deal = DealAction | Extract<MnaAction, { kind: 'raise_offer' }>;
/** The quarter's one deal: a purchase, a tender offer or a raise. */
const isDeal = (a: MnaAction): a is Deal =>
  a.kind === 'tender_offer' || a.kind === 'private_purchase' || a.kind === 'raise_offer';
type OfferMove = Extract<MnaAction, { kind: 'withdraw_offer' | 'tender_shares' }>;
const isMove = (a: MnaAction): a is OfferMove =>
  a.kind === 'withdraw_offer' || a.kind === 'tender_shares';

/** Price per share a board asks for (its premium over the reference price). */
const askedPrice = (q: DealQuote): number =>
  (q.referencePrice ?? 0) * (1 + Math.max(0, q.askedPremium ?? 0));

/** Takeovers: companies for sale and rivals, due diligences, block purchases and friendly offers. */
export function Deals() {
  const view = useGame((s) => s.view);
  const draft = useGame((s) => s.draft);
  const edit = useGame((s) => s.editDraft);
  const preview = useGame((s) => s.preview);
  const [selected, setSelected] = useState<string | null>(null);
  if (!view) return null;
  const t = fr.deals;
  const name = companyNamer(view);
  if (!draft) return <Notice severity="info">{t.noDraft}</Notice>;

  const deal = draft.mna.find(isDeal);
  const moves = draft.mna.filter(isMove);
  const toggleMove = (move: OfferMove) =>
    edit((d) => {
      const same = (a: MnaAction) => a.kind === move.kind && a.offerId === move.offerId;
      if (d.mna.some(same)) d.mna = d.mna.filter((a) => !same(a));
      else d.mna.push(move);
    });
  const ordered = new Set(
    draft.mna.filter((a) => a.kind === 'due_diligence').map((a) => a.targetId),
  );
  const toggleDiligence = (targetId: string) =>
    edit((d) => {
      if (d.mna.some((a) => a.kind === 'due_diligence' && a.targetId === targetId)) {
        d.mna = d.mna.filter((a) => !(a.kind === 'due_diligence' && a.targetId === targetId));
      } else d.mna.push({ kind: 'due_diligence', targetId });
    });
  const setDeal = (next: Deal | undefined) =>
    edit((d) => {
      d.mna = d.mna.filter((a) => !isDeal(a));
      if (next) d.mna.push(next);
    });

  const listings = view.deals.filter((q) => q.kind === 'listing');
  const companies = view.deals.filter((q) => q.kind === 'company');
  const quote = view.deals.find((q) => q.targetId === selected);
  const offers = [...view.mna.tenderOffers].reverse();
  const issues = (preview?.issues ?? []).filter(
    (i) => i.companyId === view.companyId && i.path.startsWith('mna'),
  );

  const row = (q: DealQuote) => (
    <tr key={q.targetId} className={q.targetId === selected ? 'bg-sky-50' : ''}>
      <Td left>
        <div className="font-medium">{q.name}</div>
        <div className="text-xs text-slate-500">{fr.sectors[q.sector]}</div>
      </Td>
      <Td>{fmtMoney(q.figures.revenue)}</Td>
      <Td>{fmtMoney(q.figures.ebitda)}</Td>
      <Td>{fmtMoney(q.netDebt)}</Td>
      <Td>
        {fmtMoney(q.valuation.low)} – {fmtMoney(q.valuation.high)}
      </Td>
      <Td>
        {q.kind === 'listing'
          ? fmtMoney(q.price ?? 0)
          : q.askedPremium !== undefined
            ? `${fmtPrice(askedPrice(q))} (${fmtPct(q.askedPremium, 0)})`
            : t.notForSale}
      </Td>
      <Td>{t.diligence[q.diligence]}</Td>
      <Td>
        <span className="flex justify-end gap-1">
          {q.diligence === 'none' && (
            <Button
              variant={ordered.has(q.targetId) ? 'primary' : 'secondary'}
              onClick={() => toggleDiligence(q.targetId)}
              title={fmtMoney(q.dueDiligenceCost)}
            >
              {ordered.has(q.targetId) ? `✓ ${t.audit}` : t.audit}
              <span className="ml-1 opacity-70">({fmtMoney(q.dueDiligenceCost)})</span>
            </Button>
          )}
          <Button variant="ghost" onClick={() => setSelected(q.targetId)}>
            {t.prepare}
          </Button>
        </span>
      </Td>
    </tr>
  );
  const head = [
    t.target,
    t.revenue,
    t.ebitda,
    t.netDebt,
    t.valuationRange,
    t.askingPrice,
    t.diligenceHead,
    '',
  ];

  return (
    <div className="space-y-4">
      <Notice severity="info">{t.intro}</Notice>
      {view.groupCompanies.length > 1 && (
        <p className="text-sm text-slate-600">{t.buyer(view.self.company.name)}</p>
      )}
      <Card title={t.thisQuarter}>
        {!deal && ordered.size === 0 && moves.length === 0 ? (
          <p className="text-sm text-slate-500">{t.nothing}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {[...ordered].map((id) => (
              <li key={id} className="flex items-center gap-2">
                <span>{t.auditOf(view.deals.find((q) => q.targetId === id)?.name ?? id)}</span>
                <Button variant="ghost" onClick={() => toggleDiligence(id)}>
                  {fr.decisions.cancel}
                </Button>
              </li>
            ))}
            {moves.map((m) => (
              <li key={`${m.kind}-${m.offerId}`} className="flex items-center gap-2">
                <span>{moveText(m, view.offers, name)}</span>
                <Button variant="ghost" onClick={() => toggleMove(m)}>
                  {fr.decisions.cancel}
                </Button>
              </li>
            ))}
            {deal && (
              <li className="flex items-center gap-2">
                <span>{dealText(deal, view.deals, view.offers, name)}</span>
                <Button variant="ghost" onClick={() => setDeal(undefined)}>
                  {fr.decisions.cancel}
                </Button>
              </li>
            )}
          </ul>
        )}
      </Card>
      {issues.length > 0 && <IssueList issues={issues} />}
      {quote && (
        <OfferForm
          key={quote.targetId}
          quote={quote}
          canPayInShares={view.self.company.listed}
          current={
            deal && deal.kind !== 'raise_offer' && deal.targetId === quote.targetId
              ? deal
              : undefined
          }
          onSubmit={setDeal}
          onClose={() => setSelected(null)}
        />
      )}
      <Card title={t.listings}>
        {listings.length === 0 ? (
          <p className="text-sm text-slate-500">{t.noListings}</p>
        ) : (
          <Table head={head}>{listings.map(row)}</Table>
        )}
        <p className="mt-2 text-xs text-slate-500">{t.listingsHint}</p>
      </Card>
      <Card title={t.companies}>
        {companies.length === 0 ? (
          <p className="text-sm text-slate-500">{t.noCompanies}</p>
        ) : (
          <Table head={head}>{companies.map(row)}</Table>
        )}
        <p className="mt-2 text-xs text-slate-500">{t.companiesHint}</p>
      </Card>
      <OpenOffers
        offers={view.offers}
        name={name}
        moves={moves}
        raise={deal?.kind === 'raise_offer' ? deal : undefined}
        onToggle={toggleMove}
        onRaise={setDeal}
      />
      <Card title={t.tenderOffers}>
        {offers.length === 0 ? (
          <p className="text-sm text-slate-500">{t.noOffers}</p>
        ) : (
          <Table head={[t.bidder, t.target, t.pricePerShare, t.premium, t.status, t.when]}>
            {offers.map((o) => (
              <tr key={o.id}>
                <Td left>{name(o.bidderId)}</Td>
                <Td>{name(o.targetId)}</Td>
                <Td>{fmtPrice(o.pricePerShare)}</Td>
                <Td>{fmtPct(o.premium)}</Td>
                <Td>
                  {t.offerStatus[o.status]}
                  {o.hostile && (
                    <span className="ml-1 text-xs text-rose-700">({t.hostileBadge})</span>
                  )}
                </Td>
                <Td>{quarterLabel(o.launchedAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function dealText(
  deal: Deal,
  quotes: DealQuote[],
  offers: OfferView[],
  name: (id: string) => string,
): string {
  const t = fr.deals;
  if (deal.kind === 'raise_offer') {
    const offer = offers.find((o) => o.offer.id === deal.offerId)?.offer;
    return t.raiseAt(name(offer?.targetId ?? ''), fmtPrice(deal.pricePerShare));
  }
  const target = quotes.find((q) => q.targetId === deal.targetId)?.name ?? deal.targetId;
  const underOffer = offers.some((o) => o.offer.targetId === deal.targetId);
  const how =
    deal.kind === 'tender_offer'
      ? underOffer
        ? t.competingAt(target, fmtPrice(deal.pricePerShare))
        : deal.hostile
          ? t.hostileAt(target, fmtPrice(deal.pricePerShare))
          : t.tenderOfferAt(target, fmtPrice(deal.pricePerShare))
      : deal.pricePerShare !== undefined
        ? t.blockAt(target, fmtPrice(deal.pricePerShare))
        : t.buyListing(target);
  const parts = [how];
  if (deal.debt) parts.push(t.withDebt(fmtMoney(deal.debt)));
  if (deal.stockShare) parts.push(t.withShares(fmtPct(deal.stockShare, 0)));
  return parts.join(', ');
}

function moveText(move: OfferMove, offers: OfferView[], name: (id: string) => string): string {
  const offer = offers.find((o) => o.offer.id === move.offerId)?.offer;
  const target = name(offer?.targetId ?? '');
  return move.kind === 'withdraw_offer' ? fr.deals.withdrawOf(target) : fr.deals.tenderOf(target);
}

/** Open offers: raise or withdraw one's own, tender the shares held. */
function OpenOffers(props: {
  offers: OfferView[];
  name: (id: string) => string;
  moves: OfferMove[];
  raise?: Extract<MnaAction, { kind: 'raise_offer' }>;
  onToggle: (move: OfferMove) => void;
  onRaise: (raise: Deal | undefined) => void;
}) {
  const t = fr.deals;
  const { offers, name } = props;
  const has = (kind: OfferMove['kind'], offerId: string) =>
    props.moves.some((m) => m.kind === kind && m.offerId === offerId);
  return (
    <Card title={t.openOffers}>
      {offers.length === 0 ? (
        <p className="text-sm text-slate-500">{t.noOpenOffers}</p>
      ) : (
        <>
          <Table
            head={[t.bidder, t.target, t.pricePerShare, t.premium, t.defenses, t.closesAt, '']}
          >
            {offers.map((v) => {
              const o = v.offer;
              const defenses = [
                o.defenses.pill ? t.pill : '',
                o.defenses.whiteKnight ? t.knight : '',
              ].filter(Boolean);
              return (
                <tr key={o.id} className={v.mine ? 'bg-sky-50' : ''}>
                  <Td left>
                    {name(o.bidderId)} {v.mine && <span className="text-xs">{t.yours}</span>}
                    {o.hostile && (
                      <span className="ml-1 text-xs text-rose-700">({t.hostileBadge})</span>
                    )}
                  </Td>
                  <Td>{name(o.targetId)}</Td>
                  <Td>{fmtPrice(o.pricePerShare)}</Td>
                  <Td>{fmtPct(o.premium)}</Td>
                  <Td>{defenses.join(', ') || '–'}</Td>
                  <Td>{quarterLabel(o.expiresAt)}</Td>
                  <Td>
                    <span className="flex justify-end gap-1">
                      {v.mine && (
                        <RaiseButton
                          view={v}
                          current={props.raise?.offerId === o.id ? props.raise : undefined}
                          onRaise={props.onRaise}
                        />
                      )}
                      {v.canWithdraw && (
                        <Button
                          variant={has('withdraw_offer', o.id) ? 'primary' : 'secondary'}
                          onClick={() => props.onToggle({ kind: 'withdraw_offer', offerId: o.id })}
                        >
                          {t.withdraw}
                        </Button>
                      )}
                      {v.held > 0 && (
                        <Button
                          variant={has('tender_shares', o.id) ? 'primary' : 'secondary'}
                          onClick={() => props.onToggle({ kind: 'tender_shares', offerId: o.id })}
                        >
                          {t.tenderShares(fmtInt(v.held))}
                        </Button>
                      )}
                    </span>
                  </Td>
                </tr>
              );
            })}
          </Table>
          {offers.some((v) => v.offer.defenses.pill) && (
            <p className="mt-2 text-xs text-slate-500">{t.pillHint}</p>
          )}
        </>
      )}
    </Card>
  );
}

function RaiseButton(props: {
  view: OfferView;
  current?: Extract<MnaAction, { kind: 'raise_offer' }>;
  onRaise: (raise: Deal | undefined) => void;
}) {
  const { view: v, current } = props;
  const [price, setPrice] = useState(current?.pricePerShare ?? v.minRaise);
  return (
    <span className="flex items-center gap-1">
      <NumberField
        ariaLabel={fr.deals.pricePerShare}
        min={v.minRaise}
        value={price}
        className="w-24"
        onChange={(x) => x !== undefined && setPrice(x)}
      />
      <Button
        variant={current ? 'primary' : 'secondary'}
        onClick={() =>
          props.onRaise(
            current
              ? undefined
              : {
                  kind: 'raise_offer',
                  offerId: v.offer.id,
                  pricePerShare: Math.max(price, v.minRaise),
                },
          )
        }
      >
        {current ? fr.deals.cancelAction : fr.deals.raise}
      </Button>
    </span>
  );
}

type OfferKind = 'block' | 'tender';

function OfferForm(props: {
  quote: DealQuote;
  canPayInShares: boolean;
  current?: DealAction;
  onSubmit: (deal: DealAction) => void;
  onClose: () => void;
}) {
  const { quote: q, current } = props;
  const t = fr.deals;
  const listing = q.kind === 'listing';
  const kinds: OfferKind[] = [
    ...(q.blockShares ? (['block'] as const) : []),
    ...(q.tenderShares ? (['tender'] as const) : []),
  ];
  const [kind, setKind] = useState<OfferKind>(
    current?.kind === 'tender_offer' ? 'tender' : (kinds[0] ?? 'block'),
  );
  const [price, setPrice] = useState(
    current?.pricePerShare ?? Math.max(askedPrice(q), q.minCompetingPrice ?? 0),
  );
  const [hostile, setHostile] = useState(current?.kind === 'tender_offer' && !!current.hostile);
  const [debt, setDebt] = useState(current?.debt ?? 0);
  const [stockShare, setStockShare] = useState(current?.stockShare ?? 0);
  // A listed block comes with the mandatory offer on every other share (at most).
  const shares = kind === 'block' ? (q.tenderShares ?? q.blockShares ?? 0) : (q.tenderShares ?? 0);
  const total = listing ? (q.price ?? 0) : shares * price;
  const forSale =
    listing || (kinds.length > 0 && (q.askedPremium !== undefined || q.contestable === true));
  const submit = () => {
    const financing = {
      ...(debt > 0 ? { debt: Math.min(debt, q.debtCapacity) } : {}),
      ...(stockShare > 0 ? { stockShare } : {}),
    };
    if (listing) props.onSubmit({ kind: 'private_purchase', targetId: q.targetId, ...financing });
    else if (kind === 'tender') {
      props.onSubmit({
        kind: 'tender_offer',
        targetId: q.targetId,
        pricePerShare: price,
        ...(hostile && q.minCompetingPrice === undefined ? { hostile: true } : {}),
        ...financing,
      });
    } else {
      props.onSubmit({
        kind: 'private_purchase',
        targetId: q.targetId,
        pricePerShare: price,
        ...financing,
      });
    }
  };
  return (
    <Card
      title={`${t.offerOn} ${q.name}`}
      actions={
        <Button variant="ghost" onClick={props.onClose}>
          {t.close}
        </Button>
      }
    >
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-1 font-semibold">{t.valuation}</h3>
          <Stat label={t.figuresFrom[q.diligence === 'done' ? 'audit' : q.kind]} value="" />
          <Stat label={t.revenue} value={fmtMoney(q.figures.revenue)} />
          <Stat label={t.ebitda} value={fmtMoney(q.figures.ebitda)} />
          <Stat label={t.netDebt} value={fmtMoney(q.netDebt)} />
          {q.hiddenLiability !== undefined && (
            <Stat label={t.hiddenLiability} value={fmtMoney(q.hiddenLiability)} />
          )}
          <Stat label={t.multiples} value={fmtMoney(q.valuation.multiples)} />
          <Stat label={t.dcf} value={fmtMoney(q.valuation.dcf)} />
          <Stat
            label={t.range}
            value={`${fmtMoney(q.valuation.low)} – ${fmtMoney(q.valuation.high)}`}
            strong
          />
          <Stat label={t.controlPremium} value={fmtPct(q.valuation.controlPremium, 0)} />
          {q.referencePrice !== undefined && (
            <Stat label={t.referencePrice} value={fmtPrice(q.referencePrice)} />
          )}
          {q.blockShares !== undefined && (
            <Stat label={t.blockShares} value={fmtInt(q.blockShares)} />
          )}
          {q.groupStake !== undefined && q.groupStake > 0 && (
            <Stat label={t.groupStake} value={fmtPct(q.groupStake)} />
          )}
          {q.contestable !== undefined && (
            <p className="mt-2 text-xs text-slate-600">
              {q.contestable ? t.contestable : t.controlled}
            </p>
          )}
          {q.diligence !== 'done' && <p className="mt-2 text-xs text-amber-700">{t.auditAdvice}</p>}
        </div>
        <div className="space-y-3 text-sm">
          {!forSale ? (
            <Notice severity="warning">{t.notForSaleLong}</Notice>
          ) : (
            <>
              {!listing && (
                <label className="flex items-center justify-between gap-2">
                  <span>{t.offerKind}</span>
                  <Select
                    value={kind}
                    onChange={setKind}
                    options={kinds.map((k) => ({ value: k, label: t.offerKinds[k] }))}
                  />
                </label>
              )}
              {!listing && (
                <label className="flex items-center justify-between gap-2">
                  <span>
                    {t.pricePerShare}{' '}
                    <span className="text-slate-500">({t.boardAsks(fmtPrice(askedPrice(q)))})</span>
                  </span>
                  <NumberField
                    ariaLabel={t.pricePerShare}
                    min={0.01}
                    value={price}
                    onChange={(v) => v !== undefined && setPrice(v)}
                  />
                </label>
              )}
              {q.minCompetingPrice !== undefined && (
                <Notice severity="warning">{t.underOffer(fmtPrice(q.minCompetingPrice))}</Notice>
              )}
              {!listing && kind === 'tender' && q.minCompetingPrice === undefined && (
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={hostile}
                    onChange={(e) => setHostile(e.target.checked)}
                  />
                  <span>
                    <span className="block">{t.hostile}</span>
                    <span className="block text-xs text-slate-500">{t.hostileHint}</span>
                  </span>
                </label>
              )}
              {!listing && kind === 'block' && q.tenderShares !== undefined && (
                <p className="text-xs text-slate-500">
                  {t.mandatory(fmtInt(Math.max(0, q.tenderShares - (q.blockShares ?? 0))))}
                </p>
              )}
              <Stat label={t.total} value={fmtMoney(total)} strong />
              <label className="flex items-center justify-between gap-2">
                <span>
                  {t.debt} <span className="text-slate-500">(max {fmtMoney(q.debtCapacity)})</span>
                </span>
                <NumberField
                  ariaLabel={t.debt}
                  min={0}
                  value={debt}
                  onChange={(v) => setDebt(Math.min(v ?? 0, q.debtCapacity))}
                />
              </label>
              {props.canPayInShares && (
                <label className="block space-y-1">
                  <span className="flex justify-between">
                    <span>{t.stockShare}</span>
                    <span className="tabular-nums">{fmtPct(stockShare, 0)}</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={stockShare}
                    aria-label={t.stockShare}
                    className="w-full"
                    onChange={(e) => setStockShare(Number(e.target.value))}
                  />
                </label>
              )}
              <Stat
                label={t.cashPart}
                value={fmtMoney(Math.max(0, total * (1 - stockShare) - debt))}
              />
              <p className="text-xs text-slate-500">
                {listing ? t.listingRules : kind === 'tender' ? t.tenderRules : t.blockRules}
              </p>
              <Button variant="primary" onClick={submit}>
                {current ? t.update : t.submit}
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
