import { useId, useState, type ReactNode } from 'react';
import { fr, type GlossaryId } from '../i18n/fr';

/**
 * A word of the glossary: dotted underline, its definition in a tooltip on
 * hover or keyboard focus (Escape hides it). Screen readers get the
 * definition as the description of the word.
 */
export function Term(props: { id: GlossaryId; children?: ReactNode }) {
  const entry = fr.glossary[props.id];
  const tipId = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        tabIndex={0}
        aria-describedby={tipId}
        data-term={props.id}
        className="cursor-help underline decoration-slate-400 decoration-dotted underline-offset-2"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      >
        {props.children ?? entry.term}
      </span>
      <span
        id={tipId}
        role="tooltip"
        className={`${open ? 'block' : 'hidden'} absolute left-0 top-full z-30 mt-1 w-72 max-w-[80vw] rounded bg-slate-800 px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-white shadow-lg`}
      >
        <span className="block font-semibold">{entry.term}</span>
        {entry.definition}
      </span>
    </span>
  );
}
