import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

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

test("/ redirects to hivepen.com and unknown paths 404", async () => {
  const root = await get("/");
  assert.equal(root.res.status, 302);
  assert.equal(root.res.headers.get("location"), "https://hivepen.com/");
  const missing = await get("/nope");
  assert.equal(missing.res.status, 404);
});
