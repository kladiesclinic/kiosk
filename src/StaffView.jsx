import React, { useEffect, useMemo, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import QRCode from "qrcode";
import {
  ClipboardList,
  RefreshCw,
  Printer,
  X,
  PackageCheck,
  Stethoscope,
  CheckCircle2,
  FileText,
  CalendarDays,
  CalendarCheck,
  UserPlus,
  Video,
  QrCode,
  Trash2,
  Search,
  Mail,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "./supabase.js";
import { guessKana } from "./kana.js";
import { BookingEditor, SettingsTabs, settingsFromRow } from "./StaffAdmin.jsx";
import { buildSlotTimes, timeToMinutes } from "./lib/slots.js";
import { Settings, Plus, Pencil, RotateCcw, MessageCircle, Bell } from "lucide-react";

const FONT_IMPORT = `
@import url('https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700&family=Noto+Sans+JP:wght@400;500;700&family=JetBrains+Mono:wght@500;600&display=swap');
/* 当日予約の吹き出し: 軽く揺れて目に入るように */
@keyframes sameday-pop { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
.sameday-pop { animation: sameday-pop 1.6s ease-in-out infinite; }
@media print { .sameday-pop { display: none !important; } }
`;

// 問診票の記入中の進捗（monshin_progress）のバッジ。問診票本体がまだ届いていない
// 予約に出す。10分以上動きが無ければ色を落として「途中で止まっている」と分かるようにする
function ProgressBadge({ p }) {
  const min = Math.max(0, Math.round((Date.now() - new Date(p.updated_at).getTime()) / 60000));
  const ago = min < 1 ? "たった今" : min < 60 ? `${min}分前` : `${Math.floor(min / 60)}時間前`;
  const stale = min >= 10;
  const label = p.step > 0 && p.total ? `記入中 ${p.step}/${p.total}問` : "問診票を開いた";
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold"
      style={stale ? { background: "#F1ECEC", color: "#8A7A7E" } : { background: "#E3F4F4", color: "#0F8B8D" }}
      title={p.section ? `いま: ${p.section}` : undefined}
    >
      {label}
      <span className="ml-1 font-normal" style={{ opacity: 0.8 }}>{ago}</span>
    </span>
  );
}

// iPadOS 13以降のSafariはUAをMacと名乗るので、UAだけでは判別できない。
// タッチできるMacは実質iPadなので、その組み合わせも見る
const IS_IOS =
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

// 印刷は「レイアウト用の隠しDOM → 画像化 → A4のPDF → 印刷ダイアログ」の流れ。
// PDFはダウンロードせず、非表示iframeに読み込んで印刷ダイアログだけを開く
// （スタッフはそこで印刷するか、必要ならPDF保存を選べる）。
//
// ただしiPadのSafariは、iframeの中のPDFに対する print() を無視して画面のほうを
// 印刷してしまう。そのため受付一覧の見た目がそのまま何枚にも渡って出ていた。
// iPadでは作ったPDFを新しいタブに出し、共有メニューの「プリント」から
// 出してもらう。PDF自体は他の端末とまったく同じものになる
async function printElementAsPdf(el, iosWindow, fileName) {
  el.style.display = "block";
  // Webフォントが届く前に画像化すると代替フォントの字幅で組まれ、行の折り返しが
  // 変わって別のPDFになる。iPadは初回表示でここに引っかかりやすい
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch { /* 待てなくても続行する */ }
  }
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#FFFFFF" });
  el.style.display = "none";

  // 必ずA4・1枚に収める: 幅いっぱいで高さが超える場合は縮小してフィットさせる
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;
  const margin = 8;
  const img = canvas.toDataURL("image/jpeg", 0.95);
  let imgW = pageW - margin * 2;
  let imgH = (canvas.height * imgW) / canvas.width;
  const maxH = pageH - margin * 2;
  if (imgH > maxH) {
    imgH = maxH;
    imgW = (canvas.width * imgH) / canvas.height;
  }
  pdf.addImage(img, "JPEG", (pageW - imgW) / 2, margin, imgW, imgH);

  const blobUrl = pdf.output("bloburl");

  if (IS_IOS) {
    // タブはクリックと同じ処理の中でしか開けないので、呼び出し側が先に開いておく
    if (iosWindow && !iosWindow.closed) {
      iosWindow.location.href = blobUrl;
      return;
    }
    // タブを開けなかったときはダウンロードにする。この画面を離れると
    // PDFの一時URLごと消えてしまうので、同じタブで開くことはしない
    pdf.save(fileName || "問診票.pdf");
    return;
  }

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  iframe.src = blobUrl;
  document.body.appendChild(iframe);
  iframe.onload = () => {
    setTimeout(() => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch {
        // 印刷ダイアログを開けない環境ではPDFを別タブで表示（そこから印刷できる）
        window.open(blobUrl, "_blank");
      }
    }, 200);
  };
  // ダイアログが閉じられた後の後片付け（十分待ってから）
  setTimeout(() => iframe.remove(), 120000);
}

// 作ったPDFを印刷ダイアログに載せる共通処理（printElementAsPdf の後半と同じ）。
// iPadは共有メニューのプリント、それ以外は非表示iframeで印刷ダイアログを開く。
function openPdfForPrint(pdf, iosWindow, fileName) {
  const blobUrl = pdf.output("bloburl");
  if (IS_IOS) {
    if (iosWindow && !iosWindow.closed) {
      iosWindow.location.href = blobUrl;
      return;
    }
    pdf.save(fileName || "問診票.pdf");
    return;
  }
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  iframe.src = blobUrl;
  document.body.appendChild(iframe);
  iframe.onload = () => {
    setTimeout(() => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch {
        window.open(blobUrl, "_blank");
      }
    }, 200);
  };
  setTimeout(() => iframe.remove(), 120000);
}

// 複数の要素（1人1枚）をA4複数ページのPDFにして印刷する（当日分の一括印刷用）。
async function printElementsAsPdf(els, iosWindow, fileName) {
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch { /* 待てなくても続行 */ }
  }
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;
  const margin = 8;
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    el.style.display = "block";
    // eslint-disable-next-line no-await-in-loop
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#FFFFFF" });
    el.style.display = "none";
    const img = canvas.toDataURL("image/jpeg", 0.95);
    let imgW = pageW - margin * 2;
    let imgH = (canvas.height * imgW) / canvas.width;
    const maxH = pageH - margin * 2;
    if (imgH > maxH) {
      imgH = maxH;
      imgW = (canvas.width * imgH) / canvas.height;
    }
    if (i > 0) pdf.addPage();
    pdf.addImage(img, "JPEG", (pageW - imgW) / 2, margin, imgW, imgH);
  }
  openPdfForPrint(pdf, iosWindow, fileName);
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hhmm(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function normalizeName(s) {
  return (s || "").replace(/[\s　]/g, "");
}

// 受付行のカタカナ表記。本人が書いたものを最優先し、無ければ氏名から推測する。
//   1. 問診票の「カタカナ表記」欄  ← 本人が確認して書いたもの
//   2. 予約のフリガナ（受付時に受付行へ写したものを含む）
//   3. 氏名からの自動推測（漢字は推測できないので出ない）
// 戻り値の guessed は「推測なので確定ではない」ことを画面で示すため。
function kanaFor(checkin, form, booking) {
  const row = (form?.answers || []).find((r) => /カタカナ|katakana/i.test(r?.label || ""));
  if (row?.value?.trim()) return { text: row.value.trim(), guessed: false };
  if (checkin.patient_kana?.trim()) return { text: checkin.patient_kana.trim(), guessed: false };
  if (booking?.patient_kana?.trim()) return { text: booking.patient_kana.trim(), guessed: false };
  const guess = guessKana(checkin.patient_name);
  return guess ? { text: guess, guessed: true } : null;
}

// 問診票（intake_forms）のanswersからメールアドレスを取り出す。intake_formsには
// email専用カラムが無く、FIELDSの「Email ／ メールアドレス」行に入っている
function emailFromIntakeAnswers(form) {
  const row = (form?.answers || []).find((r) => /Email|メールアドレス/i.test(r?.label || ""));
  const v = (row?.value || "").trim();
  if (!v || v === "—") return "";
  return v.split(" ／ ")[0].trim();
}

// 生年月日（YYYY-MM-DD）から本日時点の満年齢。判定できなければ null。
function ageFrom(dob) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(dob || "").trim());
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

// 生年月日（YYYY-MM-DD）の和暦の年（例: 平成4年）。保険証やカルテは和暦表記
// なので、紙の問診票に添えておくと突き合わせで暗算しなくて済む。
// 月日は西暦と同じなので年号+年だけでよい
function warekiFrom(dob) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(dob || "").trim());
  if (!m) return null;
  const key = +m[1] * 10000 + +m[2] * 100 + +m[3];
  const era =
    key >= 20190501 ? ["令和", 2019] :
    key >= 19890108 ? ["平成", 1989] :
    key >= 19261225 ? ["昭和", 1926] :
    key >= 19120730 ? ["大正", 1912] : null;
  if (!era) return null;
  const n = +m[1] - era[1] + 1;
  return `${era[0]}${n === 1 ? "元" : n}年`;
}

// 「1992-03-07（平成4年・34歳）」の括弧の中身。判定できない部分は黙って省く
function dobAnnotation(dob) {
  const age = ageFrom(dob);
  return [warekiFrom(dob), age === null ? null : `${age}歳`].filter(Boolean).join("・");
}

// 電話番号の表示用。DBには数字だけで保存されている（monshin_online は RPC が正規化）。
// 国内番号はハイフン区切り、それ以外（Zoom英語の海外番号など）は国番号付きの +表記にする
function fmtPhoneDisp(p) {
  const s = String(p || "").replace(/[^0-9]/g, "");
  if (!s) return "";
  if (s.length === 11 && s.startsWith("0")) return `${s.slice(0, 3)}-${s.slice(3, 7)}-${s.slice(7)}`;
  if (s.length === 10 && s.startsWith("0")) return `${s.slice(0, 3)}-${s.slice(3, 6)}-${s.slice(6)}`;
  return `+${s}`;
}

// 生年月日は列に入っているのが基本だが、列が空の問診票（LPからの記入など）も
// あるので、回答の中の生年月日欄も見にいく
function formBirthdate(form) {
  if (!form) return null;
  if (form.date_of_birth) return form.date_of_birth;
  const row = (form.answers || []).find((r) => /生年月日|date of birth/i.test(r?.label || ""));
  return row?.value || null;
}

// 問診票の記入状況。問診票の本体は最後の送信まで届かないので、それまでは
// 「何問目を開いているか」だけが手がかりになる（intake.html が質問を進める
// たびに書き込む）。5分以上動いていなければ、止まっている可能性を色で示す。
function IntakeProgress({ checkin }) {
  const step = checkin.intake_step;
  const total = checkin.intake_total;
  if (step == null || !total) {
    return <span className="text-[10px] leading-tight" style={{ color: "#C9AEB3" }}>未開始</span>;
  }
  const done = step >= total;
  const mins = checkin.intake_step_at
    ? Math.floor((Date.now() - new Date(checkin.intake_step_at).getTime()) / 60000)
    : null;
  const stalled = mins != null && mins >= 5;
  const color = done ? "#0F8B8D" : stalled ? "#C0762C" : "#8A7378";
  return (
    <div className="flex flex-col items-start gap-0.5" style={{ width: 92 }}>
      <span className="text-[10px] leading-tight" style={{ color }}>
        {done ? "送信待ち" : `記入中 ${step}/${total}`}
        {stalled ? `・${mins}分` : ""}
      </span>
      <div style={{ width: "100%", height: 3, borderRadius: 2, background: "#F2DFE4", overflow: "hidden" }}>
        <div style={{ width: `${Math.round((step / total) * 100)}%`, height: "100%", background: color }} />
      </div>
    </div>
  );
}

// 会計で扱いが変わる境目を色で出す。寒色＝保険が使える方、暖色＝本日は10割の方。
// 暖色の3つは同じ10割でも領収書の説明が違う（自費＝説明なし／海外保険＝領収書を
// 保険会社へ／保険証忘れ＝今月中の持参で差額返金）ので、色を分けている。
const INSURANCE_BADGE = {
  mynumber: { label: "マイナ保険証", bg: "#E6EFF9", fg: "#2F6DA8" },
  hokensho: { label: "資格確認書", bg: "#E4F1E7", fg: "#3D7A52" },
  self_pay: { label: "自費", bg: "#FBF0DC", fg: "#8A6317" },
  overseas: { label: "自費（海外保険）", bg: "#FBE6D5", fg: "#A85A22" },
  forgot: { label: "保険証忘れ", bg: "#FCE9EA", fg: "#B03A44" },
};
const INSURANCE_LABEL = Object.fromEntries(
  Object.entries(INSURANCE_BADGE).map(([id, b]) => [id, b.label])
);
// 予定表用の短い表記。1行目の右端に入れるので、長いと生年月日を押し出す
const INSURANCE_SHORT = {
  mynumber: "マイナ",
  hokensho: "資格確認",
  self_pay: "自費",
  overseas: "海外保険",
  forgot: "証忘れ",
};

function InsuranceTag({ id }) {
  const badge = INSURANCE_BADGE[id];
  if (!badge) return <span style={{ color: "#C9AEB3" }}>—</span>;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap"
      style={{ background: badge.bg, color: badge.fg }}
    >
      {badge.label}
    </span>
  );
}
const RETURN_REASON_LABEL = { results: "検査結果", followup: "前回の続き", new_symptom: "新しい症状" };
const CHANNEL_LABEL = { liff: "LINE", web: "Web", staff: "スタッフ" };
const BOOKING_STATUS = {
  booked: { label: "予約中", bg: "#DFF5F3", fg: "#0F8B8D" },
  done: { label: "来院済み", bg: "#EEF0F2", fg: "#8A7378" },
  cancelled: { label: "キャンセル", bg: "#FCE9EA", fg: "#B03A44" },
};

// 予約の「内容」列: 再診理由 / 初診の相談内容 / 受け取り薬 のうちあるものを表示
function bookingDetail(b) {
  const parts = [];
  if (b.return_reason) parts.push(RETURN_REASON_LABEL[b.return_reason] || b.return_reason);
  if (Array.isArray(b.concerns) && b.concerns.length) parts.push(b.concerns.join("、"));
  if (Array.isArray(b.medications) && b.medications.length) parts.push(b.medications.join("、"));
  return parts.join("　") || "—";
}

// アフターピルの受付に付く「避妊せずに性行為があった日」からの経過。
// 服用までの時間で出せる薬が変わるので、72時間を過ぎていそうなら赤で出す。
// 受付では日付しか聞いていないため、3日以上前を「超過の可能性」とする
function ecElapsed(dateStr) {
  if (!dateStr) return null;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const days = Math.floor((new Date(`${today}T00:00:00`) - new Date(`${dateStr}T00:00:00`)) / 86400000);
  return { days, over: days >= 3 };
}

// 問診票からアフターピル（MAP）の申告を拾う。受診理由にアフターピルが入っていれば、
// 性交渉の日時（自由記入・任意なので空のことがある）と一緒に返す。
// 初診の方は受付でアフターピルのボタンを通らず、問診票にだけ書いてある
function mapFromForm(form) {
  const rows = form?.answers || [];
  const reason = rows.find((r) => /受診理由/.test(r?.label || ""))?.value || "";
  if (!/Morning-after|アフターピル/i.test(reason)) return null;
  const timing = rows.find((r) => /性交渉の日時/.test(r?.label || ""))?.value || "";
  return { timing: timing && timing !== "—" ? timing : "" };
}

// MAP（モーニングアフターピル）のタグ。飲むまでの時間で出せる薬が変わるので、
// 問診票を開かなくても一覧で気づけるようにする。
//   date   … 受付で日付を選んでもらった場合（再診ルート）。経過日数を出せる
//   timing … 問診票の自由記入（初診ルート）。書かれたまま出す
function MapTag({ date, timing }) {
  const e = ecElapsed(date);
  return (
    <div>
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold"
        style={{ background: "#FCE9EA", color: "#B03A44" }}
        title="モーニングアフターピル"
      >
        MAP
      </span>
      {e ? (
        <div className="mt-0.5 font-bold leading-tight" style={{ color: e.over ? "#B03A44" : "#C0762C" }}>
          性行為 {date}
          <br />
          {e.days === 0 ? "本日" : `${e.days}日前`}
          {e.over ? "・72時間超の可能性" : ""}
        </div>
      ) : timing ? (
        <div className="mt-0.5 leading-tight" style={{ color: "#C0762C" }}>性交渉 {timing}</div>
      ) : (
        <div className="mt-0.5 leading-tight" style={{ color: "#C9AEB3" }}>性交渉の日時 未記入</div>
      )}
    </div>
  );
}

// 受診理由バッジの配色。カテゴリで意味を持たせる（避妊・肌・周期調整=teal、
// 内診が要る系=purple、期日がある系=amber、その他=blue、更年期=green）
const REASON_BADGE_COLORS = {
  teal: { bg: "#DFF5F3", fg: "#085041" },
  purple: { bg: "#EFEAFB", fg: "#5B4BB8" },
  amber: { bg: "#FAEEDA", fg: "#633806" },
  blue: { bg: "#E3EDFB", fg: "#2B5FAB" },
  green: { bg: "#EAF3DE", fg: "#3B6D11" },
};
// 受診理由（チェックボックスの value=英語）→ 受付一覧「内容」列のバッジ。
// アフターピルは既存のMapTagで別に出しているのでここには含めない。
// detailLabel があるものは、対応する自由記入欄の回答をバッジの下に添える
const REASON_BADGE_DEFS = [
  { value: "Birth control pills", label: "OC", color: "teal" },
  { value: "Mini-pill (progestogen-only)", label: "ミニピル", color: "teal" },
  { value: "Period shifting", label: "月経移動", color: "teal", detailLabel: /ずらしたいご予定/ },
  { value: "Menstrual pain", label: "生理痛", color: "teal" },
  { value: "Irregular period", label: "生理不順", color: "teal" },
  { value: "Acne / skin", label: "肌", color: "teal" },
  { value: "PMS / mood", label: "PMS", color: "teal" },
  { value: "Menopause", label: "更年期", color: "green" },
  { value: "Bleeding outside my period", label: "不正出血", color: "purple" },
  { value: "Bladder infection (cystitis)", label: "UTI", color: "purple" },
  { value: "Refill of a medication prescribed here before", label: "処方追加", color: "amber", detailLabel: /ご希望のお薬/ },
  { value: "Other", label: "その他", color: "blue", detailLabel: /その他の内容/ },
];
// 内診が要る点で共通の3つは、個別に並べず「内」1つにまとめて下に具体名を出す
const NAISHIN_GROUP = [
  { value: "Discharge / itching", label: "おりもの・かゆみ" },
  { value: "STD testing", label: "性感染症検査" },
  { value: "Pap smear (cervical cancer screening)", label: "子宮頸がん検診" },
];
function reasonBadgesForForm(form) {
  const rows = form?.answers || [];
  const reasonRaw = rows.find((r) => /受診理由/.test(r?.label || ""))?.value || "";
  if (!reasonRaw || reasonRaw === "None checked") return [];
  const selected = reasonRaw.split(";").map((s) => s.trim()).filter(Boolean);
  const badges = [];
  REASON_BADGE_DEFS.forEach((def) => {
    if (selected.indexOf(def.value) === -1) return;
    const detailRaw = def.detailLabel ? rows.find((r) => def.detailLabel.test(r?.label || ""))?.value || "" : "";
    badges.push({ label: def.label, color: def.color, detail: detailRaw && detailRaw !== "—" ? detailRaw : "" });
  });
  const naishinHit = NAISHIN_GROUP.filter((g) => selected.indexOf(g.value) !== -1);
  if (naishinHit.length) {
    badges.push({ label: "内", color: "purple", detail: naishinHit.map((g) => g.label).join("、") });
  }
  return badges;
}
function ReasonBadge({ badge }) {
  const c = REASON_BADGE_COLORS[badge.color] || REASON_BADGE_COLORS.teal;
  return (
    <div>
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap"
        style={{ background: c.bg, color: c.fg }}
      >
        {badge.label}
      </span>
      {badge.detail && <div className="mt-0.5 leading-tight" style={{ color: "#C0762C" }}>{badge.detail}</div>}
    </div>
  );
}

// 問診票の回答は「English ／ 日本語」の対で保存されている。紙は日本語だけでよい
function jaPart(v) {
  const s = String(v || "").trim();
  if (!s || s === "—") return "";
  const i = s.lastIndexOf("／");
  return (i >= 0 ? s.slice(i + 1) : s).trim();
}

// 予定表の1行に収まる長さに切る（切ったことが分かるように…を付ける）。
// 何文字入るかは列の幅と行数で変わるので、切るのは組む直前まで待つ
function clip(s, max) {
  const t = String(s || "").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

// 来院受付の問診票から「今日の診察内容」。ご本人が書いたものなので、
// 予約のメニュー名より実際の診察に近い。その他・追加処方は中身まで拾う
function reasonFromIntake(form) {
  const rows = form?.answers || [];
  if (!rows.length) return "";
  const pick = (re) => jaPart(rows.find((r) => re.test(r?.label || ""))?.value);
  const parts = [
    pick(/受診理由|ご相談内容|Reason for visit|Today's concern/),
    pick(/その他の内容|Other, details/),
    pick(/ご希望のお薬|Refill requested/),
  ].filter((s) => s && !/^未質問/.test(s));
  return [...new Set(parts)].join("　");
}

// オンライン診療の問診票から同じもの（回答は日本語のまま入っている）
function reasonFromMonshin(row) {
  const rows = row?.answers || [];
  const a = rows.find((r) => r?.qid === "reason") || rows.find((r) => /いかがなさいましたか|受診理由/.test(r?.q_ja || ""));
  return String(a?.a_ja || "").trim();
}

// 診察の区分表示（初診 / 再診・○○）。
// 初診はカルテも問診票も新しく作る／診察も長い。一覧を上から目で追うときに
// 文字を読まずに拾えるよう、初診と再診で色を分ける
const VISIT_KIND_BADGE = {
  first: { label: "初診", bg: "#F3E8FB", fg: "#6B3A96" },
  return: { label: "再診", bg: "#DFF5F3", fg: "#0F8B8D" },
};

function VisitKindTag({ c }) {
  const badge = c.visit_type === "consult" ? VISIT_KIND_BADGE[c.visit_kind] : null;
  if (!badge) return <span style={{ color: "#C9AEB3" }}>—</span>;
  const reason = c.visit_kind === "return" ? RETURN_REASON_LABEL[c.return_reason] : "";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold"
        style={{ background: badge.bg, color: badge.fg }}
      >
        {badge.label}
      </span>
      {reason && <span style={{ color: "#8A7378" }}>{reason}</span>}
    </span>
  );
}

// 飲み方ガイドの読了状況。ガイド側（intake.html）が「読みました」を押すたびに
// set_intake_guide_read / set_monshin_guide_read で送ってくる（048_guide_read.sql）。
// total が無い（一度も開かれていない）とき:
//   expected=false … 受診理由からガイド対象外（旧データで判定できない場合も含む）。何も出さない
//   expected=true  … 対象のはずなのに未読のまま。声かけ／メール再送の判断材料として赤で出す
function GuideReadTag({ read, total, expected }) {
  if (!total) {
    if (!expected) return null;
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap"
        style={{ background: "#FCE9EA", color: "#B03A44" }}
        title="問診票の内容からガイド対象のはずですが、まだ開かれていません"
      >
        <AlertTriangle size={10} />
        ガイド未読
      </span>
    );
  }
  const done = (read ?? 0) >= total;
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap"
      style={done ? { background: "#DFF5F3", color: "#0F8B8D" } : { background: "#FFF3DC", color: "#B7791F" }}
    >
      {done ? "ガイド確認済" : `ガイド ${read ?? 0}/${total}`}
    </span>
  );
}

// 受付行から問診票のURLを組み立てる（受付機の qrUrlFor と同じ出し分け）。
// 紙の受付票を出さない運用なので、患者さんが画面を閉じて問診票のリンクを
// 見失ったときは、スタッフがこのQRを見せて読み直してもらう。
const INTAKE_BASE = new URL("./", window.location.href).toString();
function intakeUrlForCheckin(c) {
  if (c.visit_type !== "consult") return null;
  const q = `?checkin=${encodeURIComponent(c.id)}&token=${encodeURIComponent(c.submit_token || "")}&lang=ja`;
  if (c.visit_kind === "first") return `${INTAKE_BASE}intake.html${q}`;
  if (c.visit_kind === "return" && c.return_reason === "new_symptom") return `${INTAKE_BASE}intake.html${q}`;
  if (c.visit_kind === "return" && c.return_reason === "followup") return `${INTAKE_BASE}followup.html${q}`;
  return null;
}

function QrImage({ url, size = 220 }) {
  const [dataUrl, setDataUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, { width: size * 2, margin: 1, color: { dark: "#3A2E30", light: "#FFFFFF" } })
      .then((d) => alive && setDataUrl(d))
      .catch(() => alive && setDataUrl(null));
    return () => { alive = false; };
  }, [url, size]);
  if (!dataUrl) return <div style={{ width: size, height: size, background: "#FFF8F7", borderRadius: 12 }} />;
  return <img src={dataUrl} alt="問診票のQRコード" width={size} height={size} style={{ borderRadius: 12 }} />;
}

// 院内カルテ番号の入力欄。
//
// 電子カルテとは繋がっていないので、どの問診票がどのカルテの方かは人が見て決める。
// 受付一覧の行からも、あとから探した問診票からも同じように書き込めるようにする。
//
// 受付一覧は10秒ごとに勝手に読み直すので、入力中に上書きされないよう、
// 手を入れた後（dirty）は外からの値を無視する
function ChartNumberInput({ value, onSave, width = 88 }) {
  const [text, setText] = useState(value || "");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!dirty) setText(value || "");
  }, [value, dirty]);

  const commit = async () => {
    const next = text.trim();
    if (next === (value || "").trim()) { setDirty(false); return; }
    setBusy(true);
    const ok = await onSave(next);
    setBusy(false);
    setDirty(false);
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } else {
      setText(value || "");
    }
  };

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="text"
        inputMode="numeric"
        value={text}
        disabled={busy}
        onChange={(e) => { setText(e.target.value); setDirty(true); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        placeholder="—"
        aria-label="カルテ番号"
        className="px-2 py-1 rounded-lg text-xs outline-none"
        style={{
          width,
          background: "#FFF8F7",
          border: `1px solid ${saved ? "#0F8B8D" : "#F2DFE4"}`,
          color: "#3A2E30",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      />
      {saved && <CheckCircle2 size={13} color="#0F8B8D" />}
    </span>
  );
}

// 「同じ人」の判定キー。氏名（空白無視）と生年月日の両方が一致したときだけ
// 同一人物とみなす（同姓同名対策。どちらか欠けていれば照合しない）
function chartMatchKey(name, dob) {
  const n = normalizeName(name);
  return n && dob ? `${n}|${dob}` : null;
}

// 検索語をPostgRESTのフィルタに渡せる形にする。カンマや括弧はフィルタの
// 区切り記号なので落とし、% と _ はLIKEのワイルドカードなので落とす
function safeLike(s) {
  return String(s || "").trim().replace(/[,()"\\%_*]/g, "");
}

// 生年月日の入力ゆれを YYYY-MM-DD の前方一致に直す。
// 「1990」「1990-05」「1990/5/20」「19900520」のどれでも候補を出せるようにする
function dobPrefix(input) {
  const s = String(input || "").trim();
  if (!s) return "";
  const digits = s.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  if (/^\d{4}$/.test(digits) && !/[-/]/.test(s)) return digits;
  const parts = s.split(/[-/.]/).filter(Boolean);
  if (!parts.length || !/^\d{4}$/.test(parts[0])) return "";
  return parts
    .slice(0, 3)
    .map((p, i) => (i === 0 ? p : String(p).padStart(2, "0")))
    .join("-");
}

// オンライン診療（pillorder）の問診票1枚分のA4レイアウト（画面外に隠して画像化する）。
// answers は表示済みの日英文 [{qid,q_ja,a_ja,flag,...}] で保存されているのでそのまま出す。
function MonshinPrintSheet({ row }) {
  const rows = row.answers || [];
  const half = Math.ceil(rows.length / 2);
  const cols = [rows.slice(0, half), rows.slice(half)];
  const flags = rows.filter((a) => a.flag);
  return (
    <div
      style={{
        width: 1120,
        background: "#FFFFFF",
        padding: 28,
        color: "#000000",
        fontFamily: "'Noto Sans JP', sans-serif",
        WebkitTextSizeAdjust: "100%",
        textSizeAdjust: "100%",
      }}
    >
      {/* Zoom分は診察の種別と時刻が一目で分かるよう、いちばん上に大きく出す
          （紙の山から当日分を拾うときに見るのはここだけ、という使われ方） */}
      {row.source === "zoom" && (
        <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1.2, marginBottom: 8 }}>
          英語Zoom{row.reserve_at ? `　${hhmm(row.reserve_at)}` : ""}
          {row.reserve_at && (
            <span style={{ fontSize: 18, fontWeight: 700, marginLeft: 14 }}>{String(row.reserve_at).slice(0, 10)}</span>
          )}
        </div>
      )}
      <div style={{ borderBottom: "2px solid #000000", paddingBottom: 8, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <strong style={{ fontSize: 20 }}>
            問診票 ／ Questionnaire（{row.source === "zoom" ? "Zoom診療・英語" : "オンライン診療"}）
          </strong>
          <div style={{ fontSize: 14, marginTop: 4 }}>
            {row.chart_number ? <strong>カルテ {row.chart_number}　</strong> : null}
            {row.name}
            {row.dob ? `（${row.dob}${dobAnnotation(row.dob) ? `　${dobAnnotation(row.dob)}` : ""}）` : ""}
            {row.phone ? `　電話 ${fmtPhoneDisp(row.phone)}` : ""}
            {row.email ? `　${row.email}` : ""}
          </div>
        </div>
        {/* 予約時間は右上（Zoom分は上に大きく出しているので重ねて出さない） */}
        {row.reserve_at && row.source !== "zoom" ? (
          <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", textAlign: "right" }}>
            予約 {String(row.reserve_at).slice(0, 10)} {hhmm(row.reserve_at)}
          </div>
        ) : null}
      </div>
      {flags.length > 0 && (
        <div style={{ border: "2px solid #c0392b", background: "#fdecea", borderRadius: 6, padding: "8px 12px", marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠ 要注意 / Flagged</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {flags.map((a, i) => <li key={i} style={{ fontSize: 13 }}>{a.q_ja} — <b>{a.a_ja}</b></li>)}
          </ul>
        </div>
      )}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {cols.map((col, ci) => (
          <table key={ci} style={{ width: "50%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {col.map((a, i) => (
                <tr key={i}>
                  <td style={{ border: "1px solid #999999", padding: "4px 7px", width: "48%", color: "#333333" }}>
                    {a.q_ja}
                    {/* Zoom英語分は設問も日英併記（患者は英語で答えているので、照らし合わせやすくする） */}
                    {a.q_en && a.q_en !== a.q_ja && (
                      <div style={{ fontSize: 11, color: "#666666", lineHeight: 1.35 }}>{a.q_en}</div>
                    )}
                  </td>
                  <td style={{ border: "1px solid #999999", padding: "4px 7px", fontWeight: 600, color: a.flag ? "#c0392b" : "#000000" }}>{a.a_ja}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
      {row.free_text && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          <div style={{ fontWeight: 700 }}>自由記入 / Notes</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{row.free_text}</div>
        </div>
      )}
      {/* 受信日時は右下 */}
      <div style={{ marginTop: 14, textAlign: "right", fontSize: 12, color: "#333333" }}>
        {String(row.created_at).slice(0, 10)} {hhmm(row.created_at)} 受信
      </div>
    </div>
  );
}

// 来院受付の問診票（intake_forms）1枚分のA4レイアウト（画面外に隠して画像化する）。
// selectedForm 個別印刷（printAreaRef）と同じ体裁。一括印刷で1人1枚ずつ画像化して使う。
function IntakePrintSheet({ form, reserveLabel, headline }) {
  const rows = form.answers || [];
  const half = Math.ceil(rows.length / 2);
  const dob = formBirthdate(form);
  const extra = dobAnnotation(dob);
  const paren = dob ? `（${dob}${extra ? `　${extra}` : ""}）` : "";
  return (
    <div
      style={{
        width: 1120,
        background: "#FFFFFF",
        padding: 28,
        color: "#000000",
        fontFamily: "'Noto Sans JP', sans-serif",
        WebkitTextSizeAdjust: "100%",
        textSizeAdjust: "100%",
      }}
    >
      {/* 区分と時間の特大見出し（紙の仕分け用） */}
      {headline ? <div style={{ fontSize: 46, fontWeight: 800, lineHeight: 1.1, marginBottom: 8 }}>{headline}</div> : null}
      <div style={{ borderBottom: "2px solid #000000", paddingBottom: 8, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <strong style={{ fontSize: 20 }}>問診票 ／ Questionnaire（来院受付）</strong>
          <div style={{ fontSize: 14, marginTop: 4 }}>
            {form.chart_number ? <strong>カルテ {form.chart_number}　</strong> : null}
            {form.patient_name}{paren}
          </div>
        </div>
        {/* 予約時間は右上 */}
        {reserveLabel ? (
          <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", textAlign: "right" }}>
            予約 {reserveLabel}
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {[rows.slice(0, half), rows.slice(half)].map((col, ci) => (
          <table key={ci} style={{ width: "50%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {col.map((row, i) => {
                const isDob = /生年月日|date of birth/i.test(row.label || "");
                const ex = isDob ? dobAnnotation(row.value) : "";
                return (
                  <tr key={i}>
                    <td style={{ border: "1px solid #999999", padding: "4px 7px", width: "48%", color: "#333333" }}>{row.label}</td>
                    <td style={{ border: "1px solid #999999", padding: "4px 7px", fontWeight: 600 }}>{row.value}{ex ? `（${ex}）` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
      </div>
      {/* 受信日時は右下 */}
      <div style={{ marginTop: 14, textAlign: "right", fontSize: 12, color: "#333333" }}>
        {form.date_key} {hhmm(form.created_at)} 受信
      </div>
    </div>
  );
}

// 1日の予定表（A4）。予約設定の枠割りをそのまま縦に置き、左の時間を固定した
// 時間割にする。来院とオンラインは列を分ける — どちらが詰まっているか、どこが
// 空いているかは、混ぜて時刻順に並べると分からなくなるため。
//
// 枠の高さは全部そろえ、1ページでA4を使い切る。中身の量で高さが変わると
// 時間の目盛りとして読めなくなるので、行数からその日の1行の高さを決める。
// 空き枠には何も書かない — 白いままのほうが空きが見える。
const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];
// 用紙の実寸に対して字が何ミリになるかで組む。幅794pxをA4の194mm（左右8mm余白）
// に印刷するので、1px ≒ 0.244mm ＝ 画面の見た目そのままの大きさで刷られる。
// 以前は幅1120pxで組んでいて、13pxが6ptほどに縮んでいた（読めない・切れる原因）
const SCHEDULE_SHEET_W = 794;
const SCHEDULE_SHEET_H = Math.round((SCHEDULE_SHEET_W * 281) / 194); // 1150
// 見出し・表の見出し行・欄外の注記を引いた、枠に使える高さ
const SCHEDULE_BODY_PX = 1044;
// 高さの見積もりに使う実測値。字は小さくせず、行間とセルの余白を詰めて枠を低くする。
// 1行目に保険とカルテ番号を右寄せで入れて、2行目は診察内容だけにした
// （2行目の右半分が空いていたぶん、枠が1つあたり25pxほど余っていた）
const SCHEDULE_NAME_PX = 16; // 1行目（お名前・生年月日・保険・カルテ）
const SCHEDULE_LINE_PX = 13; // 2行目（診察内容）の1行
const SCHEDULE_ROW_PAD_PX = 3; // 枠の上下の余白と罫線
const SCHEDULE_EMPTY_ROW_PX = 18; // 誰も入っていない枠（時刻だけ）
// 1つの枠に2人入る日でも1枚に収めるための詰めた組み方。1人1行にして、診察内容は
// お名前の後ろに続ける（入りきらない分は…で切る）。2人でも 15×2+1 = 31px なので
// 32枠のA4（1枠あたり32px）に収まる
const SCHEDULE_COMPACT_PX = 15;
const SCHEDULE_COMPACT_PAD_PX = 1;
// オンラインは保険の表示が無いぶん狭くしていたが、カタカナのお名前だと
// 生年月日とカルテ番号に押されて入らなくなるので、来院から30px回す
const SCHEDULE_COL_W = [58, 366, 330];
// 列の中で文字に使える幅（列の幅 − セルの余白8 − チェック欄と間隔14）と、
// 診察内容が1行に入る全角の文字数（10.5pxで割ったもの）
const SCHEDULE_VISIT_COL = { px: SCHEDULE_COL_W[1] - 22, chars: 32 };
const SCHEDULE_ONLINE_COL = { px: SCHEDULE_COL_W[2] - 22, chars: 29 };

// 文字の幅のおよそ。半角（英数記号・半角カナ）は全角のおよそ0.55倍
function textPx(s, size) {
  let w = 0;
  for (const ch of String(s || "")) w += /[\x20-\x7E｡-ﾟ]/.test(ch) ? size * 0.55 : size;
  return w;
}

// 1行目（お名前・カナ・年齢）に要る行数。折り返してよい日はカナが次の行へ回る
function scheduleNameLines(e, col, maxNameLines) {
  const age = ageFrom(e.dob);
  const w =
    textPx(e.name || "—", 13) +
    (e.kana ? 5 + textPx(e.kana, 10.5) : 0) +
    (age === null ? 0 : 5 + textPx(`${age}歳`, 10.5));
  return Math.min(maxNameLines, Math.max(1, Math.ceil(w / col.px)));
}

// 予定表の2行目。区分と診察内容を置く（保険とカルテ番号はその右端へ回り込ませる）
function scheduleDetail(e) {
  return e.reason || [e.menu, e.detail].filter(Boolean).join("　") || "";
}

// 右端の保険・カルテ番号が2行目の1行目から奪う幅（全角の文字数に換算）。
// カルテ番号は等幅の半角なので全角0.62文字ぶんで数える
function scheduleRightChars(e) {
  const ins = e.insurance ? e.insurance.length : 0;
  const chart = e.chart ? e.chart.length * 0.62 : 0;
  if (!ins && !chart) return 0;
  return Math.ceil(ins + chart + (ins && chart ? 1 : 0)) + 1;
}

// 組み方の候補。上から順に試して、A4に収まった最初のものを使う。
// 余白があるうちはお名前・カナを折り返し、診察内容も2行使って最後まで出す。
// 入らなくなってから、内容 → カナ の順に削る（お名前は最後まで削らない）
const SCHEDULE_MODES = [
  { compact: false, maxLines: 2, nameLines: 2 },
  { compact: false, maxLines: 1, nameLines: 2 },
  { compact: false, maxLines: 1, nameLines: 1 },
  { compact: true, maxLines: 1, nameLines: 1 },
];

// 2行目の中身。区分（初診・再診）と注意書きを頭に置き、残った文字数だけ診察内容を出す。
// 保険・カルテ番号は右端に回り込ませるので、狭くなるのは1行目だけ
function scheduleLine2(e, col, maxLines) {
  const head = [e.visitKind, e.alert].filter(Boolean).join(" ");
  const headLen = head ? head.length + 1 : 0;
  const first = Math.max(4, col.chars - scheduleRightChars(e) - headLen);
  const room = first + (maxLines - 1) * col.chars;
  const detail = clip(scheduleDetail(e), room);
  const over = detail.length - first;
  // 保険・カルテ番号しか無い人でも、それを置く1行は要る
  const empty = !headLen && !detail.length && !scheduleRightChars(e);
  const lines = empty ? 0 : Math.min(maxLines, over > 0 ? 1 + Math.ceil(over / col.chars) : 1);
  return { head, detail, lines };
}

// 1人ぶんに要る高さ。折り返す行数まで数える。
// 詰めた組み方（compact）では診察内容をお名前の後ろに続けて1行にする
function scheduleEntryPx(e, col, mode) {
  if (mode.compact) return SCHEDULE_COMPACT_PX;
  return (
    SCHEDULE_NAME_PX * scheduleNameLines(e, col, mode.nameLines) +
    scheduleLine2(e, col, mode.maxLines).lines * SCHEDULE_LINE_PX
  );
}

// 枠1つに要る高さ。来院とオンラインの高いほうで決まる
function scheduleRowPx(r, mode) {
  const sum = (list, col) => list.reduce((n, e) => n + scheduleEntryPx(e, col, mode), 0);
  return Math.max(
    mode.compact ? SCHEDULE_COMPACT_PX : SCHEDULE_EMPTY_ROW_PX,
    (mode.compact ? SCHEDULE_COMPACT_PAD_PX : SCHEDULE_ROW_PAD_PX) +
      Math.max(sum(r.visits, SCHEDULE_VISIT_COL), sum(r.onlines, SCHEDULE_ONLINE_COL))
  );
}

// 予定表の1人ぶん。枠の時刻と違う時刻の方（薬の受け取りなど刻みが細かい予約）は
// 時刻を頭に出す。診察内容は問診票のご本人の記入を優先し、まだ届いていなければ
// 予約のメニューを出す
function ScheduleEntry({ e, showTime, mode, col }) {
  const age = ageFrom(e.dob);
  const line2 = scheduleLine2(e, col, mode.maxLines);
  const wrapName = mode.nameLines > 1;
  if (mode.compact) {
    // 詰めた組み方。1人1行に畳んで、診察内容は残った幅に入るだけ入れる
    return (
      <div style={{ display: "flex", gap: 4, alignItems: "baseline", lineHeight: 1.2, whiteSpace: "nowrap" }}>
        <div style={{ width: 9, height: 9, border: "1px solid #000000", flexShrink: 0 }} />
        {showTime ? (
          <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>{e.time}</span>
        ) : null}
        <span style={{ fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{e.name || "—"}</span>
        {age === null ? null : <span style={{ fontSize: 10, color: "#333333", flexShrink: 0 }}>{age}歳</span>}
        <span
          style={{ fontSize: 10, color: "#333333", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {line2.head ? <span style={{ fontWeight: 700, color: "#000000" }}>{line2.head} </span> : null}
          {line2.detail}
        </span>
        <span style={{ fontSize: 10, color: "#333333", flexShrink: 0 }}>
          {e.insurance}
          {e.insurance && e.chart ? "　" : ""}
          {e.chart ? <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{e.chart}</span> : null}
        </span>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "baseline", lineHeight: 1.2 }}>
      <div style={{ width: 10, height: 10, border: "1px solid #000000", flexShrink: 0, marginTop: 2 }} />
      {showTime ? (
        <span style={{ fontSize: 10.5, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>{e.time}</span>
      ) : null}
      <div style={{ minWidth: 0, flex: 1 }}>
        {/* 1行目はお名前・カナ・年齢だけ。生年月日は問診票のほうに出ているので、
            ここは呼び出すときに要るものに絞る。枠に高さがある日はカナを次の行へ
            折り返して最後まで出し、詰まっている日だけ…で切る */}
        <div
          style={{
            display: "flex",
            gap: 5,
            alignItems: "baseline",
            flexWrap: wrapName ? "wrap" : "nowrap",
            whiteSpace: wrapName ? "normal" : "nowrap",
          }}
        >
          {/* お名前は縮めない。長いお名前ほど呼び間違えるので、詰まったときに譲るのはカナ */}
          <span style={{ fontWeight: 700, fontSize: 13, flexShrink: 0, whiteSpace: "nowrap" }}>{e.name || "—"}</span>
          {e.kana ? (
            <span
              style={{
                fontSize: 10.5,
                color: "#555555",
                minWidth: 0,
                ...(wrapName ? {} : { overflow: "hidden", textOverflow: "ellipsis" }),
              }}
            >
              {e.kana}
            </span>
          ) : null}
          {age === null ? null : (
            <span style={{ fontSize: 10.5, color: "#333333", flexShrink: 0 }}>{age}歳</span>
          )}
        </div>
        {/* 2行目は初診・再診と診察内容。枠に余白があるうちは2行使って最後まで出す。
            72時間の制限があるMAP・問診票で引っかかった方も頭に太字で出す。
            保険とカルテ番号は右端に浮かせる — 2行に伸びたとき2行目は幅いっぱい使える */}
        {line2.lines > 0 && (
          <div style={{ fontSize: 10.5, color: "#333333", wordBreak: "break-word" }}>
            <span style={{ float: "right", paddingLeft: 6, whiteSpace: "nowrap" }}>
              {e.insurance}
              {e.insurance && e.chart ? "　" : ""}
              {e.chart ? <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{e.chart}</span> : null}
            </span>
            {line2.head ? <span style={{ fontWeight: 700, color: "#000000" }}>{line2.head} </span> : null}
            {line2.detail}
          </div>
        )}
      </div>
    </div>
  );
}

// 予定表1ページぶん。画面外に置いて画像化するので、色は白黒印刷でも潰れない濃さにする
function ScheduleSheet({ rows, dateKey, page, pageCount, visitCount, onlineCount, note, mode }) {
  const wd = /^\d{4}-\d{2}-\d{2}$/.test(dateKey)
    ? WEEKDAY_JA[new Date(`${dateKey}T00:00:00`).getDay()]
    : "";
  const cell = { border: "1px solid #999999", padding: mode.compact ? "0 4px" : "1px 4px", verticalAlign: "top" };
  const head = { ...cell, background: "#EAEAEA", fontWeight: 700, textAlign: "left", fontSize: 11 };
  // 枠の高さはこのページの枠の数で決める。全部そろえて、A4を使い切る
  const rowH = rows.length ? Math.floor(SCHEDULE_BODY_PX / rows.length) : SCHEDULE_BODY_PX;
  return (
    <div
      style={{
        width: SCHEDULE_SHEET_W,
        height: SCHEDULE_SHEET_H,
        background: "#FFFFFF",
        padding: 20,
        color: "#000000",
        fontFamily: "'Noto Sans JP', sans-serif",
        WebkitTextSizeAdjust: "100%",
        textSizeAdjust: "100%",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          borderBottom: "2px solid #000000",
          paddingBottom: 5,
          marginBottom: 7,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 12,
        }}
      >
        <div>
          <strong style={{ fontSize: 16 }}>1日の予定表</strong>
          <span style={{ fontSize: 14, marginLeft: 8, fontWeight: 700 }}>
            {dateKey}
            {wd ? `（${wd}）` : ""}
          </span>
        </div>
        <div style={{ fontSize: 11, whiteSpace: "nowrap" }}>
          来院 {visitCount}件 ／ オンライン {onlineCount}件
          {pageCount > 1 ? `　${page} / ${pageCount} ページ` : ""}
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
        <colgroup>
          {SCHEDULE_COL_W.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th style={{ ...head, textAlign: "center" }}>時間</th>
            <th style={head}>来院</th>
            <th style={head}>オンライン（pillorder）</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            // 高さは全部そろえる。空いている枠には何も書かない（白いほうが空きが見える）。
            // 枠を閉じている時間だけは灰色にして、書き込めないことを色で示す
            <tr key={r.time} style={{ height: rowH }}>
              <td
                style={{
                  ...cell,
                  textAlign: "center",
                  fontWeight: 700,
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono', monospace",
                  background: r.closed ? "#D6D6D6" : "#F5F5F5",
                }}
              >
                {r.time}
              </td>
              <td style={{ ...cell, background: r.closed ? "#EDEDED" : "#FFFFFF" }}>
                {r.visits.map((e) => (
                  <ScheduleEntry key={e.key} e={e} showTime={e.time !== r.time} mode={mode} col={SCHEDULE_VISIT_COL} />
                ))}
              </td>
              <td style={{ ...cell, background: "#F7F7F7" }}>
                {r.onlines.map((e) => (
                  <ScheduleEntry key={e.key} e={e} showTime={e.time !== r.time} mode={mode} col={SCHEDULE_ONLINE_COL} />
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length === 0 && (
        <div style={{ marginTop: 12, fontSize: 12 }}>この日の予定はありません。</div>
      )}
      <div
        style={{
          marginTop: "auto",
          paddingTop: 6,
          fontSize: 9.5,
          color: "#333333",
          lineHeight: 1.5,
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span style={{ whiteSpace: "nowrap", marginLeft: "auto" }}>
          {note ? `${note}　` : ""}
          {todayKey()} 印刷
        </span>
      </div>
    </div>
  );
}

// スタッフ → 管理者への要望・報告ボックス（「要望」タブ）。
// 投稿・閲覧・対応済みチェックともスタッフのログインで誰でも使える
// （専用アカウントを作らない運用。誰がチェックしたかは done_by に残る）
const FEEDBACK_CATEGORY = [
  ["request", "機能を追加してほしい"],
  ["change", "仕様を変えたい"],
  ["bug", "不具合・おかしい"],
  ["other", "その他"],
];
const FEEDBACK_CATEGORY_LABEL = Object.fromEntries(FEEDBACK_CATEGORY);

function FeedbackTab({ isAdmin, adminName, onCountChange }) {
  const [rows, setRows] = useState(null);
  // 共有iPadなので記名は自由記入。前回の名前を覚えておく
  const [author, setAuthor] = useState(() => localStorage.getItem("kiosk-feedback-name") || "");
  const [category, setCategory] = useState("request");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [noteFor, setNoteFor] = useState(null); // 対応コメント入力中の行 {id, note}

  const load = () =>
    supabase.from("staff_feedback").select("*").order("created_at", { ascending: false })
      .then(({ data, error: e }) => {
        if (e) { setError(e.message); return; }
        setRows(data || []);
        onCountChange?.((data || []).filter((r) => r.status === "open").length);
      });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!author.trim() || !body.trim() || busy) return;
    setBusy(true);
    setError("");
    localStorage.setItem("kiosk-feedback-name", author.trim());
    const { error: e } = await supabase.from("staff_feedback")
      .insert({ author: author.trim(), category, body: body.trim() });
    setBusy(false);
    if (e) { setError(`送信できませんでした: ${e.message}`); return; }
    setBody("");
    load();
  };

  const markDone = async (row) => {
    const { error: e } = await supabase.from("staff_feedback")
      .update({ status: "done", done_at: new Date().toISOString(), done_by: adminName || "管理者", done_note: (noteFor?.note || "").trim() || null })
      .eq("id", row.id);
    if (e) { setError(`更新できませんでした: ${e.message}`); return; }
    setNoteFor(null);
    load();
  };
  const reopen = async (row) => {
    const { error: e } = await supabase.from("staff_feedback")
      .update({ status: "open", done_at: null, done_by: null, done_note: null })
      .eq("id", row.id);
    if (e) { setError(`更新できませんでした: ${e.message}`); return; }
    load();
  };

  const dateLabel = (ts) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const open = (rows || []).filter((r) => r.status === "open");
  const done = (rows || []).filter((r) => r.status === "done");

  const card = { background: "#FFFFFF", border: "1px solid #F2DFE4", borderRadius: 16 };
  const input = { background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#3A2E30" };

  return (
    /* 見出し・幅は「患者を探す」「設定」タブと同じ体裁（画面幅いっぱい、大見出し＋説明文） */
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-bold mb-1" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
          かねこさんへの要望・報告
        </h2>
        <p className="text-xs" style={{ color: "#B08A90" }}>
          仕様を変えたい・機能を追加してほしい・おかしい所を見つけた、など何でもどうぞ。対応したらこのページでチェックが付きます。
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-xl text-sm" style={{ background: "#FCE9EA", color: "#B03A44" }}>{error}</div>
      )}

      {/* 送信フォーム */}
      <div className="p-4" style={card}>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="お名前（必須）"
            className="px-3 py-2 rounded-lg text-sm outline-none"
            style={{ ...input, width: 160 }}
          />
          <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid #F2DFE4" }}>
            {FEEDBACK_CATEGORY.map(([id, label]) => (
              <button
                key={id}
                onClick={() => setCategory(id)}
                className="text-[11px] font-bold px-2.5 py-2"
                style={category === id ? { background: "#0F8B8D", color: "#FFFFFF" } : { background: "#FFFFFF", color: "#8A7378" }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="内容（例）予約状況の一覧にも電話番号を出してほしい"
          rows={3}
          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
          style={input}
        />
        <div className="mt-2 flex justify-end">
          <button
            onClick={submit}
            disabled={!author.trim() || !body.trim() || busy}
            className="px-5 py-2 rounded-xl text-sm font-bold active:opacity-70"
            style={{ background: "#0F8B8D", color: "#FFFFFF", opacity: !author.trim() || !body.trim() || busy ? 0.4 : 1 }}
          >
            {busy ? "送信中..." : "送信"}
          </button>
        </div>
      </div>

      {/* 未対応 */}
      <div>
        <h3 className="text-sm font-bold mb-2" style={{ color: "#3A2E30" }}>
          未対応 <span style={{ color: "#D64550" }}>{open.length}件</span>
        </h3>
        {rows === null ? (
          <p className="text-xs" style={{ color: "#B08A90" }}>読み込み中...</p>
        ) : open.length === 0 ? (
          <p className="text-xs" style={{ color: "#B08A90" }}>未対応の要望はありません。</p>
        ) : (
          <div className="flex flex-col gap-2">
            {open.map((r) => (
              <div key={r.id} className="p-3" style={card}>
                <div className="flex items-center gap-2 text-[11px] mb-1" style={{ color: "#B08A90" }}>
                  <span className="px-1.5 py-0.5 rounded font-bold" style={{ background: "#FCE9EA", color: "#D64550" }}>
                    {FEEDBACK_CATEGORY_LABEL[r.category] || r.category}
                  </span>
                  <span>{dateLabel(r.created_at)}</span>
                  <span className="font-bold" style={{ color: "#6B585C" }}>{r.author}</span>
                </div>
                <div className="text-sm" style={{ color: "#3A2E30", whiteSpace: "pre-wrap" }}>{r.body}</div>
                {isAdmin && (
                  noteFor?.id === r.id ? (
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <input
                        value={noteFor.note}
                        onChange={(e) => setNoteFor({ id: r.id, note: e.target.value })}
                        placeholder="対応内容（任意）例）予約状況タブに追加しました"
                        className="flex-1 px-3 py-1.5 rounded-lg text-xs outline-none"
                        style={{ ...input, minWidth: 220 }}
                      />
                      <button onClick={() => markDone(r)} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: "#0F8B8D", color: "#FFFFFF" }}>
                        対応済みにする
                      </button>
                      <button onClick={() => setNoteFor(null)} className="px-2 py-1.5 text-xs" style={{ color: "#8A7378" }}>やめる</button>
                    </div>
                  ) : (
                    <div className="mt-2">
                      <button
                        onClick={() => setNoteFor({ id: r.id, note: "" })}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold"
                        style={{ background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#0F8B8D" }}
                      >
                        <CheckCircle2 size={13} /> 対応済みにする
                      </button>
                    </div>
                  )
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 対応済み */}
      {done.length > 0 && (
        <div>
          <h3 className="text-sm font-bold mb-2" style={{ color: "#3A2E30" }}>対応済み {done.length}件</h3>
          <div className="flex flex-col gap-2">
            {done.map((r) => (
              <div key={r.id} className="p-3" style={{ ...card, opacity: 0.75 }}>
                <div className="flex items-center gap-2 text-[11px] mb-1" style={{ color: "#B08A90" }}>
                  <CheckCircle2 size={14} color="#0F8B8D" />
                  <span>{FEEDBACK_CATEGORY_LABEL[r.category] || r.category}</span>
                  <span>{dateLabel(r.created_at)}</span>
                  <span className="font-bold" style={{ color: "#6B585C" }}>{r.author}</span>
                </div>
                <div className="text-sm" style={{ color: "#8A7378", textDecoration: "line-through" }}>{r.body}</div>
                <div className="text-[11px] mt-1" style={{ color: "#0F8B8D" }}>
                  ✓ {r.done_at ? dateLabel(r.done_at) : ""} 対応済み{r.done_by ? `（${r.done_by}）` : ""}
                  {r.done_note ? `：${r.done_note}` : ""}
                </div>
                {isAdmin && (
                  <button onClick={() => reopen(r)} className="mt-1 text-[11px] underline" style={{ color: "#8A7378" }}>
                    未対応に戻す
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default function StaffView() {
  // 表示タブ: 受付一覧 / 予約状況（来院予約 booking-app の visit_bookings を同じ画面で確認できる）
  const [tab, setTab] = useState("checkins");
  const [checkins, setCheckins] = useState([]);
  const [forms, setForms] = useState([]);
  const [bookings, setBookings] = useState([]);
  // 予約に紐付く事前記入問診票（提出日が予約日と違うことがあるので booking_id で別途引く）
  const [bookingForms, setBookingForms] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selectedForm, setSelectedForm] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [printing, setPrinting] = useState(false);
  // カルテ済/会計済の行を隠すか（それぞれ独立・端末ごとに記憶）
  const [hideChartDone, setHideChartDone] = useState(() => localStorage.getItem("kiosk-staff-hide-chart") === "1");
  const [hidePaymentDone, setHidePaymentDone] = useState(() => localStorage.getItem("kiosk-staff-hide-paid") === "1");
  // 表示する日付。既定は今日で、過去の日付を選ぶと同じ画面のままその日のデータを表示
  const [dateKey, setDateKey] = useState(todayKey);
  const isToday = dateKey === todayKey();
  const printAreaRef = useRef(null);
  // スマホを持っていない・使えない患者さんの代理受付
  const [proxy, setProxy] = useState(null); // null=閉 / 開いているときは入力中の内容
  const [proxyBusy, setProxyBusy] = useState(false);
  const [proxyError, setProxyError] = useState("");
  // 取り消し中の受付ID（連打よけ）
  const [cancelling, setCancelling] = useState(null);
  const [checkingIn, setCheckingIn] = useState(null);
  // 問診票のQRを見せる対象の受付行
  const [qrFor, setQrFor] = useState(null);
  // 患者を探す（過去の問診票の呼び出し）
  const [query, setQuery] = useState({ name: "", dob: "", chart: "" });
  const [results, setResults] = useState(null); // null=まだ検索していない（問診票）
  const [searchCheckins, setSearchCheckins] = useState([]); // 同じ検索で見つかった受付
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  // 2回目以降の方のカルテ番号の自動表示: "氏名|生年月日" → 過去の記録に入っていた番号
  const [pastCharts, setPastCharts] = useState(new Map());
  // 要望タブ: 未対応の件数バッジと、チェック時に記録する自分の名前
  const [feedbackOpen, setFeedbackOpen] = useState(0);
  const [myName, setMyName] = useState("");
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data?.user?.id;
      if (!uid) return;
      supabase.from("staff_profiles").select("name, role").eq("id", uid).single()
        .then(({ data: p }) => { if (p) setMyName(p.name || ""); });
    });
    const f = () =>
      supabase.from("staff_feedback").select("id").eq("status", "open")
        .then(({ data }) => setFeedbackOpen((data || []).length));
    f();
    const t = setInterval(f, 60000);
    return () => clearInterval(t);
  }, []);
  // pillorderタブの通知タグ: 今日のオンライン診察に「当日予約」（reserve_status 5/6）が入ったら
  // 件数を出す。どのタブを見ていても気づけるよう、表示中の日付とは別に今日の分だけを見張る。
  // pillorderタブを開いた時点の予約は「見た」として端末に覚え、その後に増えた分だけを数える
  // Zoom英語（Calendly）も同じ: 今日の予約のうち、まだこの端末で見ていないものを数える。
  // Calendly は「当日予約」の区別が無いので、今日の枠に新しく現れた予約＝当日入った予約とみなす
  const SAMEDAY_SEEN_KEY = "kiosk-sameday-seen";
  const [samedayResv, setSamedayResv] = useState([]); // 今日の pillorder 当日予約（キャンセル除く）
  const [samedayCal, setSamedayCal] = useState([]);   // 今日の Calendly 予約（キャンセル除く）
  const [samedaySeen, setSamedaySeen] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem(SAMEDAY_SEEN_KEY) || "null");
      return v && v.date === todayKey() ? { pill: new Set(v.pill), cal: new Set(v.cal) } : { pill: new Set(), cal: new Set() };
    } catch { return { pill: new Set(), cal: new Set() }; }
  });
  const saveSamedaySeen = (next) => {
    setSamedaySeen(next);
    localStorage.setItem(SAMEDAY_SEEN_KEY, JSON.stringify({ date: todayKey(), pill: [...next.pill], cal: [...next.cal] }));
  };
  useEffect(() => {
    const f = () => {
      const today = todayKey();
      const from = `${today}T00:00:00+09:00`, to = `${today}T23:59:59+09:00`;
      supabase.from("pillorder_reservations").select("reserve_id, reserve_status, start_at")
        .gte("start_at", from).lte("start_at", to).in("reserve_status", [5, 6])
        .then(({ data }) => setSamedayResv(data || []));
      supabase.from("calendly_bookings").select("invitee_uri, start_at")
        .gte("start_at", from).lte("start_at", to).eq("canceled", false)
        .then(({ data }) => setSamedayCal(data || []));
    };
    // Calendly は Zoom英語タブを開いた時にしか同期されないので、見張りの側でも5分おきに同期を起こす
    const sync = () => supabase.functions.invoke("calendly-sync").then(f).catch(() => {});
    f();
    sync();
    const t = setInterval(f, 30000);
    const ts = setInterval(sync, 5 * 60000);
    return () => { clearInterval(t); clearInterval(ts); };
  }, []);
  const samedayNew = samedayResv.filter((r) => !samedaySeen.pill.has(r.reserve_id)).length;
  const samedayCalNew = samedayCal.filter((r) => !samedaySeen.cal.has(r.invitee_uri)).length;
  const pillTabRef = useRef(null); // 吹き出しの位置合わせ用（pillorderタブのボタン）
  const zoomTabRef = useRef(null); // 同じく Zoom英語タブ
  // タブを開いているあいだに入った分も含めて「見た」扱いにする
  useEffect(() => {
    if (tab === "pillorder" && samedayNew > 0) {
      saveSamedaySeen({ ...samedaySeen, pill: new Set(samedayResv.map((r) => r.reserve_id)) });
    } else if (tab === "zoom" && samedayCalNew > 0) {
      saveSamedaySeen({ ...samedaySeen, cal: new Set(samedayCal.map((r) => r.invitee_uri)) });
    }
  }, [tab, samedayResv, samedayCal]);
  // pillorderタブ: オンライン診療の問診票（monshin_online）。予約時刻(reserve_at)順の時系列で並べる
  const [monshinRows, setMonshinRows] = useState([]);
  // pillorder の予約一覧（pillorder_reservations）。問診票が無い人も出すために予約を軸にする
  const [pillorderResv, setPillorderResv] = useState([]);
  const [selectedMonshin, setSelectedMonshin] = useState(null);
  const [monshinPrinting, setMonshinPrinting] = useState(false);
  const monshinPrintRef = useRef(null); // 個別印刷用の隠しA4
  const monshinBatchRef = useRef(null); // 一括印刷用（複数ページ）
  // zoomタブ: 英語LP（klcs.jp/en/intake.html）のZoom診療の問診票（monshin_online の source='zoom'）
  const [zoomRows, setZoomRows] = useState([]);
  const [zoomAll, setZoomAll] = useState([]); // 日付に関係なく直近のZoom問診票（予約との突合用）
  const [calBookings, setCalBookings] = useState([]); // Calendly の予約一覧（calendly_bookings、タブを開くたびに同期）
  const [calFuture, setCalFuture] = useState([]);     // 今日以降の有効な Calendly 予約（重複予約の検知用）
  const [progressRows, setProgressRows] = useState([]); // 問診票の記入中の進捗（monshin_progress、直近2日）
  const zoomBatchRef = useRef(null); // Zoom分の一括印刷用
  const intakeBatchRef = useRef(null); // 来院受付の問診票 一括印刷用（オンラインと合わせて出す）
  // 1日の予定表（来院＋オンラインを時刻順に1枚へ）
  const scheduleRef = useRef(null);
  const [schedulePrinting, setSchedulePrinting] = useState(false);
  // 予約の編集・代理予約（booking-app から移植）に必要な設定・メニュー・祝日
  const [menusAll, setMenusAll] = useState([]);
  const [visitSettings, setVisitSettings] = useState(null);
  const [visitHolidays, setVisitHolidays] = useState(new Set());
  // 予定表の空き枠を出すために、休診日と「閉じた枠」も要る
  const [visitClosedDates, setVisitClosedDates] = useState(new Set());
  const [closedSlotTimes, setClosedSlotTimes] = useState(new Set());
  const [editingBooking, setEditingBooking] = useState(null); // null | "new" | 予約行
  const [notice, setNotice] = useState(""); // 予約の保存など、成功メッセージの一時表示
  const showNotice = (m) => { setNotice(m); setTimeout(() => setNotice(""), 2600); };

  const toggleHideChartDone = () => {
    setHideChartDone((v) => {
      localStorage.setItem("kiosk-staff-hide-chart", v ? "0" : "1");
      return !v;
    });
  };
  const toggleHidePaymentDone = () => {
    setHidePaymentDone((v) => {
      localStorage.setItem("kiosk-staff-hide-paid", v ? "0" : "1");
      return !v;
    });
  };

  const handlePrint = async () => {
    if (!printAreaRef.current || printing) return;
    // PDFを作ってからでは新しいタブがポップアップとして塞がれるので、
    // 押した瞬間に空のタブだけ先に開いておく（iPadのみ）
    const iosWindow = IS_IOS ? window.open("", "_blank") : null;
    setPrinting(true);
    try {
      await printElementAsPdf(
        printAreaRef.current,
        iosWindow,
        `問診票_${selectedForm?.patient_name || ""}_${selectedForm?.date_key || ""}.pdf`,
      );
    } catch (e) {
      // 空けたタブを残すと白いまま置き去りになる
      if (iosWindow && !iosWindow.closed) iosWindow.close();
      setLoadError(`問診票のPDFを作れませんでした: ${e.message}`);
    } finally {
      setPrinting(false);
    }
  };

  // オンライン診療の問診票を印刷済みに記録（ベストエフォート）
  const markMonshinPrinted = (id) => {
    supabase.rpc("mark_monshin_printed", { p_id: id }).then(({ error }) => error && console.warn("mark_monshin_printed failed:", error));
  };

  // 個別印刷（開いている1件）
  const printSelectedMonshin = async () => {
    if (!monshinPrintRef.current || monshinPrinting) return;
    const iosWindow = IS_IOS ? window.open("", "_blank") : null;
    setMonshinPrinting(true);
    try {
      await printElementAsPdf(monshinPrintRef.current, iosWindow, `問診票_${selectedMonshin?.name || ""}.pdf`);
      if (selectedMonshin) markMonshinPrinted(selectedMonshin.id);
    } catch (e) {
      if (iosWindow && !iosWindow.closed) iosWindow.close();
      setLoadError(`問診票のPDFを作れませんでした: ${e.message}`);
    } finally {
      setMonshinPrinting(false);
    }
  };

  // Zoom英語問診票の一括印刷（1人1枚A4・複数ページ）。
  // キャンセル済（Calendly予約が取り消され、取り直しも無い人）は紙にしない
  const zoomPrintRows = zoomRows.filter((m) => !m.reserve_canceled);

  // Zoom英語タブの一覧。Calendly の予約（calendly_bookings）を軸に問診票を突き合わせる。
  // 突合はメール → 無ければ氏名（Hide My Email 等でメールが一致しない人の予備）。
  // 問診票は日付に関係なく直近分（zoomAll）から探す（予約日時を書かずに送った人も拾う）
  const zoomList = useMemo(() => {
    const used = new Set();
    const nameKey = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
    const findMonshin = (b) => {
      const em = String(b.email || "").toLowerCase();
      const byEmail = em && zoomAll.find((m) => !used.has(m.id) && String(m.email || "").toLowerCase() === em);
      if (byEmail) return byEmail;
      const nk = nameKey(b.name);
      return (nk && zoomAll.find((m) => !used.has(m.id) && nameKey(m.name) === nk)) || null;
    };
    // 記入中の進捗（まだ送信されていない分）。メール → 氏名で、いちばん新しい1件
    const findProgress = (b) => {
      const em = String(b.email || "").toLowerCase();
      const nk = nameKey(b.name);
      return progressRows.find((p) => p.source === "zoom" && (
        (em && String(p.email || "").toLowerCase() === em) || (nk && nameKey(p.name) === nk)
      )) || null;
    };
    // 同じ人（メール一致 → 無ければ氏名一致）の、今日以降の他の有効な予約。
    // Calendly には「同じ人は1回まで」の設定が無いので、ここで気づけるようにする
    const samePerson = (a, b) => {
      const ea = String(a.email || "").toLowerCase(), eb = String(b.email || "").toLowerCase();
      if (ea && eb) return ea === eb;
      const na = nameKey(a.name), nb = nameKey(b.name);
      return !!na && na === nb;
    };
    const otherBookings = (b) => b.canceled ? [] : calFuture
      .filter((o) => o.invitee_uri !== b.invitee_uri && samePerson(o, b))
      .map((o) => o.start_at)
      .sort();
    const rows = calBookings.map((b) => {
      const m = findMonshin(b);
      if (m) used.add(m.id);
      return {
        key: `c:${b.invitee_uri}`, at: b.start_at, time: hhmm(b.start_at),
        name: b.name || "", email: b.email || "", dob: m?.dob || "", phone: m?.phone || "",
        canceled: !!b.canceled, monshin: m, noReserveTime: false,
        progress: m ? null : findProgress(b),
        duplicates: otherBookings(b),
        // 催促メール（staff@klcs.jp から自動送信）の対象キーと送信記録
        inviteeUri: b.invitee_uri, reminderSentAt: b.reminder_sent_at || null, reminderSentBy: b.reminder_sent_by || "",
        reminderError: b.reminder_error || "",
        reminders: [
          b.reminder_morning9_at && "朝9時",
          b.reminder_before1h_at && "1時間前",
          b.reminder_sent_at && `手動 ${hhmm(b.reminder_sent_at)}${b.reminder_sent_by ? `・${b.reminder_sent_by}` : ""}`,
        ].filter(Boolean),
      };
    });
    zoomRows.forEach((m) => {
      if (used.has(m.id)) return;
      rows.push({
        key: `m:${m.id}`, at: m.reserve_at || m.created_at,
        time: m.reserve_at ? hhmm(m.reserve_at) : hhmm(m.created_at),
        name: m.name || "", email: m.email || "", dob: m.dob || "", phone: m.phone || "",
        canceled: !!m.reserve_canceled, monshin: m, noReserveTime: !m.reserve_at,
      });
    });
    return rows.sort((a, b) => new Date(a.at) - new Date(b.at));
  }, [calBookings, calFuture, zoomAll, zoomRows, progressRows]);
  const zoomActive = zoomList.filter((r) => !r.canceled);
  const zoomUnfilled = zoomActive.filter((r) => !r.monshin);
  const printZoomBatch = async () => {
    if (!zoomBatchRef.current || monshinPrinting || zoomPrintRows.length === 0) return;
    const iosWindow = IS_IOS ? window.open("", "_blank") : null;
    setMonshinPrinting(true);
    try {
      const els = [...zoomBatchRef.current.querySelectorAll(".monshin-batch-sheet")];
      await printElementsAsPdf(els, iosWindow, `Zoom診療_問診票_${dateKey}.pdf`);
      zoomPrintRows.forEach((m) => markMonshinPrinted(m.id));
    } catch (e) {
      if (iosWindow && !iosWindow.closed) iosWindow.close();
      setLoadError(`一括印刷のPDFを作れませんでした: ${e.message}`);
    } finally {
      setMonshinPrinting(false);
    }
  };

  // 当日分を一括印刷（1人1枚A4・複数ページ）
  // キャンセル済（pillorder予約が取り消され、取り直しも無い人）は紙にしない
  // pillorderタブの一覧。pillorder の予約（pillorder_reservations）を軸に問診票を突き合わせる。
  //   ・予約に問診票が来ていれば「表示・印刷」、無ければ「未記入」
  //   ・予約側に無い問診票（古いリンク経由など）もそのまま並べる
  // 突合は問診票の token 先頭（pillorder の user_id）→ 無ければ生年月日＋電話
  const pillorderList = useMemo(() => {
    const used = new Set();
    const findMonshin = (r) => monshinRows.find((m) => {
      if (used.has(m.id)) return false;
      const uid = m.token ? String(m.token).split(".")[0] : "";
      if (uid && String(r.user_id) === uid) return true;
      return !!(r.dob && r.phone && m.dob === r.dob && m.phone === r.phone);
    });
    // 記入中の進捗（まだ送信されていない分）。同じ突合キーで、いちばん新しい1件
    const findProgress = (r) => progressRows.find((p) => {
      if (p.source !== "pillorder") return false;
      const uid = p.token ? String(p.token).split(".")[0] : "";
      if (uid && String(r.user_id) === uid) return true;
      return !!(r.dob && r.phone && p.dob === r.dob && p.phone === r.phone);
    }) || null;
    const rows = pillorderResv.map((r) => {
      const m = findMonshin(r);
      if (m) used.add(m.id);
      return {
        key: `r:${r.reserve_id}`, at: r.start_at, time: hhmm(r.start_at),
        name: r.name || "", kana: r.kana || "", dob: r.dob || "", phone: r.phone || "",
        email: r.email || "",
        chart: r.chart || "", status: r.reserve_status, canceled: r.reserve_status === 4,
        monshin: m || null, answered: !!r.answered, noReserveTime: false,
        progress: m ? null : findProgress(r),
        reminders: [
          r.reminder_morning9_at && "朝9時",
          r.reminder_before1h_at && "1時間前",
          r.reminder_today10min_at && "当日",
          r.reminder_manual_sent_at && `手動 ${hhmm(r.reminder_manual_sent_at)}`,
        ].filter(Boolean),
        // 「催促メールを送る」ボタンの状態（依頼→batchが3分以内に送信→送信済）
        reserveId: r.reserve_id,
        manual: {
          requested: !!r.reminder_manual_requested_at && !r.reminder_manual_sent_at && !r.reminder_manual_error,
          error: r.reminder_manual_error || "",
        },
      };
    });
    monshinRows.forEach((m) => {
      if (used.has(m.id)) return;
      rows.push({
        key: `m:${m.id}`, at: m.reserve_at || m.created_at,
        time: m.reserve_at ? hhmm(m.reserve_at) : hhmm(m.created_at),
        name: m.name || "", kana: m.kana || "", dob: m.dob || "", phone: m.phone || "",
        chart: m.chart_number || "", status: null, canceled: !!m.reserve_canceled,
        monshin: m, answered: true, noReserveTime: !m.reserve_at,
      });
    });
    return rows.sort((a, b) => new Date(a.at) - new Date(b.at));
  }, [pillorderResv, monshinRows, progressRows]);
  const pillorderActive = pillorderList.filter((r) => !r.canceled);
  const pillorderUnfilled = pillorderActive.filter((r) => !r.monshin && !r.answered);
  // 一括印刷するオンライン問診票。一覧と同じ判定（pillorder の予約キャンセル＝紙にしない）で、
  // 一覧と同じ予約時刻順に並べる。以前は問診票側の reserve_canceled（Zoom用の印）しか
  // 見ていなかったので、pillorder でキャンセルした人の分も印刷されていた
  const monshinPrintRows = pillorderActive.filter((r) => r.monshin).map((r) => r.monshin);

  // 「催促メールを送る」（pillorder）: 依頼を立てるだけ。送信は batch が3分以内に行い、
  // 結果（送信済／失敗）は一覧の自動更新で戻ってくる。押した直後は画面側で依頼中にする
  const requestReminder = async (reserveId) => {
    setPillorderResv((rows) => rows.map((r) =>
      r.reserve_id === reserveId
        ? { ...r, reminder_manual_requested_at: new Date().toISOString(), reminder_manual_sent_at: null, reminder_manual_error: null }
        : r
    ));
    const { error } = await supabase.rpc("request_pillorder_reminder", { p_reserve_id: reserveId });
    if (error) setLoadError(`催促メールの依頼を登録できませんでした: ${error.message}`);
  };

  // Zoom英語: 催促メールは Edge Function zoom-reminder が staff@klcs.jp から送る
  // （文面は関数側。送信結果は calendly_bookings.reminder_sent_at に残る）
  const [zoomReminding, setZoomReminding] = useState(null); // 送信中の invitee_uri
  const sendZoomReminder = async (row) => {
    if (!row.inviteeUri || zoomReminding) return;
    setZoomReminding(row.inviteeUri);
    try {
      const { data, error } = await supabase.functions.invoke("zoom-reminder", { body: { invitee_uri: row.inviteeUri } });
      // invoke は HTTP エラー時 error に入る。関数が返した理由（JSON）を読めれば出す
      if (error) {
        let detail = error.message || "";
        try { const j = await error.context?.json?.(); if (j?.error) detail = j.error; } catch { /* ignore */ }
        throw new Error(detail);
      }
      if (data?.error) throw new Error(data.error);
      setNotice(`催促メールを送りました（${row.email}）`);
      load();
    } catch (e) {
      setLoadError(`催促メールを送れませんでした: ${e.message}`);
    } finally {
      setZoomReminding(null);
    }
  };

  // 問診票の受診理由から、飲み方ガイドの絞り込みキーを推定する。
  // 受診理由の qid は /monshin が "reason"、Zoom英語（klcs.jp/en）が "reason_for_visit"。
  // pillorder（オンライン診療）はピル処方が前提なので低用量ピルコース（oc）を常に含める
  const guideKeysFromMonshin = (m) => {
    const row = (m?.answers || []).find((a) => a?.qid === "reason" || a?.qid === "reason_for_visit");
    const txt = `${row?.a_ja || ""} ${row?.a_en || ""}`;
    const keys = [];
    const add = (k) => { if (!keys.includes(k)) keys.push(k); };
    if (m?.source !== "zoom") add("oc");
    if (/Birth control pills|低用量ピル/.test(txt)) add("oc");
    if (/Mini-pill|ミニピル/.test(txt)) add("mini");
    if (/Morning-after|アフターピル|緊急避妊/.test(txt)) add("ec");
    if (/Menstrual pain|生理痛/.test(txt)) add("pain");
    if (/Irregular period|生理不順/.test(txt)) add("irregular");
    if (/Period shifting|Moving my period|生理をずらしたい|月経移動/.test(txt)) add("shift");
    if (/Acne|肌荒れ|ニキビ/.test(txt)) add("acne");
    if (/PMS|生理前後/.test(txt)) add("pms");
    return keys;
  };

  // 問診票の内容に合ったガイドを患者へメールで送る（Edge Function guide-mail、
  // スタッフのログインが必須・宛先はDBの行のemailだけ）。送信の記録は
  // monshin_online / intake_forms それぞれの guide_mail_sent_at に残り、
  // 「再送」表示に変わる。id はどちらの行かを Edge Function 側がUUID/f-...の
  // 形から自動判定するので、呼び出し側は id・keys・lang・表示用emailを渡すだけでよい
  const [guideMailing, setGuideMailing] = useState(null); // 送信中の行ID（monshin uuid or intake_forms id）
  const sendGuideMail = async (id, email, keys, lang) => {
    if (!id || guideMailing) return;
    if (!keys.length) {
      setLoadError("ピル系の受診理由が無いので、この問診票にはガイドの対象がありません");
      return;
    }
    if (!window.confirm(`飲み方ガイドのリンクを ${email} へメールで送ります。よろしいですか？`)) return;
    setGuideMailing(id);
    try {
      const { data, error } = await supabase.functions.invoke("guide-mail", {
        body: { id, keys, lang },
      });
      if (error) {
        let detail = error.message || "";
        try { const j = await error.context?.json?.(); if (j?.error) detail = j.error; } catch { /* ignore */ }
        throw new Error(detail);
      }
      if (data?.error) throw new Error(data.error);
      setNotice(`ガイドをメールで送りました（${data?.email || email}）`);
      load();
    } catch (e) {
      setLoadError(`ガイドのメールを送れませんでした: ${e.message}`);
    } finally {
      setGuideMailing(null);
    }
  };
  const printMonshinBatch = async () => {
    if (!monshinBatchRef.current || monshinPrinting || monshinPrintRows.length === 0) return;
    const iosWindow = IS_IOS ? window.open("", "_blank") : null;
    setMonshinPrinting(true);
    try {
      const els = [...monshinBatchRef.current.querySelectorAll(".monshin-batch-sheet")];
      await printElementsAsPdf(els, iosWindow, `オンライン診療_問診票_${dateKey}.pdf`);
      monshinPrintRows.forEach((m) => markMonshinPrinted(m.id));
    } catch (e) {
      if (iosWindow && !iosWindow.closed) iosWindow.close();
      setLoadError(`一括印刷のPDFを作れませんでした: ${e.message}`);
    } finally {
      setMonshinPrinting(false);
    }
  };

  // この日の問診票をまとめて印刷: オンライン診療（monshin_online）＋来院受付（intake_forms）。
  // 隠しレイアウトの .monshin-batch-sheet と .intake-batch-sheet を順に1枚ずつ画像化してA4に載せる。
  const printAllQuestionnaires = async () => {
    if (monshinPrinting) return;
    const monshinEls = monshinBatchRef.current ? [...monshinBatchRef.current.querySelectorAll(".monshin-batch-sheet")] : [];
    const intakeEls = intakeBatchRef.current ? [...intakeBatchRef.current.querySelectorAll(".intake-batch-sheet")] : [];
    const els = [...monshinEls, ...intakeEls];
    if (els.length === 0) return;
    const iosWindow = IS_IOS ? window.open("", "_blank") : null;
    setMonshinPrinting(true);
    try {
      await printElementsAsPdf(els, iosWindow, `問診票_${dateKey}.pdf`);
      monshinPrintRows.forEach((m) => markMonshinPrinted(m.id));
    } catch (e) {
      if (iosWindow && !iosWindow.closed) iosWindow.close();
      setLoadError(`一括印刷のPDFを作れませんでした: ${e.message}`);
    } finally {
      setMonshinPrinting(false);
    }
  };

  // 1日の予定表を印刷（A4・時刻順。多い日は複数ページ）
  const printSchedule = async () => {
    if (!scheduleRef.current || schedulePrinting) return;
    const els = [...scheduleRef.current.querySelectorAll(".schedule-sheet")];
    if (els.length === 0) return;
    const iosWindow = IS_IOS ? window.open("", "_blank") : null;
    setSchedulePrinting(true);
    try {
      await printElementsAsPdf(els, iosWindow, `予定表_${dateKey}.pdf`);
    } catch (e) {
      if (iosWindow && !iosWindow.closed) iosWindow.close();
      setLoadError(`予定表のPDFを作れませんでした: ${e.message}`);
    } finally {
      setSchedulePrinting(false);
    }
  };

  const load = async () => {
    const [cRes, fRes, bRes] = await Promise.all([
      supabase.from("reception_checkins").select("*").eq("date_key", dateKey).order("checkin_number", { ascending: true }),
      supabase.from("intake_forms").select("*").eq("date_key", dateKey).order("created_at", { ascending: false }),
      supabase.from("visit_bookings").select("*, visit_menus(name, kind)").eq("date", dateKey).order("time"),
    ]);
    if (cRes.error || fRes.error || bRes.error) {
      setLoadError((cRes.error || fRes.error || bRes.error).message);
      return;
    }
    // 予約に紐付く事前記入の問診票は提出日が別日のことがあるので booking_id で引く
    let bForms = [];
    const bookingIds = (bRes.data || []).map((b) => b.id);
    if (bookingIds.length) {
      const bfRes = await supabase.from("intake_forms").select("*").in("booking_id", bookingIds);
      if (!bfRes.error) bForms = bfRes.data || [];
    }
    setLoadError("");
    setCheckins(cRes.data || []);
    setForms(fRes.data || []);
    setBookings(bRes.data || []);
    setBookingForms(bForms);
    setLastUpdated(new Date());

    // 予定表で「×（受付なし）」を出すために、この日の閉じた枠を引く。
    // 休診日も一緒に読み直す（設定タブや別の端末での変更を10秒以内に拾う）
    supabase.from("visit_closed_slots").select("time").eq("date", dateKey)
      .then(({ data, error }) => setClosedSlotTimes(error ? new Set() : new Set((data || []).map((r) => r.time))));
    supabase.from("visit_closed_dates").select("date")
      .then(({ data, error }) => { if (!error) setVisitClosedDates(new Set((data || []).map((r) => r.date))); });

    // pillorderタブ: オンライン診療の問診票（monshin_online）。直近300件を取り、選択日
    // （reserve_at が無ければ created_at）が dateKey の分だけを予約時刻順（時系列）に並べる。
    // 個人情報＋医療回答なので RLS(is_staff) で守られており、スタッフのみ読める。
    const { data: mData, error: mErr } = await supabase
      .from("monshin_online")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    if (mErr) {
      setMonshinRows([]);
      setZoomRows([]);
    } else {
      const eff = (r) => r.reserve_at || r.created_at;
      const jstDate = (iso) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
      // 同じ monshin_online に source 列で2種類が入っている:
      //   pillorder（既定・列が無い旧行も含む）… オンライン診療タブ
      //   zoom … 英語LP（klcs.jp/en/intake.html）のZoom診療タブ
      const dayRows = (src) => {
        // pillorder は予約をキャンセルしても問診票を消さない。取り直すと書き直しになるので、
        // 同じ日に同じ方（生年月日＋電話）の問診票が2通並ぶ。新しいほうだけを生かす。
        // 絞るのは同じ日の中だけ — 別の日の予約は取り直しなのか2件目なのか区別が
        // つかず、日をまたいで消すと生きている予約が予定表から落ちる
        const latest = new Map();
        for (const r of (mData || []).filter((r) => ((r.source || "pillorder") === src) && jstDate(eff(r)) === dateKey)) {
          const k = `${r.dob}|${r.phone}`;
          const prev = latest.get(k);
          if (!prev || new Date(r.created_at) > new Date(prev.created_at)) latest.set(k, r);
        }
        return [...latest.values()].sort((a, b) => new Date(eff(a)) - new Date(eff(b)));
      };
      setMonshinRows(dayRows("pillorder"));
      setZoomRows(dayRows("zoom"));
      setZoomAll((mData || []).filter((r) => r.source === "zoom"));
    }

    // pillorder の予約一覧（batch が5分おきに pillorder_reservations へ同期）。
    // pillorderタブはこれを軸に問診票を突き合わせ、「未記入」の人も並べる
    const { data: rData, error: rErr } = await supabase
      .from("pillorder_reservations")
      .select("*")
      .gte("start_at", `${dateKey}T00:00:00+09:00`)
      .lte("start_at", `${dateKey}T23:59:59+09:00`)
      .order("start_at", { ascending: true });
    setPillorderResv(rErr ? [] : (rData || []));

    // Calendly の予約一覧（Zoom英語タブを開くたびに calendly-sync が calendly_bookings へ同期）
    const { data: cData, error: cErr } = await supabase
      .from("calendly_bookings")
      .select("*")
      .gte("start_at", `${dateKey}T00:00:00+09:00`)
      .lte("start_at", `${dateKey}T23:59:59+09:00`)
      .order("start_at", { ascending: true });
    setCalBookings(cErr ? [] : (cData || []));
    // 重複予約の検知用: 今日以降の有効な Calendly 予約すべて（同じ人が複数回取っていないか）
    const { data: cfData } = await supabase
      .from("calendly_bookings")
      .select("invitee_uri, name, email, start_at")
      .gte("start_at", `${todayKey()}T00:00:00+09:00`)
      .eq("canceled", false);
    setCalFuture(cfData || []);

    // 問診票の記入中の進捗（画面側が1秒まとめで送ってくる）。未送信の分だけ、直近2日
    const { data: pData, error: pErr } = await supabase
      .from("monshin_progress")
      .select("*")
      .is("submitted_at", null)
      .gte("updated_at", new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString())
      .order("updated_at", { ascending: false })
      .limit(300);
    setProgressRows(pErr ? [] : (pData || []));

    // 2回目以降の来院・予約では、過去の受付・問診票に入れたカルテ番号を自動で
    // 引いて見せる（電子カルテと繋がっていないぶん、前回の入力を再利用する）。
    // 生年月日で候補を引き、氏名も一致した記録の番号だけを出す
    const dobs = [...new Set([
      ...(cRes.data || []).map((c) => c.date_of_birth),
      ...(bRes.data || []).map((b) => b.birthdate),
    ].filter(Boolean))];
    if (!dobs.length) {
      setPastCharts(new Map());
      return;
    }
    const [pf, pc] = await Promise.all([
      supabase.from("intake_forms").select("patient_name, date_of_birth, chart_number, created_at")
        .in("date_of_birth", dobs).not("chart_number", "is", null),
      supabase.from("reception_checkins").select("patient_name, date_of_birth, chart_number, created_at")
        .in("date_of_birth", dobs).not("chart_number", "is", null),
    ]);
    // ここで引けなくても一覧は出す（この表示はあくまで補助）
    const map = new Map();
    [...(pf.data || []), ...(pc.data || [])]
      .sort((a, b) => ((a.created_at || "") < (b.created_at || "") ? -1 : 1))
      .forEach((r) => {
        const key = chartMatchKey(r.patient_name, r.date_of_birth);
        if (key) map.set(key, r.chart_number); // 新しい記録の番号が残る
      });
    setPastCharts(map);
  };

  useEffect(() => {
    load();
    // 自動更新は増える可能性のある日だけ: 受付タブは今日、予約タブは今日以降。
    // 患者を探すタブは日付と関係ないので更新しない（入力中に画面が動くのを防ぐ）
    const canGrow = tab === "search" || tab === "settings" || tab === "feedback" ? false : (tab === "bookings" || tab === "pillorder" || tab === "zoom") ? dateKey >= todayKey() : isToday;
    if (!canGrow) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [dateKey, tab]);

  // Zoom英語タブを開いたら、Calendly の予約日時を問診票へ同期（Edge Function）。
  // 患者が問診票の日時欄を空で送っても、Calendly に予約があればメールアドレスで
  // 突合して予約日の欄に並ぶ。同期に失敗しても一覧表示は通常どおり出す
  useEffect(() => {
    if (tab !== "zoom") return;
    // 同期後は予約一覧（calendly_bookings）も新しくなっているので読み直す
    supabase.functions.invoke("calendly-sync")
      .then(() => load())
      .catch(() => {});
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // 予約の編集・代理予約に使う設定・メニュー・祝日。設定タブで休診日や診療時間を
  // 変えたあと、開きっぱなしの予約一覧・予定表にも反映されるよう、タブを
  // 切り替えるたびに読み直す（以前は開いたときの一度きりで、再読み込みするまで
  // 休診設定が反映されなかった）
  const loadBookingConfig = () => {
    supabase.from("visit_menus").select("*").order("sort_order")
      .then(({ data, error }) => { if (!error) setMenusAll(data || []); });
    supabase.from("visit_settings").select("*").eq("id", "default").single()
      .then(({ data, error }) => { if (!error && data) setVisitSettings(settingsFromRow(data)); });
    supabase.from("visit_holiday_dates").select("date")
      .then(({ data, error }) => { if (!error) setVisitHolidays(new Set((data || []).map((r) => r.date))); });
    supabase.from("visit_closed_dates").select("date")
      .then(({ data, error }) => { if (!error) setVisitClosedDates(new Set((data || []).map((r) => r.date))); });
  };
  useEffect(loadBookingConfig, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // 予約の状態を変える（来院済み / キャンセル / 予約中に戻す）。
  const updateBookingStatus = async (id, status) => {
    const patch = status === "cancelled" ? { status, cancelled_at: new Date().toISOString() } : { status };
    const { error } = await supabase.from("visit_bookings").update(patch).eq("id", id);
    if (error) { setLoadError(`予約の更新に失敗しました: ${error.message}`); return; }
    setLoadError("");
    load();
  };

  // 受付行に対応する問診票を探す。QR経由の送信は受付IDで確実に紐付き、
  // IDがない（QRを使わず直接開いた等）場合だけ名前（空白除去の部分一致）で照合する。
  const formFor = (checkin) => {
    const byId = forms.find((f) => f.checkin_id && f.checkin_id === checkin.id);
    if (byId) return byId;
    const n = normalizeName(checkin.patient_name);
    if (!n) return null;
    return (
      forms.find((f) => {
        const fn = normalizeName(f.patient_name);
        return fn === n || fn.includes(n) || n.includes(fn);
      }) || null
    );
  };

  // カルテ済/会計済のどちらかを反転。両方済んだら旧statusも'done'にしておく
  // （旧データ・他画面との互換のため）。
  const toggleFlag = async (row, field) => {
    const next = !row[field];
    const merged = { ...row, [field]: next };
    const status = merged.chart_done && merged.payment_done ? "done" : "waiting";
    // 先に画面へ反映して「押した感」をすぐ返す（10秒ごとの自動更新と押下が
    // 重なっても操作が消えないように）。DB更新に失敗したら元に戻してエラーを出す
    setCheckins((prev) => prev.map((c) => (c.id === row.id ? { ...c, [field]: next, status } : c)));
    const { error } = await supabase.from("reception_checkins").update({ [field]: next, status }).eq("id", row.id);
    if (error) {
      setCheckins((prev) => prev.map((c) => (c.id === row.id ? { ...c, [field]: row[field], status: row.status } : c)));
      setLoadError(`状態の更新に失敗しました: ${error.message} ／ ページを再読み込みしてスタッフアカウントでログインし直すと直ることがあります。`);
    } else {
      setLoadError("");
    }
  };

  // 受付の取り消し。押し間違い・別人の受付・動作確認の後始末に使う。
  // 予約は「予約中」に戻り、事前記入の問診票は残したまま紐付けだけ外れる。
  const cancelCheckin = async (row) => {
    const label = `${row.checkin_number}番 ${row.patient_name} さんの受付を取り消します。よろしいですか？`;
    if (!window.confirm(label)) return;
    setCancelling(row.id);
    const { error } = await supabase.rpc("staff_cancel_checkin", { p_id: row.id });
    setCancelling(null);
    if (error) {
      setLoadError(`受付の取り消しに失敗しました: ${error.message}`);
      return;
    }
    setLoadError("");
    setCheckins((prev) => prev.filter((c) => c.id !== row.id));
  };

  // 院内カルテ番号を書き込む。受付（その日の来院）と問診票の両方に同じ番号を持たせる。
  // 受付は日ごとに流れていくが問診票は残るので、問診票側にも入れておかないと
  // 何年か後に呼び出したときに番号が分からなくなる
  // まとめて何件でも受け付ける。1人の方の問診票が何枚もあるとき、番号を1回入れれば
  // 全部に同じ番号が入る（それが「この人はこのカルテの方」と決める作業そのもの）
  const saveChartNumber = async ({ checkinIds = [], formIds = [], value }) => {
    const v = value.trim() || null;
    const cIds = checkinIds.filter(Boolean);
    const fIds = formIds.filter(Boolean);
    const jobs = [];
    if (cIds.length) jobs.push(supabase.from("reception_checkins").update({ chart_number: v }).in("id", cIds));
    if (fIds.length) jobs.push(supabase.from("intake_forms").update({ chart_number: v }).in("id", fIds));
    if (!jobs.length) return false;
    const res = await Promise.all(jobs);
    const failed = res.find((r) => r.error);
    if (failed) {
      setLoadError(`カルテ番号を保存できませんでした: ${failed.error.message}`);
      return false;
    }
    setLoadError("");
    // 開いている一覧すべてに反映する（どこから入れても同じ番号が見えるように）
    const cSet = new Set(cIds);
    const fSet = new Set(fIds);
    if (cIds.length) setCheckins((prev) => prev.map((c) => (cSet.has(c.id) ? { ...c, chart_number: v } : c)));
    if (fIds.length) {
      const patch = (list) => list.map((f) => (fSet.has(f.id) ? { ...f, chart_number: v } : f));
      setForms(patch);
      setBookingForms(patch);
      setResults((prev) => (prev ? patch(prev) : prev));
      setSelectedForm((prev) => (prev && fSet.has(prev.id) ? { ...prev, chart_number: v } : prev));
    }
    return true;
  };

  // 過去の問診票を呼び出す。氏名・生年月日・カルテ番号のどれからでも引ける。
  // 生年月日は前方一致なので、年だけ・年月だけでも候補を出せる。
  //
  // 見つかった方にカルテ番号が付いていたら、その番号でもう一度引き直す。
  // お名前は漢字で書く回もローマ字で書く回もあるので、名前だけで探すと同じ方の
  // 記入が別々に出てくる。番号でつながっていれば、それを1人分にまとめられる
  const runSearch = async (override) => {
    const src = override || query;
    const name = safeLike(src.name);
    const dob = dobPrefix(src.dob);
    const chart = safeLike(src.chart);
    if (!name && !dob && !chart) {
      setSearchError("お名前・生年月日・カルテ番号のどれかを入れてください。");
      return;
    }
    setSearching(true);
    setSearchError("");

    // 問診票と受付の両方を探す。
    // 番号は受付にしか付いていないことがある（薬のみの方、問診票がまだ届いていない
    // うちに入れた方、問診票を出さずに帰られた方）。問診票だけを見ていると
    // 「入れたはずなのに出てこない」になる
    let fq = supabase.from("intake_forms").select("*").order("created_at", { ascending: false }).limit(200);
    if (name) fq = fq.ilike("patient_name", `%${name}%`);
    if (dob) fq = fq.like("date_of_birth", `${dob}%`);
    if (chart) fq = fq.eq("chart_number", chart);

    let cq = supabase.from("reception_checkins").select("*").order("date_key", { ascending: false }).limit(200);
    if (name) cq = cq.ilike("patient_name", `%${name}%`);
    if (dob) cq = cq.like("date_of_birth", `${dob}%`);
    if (chart) cq = cq.eq("chart_number", chart);

    const [fRes, cRes] = await Promise.all([fq, cq]);
    if (fRes.error || cRes.error) {
      setSearching(false);
      setSearchError((fRes.error || cRes.error).message);
      setResults([]);
      setSearchCheckins([]);
      return;
    }
    let rows = fRes.data || [];
    let cRows = cRes.data || [];

    // 見つかった番号でもう一度引き直す。お名前は漢字で書く回もローマ字で書く回も
    // あるので、名前だけで探すと同じ方の記入が別々に出てくる。
    // 受付側で見つかった番号も混ぜる（そこからその方の問診票にたどり着ける）
    const numbers = [...new Set([
      ...rows.map((r) => r.chart_number),
      ...cRows.map((r) => r.chart_number),
    ].filter(Boolean))];
    const checkinIds = [...new Set(cRows.map((r) => r.id))];

    const extra = await Promise.all([
      numbers.length ? supabase.from("intake_forms").select("*").in("chart_number", numbers) : null,
      // 番号がまだ無い受付でも、そこに紐付いた問診票は同じ方のもの
      checkinIds.length ? supabase.from("intake_forms").select("*").in("checkin_id", checkinIds) : null,
      numbers.length ? supabase.from("reception_checkins").select("*").in("chart_number", numbers) : null,
    ]);
    const seenF = new Set(rows.map((r) => r.id));
    [extra[0], extra[1]].forEach((res) => {
      if (!res || res.error) return;
      (res.data || []).forEach((r) => {
        if (seenF.has(r.id)) return;
        seenF.add(r.id);
        rows.push(r);
      });
    });
    if (extra[2] && !extra[2].error) {
      const seenC = new Set(cRows.map((r) => r.id));
      (extra[2].data || []).forEach((r) => {
        if (!seenC.has(r.id)) { seenC.add(r.id); cRows.push(r); }
      });
    }

    rows.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    cRows.sort((a, b) => (a.date_key < b.date_key ? 1 : a.date_key > b.date_key ? -1 : 0));
    setSearching(false);
    setResults(rows);
    setSearchCheckins(cRows);
  };

  // 受付一覧から、その方の過去の問診票をまとめて見る
  const showHistory = (chart) => {
    const next = { name: "", dob: "", chart: String(chart) };
    setQuery(next);
    setTab("search");
    runSearch(next);
  };

  // 予約状況の行からその場で受付する。スマホを持っていない方、操作に困っている方、
  // 受付を通らず診察室まで来てしまった方のため。
  //
  // 患者さんのスマホと同じ RPC を呼ぶ。予約の照合は RPC 側が氏名と生年月日で
  // 行うので、押した行の予約に紐付き、その予約は「来院済み」に変わる。
  // 受付番号の採番も二重受付の防止もそのまま効く。
  const checkinFromBooking = async (b) => {
    if (checkingIn) return;
    if (!window.confirm(`${b.time}　${b.patient_name} さんを受付します。よろしいですか？`)) return;
    setCheckingIn(b.id);
    const { error } = await supabase.rpc("create_self_checkin", {
      // アフターピルなど日によって扱いが変わるメニューは RPC 側が決め直す
      p_visit_type: b.visit_menus?.kind === "pickup" ? "pickup" : "consult",
      p_patient_name: b.patient_name,
      p_date_of_birth: b.birthdate || null,
      // 予約時に聞いた保険の申告。RPCが受け付けない値なら空で作る（口頭で確認できる）
      p_insurance: INSURANCE_BADGE[b.insurance] ? b.insurance : null,
      p_visit_kind: b.visit_kind || null,
      p_return_reason: b.return_reason || null,
      p_medications: null,
      p_line_user_id: null,
      p_source: "staff",
      p_patient_kana: b.patient_kana || null,
    });
    setCheckingIn(null);
    if (error) {
      setLoadError(`受付できませんでした: ${error.message}`);
      return;
    }
    setLoadError("");
    load();
  };

  const emptyProxy = {
    name: "", dob: "", visitType: "consult", visitKind: "first", returnReason: "followup", insurance: "",
  };

  // 代理受付。患者さんのスマホと同じ RPC を使う（受付番号のサーバ採番・当日予約との
  // 照合・二重受付の防止がそのまま効く）。source だけ 'staff' にして区別する。
  const submitProxy = async () => {
    if (!proxy || proxyBusy) return;
    const name = proxy.name.trim();
    if (!name) return;
    setProxyBusy(true);
    setProxyError("");
    const { error } = await supabase.rpc("create_self_checkin", {
      p_visit_type: proxy.visitType,
      p_patient_name: name,
      p_date_of_birth: proxy.dob || null,
      p_insurance: proxy.insurance || null,
      p_visit_kind: proxy.visitType === "consult" ? proxy.visitKind : null,
      p_return_reason:
        proxy.visitType === "consult" && proxy.visitKind === "return" ? proxy.returnReason : null,
      p_medications: null,
      p_line_user_id: null,
      p_source: "staff",
    });
    setProxyBusy(false);
    if (error) {
      setProxyError(error.message);
      return;
    }
    setProxy(null);
    // 過去日を見ていると新しい受付が出てこないので今日に戻す
    if (!isToday) setDateKey(todayKey());
    load();
  };

  const waiting = checkins.filter((c) => !(c.chart_done && c.payment_done));
  const chartDoneCount = checkins.filter((c) => c.chart_done).length;
  const paymentDoneCount = checkins.filter((c) => c.payment_done).length;
  // 受付行からカタカナ・予約情報を引くための索引
  const bookingById = new Map(bookings.map((b) => [b.id, b]));

  const visibleCheckins = checkins.filter(
    (c) => !(hideChartDone && c.chart_done) && !(hidePaymentDone && c.payment_done)
  );

  // 受付一覧を上下2段に分ける: 上=予約に紐付いた診察（予約時間順＝呼ぶ順）、
  // 下=それ以外（予約なしの診察＋お薬のみ、受付順のまま）。
  // 「予約=診察の列」の整理なので、お薬のみは予約があっても下段。
  // 片方が空のときは見出し行を出さず、従来どおり1本の表に見える
  const bookedCheckins = visibleCheckins
    .filter((c) => c.booking_id && c.visit_type === "consult")
    .slice()
    .sort((a, b) => {
      const ta = String(bookingById.get(a.booking_id)?.time || "99:99");
      const tb = String(bookingById.get(b.booking_id)?.time || "99:99");
      if (ta !== tb) return ta < tb ? -1 : 1;
      return (a.checkin_number || 0) - (b.checkin_number || 0);
    });
  const walkinCheckins = visibleCheckins.filter((c) => !(c.booking_id && c.visit_type === "consult"));
  const checkinSections = [
    {
      key: "booked", rows: bookedCheckins, label: "ご予約の診察", note: "予約時間順",
      style: { background: "#F4F1FC", color: "#5B4BB8", borderTop: "1px solid #E4DDF7", borderBottom: "1px solid #E4DDF7" },
    },
    {
      key: "walkin", rows: walkinCheckins, label: "診察当日順番待ち・お薬のみ", note: "受付順",
      style: { background: "#FBF4F0", color: "#A9746B", borderTop: "1px solid #F2E2DA", borderBottom: "1px solid #F2E2DA" },
    },
  ].filter((s) => s.rows.length > 0);

  // この日の来院受付の問診票（intake_forms）。受付経由(forms)と予約に紐付く事前記入
  // (bookingForms)を id で重複排除。オンラインと合わせた一括印刷の対象。
  // この日の来院受付の問診票（一括印刷用）。予約のある方の分だけ。
  //   ・予約なし（飛び込み受付）の分は紙にしない（受付のときに個別に印刷する）
  //   ・キャンセルされた予約の事前記入分も紙にしない（受付まで済んでいれば残す）
  //   ・並びは予約時刻順
  //   ・日時変更（キャンセル＋取り直し）の方は、古い予約に紐づいた事前記入を
  //     氏名＋生年月日で新しい予約に引き直す（引き直さないと印刷から落ちる）
  //   ・同じ予約に問診票が2通あれば新しい1通だけ
  const bookingForForm = (f) => {
    const c = f.checkin_id ? checkins.find((x) => x.id === f.checkin_id) : null;
    const direct =
      (f.booking_id && bookings.find((x) => x.id === f.booking_id)) ||
      (c?.booking_id && bookings.find((x) => x.id === c.booking_id)) || null;
    if (direct && direct.status !== "cancelled") return direct;
    // 直接の紐付けが無い／キャンセル済なら、同じ方の有効な予約を探す
    const k = chartMatchKey(f.patient_name, f.date_of_birth);
    const alt = k ? bookings.find((b) => b.status !== "cancelled" && chartMatchKey(b.patient_name, b.birthdate) === k) : null;
    return alt || direct;
  };
  const dayIntakeForms = (() => {
    const map = new Map();
    [...forms, ...bookingForms].forEach((f) => { if (f && !map.has(f.id)) map.set(f.id, f); });
    const sortKey = (f) => {
      const b = bookingForForm(f);
      return `${String(b.time).slice(0, 5)} ${f.created_at || ""}`;
    };
    const picked = [...map.values()].filter((f) => {
      const b = bookingForForm(f);
      if (!b) return false;
      return !(b.status === "cancelled" && !f.checkin_id);
    });
    // 予約ごとに新しい1通
    const latest = new Map();
    picked.forEach((f) => {
      const b = bookingForForm(f);
      const prev = latest.get(b.id);
      if (!prev || (f.created_at || "") > (prev.created_at || "")) latest.set(b.id, f);
    });
    return [...latest.values()]
      .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
  })();

  // 来院受付の問診票に載せる「予約時間」。intake_forms → visit_bookings を辿って
  // 予約日時(HH:MM)を出す。受付(checkin)経由でも、その受付の booking_id から辿る。
  // 予約なしの飛び込み受付は空（何も出さない）。
  const reserveLabelForForm = (form) => {
    const b = bookingForForm(form);
    return b ? `${b.date} ${b.time}` : "";
  };

  // 印刷の一番上に特大で出す「初診　16:30」。紙をさばく人が区分と予約時間を
  // 一目で掴めるようにする。予約のある方だけ（飛び込み受付では出さない）
  const printHeadlineForForm = (form) => {
    const c = form.checkin_id ? checkins.find((x) => x.id === form.checkin_id) : null;
    const b = bookingForForm(form);
    if (!b) return "";
    const kind = c?.visit_kind || b.visit_kind;
    const kindLabel = kind === "first" ? "初診" : kind === "return" ? "再診" : "";
    return [kindLabel, String(b.time).slice(0, 5)].filter(Boolean).join("　");
  };

  // 1日の予定表のもとになる一覧。来院予約（visit_bookings）とオンライン診療
  // （monshin_online）を同じ形に均して時刻順に並べる。
  // キャンセルされた予約は当日の予定ではないので落とす。
  const daySchedule = useMemo(() => {
    // 予約に紐付く問診票。事前記入は booking_id で、当日記入は受付を経由して届く
    const formForBooking = (b) => {
      const direct = bookingForms.find((f) => f.booking_id === b.id);
      if (direct) return direct;
      const c = checkins.find((x) => x.booking_id === b.id);
      return c ? forms.find((f) => f.checkin_id === c.id) || null : null;
    };
    const visits = bookings
      .filter((b) => b.status !== "cancelled")
      .map((b) => {
        const menu = b.visit_menus?.name || "";
        const detail = bookingDetail(b);
        const form = formForBooking(b);
        // 72時間の制限があるので、紙の上でも先に目に入るようにする。
        // 初診の方は予約メニューを通らず問診票にだけ書いてあることがある
        const map =
          /アフターピル|モーニングアフター|緊急避妊/i.test(`${menu} ${detail}`) || !!mapFromForm(form);
        return {
          key: `b:${b.id}`,
          kind: "visit",
          // 薬の受け取りは定員に数えない（渡すだけなので枠を埋めない）
          pickup: b.visit_menus?.kind === "pickup",
          time: b.time || "",
          name: b.patient_name || "",
          kana: b.patient_kana || "",
          dob: b.birthdate || "",
          // 問診票の番号のほうが確実。無ければ過去の受付・問診票から引く
          chart: form?.chart_number || pastCharts.get(chartMatchKey(b.patient_name, b.birthdate)) || "",
          menu,
          detail: detail === "—" ? "" : detail,
          // ご本人が書いた受診理由。届いていなければ予約のメニューを出す
          reason: reasonFromIntake(form),
          insurance: INSURANCE_SHORT[b.insurance] || "",
          alert: map ? "MAP" : "",
          // ご予約のときに選んでもらった区分。初診はカルテも問診票も新しく作る
          visitKind: VISIT_KIND_BADGE[b.visit_kind]?.label || "",
        };
      });
    // オンラインは pillorder の予約一覧＋問診票（pillorderList）。問診票がまだ無い人も
    // 予約があれば載せる。キャンセル済（取り直しも無い人）は1日の予定表に載せない
    const online = pillorderList.filter((r) => !r.canceled).map((r) => {
      const m = r.monshin;
      const chart = r.chart || m?.chart_number || pastCharts.get(chartMatchKey(r.name, r.dob)) || "";
      return {
      key: r.key,
      kind: "online",
      // 予約時刻が入っていない記入は受信時刻の位置に置く（一覧と同じ扱い）
      time: r.time,
      name: r.name,
      kana: r.kana,
      dob: r.dob,
      chart,
      // 列そのものが「オンライン」なので、メニュー名は繰り返さない
      menu: "",
      detail: "",
      reason: m ? reasonFromMonshin(m) : (r.answered ? "" : "問診票 未記入"),
      insurance: "",
      alert: m && (m.answers || []).some((a) => a.flag) ? "要注意" : "",
      // pillorder は初診・再診をこちらに渡してこない。当院のカルテ番号が引けた方は
      // 受診歴があるので再診と分かるが、引けないだけでは初診とは言い切れないので空
      visitKind: chart ? "再診" : "",
      };
    });
    return [...visits, ...online].sort((a, b) =>
      a.time < b.time ? -1 : a.time > b.time ? 1 : 0
    );
  }, [bookings, pillorderList, pastCharts, bookingForms, forms, checkins]);

  const scheduleCounts = {
    visit: daySchedule.filter((r) => r.kind === "visit").length,
    online: daySchedule.filter((r) => r.kind === "online").length,
  };

  // 予定表の時間割。予約設定と同じ枠割りを縦に並べ、そこへ来院とオンラインを流し込む。
  // 枠に載らない時刻（薬の受け取りの細かい刻み、時間外の予約、休診日のオンライン）も
  // 行を足して必ず出す — 予定表から人が消えるのがいちばん困る
  const scheduleGrid = useMemo(() => {
    const closedDay = visitClosedDates.has(dateKey);
    let times = [];
    let step = 0;
    if (visitSettings && !closedDay && /^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      const [y, m, d] = dateKey.split("-").map(Number);
      times = buildSlotTimes(visitSettings, new Date(y, m - 1, d), visitHolidays.has(dateKey));
      step = visitSettings.slotMinutes || 0;
    }
    const fromSettings = times.length > 0;
    const base = times.map((t) => ({ time: t, closed: closedSlotTimes.has(t), visits: [], onlines: [] }));

    // 枠外の時刻は、その時刻だけの行を足す
    const extra = new Map();
    const rowFor = (e) => {
      let i = -1;
      for (let k = 0; k < base.length; k++) if (base[k].time <= e.time) i = k;
      if (i >= 0 && (!step || timeToMinutes(e.time) < timeToMinutes(base[i].time) + step)) return base[i];
      if (!extra.has(e.time)) extra.set(e.time, { time: e.time, closed: false, visits: [], onlines: [] });
      return extra.get(e.time);
    };
    daySchedule.forEach((e) => {
      if (!e.time) return;
      const row = rowFor(e);
      (e.kind === "online" ? row.onlines : row.visits).push(e);
    });

    const rows = [...base, ...extra.values()].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    return { rows, fromSettings, closedDay };
  }, [daySchedule, dateKey, visitSettings, visitHolidays, visitClosedDates, closedSlotTimes]);

  // ページ分け。枠の高さをそろえるので、いちばん人が多い枠が「字を小さくせずに」
  // 収まる高さを基準に1ページの枠数を決め、ページ間で枠数が偏らないように均す。
  // 高さ自体は ScheduleSheet がその枠数から出す（＝どのページもA4を使い切る）
  const scheduleLayout = useMemo(() => {
    const rows = scheduleGrid.rows;
    if (!rows.length) return { pages: [], mode: SCHEDULE_MODES[0] };
    // 枠の高さはページ内で共通なので、1枠増やすと全部の枠が低くなる。
    // 「いちばん高さが要る枠 × 枠数」が1ページに収まるかで判定する
    const fits = (pages, mode) =>
      pages.every((p) => p.length * Math.max(...p.map((r) => scheduleRowPx(r, mode))) <= SCHEDULE_BODY_PX);
    const split = (count) => {
      const per = Math.ceil(rows.length / count);
      const pages = [];
      for (let i = 0; i < rows.length; i += per) pages.push(rows.slice(i, i + per));
      return pages;
    };
    // 枚数を1枚から増やしていき、最初に収まった分け方を使う。同じ枚数なら
    // 診察内容を多く出せる組み方から試す（2行 → 1行 → 1人1行に畳む）。
    // 均等に割るので、最後のページだけ数枠しかなくて間延びする、ということが起きない
    for (let count = 1; count <= rows.length; count++) {
      const pages = split(count);
      for (const mode of SCHEDULE_MODES) if (fits(pages, mode)) return { pages, mode };
    }
    return { pages: rows.map((r) => [r]), mode: SCHEDULE_MODES[SCHEDULE_MODES.length - 1] };
  }, [scheduleGrid]);
  const schedulePages = scheduleLayout.pages;

  // 検索結果を1人ぶんにまとめる。
  // カルテ番号が付いていればそれが同一人物の印なので、氏名の書き方が回ごとに
  // 違っていても1人にまとまる。番号がまだ無い方は、氏名（空白を除く）と生年月日が
  // 同じものを同じ方とみなす — 番号を入れた時点で、以後は番号でまとまる
  const patientGroups = useMemo(() => {
    if (!results) return [];
    const map = new Map();
    const slot = (key) => {
      if (!map.has(key)) map.set(key, { forms: [], checkins: [] });
      return map.get(key);
    };
    // 受付の問診票への紐付け（受付にだけ番号があるとき、その問診票も同じ方）
    const keyByCheckinId = new Map();
    results.forEach((f) => {
      const key = f.chart_number
        ? `c:${f.chart_number}`
        : `n:${normalizeName(f.patient_name)}|${formBirthdate(f) || ""}`;
      slot(key).forms.push(f);
      if (f.checkin_id) keyByCheckinId.set(f.checkin_id, key);
    });
    searchCheckins.forEach((c) => {
      const key = c.chart_number
        ? `c:${c.chart_number}`
        : keyByCheckinId.get(c.id) || `n:${normalizeName(c.patient_name)}|${c.date_of_birth || ""}`;
      slot(key).checkins.push(c);
    });
    return [...map.entries()]
      .map(([key, { forms, checkins }]) => {
        const dob = forms.map(formBirthdate).find(Boolean) || checkins.map((c) => c.date_of_birth).find(Boolean) || "";
        const names = [...new Set([...forms, ...checkins].map((r) => r.patient_name).filter(Boolean))];
        return {
          key,
          forms,
          checkins,
          chart: forms.find((f) => f.chart_number)?.chart_number
            || checkins.find((c) => c.chart_number)?.chart_number
            || "",
          name: names[0] || "（お名前なし）",
          aliases: names,
          dob,
          age: ageFrom(dob),
          // 並べ替えに使う「いちばん新しい記録の日」
          last: forms[0]?.created_at || `${checkins[0]?.date_key || ""}T00:00:00`,
        };
      })
      .sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
  }, [results, searchCheckins]);

  return (
    <div style={{ fontFamily: "'Noto Sans JP', sans-serif" }}>
      <style>{FONT_IMPORT}</style>

      <div className="staff-screen min-h-screen" style={{ background: "#FFF8F7" }}>
        {/* 中身はタブ・本文と同じ幅（max-w-1500・同じ左右余白）に揃える。
            ヘッダーだけ画面いっぱいだと、広い画面で下の内容とズレて見える */}
        <header style={{ borderBottom: "1px solid #F2DFE4", background: "#FFFFFF" }}>
        <div className="flex items-center justify-between px-3 sm:px-6 py-4 flex-wrap gap-3 max-w-[1500px] mx-auto w-full">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#0F8B8D" }}>
              <ClipboardList size={20} color="#DFF5F3" />
            </div>
            <div>
              <div className="text-base font-bold" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
                受付一覧（スタッフ用）
              </div>
              <div className="text-xs" style={{ color: "#B08A90" }}>
                {tab === "settings"
                  ? "メニュー・診療時間・休診日の設定"
                  : tab === "search"
                  ? "過去の問診票を呼び出す"
                  : tab === "feedback"
                  ? "かねこさんへの要望・報告と対応状況"
                  : tab === "pillorder"
                    ? `${isToday ? "本日" : dateKey} のオンライン診療 ${pillorderActive.length}件　`
                    : tab === "zoom"
                    ? `${isToday ? "本日" : dateKey} のZoom診療（英語） ${zoomActive.length}件　`
                    : tab === "bookings"
                      ? `${dateKey} の予約 ${bookings.filter((b) => b.status !== "cancelled").length}件　`
                      : isToday
                        ? `待ち ${waiting.length}件　`
                        : `${dateKey} の記録（過去分）　`}
                {tab !== "search" && lastUpdated && `最終更新 ${hhmm(lastUpdated.toISOString())}`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* 表示日の切り替え（過去分も同じ画面で見られる）。
                患者を探すタブは日付で絞らないので出さない */}
            <div
              className="h-10 flex items-center gap-2 px-3 rounded-xl text-sm"
              style={{ background: "#FFF8F7", border: "1.5px solid #F2DFE4", color: "#3A2E30", display: tab === "search" || tab === "settings" || tab === "feedback" ? "none" : undefined }}
            >
              <CalendarDays size={15} color="#B08A90" />
              <input
                type="date"
                value={dateKey}
                // 受付は過去分のみだが、予約・オンライン診療は未来の日付も見られる
                max={tab === "bookings" || tab === "pillorder" || tab === "zoom" ? undefined : todayKey()}
                onChange={(e) => { if (e.target.value) setDateKey(e.target.value); }}
                className="bg-transparent outline-none text-sm"
                style={{ color: "#3A2E30", fontFamily: "'JetBrains Mono', monospace" }}
              />
              {!isToday && (
                <button
                  onClick={() => setDateKey(todayKey())}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium active:opacity-70"
                  style={{ background: "#0F8B8D", color: "#FFFFFF" }}
                >
                  今日
                </button>
              )}
            </div>
            {tab === "checkins" && (
              <>
                <label
                  className="h-10 flex items-center gap-2 px-3 rounded-xl text-sm font-medium cursor-pointer select-none"
                  style={{ background: "#FFF8F7", border: "1.5px solid #F2DFE4", color: "#8A7378" }}
                >
                  <input type="checkbox" checked={hideChartDone} onChange={toggleHideChartDone} className="w-4 h-4" />
                  カルテ済を隠す{chartDoneCount > 0 && `（${chartDoneCount}件）`}
                </label>
                <label
                  className="h-10 flex items-center gap-2 px-3 rounded-xl text-sm font-medium cursor-pointer select-none"
                  style={{ background: "#FFF8F7", border: "1.5px solid #F2DFE4", color: "#8A7378" }}
                >
                  <input type="checkbox" checked={hidePaymentDone} onChange={toggleHidePaymentDone} className="w-4 h-4" />
                  会計済を隠す{paymentDoneCount > 0 && `（${paymentDoneCount}件）`}
                </label>
              </>
            )}
            {tab === "checkins" && (
              <button
                onClick={() => { setProxyError(""); setProxy(emptyProxy); }}
                className="h-10 flex items-center gap-1.5 px-4 rounded-xl text-sm font-medium active:opacity-70"
                style={{ background: "#FFFFFF", border: "1.5px solid #0F8B8D", color: "#0F8B8D" }}
              >
                <UserPlus size={15} />
                代理で受付
              </button>
            )}
            {/* 「1日の予定表」はオンライン診療の印刷とセットで使うので pillorder タブへ移動。
                「受付機画面へ」は受付機の運用をやめたので外した（受付は患者のスマホQR） */}
            <button
              onClick={load}
              className="h-10 flex items-center gap-1.5 px-4 rounded-xl text-sm font-medium active:opacity-70"
              style={{ background: "#0F8B8D", color: "#FFFFFF" }}
            >
              <RefreshCw size={15} />
              更新
            </button>
          </div>
        </div>
        </header>

        {/* タブ切り替え: 受付一覧 / 予約状況 */}
        {/* 幅は画面いっぱいまで使う。1024pxで頭打ちにしていたので、
            列がそろわず横スクロールになっていた（iPadは横向きで1024px） */}
        <div className={`relative px-3 sm:px-6 ${samedayNew > 0 || samedayCalNew > 0 ? "pt-12" : "pt-4"} max-w-[1500px] mx-auto w-full`}>
          {/* オンライン診察（pillorder / Zoom英語=Calendly）に当日予約が入ったら、そのタブの真上に
              吹き出しで知らせる。タブを開くと消える（見た予約は端末に記憶）。
              タブ枠は overflow-hidden なので枠の外に置く */}
          {[
            { id: "pillorder", n: samedayNew, ref: pillTabRef, label: "オンライン診察" },
            { id: "zoom", n: samedayCalNew, ref: zoomTabRef, label: "Zoom英語" },
          ].filter((p) => p.n > 0).map((p) => (
            <button
              key={p.id}
              onClick={() => setTab(p.id)}
              className="sameday-pop absolute flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold shadow-md"
              style={{
                top: 8,
                left: p.ref.current ? p.ref.current.offsetLeft : undefined,
                background: "#D64550", color: "#FFFFFF", zIndex: 5, whiteSpace: "nowrap",
              }}
            >
              <Bell size={13} />
              当日予約 {p.n}件（{p.label}）
              <span
                className="absolute"
                style={{ left: 18, bottom: -6, width: 0, height: 0, borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderTop: "6px solid #D64550" }}
              />
            </button>
          ))}
          <div className="inline-flex rounded-xl overflow-hidden" style={{ border: "1.5px solid #F2DFE4", background: "#FFFFFF" }}>
            {[
              { id: "checkins", label: "受付一覧", Icon: ClipboardList },
              { id: "bookings", label: "予約状況", Icon: CalendarCheck },
              { id: "pillorder", label: "pillorder", Icon: Stethoscope },
              { id: "zoom", label: "Zoom英語", Icon: Video },
              { id: "search", label: "患者を探す", Icon: Search },
              { id: "feedback", label: "要望", Icon: MessageCircle },
              { id: "settings", label: "設定", Icon: Settings },
            ].map(({ id, label, Icon }) => (
              <button
                key={id}
                ref={id === "pillorder" ? pillTabRef : id === "zoom" ? zoomTabRef : undefined}
                onClick={() => {
                  setTab(id);
                  // 予約タブで未来日を見ていた場合、受付タブは未来分が無いので今日に戻す
                  if (id === "checkins" && dateKey > todayKey()) setDateKey(todayKey());
                }}
                className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-bold"
                style={
                  tab === id
                    ? { background: "#0F8B8D", color: "#FFFFFF" }
                    : { background: "#FFFFFF", color: "#8A7378" }
                }
              >
                <Icon size={15} />
                {label}
                {/* 未対応の要望があるあいだは件数を出す（開かなくても気づけるように） */}
                {id === "feedback" && feedbackOpen > 0 && (
                  <span
                    className="ml-0.5 inline-flex items-center justify-center rounded-full text-[10px] font-bold"
                    style={{
                      minWidth: 17, height: 17, padding: "0 4px",
                      background: tab === id ? "#FFFFFF" : "#D64550",
                      color: tab === id ? "#0F8B8D" : "#FFFFFF",
                    }}
                  >
                    {feedbackOpen}
                  </span>
                )}
                {/* 未確認の当日予約（pillorder / Zoom英語）の件数 */}
                {((id === "pillorder" && samedayNew > 0) || (id === "zoom" && samedayCalNew > 0)) && (
                  <span
                    className="ml-0.5 inline-flex items-center justify-center rounded-full text-[10px] font-bold"
                    style={{ minWidth: 17, height: 17, padding: "0 4px", background: "#D64550", color: "#FFFFFF" }}
                  >
                    {id === "pillorder" ? samedayNew : samedayCalNew}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <main className="p-3 sm:p-6 flex flex-col gap-8 max-w-[1500px] mx-auto w-full">
          {loadError && (
            <div className="p-4 rounded-xl text-sm" style={{ background: "#FCE9EA", color: "#B03A44" }}>
              読み込みエラー: {loadError}
            </div>
          )}

          {tab === "bookings" && (
          /* 予約リスト（来院予約 booking-app の visit_bookings） */
          <section>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-lg font-bold" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
                {isToday ? "本日の予約" : `${dateKey} の予約`}
              </h2>
              <button
                onClick={() => setEditingBooking(editingBooking === "new" ? null : "new")}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium active:opacity-70"
                style={{ background: "#0F8B8D", color: "#FFFFFF" }}
              >
                <Plus size={15} />
                予約を新規登録
              </button>
            </div>

            {/* 新規/編集フォーム（booking-app から移植した BookingEditor） */}
            {editingBooking && visitSettings && (
              <BookingEditor
                key={editingBooking === "new" ? "new" : editingBooking.id}
                menus={editingBooking === "new" ? menusAll.filter((m) => m.is_active) : menusAll}
                settings={visitSettings}
                holidays={visitHolidays}
                initial={editingBooking === "new" ? null : editingBooking}
                showToast={showNotice}
                onDone={() => { setEditingBooking(null); load(); }}
                onCancel={() => setEditingBooking(null)}
              />
            )}
            <div className="mb-3" />

            {bookings.length === 0 ? (
              <p className="text-sm" style={{ color: "#B08A90" }}>この日の予約はありません。</p>
            ) : (
              <div className="rounded-2xl overflow-hidden" style={{ background: "#FFFFFF", border: "1px solid #F2DFE4" }}>
                <div className="overflow-x-auto">
                  {/* 受付一覧と同じで、連絡先は列を分けずにお名前の下へ積む */}
                  <table className="w-full text-sm" style={{ color: "#3A2E30", minWidth: 780 }}>
                    <thead>
                      <tr className="text-left text-xs" style={{ color: "#B08A90", background: "#FFF8F7" }}>
                        <th className="px-3 py-2.5 font-medium">時間</th>
                        <th className="px-2 py-2.5 font-medium">お名前・生年月日・電話</th>
                        <th className="px-2 py-2.5 font-medium">メニュー</th>
                        <th className="px-2 py-2.5 font-medium">内容</th>
                        <th className="px-2 py-2.5 font-medium">保険</th>
                        <th className="px-2 py-2.5 font-medium">経路</th>
                        <th className="px-2 py-2.5 font-medium">問診票</th>
                        <th className="px-2 py-2.5 font-medium">状態</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bookings.map((b) => {
                        const status = BOOKING_STATUS[b.status] || BOOKING_STATUS.booked;
                        const bf = bookingForms.find((f) => f.booking_id === b.id) || null;
                        // 受付機でチェックイン済みなら受付番号も添える（同日の受付から booking_id で照合）
                        const checkin = checkins.find((c) => c.booking_id === b.id) || null;
                        const isPickup = b.visit_menus?.kind === "pickup";
                        return (
                          <tr key={b.id} style={{ borderTop: "1px solid #FAEEF0", opacity: b.status === "cancelled" ? 0.45 : 1 }}>
                            <td className="px-3 py-3 font-bold" style={{ color: "#0F8B8D", fontFamily: "'JetBrains Mono', monospace" }}>
                              {b.time}
                            </td>
                            <td className="px-2 py-3 font-medium">
                              {b.patient_name}
                              {b.patient_kana && (
                                <span className="block text-xs font-normal" style={{ color: "#B08A90" }}>{b.patient_kana}</span>
                              )}
                              <span
                                className="block text-[11px] font-normal leading-tight"
                                style={{ color: "#B08A90", fontFamily: "'JetBrains Mono', monospace" }}
                              >
                                {b.birthdate || "—"}　{b.phone || "—"}
                              </span>
                              {(() => {
                                // 2回目以降の方は、過去の受付・問診票の番号を出す（カルテ出しの準備用）
                                const pastChart = pastCharts.get(chartMatchKey(b.patient_name, b.birthdate));
                                return pastChart ? (
                                  <span
                                    className="mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold"
                                    style={{ background: "#DFF5F3", color: "#0F8B8D", fontFamily: "'JetBrains Mono', monospace" }}
                                  >
                                    カルテ {pastChart}
                                  </span>
                                ) : null;
                              })()}
                            </td>
                            <td className="px-2 py-3">
                              {/* 受付一覧の区分タグと同じ配色（初診=紫・再診=ティール）で
                                  文字を読まずに拾えるようにする。区分のないメニューは従来の赤 */}
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap"
                                style={
                                  isPickup
                                    ? { background: "#DFF5F3", color: "#0F8B8D" }
                                    : VISIT_KIND_BADGE[b.visit_kind]
                                      ? { background: VISIT_KIND_BADGE[b.visit_kind].bg, color: VISIT_KIND_BADGE[b.visit_kind].fg }
                                      : { background: "#FCE9EA", color: "#D64550" }
                                }
                              >
                                {isPickup ? <PackageCheck size={12} /> : <Stethoscope size={12} />}
                                {b.visit_menus?.name || b.menu_id}
                              </span>
                            </td>
                            <td className="px-2 py-3 text-xs" style={{ color: "#8A7378", maxWidth: 200 }}>{bookingDetail(b)}</td>
                            <td className="px-2 py-3 text-xs"><InsuranceTag id={b.insurance} /></td>
                            <td className="px-2 py-3 text-xs">{CHANNEL_LABEL[b.channel] || b.channel}</td>
                            <td className="px-2 py-3">
                              {bf ? (
                                <div className="flex flex-col items-start gap-0.5">
                                  <button
                                    onClick={() => setSelectedForm(bf)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium active:opacity-70"
                                    style={{ background: "#0F8B8D", color: "#FFFFFF" }}
                                  >
                                    <FileText size={12} />
                                    表示
                                  </button>
                                  <GuideReadTag read={bf.guide_read} total={bf.guide_total} expected={Array.isArray(bf.guide_keys) && bf.guide_keys.length > 0} />
                                  {/* メールアドレスは問診票の回答（Email欄）から拾う。intake_formsにemail専用カラムは無い */}
                                  {emailFromIntakeAnswers(bf) && (
                                    <button
                                      onClick={() => sendGuideMail(bf.id, emailFromIntakeAnswers(bf), bf.guide_keys || [], "ja")}
                                      disabled={guideMailing === bf.id}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium active:opacity-70"
                                      style={{ background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#8A7378", opacity: guideMailing === bf.id ? 0.5 : 1 }}
                                    >
                                      <Mail size={11} />
                                      {guideMailing === bf.id ? "送信中..." : bf.guide_mail_sent_at ? "ガイドを再送" : "ガイドをメール送信"}
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs" style={{ color: "#C9AEB3" }}>{isPickup ? "—" : "未記入"}</span>
                              )}
                            </td>
                            <td className="px-2 py-3">
                              <span
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap"
                                style={{ background: status.bg, color: status.fg }}
                              >
                                {status.label}
                              </span>
                              {checkin && (
                                <span className="block text-xs mt-1" style={{ color: "#B08A90", fontFamily: "'JetBrains Mono', monospace" }}>
                                  受付 #{checkin.checkin_number}
                                </span>
                              )}
                              {/* 受付はその日のうちにしか作れないので、当日を見ているときだけ出す */}
                              {isToday && b.status === "booked" && !checkin && (
                                <button
                                  onClick={() => checkinFromBooking(b)}
                                  disabled={checkingIn === b.id}
                                  className="inline-flex items-center gap-1 mt-1 px-2.5 py-1 rounded-lg text-xs font-medium active:opacity-70 whitespace-nowrap"
                                  style={{ background: "#0F8B8D", color: "#FFFFFF", opacity: checkingIn === b.id ? 0.5 : 1 }}
                                >
                                  <UserPlus size={12} />
                                  {checkingIn === b.id ? "受付中..." : "受付する"}
                                </button>
                              )}
                              {/* 予約の編集・状態変更（booking-app から移植） */}
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {b.status !== "cancelled" && (
                                  <button
                                    onClick={() => setEditingBooking(editingBooking?.id === b.id ? null : b)}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium"
                                    style={{ background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#127D82" }}
                                  >
                                    <Pencil size={11} /> 編集
                                  </button>
                                )}
                                {b.status === "booked" && (
                                  <>
                                    <button
                                      onClick={() => updateBookingStatus(b.id, "done")}
                                      className="px-2 py-1 rounded-lg text-xs font-medium"
                                      style={{ background: "#DFF5F3", color: "#127D82" }}
                                    >
                                      来院済み
                                    </button>
                                    <button
                                      onClick={() => { if (window.confirm(`${b.time} ${b.patient_name} さんの予約をキャンセルしますか？`)) updateBookingStatus(b.id, "cancelled"); }}
                                      className="px-2 py-1 rounded-lg text-xs font-medium"
                                      style={{ color: "#D64550" }}
                                    >
                                      キャンセル
                                    </button>
                                  </>
                                )}
                                {b.status === "done" && (
                                  <button
                                    onClick={() => updateBookingStatus(b.id, "booked")}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium"
                                    style={{ color: "#8A7378" }}
                                  >
                                    <RotateCcw size={11} /> 予約中に戻す
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
          )}

          {tab === "pillorder" && (
          /* オンライン診療（pillorder）の予約を予約時刻順に一覧し、問診票の記入状況を出す。当日分を一括印刷できる */
          <section>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-lg font-bold" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
                {isToday ? "本日のオンライン診療" : `${dateKey} のオンライン診療`}（{pillorderActive.length}件
                {pillorderUnfilled.length > 0 && <span style={{ color: "#B7791F" }}>・問診票未記入 {pillorderUnfilled.length}</span>}）
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                {/* 来院とオンラインを枠ごとに並べた1日の予定表。まとめて印刷と同じ流れで使う */}
                <button
                  onClick={printSchedule}
                  disabled={schedulePages.length === 0 || schedulePrinting}
                  title="来院とオンラインを枠ごとに並べた1日の予定表をA4で印刷します（空き枠も出ます）"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium active:opacity-70"
                  style={{
                    background: "#FFFFFF",
                    border: `1.5px solid ${schedulePages.length ? "#0F8B8D" : "#F2DFE4"}`,
                    color: schedulePages.length ? "#0F8B8D" : "#C9AEB3",
                    opacity: schedulePrinting ? 0.5 : 1,
                  }}
                >
                  <Printer size={15} />
                  {schedulePrinting ? "PDF作成中..." : `1日の予定表（来院${scheduleCounts.visit}＋オンライン${scheduleCounts.online}）`}
                </button>
                <button
                  onClick={printAllQuestionnaires}
                  disabled={(monshinPrintRows.length + dayIntakeForms.length) === 0 || monshinPrinting}
                  title="オンライン診療の問診票と、来院受付の問診票をまとめてA4で印刷します（キャンセル済は除きます）"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium active:opacity-70"
                  style={{ background: (monshinPrintRows.length + dayIntakeForms.length) ? "#0F8B8D" : "#E7D9DC", color: "#FFFFFF", opacity: monshinPrinting ? 0.5 : 1 }}
                >
                  <Printer size={15} />
                  {monshinPrinting ? "PDF作成中..." : `この日の問診票をまとめて印刷（オンライン${monshinPrintRows.length}＋来院予約${dayIntakeForms.length}）`}
                </button>
                <button
                  onClick={printMonshinBatch}
                  disabled={monshinPrintRows.length === 0 || monshinPrinting}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium active:opacity-70"
                  style={{ background: "#FFF8F7", border: "1.5px solid #F2DFE4", color: "#127D82", opacity: monshinPrinting ? 0.5 : 1 }}
                >
                  <Printer size={13} />
                  オンライン分だけ（{monshinPrintRows.length}）
                </button>
              </div>
            </div>
            {pillorderList.length === 0 ? (
              <p className="text-sm" style={{ color: "#B08A90" }}>
                この日のオンライン診療の予約はありません。（pillorder の予約が5分おきにここへ届き、問診票が記入されると「表示・印刷」に変わります）
              </p>
            ) : (
              <div className="rounded-2xl overflow-hidden" style={{ background: "#FFFFFF", border: "1px solid #F2DFE4" }}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ color: "#3A2E30", minWidth: 720 }}>
                    <thead>
                      <tr className="text-left text-xs" style={{ color: "#B08A90", background: "#FFF8F7" }}>
                        <th className="px-3 py-2.5 font-medium">時間</th>
                        <th className="px-2 py-2.5 font-medium">お名前・生年月日・電話</th>
                        <th className="px-2 py-2.5 font-medium">注意</th>
                        <th className="px-2 py-2.5 font-medium">問診票</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pillorderList.map((row) => {
                        const m = row.monshin;
                        const flagged = !!m && (m.answers || []).some((a) => a.flag);
                        const anno = dobAnnotation(row.dob);
                        return (
                          <tr key={row.key} style={{ borderTop: "1px solid #FAEEF0", opacity: row.canceled ? 0.6 : 1 }}>
                            <td className="px-3 py-3 font-bold align-top" style={{ color: "#0F8B8D", fontFamily: "'JetBrains Mono', monospace", textDecoration: row.canceled ? "line-through" : "none" }}>
                              {row.time}
                              {row.noReserveTime && <span className="block text-[10px] font-normal" style={{ color: "#C9AEB3" }}>記入時刻</span>}
                              {(row.status === 1 || row.status === 6) && <span className="block text-[10px] font-normal" style={{ color: "#C9AEB3" }}>仮予約</span>}
                              {row.status === 3 && <span className="block text-[10px] font-normal" style={{ color: "#C9AEB3" }}>診察済</span>}
                            </td>
                            <td className="px-2 py-3 font-medium align-top">
                              {row.name}
                              {row.kana && <span className="block text-xs font-normal" style={{ color: "#B08A90" }}>{row.kana}</span>}
                              <span className="block text-[11px] font-normal leading-tight" style={{ color: "#B08A90", fontFamily: "'JetBrains Mono', monospace" }}>
                                {row.dob || "—"}{anno ? `（${anno}）` : ""}　{fmtPhoneDisp(row.phone) || "—"}
                                {row.chart ? `　診察券 ${row.chart}` : ""}
                              </span>
                              {row.email && (
                                <span className="block text-[11px] font-normal leading-tight" style={{ color: "#B08A90" }}>{row.email}</span>
                              )}
                            </td>
                            <td className="px-2 py-3 align-top">
                              {row.canceled && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold mr-1" style={{ background: "#EEE7E8", color: "#8A7A7E" }}>キャンセル済</span>
                              )}
                              {flagged ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background: "#FCE9EA", color: "#B03A44" }}>要注意</span>
                              ) : (
                                !row.canceled && <span style={{ color: "#C9AEB3" }}>—</span>
                              )}
                              {m?.printed_at && <span className="block text-[10px] mt-0.5" style={{ color: "#C9AEB3" }}>印刷済</span>}
                            </td>
                            <td className="px-2 py-3 align-top">
                              {m ? (
                                <div className="flex flex-col items-start gap-0.5">
                                  <button
                                    onClick={() => setSelectedMonshin(m)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium active:opacity-70"
                                    style={{ background: "#0F8B8D", color: "#FFFFFF" }}
                                  >
                                    <FileText size={12} />
                                    表示・印刷
                                  </button>
                                  <GuideReadTag read={m.guide_read} total={m.guide_total} expected />
                                  {/* メールアドレスの分かる方（pillorder予約から同期）には、内容に合ったガイドを送れる */}
                                  {row.email && (
                                    <button
                                      onClick={() => sendGuideMail(m.id, row.email, guideKeysFromMonshin(m), m.source === "zoom" ? "en" : "ja")}
                                      disabled={guideMailing === m.id}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium active:opacity-70"
                                      style={{ background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#8A7378", opacity: guideMailing === m.id ? 0.5 : 1 }}
                                    >
                                      <Mail size={11} />
                                      {guideMailing === m.id ? "送信中..." : m.guide_mail_sent_at ? "ガイドを再送" : "ガイドをメール送信"}
                                    </button>
                                  )}
                                </div>
                              ) : row.canceled ? (
                                <span className="text-xs" style={{ color: "#C9AEB3" }}>—</span>
                              ) : row.progress ? (
                                <ProgressBadge p={row.progress} />
                              ) : row.answered ? (
                                /* pillorder 側の記入済みフラグだけ立っている（旧問診・pillorder内で回答）。紙はこちらに無い */
                                <span className="text-xs" style={{ color: "#B08A90" }}>記入済（pillorder内）</span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background: "#FFF3DC", color: "#B7791F" }}>未記入</span>
                              )}
                              {!m && !row.canceled && row.reminders && (
                                /* 催促メール（朝9時／1時間前／当日10分後／手動）のうち送ったもの */
                                <span className="block text-[10px] mt-0.5" style={{ color: row.reminders.length ? "#8A7A7E" : "#C9AEB3" }}>
                                  {row.reminders.length ? `催促メール送信済（${row.reminders.join("・")}）` : "催促メール 未送信"}
                                </span>
                              )}
                              {!m && !row.canceled && row.reserveId && (
                                row.manual.requested ? (
                                  <span className="block text-[10px] mt-1 font-bold" style={{ color: "#0F8B8D" }}>催促メール 送信依頼中（数分以内に送信）</span>
                                ) : (
                                  <span className="block mt-1">
                                    <button
                                      onClick={() => requestReminder(row.reserveId)}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium active:opacity-70"
                                      style={{ background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#B7791F" }}
                                      title="自動リマインドと同じメールを、この方にもう一度送ります（数分以内に送信）"
                                    >
                                      <MessageCircle size={11} />
                                      催促メールを送る
                                    </button>
                                    {row.manual.error && (
                                      <span className="block text-[10px] mt-0.5" style={{ color: "#B03A44" }}>前回の送信に失敗: {row.manual.error}</span>
                                    )}
                                  </span>
                                )
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
          )}

          {tab === "zoom" && (
          /* Calendly の予約を予約時刻順に一覧し、英語LP（klcs.jp/en/intake.html）の問診票の記入状況を出す。表示・印刷はpillorderタブと同じ */
          <section>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-lg font-bold" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
                {isToday ? "本日のZoom診療（英語）" : `${dateKey} のZoom診療（英語）`}（{zoomActive.length}件
                {zoomUnfilled.length > 0 && <span style={{ color: "#B7791F" }}>・問診票未記入 {zoomUnfilled.length}</span>}）
              </h2>
              <button
                onClick={printZoomBatch}
                disabled={zoomPrintRows.length === 0 || monshinPrinting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium active:opacity-70"
                style={{ background: zoomPrintRows.length ? "#0F8B8D" : "#E7D9DC", color: "#FFFFFF", opacity: monshinPrinting ? 0.5 : 1 }}
              >
                <Printer size={15} />
                {monshinPrinting ? "PDF作成中..." : `この日の分をまとめて印刷（${zoomPrintRows.length}）`}
              </button>
            </div>
            {zoomList.length === 0 ? (
              <p className="text-sm" style={{ color: "#B08A90" }}>
                この日のZoom診療の予約はありません。（Calendlyの予約がこのタブを開くたびに届き、問診票が記入されると「表示・印刷」に変わります）
              </p>
            ) : (
              <div className="rounded-2xl overflow-hidden" style={{ background: "#FFFFFF", border: "1px solid #F2DFE4" }}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ color: "#3A2E30", minWidth: 720 }}>
                    <thead>
                      <tr className="text-left text-xs" style={{ color: "#B08A90", background: "#FFF8F7" }}>
                        <th className="px-3 py-2.5 font-medium">時間</th>
                        <th className="px-2 py-2.5 font-medium">お名前・生年月日・電話</th>
                        <th className="px-2 py-2.5 font-medium">注意</th>
                        <th className="px-2 py-2.5 font-medium">問診票</th>
                      </tr>
                    </thead>
                    <tbody>
                      {zoomList.map((row) => {
                        const m = row.monshin;
                        const flagged = !!m && (m.answers || []).some((a) => a.flag);
                        const anno = dobAnnotation(row.dob);
                        return (
                          <tr key={row.key} style={{ borderTop: "1px solid #FAEEF0", opacity: row.canceled ? 0.6 : 1 }}>
                            <td className="px-3 py-3 font-bold align-top" style={{ color: "#0F8B8D", fontFamily: "'JetBrains Mono', monospace", textDecoration: row.canceled ? "line-through" : "none" }}>
                              {row.time}
                              {row.noReserveTime && <span className="block text-[10px] font-normal" style={{ color: "#C9AEB3" }}>記入時刻</span>}
                            </td>
                            <td className="px-2 py-3 font-medium align-top">
                              {row.name}
                              <span className="block text-[11px] font-normal leading-tight" style={{ color: "#B08A90", fontFamily: "'JetBrains Mono', monospace" }}>
                                {row.dob || "—"}{anno ? `（${anno}）` : ""}　{fmtPhoneDisp(row.phone) || "—"}
                              </span>
                              {row.email && (
                                <span className="block text-[11px] font-normal leading-tight" style={{ color: "#B08A90" }}>{row.email}</span>
                              )}
                            </td>
                            <td className="px-2 py-3 align-top">
                              {row.canceled && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold mr-1" style={{ background: "#EEE7E8", color: "#8A7A7E" }}>キャンセル済</span>
                              )}
                              {flagged ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background: "#FCE9EA", color: "#B03A44" }}>要注意</span>
                              ) : (
                                !row.canceled && !(row.duplicates || []).length && <span style={{ color: "#C9AEB3" }}>—</span>
                              )}
                              {(row.duplicates || []).length > 0 && (
                                /* 同じ人が他の日時にも予約を持っている。Calendly 側で片方を取り消すか患者に確認する */
                                <>
                                  <span
                                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold"
                                    style={{ background: "#FCE9EA", color: "#D64550" }}
                                    title="同じ方が今日以降に他の予約も取っています。Calendly で片方をキャンセルするか、患者さんに確認してください"
                                  >
                                    重複予約 +{row.duplicates.length}
                                  </span>
                                  <span className="block text-[10px] mt-0.5" style={{ color: "#D64550" }}>
                                    他: {row.duplicates.map((d) => {
                                      const x = new Date(d);
                                      return `${x.getMonth() + 1}/${x.getDate()} ${hhmm(d)}`;
                                    }).join("、")}
                                  </span>
                                </>
                              )}
                              {m?.printed_at && <span className="block text-[10px] mt-0.5" style={{ color: "#C9AEB3" }}>印刷済</span>}
                            </td>
                            <td className="px-2 py-3 align-top">
                              {m ? (
                                <div className="flex flex-col items-start gap-0.5">
                                  <button
                                    onClick={() => setSelectedMonshin(m)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium active:opacity-70"
                                    style={{ background: "#0F8B8D", color: "#FFFFFF" }}
                                  >
                                    <FileText size={12} />
                                    表示・印刷
                                  </button>
                                  <GuideReadTag read={m.guide_read} total={m.guide_total} expected />
                                  {/* メールアドレスの分かる方（Zoom英語）には、内容に合ったガイドを送れる */}
                                  {row.email && (
                                    <button
                                      onClick={() => sendGuideMail(m.id, row.email, guideKeysFromMonshin(m), m.source === "zoom" ? "en" : "ja")}
                                      disabled={guideMailing === m.id}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium active:opacity-70"
                                      style={{ background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#8A7378", opacity: guideMailing === m.id ? 0.5 : 1 }}
                                    >
                                      <Mail size={11} />
                                      {guideMailing === m.id ? "送信中..." : m.guide_mail_sent_at ? "ガイドを再送" : "ガイドをメール送信"}
                                    </button>
                                  )}
                                </div>
                              ) : row.canceled ? (
                                <span className="text-xs" style={{ color: "#C9AEB3" }}>—</span>
                              ) : row.progress ? (
                                <ProgressBadge p={row.progress} />
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background: "#FFF3DC", color: "#B7791F" }}>未記入</span>
                              )}
                              {!m && !row.canceled && row.email && row.inviteeUri && (
                                /* 英語の催促メールを staff@klcs.jp から自動送信（Edge Function zoom-reminder）。
                                   送信済でも、時間をおいてもう一度送れる */
                                <span className="block mt-1">
                                  {/* 催促メール（朝9時／1時間前＝自動、手動）のうち送ったもの。pillorder と同じ見え方 */}
                                  <span className="block text-[10px] mb-0.5" style={{ color: row.reminders.length ? "#8A7A7E" : "#C9AEB3" }}>
                                    {row.reminders.length ? `催促メール送信済（${row.reminders.join("・")}）` : "催促メール 未送信"}
                                  </span>
                                  {row.reminderError && !row.reminderSentAt && (
                                    <span className="block text-[10px] mb-0.5" style={{ color: "#D64550" }}>前回の送信に失敗: {row.reminderError}</span>
                                  )}
                                  <button
                                    onClick={() => sendZoomReminder(row)}
                                    disabled={zoomReminding === row.inviteeUri}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium active:opacity-70"
                                    style={{ background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#B7791F", opacity: zoomReminding === row.inviteeUri ? 0.5 : 1 }}
                                    title="英語のリマインドメールを staff@klcs.jp から送ります"
                                  >
                                    <MessageCircle size={11} />
                                    {zoomReminding === row.inviteeUri ? "送信中..." : row.reminderSentAt ? "もう一度送る" : "催促メールを送る"}
                                  </button>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
          )}

          {tab === "feedback" && (
            <FeedbackTab isAdmin adminName={myName} onCountChange={setFeedbackOpen} />
          )}

          {tab === "search" && (
          /* 患者を探す。日付をまたいで過去の問診票を呼び出し、もう一度見る・印刷する。
             生年月日は前方一致なので、年だけ・年月だけでも候補を絞れる */
          <section>
            <h2 className="text-lg font-bold mb-1" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
              患者を探す
            </h2>
            <p className="text-xs mb-4" style={{ color: "#B08A90" }}>
              過去に提出された問診票を、患者さんごとにまとめて呼び出します。表示・印刷ができます。
              生年月日は「1990」「1990-05」のように途中まででも候補が出ます。<br />
              カルテ番号を入れると、<b>その方の問診票すべてに同じ番号が入ります</b>。一度つながれば、
              お名前を漢字で書いた回もローマ字で書いた回も同じ1人としてまとまります。
            </p>

            <form
              onSubmit={(e) => { e.preventDefault(); runSearch(); }}
              className="flex items-end gap-3 flex-wrap p-4 rounded-2xl mb-5"
              style={{ background: "#FFFFFF", border: "1px solid #F2DFE4" }}
            >
              <label className="block">
                <span className="block text-xs font-medium mb-1" style={{ color: "#8A7378" }}>お名前（一部でも可）</span>
                <input
                  type="text"
                  value={query.name}
                  onChange={(e) => setQuery({ ...query, name: e.target.value })}
                  placeholder="山田　／　ヤマダ　／　Yamada"
                  className="p-2.5 rounded-lg text-sm outline-none"
                  style={{ width: 220, background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#3A2E30" }}
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium mb-1" style={{ color: "#8A7378" }}>生年月日</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={query.dob}
                  onChange={(e) => setQuery({ ...query, dob: e.target.value })}
                  placeholder="1990-05-20"
                  className="p-2.5 rounded-lg text-sm outline-none"
                  style={{ width: 150, background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#3A2E30", fontFamily: "'JetBrains Mono', monospace" }}
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium mb-1" style={{ color: "#8A7378" }}>カルテ番号</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={query.chart}
                  onChange={(e) => setQuery({ ...query, chart: e.target.value })}
                  placeholder="12345"
                  className="p-2.5 rounded-lg text-sm outline-none"
                  style={{ width: 130, background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#3A2E30", fontFamily: "'JetBrains Mono', monospace" }}
                />
              </label>
              <button
                type="submit"
                disabled={searching}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-bold active:opacity-70"
                style={{ background: "#0F8B8D", color: "#FFFFFF", opacity: searching ? 0.5 : 1 }}
              >
                <Search size={15} />
                {searching ? "探しています..." : "探す"}
              </button>
              {(query.name || query.dob || query.chart || results) && (
                <button
                  type="button"
                  onClick={() => { setQuery({ name: "", dob: "", chart: "" }); setResults(null); setSearchCheckins([]); setSearchError(""); }}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium active:opacity-70"
                  style={{ background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#8A7378" }}
                >
                  クリア
                </button>
              )}
            </form>

            {searchError && (
              <div className="p-3 rounded-xl text-sm mb-4" style={{ background: "#FCE9EA", color: "#B03A44" }}>
                {searchError}
              </div>
            )}

            {results === null ? (
              <p className="text-sm" style={{ color: "#B08A90" }}>条件を入れて「探す」を押してください。</p>
            ) : patientGroups.length === 0 ? (
              <p className="text-sm" style={{ color: "#B08A90" }}>
                見つかりませんでした。お名前は漢字・カナ・ローマ字のどれで書かれているか分からないので、
                生年月日だけで探すほうが確実です。
              </p>
            ) : (
              <>
                <p className="text-xs mb-2" style={{ color: "#B08A90" }}>
                  {patientGroups.length}人・問診票 {results.length}件・来院 {searchCheckins.length}件
                  {results.length >= 200 && "（多いため新しい200件まで）"}・新しい順
                </p>
                <div className="flex flex-col gap-3">
                  {patientGroups.map((g) => (
                    <div key={g.key} className="rounded-2xl overflow-hidden" style={{ background: "#FFFFFF", border: "1px solid #F2DFE4" }}>
                      {/* 1人ぶんの見出し。番号はここで入れると、下の問診票すべてに入る */}
                      <div
                        className="flex items-center justify-between gap-3 flex-wrap px-4 py-3"
                        style={{ background: "#FFF8F7", borderBottom: "1px solid #F2DFE4" }}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-bold" style={{ color: "#3A2E30" }}>
                            {g.name}
                            <span className="ml-2 text-xs font-normal" style={{ color: "#B08A90", fontFamily: "'JetBrains Mono', monospace" }}>
                              {g.dob || "生年月日 —"}
                              {g.age !== null && `　${g.age}歳`}
                            </span>
                          </div>
                          <div className="text-[11px] mt-0.5" style={{ color: "#B08A90" }}>
                            問診票 {g.forms.length}件　来院 {g.checkins.length}件
                            {g.aliases.length > 1 && `　表記: ${g.aliases.join(" / ")}`}
                            {!g.chart && "　※ カルテ番号がまだ付いていません"}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs" style={{ color: "#8A7378" }}>カルテ番号</span>
                          <ChartNumberInput
                            value={g.chart}
                            width={110}
                            onSave={(v) => saveChartNumber({
                              checkinIds: [...g.forms.map((f) => f.checkin_id), ...g.checkins.map((c) => c.id)],
                              formIds: g.forms.map((f) => f.id),
                              value: v,
                            })}
                          />
                        </div>
                      </div>
                      {/* 問診票が1枚も無い方。薬のみで来られた方や、書かずに
                          帰られた方。番号だけ付けてあることがあるので、来院日を出す */}
                      {g.forms.length === 0 && (
                        <div className="px-4 py-3 text-xs" style={{ color: "#8A7378" }}>
                          問診票はありません（受付の記録のみ）。来院日：
                          <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                            {g.checkins.slice(0, 8).map((c) => c.date_key).join("　")}
                          </span>
                          {g.checkins.length > 8 && ` ほか${g.checkins.length - 8}件`}
                        </div>
                      )}
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm" style={{ color: "#3A2E30", minWidth: 560 }}>
                          <tbody>
                            {g.forms.map((f, i) => {
                              const kind = (f.answers || []).find((r) => /^種類/.test(r?.label || ""))?.value || "";
                              return (
                                <tr key={f.id} style={{ borderTop: i === 0 ? "none" : "1px solid #FAEEF0" }}>
                                  <td className="px-4 py-2.5 text-xs whitespace-nowrap" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                                    {String(f.created_at).slice(0, 10)}
                                    <span className="ml-2" style={{ color: "#B08A90" }}>{hhmm(f.created_at)}</span>
                                  </td>
                                  <td className="px-3 py-2.5 text-xs" style={{ color: "#8A7378" }}>
                                    {/Follow-up|簡易/.test(kind) ? "再診（簡易）" : "初診・詳細"}
                                  </td>
                                  {/* 同じ人でも書き方が違うことがあるので、その回の氏名も出す */}
                                  <td className="px-3 py-2.5 text-xs" style={{ color: "#8A7378" }}>
                                    {f.patient_name !== g.name ? f.patient_name : ""}
                                  </td>
                                  <td className="px-3 py-2.5 text-right">
                                    <button
                                      onClick={() => setSelectedForm(f)}
                                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium active:opacity-70"
                                      style={{ background: "#0F8B8D", color: "#FFFFFF" }}
                                    >
                                      <FileText size={13} />
                                      表示・印刷
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] mt-3" style={{ color: "#B08A90" }}>
                  ここに出るのは患者さんご本人が書かれた問診票です。閲覧・印刷した記録は残りません。取り扱いにご注意ください。
                </p>
              </>
            )}
          </section>
          )}

          {tab === "checkins" && (
          <>
          {/* 受付リスト */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
              {isToday ? "本日の受付" : `${dateKey} の受付`}
            </h2>
            {checkins.length === 0 ? (
              <p className="text-sm" style={{ color: "#B08A90" }}>
                {isToday ? "まだ受付はありません。" : "この日の受付はありません。"}
              </p>
            ) : visibleCheckins.length === 0 ? (
              <p className="text-sm" style={{ color: "#B08A90" }}>
                表示できる受付はありません（{checkins.length}件をフィルタで非表示中）。
              </p>
            ) : (
              <div className="rounded-2xl overflow-hidden" style={{ background: "#FFFFFF", border: "1px solid #F2DFE4" }}>
                <div className="overflow-x-auto">
                  {/* 1画面に収める。関係の近いものは列を分けずに縦へ積む
                      （受付時刻と予約時間／氏名とカナと生年月日／診察か薬かと初診か再診か）。
                      列を増やすほど横に伸びて、iPadでは横スクロールになる */}
                  <table className="w-full text-sm" style={{ color: "#3A2E30", minWidth: 860 }}>
                    <thead>
                      <tr className="text-left text-xs" style={{ color: "#B08A90", background: "#FFF8F7" }}>
                        <th className="px-3 py-2.5 font-medium">番号</th>
                        <th className="px-2 py-2.5 font-medium">時刻</th>
                        <th className="px-2 py-2.5 font-medium">お名前・生年月日</th>
                        <th className="px-2 py-2.5 font-medium">種別</th>
                        <th className="px-2 py-2.5 font-medium">内容</th>
                        <th className="px-2 py-2.5 font-medium">保険</th>
                        {/* 電子カルテとは繋がっていないので、番号は人が見て入れる */}
                        <th className="px-2 py-2.5 font-medium">カルテ</th>
                        <th className="px-2 py-2.5 font-medium">問診票</th>
                        <th className="px-2 py-2.5 font-medium">状態</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checkinSections.map((sec) => (
                      <React.Fragment key={sec.key}>
                      {checkinSections.length > 1 && (
                        <tr>
                          <td colSpan={9} className="px-3 py-2" style={sec.style}>
                            <span className="text-xs font-bold" style={{ fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
                              {sec.key === "booked" && <CalendarCheck size={13} className="inline-block mr-1 align-[-2px]" />}
                              {sec.label}
                            </span>
                            <span className="ml-2 text-[11px]" style={{ opacity: 0.75 }}>{sec.rows.length}件 ・ {sec.note}</span>
                          </td>
                        </tr>
                      )}
                      {sec.rows.map((c) => {
                        // カタカナは問診票からも拾いたいので、薬受け取りでも問診票を探す
                        // （問診票欄の表示は従来どおり診察のときだけ）。事前記入の
                        // 問診票は提出日が別日なので booking_id 側からも見る
                        const anyForm =
                          formFor(c) ||
                          (c.booking_id ? bookingForms.find((bf) => bf.booking_id === c.booking_id) : null) ||
                          null;
                        const f = c.visit_type === "consult" ? anyForm : null;
                        // 受付のアフターピルボタン（再診）か、問診票の受診理由（初診）
                        const map = c.ec_intercourse_date
                          ? { date: c.ec_intercourse_date, timing: "" }
                          : mapFromForm(anyForm);
                        // タグに出すので、お薬の一覧からは外す
                        const meds = (c.medications || []).filter((m) => !(map && /アフターピル/.test(m)));
                        // 問診票の受診理由バッジ（低用量ピル・肌荒れ・内診系など）
                        const reasonBadges = reasonBadgesForForm(anyForm);
                        // 飲み方ガイドの「〜について聞いてみたい」ボタンで問診票に書き足された相談希望。
                        // 紙の問診票は先に印刷してしまうので、あとから押されてもここで気づける
                        const wants = (anyForm?.answers || [])
                          .filter((r) => /^(アルダクトン|低用量ピル)聞いてみたい/.test(r?.label || ""))
                          .map((r) => (r.label || "").split(" ／")[0]);
                        const booking = bookingById.get(c.booking_id);
                        const kana = kanaFor(c, anyForm, booking);
                        const isDone = c.chart_done && c.payment_done;
                        // 予約の方は呼ぶ順番の判断が変わる（飛び込みより予約時間が優先）。
                        // 受付の運用基準: 予約時間から7分までの受付は許容、8分以降を「遅」とする
                        const bookedAt = booking?.time ? String(booking.time).slice(0, 5) : null;
                        const toMin = (s) => { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; };
                        const late = bookedAt && toMin(hhmm(c.created_at)) >= toMin(bookedAt) + 8;
                        // 番号がまだ入っていない2回目以降の方は、前回までの番号を出す
                        const savedChart = c.chart_number || anyForm?.chart_number || "";
                        const pastChart = savedChart
                          ? null
                          : pastCharts.get(chartMatchKey(c.patient_name, c.date_of_birth)) || null;
                        return (
                          <tr key={c.id} style={{ borderTop: "1px solid #FAEEF0", opacity: isDone ? 0.5 : 1 }}>
                            <td className="px-3 py-3 text-lg font-bold" style={{ color: "#0F8B8D", fontFamily: "'JetBrains Mono', monospace" }}>
                              {c.checkin_number}
                            </td>
                            <td className="px-2 py-3">
                              <div style={{ fontFamily: "'JetBrains Mono', monospace" }}>{hhmm(c.created_at)}</div>
                              {bookedAt ? (
                                <span
                                  className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold whitespace-nowrap"
                                  style={{ background: "#EFEAFB", color: "#5B4BB8" }}
                                  title={late ? "予約時間を過ぎてから受付されました" : undefined}
                                >
                                  <CalendarCheck size={11} />
                                  <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{bookedAt}</span>
                                  {late && <span style={{ color: "#B03A44" }}>遅</span>}
                                </span>
                              ) : (
                                <div className="text-[11px] leading-tight" style={{ color: "#C9AEB3" }}>予約なし</div>
                              )}
                            </td>
                            <td className="px-2 py-3">
                              <div className="font-medium">
                                {/* 診察で英語のサポートを希望した方（受付時のチェック。英語表示の方は既定ON） */}
                                {c.wants_english && (
                                  <span
                                    className="inline-flex items-center justify-center mr-1.5 px-1.5 py-0.5 rounded text-[11px] font-bold align-middle"
                                    style={{ background: "#E3EDFB", color: "#2B5FAB" }}
                                    title="診察で英語のサポートを希望しています"
                                  >英</span>
                                )}
                                {c.patient_name}
                              </div>
                              {kana && (
                                <div
                                  className="text-[11px] leading-tight"
                                  style={{ color: kana.guessed ? "#C9AEB3" : "#8A7378" }}
                                  title={kana.guessed ? "氏名からの自動推測です（問診票が届くと本人の記入に切り替わります）" : undefined}
                                >
                                  {kana.text}
                                </div>
                              )}
                              {/* 生年月日は本人確認に使うだけなので、列を1つ使うほどではない */}
                              <div
                                className="text-[11px] leading-tight"
                                style={{ color: "#B08A90", fontFamily: "'JetBrains Mono', monospace" }}
                              >
                                {c.date_of_birth || "生年月日 —"}
                              </div>
                            </td>
                            <td className="px-2 py-3">
                              {/* 「診察か薬か」と「初診か再診か」は続けて読むものなので同じ列に積む */}
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap"
                                style={
                                  c.visit_type === "pickup"
                                    ? { background: "#DFF5F3", color: "#0F8B8D" }
                                    : { background: "#FCE9EA", color: "#D64550" }
                                }
                              >
                                {c.visit_type === "pickup" ? <PackageCheck size={12} /> : <Stethoscope size={12} />}
                                {c.visit_type === "pickup" ? "薬のみ" : "診察"}
                              </span>
                              {c.visit_type === "consult" && (
                                <div className="text-xs mt-1"><VisitKindTag c={c} /></div>
                              )}
                              {/* 予約なしの診察で「予約の方優先」の同意画面を通った印。
                                  待ち時間の説明済みであることが受付で分かる */}
                              {c.visit_type === "consult" && !c.booking_id && c.priority_agreed_at && (
                                <span
                                  className="mt-1 inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold whitespace-nowrap"
                                  style={{ background: "#FDF3E3", color: "#B07A28" }}
                                  title={`予約の方優先に ${hhmm(c.priority_agreed_at)} に同意済み`}
                                >
                                  予約優先 同意済
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-3 text-xs" style={{ color: "#8A7378" }}>
                              {/* アフターピルは薬名を並べるより MAP のタグで出す。
                                  再診は受付で日付を、初診は問診票で日時を聞いている */}
                              {meds.length > 0 && <div>{meds.join("、")}</div>}
                              {reasonBadges.length > 0 && (
                                <div className="flex flex-col items-start gap-1">
                                  {reasonBadges.map((b, i) => (
                                    <ReasonBadge key={i} badge={b} />
                                  ))}
                                </div>
                              )}
                              {!meds.length && !reasonBadges.length && !map && !wants.length && "—"}
                              {map && <MapTag date={map.date} timing={map.timing} />}
                              {wants.length > 0 && (
                                <div className="flex flex-col items-start gap-1 mt-1">
                                  {wants.map((w) => (
                                    <span
                                      key={w}
                                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold whitespace-nowrap"
                                      style={{ background: "#FDF3E7", color: "#C0762C" }}
                                      title="飲み方ガイドのボタンから追加された希望です（問診票の回答にも同じ行が入っています）"
                                    >
                                      {w}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-3 text-xs">
                              <InsuranceTag id={c.insurance} />
                            </td>
                            <td className="px-2 py-3">
                              <div className="flex items-center gap-1">
                                <ChartNumberInput
                                  value={c.chart_number || anyForm?.chart_number || ""}
                                  width={76}
                                  onSave={(v) => saveChartNumber({ checkinIds: [c.id], formIds: [anyForm?.id], value: v })}
                                />
                                {/* 番号が付いていれば、その方の過去の問診票をまとめて見られる */}
                                {(c.chart_number || anyForm?.chart_number) && (
                                  <button
                                    onClick={() => showHistory(c.chart_number || anyForm.chart_number)}
                                    title="この方の過去の問診票を見る"
                                    className="inline-flex items-center justify-center p-1 rounded-lg active:opacity-70"
                                    style={{ color: "#0F8B8D" }}
                                  >
                                    <Search size={13} />
                                  </button>
                                )}
                              </div>
                              {pastChart && (
                                // 前回までの記録から自動で引いた番号。タップでこの受付にも入る
                                <button
                                  onClick={() => saveChartNumber({ checkinIds: [c.id], formIds: [anyForm?.id], value: pastChart })}
                                  title="前回までの受付・問診票に入っていた番号です。タップで今回の受付にも入ります"
                                  className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold active:opacity-70 whitespace-nowrap"
                                  style={{ background: "#DFF5F3", color: "#0F8B8D", fontFamily: "'JetBrains Mono', monospace" }}
                                >
                                  前回 {pastChart}
                                </button>
                              )}
                            </td>
                            <td className="px-2 py-3">
                              {c.visit_type === "consult" ? (
                                f ? (
                                  <div className="flex flex-col items-start gap-0.5">
                                    <button
                                      onClick={() => setSelectedForm(f)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium active:opacity-70"
                                      style={{ background: "#0F8B8D", color: "#FFFFFF" }}
                                    >
                                      <FileText size={12} />
                                      表示
                                    </button>
                                    {/* QR経由（受付IDが一致）でない問診票は名前の一致だけで
                                        推測表示しているので、本人のものと断定できない */}
                                    {f.checkin_id !== c.id && (
                                      <span className="text-[10px] leading-tight" style={{ color: "#C0762C" }}>
                                        名前一致・未確認
                                      </span>
                                    )}
                                    <GuideReadTag read={f.guide_read} total={f.guide_total} expected={Array.isArray(f.guide_keys) && f.guide_keys.length > 0} />
                                    {emailFromIntakeAnswers(f) && (
                                      <button
                                        onClick={() => sendGuideMail(f.id, emailFromIntakeAnswers(f), f.guide_keys || [], "ja")}
                                        disabled={guideMailing === f.id}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium active:opacity-70"
                                        style={{ background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#8A7378", opacity: guideMailing === f.id ? 0.5 : 1 }}
                                      >
                                        <Mail size={11} />
                                        {guideMailing === f.id ? "送信中..." : f.guide_mail_sent_at ? "ガイドを再送" : "ガイドをメール送信"}
                                      </button>
                                    )}
                                  </div>
                                ) : intakeUrlForCheckin(c) ? (
                                  // 紙の受付票が無いので、リンクを見失った患者さんには
                                  // このQRを見せて読み直してもらう。
                                  // 問診票は最後の送信まで届かないので、何問目まで
                                  // 進んでいるかをここに出して「書いている / 止まっている」
                                  // を見分けられるようにする
                                  <div className="flex flex-col items-start gap-0.5">
                                    <button
                                      onClick={() => setQrFor(c)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium active:opacity-70"
                                      style={{ background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#8A7378" }}
                                    >
                                      <QrCode size={12} />
                                      未提出・QR
                                    </button>
                                    <IntakeProgress checkin={c} />
                                  </div>
                                ) : (
                                  <span className="text-xs" style={{ color: "#C9AEB3" }}>未提出</span>
                                )
                              ) : (
                                <span className="text-xs" style={{ color: "#C9AEB3" }}>—</span>
                              )}
                            </td>
                            <td className="px-2 py-3">
                              {/* カルテ済/会計済の独立トグル。押すたびに済⇔未でオンオフ。
                                  横に並べると列が2倍近く広がるので縦に積む */}
                              <div className="flex items-start gap-1.5">
                              <div className="flex flex-col gap-1">
                                <button
                                  onClick={() => toggleFlag(c, "chart_done")}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium active:opacity-70 whitespace-nowrap"
                                  style={
                                    c.chart_done
                                      ? { background: "#0F8B8D", border: "1px solid #0F8B8D", color: "#FFFFFF" }
                                      : { background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#8A7378" }
                                  }
                                >
                                  {/* オフのときも透明のまま描画して、チェックの分だけ幅がズレるのを防ぐ */}
                                  <CheckCircle2 size={12} style={{ visibility: c.chart_done ? "visible" : "hidden" }} />
                                  カルテ済
                                </button>
                                <button
                                  onClick={() => toggleFlag(c, "payment_done")}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium active:opacity-70 whitespace-nowrap"
                                  style={
                                    c.payment_done
                                      ? { background: "#0F8B8D", border: "1px solid #0F8B8D", color: "#FFFFFF" }
                                      : { background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#8A7378" }
                                  }
                                >
                                  <CheckCircle2 size={12} style={{ visibility: c.payment_done ? "visible" : "hidden" }} />
                                  会計済
                                </button>
                                </div>
                                {/* 押し間違い・別人の受付・動作確認の後始末。
                                    予約は「予約中」に戻り、問診票は残る */}
                                <button
                                  onClick={() => cancelCheckin(c)}
                                  disabled={cancelling === c.id}
                                  title="この受付を取り消す"
                                  className="inline-flex items-center justify-center p-1 rounded-lg active:opacity-70"
                                  style={{ color: "#C9AEB3", opacity: cancelling === c.id ? 0.4 : 1 }}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* 問診票リスト */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
              {isToday ? "本日の問診票" : `${dateKey} の問診票`}
            </h2>
            {forms.length === 0 ? (
              <p className="text-sm" style={{ color: "#B08A90" }}>
                {isToday ? "まだ問診票の提出はありません。" : "この日の問診票はありません。"}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {forms.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl"
                    style={{ background: "#FFFFFF", border: "1px solid #F2DFE4" }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <FileText size={18} color="#0F8B8D" className="shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate flex items-center gap-2" style={{ color: "#3A2E30" }}>
                          {f.patient_name}
                          {!f.checkin_id && (
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
                              style={{ background: "#FBEEDB", color: "#C0762C" }}
                            >
                              QR未経由・未確認
                            </span>
                          )}
                        </div>
                        <div className="text-xs" style={{ color: "#B08A90" }}>
                          {hhmm(f.created_at)} 受信{f.date_of_birth ? `　生年月日 ${f.date_of_birth}` : ""}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => setSelectedForm(f)}
                      className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium active:opacity-70"
                      style={{ background: "#0F8B8D", color: "#FFFFFF" }}
                    >
                      <FileText size={13} />
                      表示・印刷
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
          </>
          )}

          {tab === "settings" && (
            /* メニュー / 診療時間・枠 / 休診設定（booking-app から移植） */
            <section>
              <h2 className="text-lg font-bold mb-4" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
                設定
              </h2>
              <SettingsTabs />
            </section>
          )}
        </main>

        {/* 予約の保存など、成功メッセージの一時表示 */}
        {notice && (
          <div
            className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg z-50"
            style={{ background: "#3A2E30", color: "#FFFFFF" }}
          >
            {notice}
          </div>
        )}

        {/* 代理受付モーダル（スマホをお持ちでない患者さんの分をスタッフが入れる） */}
        {proxy && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
            style={{ background: "rgba(58,46,48,0.5)" }}
            onClick={() => !proxyBusy && setProxy(null)}
          >
            <div
              className="w-full max-w-md rounded-2xl overflow-hidden"
              style={{ background: "#FFFFFF" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #F2DFE4" }}>
                <div className="text-base font-bold" style={{ color: "#3A2E30" }}>代理で受付</div>
                <button
                  onClick={() => setProxy(null)}
                  className="p-2 rounded-xl active:opacity-70"
                  style={{ background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#8A7378" }}
                >
                  <X size={16} />
                </button>
              </div>

              <div className="p-5 flex flex-col gap-4">
                <label className="block">
                  <span className="block text-xs font-medium mb-1" style={{ color: "#8A7378" }}>お名前 *</span>
                  <input
                    type="text"
                    autoFocus
                    value={proxy.name}
                    onChange={(e) => setProxy({ ...proxy, name: e.target.value })}
                    className="w-full p-2.5 rounded-lg text-sm outline-none"
                    style={{ background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#3A2E30" }}
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-medium mb-1" style={{ color: "#8A7378" }}>生年月日</span>
                  <input
                    type="date"
                    value={proxy.dob}
                    onChange={(e) => setProxy({ ...proxy, dob: e.target.value })}
                    className="w-full p-2.5 rounded-lg text-sm outline-none"
                    style={{ background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#3A2E30" }}
                  />
                </label>

                <div>
                  <div className="text-xs font-medium mb-1.5" style={{ color: "#8A7378" }}>ご用件</div>
                  <div className="flex gap-2">
                    {/* 一覧のバッジと同じ言葉にする（「薬受け取り」だと別物に見える） */}
                    {[["consult", "診察"], ["pickup", "薬のみ"]].map(([id, label]) => (
                      <button
                        key={id}
                        onClick={() => setProxy({ ...proxy, visitType: id })}
                        className="flex-1 px-3 py-2 rounded-lg text-sm font-medium"
                        style={
                          proxy.visitType === id
                            ? { background: "#0F8B8D", color: "#FFFFFF" }
                            : { background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#8A7378" }
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {proxy.visitType === "consult" && (
                  <>
                    <div>
                      <div className="text-xs font-medium mb-1.5" style={{ color: "#8A7378" }}>区分</div>
                      <div className="flex gap-2">
                        {[["first", "初診"], ["return", "再診"]].map(([id, label]) => (
                          <button
                            key={id}
                            onClick={() => setProxy({ ...proxy, visitKind: id })}
                            className="flex-1 px-3 py-2 rounded-lg text-sm font-medium"
                            style={
                              proxy.visitKind === id
                                ? { background: "#0F8B8D", color: "#FFFFFF" }
                                : { background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#8A7378" }
                            }
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {proxy.visitKind === "return" && (
                      <div>
                        <div className="text-xs font-medium mb-1.5" style={{ color: "#8A7378" }}>再診の内容</div>
                        <div className="flex gap-2">
                          {Object.entries(RETURN_REASON_LABEL).map(([id, label]) => (
                            <button
                              key={id}
                              onClick={() => setProxy({ ...proxy, returnReason: id })}
                              className="flex-1 px-2 py-2 rounded-lg text-xs font-medium"
                              style={
                                proxy.returnReason === id
                                  ? { background: "#0F8B8D", color: "#FFFFFF" }
                                  : { background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#8A7378" }
                              }
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                <div>
                  <div className="text-xs font-medium mb-1.5" style={{ color: "#8A7378" }}>保険（任意）</div>
                  {/* 5択になって「自費（海外保険）」が入らないので折り返す */}
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(INSURANCE_LABEL).map(([id, label]) => (
                      <button
                        key={id}
                        onClick={() => setProxy({ ...proxy, insurance: proxy.insurance === id ? "" : id })}
                        className="px-3 py-2 rounded-lg text-xs font-medium"
                        style={
                          proxy.insurance === id
                            ? { background: "#0F8B8D", color: "#FFFFFF" }
                            : { background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#8A7378" }
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {proxyError && (
                  <div className="p-3 rounded-lg text-xs" style={{ background: "#FCE9EA", color: "#B03A44" }}>
                    受付できませんでした: {proxyError}
                  </div>
                )}

                <button
                  onClick={submitProxy}
                  disabled={!proxy.name.trim() || proxyBusy}
                  className="w-full px-4 py-3 rounded-xl text-sm font-bold active:opacity-70"
                  style={{
                    background: "#0F8B8D",
                    color: "#FFFFFF",
                    opacity: !proxy.name.trim() || proxyBusy ? 0.4 : 1,
                  }}
                >
                  {proxyBusy ? "受付しています..." : "この内容で受付する"}
                </button>
                <p className="text-[11px] leading-relaxed" style={{ color: "#B08A90" }}>
                  当日のネット・LINE予約があれば自動で紐付きます。受付番号はサーバー側で採番されます。
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 問診票QRモーダル（患者さんにこの画面を見せて読み取ってもらう） */}
        {qrFor && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
            style={{ background: "rgba(58,46,48,0.5)" }}
            onClick={() => setQrFor(null)}
          >
            <div
              className="w-full max-w-sm rounded-2xl overflow-hidden text-center"
              style={{ background: "#FFFFFF" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #F2DFE4" }}>
                <div className="text-left">
                  <div className="text-base font-bold" style={{ color: "#3A2E30" }}>問診票のQR</div>
                  <div className="text-xs" style={{ color: "#B08A90" }}>
                    {qrFor.checkin_number}　{qrFor.patient_name}
                  </div>
                </div>
                <button
                  onClick={() => setQrFor(null)}
                  className="p-2 rounded-xl active:opacity-70"
                  style={{ background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#8A7378" }}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="p-6 flex flex-col items-center gap-4">
                <QrImage url={intakeUrlForCheckin(qrFor)} />
                <p className="text-xs leading-relaxed" style={{ color: "#8A7378" }}>
                  患者さんのスマホでこのQRを読み取っていただくと、この受付に紐付いた問診票が開きます。
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 問診票モーダル */}
        {selectedForm && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
            style={{ background: "rgba(58,46,48,0.5)" }}
            onClick={() => setSelectedForm(null)}
          >
            <div
              className="w-full max-w-2xl max-h-[85vh] rounded-2xl flex flex-col overflow-hidden"
              style={{ background: "#FFFFFF" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #F2DFE4" }}>
                <div>
                  <div className="text-base font-bold" style={{ color: "#3A2E30" }}>
                    問診票　{selectedForm.patient_name}
                  </div>
                  <div className="text-xs" style={{ color: "#B08A90" }}>
                    {(() => { const r = reserveLabelForForm(selectedForm); return r ? <span style={{ color: "#0F8B8D", fontWeight: 700 }}>予約 {r}　</span> : null; })()}
                    {String(selectedForm.created_at).slice(0, 10)} {hhmm(selectedForm.created_at)} 受信
                    {selectedForm.date_of_birth ? `　生年月日 ${selectedForm.date_of_birth}` : ""}
                    {!selectedForm.checkin_id && (
                      <span style={{ color: "#C0762C" }}>　※QR未経由の送信（名前照合のみ・未確認）</span>
                    )}
                  </div>
                  {/* 読みながらそのまま番号を入れられるようにする。印刷にも載る */}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-xs" style={{ color: "#8A7378" }}>カルテ番号</span>
                    <ChartNumberInput
                      value={selectedForm.chart_number || ""}
                      width={110}
                      onSave={(v) => saveChartNumber({ checkinIds: [selectedForm.checkin_id], formIds: [selectedForm.id], value: v })}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handlePrint}
                    disabled={printing}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium active:opacity-70"
                    style={{ background: "#0F8B8D", color: "#FFFFFF", opacity: printing ? 0.5 : 1 }}
                  >
                    <Printer size={15} />
                    {printing ? "PDF作成中..." : "印刷"}
                  </button>
                  <button
                    onClick={() => setSelectedForm(null)}
                    className="p-2 rounded-xl active:opacity-70"
                    style={{ background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#8A7378" }}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
              <div className="overflow-y-auto p-5">
                <table className="w-full text-sm" style={{ color: "#3A2E30" }}>
                  <tbody>
                    {(selectedForm.answers || []).map((row, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #FAEEF0" }}>
                        <td className="py-2 pr-4 align-top text-xs" style={{ color: "#8A7378", width: "45%" }}>{row.label}</td>
                        <td className="py-2 align-top font-medium">{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {selectedMonshin && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
            style={{ background: "rgba(58,46,48,0.5)" }}
            onClick={() => setSelectedMonshin(null)}
          >
            <div
              className="w-full max-w-2xl max-h-[85vh] rounded-2xl flex flex-col overflow-hidden"
              style={{ background: "#FFFFFF" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #F2DFE4" }}>
                <div>
                  <div className="text-base font-bold" style={{ color: "#3A2E30" }}>
                    問診票（{selectedMonshin.source === "zoom" ? "Zoom診療・英語" : "オンライン診療"}）　{selectedMonshin.name}
                  </div>
                  <div className="text-xs" style={{ color: "#B08A90" }}>
                    {selectedMonshin.reserve_at ? `予約 ${String(selectedMonshin.reserve_at).slice(0, 10)} ${hhmm(selectedMonshin.reserve_at)}${selectedMonshin.reserve_canceled ? "（キャンセル済）" : ""}　` : ""}
                    記入 {String(selectedMonshin.created_at).slice(0, 10)} {hhmm(selectedMonshin.created_at)}
                    {selectedMonshin.dob ? `　生年月日 ${selectedMonshin.dob}` : ""}
                    {selectedMonshin.phone ? `　電話 ${fmtPhoneDisp(selectedMonshin.phone)}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={printSelectedMonshin}
                    disabled={monshinPrinting}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium active:opacity-70"
                    style={{ background: "#0F8B8D", color: "#FFFFFF", opacity: monshinPrinting ? 0.5 : 1 }}
                  >
                    <Printer size={15} />
                    {monshinPrinting ? "PDF作成中..." : "印刷"}
                  </button>
                  <button
                    onClick={() => setSelectedMonshin(null)}
                    className="p-2 rounded-xl active:opacity-70"
                    style={{ background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#8A7378" }}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
              <div className="overflow-y-auto p-5">
                {(selectedMonshin.answers || []).some((a) => a.flag) && (
                  <div className="mb-3 p-3 rounded-xl" style={{ background: "#FCE9EA", color: "#B03A44" }}>
                    <div className="text-xs font-bold mb-1">⚠ 要注意</div>
                    <ul className="text-xs" style={{ paddingLeft: 16, listStyleType: "disc" }}>
                      {(selectedMonshin.answers || []).filter((a) => a.flag).map((a, i) => (
                        <li key={i}>{a.q_ja} — <b>{a.a_ja}</b></li>
                      ))}
                    </ul>
                  </div>
                )}
                <table className="w-full text-sm" style={{ color: "#3A2E30" }}>
                  <tbody>
                    {(selectedMonshin.answers || []).map((row, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #FAEEF0" }}>
                        <td className="py-2 pr-4 align-top text-xs" style={{ color: "#8A7378", width: "45%" }}>{row.q_ja}</td>
                        <td className="py-2 align-top font-medium" style={{ color: row.flag ? "#B03A44" : "#3A2E30" }}>{row.a_ja}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {selectedMonshin.free_text && (
                  <div className="mt-3">
                    <div className="text-xs font-bold mb-1" style={{ color: "#8A7378" }}>自由記入</div>
                    <div className="text-sm whitespace-pre-wrap">{selectedMonshin.free_text}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* PDF化用レイアウト（画面外に隠しておき、印刷時だけ画像化する）。
          A4・1枚に収まるよう回答を左右2段に分けて高さを抑える */}
      {selectedForm && (
        <div
          ref={printAreaRef}
          style={{
            display: "none",
            position: "fixed",
            left: "-10000px",
            top: 0,
            width: 1120,
            background: "#FFFFFF",
            padding: 28,
            color: "#000000",
            fontFamily: "'Noto Sans JP', sans-serif",
            // iPadの画面より広い箱なので、Safariが読みやすさのために文字を
            // 勝手に大きくする。そのぶん行が折り返して別のPDFになるため止める
            WebkitTextSizeAdjust: "100%",
            textSizeAdjust: "100%",
          }}
        >
          {/* 区分と時間の特大見出し（紙の仕分け用） */}
          {(() => {
            const h = printHeadlineForForm(selectedForm);
            return h ? <div style={{ fontSize: 46, fontWeight: 800, lineHeight: 1.1, marginBottom: 8 }}>{h}</div> : null;
          })()}
          <div style={{ borderBottom: "2px solid #000000", paddingBottom: 8, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            {(() => {
              // 紙を見た医師がすぐ掴めるように、生年月日のとなりに和暦と満年齢を出す
              const dob = formBirthdate(selectedForm);
              const extra = dobAnnotation(dob);
              const paren = dob ? `（${dob}${extra ? `　${extra}` : ""}）` : "";
              const reserveLabel = reserveLabelForForm(selectedForm);
              return (
                <>
                  <div>
                    <strong style={{ fontSize: 20 }}>問診票 ／ Questionnaire</strong>
                    <div style={{ fontSize: 14, marginTop: 4 }}>
                      {/* 紙はカルテに綴じるので、番号が入っていれば先頭に出す */}
                      {selectedForm.chart_number ? <strong>カルテ {selectedForm.chart_number}　</strong> : null}
                      {selectedForm.patient_name}
                      {paren}
                    </div>
                  </div>
                  {/* 予約時間は右上 */}
                  {reserveLabel ? (
                    <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", textAlign: "right" }}>
                      予約 {reserveLabel}
                    </div>
                  ) : null}
                </>
              );
            })()}
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            {(() => {
              const rows = selectedForm.answers || [];
              const half = Math.ceil(rows.length / 2);
              return [rows.slice(0, half), rows.slice(half)].map((col, ci) => (
                <table key={ci} style={{ width: "50%", borderCollapse: "collapse", fontSize: 13 }}>
                  <tbody>
                    {col.map((row, i) => {
                      // 生年月日の行には和暦と満年齢を添える（保険証・カルテとの突き合わせ用）
                      const isDob = /生年月日|date of birth/i.test(row.label || "");
                      const extra = isDob ? dobAnnotation(row.value) : "";
                      return (
                        <tr key={i}>
                          <td style={{ border: "1px solid #999999", padding: "4px 7px", width: "48%", color: "#333333" }}>{row.label}</td>
                          <td style={{ border: "1px solid #999999", padding: "4px 7px", fontWeight: 600 }}>
                            {row.value}{extra ? `（${extra}）` : ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ));
            })()}
          </div>
          {/* 受信日時は右下 */}
          <div style={{ marginTop: 14, textAlign: "right", fontSize: 12, color: "#333333" }}>
            {selectedForm.date_key} {hhmm(selectedForm.created_at)} 受信
          </div>
        </div>
      )}

      {/* オンライン診療の問診票 印刷レイアウト（画面外・個別1枚） */}
      {selectedMonshin && (
        <div ref={monshinPrintRef} style={{ display: "none", position: "fixed", left: "-10000px", top: 0 }}>
          <MonshinPrintSheet row={selectedMonshin} />
        </div>
      )}

      {/* オンライン診療の問診票 印刷レイアウト（画面外・当日分の一括／1人1枚）。
          親を display:none にすると html2canvas が寸法を取れず白紙になるため、
          親は画面外に置くだけにして、各シートを display:none で隠す。
          printElementsAsPdf が1枚ずつ block に戻して画像化する。 */}
      {tab === "pillorder" && monshinPrintRows.length > 0 && (
        <div ref={monshinBatchRef} style={{ position: "fixed", left: "-10000px", top: 0, width: 1120 }}>
          {monshinPrintRows.map((m) => (
            <div className="monshin-batch-sheet" style={{ display: "none" }} key={m.id}>
              <MonshinPrintSheet row={m} />
            </div>
          ))}
        </div>
      )}

      {/* Zoom診療（英語）の問診票 一括印刷レイアウト（画面外・pillorder分と同じ方式） */}
      {tab === "zoom" && zoomPrintRows.length > 0 && (
        <div ref={zoomBatchRef} style={{ position: "fixed", left: "-10000px", top: 0, width: 1120 }}>
          {zoomPrintRows.map((m) => (
            <div className="monshin-batch-sheet" style={{ display: "none" }} key={m.id}>
              <MonshinPrintSheet row={m} />
            </div>
          ))}
        </div>
      )}

      {/* 1日の予定表 印刷レイアウト（画面外・時刻順／A4 1枚に入る枠数ずつ）。
          問診票の一括印刷と同じで、親は画面外に置くだけにして各ページを display:none で隠す */}
      {schedulePages.length > 0 && (
        <div ref={scheduleRef} style={{ position: "fixed", left: "-10000px", top: 0, width: SCHEDULE_SHEET_W }}>
          {schedulePages.map((rows, i) => (
            <div className="schedule-sheet" style={{ display: "none" }} key={i}>
              <ScheduleSheet
                rows={rows}
                dateKey={dateKey}
                page={i + 1}
                pageCount={schedulePages.length}
                visitCount={scheduleCounts.visit}
                onlineCount={scheduleCounts.online}
                note={scheduleGrid.fromSettings ? "" : scheduleGrid.closedDay ? "休診日" : "来院の枠設定なし"}
                mode={scheduleLayout.mode}
              />
            </div>
          ))}
        </div>
      )}

      {/* 来院受付の問診票 印刷レイアウト（画面外・当日分の一括／1人1枚）。
          「まとめて印刷」でオンライン分に続けて出す。 */}
      {tab === "pillorder" && dayIntakeForms.length > 0 && (
        <div ref={intakeBatchRef} style={{ position: "fixed", left: "-10000px", top: 0, width: 1120 }}>
          {dayIntakeForms.map((f) => (
            <div className="intake-batch-sheet" style={{ display: "none" }} key={f.id}>
              <IntakePrintSheet form={f} reserveLabel={reserveLabelForForm(f)} headline={printHeadlineForForm(f)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
