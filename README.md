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
| `/.well-known/assetlinks.json` | Android App Links verification file (`application/json`). Lets Android open `carlito.hivepen.com/sendme` and `/pay` links directly in Carlito. |
| `/sendme?...` | Fallback page for transfer requests: shows the request details (destination, amount, concept) and an install button. One target parameter names the CUPP-1 target type: `cu-card` (bank card), `cubacel` (Cubacel mobile balance) or `mitransfer` (MiTransfer wallet). |
| `/pay?...` | Fallback page for merchant payments (Pago en Línea): shows the payment details and an install button. One route for both Transfermóvil services: `reference` blank or `ESTATICO` means the static service (31), any other reference means the dynamic service (30). |

Link formats (CUPP-1 parameter vocabulary, same data the Android app parses):

```text
https://carlito.hivepen.com/sendme?cu-card=<16-digit card>&amount=CUP:1500.00&receiver-name=María&message=Préstamo&reference=<ref>&notify=tel:+5351234567
https://carlito.hivepen.com/sendme?cubacel=<E.164 phone>&amount=CUP:100.00
https://carlito.hivepen.com/sendme?mitransfer=<E.164 phone>&amount=USD:50.00
https://carlito.hivepen.com/pay?provider=<provider number>&reference=<tx id or ESTATICO>&amount=CUP:315&receiver-name=Apklis&message=<description>
```

The merchant JSON QR and the `transfermovil://tm_compra_en_linea` deep
link keep Transfermóvil's own field names (`id_transaccion`,
`numero_proveedor`, `importe`, `moneda`, `titulo`, `descripcion`): they
are Transfermóvil's formats, not ours, and the Worker translates the URL
parameters into them.

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
