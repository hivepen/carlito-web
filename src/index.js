// src/index.js
// Cloudflare Worker for carlito.hivepen.com.
// Serves:
//   /                                -> redirect to https://hivepen.com/ (landing comes later)
//   /.well-known/assetlinks.json    -> Android App Links verification file
//   /pay?...                         -> fallback page for browsers (no Carlito installed)
//
// No build step, no dependencies: `wrangler deploy` from this repo.

const SITE_URL = "https://hivepen.com/";

// Verified Carlito download link on hivepen.com: the stable get URL for
// Carlito's primary channel (Apklis), from hivepen-website src/data/projects.ts
// (channels[0]) and src/data/getLinks.ts. Do not hardcode a store URL here;
// if the primary channel ever changes, update this one line.
const DOWNLOAD_URL = "https://hivepen.com/apps/carlito/get/apklis";

// Android App Links verification. Fingerprints of the Carlito release
// keystore (first) and debug keystore (second), computed with keytool.
// Update this list if the signing key ever changes.
const ASSETLINKS = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "com.hivepen.carlito",
      sha256_cert_fingerprints: [
        "72:12:AD:A8:95:5E:86:DA:DC:C8:A1:E1:EF:B2:B6:75:09:F0:B9:E9:09:E0:BF:28:5E:C2:6B:C5:CF:21:71:EF",
        "96:64:50:99:6D:F7:79:66:ED:2A:17:32:03:0E:9E:D4:39:08:30:76:78:0B:B4:71:24:29:94:BB:B8:FF:E5:30",
      ],
    },
  },
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "com.hivepen.carlito.dev",
      sha256_cert_fingerprints: [
        "96:64:50:99:6D:F7:79:66:ED:2A:17:32:03:0E:9E:D4:39:08:30:76:78:0B:B4:71:24:29:94:BB:B8:FF:E5:30",
        ],
    },
  },
];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function maskAccount(value) {
  const digits = String(value).replace(/\D/g, "");
  if (digits.length >= 15) {
    return `${digits.slice(0, 4)} •••• •••• ${digits.slice(-4)}`;
  }
  return String(value);
}

function buildQuery(pairs) {
  return pairs
    .filter(([, value]) => value !== undefined && value !== "")
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
}

// Deep link that opens the same payment in Carlito, built from the same
// query params the Android app already parses (see PayToParser in
// carlito-android): payto:// for card transfers, the Transfermóvil deep
// link for merchant (Pago en Línea) payments. Returns null when there is
// no recipient to pay.
function appLink(params) {
  const to = params.to;
  if (!to) return null;
  const digits = to.replace(/\D/g, "");
  if (digits.length >= 15) {
    const qs = buildQuery([
      [
        "amount",
        params.amount
          ? `${params.currency || "CUP"}:${params.amount}`
          : undefined,
      ],
      ["receiver-name", params.receiverName],
      ["message", params.message],
      ["notify", params.notify],
      ["reference", params.reference],
    ]);
    return `payto://cu-card/${digits}${qs ? `?${qs}` : ""}`;
  }
  const qs = buildQuery([
    ["numero_proveedor", to],
    ["id_transaccion", params.reference],
    ["importe", params.amount],
    ["moneda", params.currency || "CUP"],
    ["descripcion", params.message],
  ]);
  return `transfermovil://tm_compra_en_linea/action?${qs}`;
}

function payPage(searchParams) {
  // Same param names as the Android pay link, plus the Transfermóvil-style
  // aliases the app also accepts.
  const to =
    searchParams.get("to") || searchParams.get("numero_proveedor") || "";
  const amount =
    searchParams.get("amount") || searchParams.get("importe") || "";
  const currency =
    searchParams.get("currency") || searchParams.get("moneda") || "CUP";
  const receiverName = searchParams.get("receiver-name") || "";
  const message =
    searchParams.get("message") || searchParams.get("descripcion") || "";
  const reference =
    searchParams.get("reference") || searchParams.get("id_transaccion") || "";
  const notify = searchParams.get("notify") || "";

  const params = {
    to,
    amount,
    currency,
    receiverName,
    message,
    reference,
    notify,
  };
  const link = appLink(params);
  const digits = to.replace(/\D/g, "");
  const isCard = digits.length >= 15;
  const title = isCard ? "Solicitud de transferencia" : "Pago en línea";
  const intro = isCard ? "Te enviaron una solicitud de transferencia con Carlito, la app de servicios móviles en Cuba." : "Te enviaron un enlace para pagar en línea con Carlito, la app de servicios móviles en Cuba.";

  const rows = [];
  if (to) {
    rows.push(
      `<div class="row"><span>${isCard ? "Tarjeta destino" : "Proveedor"}</span><strong>${escapeHtml(maskAccount(to))}</strong></div>`,
    );
  }
  if (receiverName) {
    rows.push(
      `<div class="row"><span>Para</span><strong>${escapeHtml(receiverName)}</strong></div>`,
    );
  }
  if (reference) {
    rows.push(
      `<div class="row"><span>ID de transacción</span><strong>${escapeHtml(reference)}</strong></div>`,
    );
  }
  if (message) {
    rows.push(
      `<div class="row"><span>Concepto</span><strong>${escapeHtml(message)}</strong></div>`,
    );
  }

  const amountHtml = amount
    ? `<div class="amount">${escapeHtml(amount)} <span>${escapeHtml(currency)}</span></div>`
    : "";

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #f6f6f4; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #121212; color: #f0f0f0; } }
  main { max-width: 480px; margin: 0 auto; padding: 48px 20px; }
  h1 { font-size: 28px; margin: 0 0 8px; }
  p { line-height: 1.5; color: #555; }
  @media (prefers-color-scheme: dark) { p { color: #bbb; } }
  .amount { font-size: 44px; font-weight: 800; margin: 24px 0; }
  .amount span { font-size: 20px; font-weight: 600; color: #555; }
  @media (prefers-color-scheme: dark) { .amount span { color: #bbb; } }
  .card { background: #fff; border: 1px solid #e3e3e0; border-radius: 16px; padding: 8px 20px; margin: 24px 0; }
  @media (prefers-color-scheme: dark) { .card { background: #1e1e1e; border-color: #333; } }
  .row { display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-bottom: 1px solid #eee; }
  .row:last-child { border-bottom: 0; }
  @media (prefers-color-scheme: dark) { .row { border-color: #333; } }
  .row span { color: #777; }
  .row strong { text-align: right; overflow-wrap: anywhere; }
  a.btn { display: block; text-align: center; text-decoration: none; font-weight: 700; border-radius: 12px; padding: 14px; margin: 12px 0; }
  a.primary { background: #2563eb; color: #fff; }
  a.secondary { border: 1px solid #ccc; color: inherit; }
  footer { margin-top: 32px; font-size: 14px; color: #888; }
  footer a { color: inherit; }
</style>
</head>
<body>
<main>
  <h1>${title}</h1>
  <p>${intro}</p>
  ${amountHtml}
  ${rows.length ? `<div class="card">${rows.join("")}</div>` : ""}
  <p>Para completar el pago necesitas tener Carlito instalado.</p>
  ${link ? `<a class="btn secondary" href="${escapeHtml(link)}">Abrir en Carlito</a>` : ""}
  <a class="btn primary" href="${DOWNLOAD_URL}">Instalar Carlito</a>
  <footer>Carlito is a suite of utilities for mobile services in Cuba. · <a href="${SITE_URL}">hivepen.com</a></footer>
</main>
</body>
</html>`;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path =
      url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");

    if (path === "/.well-known/assetlinks.json") {
      return new Response(JSON.stringify(ASSETLINKS), {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=86400",
        },
      });
    }

    if (path === "/pay") {
      return new Response(payPage(url.searchParams), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    if (path === "/") {
      return Response.redirect(SITE_URL, 302);
    }

    return new Response("Not found", { status: 404 });
  },
};
