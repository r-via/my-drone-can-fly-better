// Profils drones du parc : seuils d'alerte adaptés à chaque machine.
// La détection se fait sur le craft name des headers blackbox (insensible à la casse).
// generic est TOUJOURS en dernier (craftMatch /./) : c'est le filet de sécurité.
// Les label/notes affichés vivent dans le dictionnaire i18n : dict.rules.profiles[id].

import type { DroneProfile, ProfileThresholds } from '../types';

// Base commune : valeurs médianes de la pratique Betaflight sur un 5" freestyle sain.
const GENERIC_THRESHOLDS: ProfileThresholds = {
  filtNoiseWarn: 3, // >3 deg/s RMS après filtres : les PID travaillent sur du bruit
  filtNoiseCrit: 8, // le tune devient impossible, moteurs chauds garantis
  unfiltNoiseWarn: 25, // gyro brut : vibration mécanique nette (hélice, roulement, visserie)
  unfiltNoiseCrit: 60, // niveau destructeur, inspection obligatoire avant de revoler
  trackingWarn: 8, // erreur moyenne >8 deg/s = suivi mou pour un tune correct
  trackingCrit: 20, // le quad ne suit plus la consigne, pilotage imprécis
  saturationWarn: 3, // >3 % d'échantillons moteur à fond = plus de marge d'autorité
  saturationCrit: 10, // saturation chronique : oscillations et perte de contrôle possibles
  imbalanceWarn: 12, // >12 pts d'écart entre moteurs : CG décalé ou hélice/moteur fatigué
  sagPerCellWarn: 0.4, // sag/cellule sous charge : 0.3-0.4 V normal, au-delà pack fatigué
  sagPerCellCrit: 0.6, // chute brutale : pack en fin de vie ou connectique résistive
  perCellMinCrit: 3.3, // sous 3.3 V/cellule en vol on abîme le pack (défaut BF vbat_min)
  overshootWarn: 25, // >25 % de dépassement : trop de P ou pas assez de D (réf. PIDtoolbox)
  riseTimeSlowMs: 60, // 10→90 % au-delà de 60 ms : réponse molle
  yoyoRatioWarn: 2.2, // sd(poussée)/sd(stick) - ATTENTION unités différentes (pas moteur vs µs stick) : ~1.8-2.0 = réponse proportionnelle normale, mesuré 1.47-1.98 sur vols sains du parc
  propwashWarn: 15, // RMS erreur <40 Hz en descente : >15 deg/s = wobble bien visible
  residualHfWarn: 150, // amplitude spectrale Welch >100 Hz ; sain mesuré 20-130 sur le parc, ~2× le pire
};

const PICO: DroneProfile = {
  id: 'pico',
  craftMatch: /pavo\s*pico/i, // craft name réel : "Pavo Pico"
  motorPoles: 12, // moteurs 1102
  expectedCells: 2,
  thresholds: {
    ...GENERIC_THRESHOLDS,
    filtNoiseWarn: 4, // châssis léger + conduits : plus de bruit résiduel toléré
    filtNoiseCrit: 10,
    unfiltNoiseWarn: 40, // les ducts renvoient l'air dans les hélices : brut élevé normal
    unfiltNoiseCrit: 90,
    trackingWarn: 10, // turbulences permanentes des conduits : suivi parfait impossible
    trackingCrit: 25,
    sagPerCellWarn: 0.45, // petites cellules 2S : sag plus marqué à courant égal
    sagPerCellCrit: 0.65,
    overshootWarn: 30, // masse plume : petits dépassements peu pénalisants
    riseTimeSlowMs: 70, // 1102 = autorité limitée, montée un peu plus lente
    yoyoRatioWarn: 1.3, // problème historique du Pico : on déclenche tôt
    propwashWarn: 20, // propwash inhérent aux cinewhoops ducted
    residualHfWarn: 250, // whoop ducted : 75-130 mesuré sain sur le Pico, marge ×2
  },
};

const LR4: DroneProfile = {
  id: 'lr4',
  craftMatch: /lr4/i, // craft name réel : "LR4-O4PRO"
  motorPoles: 12, // moteurs 1404
  expectedCells: 4,
  thresholds: {
    ...GENERIC_THRESHOLDS,
    trackingWarn: 6, // long range : suivi propre = moins de corrections = autonomie
    trackingCrit: 15,
    imbalanceWarn: 15, // CG arrière (GPS + pack LR) : un écart avant/arrière est normal
    sagPerCellWarn: 0.35, // l'autonomie dépend du pack : sag surveillé de près
    sagPerCellCrit: 0.55,
    overshootWarn: 20, // vol LR fluide : on ne veut aucun rebond en fin de mouvement
  },
};

const CHIMERA7: DroneProfile = {
  id: 'chimera7',
  craftMatch: /[cs]himera/i, // craft name réel : "SHIMERA7PRO"
  motorPoles: 14, // moteurs 2806.5
  expectedCells: 6,
  thresholds: {
    ...GENERIC_THRESHOLDS,
    unfiltNoiseWarn: 20, // bras longs de 7" = jello facile : on déclenche tôt sur le brut
    unfiltNoiseCrit: 45,
    residualHfWarn: 90, // 20-40 mesuré sain sur le Chimera ; grosses 2806.5 sensibles à la chauffe
    riseTimeSlowMs: 80, // inertie d'un 7" : montée naturellement plus lente qu'un 5"
  },
};

const GENERIC: DroneProfile = {
  id: 'generic',
  craftMatch: /./, // attrape tout : doit rester en dernier dans PROFILES
  motorPoles: 14, // valeur la plus courante (22xx/28xx)
  expectedCells: null, // pas de vérification du nombre de cellules
  thresholds: { ...GENERIC_THRESHOLDS },
};

export const PROFILES: DroneProfile[] = [PICO, LR4, CHIMERA7, GENERIC];

/** Choisit le profil selon le craft name du log ; generic si absent ou inconnu. */
export function pickProfile(craftName: string | undefined): DroneProfile {
  if (!craftName) return GENERIC;
  return PROFILES.find((p) => p.craftMatch.test(craftName)) ?? GENERIC;
}
