# carlito-web

Cloudflare Worker for `carlito.hivepen.com`, the web home of
[Carlito](https://hivepen.com/apps/carlito/get/apklis) — the app of
utilities for mobile services in Cuba.

Minimal on purpose: this repo only makes the payment link work. The full
landing page comes later.

## Routes

| Route | Behaviour |
| --- | --- |
| `/` | Redirects to `https://hivepen.com/` (the landing lives there for now). |
| `/.well-known/assetlinks.json` | Android App Links verification file (`application/json`). Lets Android open `carlito.hivepen.com/pay` links directly in Carlito. |
| `/pay?...` | Fallback page for browsers: shows the payment details (amount, recipient, concept) and an install button. People without Carlito installed land here when they tap a payment link. |

Payment-link format (same data the Android app parses):

```text
https://carlito.hivepen.com/pay?to=<16-digit card or provider number>&amount=150.00&currency=CUP&receiver-name=María&message=Préstamo&reference=<tx id>
```

## Fingerprints

The SHA-256 fingerprints in `src/index.js` (`ASSETLINKS`) are the Carlito
release keystore and debug keystore, computed with `keytool`. If the signing
key ever changes, update that list and redeploy — Android re-verifies the
domain after the file changes.

## Develop

```sh
npm install
npm test        # route tests, no network needed
npm run dev     # local wrangler dev server
```

## Deploy

The user deploys from the Cloudflare dashboard (no CI yet):

1. `npx wrangler login` (once, in a terminal with browser access).
2. `npx wrangler deploy` from this repo — creates the `carlito-web` Worker.
3. In Cloudflare dashboard → Workers & Pages → `carlito-web` →
   Settings → Domains → Add a custom domain: `carlito.hivepen.com`.
   (Cloudflare provisions the DNS record and TLS automatically.)
4. Verify live:
   `curl https://carlito.hivepen.com/.well-known/assetlinks.json`
   must return 200, `content-type: application/json`, with both fingerprints.
