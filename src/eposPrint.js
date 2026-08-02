// Epson TMシリーズ（TM-m30 / TM-T88 など）の ePOS-Print XML でレシートを発券する。
// プリンタ本体のWebサービス（/cgi-bin/epos/service.cgi）へブラウザから直接POSTするので、
// PCやアプリのドライバは不要。受付機のiPadとプリンタが同じWi-Fi/LANにいればよい。
//
// 注意: GitHub Pages（https）から印刷する場合、http://プリンタIP への通信は
// ブラウザの mixed content 制限でブロックされる。プリンタ側でSSL証明書を有効にして
// https で叩くか（TM-m30II/III対応・iPadに証明書インストールが必要）、
// 受付機をLAN内のhttp配信で動かす必要がある。設定画面（?setup）で切り替えられる。

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

// 受付票のePOS-Print XMLを組み立てる。
// number: 受付番号 / typeJa,typeEn: 種別 / dateStr: 日時 / qrUrl: 問診票URL（なければQRなし）
export function buildTicketXml({ number, typeJa, typeEn, dateStr, qrUrl, qrNoteLines = [] }) {
  let b = "";
  b += `<text lang="ja"/><text smooth="true"/><text align="center"/>`;
  b += `<text width="1" height="1">ケイクリ レディースクリニック&#10;</text>`;
  b += `<text>K Ladies Clinic Shinjuku&#10;</text>`;
  b += `<feed line="1"/>`;
  b += `<text>受付番号 / Ticket No.&#10;</text>`;
  b += `<feed unit="6"/>`;
  b += `<text width="5" height="5">${esc(number)}</text>`;
  b += `<text width="1" height="1">&#10;</text>`;
  b += `<feed line="1"/>`;
  b += `<text>${esc(typeJa)}&#10;</text>`;
  b += `<text>${esc(typeEn)}&#10;</text>`;
  b += `<text>${esc(dateStr)}&#10;</text>`;
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
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>` +
    `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">${b}</epos-print>` +
    `</s:Body></s:Envelope>`
  );
}

// プリンタへ送信。設定がない/無効ならスキップ（{skipped:true}）。
// 失敗は throw する（呼び出し側で画面に案内を出す）。
export async function printTicket(ticket) {
  const cfg = getPrinterConfig();
  if (!cfg || !cfg.enabled || !cfg.ip) return { skipped: true };

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
