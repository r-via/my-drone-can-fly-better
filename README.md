# My Drone Can Fly Better

**Ton vol, décodé. Sans IA.** Analyse de logs blackbox Betaflight 100 % dans le navigateur : tu glisses tes `.bbl` (et optionnellement ton `diff all`), le site te dit ce qui ne va pas et quoi corriger - verdicts chiffrés, commandes CLI prêtes à coller. Aucune donnée envoyée, aucun serveur, aucun réseau de neurones : uniquement du DSP (FFT, déconvolution) et des règles déterministes, lisibles et ajustables dans `src/lib/rules/`.

## Lancer

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # export statique dans out/
npm test             # tests (dont goldens vs scripts Python de référence)
npm run analyze -- chemin/vol.bbl          # pipeline complet en CLI Node
```

## Architecture

- `src/lib/bbl/parse.ts` - décodage `.bbl` via [blackbox-log](https://github.com/blackbox-log/blackbox-log) (Rust→WASM, MIT, vendored dans `public/`). Deux contournements documentés : spoof de la chaîne de version firmware (le format est auto-décrit ; validé contre orangebox), et parser ré-instancié par session (bug d'ArrayBuffer détaché du wrapper 0.2.2).
- `src/lib/dsp/` - FFT radix-2, Welch, bandes, pics. Zéro dépendance.
- `src/lib/analysis/` - métriques : puissance, moteurs (saturation/équilibre/desync), bruit, spectre + attribution moteur via eRPM, suivi, step response (déconvolution de Wiener, méthode Plasmatree), yoyo, prop wash, atténuation des filtres, timeline.
- `src/lib/rules/` - profils par drone (Pavo Pico, LR4, Chimera7 Pro, générique - détection auto par craft name) + moteur de règles → `Finding[]`.
- `src/lib/cli/` - parsing `diff all` / headers du log + lint de config.
- `src/worker/` - tout tourne dans un Web Worker.
- `tests/golden/` - sorties des scripts Python historiques (`analyze_*.py`, parser orangebox) qui servent de référence de non-régression.

## Ajouter une règle ou un drone

Une règle = une fonction pure dans `src/lib/rules/engine.ts` qui lit `SessionAnalysis` et rend un `Finding` (id stable, evidence chiffrée, fix CLI éventuel). Un drone = une entrée `DroneProfile` dans `src/lib/rules/profiles.ts` (regex de craft name + seuils).
