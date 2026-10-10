import { useState } from 'react';
import { Card } from '../components/ui';
import { fr, GLOSSARY_CATEGORIES, type GlossaryId } from '../i18n/fr';

const ENTRIES = Object.entries(fr.glossary) as [GlossaryId, (typeof fr.glossary)[GlossaryId]][];

/** Accents and case do not matter to the search. */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export function Glossary() {
  const [query, setQuery] = useState('');
  const t = fr.glossaryScreen;
  const q = fold(query.trim());
  const matches = ENTRIES.filter(
    ([, e]) => q === '' || fold(e.term).includes(q) || fold(e.definition).includes(q),
  );
  return (
    <div className="space-y-4">
      <Card title={fr.nav.glossary}>
        <p className="mb-3 text-sm text-slate-600">{t.intro}</p>
        <label className="block max-w-sm space-y-1 text-sm">
          <span className="block text-slate-600">{t.search}</span>
          <input
            type="search"
            className="w-full rounded border border-slate-300 px-2 py-1"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </Card>
      {matches.length === 0 && (
        <p className="text-sm text-slate-600" role="status">
          {t.noMatch}
        </p>
      )}
      {GLOSSARY_CATEGORIES.map((category) => {
        const entries = matches
          .filter(([, e]) => e.category === category)
          .sort(([, a], [, b]) => a.term.localeCompare(b.term, 'fr'));
        if (entries.length === 0) return null;
        return (
          <Card key={category} title={t.categories[category]}>
            <dl className="grid gap-x-6 gap-y-3 md:grid-cols-2">
              {entries.map(([id, e]) => (
                <div key={id} id={`glossary-${id}`}>
                  <dt className="font-semibold">{e.term}</dt>
                  <dd className="text-sm text-slate-700">{e.definition}</dd>
                </div>
              ))}
            </dl>
          </Card>
        );
      })}
    </div>
  );
}
