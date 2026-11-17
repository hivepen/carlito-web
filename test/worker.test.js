import test from "node:test";
import assert from "node:assert/strict";
import worker, {
  buildMerchantDeepLink,
  buildPaytoLink,
  merchantJsonQrPayload,
  notifyPhoneNumber,
  parseAmount,
  parsePayParams,
  parseSendmeParams,
  transferMovilQrPayload,
} from "../src/index.js";

async function get(path) {
  const res = await worker.fetch(new Request(`https://carlito.hivepen.com${path}`));
  return { res, body: await res.text() };
}

function params(query) {
  return new URL(`https://carlito.hivepen.com/?${query}`).searchParams;
}

// The five example links from the design, used as round-trip fixtures.
const SENDME_CARD =
  "/sendme?cu-card=9227959871418978&amount=CUP%3A1500.00&receiver-name=Caf%C3%A9%20Central&message=Compra%204821&reference=order-4821&notify=tel%3A%2B5354341201";
const SENDME_BALANCE =
  "/sendme?cubacel=%2B5354341201&amount=CUP%3A100.00&receiver-name=Carlos&message=Saldo%20para%20llamar";
const SENDME_WALLET =
  "/sendme?mitransfer=%2B5354341201&amount=USD%3A50.00&receiver-name=Carlos&message=Para%20la%20compra";
const PAY_DYNAMIC =
  "/pay?provider=57001&reference=APK00000000004278839&amount=CUP%3A315&receiver-name=Apklis";
const PAY_STATIC =
  "/pay?provider=4112032&reference=ESTATICO&amount=CUP%3A100&receiver-name=Picta&message=Compra%20en%20Picta";

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

test("/sendme card link renders a transfer request with payto + TM QRs", async () => {
  const { res, body } = await get(SENDME_CARD);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  assert.match(body, /Solicitud de transferencia/);
  assert.match(body, /Tarjeta bancaria/);
  assert.match(body, /9227 •••• •••• 8978/);
  assert.match(body, /1500\.00/);
  assert.match(body, /CUP/);
  assert.match(body, /Café Central/);
  assert.match(body, /Compra 4821/);
  assert.match(body, /order-4821/);
  assert.match(body, /https:\/\/hivepen\.com\/apps\/carlito\/get\/apklis/);
  // Abrir en Carlito is the payto deep link (amount first, then the rest).
  assert.match(
    body,
    /payto:\/\/cu-card\/9227959871418978\?amount=CUP%3A1500\.00/,
  );
  // Both QR tabs, URI selected by default, inside the modal.
  assert.match(body, /<svg[^>]*viewBox/);
  assert.match(body, /data-qr="uri"/);
  assert.match(body, /data-qr="tm"/);
  assert.match(body, /class="chip selected" data-qr="uri"/);
  assert.match(body, /sin monto/);
  assert.match(body, /id="qrModal" role="dialog" aria-modal="true"[^>]*hidden/);
  const modalAt = body.indexOf('id="qrModal"');
  assert.ok(body.indexOf('class="qr"') > modalAt);
});

test("/sendme cubacel link renders a balance request with only the payto QR", async () => {
  const { res, body } = await get(SENDME_BALANCE);
  assert.equal(res.status, 200);
  assert.match(body, /Solicitud de transferencia/);
  assert.match(body, /Saldo móvil Cubacel/);
  assert.match(body, /\+53 •••• 1201/);
  assert.match(body, /100\.00/);
  assert.match(body, /CUP/);
  assert.match(body, /Carlos/);
  assert.match(body, /Saldo para llamar/);
  assert.match(body, /payto:\/\/cubacel\/%2B5354341201\?amount=CUP%3A100\.00/);
  assert.match(body, /<svg[^>]*viewBox/);
  assert.doesNotMatch(body, /data-qr="tm"/);
  assert.doesNotMatch(body, /sin monto/);
});

test("/sendme mitransfer link renders a wallet request with only the payto QR", async () => {
  const { res, body } = await get(SENDME_WALLET);
  assert.equal(res.status, 200);
  assert.match(body, /Solicitud de transferencia/);
  assert.match(body, /Monedero MiTransfer/);
  assert.match(body, /\+53 •••• 1201/);
  assert.match(body, /50\.00/);
  assert.match(body, /USD/);
  assert.match(body, /Para la compra/);
  assert.match(
    body,
    /payto:\/\/mitransfer\/%2B5354341201\?amount=USD%3A50\.00/,
  );
  assert.match(body, /<svg[^>]*viewBox/);
  assert.doesNotMatch(body, /data-qr="tm"/);
  assert.doesNotMatch(body, /sin monto/);
});

test("/sendme without an amount shows an open amount and still shows the QR", async () => {
  const { res, body } = await get(
    "/sendme?cu-card=9227959871418978&receiver-name=Carlos",
  );
  assert.equal(res.status, 200);
  assert.match(body, /Sin importe fijo/);
  assert.match(body, /id="qrOpenBtn"/);
  assert.match(body, /<svg[^>]*viewBox/);
});

test("/sendme escapes reflected values", async () => {
  const { body } = await get(
    "/sendme?cu-card=9227959871418978&message=%3Cscript%3Ealert(1)%3C%2Fscript%3E",
  );
  assert.doesNotMatch(body, /<script>alert\(1\)<\/script>/);
  assert.match(body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("/sendme with no target, two targets, or a bad target is a 400 error page", async () => {
  for (const path of [
    "/sendme?amount=CUP%3A100",
    "/sendme?cu-card=9227959871418978&cubacel=%2B5354341201",
    "/sendme?cu-card=12345",
    "/sendme?cubacel=12345",
    "/sendme?cubacel=%2B5354341201&amount=USD%3A100",
    "/sendme?cu-card=9227959871418978&amount=100",
    "/sendme?cu-card=9227959871418978&req-foo=bar",
  ]) {
    const { res, body } = await get(path);
    assert.equal(res.status, 400, path);
    assert.match(body, /Enlace no válido/);
    assert.doesNotMatch(body, /qrModal/);
  }
});

test("/sendme still shows the TM tab without a phone", async () => {
  const { body } = await get("/sendme?cu-card=9227959871418978&amount=CUP%3A100");
  assert.match(body, /data-qr="tm"/);
  assert.match(body, /sin monto/);
  const { body: invalidNotify } = await get(
    "/sendme?cu-card=9227959871418978&amount=CUP%3A100&notify=mailto%3Aana%40example.com",
  );
  assert.match(invalidNotify, /data-qr="tm"/);
  assert.match(invalidNotify, /sin monto/);
});

test("/pay dynamic link renders a merchant payment with the TM deep link", async () => {
  const { res, body } = await get(PAY_DYNAMIC);
  assert.equal(res.status, 200);
  assert.match(body, /Pago en línea/);
  assert.match(body, /Pago dinámico/);
  assert.match(body, /57001/);
  assert.match(body, /APK00000000004278839/);
  assert.match(body, /315/);
  assert.match(body, /CUP/);
  assert.match(body, /Apklis/);
  assert.match(
    body,
    /transfermovil:\/\/tm_compra_en_linea\/action\?numero_proveedor=57001/,
  );
  // Single JSON QR in the modal, no TM tab, no static hint.
  assert.match(body, /id="qrModal"/);
  assert.match(body, /id="qrOpenBtn"/);
  const modalAt = body.indexOf('id="qrModal"');
  assert.ok(body.indexOf('class="qr"') > modalAt);
  assert.doesNotMatch(body, /data-qr="tm"/);
  assert.doesNotMatch(body, /sin monto/);
  assert.doesNotMatch(body, /Importe sugerido/);
});

test("/pay static link says the amount is suggested and editable", async () => {
  const { res, body } = await get(PAY_STATIC);
  assert.equal(res.status, 200);
  assert.match(body, /Pago en línea/);
  assert.match(body, /Pago estático/);
  assert.match(body, /4112032/);
  assert.match(body, /Picta/);
  assert.match(body, /Compra en Picta/);
  assert.match(body, /100/);
  assert.match(body, /Importe sugerido: puedes cambiarlo en Carlito antes de pagar\./);
  assert.doesNotMatch(body, /ID de transacción/);
  assert.match(body, /<svg[^>]*viewBox/);
  assert.doesNotMatch(body, /data-qr="tm"/);
});

test("/pay with missing provider or amount is a 400 error page", async () => {
  for (const path of [
    "/pay?reference=APK00000000004278839&amount=CUP%3A315",
    "/pay?provider=57001&reference=APK00000000004278839",
    "/pay?provider=57001&amount=315",
    "/pay?provider=57001&amount=CUP%3A315&req-foo=bar",
  ]) {
    const { res, body } = await get(path);
    assert.equal(res.status, 400, path);
    assert.match(body, /Enlace no válido/);
    assert.doesNotMatch(body, /qrModal/);
  }
});

test("/pay no longer has a transfer mode (old links are errors, not transfers)", async () => {
  const { res, body } = await get(
    "/pay?to=9200123456789012&amount=150.00&currency=CUP&receiver-name=Mar%C3%ADa",
  );
  assert.equal(res.status, 400);
  assert.match(body, /Enlace no válido/);
  assert.doesNotMatch(body, /Solicitud de transferencia/);
  assert.doesNotMatch(body, /payto:\/\//);
});

test("payto link builder round-trips the three /sendme targets", async () => {
  assert.equal(
    buildPaytoLink({
      targetType: "cu-card",
      identifier: "9227959871418978",
      amount: { currency: "CUP", amount: "1500.00" },
      receiverName: "Café Central",
      message: "Compra 4821",
      notify: "tel:+5354341201",
      reference: "order-4821",
      instruction: "",
    }),
    "payto://cu-card/9227959871418978?amount=CUP%3A1500.00&receiver-name=Caf%C3%A9%20Central&message=Compra%204821&notify=tel%3A%2B5354341201&reference=order-4821",
  );
  assert.equal(
    buildPaytoLink({
      targetType: "cubacel",
      identifier: "+5354341201",
      amount: { currency: "CUP", amount: "100.00" },
      receiverName: "Carlos",
      message: "Saldo para llamar",
      notify: "",
      reference: "",
      instruction: "",
    }),
    "payto://cubacel/%2B5354341201?amount=CUP%3A100.00&receiver-name=Carlos&message=Saldo%20para%20llamar",
  );
  assert.equal(
    buildPaytoLink({
      targetType: "mitransfer",
      identifier: "+5354341201",
      amount: { currency: "USD", amount: "50.00" },
      receiverName: "Carlos",
      message: "Para la compra",
      notify: "",
      reference: "",
      instruction: "",
    }),
    "payto://mitransfer/%2B5354341201?amount=USD%3A50.00&receiver-name=Carlos&message=Para%20la%20compra",
  );
  // Open amount: no amount parameter at all.
  assert.equal(
    buildPaytoLink({
      targetType: "cu-card",
      identifier: "9227959871418978",
      amount: null,
      receiverName: "",
      message: "",
      notify: "",
      reference: "",
      instruction: "",
    }),
    "payto://cu-card/9227959871418978",
  );
});

test("merchant deep link keeps Transfermóvil's parameter names", async () => {
  assert.equal(
    buildMerchantDeepLink({
      provider: "57001",
      reference: "APK00000000004278839",
      amount: "315",
      currency: "CUP",
      message: "",
    }),
    "transfermovil://tm_compra_en_linea/action?numero_proveedor=57001&id_transaccion=APK00000000004278839&importe=315&moneda=CUP",
  );
  // Static: id_transaccion is omitted, like the JSON defaults it to ESTATICO.
  assert.equal(
    buildMerchantDeepLink({
      provider: "4112032",
      reference: "",
      amount: "100",
      currency: "CUP",
      message: "Compra en Picta",
    }),
    "transfermovil://tm_compra_en_linea/action?numero_proveedor=4112032&importe=100&moneda=CUP&descripcion=Compra%20en%20Picta",
  );
});

test("amount parses CUPP-1 MONEDA:cantidad and rejects anything else", async () => {
  assert.deepEqual(parseAmount("CUP:1500.00"), {
    currency: "CUP",
    amount: "1500.00",
  });
  assert.deepEqual(parseAmount("usd:50"), { currency: "USD", amount: "50" });
  assert.equal(parseAmount("150.00"), null);
  assert.equal(parseAmount("CUP"), null);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount(null), null);
});

test("sendme parsing rejects req-* and cubacel in any currency but CUP", async () => {
  assert.equal(
    parseSendmeParams(params("cu-card=9227959871418978&req-foo=bar")).ok,
    false,
  );
  assert.equal(
    parseSendmeParams(params("cu-card=9227959871418978&cubacel=%2B5354341201"))
      .ok,
    false,
  );
  assert.equal(
    parseSendmeParams(params("cubacel=%2B5354341201&amount=USD%3A100")).ok,
    false,
  );
  assert.deepEqual(
    parseSendmeParams(params("cubacel=%2B5354341201&amount=CUP%3A100")).data
      .identifier,
    "+5354341201",
  );
});

test("pay parsing detects the static service from a blank or ESTATICO reference", async () => {
  const dynamic = parsePayParams(
    params("provider=57001&reference=APK1&amount=CUP%3A315"),
  );
  assert.equal(dynamic.ok, true);
  assert.equal(dynamic.data.isStatic, false);
  const staticByWord = parsePayParams(
    params("provider=4112032&reference=ESTATICO&amount=CUP%3A100"),
  );
  assert.equal(staticByWord.ok, true);
  assert.equal(staticByWord.data.isStatic, true);
  const staticByBlank = parsePayParams(
    params("provider=4112032&amount=CUP%3A100"),
  );
  assert.equal(staticByBlank.ok, true);
  assert.equal(staticByBlank.data.isStatic, true);
  assert.equal(
    parsePayParams(params("reference=APK1&amount=CUP%3A315")).ok,
    false,
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

test("/ redirects to hivepen.com and unknown paths 404", async () => {
  const root = await get("/");
  assert.equal(root.res.status, 302);
  assert.equal(root.res.headers.get("location"), "https://hivepen.com/");
  const missing = await get("/nope");
  assert.equal(missing.res.status, 404);
});
