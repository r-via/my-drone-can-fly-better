// Téléchargement d'un log partagé (/api/log/<id>) - Edge Function.
//
// Les Blobs Netlify n'ont pas d'URL publique : cette fonction est la seule
// porte d'accès au store `shared-logs`. La protection est l'id (UUID non
// devinable), connu uniquement du salon Discord privé où submit-log l'a posté.

import { getStore } from '@netlify/blobs';

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const id = new URL(req.url).pathname.split('/').pop() ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    return new Response('Not found', { status: 404 });
  }

  const store = getStore('shared-logs');
  const entry = await store.getWithMetadata(id, { type: 'stream' });
  if (!entry) return new Response('Not found', { status: 404 });

  // Le nom vient du client (submit-log le borne déjà) : on neutralise quand
  // même guillemets et retours pour l'en-tête Content-Disposition.
  const rawName = String(entry.metadata?.name ?? 'log.bbl');
  const fileName = rawName.replace(/["\r\n\\]/g, '_');

  return new Response(entry.data, {
    headers: {
      'content-type': fileName.endsWith('.gz') ? 'application/gzip' : 'application/octet-stream',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'no-store',
    },
  });
};

export const config = { path: '/api/log/*' };
