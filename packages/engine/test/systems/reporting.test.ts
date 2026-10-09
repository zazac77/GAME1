import { describe, expect, it } from 'vitest';
import { recordHistory, trimLog } from '../../src/systems/reporting/history';
import { newGame, playTurns } from '../helpers';

describe('reporting', () => {
  it('records one point per series and per quarter', () => {
    const state = playTurns(newGame(), 3);
    expect(state.history.turns).toEqual([0, 1, 2, 3]);
    const companyId = Object.keys(state.companies)[0];
    expect(state.history.series[`company.${companyId}.cash`]).toHaveLength(4);
    expect(state.history.series['macro.inflation']).toHaveLength(4);
    expect(state.history.series['labor.reg_nord:occ_operator.marketWage']).toHaveLength(4);
  });

  it('bounds history and log', () => {
    const state = newGame(1, { reporting: { historyMaxLength: 3, logMaxEntries: 2 } });
    for (let i = 0; i < 5; i++) {
      state.meta.turn += 1;
      recordHistory(state);
      state.log.push({ turn: state.meta.turn, kind: 'x', severity: 'info' });
      trimLog(state);
    }
    expect(state.history.turns).toEqual([3, 4, 5]);
    expect(state.history.series['stock.index']).toHaveLength(3);
    expect(state.log.map((e) => e.turn)).toEqual([4, 5]);
  });
});
