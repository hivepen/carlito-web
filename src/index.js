import qrcode from "./qrcode.js";

// src/index.js
// Cloudflare Worker for carlito.hivepen.com.
// Serves:
//   /                                -> redirect to https://hivepen.com/ (landing comes later)
//   /.well-known/assetlinks.json    -> Android App Links verification file
//   /sendme?...                     -> fallback page for transfer requests (CUPP-1)
//   /pay?...                         -> fallback page for merchant payments (Pago en Línea)
//
// Link design (see the repo README): /sendme and /pay share the CUPP-1
// parameter vocabulary (amount, receiver-name, message, notify, reference,
// instruction). The target of a /sendme link is named by its parameter:
// cu-card (bank card), cubacel (Cubacel mobile balance) or mitransfer
// (MiTransfer wallet). /pay adds provider, the Transfermóvil provider
// number, which has no CUPP-1 equivalent. The merchant JSON QR and the
// transfermovil:// deep link keep Transfermóvil's own field names: they
// are Transfermóvil's formats, not ours, and this Worker translates the
// URL parameters into them.
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

// A Cuban mobile number in E.164 (+53XXXXXXXX) masked to its last 4 digits.
function maskPhone(e164) {
  const digits = String(e164).replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("53")) {
    return `+53 •••• ${digits.slice(-4)}`;
  }
  return String(e164);
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

// Renders text as an inline SVG QR code, server-side (no external assets).
// qrcode-generator, vendored in src/qrcode.js (MIT).
function qrSvg(text, altId) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({
    cellSize: 4,
    margin: 0,
    scalable: true,
    alt: { text: "Código QR para pagar", id: altId },
  });
}

// Inline QR glyph for the button that opens the QR modal (no image assets).
const QR_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="5.5" y="5.5" width="2" height="2" fill="currentColor"/><rect x="14" y="3" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="16.5" y="5.5" width="2" height="2" fill="currentColor"/><rect x="3" y="14" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="5.5" y="16.5" width="2" height="2" fill="currentColor"/><rect x="14" y="14" width="3" height="3" fill="currentColor"/><rect x="18" y="14" width="3" height="3" fill="currentColor"/><rect x="14" y="18" width="3" height="3" fill="currentColor"/><rect x="18" y="18" width="3" height="3" fill="currentColor"/></svg>`;

// The phone for the Transfermóvil transfer QR: the recipient's notification
// phone from `notify`, only when it is a tel: URI with a valid Cuban mobile
// number (strip the tel: prefix and any +53/53 country prefix; valid =
// exactly 8 digits starting with 5). The notification is optional: anything
// else returns "" and the QR carries an empty phone field.
export function notifyPhoneNumber(notify) {
  if (!notify) return "";
  const match = /^tel:(.*)$/i.exec(notify.trim());
  if (!match) return "";
  let digits = match[1].replace(/\D/g, "");
  if (digits.length > 8 && digits.startsWith("53")) digits = digits.slice(2);
  return /^5\d{7}$/.test(digits) ? digits : "";
}

// Transfermóvil transfer QR: TRANSFERMOVIL_ETECSA,TRANSFERENCIA,<card>,<phone>,
// with a trailing comma. The phone field is empty when there is no valid
// tel: notify; the tab and the QR still show.
export function transferMovilQrPayload(cardDigits, notify) {
  return `TRANSFERMOVIL_ETECSA,TRANSFERENCIA,${cardDigits},${notifyPhoneNumber(notify)},`;
}

// Merchant (Pago en Línea) QR: the public Transfermóvil JSON format the app
// itself parses and generates (PayToParser.formatTransfermovilOnlineJson).
// Field order is part of the format; titulo/descripcion only when non-blank.
export function merchantJsonQrPayload({
  provider,
  transactionId,
  amount,
  currency,
  title,
  description,
}) {
  const payload = {
    id_transaccion: transactionId || "ESTATICO",
    numero_proveedor: provider,
    importe: amount || "0.00",
    moneda: currency || "CUP",
  };
  if (title && title.trim()) payload.titulo = title;
  if (description && description.trim()) payload.descripcion = description;
  return JSON.stringify(payload);
}

// CUPP-1 amount: "<ISO-4217>:<decimal>", e.g. "CUP:1500.00". Returns
// { currency, amount } or null when the value is malformed.
export function parseAmount(value) {
  if (value === undefined || value === null) return null;
  const match = /^\s*([A-Za-z]{3})\s*:\s*(\d+(?:[.,]\d+)?)\s*$/.exec(
    String(value),
  );
  if (!match) return null;
  return { currency: match[1].toUpperCase(), amount: match[2].replace(",", ".") };
}

// CUPP-1 target types for /sendme. The parameter NAME is the target type;
// the value is the target identifier. `phone` is deliberately not a target
// type: a Cuban phone number names two different accounts (Cubacel balance
// and the MiTransfer wallet), so the type must name the account, not the
// identifier.
export const TARGET_TYPES = ["cu-card", "cubacel", "mitransfer"];

const TARGET_LABELS = {
  "cu-card": "Tarjeta bancaria",
  cubacel: "Saldo móvil Cubacel",
  mitransfer: "Monedero MiTransfer",
};

// Normalize a phone identifier to E.164 ("+53XXXXXXXX") or return null.
// Accepts E.164 (+53XXXXXXXX) and the 8-digit national form (5XXXXXXX).
function normalizePhone(value) {
  const digits = String(value).replace(/\D/g, "");
  let national = digits;
  if (digits.length === 10 && digits.startsWith("53")) national = digits.slice(2);
  if (!/^5\d{7}$/.test(national)) return null;
  return `+53${national}`;
}

function validateTarget(targetType, value) {
  if (targetType === "cu-card") {
    const digits = String(value).replace(/\D/g, "");
    return /^\d{16}$/.test(digits) ? digits : null;
  }
  return normalizePhone(value);
}

// A link that demands something this version does not support (CUPP-1:
// unknown `req-*` parameters MUST cause the URI to be rejected).
function requiredParamError(searchParams) {
  for (const key of searchParams.keys()) {
    if (key.toLowerCase().startsWith("req-")) {
      return `Este enlace usa el parámetro obligatorio «${key}», que esta versión no admite.`;
    }
  }
  return null;
}

// Parse a /sendme query. Returns { ok: true, data } or { ok: false, error }
// with a human-readable reason for the error page. Exactly one target
// parameter must be present; `amount` is optional (absent or zero means an
// open amount); `cubacel` only accepts CUP.
export function parseSendmeParams(searchParams) {
  const reqError = requiredParamError(searchParams);
  if (reqError) return { ok: false, error: reqError };

  const present = TARGET_TYPES.filter((type) => {
    const value = searchParams.get(type);
    return value !== null && value !== "";
  });
  if (present.length === 0) {
    return {
      ok: false,
      error:
        "Falta el destino: el enlace debe llevar cu-card, cubacel o mitransfer.",
    };
  }
  if (present.length > 1) {
    return {
      ok: false,
      error: "El enlace lleva más de un destino; solo puede llevar uno.",
    };
  }
  const targetType = present[0];
  const identifier = validateTarget(targetType, searchParams.get(targetType));
  if (!identifier) {
    return {
      ok: false,
      error:
        targetType === "cu-card"
          ? "La tarjeta destino debe tener 16 dígitos."
          : "El teléfono destino debe ser un móvil cubano válido (+53…).",
    };
  }

  let amount = null;
  const rawAmount = searchParams.get("amount");
  if (rawAmount !== null && rawAmount !== "") {
    amount = parseAmount(rawAmount);
    if (!amount) {
      return {
        ok: false,
        error:
          "El importe no tiene el formato MONEDA:cantidad (por ejemplo, CUP:150.00).",
      };
    }
    if (Number(amount.amount) === 0) amount = null;
    if (targetType === "cubacel" && amount && amount.currency !== "CUP") {
      return {
        ok: false,
        error: "El saldo móvil solo se transfiere en CUP.",
      };
    }
  }

  return {
    ok: true,
    data: {
      targetType,
      identifier,
      amount,
      receiverName: searchParams.get("receiver-name") || "",
      message: searchParams.get("message") || "",
      notify: searchParams.get("notify") || "",
      reference: searchParams.get("reference") || "",
      instruction: searchParams.get("instruction") || "",
    },
  };
}

// Parse a /pay query. Returns { ok: true, data } or { ok: false, error }.
// provider and amount are required. reference blank or ESTATICO means the
// static service (31); any other reference means the dynamic service (30).
export function parsePayParams(searchParams) {
  const reqError = requiredParamError(searchParams);
  if (reqError) return { ok: false, error: reqError };

  const provider = searchParams.get("provider") || "";
  if (!/^\d+$/.test(provider)) {
    return {
      ok: false,
      error:
        "Falta el proveedor: el enlace debe llevar el número de proveedor del comercio.",
    };
  }
  const rawAmount = searchParams.get("amount");
  if (rawAmount === null || rawAmount === "") {
    return {
      ok: false,
      error:
        "Falta el importe: el enlace debe llevar amount con el formato MONEDA:cantidad (por ejemplo, CUP:315).",
    };
  }
  const amount = parseAmount(rawAmount);
  if (!amount) {
    return {
      ok: false,
      error:
        "El importe no tiene el formato MONEDA:cantidad (por ejemplo, CUP:315).",
    };
  }
  const reference = searchParams.get("reference") || "";
  const isStatic = reference === "" || reference.toUpperCase() === "ESTATICO";
  return {
    ok: true,
    data: {
      provider,
      reference,
      amount,
      isStatic,
      receiverName: searchParams.get("receiver-name") || "",
      message: searchParams.get("message") || "",
      notify: searchParams.get("notify") || "",
    },
  };
}

// payto deep link for a transfer request: the same URI the QR encodes.
export function buildPaytoLink({
  targetType,
  identifier,
  amount,
  receiverName,
  message,
  notify,
  reference,
  instruction,
}) {
  const qs = buildQuery([
    [
      "amount",
      amount ? `${amount.currency}:${amount.amount}` : undefined,
    ],
    ["receiver-name", receiverName],
    ["message", message],
    ["notify", notify],
    ["reference", reference],
    ["instruction", instruction],
  ]);
  return `payto://${targetType}/${encodeURIComponent(identifier)}${qs ? `?${qs}` : ""}`;
}

// Transfermóvil deep link that opens a merchant payment in the app. The
// parameter names are Transfermóvil's (numero_proveedor, id_transaccion,
// importe, moneda, descripcion): this is Transfermóvil's format, not ours.
// A static payment omits id_transaccion, like the merchant JSON defaults it
// to ESTATICO.
export function buildMerchantDeepLink({
  provider,
  reference,
  amount,
  currency,
  message,
}) {
  const qs = buildQuery([
    ["numero_proveedor", provider],
    ["id_transaccion", reference],
    ["importe", amount],
    ["moneda", currency || "CUP"],
    ["descripcion", message],
  ]);
  return `transfermovil://tm_compra_en_linea/action?${qs}`;
}

const PAGE_CSS = `
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #f6f6f4; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #121212; color: #f0f0f0; } }
  main { max-width: 480px; margin: 0 auto; padding: 48px 20px; }
  h1 { font-size: 28px; margin: 0 0 8px; }
  p { line-height: 1.5; color: #555; }
  @media (prefers-color-scheme: dark) { p { color: #bbb; } }
  .amount { display: flex; align-items: center; justify-content: space-between; gap: 16px; font-size: 44px; font-weight: 800; margin: 24px 0; }
  .amount .cur { font-size: 20px; font-weight: 600; color: #555; }
  .amount .open { font-size: 22px; font-weight: 600; color: #555; }
  @media (prefers-color-scheme: dark) { .amount .cur { color: #bbb; } .amount .open { color: #bbb; } }
  .qr-btn { margin-left: auto; flex: none; width: 44px; height: 44px; border-radius: 12px; border: 1px solid #ddd; background: #fff; color: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
  @media (prefers-color-scheme: dark) { .qr-btn { border-color: #444; background: #1e1e1e; } }
  .qr { max-width: 260px; margin: 0 auto 8px; background: #fff; padding: 16px; border-radius: 12px; box-sizing: border-box; }
  .qr svg { width: 100%; height: auto; display: block; }
  .qr-tabs { display: flex; gap: 8px; justify-content: center; margin: 12px 0 4px; }
  .chip { font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 999px; border: 1px solid #ddd; background: transparent; color: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
  .chip.selected { background: #e8e8e6; border-color: #e8e8e6; }
  @media (prefers-color-scheme: dark) { .chip { border-color: #444; } .chip.selected { background: #2e2e2e; border-color: #2e2e2e; } }
  .tab-note { font-size: 12px; color: #888; }
  .avatars { display: inline-flex; }
  .av { width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; color: #fff; border: 2px solid #f6f6f4; }
  .av + .av { margin-left: -6px; }
  .av.tm { background: #2563eb; }
  .av.ez { background: #16a34a; }
  @media (prefers-color-scheme: dark) { .av { border-color: #121212; } }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 10; }
  .modal-overlay[hidden] { display: none; }
  .modal-box { background: #fff; color: #1a1a1a; border-radius: 20px; padding: 20px 20px 16px; max-width: 340px; width: 100%; box-sizing: border-box; position: relative; text-align: center; }
  .modal-box .chip { border-color: #ddd; }
  .modal-box .chip.selected { background: #e8e8e6; border-color: #e8e8e6; }
  .modal-box .av { border-color: #fff; }
  .modal-title { margin: 4px 0 16px; font-size: 17px; font-weight: 700; color: #1a1a1a; }
  .modal-close { position: absolute; top: 10px; right: 10px; width: 36px; height: 36px; border-radius: 50%; border: 0; background: #f0f0f0; color: #555; font-size: 22px; line-height: 1; cursor: pointer; padding: 0; }
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
`;

// Shared page shell. `afterCard` is extra HTML between the card and the
// buttons (notes such as the static-payment hint).
function layout({ title, intro, amountRow, rows, afterCard, link, qrModal }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p>${intro}</p>
  ${amountRow}
  ${rows.length ? `<div class="card">${rows.join("")}</div>` : ""}
  ${afterCard}
  ${link ? `<a class="btn secondary" href="${escapeHtml(link)}">Abrir en Carlito</a>` : ""}
  <a class="btn primary" href="${DOWNLOAD_URL}">Instalar Carlito</a>
  <footer>Carlito is a suite of utilities for mobile services in Cuba. · <a href="${SITE_URL}">hivepen.com</a></footer>
</main>
${qrModal}
</body>
</html>`;
}

// The QR section lives inside a modal (opened from a QR icon button in the
// amount row) instead of inline on the page, and the .qr container adds
// white padding as the quiet zone. Closes via the close button, tapping the
// backdrop, or Escape. The script also keeps the URI/TM tab toggle when the
// page has tabs. If QR generation ever fails, the page still renders
// without a QR instead of erroring.
function qrModal(qrHtml) {
  if (!qrHtml) return "";
  return `<div class="modal-overlay" id="qrModal" role="dialog" aria-modal="true" aria-label="Código QR para pagar" hidden>
  <div class="modal-box">
    <button type="button" class="modal-close" aria-label="Cerrar">×</button>
    <p class="modal-title">Código QR para pagar</p>
    ${qrHtml}
  </div>
</div>
<script>
(function () {
  var modal = document.getElementById("qrModal");
  var openBtn = document.getElementById("qrOpenBtn");
  function openModal() { modal.hidden = false; document.body.style.overflow = "hidden"; }
  function closeModal() { modal.hidden = true; document.body.style.overflow = ""; }
  openBtn.addEventListener("click", openModal);
  modal.querySelector(".modal-close").addEventListener("click", closeModal);
  modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !modal.hidden) closeModal(); });
  var tabs = document.querySelectorAll(".qr-tabs .chip");
  tabs.forEach(function (btn) {
    btn.addEventListener("click", function () {
      tabs.forEach(function (b) {
        b.classList.remove("selected");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("selected");
      btn.setAttribute("aria-pressed", "true");
      document.querySelectorAll(".qr-pane").forEach(function (pane) {
        pane.hidden = pane.dataset.qr !== btn.dataset.qr;
      });
    });
  });
})();
</script>`;
}

// Amount row: the big amount on the left, the QR icon button on the right
// (also shown when there is no amount, so the QR stays reachable).
function amountRow(amount, currency, qrHtml) {
  if (!amount && !qrHtml) return "";
  const amountHtml = amount
    ? `<span>${escapeHtml(amount)} <span class="cur">${escapeHtml(currency)}</span></span>`
    : `<span class="open">Sin importe fijo</span>`;
  const buttonHtml = qrHtml
    ? `<button type="button" class="qr-btn" id="qrOpenBtn" aria-label="Ver código QR" aria-haspopup="dialog">${QR_ICON_SVG}</button>`
    : "";
  return `<div class="amount">${amountHtml}${buttonHtml}</div>`;
}

function errorPage(reason) {
  return {
    status: 400,
    html: layout({
      title: "Enlace no válido",
      intro: `${escapeHtml(reason)} Pídele a quien te lo envió que te comparta el enlace de nuevo.`,
      amountRow: "",
      rows: [],
      afterCard: "",
      link: null,
      qrModal: "",
    }),
  };
}

function sendmePage(searchParams) {
  const parsed = parseSendmeParams(searchParams);
  if (!parsed.ok) return errorPage(parsed.error);
  const d = parsed.data;
  const link = buildPaytoLink(d);

  const rows = [];
  rows.push(
    `<div class="row"><span>Tipo</span><strong>${TARGET_LABELS[d.targetType]}</strong></div>`,
  );
  rows.push(
    `<div class="row"><span>${d.targetType === "cu-card" ? "Tarjeta destino" : "Teléfono destino"}</span><strong>${escapeHtml(d.targetType === "cu-card" ? maskAccount(d.identifier) : maskPhone(d.identifier))}</strong></div>`,
  );
  if (d.receiverName) {
    rows.push(
      `<div class="row"><span>Para</span><strong>${escapeHtml(d.receiverName)}</strong></div>`,
    );
  }
  if (d.reference) {
    rows.push(
      `<div class="row"><span>Referencia</span><strong>${escapeHtml(d.reference)}</strong></div>`,
    );
  }
  if (d.message) {
    rows.push(
      `<div class="row"><span>Concepto</span><strong>${escapeHtml(d.message)}</strong></div>`,
    );
  }

  // QR codes. The payto URI is the QR for every target (it carries the
  // amount, the main value of the request). Only card transfers get the
  // Transfermóvil QR tab ("sin monto" alternative, switched with small tabs
  // below the QR): there is no Transfermóvil QR format for balance or
  // MiTransfer requests.
  let qrHtml = "";
  try {
    if (d.targetType === "cu-card") {
      qrHtml = `<div class="qr">
  <div class="qr-pane" data-qr="uri">${qrSvg(link, "qr-uri-desc")}</div>
  <div class="qr-pane" data-qr="tm" hidden>${qrSvg(transferMovilQrPayload(d.identifier, d.notify), "qr-tm-desc")}</div>
</div>
<div class="qr-tabs">
  <button type="button" class="chip selected" data-qr="uri" aria-pressed="true">URI</button>
  <button type="button" class="chip" data-qr="tm" aria-pressed="false"><span class="tab-note">sin monto</span><span class="avatars"><span class="av tm">Tm</span><span class="av ez">Ez</span></span></button>
</div>`;
    } else {
      qrHtml = `<div class="qr">${qrSvg(link, "qr-uri-desc")}</div>`;
    }
  } catch {
    qrHtml = "";
  }

  return {
    status: 200,
    html: layout({
      title: "Solicitud de transferencia",
      intro:
        "Te enviaron una solicitud de transferencia con Carlito, la app de servicios móviles en Cuba.",
      amountRow: amountRow(
        d.amount ? d.amount.amount : "",
        d.amount ? d.amount.currency : "",
        qrHtml,
      ),
      rows,
      afterCard:
        "<p>Para enviar el dinero necesitas tener Carlito instalado.</p>",
      link,
      qrModal: qrModal(qrHtml),
    }),
  };
}

function payPage(searchParams) {
  const parsed = parsePayParams(searchParams);
  if (!parsed.ok) return errorPage(parsed.error);
  const d = parsed.data;

  // The merchant JSON QR keeps Transfermóvil's field names; the URL
  // parameters are translated into them here.
  const jsonPayload = merchantJsonQrPayload({
    provider: d.provider,
    transactionId: d.reference,
    amount: d.amount.amount,
    currency: d.amount.currency,
    title: d.receiverName,
    description: d.message,
  });
  const link = buildMerchantDeepLink({
    provider: d.provider,
    // A static payment omits id_transaccion from the deep link.
    reference: d.isStatic ? "" : d.reference,
    amount: d.amount.amount,
    currency: d.amount.currency,
    message: d.message,
  });

  const rows = [];
  rows.push(
    `<div class="row"><span>Tipo</span><strong>${d.isStatic ? "Pago estático" : "Pago dinámico"}</strong></div>`,
  );
  rows.push(
    `<div class="row"><span>Proveedor</span><strong>${escapeHtml(d.provider)}</strong></div>`,
  );
  if (d.receiverName) {
    rows.push(
      `<div class="row"><span>Comercio</span><strong>${escapeHtml(d.receiverName)}</strong></div>`,
    );
  }
  if (!d.isStatic) {
    rows.push(
      `<div class="row"><span>ID de transacción</span><strong>${escapeHtml(d.reference)}</strong></div>`,
    );
  }
  if (d.message) {
    rows.push(
      `<div class="row"><span>Concepto</span><strong>${escapeHtml(d.message)}</strong></div>`,
    );
  }

  let qrHtml = "";
  try {
    qrHtml = `<div class="qr">${qrSvg(jsonPayload, "qr-json-desc")}</div>`;
  } catch {
    qrHtml = "";
  }

  const afterCard = d.isStatic
    ? "<p>Importe sugerido: puedes cambiarlo en Carlito antes de pagar.</p><p>Para completar el pago necesitas tener Carlito instalado.</p>"
    : "<p>Para completar el pago necesitas tener Carlito instalado.</p>";

  return {
    status: 200,
    html: layout({
      title: "Pago en línea",
      intro:
        "Te enviaron un enlace para pagar en línea con Carlito, la app de servicios móviles en Cuba.",
      amountRow: amountRow(d.amount.amount, d.amount.currency, qrHtml),
      rows,
      afterCard,
      link,
      qrModal: qrModal(qrHtml),
    }),
  };
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

    if (path === "/sendme") {
      const page = sendmePage(url.searchParams);
      return new Response(page.html, {
        status: page.status,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    if (path === "/pay") {
      const page = payPage(url.searchParams);
      return new Response(page.html, {
        status: page.status,
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
