import React, { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import { supabase } from "./supabase.js";

const FONT_IMPORT = `
@import url('https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700&family=Noto+Sans+JP:wght@400;500;700&family=JetBrains+Mono:wght@500;600&display=swap');
`;

// 印刷は「レイアウト用の隠しDOM → 画像化 → A4のPDF → 印刷ダイアログ」の流れ。
// PDFはダウンロードせず、非表示iframeに読み込んで印刷ダイアログだけを開く
// （スタッフはそこで印刷するか、必要ならPDF保存を選べる）。
async function printElementAsPdf(el) {
  el.style.display = "block";
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

const INSURANCE_LABEL = { mynumber: "マイナ保険証", hokensho: "保険証", self_pay: "自費" };
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

// 診察の区分表示（初診 / 再診・○○）
function visitKindLabel(c) {
  if (c.visit_type !== "consult") return "—";
  if (c.visit_kind === "first") return "初診";
  if (c.visit_kind === "return") return `再診・${RETURN_REASON_LABEL[c.return_reason] || ""}`;
  return "—";
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
  // 問診票のQRを見せる対象の受付行
  const [qrFor, setQrFor] = useState(null);

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
    setPrinting(true);
    try {
      await printElementAsPdf(printAreaRef.current);
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
    // 自動更新は増える可能性のある日だけ: 受付タブは今日、予約タブは今日以降
    const canGrow = tab === "bookings" ? dateKey >= todayKey() : isToday;
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
  const visibleCheckins = checkins.filter(
    (c) => !(hideChartDone && c.chart_done) && !(hidePaymentDone && c.payment_done)
  );

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
                {tab === "bookings"
                  ? `${dateKey} の予約 ${bookings.filter((b) => b.status !== "cancelled").length}件　`
                  : isToday
                    ? `待ち ${waiting.length}件　`
                    : `${dateKey} の記録（過去分）　`}
                {lastUpdated && `最終更新 ${hhmm(lastUpdated.toISOString())}`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* 表示日の切り替え（過去分も同じ画面で見られる） */}
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm"
              style={{ background: "#FFF8F7", border: "1.5px solid #F2DFE4", color: "#3A2E30" }}
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
        <div className="px-6 pt-4 max-w-5xl mx-auto w-full">
          <div className="inline-flex rounded-xl overflow-hidden" style={{ border: "1.5px solid #F2DFE4", background: "#FFFFFF" }}>
            {[
              { id: "checkins", label: "受付一覧", Icon: ClipboardList },
              { id: "bookings", label: "予約状況", Icon: CalendarCheck },
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

        <main className="p-6 flex flex-col gap-8 max-w-5xl mx-auto">
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
                  <table className="w-full text-sm" style={{ color: "#3A2E30", minWidth: 920 }}>
                    <thead>
                      <tr className="text-left text-xs" style={{ color: "#B08A90", background: "#FFF8F7" }}>
                        <th className="px-4 py-2.5 font-medium">時間</th>
                        <th className="px-3 py-2.5 font-medium">お名前</th>
                        <th className="px-3 py-2.5 font-medium">メニュー</th>
                        <th className="px-3 py-2.5 font-medium">内容</th>
                        <th className="px-3 py-2.5 font-medium">保険</th>
                        <th className="px-3 py-2.5 font-medium">生年月日</th>
                        <th className="px-3 py-2.5 font-medium">電話</th>
                        <th className="px-3 py-2.5 font-medium">経路</th>
                        <th className="px-3 py-2.5 font-medium">問診票</th>
                        <th className="px-3 py-2.5 font-medium">状態</th>
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
                            <td className="px-4 py-3 font-bold" style={{ color: "#0F8B8D", fontFamily: "'JetBrains Mono', monospace" }}>
                              {b.time}
                            </td>
                            <td className="px-3 py-3 font-medium">
                              {b.patient_name}
                              {b.patient_kana && (
                                <span className="block text-xs font-normal" style={{ color: "#B08A90" }}>{b.patient_kana}</span>
                              )}
                            </td>
                            <td className="px-3 py-3">
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
                            <td className="px-3 py-3 text-xs" style={{ color: "#8A7378", maxWidth: 220 }}>{bookingDetail(b)}</td>
                            <td className="px-3 py-3 text-xs">{INSURANCE_LABEL[b.insurance] || "—"}</td>
                            <td className="px-3 py-3 text-xs" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{b.birthdate || "—"}</td>
                            <td className="px-3 py-3 text-xs" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{b.phone || "—"}</td>
                            <td className="px-3 py-3 text-xs">{CHANNEL_LABEL[b.channel] || b.channel}</td>
                            <td className="px-3 py-3">
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
                            <td className="px-3 py-3">
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
                  <table className="w-full text-sm" style={{ color: "#3A2E30", minWidth: 920 }}>
                    <thead>
                      <tr className="text-left text-xs" style={{ color: "#B08A90", background: "#FFF8F7" }}>
                        <th className="px-4 py-2.5 font-medium">番号</th>
                        <th className="px-3 py-2.5 font-medium">時刻</th>
                        <th className="px-3 py-2.5 font-medium">お名前</th>
                        <th className="px-3 py-2.5 font-medium">種別</th>
                        <th className="px-3 py-2.5 font-medium">区分</th>
                        <th className="px-3 py-2.5 font-medium">お薬</th>
                        <th className="px-3 py-2.5 font-medium">保険</th>
                        <th className="px-3 py-2.5 font-medium">生年月日</th>
                        <th className="px-3 py-2.5 font-medium">問診票</th>
                        <th className="px-3 py-2.5 font-medium">状態</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleCheckins.map((c) => {
                        const f = c.visit_type === "consult" ? formFor(c) : null;
                        const isDone = c.chart_done && c.payment_done;
                        return (
                          <tr key={c.id} style={{ borderTop: "1px solid #FAEEF0", opacity: isDone ? 0.5 : 1 }}>
                            <td className="px-4 py-3 text-lg font-bold" style={{ color: "#0F8B8D", fontFamily: "'JetBrains Mono', monospace" }}>
                              {c.checkin_number}
                            </td>
                            <td className="px-3 py-3" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{hhmm(c.created_at)}</td>
                            <td className="px-3 py-3 font-medium">{c.patient_name}</td>
                            <td className="px-3 py-3">
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                                style={
                                  c.visit_type === "pickup"
                                    ? { background: "#DFF5F3", color: "#0F8B8D" }
                                    : { background: "#FCE9EA", color: "#D64550" }
                                }
                              >
                                {c.visit_type === "pickup" ? <PackageCheck size={12} /> : <Stethoscope size={12} />}
                                {c.visit_type === "pickup" ? "薬受け取り" : "診察"}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-xs">{visitKindLabel(c)}</td>
                            <td className="px-3 py-3 text-xs" style={{ color: "#8A7378" }}>
                              {(c.medications || []).join("、") || "—"}
                            </td>
                            <td className="px-3 py-3 text-xs">{INSURANCE_LABEL[c.insurance] || "—"}</td>
                            <td className="px-3 py-3 text-xs" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{c.date_of_birth || "—"}</td>
                            <td className="px-3 py-3">
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
                            <td className="px-3 py-3">
                              {/* カルテ済/会計済の独立トグル。押すたびに済⇔未でオンオフ */}
                              <div className="flex items-center gap-1.5">
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
                    {[["consult", "診察"], ["pickup", "薬受け取り"]].map(([id, label]) => (
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
                  <div className="flex gap-2">
                    {Object.entries(INSURANCE_LABEL).map(([id, label]) => (
                      <button
                        key={id}
                        onClick={() => setProxy({ ...proxy, insurance: proxy.insurance === id ? "" : id })}
                        className="flex-1 px-2 py-2 rounded-lg text-xs font-medium"
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
                    {hhmm(selectedForm.created_at)} 受信{selectedForm.date_of_birth ? `　生年月日 ${selectedForm.date_of_birth}` : ""}
                    {!selectedForm.checkin_id && (
                      <span style={{ color: "#C0762C" }}>　※QR未経由の送信（名前照合のみ・未確認）</span>
                    )}
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
