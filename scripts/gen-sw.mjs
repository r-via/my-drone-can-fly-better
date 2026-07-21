#!/usr/bin/env node
// Génère out/sw.js après `next build`.
//
// Les chunks Next sont hashés à chaque build : la liste de précache ne peut pas
// être écrite à la main. On parcourt donc out/ et on fige la liste, plus un hash
// du contenu qui sert de nom de cache - un octet qui change = nouveau cache.

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'out');
const TEMPLATE = join(ROOT, 'scripts', 'sw-template.js');

// Servis mais jamais nécessaires hors ligne : image sociale (crawlers) et
// payload RSC. Le favicon .ico pèse 270 ko alors que icon.svg suffit ; il sera
// mis en cache à l'usage s'il est réellement demandé.
const EXCLUDE = new Set(['/opengraph-image.png', '/index.txt', '/favicon.ico', '/sw.js']);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((e) => {
      const full = join(dir, e.name);
      return e.isDirectory() ? walk(full) : [full];
    }),
  );
  return files.flat();
}

const files = (await walk(OUT)).sort();
const hash = createHash('sha256');
const precache = [];
let bytes = 0;

for (const file of files) {
  const url = '/' + relative(OUT, file).split(sep).join('/');
  if (EXCLUDE.has(url)) continue;
  const content = await readFile(file);
  precache.push(url);
  bytes += content.byteLength;
  hash.update(url);
  hash.update(content);
}

const version = hash.digest('hex').slice(0, 12);
const template = await readFile(TEMPLATE, 'utf8');
const sw = template
  .replace('__SW_VERSION__', version)
  .replace('/*__PRECACHE__*/ []', JSON.stringify(precache, null, 2));

await writeFile(join(OUT, 'sw.js'), sw);

const mib = (bytes / 1024 / 1024).toFixed(2);
console.log(`sw.js : ${precache.length} fichiers précachés (${mib} Mio), version ${version}`);
