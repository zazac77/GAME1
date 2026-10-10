import { expect, test } from '@playwright/test';

// Lot 3.5 (docs/PLAN.md): a new game, the first-steps guide, a decision, three
// quarters played to the end, the autosaves, the glossary and a tooltip.
test('plays three quarters from a new game', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Nouvelle partie' })).toBeVisible();
  await page.getByLabel(/Graine/).fill('2024');
  await page.getByRole('button', { name: 'Créer la partie' }).click();

  // The guide opens with the first game and walks the screens.
  const guide = page.getByRole('dialog', { name: 'Bienvenue à la tête de votre société' });
  await expect(guide).toBeVisible();
  await expect(page.getByTestId('quarter')).toHaveText('T1 an 1');
  await guide.getByRole('button', { name: 'Suivant' }).click();
  await expect(page.getByRole('dialog', { name: 'Prenez vos décisions' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Prenez vos décisions' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Production & prix' })).toBeVisible();
  await page.getByRole('button', { name: 'Fermer le guide' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // A decision: a slightly higher price, then the tabs by keyboard.
  const price = page.getByLabel('Prix de vente').first();
  const before = Number((await price.inputValue()).replace(/\s/g, '').replace(',', '.'));
  expect(before).toBeGreaterThan(0);
  await price.fill(String(Math.round(before * 1.02)).replace('.', ','));
  await price.blur();
  await expect(page.getByTestId('preview')).toBeVisible();
  await page.getByRole('tab', { name: 'Production & prix' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'RH' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'RH' })).toBeFocused();

  // Three quarters, each ending on the turn report.
  const quarters = ['T2 an 1', 'T3 an 1', 'T4 an 1'];
  for (const quarter of quarters) {
    await page.getByRole('button', { name: 'Fin du trimestre' }).click();
    await expect(page.getByTestId('quarter')).toHaveText(quarter);
    await expect(page.getByRole('heading', { name: 'Rapport de tour', level: 1 })).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'Trimestre résolu' })).toHaveText(
      new RegExp(quarter),
    );
    await page.getByRole('button', { name: 'Décisions' }).click();
  }

  // The dashboard after three quarters, with a tooltip from the glossary.
  await page
    .getByRole('navigation', { name: 'Navigation principale' })
    .getByRole('button', {
      name: 'Tableau de bord',
    })
    .click();
  await expect(page.getByRole('button', { name: 'Tableau de bord' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const term = page.locator('main [data-term="revenue"]').first();
  await term.focus();
  await expect(
    page.getByRole('tooltip').filter({ hasText: 'Les ventes du trimestre' }),
  ).toBeVisible();

  // Every quarter was autosaved.
  await page.getByRole('button', { name: 'Sauvegardes' }).click();
  await expect(page.getByText(/T4 an 1/).first()).toBeVisible();

  // The glossary, searched without accents.
  await page.getByRole('button', { name: 'Glossaire' }).click();
  await page.getByLabel('Rechercher un terme').fill('pilule empoisonnee');
  await expect(page.getByText('Pilule empoisonnée', { exact: true })).toBeVisible();
  await expect(page.getByText('EBITDA', { exact: true })).toHaveCount(0);

  expect(errors).toEqual([]);
});
