import test from "node:test";
import assert from "node:assert/strict";
import worker, {
  appLink,
  merchantJsonQrPayload,
  notifyPhoneNumber,
  transferMovilQrPayload,
} from "../src/index.js";

async function get(path) {
  const res = await worker.fetch(new Request(`https://carlito.hivepen.com${path}`));
  return { res, body: await res.text() };
}

test("assetlinks.json serves both fingerprints as JSON", async () => {
  const { res, body } = await get("/.well-known/assetlinks.json");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/json/);
  const data = JSON.parse(body);
  assert.equal(data[0].target.namespace, "android_app");
  assert.equal(data[0].target.package_name, "com.hivepen.carlito");
  assert.deepEqual(data[0].target.sha256_cert_fingerprints, [
    "72:12:AD:A8:95:5E:86:DA:DC:C8:A1:E1:EF:B2:B6:75:09:F0:B9:E9:09:E0:BF:28:5E:C2:6B:C5:CF:21:71:EF",
    "96:64:50:99:6D:F7:79:66:ED:2A:17:32:03:0E:9E:D4:39:08:30:76:78:0B:B4:71:24:29:94:BB:B8:FF:E5:30",
  ]);
});

test("/pay shows a transfer with masked card and install link", async () => {
  const { res, body } = await get(
    "/pay?to=9200123456789012&amount=150.00&currency=CUP&receiver-name=Mar%C3%ADa&message=Pr%C3%A9stamo",
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  assert.match(body, /150\.00/);
  assert.match(body, /CUP/);
  assert.match(body, /9200 •••• •••• 9012/);
  assert.match(body, /Tarjeta destino<\/span><strong>9200 •••• •••• 9012<\/strong>/);
  assert.match(body, /María/);
  assert.match(body, /Préstamo/);
  assert.match(body, /https:\/\/hivepen\.com\/apps\/carlito\/get\/apklis/);
  assert.match(body, /payto:\/\/cu-card\/9200123456789012/);
});

test("/pay escapes reflected values", async () => {
  const { body } = await get(
    "/pay?to=9200123456789012&message=%3Cscript%3Ealert(1)%3C%2Fscript%3E",
  );
  assert.doesNotMatch(body, /<script>alert\(1\)<\/script>/);
  assert.match(body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("/pay shows a merchant payment with provider and reference", async () => {
  const { body } = await get(
    "/pay?to=57001&amount=315.0&currency=CUP&reference=APK00000000004278640",
  );
  assert.match(body, /57001/);
  assert.match(body, /APK00000000004278640/);
  assert.match(body, /315\.0/);
  assert.match(body, /transfermovil:\/\/tm_compra_en_linea\/action\?/);
});

test("transfer URI QR payload is the payto link (default)", async () => {
  assert.equal(
    appLink({
      to: "9200123456789012",
      amount: "150.00",
      currency: "CUP",
      receiverName: "María",
      message: "Préstamo",
      reference: "",
      notify: "",
    }),
    "payto://cu-card/9200123456789012?amount=CUP%3A150.00&receiver-name=Mar%C3%ADa&message=Pr%C3%A9stamo",
  );
});

test("TM QR includes the phone from a valid tel: notify", async () => {
  assert.equal(notifyPhoneNumber("tel:+5351234567"), "51234567");
  assert.equal(notifyPhoneNumber("tel:51234567"), "51234567");
  assert.equal(notifyPhoneNumber("tel:+53 5123 4567"), "51234567");
  assert.equal(
    transferMovilQrPayload("9200123456789012", "tel:+5351234567"),
    "TRANSFERMOVIL_ETECSA,TRANSFERENCIA,9200123456789012,51234567,",
  );
});

test("TM QR carries an empty phone when notify is absent or invalid", async () => {
  assert.equal(notifyPhoneNumber(""), "");
  assert.equal(notifyPhoneNumber("mailto:ana@example.com"), "");
  assert.equal(notifyPhoneNumber("5351234567"), "");
  assert.equal(notifyPhoneNumber("tel:21234567"), "");
  assert.equal(notifyPhoneNumber("tel:123"), "");
  assert.equal(
    transferMovilQrPayload("9200123456789012", ""),
    "TRANSFERMOVIL_ETECSA,TRANSFERENCIA,9200123456789012,,",
  );
  assert.equal(
    transferMovilQrPayload("9200123456789012", "mailto:ana@example.com"),
    "TRANSFERMOVIL_ETECSA,TRANSFERENCIA,9200123456789012,,",
  );
});

test("Pago en línea JSON QR payload follows the merchant format", async () => {
  assert.equal(
    merchantJsonQrPayload({
      provider: "57001",
      transactionId: "APK00000000004278640",
      amount: "315.0",
      currency: "CUP",
      title: "",
      description: "",
    }),
    '{"id_transaccion":"APK00000000004278640","numero_proveedor":"57001","importe":"315.0","moneda":"CUP"}',
  );
  assert.equal(
    merchantJsonQrPayload({
      provider: "80001",
      transactionId: "",
      amount: "",
      currency: "",
      title: "Bodega La Principal",
      description: "Compra",
    }),
    '{"id_transaccion":"ESTATICO","numero_proveedor":"80001","importe":"0.00","moneda":"CUP","titulo":"Bodega La Principal","descripcion":"Compra"}',
  );
});

test("/pay transfer page shows both QRs with URI selected by default", async () => {
  const { body } = await get(
    "/pay?to=9200123456789012&amount=150.00&currency=CUP&receiver-name=Mar%C3%ADa&message=Pr%C3%A9stamo",
  );
  assert.match(body, /<svg[^>]*viewBox/);
  assert.match(body, /data-qr="uri"/);
  assert.match(body, /data-qr="tm"/);
  assert.match(body, /class="chip selected" data-qr="uri"/);
  assert.match(body, /sin monto/);
  assert.match(body, /<span class="av tm">Tm<\/span>/);
  assert.match(body, /<span class="av ez">Ez<\/span>/);
});

test("/pay transfer page shows the QRs in a modal opened from the amount row", async () => {
  const { body } = await get(
    "/pay?to=9200123456789012&amount=150.00&currency=CUP&receiver-name=Mar%C3%ADa&message=Pr%C3%A9stamo",
  );
  // Modal chrome, hidden until the QR button opens it.
  assert.match(
    body,
    /id="qrModal" role="dialog" aria-modal="true"[^>]*hidden/,
  );
  assert.match(body, /class="modal-close" aria-label="Cerrar"/);
  // QR icon button lives in the amount row, right of the amount.
  assert.match(body, /<div class="amount">[\s\S]*?id="qrOpenBtn"/);
  assert.match(
    body,
    /class="qr-btn" id="qrOpenBtn" aria-label="Ver código QR" aria-haspopup="dialog"/,
  );
  // QR panes are inside the modal, not inline on the page.
  const modalAt = body.indexOf('id="qrModal"');
  const qrAt = body.indexOf('class="qr"');
  assert.ok(modalAt !== -1 && qrAt > modalAt);
  assert.ok(body.indexOf('data-qr="uri"') > modalAt);
  // Quiet zone: white padded container around the QR.
  assert.match(body, /\.qr \{[^}]*background: #fff;[^}]*padding: 16px/);
  // Modal open/close wiring: button, backdrop, Escape.
  assert.match(body, /openBtn\.addEventListener\("click", openModal\)/);
  assert.match(body, /e\.target === modal/);
  assert.match(body, /e\.key === "Escape"/);
});

test("/pay merchant page shows the JSON QR inside the modal", async () => {
  const { body } = await get(
    "/pay?to=57001&amount=315.0&currency=CUP&reference=APK00000000004278640",
  );
  assert.match(body, /id="qrModal"/);
  assert.match(body, /id="qrOpenBtn"/);
  const modalAt = body.indexOf('id="qrModal"');
  assert.ok(body.indexOf('class="qr"') > modalAt);
  assert.doesNotMatch(body, /sin monto/);
});

test("/pay without a recipient shows no QR modal or button", async () => {
  const { body } = await get("/pay?amount=100&currency=CUP");
  assert.doesNotMatch(body, /qrModal/);
  assert.doesNotMatch(body, /qrOpenBtn/);
});

test("/pay transfer page still shows the TM tab without a phone", async () => {
  const { body } = await get("/pay?to=9200123456789012&amount=100&currency=CUP");
  assert.match(body, /data-qr="tm"/);
  assert.match(body, /sin monto/);
  const { body: invalidNotify } = await get(
    "/pay?to=9200123456789012&amount=100&currency=CUP&notify=mailto%3Aana%40example.com",
  );
  assert.match(invalidNotify, /data-qr="tm"/);
  assert.match(invalidNotify, /sin monto/);
});

test("/pay merchant page shows the JSON QR and no TM tab", async () => {
  const { body } = await get(
    "/pay?to=57001&amount=315.0&currency=CUP&reference=APK00000000004278640",
  );
  assert.match(body, /<svg[^>]*viewBox/);
  assert.doesNotMatch(body, /sin monto/);
  assert.doesNotMatch(body, /data-qr="tm"/);
});

test("/ redirects to hivepen.com and unknown paths 404", async () => {
  const root = await get("/");
  assert.equal(root.res.status, 302);
  assert.equal(root.res.headers.get("location"), "https://hivepen.com/");
  const missing = await get("/nope");
  assert.equal(missing.res.status, 404);
});
