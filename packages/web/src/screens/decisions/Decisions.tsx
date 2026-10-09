import { useState } from 'react';
import { Button, Notice, Tabs } from '../../components/ui';
import { fr } from '../../i18n/fr';
import { useGame } from '../../store/game';
import { CapexTab } from './CapexTab';
import { FinanceTab } from './FinanceTab';
import { HrTab } from './HrTab';
import { MarketingTab } from './MarketingTab';
import { PreviewPanel } from './PreviewPanel';
import { ProductionTab } from './ProductionTab';
import { PurchasingTab } from './PurchasingTab';

type TabId = keyof typeof fr.decisions.tabs;
const TABS = (Object.keys(fr.decisions.tabs) as TabId[]).map((id) => ({
  id,
  label: fr.decisions.tabs[id],
}));

export function Decisions() {
  const [tab, setTab] = useState<TabId>('production');
  const draft = useGame((s) => s.draft);
  const resetDraft = useGame((s) => s.resetDraft);
  // No decisions once the game is over (bankruptcy).
  if (!draft) return <Notice severity="critical">{fr.app.gameLost}</Notice>;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-600">{fr.decisions.resetHint}</p>
          <Button onClick={resetDraft}>{fr.decisions.reset}</Button>
        </div>
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
        <div className="rounded-b-lg border border-t-0 border-slate-200 bg-white p-4">
          {tab === 'production' && <ProductionTab />}
          {tab === 'hr' && <HrTab />}
          {tab === 'purchasing' && <PurchasingTab />}
          {tab === 'capex' && <CapexTab />}
          {tab === 'marketing' && <MarketingTab />}
          {tab === 'finance' && <FinanceTab />}
        </div>
      </div>
      <PreviewPanel />
    </div>
  );
}
