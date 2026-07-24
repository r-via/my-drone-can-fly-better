// GpsTrackChart - trace au sol du vol, SVG pur (aucune dépendance, aucun fond
// de carte : demander des tuiles à un serveur externe enverrait la position du
// pilote, à l'opposé de la promesse « rien ne quitte votre navigateur »).
//
// Repère : nord en haut, coordonnées LOCALES en mètres autour du point de
// départ - aucune latitude/longitude absolue n'entre dans ce composant.
// La vitesse sol colore la trace : rampe séquentielle d'un seul bleu, 4 paliers
// relatifs à la vitesse max du vol (--chart-gps-1..4, lent → rapide).

import * as React from 'react';
import type { JSX } from 'react';
import type { GpsTrack, GpsTrackPoint } from '../../lib/types';

const SPEED_COLORS = [
  'var(--chart-gps-1, #3b82f6)',
  'var(--chart-gps-2, #60a5fa)',
  'var(--chart-gps-3, #93c5fd)',
  'var(--chart-gps-4, #dbeafe)',
] as const;

const INK = 'var(--chart-text, #ffffff)';
const INK_DIM = 'var(--chart-text-dim, #c3c2b7)';
const BASELINE = 'var(--chart-baseline, #383835)';
const SURFACE = 'var(--chart-surface, #1a1a19)';
const START = 'var(--accent, #c6ff5e)';
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Longueur « ronde » (1/2/5 x 10^k) la plus grande sous maxM. */
export function niceScaleMeters(maxM: number): number {
  if (maxM <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(maxM));
  for (const m of [5, 2, 1]) {
    if (m * pow <= maxM) return m * pow;
  }
  return pow;
}

export interface TrackLayout {
  /** Un path par palier de vitesse (index = palier, runs M/L discontinus). */
  paths: string[];
  /** Point projeté en px : départ, arrivée, point le plus rapide. */
  start: { x: number; y: number };
  end: { x: number; y: number };
  fastest: { x: number; y: number };
  /** Mètres → px (uniforme, nord en haut). */
  scale: number;
  /** Coordonnées ENU (mètres depuis le départ) du coin haut-gauche du cadre -
   *  point d'ancrage de la couche de tuiles du fond de carte. */
  enuAt00: { x: number; y: number };
}

/**
 * Projette la trace dans un cadre w x h : échelle uniforme (les mètres est et
 * nord font la même taille à l'écran, sinon la trace est déformée), centrée.
 * Les segments sont regroupés par palier de vitesse en 4 paths.
 * `maxScale` (px/m) borne le zoom : posé quand le fond de carte est affiché,
 * pour ne jamais étirer les tuiles au-delà du zoom 19 d'OSM - un petit vol
 * devient une petite trace sur une carte nette, pas une trace pleine page sur
 * une carte pixellisée.
 */
export function buildTrackLayout(
  points: GpsTrackPoint[],
  w: number,
  h: number,
  maxSpeedMps: number,
  maxScale?: number,
): TrackLayout {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  // Une trace quasi rectiligne garde un cadre exploitable.
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min(w / spanX, h / spanY, maxScale ?? Infinity);
  const offX = (w - spanX * scale) / 2;
  const offY = (h - spanY * scale) / 2;
  const px = (p: GpsTrackPoint) => ({
    x: offX + (p.x - minX) * scale,
    // Y SVG vers le bas, nord vers le haut.
    y: h - offY - (p.y - minY) * scale,
  });

  const bucket = (v: number) =>
    maxSpeedMps > 0 ? Math.min(3, Math.floor((v / maxSpeedMps) * 4)) : 0;

  const paths = ['', '', '', ''];
  let currentBucket = -1;
  for (let i = 1; i < points.length; i++) {
    const a = px(points[i - 1]);
    const b = px(points[i]);
    const seg = bucket((points[i - 1].speedMps + points[i].speedMps) / 2);
    if (seg !== currentBucket || paths[seg] === '') {
      paths[seg] += `M${fmt(a.x)},${fmt(a.y)}`;
      currentBucket = seg;
    }
    paths[seg] += `L${fmt(b.x)},${fmt(b.y)}`;
    // Le palier suivant repart du point courant : chaque path reste continu
    // par morceaux, sans trou entre deux couleurs.
    if (i < points.length - 1) {
      const nextSeg = bucket((points[i].speedMps + points[i + 1].speedMps) / 2);
      if (nextSeg !== seg) currentBucket = -1;
    }
  }

  let fastestIdx = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].speedMps > points[fastestIdx].speedMps) fastestIdx = i;
  }

  return {
    paths,
    start: px(points[0]),
    end: px(points[points.length - 1]),
    fastest: px(points[fastestIdx]),
    scale,
    enuAt00: { x: minX - offX / scale, y: minY + (h - offY) / scale },
  };
}

// ---------------------------------------------------------------------------
// Fond de carte opt-in - tuiles raster OpenStreetMap (cartographie libre,
// jamais de service propriétaire) dessinées en <image> SVG SOUS la trace,
// dans le même repère. Montées à la main : pas de dépendance Leaflet.
// Ce calque n'existe que si le pilote a cliqué « Afficher la carte » -
// charger une tuile révèle la zone du vol au serveur de tuiles.
// ---------------------------------------------------------------------------

/** Résolution Web Mercator (m/px de tuile) à l'équateur, zoom 0, tuiles 256. */
const MERC_RES_Z0 = 156543.03392;
const M_PER_DEG_LAT = 111_320;

interface MapLayer {
  tiles: Array<{ key: string; href: string; x: number; y: number }>;
  /** Côté d'une tuile en px du viewBox. */
  size: number;
}

/**
 * Calque de tuiles aligné sur la projection de la trace : on choisit le zoom
 * OSM dont la résolution est la plus proche de l'échelle du tracé, puis chaque
 * tuile est posée en px du viewBox. À l'échelle d'un vol (< quelques km),
 * Mercator et mètres locaux coïncident à mieux que 0,1 %.
 */
export function buildMapLayer(
  origin: { latDeg: number; lonDeg: number },
  layout: TrackLayout,
  w: number,
  h: number,
): MapLayer {
  const cosLat = Math.cos((origin.latDeg * Math.PI) / 180);
  // res(z) * layout.scale = px viewBox par px de tuile ; z est choisi pour que
  // ce rapport soit le plus proche de 1 (tuiles ni floues ni surdétaillées).
  const z = Math.max(3, Math.min(19, Math.round(Math.log2(MERC_RES_Z0 * cosLat * layout.scale))));
  const res = (MERC_RES_Z0 * cosLat) / 2 ** z; // m par px de tuile
  const k = res * layout.scale; // px viewBox par px de tuile
  const worldPx = 256 * 2 ** z;

  // Coin haut-gauche du cadre : ENU → lat/lon → px Mercator globaux.
  const latTL = origin.latDeg + layout.enuAt00.y / M_PER_DEG_LAT;
  const lonTL = origin.lonDeg + layout.enuAt00.x / (M_PER_DEG_LAT * cosLat);
  const gx0 = ((lonTL + 180) / 360) * worldPx;
  const s = Math.sin((latTL * Math.PI) / 180);
  const gy0 = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldPx;

  const txMin = Math.floor(gx0 / 256);
  const txMax = Math.floor((gx0 + w / k) / 256);
  const tyMin = Math.max(0, Math.floor(gy0 / 256));
  const tyMax = Math.min(2 ** z - 1, Math.floor((gy0 + h / k) / 256));
  const tiles: MapLayer['tiles'] = [];
  for (let tx = txMin; tx <= txMax; tx++) {
    for (let ty = tyMin; ty <= tyMax; ty++) {
      tiles.push({
        key: `${z}/${tx}/${ty}`,
        href: `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`,
        x: (tx * 256 - gx0) * k,
        y: (ty * 256 - gy0) * k,
      });
    }
  }
  return { tiles, size: 256 * k };
}

export interface GpsTrackChartLabels {
  title: string;
  ariaLabel: string;
  /** Ligne de stats sous le titre - valeurs déjà formatées par l'appelant. */
  stats: (dist: string, range: string, vmax: string) => string;
  start: string;
  end: string;
  legendSpeed: string;
  /** Rappel de confidentialité : trace relative, aucune coordonnée affichée. */
  privacyNote: string;
  north: string;
  /** Attribution OSM, obligatoire dès que le fond de carte est affiché. */
  attribution: string;
}

const DEFAULT_LABELS: GpsTrackChartLabels = {
  title: 'Trace GPS (vue du dessus)',
  ariaLabel: 'Trace au sol du vol, nord en haut, colorée par vitesse sol',
  stats: (dist, range, vmax) => `distance ${dist} · éloignement max ${range} · vitesse max ${vmax}`,
  start: 'départ',
  end: 'fin',
  legendSpeed: 'vitesse sol (lent → rapide)',
  privacyNote: 'trace relative au point de départ - aucune coordonnée GPS affichée ni transmise',
  north: 'N',
  attribution: '© contributeurs OpenStreetMap',
};

/** Libellé posé à côté d'un repère, du côté où il y a de la place. */
function MarkerLabel({ x, y, w, text }: { x: number; y: number; w: number; text: string }): JSX.Element {
  const left = x > w * 0.7;
  return (
    <text
      x={x + (left ? -8 : 8)}
      y={y + 3.5}
      fontSize={10}
      fontWeight={600}
      fill={INK_DIM}
      textAnchor={left ? 'end' : 'start'}
      stroke={SURFACE}
      strokeWidth={3}
      paintOrder="stroke"
    >
      {text}
    </text>
  );
}

export function GpsTrackChart(props: {
  track: GpsTrack;
  /** Distance / éloignement / vitesse max déjà formatés (séparateur décimal
      selon la langue : le composant reste pur, sans hook de locale). */
  stats: { dist: string; range: string; vmax: string };
  /** Opt-in : dessine les tuiles OpenStreetMap SOUS la trace (même repère). */
  showMap?: boolean;
  labels?: GpsTrackChartLabels;
}): JSX.Element {
  const L = props.labels ?? DEFAULT_LABELS;
  const { track, stats } = props;
  const W = 640;
  const H = 380;
  const pad = { top: 52, right: 16, bottom: 30, left: 16 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  // Avec la carte : l'échelle est bornée à ~1,5x la résolution du zoom 19
  // d'OSM (le plus fin qui existe), sinon un vol court étire les tuiles en
  // bouillie de pixels. Sans carte, le tracé remplit le cadre comme avant.
  const MAX_TILE_STRETCH = 1.5;
  const cosLat = Math.cos((track.origin.latDeg * Math.PI) / 180);
  const maxMapScale = (MAX_TILE_STRETCH * 2 ** 19) / (MERC_RES_Z0 * cosLat);
  const layout = buildTrackLayout(
    track.points,
    plotW,
    plotH,
    track.maxSpeedMps,
    props.showMap ? maxMapScale : undefined,
  );
  const map = props.showMap ? buildMapLayer(track.origin, layout, plotW, plotH) : null;

  // Barre d'échelle : longueur ronde ~ un quart de la largeur utile.
  const scaleM = niceScaleMeters(plotW / 4 / layout.scale);
  const scalePx = scaleM * layout.scale;
  const scaleLabel = scaleM >= 1000 ? `${scaleM / 1000} km` : `${scaleM} m`;
  const scaleY = H - pad.bottom + 12;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      role="img"
      aria-label={L.ariaLabel}
      fontFamily={FONT}
    >
      <text x={pad.left} y={20} fontSize={13} fontWeight={600} fill={INK}>
        {L.title}
      </text>
      <text x={pad.left} y={36} fontSize={10} fill={INK_DIM}>
        {L.stats(stats.dist, stats.range, stats.vmax)}
      </text>

      {/* Légende vitesse : rampe + libellé (l'identité n'est pas couleur seule,
          la rampe est ordonnée et nommée). Texte ancré au bord droit : sa
          longueur varie d'une langue à l'autre, il ne doit jamais être coupé.
          Les pastilles sont cerclées : le palier clair disparaîtrait sinon
          sur la surface claire (et le foncé sur la sombre). */}
      <g>
        {SPEED_COLORS.map((c, i) => (
          <rect
            key={c}
            x={W - pad.right - 247 + i * 13}
            y={14.5}
            width={12}
            height={5}
            rx={1.5}
            fill={c}
            stroke={BASELINE}
            strokeWidth={0.6}
          />
        ))}
        <text x={W - pad.right} y={20} fontSize={10} fill={INK_DIM} textAnchor="end">
          {L.legendSpeed}
        </text>
      </g>

      {/* Flèche nord : la trace est orientée, pas décorative */}
      <g stroke={INK_DIM} fill={INK_DIM}>
        <line x1={W - pad.right - 8} y1={46} x2={W - pad.right - 8} y2={60} strokeWidth={1.4} />
        <path d={`M${W - pad.right - 8},42 l-3.5,7 h7 Z`} stroke="none" />
        <text x={W - pad.right - 20} y={53} fontSize={10} stroke="none" textAnchor="end">
          {L.north}
        </text>
      </g>

      {/* Trace, un path par palier de vitesse (lent d'abord, rapide au-dessus) */}
      <g transform={`translate(${pad.left},${pad.top})`}>
        {/* Fond de carte opt-in : tuiles OSM sous la trace, même repère, avec
            un voile de surface pour que la trace reste l'élément dominant. */}
        {map ? (
          <g clipPath="url(#gps-map-clip)">
            <defs>
              <clipPath id="gps-map-clip">
                <rect x={0} y={0} width={plotW} height={plotH} rx={10} />
              </clipPath>
            </defs>
            {map.tiles.map((tile) => (
              <image
                key={tile.key}
                href={tile.href}
                x={tile.x}
                y={tile.y}
                width={map.size}
                height={map.size}
                preserveAspectRatio="none"
              />
            ))}
            <rect x={0} y={0} width={plotW} height={plotH} fill={SURFACE} opacity={0.16} />
          </g>
        ) : null}
        {/* Liseré surface sous la trace quand la carte est là : les paliers
            lents (peu contrastés) resteraient illisibles sur les tuiles. */}
        {map
          ? layout.paths.map((d, i) =>
              d === '' ? null : (
                <path
                  key={`halo-${SPEED_COLORS[i]}`}
                  d={d}
                  fill="none"
                  stroke={SURFACE}
                  strokeWidth={4.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ),
            )
          : null}
        {layout.paths.map((d, i) =>
          d === '' ? null : (
            <path
              key={SPEED_COLORS[i]}
              d={d}
              fill="none"
              stroke={SPEED_COLORS[i]}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ),
        )}

        {/* Repères : départ (rond accent), arrivée (carré), halo surface pour
            rester lisibles sur la trace */}
        <circle cx={layout.start.x} cy={layout.start.y} r={5} fill={START} stroke={SURFACE} strokeWidth={2} />
        <rect
          x={layout.end.x - 4}
          y={layout.end.y - 4}
          width={8}
          height={8}
          rx={1.5}
          fill={INK_DIM}
          stroke={SURFACE}
          strokeWidth={2}
        />
        <MarkerLabel x={layout.start.x} y={layout.start.y} w={plotW} text={L.start} />
        <MarkerLabel x={layout.end.x} y={layout.end.y} w={plotW} text={L.end} />

        {/* Point le plus rapide : anneau + valeur (libellé direct sélectif) */}
        <circle
          cx={layout.fastest.x}
          cy={layout.fastest.y}
          r={5}
          fill="none"
          stroke={SPEED_COLORS[3]}
          strokeWidth={2}
        />
        <MarkerLabel x={layout.fastest.x} y={layout.fastest.y} w={plotW} text={stats.vmax} />

        {/* Coin bas-droit du cadre, avec halo surface (toute la largeur du
            cadre est disponible, aucune langue ne déborde). Sans carte :
            rappel de confidentialité. Avec carte : la promesse ne tient plus
            telle quelle, la ligne devient l'attribution OSM obligatoire. */}
        {map ? (
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
            <text
              x={plotW - 8}
              y={plotH - 8}
              fontSize={10}
              fill={INK_DIM}
              textAnchor="end"
              stroke={SURFACE}
              strokeWidth={3}
              paintOrder="stroke"
            >
              {L.attribution}
            </text>
          </a>
        ) : (
          <text
            x={plotW - 8}
            y={plotH - 8}
            fontSize={10}
            fill={INK_DIM}
            textAnchor="end"
            stroke={SURFACE}
            strokeWidth={3}
            paintOrder="stroke"
          >
            {L.privacyNote}
          </text>
        )}
      </g>

      {/* Barre d'échelle : le seul repère métrique du cadre */}
      <g stroke={BASELINE} strokeWidth={1.4}>
        <line x1={pad.left} y1={scaleY} x2={pad.left + scalePx} y2={scaleY} />
        <line x1={pad.left} y1={scaleY - 4} x2={pad.left} y2={scaleY + 4} />
        <line x1={pad.left + scalePx} y1={scaleY - 4} x2={pad.left + scalePx} y2={scaleY + 4} />
      </g>
      <text x={pad.left + scalePx + 8} y={scaleY + 3.5} fontSize={10} fill={INK_DIM}>
        {scaleLabel}
      </text>
    </svg>
  );
}
