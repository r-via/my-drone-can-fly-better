# Deployment

Static export. The analysis needs no server at all: the site is HTML, JS, CSS
and one WASM blob.

Live at <https://mydronecanflybetter.netlify.app>.

## Build

```bash
npm run build      # next build, static export to out/
```

`next.config.ts` sets `output: 'export'` and `reactStrictMode: true`. That
export mode has one consequence worth remembering: any app router route that
generates metadata needs to opt into static rendering. `src/app/manifest.ts`
carries `export const dynamic = 'force-static'` for exactly that reason, and
without it the build fails on that route.

Node 20 or newer, for both Next 15 and the WASM parser.

## Netlify

The whole configuration is four lines in [`netlify.toml`](../netlify.toml):

```toml
[build]
  command = "npm run build"
  publish = "out"
  functions = "netlify/functions"

[build.environment]
  NODE_VERSION = "20"
```

No redirect rules. The client calls the native function path
`/.netlify/functions/submit-log`, which works in production and under
`netlify dev` without any rewrite.

## Local development

```bash
npm run dev        # http://localhost:3000, no functions
netlify dev        # proxies next dev and runs the functions locally
```

`next dev` alone does not run Netlify Functions, so the share opt-in will fail
against it. Use `netlify dev` when touching that path.

## The one piece of server side code

[`netlify/functions/submit-log.ts`](../netlify/functions/submit-log.ts) is a
proxy behind the "help improve the tool" opt-in at the bottom of a report. It
is a Netlify v2 function, plain Web standard `Request` and `Response`, with no
`@netlify/functions` dependency.

What it does:

1. rejects anything that is not a `POST`;
2. reads `DISCORD_WEBHOOK_URL` from the environment, answering `not_configured`
   with status 500 if it is absent;
3. parses the incoming `FormData`, keeping the `meta` field aside;
4. appends files until the cumulative size would exceed 7 500 000 bytes, which
   leaves margin under the 8 MB attachment limit of a non boosted Discord
   webhook;
5. builds a short message from the metadata (craft names, locale, file count,
   whether a `diff all` was attached), capped at 1900 characters;
6. relays everything to the webhook.

Responses:

| Status | Body | Meaning |
| --- | --- | --- |
| 200 | `{ ok: true, sent: n }` | relayed |
| 400 | `{ ok: false, error: 'bad_request' }` | the body was not form data |
| 405 | `{ ok: false, error: 'method_not_allowed' }` | not a POST |
| 413 | `{ ok: false, error: 'too_large' }` | every file exceeded the cap |
| 500 | `{ ok: false, error: 'not_configured' }` | no webhook configured |
| 502 | `{ ok: false, error: 'upstream' }` | Discord refused or was unreachable |

The webhook URL stays server side. Putting it in the client bundle would let
anyone spam the channel.

## Environment

| Variable | Where | Required | Purpose |
| --- | --- | --- | --- |
| `DISCORD_WEBHOOK_URL` | Netlify environment, or `.env.local` for `netlify dev` | no | destination of the share opt-in |

Without it, the endpoint answers `not_configured` and the rest of the site is
completely unaffected: analysis is client side and never touches it.

`.gitignore` excludes `.env*.local`, so the local value never gets committed.

## Deploying elsewhere

The `out/` directory is a plain static site. Any static host serves it, with two
requirements:

- `blackbox-log.wasm` must be served with `Content-Type: application/wasm`, or
  the worker's `WebAssembly.compile` fails;
- if the site is served under a sub path, no change is needed. The worker
  resolves the WASM relative to its own chunk URL rather than the site root,
  precisely so a `basePath` or a GitHub Pages project site keeps working.

Dropping the sharing function loses only the opt-in block, which fails
gracefully.
