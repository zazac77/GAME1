import { useEffect, useRef, useState } from 'react';
import { Onboarding } from '../components/Onboarding';
import { Term } from '../components/Term';
import { Button, Notice, Select } from '../components/ui';
import { fmtMoney, quarterLabel } from '../i18n/format';
import { fr } from '../i18n/fr';
import { Bourse } from '../screens/Bourse';
import { Competitors } from '../screens/Competitors';
import { Dashboard } from '../screens/Dashboard';
import { Deals } from '../screens/Deals';
import { Glossary } from '../screens/Glossary';
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
  { id: 'glossary', label: fr.nav.glossary },
];

export function Layout() {
  const view = useGame((s) => s.view);
  const screen = useGame((s) => s.screen);
  const navigate = useGame((s) => s.navigate);
  const endTurn = useGame((s) => s.endTurn);
  const quit = useGame((s) => s.quit);
  const storageError = useGame((s) => s.storageError);
  const selectCompany = useGame((s) => s.selectCompany);
  const openGuide = useGame((s) => s.openGuide);
  const [busy, setBusy] = useState(false);
  // Announced to screen readers once a quarter is resolved.
  const [announcement, setAnnouncement] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const firstScreen = useRef(true);
  const screenLabel = SCREENS.find((s) => s.id === screen)?.label ?? '';
  // A new screen: the tab title follows, and the focus moves to its heading
  // (not on the first render: the player has not moved yet).
  useEffect(() => {
    document.title = `${screenLabel} · ${fr.app.title}`;
    // The guide, when open, keeps the focus on its own step.
    if (firstScreen.current) firstScreen.current = false;
    else if (useGame.getState().guideStep === null) heading.current?.focus();
  }, [screenLabel]);
  if (!view) return null;

  const running = view.status === 'running';
  const group = view.groupCompanies.filter(
    (c) => c.status === 'active' || c.status === 'distressed',
  );
  const lastTurn = view.objective.lastTurn;
  const outcome = view.objective.outcome;
  const onEndTurn = async () => {
    setBusy(true);
    // Let the button repaint before the (synchronous) resolution.
    await new Promise((r) => setTimeout(r, 0));
    try {
      await endTurn();
      const after = useGame.getState().view;
      if (after) setAnnouncement(fr.a11y.turnResolved(quarterLabel(after.turn)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded bg-white px-3 py-2 text-sm font-medium text-sky-800 shadow focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
      >
        {fr.a11y.skipToContent}
      </a>
      <div className="sr-only" aria-live="polite" role="status">
        {announcement}
      </div>
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
          {lastTurn !== undefined && (
            <span className="text-slate-500">
              {' '}
              ({fr.app.turnOf(Math.min(view.turn + 1, lastTurn + 1), lastTurn + 1)})
            </span>
          )}
        </div>
        <div className="text-sm">
          <span className="text-slate-500">
            <Term id="cash">{fr.app.cash}</Term>{' '}
          </span>
          <span className="font-semibold tabular-nums">
            {fmtMoney(view.self.company.books.current.balance.cash)}
          </span>
        </div>
        <div className="text-sm">
          <span className="text-slate-500">
            <Term id="score">{fr.app.score}</Term>{' '}
          </span>
          <span className="font-semibold tabular-nums">{fmtMoney(view.score)}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" onClick={() => openGuide()}>
            {fr.onboarding.open}
          </Button>
          <Button variant="ghost" onClick={quit}>
            {fr.app.quit}
          </Button>
          <Button variant="primary" onClick={onEndTurn} disabled={!running || busy} ariaBusy={busy}>
            {busy ? fr.app.resolving : fr.app.endTurn}
          </Button>
        </div>
      </header>
      <div className="flex flex-1">
        <nav
          aria-label={fr.a11y.mainNav}
          className="w-44 shrink-0 border-r border-slate-200 bg-white p-2"
        >
          <ul className="space-y-1">
            {SCREENS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  aria-current={s.id === screen ? 'page' : undefined}
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
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 space-y-4 p-4">
          <h1 ref={heading} tabIndex={-1} className="sr-only">
            {screenLabel}
          </h1>
          {outcome && (
            <Notice severity={outcome.status === 'won' ? 'info' : 'critical'}>
              {fr.app.outcome[outcome.reason]}
            </Notice>
          )}
          {!outcome && view.status === 'lost' && (
            <Notice severity="critical">{fr.app.outcome.bankruptcy}</Notice>
          )}
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
          {screen === 'glossary' && <Glossary />}
        </main>
      </div>
      <Onboarding />
    </div>
  );
}
