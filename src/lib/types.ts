// Contrats partagés de Debrief — analyse blackbox Betaflight 100 % déterministe.
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
  debugMode?: string;
  fieldNames: string[];
  sampleRateHz: number; // mesuré (médiane des dt)
  durationS: number;
  frameCount: number;
  motorOutputLow: number; // header motorOutput (défaut 48)
  motorOutputHigh: number; // défaut 2047
  /** Toutes les lignes "H clé:valeur" de la session (snapshot config Betaflight). */
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
  gps: { time: Float64Array; numSat: Float32Array; speedMps: Float32Array } | null;
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
  mahEstimate: number | null; // intégrale du courant
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

export interface FilterAxisMetrics {
  /** Atténuation (dB) unfilt→filt par bande de fréquence. */
  attenuationDb: Array<{ lo: number; hi: number; db: number }>;
  /** Bruit résiduel au-dessus de 100 Hz dans le gyro filtré (fuite de filtre). */
  residualHfRms: number;
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
}

export interface GpsMetrics {
  available: boolean;
  numSatMax: number | null;
  numSatMin: number | null;
  speedMaxMps: number | null;
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
  filters: FilterMetrics;
  timeline: TimelineMetrics;
  gps: GpsMetrics;
  failsafe: { phases: Record<string, number>; triggered: boolean };
}

// ---------------------------------------------------------------------------
// Config CLI (diff all / dump collé, ou headers du log)
// ---------------------------------------------------------------------------

export interface CliConfig {
  /** set name = value (le dernier gagne) */
  values: Record<string, string>;
  features: string[]; // feature XXX / feature -XXX appliqués
  source: 'paste' | 'headers';
  raw?: string;
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
  /** RMS résiduel >100 Hz dans le gyro filtré. */
  residualHfWarn: number;
}

export interface DroneProfile {
  id: string; // 'pico' | 'lr4' | 'chimera7' | 'generic'
  label: string;
  /** Détection auto par craft name (headers) — insensible à la casse. */
  craftMatch: RegExp;
  motorPoles: number; // pour eRPM → Hz
  expectedCells: number | null;
  thresholds: ProfileThresholds;
  /** Notes affichées dans le rapport (particularités du drone). */
  notes?: string[];
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
  config: CliConfig | null;
  configFindings: Finding[];
}
