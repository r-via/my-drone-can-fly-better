// Relais opt-in des .bbl vers Rémi - Edge Function + Netlify Blobs.
//
// Edge et pas fonction classique : une fonction synchrone plafonne le corps de
// requête à ~6 Mo, ce qui forçait à découper les gros logs. Une Edge Function
// streame la requête, et le fichier ne part plus en pièce jointe Discord (8 Mo
// max sur un webhook non boosté) : il est déposé dans le store Blobs privé du
// site, et le salon reçoit un simple message avec un lien de téléchargement
// servi par /api/log/<id>. Plus aucun découpage, plus de réassemblage.
//
// Le webhook reste côté serveur (env var) - jamais exposé au bundle client,
// sinon n'importe qui pourrait spammer le salon.

import { getStore } from '@netlify/blobs';

declare const Netlify: { env: { get(name: string): string | undefined } };

/** Garde-fou serveur, aligné sur celui du client (ShareLogToggle). */
const MAX_BYTES = 100_000_000;

function json(status: number, error: string | null, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify(error ? { ok: false, error, ...extra } : { ok: true, ...extra }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json(405, 'method_not_allowed');

  const webhookUrl = Netlify.env.get('DISCORD_WEBHOOK_URL');
  if (!webhookUrl) return json(500, 'not_configured');

  // Métadonnées en query string : le corps est le fichier brut (gzippé côté
  // client quand CompressionStream est disponible), pas un multipart.
  const url = new URL(req.url);
  const name = (url.searchParams.get('name') ?? 'log.bbl').slice(0, 160);
  const craft = (url.searchParams.get('craft') ?? '').slice(0, 120);
  const locale = (url.searchParams.get('locale') ?? '').slice(0, 8);
  // Mot laissé par l'expéditeur (pseudo Discord, contexte) : il dit à qui
  // appartient le log. Backticks retirés pour ne pas casser le bloc `code`
  // qui l'entoure ; les mentions sont neutralisées via allowed_mentions.
  const note = (url.searchParams.get('note') ?? '').slice(0, 500).replace(/`/g, "'");

  let body: Blob;
  try {
    body = await req.blob();
  } catch {
    return json(400, 'bad_request');
  }
  if (body.size === 0) return json(400, 'bad_request');
  if (body.size > MAX_BYTES) return json(413, 'too_large');

  // Id non devinable : c'est lui qui protège le téléchargement.
  const id = crypto.randomUUID();
  const store = getStore('shared-logs');
  await store.set(id, body, {
    metadata: { name, sizeBytes: body.size, craft, locale, note, uploadedAt: new Date().toISOString() },
  });

  const mb = (body.size / 1_000_000).toFixed(1);
  const lines = [
    '**New shared log (opt-in)**',
    `File: \`${name}\` (${mb} MB)`,
    craft ? `Craft: \`${craft}\`` : null,
    locale ? `Locale: ${locale}` : null,
    note ? `Note: \`${note}\`` : null,
    `Download: ${url.origin}/api/log/${id}`,
  ].filter((line): line is string => Boolean(line));

  try {
    const discordRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: lines.join('\n').slice(0, 1900),
        // Le texte vient de l'utilisateur : couper tout ping (@everyone, @here,
        // rôles, membres) même si le webhook en a le droit.
        allowed_mentions: { parse: [] },
      }),
    });
    if (!discordRes.ok) return json(502, 'upstream');
  } catch {
    return json(502, 'upstream');
  }

  return json(200, null, { id });
};

export const config = { path: '/api/submit-log' };
