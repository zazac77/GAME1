import { useState } from 'react';
import { SaveBrowser } from '../components/SaveBrowser';
import { Button, Card, Notice } from '../components/ui';
import { fr } from '../i18n/fr';
import { downloadText } from '../persistence/download';
import { exportFileName, exportJson } from '../persistence/saves';
import { useGame } from '../store/game';

export function Saves() {
  const game = useGame((s) => s.game);
  const saves = useGame((s) => s.saves);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  if (!game) return null;
  const t = fr.saves;

  const save = async () => {
    try {
      await saves.save(game, name);
      setMessage(t.saved);
      setRefresh((r) => r + 1);
    } catch (e) {
      setMessage(t.storageError + String(e));
    }
  };

  return (
    <div className="space-y-4">
      <Card title={t.heading}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-sm">
            <span className="block text-slate-600">{t.slotName}</span>
            <input
              className="w-64 rounded border border-slate-300 px-2 py-1"
              value={name}
              placeholder={
                game.companies[game.actors[game.meta.playerActorId]?.rootCompanyId ?? '']?.name
              }
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <Button variant="primary" onClick={() => void save()}>
            {t.save}
          </Button>
          <Button onClick={() => downloadText(exportFileName(game), exportJson(game))}>
            {t.exportCurrent}
          </Button>
        </div>
        {message && (
          <div className="mt-3">
            <Notice severity="info">{message}</Notice>
          </div>
        )}
      </Card>
      <Card>
        <SaveBrowser confirmLoad refreshKey={refresh} />
      </Card>
    </div>
  );
}
