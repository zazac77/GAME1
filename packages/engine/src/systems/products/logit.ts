import type { ConsumerSegment } from '../../model/markets';

export interface Offer {
  price: number;
  quality: number;
  brand: number;
  marketing: number;
  /** Shelf presence (0..1), in markets where it matters. */
  distribution?: number;
  /** Subscribers (network effect), in tech markets. */
  users?: number;
  /** Tech level minus the technology frontier (< 0 when lagging), in tech markets. */
  techGap?: number;
}

/**
 * U_ik = −βp·ln(p/ref) + βq·quality + βb·brand + βm·ln(1 + marketing/unit)
 *        + βd·distribution + βn·ln(1 + users/networkUnit) + βt·(tech level − frontier).
 */
export function utility(
  segment: ConsumerSegment,
  offer: Offer,
  refPrice: number,
  marketingUnit: number,
  networkUnit = 1,
): number {
  return (
    -segment.betaPrice * Math.log(offer.price / refPrice) +
    segment.betaQuality * offer.quality +
    segment.betaBrand * offer.brand +
    segment.betaMarketing * Math.log(1 + offer.marketing / marketingUnit) +
    segment.betaDistribution * (offer.distribution ?? 0) +
    segment.betaNetwork * Math.log(1 + Math.max(0, offer.users ?? 0) / networkUnit) +
    segment.betaTech * (offer.techGap ?? 0)
  );
}

/**
 * Multinomial logit shares of one segment, with the outside option U_0
 * (imports, not buying). The shares of the offers sum to less than 1.
 */
export function segmentShares(
  segment: ConsumerSegment,
  offers: readonly Offer[],
  refPrice: number,
  marketingUnit: number,
  networkUnit = 1,
): number[] {
  const u = offers.map((o) => utility(segment, o, refPrice, marketingUnit, networkUnit));
  const max = Math.max(segment.outsideUtility, ...u);
  const e = u.map((x) => Math.exp(x - max));
  const denominator = Math.exp(segment.outsideUtility - max) + e.reduce((s, x) => s + x, 0);
  return e.map((x) => x / denominator);
}

/** Shares over the whole market: Σ_k weight_k · share_ik. */
export function marketShares(
  segments: readonly ConsumerSegment[],
  offers: readonly Offer[],
  refPrice: number,
  marketingUnit: number,
  networkUnit = 1,
): number[] {
  const out = offers.map(() => 0);
  for (const segment of segments) {
    segmentShares(segment, offers, refPrice, marketingUnit, networkUnit).forEach((s, i) => {
      out[i] = (out[i] ?? 0) + segment.weight * s;
    });
  }
  return out;
}
