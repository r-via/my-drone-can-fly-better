// Contrats partagés de My Drone Can Fly Better - analyse blackbox Betaflight 100 % déterministe.
// Unités normalisées dans FlightData : temps en s, gyro/setpoint en deg/s,
// vbat en V, courant en A, altitude en m. motor/erpm restent bruts (voir meta).

export type Axis = 0 | 1 | 2; // 0=Roll 1=Pitch 2=Yaw
export const AXIS_NAMES = ['Roll', 'Pitch', 'Yaw'] as const;

export interface SessionMeta {
  index: number; // index de session dans le fichier (0-based)
  fileName: string;
  craftName?: string;
  boardInfo?: string;
  firmware: string; // chaîne originale, ex. "Betaflight 2025.12.2 (79065c96b) STM32F7X2"
  /** Absent = betaflight (liens partagés antérieurs, metas synthétiques des tests). */
  firmwareFamily?: 'betaflight' | 'inav';
  debugMode?: string;
  fieldNames: string[];
  sampleRateHz: number; // mesuré (médiane des dt)
  durationS: number;
  frameCount: number;
  motorOutputLow: number; // header motorOutput (défaut 48)
  motorOutputHigh: number; // défaut 2047
  /** Toutes les lignes "H clé:valeur" de la session (snapshot config du firmware). */
  headers: Record<string, string>;
  /** Frames au temps aberrant (re-base flash, wrap µs 32 bits) corrigées au dt nominal. */
  timeAnomalies?: number;
}

export type F32x3 = [Float32Array, Float32Array, Float32Array];
export type F32x4 = [Float32Array, Float32Array, Float32Array, Float32Array];

export interface FlightData {
  meta: SessionMeta;
  time: Float64Array; // secondes, démarre à ~0
  gyro: F32x3; // gyro filtré, deg/s
  gyroUnfilt: F32x3 | null; // deg/s
  setpoint: F32x3; // deg/s
  throttle: Float32Array; // rcCommand[3], ~1000..2000
  motor: F32x4; // brut (voir meta.motorOutputLow/High)
  erpm: F32x4 | null; // brut : centaines d'eRPM (hz méca = v*100/(poles/2)/60)
  vbat: Float32Array | null; // volts
  amperage: Float32Array | null; // ampères
  baroAlt: Float32Array | null; // mètres
  axisP: F32x3 | null;
  axisI: F32x3 | null;
  axisD: [Float32Array | null, Float32Array | null, Float32Array | null] | null;
  axisF: F32x3 | null;
  /** Séries G-frame. time est ancré sur la frame main précédente : l'horodatage
   *  propre aux frames G est trop souvent corrompu pour être utilisable.
   *  hdop est en unités x1 (2.4 = médiocre), null hors INAV. */
  gps: {
    time: Float64Array;
    numSat: Float32Array;
    speedMps: Float32Array;
    hdop: Float32Array | null;
  } | null;
  failsafePhaseCounts: Record<string, number>;
}

export interface SkippedSession {
  index: number;
  fileName: string;
  sizeBytes: number;
  error: string;
}

export interface ParsedFile {
  fileName: string;
  sessions: FlightData[];
  skipped: SkippedSession[];
}

// ---------------------------------------------------------------------------
// Métriques par module d'analyse
// ---------------------------------------------------------------------------

export interface PowerMetrics {
  cells: number; // détecté depuis vbat max
  vbatMax: number; // V
  vbatMin: number; // V
  perCellMax: number;
  perCellMin: number;
  sagV: number;
  ampAvg: number | null;
  ampMax: number | null;
  /** Pic de courant soutenu (p99) : référence robuste face aux pointes ADC. */
  ampP99: number | null;
  /**
   * Vrai quand le canal courant décroche comme le canal vbat : pointes isolées
   * très au-dessus du pic soutenu, sur un vol où vbat est déjà incohérent.
   * ampMax est alors une lecture de capteur, pas un courant - l'afficher comme
   * un fait induirait en erreur (mesuré 326 A sur un AIO F722).
   */
  ampImplausible: boolean;
  mahEstimate: number | null; // intégrale du courant
  /**
   * Tension par cellule mini SOUTENUE (min d'une médiane glissante 1 s), par
   * opposition à perCellMin qui est l'échantillon isolé le plus bas. Un pack
   * n'est pas "vide" parce que l'ADC a plongé pendant 300 µs.
   */
  perCellMinSustained: number;
  /**
   * Échantillons vbat physiquement impossibles : tension AU-DESSUS de la
   * référence à vide alors que le courant est bien supérieur à la médiane.
   * Sous charge la tension ne peut que descendre ; au-dessus de zéro, le
   * canal vbat de ce log n'est pas mesurable et les verdicts batterie
   * n'ont pas de valeur.
   */
  implausibleSamples: number;
}

export interface MotorMetrics {
  avgPct: number; // moyenne des 4 moteurs en % de la plage
  perMotorAvgPct: [number, number, number, number];
  /** Écart max entre moteurs en points de % (déséquilibre mécanique/CG). */
  imbalancePctPts: number;
  saturationPct: number; // % d'échantillons moteur >= high-8
  desyncZeros: [number, number, number, number]; // eRPM==0 en vol par moteur
  erpmAvailable: boolean;
}

export interface AxisNoise {
  unfiltRms: number | null; // RMS diff échantillon-à-échantillon, gyro brut
  filtRms: number; // idem gyro filtré
  ratio: number | null; // unfilt/filt (efficacité de filtrage)
  gyroPeak: number; // deg/s
}

export interface NoiseMetrics {
  axes: [AxisNoise, AxisNoise, AxisNoise];
}

export interface SpectrumBand {
  lo: number;
  hi: number;
  label: string;
  rms: number;
}

export interface SpectrumPeak {
  freqHz: number;
  mag: number;
}

export interface AxisSpectrum {
  bands: SpectrumBand[];
  dominantBand: string;
  peaks: SpectrumPeak[]; // top 5
  freqs: Float32Array; // pour le graphe (borné à ~1 kHz)
  mags: Float32Array;
}

export interface SpectrumMetrics {
  source: 'unfilt' | 'filt'; // unfilt si dispo
  axes: [AxisSpectrum, AxisSpectrum, AxisSpectrum];
  motorFundamentalHz: number | null; // médiane flotte
  perMotorHz: Array<{ median: number; p90: number }> | null;
  /** Pic global dominant attribué au moteur le plus proche en Hz. */
  dominantPeak: { freqHz: number; axis: Axis; nearestMotor: number; distanceHz: number } | null;
  motorPolesAssumed: number;
}

export interface AxisTracking {
  meanAbsErr: number; // deg/s
  maxErr: number;
  setpointMax: number;
}

export interface TrackingMetrics {
  axes: [AxisTracking, AxisTracking, AxisTracking];
}

export interface AxisStepResponse {
  /** Réponse indicielle estimée par déconvolution de Wiener (méthode Plasmatree). */
  t: Float32Array; // secondes 0..~0.5
  y: Float32Array; // réponse normalisée (1 = consigne)
  riseTimeMs: number | null; // 10→90 %
  peakValue: number | null; // max de la réponse
  overshootPct: number | null; // (peak-1)*100 si peak>1
  settleValue: number | null; // valeur moyenne 200-500 ms (doit être ~1)
  quality: number; // 0..1 part de fenêtres exploitables (assez d'excitation stick)
  /**
   * Pic de sensibilité Ms = max|1-T| sur 2-60 Hz : de combien la boucle amplifie
   * au pire une perturbation. Toujours ≥ ~1 ; ≲1.5 amorti, ~2 limite, >2 ça sonne.
   */
  ms: number | null;
  msFreqHz: number | null; // fréquence du pic Ms (le point fragile de la boucle)
  /** Pic de sensibilité complémentaire Mt = max|T| en dB : résonance boucle fermée. */
  mtDb: number | null;
  mtFreqHz: number | null;
  /**
   * Haut de la bande réellement excitée par le manche, donc plafond de validité
   * de Ms/Mt : au-dessus, le vol ne dit rien de la boucle. Ms est un MINORANT
   * sur cette bande - à citer avec la mesure.
   */
  msBandTopHz: number | null;
}

export interface StepResponseMetrics {
  axes: [AxisStepResponse | null, AxisStepResponse | null, AxisStepResponse | null];
}

export interface YoyoMetrics {
  applicable: boolean; // assez d'échantillons en vol
  ratio: number | null; // sd(poussée)/sd(stick)
  verdict: 'stable' | 'yoyo' | null;
  peaks: Array<{ freqHz: number; mag: number }>;
}

export interface PropwashEvent {
  tStart: number;
  tEnd: number;
  severity: number; // RMS erreur gyro <40 Hz pendant l'événement
}

export interface PropwashMetrics {
  applicable: boolean; // le vol contient-il des descentes throttle bas ?
  events: PropwashEvent[];
  worstSeverity: number | null;
  avgSeverity: number | null;
}

/**
 * Oscillation en boucle fermée isolée dans le temps. Un incident violent de
 * 0,5 s se dilue à néant dans une moyenne sur tout le log : on le date, et sa
 * gravité ne dépend plus de la durée du vol.
 */
export interface OscillationEvent {
  tStart: number;
  tEnd: number;
  /** Fréquence dominante du différentiel moteur (Hz). */
  freqHz: number;
  /** Part de l'énergie de bande dans le pic : proche de 1 = sinusoïde pure. */
  concentration: number;
  /** Crête de l'enveloppe différentielle, en unités moteur brutes. */
  peakAmp: number;
  /** Idem en % de la plage moteur : comparable d'une carte à l'autre. */
  peakAmpPct: number;
  /** peakAmp / baselineAmp : combien de fois au-dessus du régime normal. */
  ratio: number;
  /** % d'échantillons de la fenêtre où au moins un moteur touche une butée. */
  saturationPct: number;
  /** Moteurs (1-based) ayant touché une butée pendant l'événement. */
  motorsAtStop: number[];
  /**
   * Crête de |gyro| (norme 3 axes, deg/s) pendant l'événement. Sépare une
   * oscillation d'un impact : un cycle limite secoue les moteurs en laissant
   * l'attitude tenue (quelques dizaines de deg/s), un crash part en tumble à
   * plusieurs centaines, souvent jusqu'à la saturation du gyro.
   */
  peakGyroDps: number;
  severity: 'warn' | 'crit';
}

export interface OscillationMetrics {
  applicable: boolean; // assez d'échantillons en vol
  /** Médiane de l'enveloppe différentielle en vol : la référence "normal". */
  baselineAmp: number;
  events: OscillationEvent[]; // triés par sévérité décroissante
  worst: OscillationEvent | null;
}

export interface FilterAxisMetrics {
  /** Atténuation (dB) unfilt→filt par bande de fréquence. */
  attenuationDb: Array<{ lo: number; hi: number; db: number }>;
  /** Bruit résiduel au-dessus de 100 Hz dans le gyro filtré (fuite de filtre). */
  residualHfRms: number;
  /** Bruit BRUT dans la plage moteur 120-350 Hz (amplitude spectrale Welch).
   *  Sert de gate à filters-weak : un ratio d'atténuation n'a de sens que s'il
   *  y a du bruit à atténuer. */
  motorBandUnfiltRms: number;
}

export interface FilterMetrics {
  available: boolean; // gyroUnfilt requis
  axes: [FilterAxisMetrics, FilterAxisMetrics, FilterAxisMetrics] | null;
}

export interface TimelineSegment {
  tStart: number;
  tEnd: number;
  state: 'idle' | 'low' | 'flight';
  stickAvg: number;
  thrustPct: number;
  vbat: number | null;
}

export interface TimelineMetrics {
  segments: TimelineSegment[];
  flightTimeS: number; // temps réellement en vol
  /** Throttle stick max atteint sur la session (µs) : sert à situer TPA. */
  throttleMaxUs: number;
}

/** Chute transitoire de satellites détectée sur la série nettoyée. */
export interface GpsSatDrop {
  timeS: number; // début de la chute (base temps du log)
  fromSats: number; // médiane glissante juste avant
  toSats: number; // plancher atteint pendant la chute
  durationS: number;
}

export interface GpsMetrics {
  available: boolean;
  /** min/max/médiane sur la série nettoyée : les frames G corrompues (sat=0,
   *  sat=1042...) sont fréquentes dans les logs réels et fausseraient tout. */
  numSatMax: number | null;
  numSatMin: number | null;
  numSatMedian: number | null;
  speedMaxMps: number | null;
  /** Part (0..1) des frames G écartées par le filtre de plausibilité. */
  corruptFrameRatio: number | null;
  /** Premier instant avec 8+ sats (seuil sain pour le GPS rescue), null si jamais atteint. */
  timeToHealthySatsS: number | null;
  satDrops: GpsSatDrop[];
  /** Sats médians à bas vs haut throttle : delta négatif marqué = signature
   *  d'interférence liée à la puissance (VTX/ESC/câblage près de l'antenne). */
  satsVsThrottle: { lowMedian: number; highMedian: number; delta: number } | null;
  /** HDOP (INAV seulement) : médiane et pire valeur lissée de la session. */
  hdopMedian: number | null;
  hdopWorst: number | null;
}

export interface SessionAnalysis {
  meta: SessionMeta;
  power: PowerMetrics | null;
  motors: MotorMetrics;
  noise: NoiseMetrics;
  spectrum: SpectrumMetrics | null;
  tracking: TrackingMetrics;
  step: StepResponseMetrics | null;
  yoyo: YoyoMetrics | null;
  propwash: PropwashMetrics | null;
  oscillation: OscillationMetrics | null;
  filters: FilterMetrics;
  timeline: TimelineMetrics;
  gps: GpsMetrics;
  failsafe: { phases: Record<string, number>; triggered: boolean };
}

// ---------------------------------------------------------------------------
// Config Betaflight, reconstruite depuis les headers du log
// ---------------------------------------------------------------------------

export interface CliConfig {
  /** Nom CLI → valeur, tels que les headers "H clé:valeur" les portent. */
  values: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

export type Severity = 'ok' | 'info' | 'warn' | 'crit';

export type FindingCategory =
  | 'vibrations'
  | 'filtres'
  | 'pid'
  | 'moteurs'
  | 'batterie'
  | 'config'
  | 'gps'
  | 'securite'
  | 'log';

export interface Finding {
  id: string; // slug unique de la règle, ex. "noise-chassis-resonance"
  severity: Severity;
  category: FindingCategory;
  title: string; // français, court
  detail: string; // explication du problème et de la cause probable
  evidence: string; // les chiffres qui justifient le verdict
  fix?: {
    text: string; // action recommandée
    cli?: string[]; // lignes CLI à copier (sans "save")
  };
  /** Vrai pour un constat qui ne doit pas coûter de points au score /100 :
   *  un choix d'école assumé (ex. feedforward coupé partout) est mentionné
   *  mais n'est pas un défaut mesuré. */
  scoreExempt?: boolean;
}

// ---------------------------------------------------------------------------
// Profils drones
// ---------------------------------------------------------------------------

export interface ProfileThresholds {
  /** RMS bruit gyro filtré au-delà duquel on alerte (deg/s). */
  filtNoiseWarn: number;
  filtNoiseCrit: number;
  /** RMS bruit gyro brut : au-delà = vibrations mécaniques fortes. */
  unfiltNoiseWarn: number;
  unfiltNoiseCrit: number;
  /** Erreur de suivi moyenne (deg/s). */
  trackingWarn: number;
  trackingCrit: number;
  /** Saturation moteurs (%). */
  saturationWarn: number;
  saturationCrit: number;
  /** Déséquilibre moteurs (points de %). */
  imbalanceWarn: number;
  /** Sag par cellule (V) sous charge. */
  sagPerCellWarn: number;
  sagPerCellCrit: number;
  /** Tension par cellule mini avant alerte batterie vide (V). */
  perCellMinCrit: number;
  /** Overshoot step response (%) au-delà duquel P/D déséquilibrés. */
  overshootWarn: number;
  /** Temps de montée (ms) au-delà duquel réponse molle. */
  riseTimeSlowMs: number;
  /** Ratio yoyo (sd poussée / sd stick). */
  yoyoRatioWarn: number;
  /** Sévérité prop wash (RMS erreur deg/s). */
  propwashWarn: number;
  /** Oscillation : crête de l'enveloppe différentielle / médiane en vol. */
  oscRatioWarn: number;
  oscRatioCrit: number;
  /** Plancher d'amplitude d'oscillation, en % de la plage moteur de la carte. */
  oscMinAmpPct: number;
  /** RMS résiduel >100 Hz dans le gyro filtré. */
  residualHfWarn: number;
  /** Plancher de bruit BRUT 120-350 Hz sous lequel filters-weak ne juge pas un
   *  axe : sans bruit moteur à retirer, une faible atténuation est normale. */
  motorBandRawFloor: number;
}

export type DroneProfileId = 'pico' | 'lr4' | 'chimera7' | 'akira' | 'generic';

// Le label et les notes affichés (particularités du drone) vivent dans le
// dictionnaire i18n : dict.rules.profiles[id].{label, notes}.
export interface DroneProfile {
  id: DroneProfileId;
  /** Détection auto par craft name (headers) - insensible à la casse. */
  craftMatch: RegExp;
  motorPoles: number; // pour eRPM → Hz
  expectedCells: number | null;
  thresholds: ProfileThresholds;
}

// ---------------------------------------------------------------------------
// Rapport final
// ---------------------------------------------------------------------------

export interface SessionReport {
  analysis: SessionAnalysis;
  profile: DroneProfile;
  findings: Finding[];
}

export interface FileReport {
  fileName: string;
  sessionReports: SessionReport[];
  skipped: SkippedSession[];
}

export interface Report {
  files: FileReport[];
  /**
   * Présent uniquement pour un rapport reconstruit depuis un lien partagé.
   * `trimmed` : les courbes n'ont pas tenu dans l'URL, l'affichage doit le dire
   * plutôt que de montrer des graphes vides.
   */
  shared?: { trimmed: boolean };
}
