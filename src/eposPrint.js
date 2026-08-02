// Epson TMシリーズ（TM-m10 / TM-m30 など）への受付票発券。接続方式は2通り:
//
// [lan]  プリンタ本体のWebサービス（ePOS-Print, /cgi-bin/epos/service.cgi）へ
//        ブラウザから直接POSTする。Ethernet/Wi-Fi接続のプリンタ用。ダイアログなし・
//        アプリ切り替えなしで最も滑らか。GitHub Pages（https）から使う場合は
//        プリンタ側でSSL証明書を有効にし、iPadに証明書を入れる必要がある。
//
// [bt]   Bluetooth接続のプリンタ用。Epson公式アプリ「Epson TM Print Assistant」を
//        iPadにインストールし、URLスキームで印刷データを渡す。
//        注意: iOS版は印刷後に自動でブラウザへ戻らない（画面左上の「◀ Safari」で戻る）。
//
// 設定は設定画面（?setup）からlocalStorageに端末ごとに保存する。

const STORAGE_KEY = "kiosk-printer";

export function getPrinterConfig() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

export function savePrinterConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// 受付票の中身（<epos-print>要素）を組み立てる。58mm幅（TM-m10, フォントA 35桁）でも
// 収まるよう、区切り線は32桁・英文は35桁以内にしてある。80mm機ではそのまま左寄せ気味に出る。
// お呼び出しは番号ではなく名前で行う運用のため、名前を大きく印字する
// （受付番号は照合用に小さく残す）。
// number: 受付番号 / patientName: 氏名 / typeJa,typeEn: 種別 / dateStr: 日時
// qrUrl: 問診票URL（なければQRなし）
export function buildTicketBody({ number, patientName, typeJa, typeEn, dateStr, qrUrl, qrNoteLines = [] }) {
  let b = "";
  b += `<text lang="ja"/><text smooth="true"/><text align="center"/>`;
  b += `<text width="1" height="1">ケイクリ レディースクリニック&#10;</text>`;
  b += `<text>K Ladies Clinic Shinjuku&#10;</text>`;
  b += `<feed line="1"/>`;
  b += `<text>お名前 / Name&#10;</text>`;
  b += `<feed unit="6"/>`;
  b += `<text width="2" height="2">${esc(patientName)} 様&#10;</text>`;
  b += `<feed line="1"/>`;
  b += `<text>${esc(typeJa)}&#10;</text>`;
  b += `<text>${esc(typeEn)}&#10;</text>`;
  b += `<text>受付No.${esc(number)}  ${esc(dateStr)}&#10;</text>`;
  if (qrUrl) {
    b += `<feed line="1"/>`;
    b += `<text>--------------------------------&#10;</text>`;
    for (const line of qrNoteLines) b += `<text>${esc(line)}&#10;</text>`;
    b += `<feed line="1"/>`;
    b += `<symbol type="qrcode_model_2" level="level_m" width="8" height="0" size="0">${esc(qrUrl)}</symbol>`;
    b += `<text>&#10;</text>`;
  }
  b += `<feed line="2"/>`;
  b += `<cut type="feed"/>`;
  return `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">${b}</epos-print>`;
}

// [lan] 用: SOAPエンベロープで包んだリクエストXML
export function buildTicketXml(ticket) {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>` +
    buildTicketBody(ticket) +
    `</s:Body></s:Envelope>`
  );
}

// [bt] 用: TM Print Assistant を起動するURLスキーム
export function buildAssistantUrl(ticket) {
  const xml = `<?xml version="1.0" encoding="utf-8"?>` + buildTicketBody(ticket);
  return (
    "tmprintassistant://tmprintassistant.epson.com/print?ver=1&data-type=eposprintxml&reselect=yes&data=" +
    encodeURIComponent(xml)
  );
}

// プリンタへ送信。設定がない/無効ならスキップ（{skipped:true}）。
// [bt] はアプリに渡した時点で成功扱い（{ok:true, external:true}）— 結果は受け取れない。
// [lan] の失敗は throw する（呼び出し側で画面に案内を出す）。
export async function printTicket(ticket) {
  const cfg = getPrinterConfig();
  if (!cfg || !cfg.enabled) return { skipped: true };

  if (cfg.method === "bt") {
    window.location.href = buildAssistantUrl(ticket);
    return { ok: true, external: true };
  }

  if (!cfg.ip) return { skipped: true };
  const scheme = cfg.scheme === "http" ? "http" : "https";
  const devid = cfg.devid || "local_printer";
  const url = `${scheme}://${cfg.ip}/cgi-bin/epos/service.cgi?devid=${encodeURIComponent(devid)}&timeout=10000`;
  const xml = buildTicketXml(ticket);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '""' },
      body: xml,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // 応答XMLの <response success="true" ... /> を確認。code属性に失敗理由が入る
    if (!/success\s*=\s*"(?:true|1)"/.test(text)) {
      const code = /code\s*=\s*"([^"]*)"/.exec(text)?.[1] || "unknown";
      throw new Error(`printer error: ${code}`);
    }
    return { ok: true };
  } finally {
    clearTimeout(timer);
  }
}
