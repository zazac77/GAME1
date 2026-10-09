import { deserializeGame } from '@game/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { quarterLabel } from '../i18n/format';
import { fr } from '../i18n/fr';
import { downloadText } from '../persistence/download';
import { exportFileName, importJson, type SaveMeta } from '../persistence/saves';
import { useGame } from '../store/game';
import { Button, Notice } from './ui';

/** Lists slots and autosaves; load, delete, export; import a .json file. */
export function SaveBrowser(props: { confirmLoad?: boolean; refreshKey?: number }) {
  const saves = useGame((s) => s.saves);
  const loadGame = useGame((s) => s.loadGame);
  const [list, setList] = useState<SaveMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    saves
      .list()
      .then(setList)
      .catch((e: unknown) => setError(fr.saves.storageError + String(e)));
  }, [saves]);
  useEffect(refresh, [refresh, props.refreshKey]);

  const load = async (key: string) => {
    if (props.confirmLoad && !window.confirm(fr.saves.confirmLoad)) return;
    try {
      loadGame(await saves.load(key));
    } catch (e) {
      setError(String(e));
    }
  };
  const exportSave = async (key: string) => {
    try {
      const file = await saves.file(key);
      downloadText(exportFileName(deserializeGame(file)), JSON.stringify(file));
    } catch (e) {
      setError(String(e));
    }
  };
  const remove = async (key: string) => {
    await saves.remove(key);
    refresh();
  };
  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const state = importJson(await file.text());
      if (props.confirmLoad && !window.confirm(fr.saves.confirmLoad)) return;
      loadGame(state);
    } catch (e) {
      setError(fr.saves.importError + (e instanceof Error ? e.message : String(e)));
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const section = (title: string, items: SaveMeta[]) => (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-slate-700">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{fr.saves.empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
              <span className="font-medium">{s.name}</span>
              <span className="text-slate-500">
                {s.companyName} · {quarterLabel(s.turn)} ·{' '}
                {new Date(s.savedAt).toLocaleString('fr-FR')}
              </span>
              <span className="ml-auto flex gap-1">
                <Button onClick={() => void load(s.key)}>{fr.saves.load}</Button>
                <Button onClick={() => void exportSave(s.key)}>{fr.saves.export}</Button>
                <Button variant="danger" onClick={() => void remove(s.key)}>
                  {fr.saves.delete}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {error && <Notice severity="critical">{error}</Notice>}
      {section(
        fr.saves.slots,
        list.filter((s) => s.kind === 'slot'),
      )}
      {section(
        fr.saves.autosaves,
        list.filter((s) => s.kind === 'auto'),
      )}
      <div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
          {fr.saves.import}
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            data-testid="import-file"
            onChange={(e) => void onImport(e.target.files?.[0])}
          />
        </label>
      </div>
    </div>
  );
}
