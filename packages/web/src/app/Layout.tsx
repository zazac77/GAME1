import { useState } from 'react';
import { Button, Notice, Select } from '../components/ui';
import { fmtMoney, quarterLabel } from '../i18n/format';
import { fr } from '../i18n/fr';
import { Bourse } from '../screens/Bourse';
import { Competitors } from '../screens/Competitors';
import { Dashboard } from '../screens/Dashboard';
import { Deals } from '../screens/Deals';
import { Group } from '../screens/Group';
import { Decisions } from '../screens/decisions/Decisions';
import { Markets } from '../screens/Markets';
import { Saves } from '../screens/Saves';
import { TurnReportScreen } from '../screens/TurnReport';
import { useGame, type ScreenId } from '../store/game';

const SCREENS: { id: ScreenId; label: string }[] = [
  { id: 'dashboard', label: fr.nav.dashboard },
  { id: 'decisions', label: fr.nav.decisions },
  { id: 'markets', label: fr.nav.markets },
  { id: 'competitors', label: fr.nav.competitors },
  { id: 'bourse', label: fr.nav.bourse },
  { id: 'deals', label: fr.nav.deals },
  { id: 'group', label: fr.nav.group },
  { id: 'report', label: fr.nav.report },
  { id: 'saves', label: fr.nav.saves },
];

export function Layout() {
  const view = useGame((s) => s.view);
  const screen = useGame((s) => s.screen);
  const navigate = useGame((s) => s.navigate);
  const endTurn = useGame((s) => s.endTurn);
  const quit = useGame((s) => s.quit);
  const storageError = useGame((s) => s.storageError);
  const selectCompany = useGame((s) => s.selectCompany);
  const [busy, setBusy] = useState(false);
  if (!view) return null;

  const running = view.status === 'running';
  const group = view.groupCompanies.filter(
    (c) => c.status === 'active' || c.status === 'distressed',
  );
  const gameTurns = view.config.time.standardGameTurns;
  const over = view.mode === 'standard' && view.turn >= gameTurns;
  const onEndTurn = async () => {
    setBusy(true);
    // Let the button repaint before the (synchronous) resolution.
    await new Promise((r) => setTimeout(r, 0));
    try {
      await endTurn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-200 bg-white px-4 py-2 shadow-sm">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">{fr.app.title}</div>
          {group.length > 1 ? (
            <Select
              ariaLabel={fr.app.activeCompany}
              className="font-semibold"
              value={view.companyId}
              onChange={selectCompany}
              options={group.map((c) => ({
                value: c.companyId,
                label: c.isRoot ? c.name : `${c.name} (${fr.app.subsidiary})`,
              }))}
            />
          ) : (
            <div className="font-semibold">{view.self.company.name}</div>
          )}
        </div>
        <div className="text-sm">
          <span className="text-slate-500">{fr.app.quarter} </span>
          <span className="font-semibold" data-testid="quarter">
            {quarterLabel(view.turn)}
          </span>
          {view.mode === 'standard' && (
            <span className="text-slate-400">
              {' '}
              ({Math.min(view.turn + 1, gameTurns)}/{gameTurns})
            </span>
          )}
        </div>
        <div className="text-sm">
          <span className="text-slate-500">{fr.app.cash} </span>
          <span className="font-semibold tabular-nums">
            {fmtMoney(view.self.company.books.current.balance.cash)}
          </span>
        </div>
        <div className="text-sm">
          <span className="text-slate-500">{fr.app.score} </span>
          <span className="font-semibold tabular-nums">{fmtMoney(view.score)}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" onClick={quit}>
            {fr.app.quit}
          </Button>
          <Button variant="primary" onClick={onEndTurn} disabled={!running || busy}>
            {busy ? fr.app.resolving : fr.app.endTurn}
          </Button>
        </div>
      </header>
      <div className="flex flex-1">
        <nav className="w-44 shrink-0 border-r border-slate-200 bg-white p-2">
          <ul className="space-y-1">
            {SCREENS.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => navigate(s.id)}
                  className={`w-full rounded px-3 py-2 text-left text-sm ${
                    s.id === screen
                      ? 'bg-sky-50 font-semibold text-sky-800'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 flex-1 space-y-4 p-4">
          {view.status === 'lost' && <Notice severity="critical">{fr.app.gameLost}</Notice>}
          {running && over && <Notice severity="info">{fr.app.gameOver(gameTurns)}</Notice>}
          {storageError && (
            <Notice severity="warning">
              {fr.saves.storageError}
              {storageError}
            </Notice>
          )}
          {screen === 'dashboard' && <Dashboard />}
          {screen === 'decisions' && <Decisions />}
          {screen === 'markets' && <Markets />}
          {screen === 'competitors' && <Competitors />}
          {screen === 'bourse' && <Bourse />}
          {screen === 'deals' && <Deals />}
          {screen === 'group' && <Group />}
          {screen === 'report' && <TurnReportScreen />}
          {screen === 'saves' && <Saves />}
        </main>
      </div>
    </div>
  );
}
