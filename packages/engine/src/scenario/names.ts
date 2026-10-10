// Fictional names drawn at world generation (content, not balancing).

export const COMPANY_NAMES: readonly string[] = [
  'Ardenne Électro',
  'Valmont Industries',
  'Brisach Ménager',
  'Coriolis Appareils',
  'Hexagone Équipements',
  'Saint-Clair Électroménager',
  'Novatherm',
  'Maison Lavergne',
];

export const EXECUTIVE_NAMES: readonly string[] = [
  'Claire Dumont',
  'Marc Lefèvre',
  'Sophie Garnier',
  'Julien Moreau',
  'Hélène Roussel',
  'Antoine Perrin',
  'Nadia Benali',
  'Thomas Girard',
];

/** Unlisted companies for sale ("pépites"), drawn by the M&A market. */
export const TARGET_NAMES: readonly string[] = [
  'Atelier Morvan',
  'Fermes du Val',
  'Logiciels Iroise',
  'Comptoir Duval',
  'Delta Systèmes',
  'Maison Peyrac',
  'Vergers de Loire',
  'Cyclone Data',
  'Forges Aubertin',
  'Laiterie Clément',
  'Opale Numérique',
  'Mécanique Rivière',
];

/** Name of the holding company created on top of a company. */
export const holdingName = (companyName: string): string => `${companyName} Holding`;
