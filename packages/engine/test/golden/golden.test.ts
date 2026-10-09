import { describe, expect, it } from 'vitest';
import { hashState } from '../../src/core/hash';
import { newGame, playSteady } from '../helpers';

// Any change in the simulation shows up here. After an intentional balancing
// change, update with `npm test -- -u` and justify it in the commit message.
describe('golden game', () => {
  it('seed 20240 over 8 quarters', () => {
    const state = playSteady(newGame(20240), 8);
    const summary = {
      hash: hashState(state),
      turn: state.meta.turn,
      rng: state.meta.rng,
      companies: Object.values(state.companies).map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        revenue: Math.round(c.books.current.pnl.revenue),
        netIncome: Math.round(c.books.current.pnl.netIncome),
        cash: Math.round(c.books.current.balance.cash),
        equity: Math.round(c.books.current.balance.equity),
        price: Number(state.stock.quotes[c.id]?.price.toFixed(2)),
      })),
      macro: {
        regime: state.macro.regime,
        policyRate: Number(state.macro.policyRate.toFixed(4)),
        inflation: Number(state.macro.inflation.toFixed(4)),
      },
      market: Object.values(state.productMarkets).map((m) => ({
        volume: Math.round(m.lastResult.volume),
        avgPrice: Number(m.lastResult.avgPrice.toFixed(2)),
      })),
      events: state.log.filter((e) => e.kind === 'event').map((e) => [e.turn, e.data?.eventId]),
      spot: Object.fromEntries(
        Object.values(state.commodities).map((m) => [m.id, Number(m.spotPrice.toFixed(2))]),
      ),
    };
    expect(summary).toMatchSnapshot();
  });
});
