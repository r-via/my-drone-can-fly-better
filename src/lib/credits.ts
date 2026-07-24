// Remerciements : contributeurs affichés en bas de la page d'accueil,
// regroupés par communauté. Les noms sont des noms propres - jamais traduits,
// affichés tels quels. La section n'apparaît que si au moins un groupe a des
// membres.

type Contributor = {
  /** Pseudo (Discord ou autre), affiché tel quel. */
  name: string;
  /** Lien optionnel (profil GitHub, chaîne YouTube…). */
  url?: string;
};

export type CreditGroup = {
  /** Nom de la communauté (ou du groupe). */
  name: string;
  /** Clé de traduction du titre : posée quand le nom est un libellé générique
   *  (« Professionnels ») et non un nom propre. Le composant la résout via
   *  dict.ui.credits.groups ; `name` reste le repli. */
  labelKey?: 'professionals';
  /** Lien optionnel (invitation Discord, site…). */
  url?: string;
  members: ReadonlyArray<Contributor>;
};

export const CREDIT_GROUPS: ReadonlyArray<CreditGroup> = [
  {
    name: 'WE are FPV',
    url: 'https://discord.com/invite/p3MZc4MpTa',
    members: [
      { name: 'Feisar', url: 'https://www.youtube.com/@feisarfpv' },
      { name: '(outea)' },
    ],
  },
  {
    name: 'Professionals',
    labelKey: 'professionals',
    members: [{ name: 'puzzlemedia.ch', url: 'https://www.puzzlemedia.ch/' }],
  },
];
