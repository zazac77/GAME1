import type { PlayerView, SectorId } from '@game/engine';
import { fmtMoney, fmtPct, quarterLabel } from '../i18n/format';
import { fr, marketName } from '../i18n/fr';
import { Card, ProgressBar, Stat } from './ui';

/** The objective of the mode, the progress towards it and the end of the game. */
export function ObjectiveCard({ view }: { view: PlayerView }) {
  const o = view.objective;
  const t = fr.objective;
  const quarters = o.quarters ?? 0;
  return (
    <Card title={`${t.heading} · ${fr.start.modes[o.mode]}`}>
      <p className="mb-2 text-sm text-slate-600">{fr.start.modeHints[o.mode]}</p>
      <Stat label={t.difficulty} value={fr.start.difficulties[view.difficulty]} />
      <Stat
        label={t.deadline}
        value={o.lastTurn !== undefined ? quarterLabel(o.lastTurn) : t.noEnd}
      />
      {o.mode === 'capitalization' && (
        <>
          <Stat label={t.score} value={fmtMoney(o.score ?? 0)} />
          <Stat label={t.target} value={fmtMoney(o.target ?? 0)} />
        </>
      )}
      {o.mode === 'domination' && (
        <>
          <p className="text-sm">{t.share(fmtPct(o.share ?? 0, 0), quarters)}</p>
          {o.bestMarketId && (
            <Stat
              label={`${t.bestMarket} : ${marketName(o.bestMarketId)}`}
              value={`${fmtPct(o.bestShare ?? 0)} · ${t.streak(o.streak ?? 0, quarters)}`}
            />
          )}
        </>
      )}
      {o.mode === 'conglomerate' && (
        <>
          <p className="text-sm">{t.sectors(o.sectors ?? 0, quarters)}</p>
          {Object.keys(o.sectorStreaks ?? {}).length === 0 ? (
            <p className="text-sm text-slate-500">{t.noSector}</p>
          ) : (
            (Object.entries(o.sectorStreaks ?? {}) as [SectorId, number][]).map(([sector, n]) => (
              <Stat key={sector} label={fr.sectors[sector]} value={t.sectorStreak(n, quarters)} />
            ))
          )}
        </>
      )}
      {o.mode === 'survival' && o.lastTurn !== undefined && (
        <p className="text-sm">{t.survive(o.lastTurn + 1)}</p>
      )}
      {o.mode === 'sandbox' ? (
        <p className="text-sm text-slate-500">{t.sandbox}</p>
      ) : (
        <div className="mt-2 space-y-1">
          <div className="text-xs text-slate-500">
            {t.progress} : {fmtPct(o.progress, 0)}
          </div>
          <ProgressBar value={o.progress} />
        </div>
      )}
    </Card>
  );
}
