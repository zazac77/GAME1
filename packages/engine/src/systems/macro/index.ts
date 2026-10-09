import { clamp } from '../../core/math';
import { applyModifiers } from '../../core/modifiers';
import type { System } from '../../core/system';

/**
 * Step 2: regime switch, GDP growth and inflation (AR(1)), smoothed Taylor
 * rule, cyclical demand index and price level. Reads the global modifiers
 * macro.expansionToRecession, macro.gdpGrowth, macro.inflation and
 * macro.policyRate. Always draws the same number of random numbers.
 */
export const macroSystem: System = {
  id: 'macro',
  run(ctx) {
    const { draft, config, rng } = ctx;
    const cfg = config.macro;
    const macro = draft.macro;
    const mods = draft.modifiers;

    const switchProbability =
      macro.regime === 'expansion'
        ? applyModifiers(
            mods,
            'macro.expansionToRecession',
            cfg.regimeTransition.expansionToRecession,
          )
        : cfg.regimeTransition.recessionToExpansion;
    const switches = rng.next() < clamp(switchProbability, 0, 1);
    if (switches) {
      macro.regime = macro.regime === 'expansion' ? 'recession' : 'expansion';
      ctx.log({ kind: 'macro_regime', severity: 'warning', data: { regime: macro.regime } });
    }

    const g = cfg.gdpGrowth;
    const mean = macro.regime === 'expansion' ? g.expansionMean : g.recessionMean;
    macro.gdpGrowth = applyModifiers(
      mods,
      'macro.gdpGrowth',
      mean + g.persistence * (macro.gdpGrowth - mean) + rng.normal(0, g.volatility),
    );

    const pi = cfg.inflation;
    macro.inflation = applyModifiers(
      mods,
      'macro.inflation',
      pi.target + pi.persistence * (macro.inflation - pi.target) + rng.normal(0, pi.volatility),
    );

    const r = cfg.policyRate;
    const taylor =
      r.neutral +
      r.inflationWeight * (macro.inflation - pi.target) +
      r.growthWeight * (macro.gdpGrowth - g.trend);
    macro.baseRate = Math.max(r.floor, r.smoothing * macro.baseRate + (1 - r.smoothing) * taylor);
    macro.policyRate = Math.max(r.floor, applyModifiers(mods, 'macro.policyRate', macro.baseRate));

    const d = cfg.demand;
    macro.demandIndex = Math.exp(
      d.gapPersistence * Math.log(macro.demandIndex) +
        (d.gdpSensitivity * (macro.gdpGrowth - g.trend)) / 4,
    );
    macro.priceLevel *= 1 + macro.inflation / 4;
  },
};
