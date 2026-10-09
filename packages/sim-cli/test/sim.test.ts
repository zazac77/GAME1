import { describe, expect, it } from 'vitest';
import { firstSustained, gameMetrics, median, std, summarize } from '../src/metrics';
import { formatSummary, toCsv } from '../src/report';
import { runGame } from '../src/run';

describe('sim-cli', () => {
  it('computes robust statistics', () => {
    expect(std([1, 1, 1])).toBe(0);
    expect(std([1, 3])).toBeCloseTo(Math.SQRT2, 12);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it('finds the first sustained lead', () => {
    expect(firstSustained([true, false, true, true, true], 3)).toBe(2);
    expect(firstSustained([false, true, false, true], 2)).toBe(3); // ahead until the end
    expect(firstSustained([true, false], 2)).toBeNull();
    expect(firstSustained([], 2)).toBeNull();
  });

  // Acceptance of lot 1.3 (docs/PLAN.md): AI-only games without errors, within
  // the sanity bounds, with at least one profitable AI and no systematic bankruptcy.
  it('plays 50 AI-only games of 40 quarters', () => {
    const games = Array.from({ length: 50 }, (_, i) =>
      gameMetrics(runGame({ seed: 1000 + i, turns: 40, player: 'opportunist' })),
    );
    const summary = summarize(games);
    expect(summary.errors).toBe(0);
    expect(games.flatMap((g) => g.sanityViolations)).toEqual([]);
    expect(games.every((g) => g.turns === 40)).toBe(true);
    expect(summary.gamesWithProfitableAi).toBe(50);
    expect(summary.gamesWithAllAiBankrupt).toBe(0);
    for (const profile of Object.values(summary.byProfile)) {
      expect(profile.bankruptcyRate).toBeLessThan(0.5);
    }
    expect(formatSummary(summary, 40)).toContain('50 × 40');
    const companies = games.reduce((n, g) => n + g.companies.length, 0);
    expect(toCsv(games).trim().split('\n')).toHaveLength(1 + companies);
    expect(games.every((g) => g.companies.filter((c) => c.kind !== 'acquired').length === 10)).toBe(
      true,
    );
    expect(Object.keys(summary.bySector).sort()).toEqual(['agri', 'industry', 'tech']);
  }, 120_000);

  it('a passive player (same decisions every quarter) does not win', () => {
    const games = [7, 8, 9].map((seed) =>
      gameMetrics(runGame({ seed, turns: 40, player: 'passive' })),
    );
    for (const g of games) {
      const player = g.companies.find((c) => c.kind === 'player');
      const best = Math.max(
        ...g.companies.filter((c) => c.kind === 'ai').map((c) => c.finalEquity),
      );
      expect(player?.finalEquity ?? 0).toBeLessThan(best);
      expect(g.playerRank).toBeGreaterThan(1);
    }
  }, 60_000);

  it('runs a player in tech: on autopilot it lives, passive it does not win', () => {
    const overrides = { scenario: { playerSector: 'tech' as const } };
    for (const seed of [11, 12]) {
      const auto = gameMetrics(runGame({ seed, turns: 40, player: 'premium', overrides }));
      expect(auto.error).toBeUndefined();
      expect(auto.sanityViolations).toEqual([]);
      expect(auto.companies.find((c) => c.kind === 'player')?.status).not.toBe('bankrupt');
      const passive = gameMetrics(runGame({ seed, turns: 40, player: 'passive', overrides }));
      expect(passive.error).toBeUndefined();
      expect(passive.playerRank).toBeGreaterThan(1);
    }
  }, 60_000);
});
