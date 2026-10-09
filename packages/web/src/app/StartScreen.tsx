import { useState } from 'react';
import type { GameMode } from '@game/engine';
import { SaveBrowser } from '../components/SaveBrowser';
import { Button, Card, NumberField, Select } from '../components/ui';
import { fr } from '../i18n/fr';
import { useGame } from '../store/game';

const randomSeed = () => Math.floor(Math.random() * 0xffffffff);

export function StartScreen() {
  const newGame = useGame((s) => s.newGame);
  const [playerName, setPlayerName] = useState(fr.start.defaultPlayer);
  const [companyName, setCompanyName] = useState(fr.start.defaultCompany);
  const [seed, setSeed] = useState(randomSeed);
  const [mode, setMode] = useState<GameMode>('standard');

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-3xl font-bold">{fr.app.title}</h1>
        <p className="text-slate-600">{fr.app.subtitle}</p>
      </header>
      <Card title={fr.start.heading}>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            newGame({ playerName, companyName, seed: seed >>> 0, mode });
          }}
        >
          <label className="space-y-1 text-sm">
            <span className="block text-slate-600">{fr.start.playerName}</span>
            <input
              className="w-full rounded border border-slate-300 px-2 py-1"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              required
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-slate-600">{fr.start.companyName}</span>
            <input
              className="w-full rounded border border-slate-300 px-2 py-1"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-slate-600">{fr.start.seed}</span>
            <span className="flex gap-2">
              <NumberField
                value={seed}
                min={0}
                className="w-40"
                onChange={(v) => v !== undefined && setSeed(Math.floor(v))}
              />
              <Button onClick={() => setSeed(randomSeed())}>{fr.start.randomSeed}</Button>
            </span>
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-slate-600">{fr.start.mode}</span>
            <Select
              value={mode}
              onChange={setMode}
              options={[
                { value: 'standard', label: fr.start.modes.standard },
                { value: 'sandbox', label: fr.start.modes.sandbox },
              ]}
            />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary">
              {fr.start.create}
            </Button>
          </div>
        </form>
      </Card>
      <Card title={fr.start.load}>
        <SaveBrowser />
      </Card>
    </div>
  );
}
