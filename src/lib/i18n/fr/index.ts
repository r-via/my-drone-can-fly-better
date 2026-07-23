// Locale de référence : le français. Toutes les autres langues sont typées
// `Dict` (= typeof fr) - une clé manquante ou en trop ne compile pas.
import { compare } from './compare';
import { lint } from './lint';
import { rules } from './rules';
import { system } from './system';
import { ui } from './ui';

export const fr = { rules, lint, system, ui, compare } as const;

export type Dict = {
  rules: typeof rules;
  lint: typeof lint;
  system: typeof system;
  ui: typeof ui;
  compare: typeof compare;
};
