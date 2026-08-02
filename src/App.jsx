import React, { useEffect, useRef, useState } from "react";
import {
  HeartPulse,
  Stethoscope,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  PackageCheck,
  PenLine,
  CalendarDays,
  Pill,
  Wallet,
  IdCard,
  Languages,
  Smartphone,
  Sparkle,
  RotateCcw,
  FlaskConical,
  MessageCirclePlus,
  Printer,
  Plus,
  Minus,
  MoveLeft,
} from "lucide-react";
import QRCode from "qrcode";
import { supabase } from "./supabase.js";
import StaffGate from "./StaffGate.jsx";
import StaffView from "./StaffView.jsx";
import { TEXT, MED_IDS, MED_NO_QTY } from "./i18n.js";
import { getPrinterConfig, savePrinterConfig, printTicket } from "./eposPrint.js";

const FONT_IMPORT = `
@import url('https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700&family=Noto+Sans+JP:wght@400;500;700&family=JetBrains+Mono:wght@500;600&display=swap');
/* マイナンバー読み取り画面の「左のリーダーへ」矢印アニメーション */
@keyframes mnArrow {
  0%, 100% { transform: translateX(10px); opacity: 0.6; }
  50% { transform: translateX(-14px); opacity: 1; }
}
.mn-arrow { animation: mnArrow 1.6s ease-in-out infinite; }
`;

// 問診票（このアプリの public/intake.html — 日英併記）のURL。
// 現在地からの相対解決なので、localhostでも GitHub Pages のサブパス配信でも正しいURLになる。
// 別ドメインに問診票を置く場合は VITE_INTAKE_URL で差し替えられる。
const INTAKE_URL = import.meta.env.VITE_INTAKE_URL || new URL("intake.html", window.location.href).toString();
// 再診（前回の診察の続き）向けの簡易問診票
const FOLLOWUP_URL = new URL("followup.html", window.location.href).toString();

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// その日すでに発番された受付番号の最大値+1を採番する。
// （受付機1台の運用前提。複数台で同時受付すると稀に重複しうる簡易実装）
async function nextCheckinNumber() {
  const { data, error } = await supabase
    .from("reception_checkins")
    .select("checkin_number")
    .eq("date_key", todayKey())
    .order("checkin_number", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0]?.checkin_number || 0) + 1;
}

// 完了画面・受付票に載せる問診票QRの飛び先。
// 初診・再診(新しい症状)=フル問診票 / 再診(前回の続き)=簡易問診票 / 検査結果・薬受け取り=QRなし
function qrBaseFor(d) {
  if (!d || d.visitType !== "consult") return null;
  if (d.visitKind === "return") {
    if (d.returnReason === "followup") return FOLLOWUP_URL;
    if (d.returnReason === "new_symptom") return INTAKE_URL;
    return null;
  }
  return INTAKE_URL;
}

// 受付IDをQRに埋め込む — 問診票送信時に一緒に保存され、名前の表記に関係なく
// 受付一覧の行と確実に紐付く。言語も渡して、英語で受付した患者には英語ファーストで開く
function qrUrlFor(d, lang) {
  const base = qrBaseFor(d);
  if (!base) return null;
  return `${base}${base.includes("?") ? "&" : "?"}checkin=${encodeURIComponent(d.checkinId)}&lang=${lang}`;
}

function Clock({ lang }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const daysJa = ["日", "月", "火", "水", "木", "金", "土"];
  const daysEn = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthsEn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dateStr =
    lang === "ja"
      ? `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（${daysJa[now.getDay()]}）`
      : `${daysEn[now.getDay()]}, ${monthsEn[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
  return (
    <div className="text-right">
      <div className="text-xs" style={{ color: "#B08A90" }}>{dateStr}</div>
      <div className="text-xl font-semibold" style={{ color: "#3A2E30", fontFamily: "'JetBrains Mono', monospace" }}>
        {String(now.getHours()).padStart(2, "0")}:{String(now.getMinutes()).padStart(2, "0")}
      </div>
    </div>
  );
}

function QrImage({ url, size = 150 }) {
  const [dataUrl, setDataUrl] = useState(null);
  useEffect(() => {
    QRCode.toDataURL(url, { width: size * 2, margin: 1, color: { dark: "#3A2E30", light: "#FFFFFF" } })
      .then(setDataUrl)
      .catch(() => setDataUrl(null));
  }, [url, size]);
  if (!dataUrl) return null;
  return (
    <img
      src={dataUrl}
      alt="QR"
      className="rounded-xl shrink-0"
      style={{ width: size, height: size, border: "2px solid #F2DFE4" }}
    />
  );
}

function StepTitle({ title, subtitle }) {
  return (
    <div className="text-center">
      <h2 className="text-2xl font-bold mb-1" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
        {title}
      </h2>
      {subtitle && <p className="text-base" style={{ color: "#8A7378" }}>{subtitle}</p>}
    </div>
  );
}

// もどる・次へを1行にまとめて縦の場所を節約する（横置きiPadでスクロールさせないため）
function NavRow({ onBack, backLabel, onNext, nextDisabled, nextLabel }) {
  return (
    <div className="flex gap-3">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 px-6 py-3.5 rounded-2xl text-lg font-medium active:opacity-70 shrink-0"
        style={{ background: "#FFFFFF", border: "1.5px solid #F2DFE4", color: "#8A7378" }}
      >
        <ChevronLeft size={22} />
        {backLabel}
      </button>
      {onNext && (
        <button
          onClick={onNext}
          disabled={nextDisabled}
          className="flex-1 py-4 rounded-2xl text-xl font-bold flex items-center justify-center gap-2 active:opacity-80 transition-opacity"
          style={{ background: "#0F8B8D", color: "#FFFFFF", opacity: nextDisabled ? 0.35 : 1 }}
        >
          {nextLabel} <ChevronRight size={24} />
        </button>
      )}
    </div>
  );
}

function ErrorBox({ message, detail, staffLabel }) {
  if (!message) return null;
  return (
    <div className="p-4 rounded-2xl flex gap-3" style={{ background: "#FCE9EA", color: "#B03A44" }}>
      <AlertCircle size={22} className="shrink-0 mt-0.5" />
      <div className="flex flex-col gap-1">
        <span className="text-base">{message}</span>
        {detail && <span className="text-xs opacity-70">{staffLabel}: {detail}</span>}
      </div>
    </div>
  );
}

// ローカル開発時のみ ?demo=done / ?demo=done-pickup / ?demo=mn-read / ?demo=mn-complete で
// 各画面を直接表示できる（レイアウト確認用。本番ビルドでは import.meta.env.DEV が false のため無効）
const DEMO = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("demo") : null;
const DEMO_DONE =
  DEMO === "done" || DEMO === "mn-read" || DEMO === "mn-complete"
    ? { number: 12, patientName: "山田 花子", visitType: "consult", insurance: "mynumber", checkinId: "c-demo", visitKind: "first", returnReason: null }
    : DEMO === "done-pickup"
      ? { number: 12, patientName: "山田 花子", visitType: "pickup", insurance: "self_pay", checkinId: "c-demo", visitKind: null, returnReason: null }
      : null;
const DEMO_STEP =
  DEMO === "mn-read" ? "mynumber-read" : DEMO === "mn-complete" ? "mynumber-complete" : DEMO_DONE ? "done" : "home";

function Kiosk() {
  const [lang, setLang] = useState("ja");
  const t = TEXT[lang];

  // 薬受け取り: home → pickup-name → pickup-meds → insurance → done
  // 診察:       home → consult-name → consult-kind（初診/再診）
  //             →（再診なら consult-return: 検査結果/前回の続き/新しい症状）
  //             → insurance → done（初診・新しい症状=フル問診票QR / 前回の続き=簡易問診票QR / 検査結果=QRなし）
  const [step, setStep] = useState(DEMO_STEP);
  const [visitType, setVisitType] = useState(null); // "pickup" | "consult"
  const [name, setName] = useState("");
  // 生年月日 — <input type="date"> はOSの言語で「年/月/日」表示になってしまい
  // 英語モードと食い違うので、年・月・日の数字入力に分ける
  const [dobY, setDobY] = useState("");
  const [dobM, setDobM] = useState("");
  const [dobD, setDobD] = useState("");
  const [visitKind, setVisitKind] = useState(null); // "first" | "return"
  const [returnReason, setReturnReason] = useState(null); // "results" | "followup" | "new_symptom"
  // 薬受け取り: 選択した薬とその個数 { medId: 個数 }、その他の薬は自由記入
  const [medQty, setMedQty] = useState({});
  const [otherMed, setOtherMed] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState(false);
  const [errorDetail, setErrorDetail] = useState("");
  const [done, setDone] = useState(DEMO_DONE); // { number, visitType, insurance, checkinId, visitKind, returnReason }
  // 受付票（サーマルプリンタ）の発券状況: null=発券しない設定 | printing | printed | failed
  const [printState, setPrintState] = useState(DEMO_DONE ? "printed" : null);
  const [printDetail, setPrintDetail] = useState("");

  const reset = () => {
    setLang("ja");
    setStep("home");
    setVisitType(null);
    setName("");
    setDobY("");
    setDobM("");
    setDobD("");
    setVisitKind(null);
    setReturnReason(null);
    setMedQty({});
    setOtherMed("");
    setBusy(false);
    setErrorMsg(false);
    setErrorDetail("");
    setDone(null);
    setPrintState(null);
    setPrintDetail("");
  };

  // 一定時間操作がなければトップ画面に戻す（次の患者さんに前の人の情報を見せない）。
  // 完了画面はQR読み取り・問診記入があるので少し長め。
  const idleTimer = useRef(null);
  useEffect(() => {
    if (step === "home") return;
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(reset, step === "done" ? 30000 : 120000);
    return () => clearTimeout(idleTimer.current);
  }, [step, name, dobY, dobM, dobD, visitKind, returnReason, medQty, otherMed]);

  // Bluetooth発券では印刷アプリ（TM Print Assistant）に画面が切り替わる。
  // 非表示中にタイマーが切れて完了画面（番号・QR）が消えないよう、
  // 裏に回ったらタイマーを止め、戻ってきたら測り直す
  useEffect(() => {
    const onVis = () => {
      if (step === "home") return;
      clearTimeout(idleTimer.current);
      if (document.visibilityState === "visible") {
        idleTimer.current = setTimeout(reset, step === "done" ? 30000 : 120000);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [step]);

  // マイナンバー確認完了画面は数秒見せてから自動で受付完了画面へ
  useEffect(() => {
    if (step !== "mynumber-complete") return;
    const t = setTimeout(() => setStep("done"), 2500);
    return () => clearTimeout(t);
  }, [step]);

  const toggleMed = (id) => {
    setMedQty((prev) => {
      if (prev[id]) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: 1 };
    });
  };

  const changeMedQty = (id, delta) => {
    setMedQty((prev) => ({ ...prev, [id]: Math.min(9, Math.max(1, (prev[id] || 1) + delta)) }));
  };

  const anyMedChosen = Object.keys(medQty).length > 0 || otherMed.trim() !== "";

  const dobValid =
    /^\d{4}$/.test(dobY) &&
    +dobY >= 1900 &&
    +dobY <= new Date().getFullYear() &&
    dobM !== "" &&
    +dobM >= 1 &&
    +dobM <= 12 &&
    dobD !== "" &&
    +dobD >= 1 &&
    +dobD <= 31;
  const dobStr = dobValid ? `${dobY}-${String(+dobM).padStart(2, "0")}-${String(+dobD).padStart(2, "0")}` : "";

  // 受付票をサーマルプリンタへ自動発券（プリンタ未設定・無効ならなにもしない）。
  // 発券に失敗しても受付自体は成立しているので、画面のQR・番号で運用を続けられる。
  const autoPrintTicket = async (d, langAtCheckin) => {
    const now = new Date();
    const dateStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const ticket = {
      number: d.number,
      patientName: d.patientName,
      typeJa: d.visitType === "pickup" ? "お薬のお受け取り" : "診察",
      typeEn: d.visitType === "pickup" ? "Medication pick-up" : "Consultation",
      dateStr,
      qrUrl: qrUrlFor(d, langAtCheckin),
      qrNoteLines: [
        "スマートフォンでQRコードを読み取り",
        "問診票をご記入ください",
        "Scan this QR code with your phone",
        "to fill in the questionnaire",
      ],
    };
    try {
      setPrintDetail("");
      // Bluetooth（TM Print Assistant）は画面がアプリに切り替わるため、
      // 完了画面（番号・QR）が一度表示されてからアプリを起動する
      if (getPrinterConfig()?.method === "bt") await new Promise((r) => setTimeout(r, 800));
      const res = await printTicket(ticket);
      setPrintState(res.skipped ? null : "printed");
    } catch (e) {
      console.error("ticket print failed:", e);
      setPrintState("failed");
      setPrintDetail(e?.message || String(e));
    }
  };

  const checkIn = async (insuranceChoice) => {
    setBusy(true);
    setErrorMsg(false);
    setErrorDetail("");
    try {
      const number = await nextCheckinNumber();
      const checkinId = `c-${Date.now()}`;
      const { error } = await supabase.from("reception_checkins").insert({
        id: checkinId,
        date_key: todayKey(),
        checkin_number: number,
        visit_type: visitType,
        patient_name: name.trim(),
        date_of_birth: dobStr || null,
        visit_kind: visitType === "consult" ? visitKind : null,
        return_reason: visitType === "consult" && visitKind === "return" ? returnReason : null,
        // 薬名は言語に関わらずスタッフが読める日本語ラベル+個数で保存する（例: トリキュラー ×2）
        medications:
          visitType === "pickup"
            ? [
                ...MED_IDS.filter((id) => medQty[id]).map((id) =>
                  MED_NO_QTY.includes(id) ? TEXT.ja.meds[id] : `${TEXT.ja.meds[id]} ×${medQty[id]}`
                ),
                ...(otherMed.trim() ? [`その他: ${otherMed.trim()}`] : []),
              ]
            : null,
        insurance: insuranceChoice,
        status: "waiting",
      });
      if (error) throw error;
      const d = { number, patientName: name.trim(), visitType, insurance: insuranceChoice, checkinId, visitKind, returnReason };
      setDone(d);
      const pc = getPrinterConfig();
      setPrintState(pc?.enabled && (pc?.method === "bt" || pc?.ip) ? "printing" : null);
      // マイナンバーカードの方は、完了画面の前にカードリーダーでの確認手順を挟む
      setStep(insuranceChoice === "mynumber" ? "mynumber-read" : "done");
      autoPrintTicket(d, lang);
    } catch (e) {
      console.error("check-in failed:", e);
      setErrorMsg(true);
      // スタッフが原因を特定できるよう、技術的なエラー内容も小さく出しておく。
      // RLS違反 = この端末のログインアカウントが staff_profiles に登録されていない
      // （またはユーザー再作成で紐付けが切れた）ケースがほとんどなので、対処も添える
      const msg = e?.message || String(e);
      setErrorDetail(
        /row-level security/i.test(msg)
          ? `${msg} ／ この端末のログインがスタッフとして認識されていません。ページを再読み込みしてスタッフアカウントでログインし直すか、このアカウントをスタッフ登録（staff_profiles）してください。`
          : msg
      );
    } finally {
      setBusy(false);
    }
  };

  const insuranceOptions = [
    { id: "mynumber", label: t.insMynumber, desc: t.insMynumberDesc, icon: IdCard },
    { id: "self_pay", label: t.insSelfPay, desc: t.insSelfPayDesc, icon: Wallet },
  ];

  const doneQrUrl = done ? qrUrlFor(done, lang) : null;
  const doneQrBase = done ? qrBaseFor(done) : null;

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: "100dvh", background: "#FFF8F7", fontFamily: "'Noto Sans JP', sans-serif" }}>
      <style>{FONT_IMPORT}</style>

      <header className="flex items-center justify-between gap-4 px-6 py-2.5 shrink-0" style={{ borderBottom: "1px solid #F2DFE4", background: "#FFFFFF" }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#0F8B8D" }}>
            <HeartPulse size={20} color="#DFF5F3" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold truncate" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>{t.clinicName}</div>
            <div className="text-xs" style={{ color: "#B08A90" }}>{t.receptionTitle}</div>
          </div>
        </div>
        <div className="flex items-center gap-5 shrink-0">
          <button
            onClick={() => setLang((l) => (l === "ja" ? "en" : "ja"))}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-base font-bold active:opacity-70"
            style={{ background: "#FFF8F7", border: "2px solid #0F8B8D", color: "#0F8B8D" }}
          >
            <Languages size={18} />
            {lang === "ja" ? "English" : "日本語"}
          </button>
          <Clock lang={lang} />
        </div>
      </header>

      {/* 横置きiPadでスクロールが出ないよう、各ステップは1画面に収まる高さで組む。
          万一収まらない環境（極端に低い画面など）のためスクロールは残す */}
      <main className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center px-8 py-4">
        <div className="w-full max-w-3xl">

          {step === "home" && (
            <div className="flex flex-col gap-5">
              <div className="text-center">
                <h1 className="text-3xl font-bold mb-1.5" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
                  {t.welcome}
                </h1>
                <p className="text-lg" style={{ color: "#8A7378" }}>{t.choosePurpose}</p>
              </div>
              <button
                onClick={() => {
                  setVisitType("pickup");
                  setStep("pickup-name");
                }}
                className="w-full p-6 rounded-3xl flex items-center gap-5 text-left active:opacity-80"
                style={{ background: "#FFFFFF", border: "2px solid #0F8B8D", color: "#0F8B8D" }}
              >
                <PackageCheck size={40} className="shrink-0" />
                <div className="flex-1">
                  <div className="text-2xl font-bold mb-1" style={{ fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>{t.pickupTitle}</div>
                  <div className="text-base" style={{ color: "#8A7378" }}>{t.pickupDesc}</div>
                </div>
                <ChevronRight size={32} className="shrink-0" />
              </button>
              <button
                onClick={() => {
                  setVisitType("consult");
                  setStep("consult-name");
                }}
                className="w-full p-6 rounded-3xl flex items-center gap-5 text-left active:opacity-80"
                style={{ background: "#0F8B8D", color: "#FFFFFF" }}
              >
                <Stethoscope size={40} className="shrink-0" />
                <div className="flex-1">
                  <div className="text-2xl font-bold mb-1" style={{ fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>{t.consultTitle}</div>
                  <div className="text-base" style={{ color: "#DFF5F3" }}>{t.consultDesc}</div>
                </div>
                <ChevronRight size={32} className="shrink-0" />
              </button>
            </div>
          )}

          {(step === "pickup-name" || step === "consult-name") && (
            <div className="flex flex-col gap-4">
              <StepTitle title={step === "pickup-name" ? t.pickupTitle : t.consultTitle} subtitle={t.enterName} />
              <div className="flex items-center gap-3 px-5 py-4 rounded-2xl" style={{ background: "#FFFFFF", border: "2px solid #F2DFE4" }}>
                <PenLine size={24} color="#B08A90" className="shrink-0" />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t.namePlaceholder}
                  autoFocus
                  className="flex-1 bg-transparent text-2xl outline-none min-w-0"
                  style={{ color: "#3A2E30" }}
                />
              </div>
              <div className="px-5 py-4 rounded-2xl" style={{ background: "#FFFFFF", border: "2px solid #F2DFE4" }}>
                <div className="flex items-center gap-2 mb-2">
                  <CalendarDays size={20} color="#B08A90" className="shrink-0" />
                  <span className="text-sm" style={{ color: "#B08A90" }}>{t.dobLabel}</span>
                </div>
                <div className="flex gap-3">
                  {/* 日本語=年/月/日、英語=Month/Day/Year（米国式）の順で並べる */}
                  {(lang === "ja"
                    ? [
                        { key: "y", value: dobY, set: setDobY, max: 4, ph: t.dobYearPh, label: t.dobYear, wide: true },
                        { key: "m", value: dobM, set: setDobM, max: 2, ph: "5", label: t.dobMonth },
                        { key: "d", value: dobD, set: setDobD, max: 2, ph: "10", label: t.dobDay },
                      ]
                    : [
                        { key: "m", value: dobM, set: setDobM, max: 2, ph: "5", label: t.dobMonth },
                        { key: "d", value: dobD, set: setDobD, max: 2, ph: "10", label: t.dobDay },
                        { key: "y", value: dobY, set: setDobY, max: 4, ph: t.dobYearPh, label: t.dobYear, wide: true },
                      ]
                  ).map((f) => (
                    <div key={f.key} className={`${f.wide ? "flex-[2]" : "flex-1"} min-w-0`}>
                      <input
                        value={f.value}
                        onChange={(e) => f.set(e.target.value.replace(/\D/g, "").slice(0, f.max))}
                        inputMode="numeric"
                        placeholder={f.ph}
                        className="w-full text-2xl text-center outline-none py-2 rounded-xl min-w-0"
                        style={{ background: "#FFF8F7", border: "1.5px solid #F2DFE4", color: "#3A2E30" }}
                      />
                      <div className="text-center text-sm mt-1" style={{ color: "#B08A90" }}>{f.label}</div>
                    </div>
                  ))}
                </div>
              </div>
              <NavRow
                onBack={reset}
                backLabel={t.back}
                onNext={() => setStep(step === "pickup-name" ? "pickup-meds" : "consult-kind")}
                nextDisabled={!name.trim() || !dobValid}
                nextLabel={t.next}
              />
            </div>
          )}

          {step === "consult-kind" && (
            <div className="flex flex-col gap-4">
              <StepTitle title={t.visitKindTitle} subtitle={t.visitKindSubtitle} />
              <div className="flex flex-col gap-3">
                {[
                  { id: "first", label: t.firstVisit, desc: t.firstVisitDesc, icon: Sparkle },
                  { id: "return", label: t.returnVisit, desc: t.returnVisitDesc, icon: RotateCcw },
                ].map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => {
                        setVisitKind(opt.id);
                        setStep(opt.id === "first" ? "insurance" : "consult-return");
                      }}
                      className="w-full px-6 py-5 rounded-2xl flex items-center gap-5 text-left active:opacity-80"
                      style={{ background: "#FFFFFF", border: "2px solid #F2DFE4", color: "#3A2E30" }}
                    >
                      <Icon size={32} className="shrink-0" color="#0F8B8D" />
                      <div className="flex-1">
                        <div className="text-xl font-bold mb-0.5" style={{ fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>{opt.label}</div>
                        <div className="text-sm" style={{ color: "#8A7378" }}>{opt.desc}</div>
                      </div>
                      <ChevronRight size={26} className="shrink-0" color="#0F8B8D" />
                    </button>
                  );
                })}
              </div>
              <NavRow onBack={() => setStep("consult-name")} backLabel={t.back} />
            </div>
          )}

          {step === "consult-return" && (
            <div className="flex flex-col gap-4">
              <StepTitle title={t.returnReasonTitle} subtitle={t.returnReasonSubtitle} />
              <div className="flex flex-col gap-3">
                {[
                  { id: "results", label: t.rrResults, desc: t.rrResultsDesc, icon: FlaskConical },
                  { id: "followup", label: t.rrFollowup, desc: t.rrFollowupDesc, icon: RotateCcw },
                  { id: "new_symptom", label: t.rrNew, desc: t.rrNewDesc, icon: MessageCirclePlus },
                ].map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => {
                        setReturnReason(opt.id);
                        setStep("insurance");
                      }}
                      className="w-full px-6 py-4 rounded-2xl flex items-center gap-5 text-left active:opacity-80"
                      style={{ background: "#FFFFFF", border: "2px solid #F2DFE4", color: "#3A2E30" }}
                    >
                      <Icon size={30} className="shrink-0" color="#0F8B8D" />
                      <div className="flex-1">
                        <div className="text-xl font-bold mb-0.5" style={{ fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>{opt.label}</div>
                        <div className="text-sm" style={{ color: "#8A7378" }}>{opt.desc}</div>
                      </div>
                      <ChevronRight size={26} className="shrink-0" color="#0F8B8D" />
                    </button>
                  );
                })}
              </div>
              <NavRow onBack={() => setStep("consult-kind")} backLabel={t.back} />
            </div>
          )}

          {step === "pickup-meds" && (
            <div className="flex flex-col gap-4">
              <StepTitle title={t.medsTitle} subtitle={t.medsSubtitle} />
              <div className="grid grid-cols-2 gap-3">
                {MED_IDS.map((id) => {
                  const qty = medQty[id];
                  const sel = !!qty;
                  const showQty = sel && !MED_NO_QTY.includes(id);
                  return (
                    <div
                      key={id}
                      className="rounded-2xl flex items-center"
                      style={{
                        background: sel ? "#DFF5F3" : "#FFFFFF",
                        border: sel ? "2px solid #0F8B8D" : "2px solid #F2DFE4",
                        color: sel ? "#0F8B8D" : "#3A2E30",
                      }}
                    >
                      <button
                        onClick={() => toggleMed(id)}
                        className="flex-1 min-w-0 pl-4 pr-2 py-3.5 flex items-center gap-3 text-left active:opacity-80"
                      >
                        <span
                          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                          style={{ background: sel ? "#0F8B8D" : "#FFF8F7", border: sel ? "none" : "2px solid #F2DFE4" }}
                        >
                          {sel && <CheckCircle2 size={18} color="#FFFFFF" />}
                        </span>
                        <span className="text-base font-medium leading-snug">{t.meds[id]}</span>
                      </button>
                      {/* 個数ステッパー（前回と同じ処方箋には出さない） */}
                      {showQty && (
                        <div className="flex items-center gap-1 pr-2.5 shrink-0">
                          <button
                            onClick={() => changeMedQty(id, -1)}
                            className="w-9 h-9 rounded-lg flex items-center justify-center active:opacity-70"
                            style={{ background: "#FFFFFF", border: "1.5px solid #0F8B8D", color: "#0F8B8D" }}
                          >
                            <Minus size={18} />
                          </button>
                          <span className="w-7 text-center text-xl font-bold" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                            {qty}
                          </span>
                          <button
                            onClick={() => changeMedQty(id, 1)}
                            className="w-9 h-9 rounded-lg flex items-center justify-center active:opacity-70"
                            style={{ background: "#0F8B8D", border: "1.5px solid #0F8B8D", color: "#FFFFFF" }}
                          >
                            <Plus size={18} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl" style={{ background: "#FFFFFF", border: "2px solid #F2DFE4" }}>
                <Pill size={20} color="#B08A90" className="shrink-0" />
                <span className="text-sm shrink-0" style={{ color: "#B08A90" }}>{t.medsOtherLabel}</span>
                <input
                  value={otherMed}
                  onChange={(e) => setOtherMed(e.target.value)}
                  placeholder={t.medsOtherPlaceholder}
                  className="flex-1 bg-transparent text-lg outline-none min-w-0"
                  style={{ color: "#3A2E30" }}
                />
              </div>
              <NavRow
                onBack={() => setStep("pickup-name")}
                backLabel={t.back}
                onNext={() => setStep("insurance")}
                nextDisabled={!anyMedChosen}
                nextLabel={t.next}
              />
            </div>
          )}

          {step === "insurance" && (
            <div className="flex flex-col gap-4">
              <StepTitle title={t.insuranceTitle} subtitle={t.insuranceSubtitle} />
              <div className="flex flex-col gap-3">
                {insuranceOptions.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => !busy && checkIn(opt.id)}
                      disabled={busy}
                      className="w-full px-6 py-5 rounded-2xl flex items-center gap-5 text-left active:opacity-80"
                      style={{ background: "#FFFFFF", border: "2px solid #F2DFE4", color: "#3A2E30", opacity: busy ? 0.5 : 1 }}
                    >
                      <Icon size={32} className="shrink-0" color="#0F8B8D" />
                      <div className="flex-1">
                        <div className="text-xl font-bold mb-0.5" style={{ fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>{opt.label}</div>
                        <div className="text-sm" style={{ color: "#8A7378" }}>{opt.desc}</div>
                      </div>
                      <ChevronRight size={26} className="shrink-0" color="#0F8B8D" />
                    </button>
                  );
                })}
              </div>
              {busy && <p className="text-center text-base" style={{ color: "#8A7378" }}>{t.working}</p>}
              <ErrorBox message={errorMsg ? t.errorGeneric : ""} detail={errorDetail} staffLabel={t.errorForStaff} />
              <NavRow
                onBack={() =>
                  setStep(
                    visitType === "pickup" ? "pickup-meds" : visitKind === "return" ? "consult-return" : "consult-kind"
                  )
                }
                backLabel={t.back}
              />
            </div>
          )}

          {step === "mynumber-read" && (
            <div className="flex flex-col gap-4">
              <StepTitle title={t.mnReadTitle} subtitle={t.mnReadSubtitle} />
              {/* リーダー（Panasonic製・iPadの左側に設置）を指す左向き矢印 */}
              <div className="p-6 rounded-3xl flex items-center gap-6" style={{ background: "#FFFFFF", border: "2px solid #F2DFE4" }}>
                <MoveLeft size={96} color="#0F8B8D" className="shrink-0 mn-arrow" />
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <IdCard size={40} color="#0F8B8D" className="shrink-0" />
                    <div className="text-2xl font-bold leading-snug" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
                      {t.mnReadInstruction}
                    </div>
                  </div>
                  <div className="text-base" style={{ color: "#8A7378" }}>{t.mnReadHint}</div>
                  <div className="text-sm" style={{ color: "#B08A90" }}>{t.mnReadTrouble}</div>
                </div>
              </div>
              <button
                onClick={() => setStep("mynumber-complete")}
                className="w-full py-4 rounded-2xl text-xl font-bold flex items-center justify-center gap-2 active:opacity-80"
                style={{ background: "#0F8B8D", color: "#FFFFFF" }}
              >
                {t.mnReadDoneBtn} <ChevronRight size={24} />
              </button>
            </div>
          )}

          {step === "mynumber-complete" && (
            <div className="flex flex-col items-center gap-5 text-center">
              <CheckCircle2 size={80} color="#0F8B8D" />
              <h2 className="text-3xl font-bold" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
                {t.mnCompleteTitle}
              </h2>
              <p className="text-lg" style={{ color: "#8A7378" }}>{t.mnCompleteBody}</p>
            </div>
          )}

          {step === "done" && done && (
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 size={38} color="#0F8B8D" />
                <h2 className="text-3xl font-bold" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
                  {t.doneTitle}
                </h2>
              </div>

              {/* 横置き: 左=受付番号 / 右=案内（マイナンバー・QR）。縦幅を抑えて1画面に収める */}
              <div className="w-full flex flex-col md:flex-row gap-4 justify-center md:items-stretch">
                {/* お呼び出しは番号ではなくお名前で行う運用のため、番号ではなく名前を大きく出す
                    （受付番号は採番・保存は続け、スタッフ画面の並び順・照合に使う） */}
                <div
                  className="px-8 py-5 rounded-3xl text-center flex flex-col items-center justify-center shrink-0 md:self-auto md:max-w-xs"
                  style={{ background: "#FFFFFF", border: "2px solid #0F8B8D" }}
                >
                  <div className="text-base mb-1" style={{ color: "#8A7378" }}>{t.doneNameLabel}</div>
                  <div className="text-4xl font-bold break-words max-w-full" style={{ color: "#0F8B8D", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
                    {done.patientName}
                    {t.doneNameSuffix}
                  </div>
                  <div className="text-sm mt-2" style={{ color: "#8A7378" }}>
                    {done.visitType === "pickup" ? t.pickupTitle : t.consultTitle}
                  </div>
                </div>

                {/* マイナンバー確認は完了画面より前の専用ステップ（mynumber-read）で済ませているので、
                    ここでは問診票QRまたは待機案内のみを出す */}
                <div className="flex flex-col gap-3 md:max-w-md flex-1 justify-center">
                  {doneQrUrl ? (
                    <div className="p-4 rounded-2xl flex items-center gap-4 text-left" style={{ background: "#FFFFFF", border: "2px solid #F2DFE4" }}>
                      <QrImage url={doneQrUrl} size={150} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1.5">
                          <Smartphone size={20} color="#0F8B8D" className="shrink-0" />
                          <span className="text-lg font-bold leading-snug" style={{ color: "#3A2E30" }}>
                            {doneQrBase === FOLLOWUP_URL ? t.qrTitleSimple : t.qrTitle}
                          </span>
                        </div>
                        <p className="text-sm" style={{ color: "#8A7378" }}>
                          {t.qrBodyNoCard}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-lg text-center md:text-left" style={{ color: "#8A7378" }}>
                      {done.visitType === "pickup" ? t.pickupWait : t.consultWait}
                    </p>
                  )}

                  {printState && (
                    <div
                      className="px-4 py-2.5 rounded-2xl flex items-center gap-2.5 text-sm"
                      style={
                        printState === "failed"
                          ? { background: "#FDF3E7", color: "#9A6B2F" }
                          : { background: "#F4EFF0", color: "#8A7378" }
                      }
                    >
                      <Printer size={18} className="shrink-0" />
                      <span>
                        {printState === "printing" && t.ticketPrinting}
                        {printState === "printed" && t.ticketTake}
                        {printState === "failed" && t.ticketFail}
                        {printState === "failed" && printDetail && (
                          <span className="block text-xs opacity-70">{t.errorForStaff}: {printDetail}</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-5">
                <button
                  onClick={reset}
                  className="px-8 py-3 rounded-2xl text-lg font-medium active:opacity-70"
                  style={{ background: "#FFFFFF", border: "1.5px solid #F2DFE4", color: "#8A7378" }}
                >
                  {t.backToTop}
                </button>
                <p className="text-sm" style={{ color: "#C9AEB3" }}>{t.autoReturn}</p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// 端末設定画面（?setup）: ログイン状態の確認・ログアウトと、サーマルプリンタの設定。
// 受付機のiPadで https://…/kiosk/?setup を開く（プリンタ設定はその端末のlocalStorageに保存）。
// 受付画面には導線を出していない（患者が開けてしまうため）。
function AccountPanel() {
  const [email, setEmail] = useState(null);
  const [staffInfo, setStaffInfo] = useState(undefined); // undefined=確認中 / null=未登録 / {name,role}
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      const user = data.session?.user;
      setEmail(user?.email || null);
      if (!user) {
        setStaffInfo(null);
        return;
      }
      const { data: sp } = await supabase.from("staff_profiles").select("name, role").eq("id", user.id).single();
      if (!cancelled) setStaffInfo(sp || null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    // StaffGateがログイン画面に切り替えるので、クエリを外してトップへ
    window.location.href = window.location.pathname;
  };

  const ROLE_LABEL = { doctor: "医師", staff: "スタッフ" };
  return (
    <div className="p-4 rounded-2xl flex flex-col gap-2" style={{ background: "#FFFFFF", border: "2px solid #F2DFE4" }}>
      <div className="text-sm font-bold" style={{ color: "#3A2E30" }}>この端末のログイン</div>
      <div className="text-sm" style={{ color: "#5C4A4E" }}>
        {email ? (
          <>
            <div>アカウント: {email}</div>
            <div>
              スタッフ登録:{" "}
              {staffInfo === undefined
                ? "確認中…"
                : staffInfo
                  ? `登録済み（${staffInfo.name}・${ROLE_LABEL[staffInfo.role] || staffInfo.role}）`
                  : "未登録 — このままだと受付処理が失敗します。スタッフ登録済みのアカウントでログインし直してください。"}
            </div>
          </>
        ) : (
          "未ログイン"
        )}
      </div>
      {email && (
        <button
          onClick={logout}
          disabled={signingOut}
          className="self-start px-5 py-2.5 rounded-xl text-sm font-bold active:opacity-70"
          style={{ background: "#FFFFFF", border: "2px solid #B03A44", color: "#B03A44", opacity: signingOut ? 0.5 : 1 }}
        >
          {signingOut ? "ログアウト中…" : "ログアウトする（別のアカウントで入り直す）"}
        </button>
      )}
    </div>
  );
}

function PrinterSetup() {
  const saved = getPrinterConfig();
  const [cfg, setCfg] = useState({
    enabled: saved?.enabled ?? true,
    method: saved?.method || "bt", // "bt"（TM Print Assistantアプリ経由） | "lan"（直接送信）
    ip: saved?.ip || "",
    scheme: saved?.scheme || "https",
    devid: saved?.devid || "local_printer",
  });
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const save = () => {
    savePrinterConfig(cfg);
    setStatus("保存しました。この端末での受付完了時に自動で発券されます。");
  };

  const testPrint = async () => {
    savePrinterConfig(cfg);
    setBusy(true);
    setStatus("テスト印刷を送信中…");
    try {
      const now = new Date();
      const res = await printTicket({
        number: 99,
        patientName: "受付 花子",
        typeJa: "テスト印刷",
        typeEn: "Test print",
        dateStr: `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
        qrUrl: "https://kladiesclinic.github.io/kiosk/",
        qrNoteLines: ["テスト用QRコード", "Test QR code"],
      });
      setStatus(
        res.skipped
          ? "プリンタが無効またはIP未入力のため送信していません。"
          : res.external
            ? "TM Print Assistantアプリを起動しました。アプリ側で印刷されれば設定完了です（印刷後は画面左上の「◀ Safari」でこの画面に戻ってください）。"
            : "テスト印刷を送信しました。プリンタから受付票が出れば設定完了です。"
      );
    } catch (e) {
      setStatus(`テスト印刷に失敗しました: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const field = { background: "#FFFFFF", border: "2px solid #F2DFE4", color: "#3A2E30" };
  return (
    <div className="min-h-screen p-8 flex justify-center" style={{ background: "#FFF8F7", fontFamily: "'Noto Sans JP', sans-serif" }}>
      <style>{FONT_IMPORT}</style>
      <div className="w-full max-w-lg flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Printer size={28} color="#0F8B8D" />
          <h1 className="text-2xl font-bold" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
            端末設定
          </h1>
        </div>

        <AccountPanel />

        <div className="text-sm font-bold mt-2" style={{ color: "#3A2E30" }}>レシートプリンタ</div>
        <p className="text-sm -mt-2" style={{ color: "#8A7378" }}>
          Epson TMシリーズ（TM-m10 / TM-m30 など）用の設定です。設定はこの端末（iPad）にのみ保存されます。
        </p>

        <label className="flex items-center gap-3 p-4 rounded-2xl" style={field}>
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
            className="w-5 h-5"
          />
          <span className="text-base font-medium">受付完了時に自動で受付票を発券する</span>
        </label>

        <div>
          <div className="text-sm mb-1.5" style={{ color: "#8A7378" }}>プリンタの接続方法</div>
          <select
            value={cfg.method}
            onChange={(e) => setCfg({ ...cfg, method: e.target.value })}
            className="w-full p-4 rounded-2xl text-lg outline-none"
            style={field}
          >
            <option value="bt">Bluetooth（TM Print Assistantアプリ経由）</option>
            <option value="lan">有線LAN・Wi-Fi（プリンタへ直接送信）</option>
          </select>
        </div>

        {cfg.method === "bt" ? (
          <div className="p-4 rounded-2xl text-sm flex flex-col gap-2" style={{ background: "#F4EFF0", color: "#5C4A4E" }}>
            <div className="font-bold">Bluetooth発券の事前準備（最初に1回だけ）</div>
            <ol className="list-decimal ml-5 flex flex-col gap-1">
              <li>iPadの「設定 → Bluetooth」でプリンタ（TM-m10）とペアリング</li>
              <li>App Storeで「Epson TM Print Assistant」をインストール</li>
              <li>TM Print Assistantを開き、プリンタ（Bluetooth）を選択しておく</li>
              <li>下の「テスト印刷」で動作確認</li>
            </ol>
            <div>
              発券のたびに一瞬TM Print Assistantに画面が切り替わります。iOSの仕様で自動では戻らないため、
              画面左上の「◀ Safari」をタップして受付画面に戻ってください（戻るまで完了画面は保持されます）。
            </div>
          </div>
        ) : (
          <>
            <div>
              <div className="text-sm mb-1.5" style={{ color: "#8A7378" }}>プリンタのIPアドレス（例: 192.168.11.70）</div>
              <input
                value={cfg.ip}
                onChange={(e) => setCfg({ ...cfg, ip: e.target.value.trim() })}
                placeholder="192.168.11.70"
                inputMode="decimal"
                className="w-full p-4 rounded-2xl text-lg outline-none"
                style={field}
              />
            </div>

            <div>
              <div className="text-sm mb-1.5" style={{ color: "#8A7378" }}>通信方式</div>
              <select
                value={cfg.scheme}
                onChange={(e) => setCfg({ ...cfg, scheme: e.target.value })}
                className="w-full p-4 rounded-2xl text-lg outline-none"
                style={field}
              >
                <option value="https">https（GitHub Pages配信ではこちら。プリンタのSSL証明書設定が必要）</option>
                <option value="http">http（LAN内のhttp配信で動かす場合のみ）</option>
              </select>
            </div>

            <div>
              <div className="text-sm mb-1.5" style={{ color: "#8A7378" }}>デバイスID（通常は local_printer のまま）</div>
              <input
                value={cfg.devid}
                onChange={(e) => setCfg({ ...cfg, devid: e.target.value.trim() })}
                className="w-full p-4 rounded-2xl text-lg outline-none"
                style={field}
              />
            </div>
          </>
        )}

        <div className="flex gap-3">
          <button
            onClick={save}
            className="flex-1 py-4 rounded-2xl text-lg font-bold"
            style={{ background: "#0F8B8D", color: "#FFFFFF" }}
          >
            保存
          </button>
          <button
            onClick={testPrint}
            disabled={busy}
            className="flex-1 py-4 rounded-2xl text-lg font-bold"
            style={{ background: "#FFFFFF", border: "2px solid #0F8B8D", color: "#0F8B8D", opacity: busy ? 0.5 : 1 }}
          >
            テスト印刷
          </button>
        </div>

        {status && (
          <p className="text-sm p-4 rounded-2xl" style={{ background: "#F4EFF0", color: "#5C4A4E" }}>{status}</p>
        )}

        <a href={window.location.pathname} className="text-sm underline" style={{ color: "#0F8B8D" }}>
          受付画面にもどる
        </a>
      </div>
    </div>
  );
}

export default function App() {
  // #staff を付けて開くとスタッフ用の受付一覧（受付カウンターのPC等で使う想定）。
  // 受付機（患者向け画面）には受付一覧への導線を出さない — 端末はスタッフログイン済みなので、
  // ボタンを置くと患者が一覧を開けてしまうため。
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // ?setup でレシートプリンタの設定画面（スタッフがiPadで開く。StaffGateの内側）
  const isSetup = new URLSearchParams(window.location.search).has("setup");

  return <StaffGate>{isSetup ? <PrinterSetup /> : hash === "#staff" ? <StaffView /> : <Kiosk />}</StaffGate>;
}
