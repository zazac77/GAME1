import { describe, expect, it } from 'vitest';
import { hashState } from '../../src/core/hash';
import { newGame, playTurns } from '../helpers';

// Any change in the simulation shows up here. After an intentional balancing
// change, update with `npm test -- -u` and justify it in the commit message.
describe('golden game', () => {
  it('seed 20240 over 8 quarters', () => {
    const state = playTurns(newGame(20240), 8);
    const summary = {
      hash: hashState(state),
      turn: state.meta.turn,
      rng: state.meta.rng,
      companies: Object.values(state.companies).map((c) => ({
        id: c.id,
        name: c.name,
        cash: Math.round(c.books.current.balance.cash),
        equity: Math.round(c.books.current.balance.equity),
        price: Number(state.stock.quotes[c.id]?.price.toFixed(2)),
      })),
      spot: Object.fromEntries(
        Object.values(state.commodities).map((m) => [m.id, Number(m.spotPrice.toFixed(2))]),
      ),
    };
    expect(summary).toMatchSnapshot();
  });
});
