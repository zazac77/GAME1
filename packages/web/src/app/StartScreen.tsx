import { useState } from 'react';
import type { GameMode, SectorId } from '@game/engine';
import { SaveBrowser } from '../components/SaveBrowser';
import { Button, Card, NumberField, Select } from '../components/ui';
import { fr } from '../i18n/fr';
import { useGame } from '../store/game';

const randomSeed = () => Math.floor(Math.random() * 0xffffffff);

const SECTORS: SectorId[] = ['industry', 'agri', 'tech'];

export function StartScreen() {
  const newGame = useGame((s) => s.newGame);
  const [playerName, setPlayerName] = useState(fr.start.defaultPlayer);
  const [sector, setSector] = useState<SectorId>('industry');
  const [companyName, setCompanyName] = useState<string>(fr.start.defaultCompanies.industry);
  const [seed, setSeed] = useState(randomSeed);
  const [mode, setMode] = useState<GameMode>('standard');
  const [activist, setActivist] = useState(false);

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
            newGame({ playerName, companyName, seed: seed >>> 0, mode, sector, activist });
          }}
        >
          <fieldset className="space-y-2 text-sm sm:col-span-2">
            <legend className="mb-1 text-slate-600">{fr.start.sector}</legend>
            <div className="grid gap-3 md:grid-cols-3">
              {SECTORS.map((id) => {
                const info = fr.start.sectors[id];
                const checked = id === sector;
                return (
                  <label
                    key={id}
                    className={`cursor-pointer rounded-lg border p-3 ${
                      checked ? 'border-sky-500 bg-sky-50' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      <input
                        type="radio"
                        name="sector"
                        value={id}
                        checked={checked}
                        onChange={() => {
                          // Keep a name the player typed; swap only the suggested one.
                          if (companyName === fr.start.defaultCompanies[sector]) {
                            setCompanyName(fr.start.defaultCompanies[id]);
                          }
                          setSector(id);
                        }}
                      />
                      {info.title}
                    </span>
                    <span className="mt-1 block text-slate-600">{info.pitch}</span>
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-500">
                      {info.traits.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </label>
                );
              })}
            </div>
          </fieldset>
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
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={activist}
              onChange={(e) => setActivist(e.target.checked)}
            />
            <span>
              <span className="block font-medium">{fr.start.activist}</span>
              <span className="block text-slate-500">{fr.start.activistHint}</span>
            </span>
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
