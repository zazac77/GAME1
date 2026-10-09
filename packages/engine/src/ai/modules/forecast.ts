import type { Plan } from './plan';

/**
 * 1. Forecasts by exponential smoothing: deseasonalized demand addressed to
 * the main product line (before stock limits) and commodity world prices
 * (the spot price of last quarter mostly reflects last quarter's demand).
 */
export function forecast(plan: Plan): void {
  const { obs, config, memory, market, line } = plan;
  const a = config.ai.forecastSmoothing;
  const seasonality = config.products.markets[market.id]?.seasonality ?? [1, 1, 1, 1];
  const season = (turn: number) => seasonality[((turn % 4) + 4) % 4] ?? 1;

  const allocated = market.lastResult.allocated[line.id];
  if (obs.turn > 0 && allocated !== undefined) {
    const observed = allocated / season(obs.turn - 1);
    memory.demandForecast =
      memory.demandForecast < 0
        ? observed
        : memory.demandForecast + a * (observed - memory.demandForecast);
  }
  if (memory.demandForecast < 0) {
    memory.demandForecast =
      (obs.self.outputCeiling * config.ai.initialDemandShareOfCapacity) / season(obs.turn);
  }
  plan.forecast = memory.demandForecast * season(obs.turn);
  plan.nextForecast = memory.demandForecast * season(obs.turn + 1);

  for (const [id, market] of Object.entries(obs.commodities)) {
    const previous = memory.priceForecast[id];
    memory.priceForecast[id] =
      previous === undefined ? market.worldPrice : previous + a * (market.worldPrice - previous);
  }
}
