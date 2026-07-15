// Proxy opt-in : reçoit le(s) .bbl brut(s) depuis ShareLogToggle et les relaie
// vers un webhook Discord privé. Le webhook reste côté serveur (env var) -
// jamais exposé au bundle client, sinon n'importe qui pourrait spammer le salon.
//
// Fonction Netlify v2 (Web standard Request/Response) - pas de dépendance
// @netlify/functions, on n'a besoin d'aucune feature de son Context.

const DISCORD_ATTACHMENT_CAP_BYTES = 7_500_000; // marge sous la limite webhook non boosté (8 Mo)

interface ShareMeta {
  craftNames?: string[];
  locale?: string;
  fileCount?: number;
}

function parseMeta(raw: FormDataEntryValue | null): ShareMeta {
  if (typeof raw !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as ShareMeta) : {};
  } catch {
    return {};
  }
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    });
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    return new Response(JSON.stringify({ ok: false, error: 'not_configured' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  let incoming: FormData;
  try {
    incoming = await req.formData();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'bad_request' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const meta = parseMeta(incoming.get('meta'));
  const outgoing = new FormData();
  let fileCount = 0;
  let totalBytes = 0;

  for (const [key, value] of incoming.entries()) {
    if (key === 'meta' || !(value instanceof File)) continue;
    if (totalBytes + value.size > DISCORD_ATTACHMENT_CAP_BYTES) continue;
    totalBytes += value.size;
    outgoing.append(`files[${fileCount}]`, value, value.name || `log-${fileCount}.bbl`);
    fileCount += 1;
  }

  if (fileCount === 0) {
    return new Response(JSON.stringify({ ok: false, error: 'too_large' }), {
      status: 413,
      headers: { 'content-type': 'application/json' },
    });
  }

  const lines = [
    '**New shared log (opt-in)**',
    meta.craftNames?.length ? `Craft: \`${meta.craftNames.join(', ')}\`` : null,
    meta.locale ? `Locale: ${meta.locale}` : null,
    meta.fileCount ? `Files: ${meta.fileCount}` : null,
  ].filter((line): line is string => Boolean(line));

  outgoing.append('payload_json', JSON.stringify({ content: lines.join('\n').slice(0, 1900) }));

  try {
    const discordRes = await fetch(webhookUrl, { method: 'POST', body: outgoing });
    if (!discordRes.ok) {
      return new Response(JSON.stringify({ ok: false, error: 'upstream' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'upstream' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, sent: fileCount }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
