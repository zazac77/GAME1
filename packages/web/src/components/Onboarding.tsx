import { useEffect, useRef } from 'react';
import { fr } from '../i18n/fr';
import { useGame } from '../store/game';
import { Button } from './ui';

/**
 * The first-steps guide: a panel in a corner (not modal, the player follows
 * along on the screens), one step per screen to look at. Escape closes it.
 */
export function Onboarding() {
  const step = useGame((s) => s.guideStep);
  const openGuide = useGame((s) => s.openGuide);
  const closeGuide = useGame((s) => s.closeGuide);
  const heading = useRef<HTMLHeadingElement>(null);
  // Keyboard and screen reader users land on each new step.
  useEffect(() => {
    if (step !== null) heading.current?.focus();
  }, [step]);
  if (step === null) return null;
  const t = fr.onboarding;
  const steps = t.steps;
  const current = steps[step];
  if (!current) return null;
  const last = step === steps.length - 1;
  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="guide-title"
      aria-describedby="guide-body"
      className="fixed bottom-4 right-4 z-40 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border border-sky-200 bg-white p-4 shadow-xl"
      onKeyDown={(e) => {
        if (e.key === 'Escape') closeGuide();
      }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-sky-700">
          {t.title} · {t.step(step + 1, steps.length)}
        </span>
        <button
          type="button"
          className="rounded px-1 text-lg leading-none text-slate-600 hover:bg-slate-100"
          aria-label={t.close}
          title={t.close}
          onClick={closeGuide}
        >
          ×
        </button>
      </div>
      <h2 id="guide-title" ref={heading} tabIndex={-1} className="font-semibold">
        {current.title}
      </h2>
      <p id="guide-body" className="mt-1 text-sm text-slate-700">
        {current.body}
      </p>
      <div
        className="mt-3 h-1.5 w-full overflow-hidden rounded bg-slate-200"
        role="progressbar"
        aria-label={t.title}
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={step + 1}
      >
        <div
          className="h-full bg-sky-500"
          style={{ width: `${((step + 1) / steps.length) * 100}%` }}
        />
      </div>
      <div className="mt-3 flex justify-between gap-2">
        <Button disabled={step === 0} onClick={() => openGuide(step - 1)}>
          {t.previous}
        </Button>
        {last ? (
          <Button variant="primary" onClick={closeGuide}>
            {t.finish}
          </Button>
        ) : (
          <Button variant="primary" onClick={() => openGuide(step + 1)}>
            {t.next}
          </Button>
        )}
      </div>
    </section>
  );
}
