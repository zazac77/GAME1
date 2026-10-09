import type { ConsumerSegment } from '../../model/markets';

export interface Offer {
  price: number;
  quality: number;
  brand: number;
  marketing: number;
  /** Shelf presence (0..1), in markets where it matters. */
  distribution?: number;
}

/** U_ik = −βp·ln(p/ref) + βq·quality + βb·brand + βm·ln(1 + marketing/unit) + βd·distribution. */
export function utility(
  segment: ConsumerSegment,
  offer: Offer,
  refPrice: number,
  marketingUnit: number,
): number {
  return (
    -segment.betaPrice * Math.log(offer.price / refPrice) +
    segment.betaQuality * offer.quality +
    segment.betaBrand * offer.brand +
    segment.betaMarketing * Math.log(1 + offer.marketing / marketingUnit) +
    segment.betaDistribution * (offer.distribution ?? 0)
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
): number[] {
  const u = offers.map((o) => utility(segment, o, refPrice, marketingUnit));
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
): number[] {
  const out = offers.map(() => 0);
  for (const segment of segments) {
    segmentShares(segment, offers, refPrice, marketingUnit).forEach((s, i) => {
      out[i] = (out[i] ?? 0) + segment.weight * s;
    });
  }
  return out;
}
