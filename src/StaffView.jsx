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
  ExternalLink,
  CalendarDays,
  CalendarCheck,
  UserPlus,
  QrCode,
  Trash2,
  Search,
} from "lucide-react";
import { supabase } from "./supabase.js";
import { guessKana } from "./kana.js";

const FONT_IMPORT = `
@import url('https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700&family=Noto+Sans+JP:wght@400;500;700&family=JetBrains+Mono:wght@500;600&display=swap');
`;

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
  };

  useEffect(() => {
    load();
    // 自動更新は増える可能性のある日だけ: 受付タブは今日、予約タブは今日以降。
    // 患者を探すタブは日付と関係ないので更新しない（入力中に画面が動くのを防ぐ）
    const canGrow = tab === "search" ? false : tab === "bookings" ? dateKey >= todayKey() : isToday;
    if (!canGrow) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [dateKey, tab]);

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
        <header className="flex items-center justify-between px-6 py-4 flex-wrap gap-3" style={{ borderBottom: "1px solid #F2DFE4", background: "#FFFFFF" }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#0F8B8D" }}>
              <ClipboardList size={20} color="#DFF5F3" />
            </div>
            <div>
              <div className="text-base font-bold" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
                受付一覧（スタッフ用）
              </div>
              <div className="text-xs" style={{ color: "#B08A90" }}>
                {tab === "search"
                  ? "過去の問診票を呼び出す"
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
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm"
              style={{ background: "#FFF8F7", border: "1.5px solid #F2DFE4", color: "#3A2E30", display: tab === "search" ? "none" : undefined }}
            >
              <CalendarDays size={15} color="#B08A90" />
              <input
                type="date"
                value={dateKey}
                // 受付は過去分のみだが、予約は未来の日付も見られる
                max={tab === "bookings" ? undefined : todayKey()}
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
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium cursor-pointer select-none"
                  style={{ background: "#FFF8F7", border: "1.5px solid #F2DFE4", color: "#8A7378" }}
                >
                  <input type="checkbox" checked={hideChartDone} onChange={toggleHideChartDone} className="w-4 h-4" />
                  カルテ済を隠す{chartDoneCount > 0 && `（${chartDoneCount}件）`}
                </label>
                <label
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium cursor-pointer select-none"
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
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium active:opacity-70"
                style={{ background: "#FFFFFF", border: "1.5px solid #0F8B8D", color: "#0F8B8D" }}
              >
                <UserPlus size={15} />
                代理で受付
              </button>
            )}
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); window.location.hash = ""; }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium"
              style={{ background: "#FFF8F7", border: "1.5px solid #F2DFE4", color: "#8A7378", textDecoration: "none" }}
            >
              <ExternalLink size={15} />
              受付機画面へ
            </a>
            <button
              onClick={load}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium active:opacity-70"
              style={{ background: "#0F8B8D", color: "#FFFFFF" }}
            >
              <RefreshCw size={15} />
              更新
            </button>
          </div>
        </header>

        {/* タブ切り替え: 受付一覧 / 予約状況 */}
        {/* 幅は画面いっぱいまで使う。1024pxで頭打ちにしていたので、
            列がそろわず横スクロールになっていた（iPadは横向きで1024px） */}
        <div className="px-3 sm:px-6 pt-4 max-w-[1500px] mx-auto w-full">
          <div className="inline-flex rounded-xl overflow-hidden" style={{ border: "1.5px solid #F2DFE4", background: "#FFFFFF" }}>
            {[
              { id: "checkins", label: "受付一覧", Icon: ClipboardList },
              { id: "bookings", label: "予約状況", Icon: CalendarCheck },
              { id: "search", label: "患者を探す", Icon: Search },
            ].map(({ id, label, Icon }) => (
              <button
                key={id}
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
              <a
                href="https://keicuri-booking.vercel.app/staff"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium"
                style={{ background: "#FFF8F7", border: "1.5px solid #F2DFE4", color: "#8A7378", textDecoration: "none" }}
              >
                <ExternalLink size={13} />
                予約の編集・代理予約（予約管理画面）
              </a>
            </div>
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
                            </td>
                            <td className="px-2 py-3">
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap"
                                style={
                                  isPickup
                                    ? { background: "#DFF5F3", color: "#0F8B8D" }
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
                                <button
                                  onClick={() => setSelectedForm(bf)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium active:opacity-70"
                                  style={{ background: "#0F8B8D", color: "#FFFFFF" }}
                                >
                                  <FileText size={12} />
                                  表示
                                </button>
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
                        <th className="px-2 py-2.5 font-medium">お薬</th>
                        <th className="px-2 py-2.5 font-medium">保険</th>
                        {/* 電子カルテとは繋がっていないので、番号は人が見て入れる */}
                        <th className="px-2 py-2.5 font-medium">カルテ</th>
                        <th className="px-2 py-2.5 font-medium">問診票</th>
                        <th className="px-2 py-2.5 font-medium">状態</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleCheckins.map((c) => {
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
                        const booking = bookingById.get(c.booking_id);
                        const kana = kanaFor(c, anyForm, booking);
                        const isDone = c.chart_done && c.payment_done;
                        // 予約の方は呼ぶ順番の判断が変わる（飛び込みより予約時間が優先）。
                        // 受付時刻が予約時間を過ぎていれば遅れて来られた方なので、そこも分かるようにする
                        const bookedAt = booking?.time ? String(booking.time).slice(0, 5) : null;
                        const late = bookedAt && hhmm(c.created_at) > bookedAt;
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
                              <div className="font-medium">{c.patient_name}</div>
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
                            </td>
                            <td className="px-2 py-3 text-xs" style={{ color: "#8A7378" }}>
                              {/* アフターピルは薬名を並べるより MAP のタグで出す。
                                  再診は受付で日付を、初診は問診票で日時を聞いている */}
                              {meds.join("、") || (map ? "" : "—")}
                              {map && <MapTag date={map.date} timing={map.timing} />}
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
        </main>

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
          <div style={{ borderBottom: "2px solid #000000", paddingBottom: 8, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <strong style={{ fontSize: 20 }}>問診票 ／ Questionnaire</strong>
            {(() => {
              // 紙を見た医師がすぐ年齢を掴めるように、生年月日のとなりに満年齢を出す
              const dob = formBirthdate(selectedForm);
              const age = ageFrom(dob);
              const paren = dob ? `（${dob}${age === null ? "" : `・${age}歳`}）` : "";
              return (
                <span style={{ fontSize: 14 }}>
                  {/* 紙はカルテに綴じるので、番号が入っていれば先頭に出す */}
                  {selectedForm.chart_number ? <strong>カルテ {selectedForm.chart_number}　</strong> : null}
                  {selectedForm.patient_name}
                  {paren}　{selectedForm.date_key} {hhmm(selectedForm.created_at)} 受信
                </span>
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
                    {col.map((row, i) => (
                      <tr key={i}>
                        <td style={{ border: "1px solid #999999", padding: "4px 7px", width: "48%", color: "#333333" }}>{row.label}</td>
                        <td style={{ border: "1px solid #999999", padding: "4px 7px", fontWeight: 600 }}>{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ));
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
