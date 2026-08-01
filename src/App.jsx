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
  Hash,
  Pill,
  CreditCard,
  Wallet,
  IdCard,
  Languages,
  Smartphone,
} from "lucide-react";
import QRCode from "qrcode";
import { supabase } from "./supabase.js";
import StaffGate from "./StaffGate.jsx";
import StaffView from "./StaffView.jsx";
import { TEXT, MED_IDS } from "./i18n.js";

const FONT_IMPORT = `
@import url('https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700&family=Noto+Sans+JP:wght@400;500;700&family=JetBrains+Mono:wght@500;600&display=swap');
`;

// 問診票（このアプリの public/intake.html — 日英併記）のURL。
// 現在地からの相対解決なので、localhostでも GitHub Pages のサブパス配信でも正しいURLになる。
// 別ドメインに問診票を置く場合は VITE_INTAKE_URL で差し替えられる。
const INTAKE_URL = import.meta.env.VITE_INTAKE_URL || new URL("intake.html", window.location.href).toString();

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
      <div className="text-sm" style={{ color: "#B08A90" }}>{dateStr}</div>
      <div className="text-2xl font-semibold" style={{ color: "#3A2E30", fontFamily: "'JetBrains Mono', monospace" }}>
        {String(now.getHours()).padStart(2, "0")}:{String(now.getMinutes()).padStart(2, "0")}
      </div>
    </div>
  );
}

function QrImage({ url }) {
  const [dataUrl, setDataUrl] = useState(null);
  useEffect(() => {
    QRCode.toDataURL(url, { width: 220, margin: 1, color: { dark: "#3A2E30", light: "#FFFFFF" } })
      .then(setDataUrl)
      .catch(() => setDataUrl(null));
  }, [url]);
  if (!dataUrl) return null;
  return <img src={dataUrl} alt="QR" className="w-52 h-52 rounded-xl" style={{ border: "2px solid #F2DFE4" }} />;
}

function StepTitle({ title, subtitle }) {
  return (
    <div className="text-center">
      <h2 className="text-3xl font-bold mb-2" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
        {title}
      </h2>
      {subtitle && <p className="text-lg" style={{ color: "#8A7378" }}>{subtitle}</p>}
    </div>
  );
}

function BackButton({ onClick, label }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-5 py-3.5 rounded-2xl text-lg font-medium active:opacity-70 self-start"
      style={{ background: "#FFFFFF", border: "1.5px solid #F2DFE4", color: "#8A7378" }}
    >
      <ChevronLeft size={22} />
      {label}
    </button>
  );
}

function NextButton({ onClick, disabled, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full py-6 rounded-3xl text-2xl font-bold flex items-center justify-center gap-2 active:opacity-80 transition-opacity"
      style={{ background: "#0F8B8D", color: "#FFFFFF", opacity: disabled ? 0.35 : 1 }}
    >
      {children}
    </button>
  );
}

function ErrorBox({ message, detail, staffLabel }) {
  if (!message) return null;
  return (
    <div className="p-6 rounded-3xl flex gap-3" style={{ background: "#FCE9EA", color: "#B03A44" }}>
      <AlertCircle size={24} className="shrink-0 mt-0.5" />
      <div className="flex flex-col gap-1.5">
        <span className="text-lg">{message}</span>
        {detail && <span className="text-xs opacity-70">{staffLabel}: {detail}</span>}
      </div>
    </div>
  );
}

function Kiosk() {
  const [lang, setLang] = useState("ja");
  const t = TEXT[lang];

  // 薬受け取り: home → pickup-name → pickup-meds → insurance → done
  // 診察:       home → consult-name → insurance → done（問診票QR表示）
  const [step, setStep] = useState("home");
  const [visitType, setVisitType] = useState(null); // "pickup" | "consult"
  const [name, setName] = useState("");
  const [chartNumber, setChartNumber] = useState("");
  const [selectedMeds, setSelectedMeds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState(false);
  const [errorDetail, setErrorDetail] = useState("");
  const [done, setDone] = useState(null); // { number, visitType, insurance }

  const reset = () => {
    setLang("ja");
    setStep("home");
    setVisitType(null);
    setName("");
    setChartNumber("");
    setSelectedMeds([]);
    setBusy(false);
    setErrorMsg(false);
    setErrorDetail("");
    setDone(null);
  };

  // 一定時間操作がなければトップ画面に戻す（次の患者さんに前の人の情報を見せない）。
  // 完了画面はQR読み取り・問診記入があるので少し長め。
  const idleTimer = useRef(null);
  useEffect(() => {
    if (step === "home") return;
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(reset, step === "done" ? 30000 : 120000);
    return () => clearTimeout(idleTimer.current);
  }, [step, name, chartNumber, selectedMeds]);

  const toggleMed = (id) => {
    setSelectedMeds((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  };

  const checkIn = async (insuranceChoice) => {
    setBusy(true);
    setErrorMsg(false);
    setErrorDetail("");
    try {
      const number = await nextCheckinNumber();
      const { error } = await supabase.from("reception_checkins").insert({
        id: `c-${Date.now()}`,
        date_key: todayKey(),
        checkin_number: number,
        visit_type: visitType,
        patient_name: name.trim(),
        chart_number: chartNumber.trim() || null,
        // 薬名は言語に関わらずスタッフが読める日本語ラベルで保存する
        medications: visitType === "pickup" ? selectedMeds.map((id) => TEXT.ja.meds[id]) : null,
        insurance: insuranceChoice,
        status: "waiting",
      });
      if (error) throw error;
      setDone({ number, visitType, insurance: insuranceChoice });
      setStep("done");
    } catch (e) {
      console.error("check-in failed:", e);
      setErrorMsg(true);
      // スタッフが原因を特定できるよう、技術的なエラー内容も小さく出しておく
      setErrorDetail(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const insuranceOptions = [
    { id: "mynumber", label: t.insMynumber, desc: t.insMynumberDesc, icon: IdCard },
    { id: "self_pay", label: t.insSelfPay, desc: t.insSelfPayDesc, icon: Wallet },
  ];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#FFF8F7", fontFamily: "'Noto Sans JP', sans-serif" }}>
      <style>{FONT_IMPORT}</style>

      <header className="flex items-center justify-between gap-4 px-8 py-5" style={{ borderBottom: "1px solid #F2DFE4", background: "#FFFFFF" }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "#0F8B8D" }}>
            <HeartPulse size={24} color="#DFF5F3" />
          </div>
          <div className="min-w-0">
            <div className="text-lg font-bold truncate" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>{t.clinicName}</div>
            <div className="text-xs" style={{ color: "#B08A90" }}>{t.receptionTitle}</div>
          </div>
        </div>
        <div className="flex items-center gap-5 shrink-0">
          <button
            onClick={() => setLang((l) => (l === "ja" ? "en" : "ja"))}
            className="flex items-center gap-2 px-5 py-3 rounded-2xl text-base font-bold active:opacity-70"
            style={{ background: "#FFF8F7", border: "2px solid #0F8B8D", color: "#0F8B8D" }}
          >
            <Languages size={20} />
            {lang === "ja" ? "English" : "日本語"}
          </button>
          <Clock lang={lang} />
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-8 py-10">
        <div className="w-full max-w-2xl">

          {step === "home" && (
            <div className="flex flex-col gap-8">
              <div className="text-center">
                <h1 className="text-4xl font-bold mb-3" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
                  {t.welcome}
                </h1>
                <p className="text-xl" style={{ color: "#8A7378" }}>{t.choosePurpose}</p>
              </div>
              <button
                onClick={() => {
                  setVisitType("pickup");
                  setStep("pickup-name");
                }}
                className="w-full p-8 rounded-3xl flex items-center gap-6 text-left active:opacity-80"
                style={{ background: "#FFFFFF", border: "2px solid #0F8B8D", color: "#0F8B8D" }}
              >
                <PackageCheck size={44} className="shrink-0" />
                <div className="flex-1">
                  <div className="text-3xl font-bold mb-1" style={{ fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>{t.pickupTitle}</div>
                  <div className="text-base" style={{ color: "#8A7378" }}>{t.pickupDesc}</div>
                </div>
                <ChevronRight size={36} className="shrink-0" />
              </button>
              <button
                onClick={() => {
                  setVisitType("consult");
                  setStep("consult-name");
                }}
                className="w-full p-8 rounded-3xl flex items-center gap-6 text-left active:opacity-80"
                style={{ background: "#0F8B8D", color: "#FFFFFF" }}
              >
                <Stethoscope size={44} className="shrink-0" />
                <div className="flex-1">
                  <div className="text-3xl font-bold mb-1" style={{ fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>{t.consultTitle}</div>
                  <div className="text-base" style={{ color: "#DFF5F3" }}>{t.consultDesc}</div>
                </div>
                <ChevronRight size={36} className="shrink-0" />
              </button>
            </div>
          )}

          {(step === "pickup-name" || step === "consult-name") && (
            <div className="flex flex-col gap-6">
              <StepTitle title={step === "pickup-name" ? t.pickupTitle : t.consultTitle} subtitle={t.enterName} />
              <div className="flex items-center gap-3 px-6 py-5 rounded-3xl" style={{ background: "#FFFFFF", border: "2px solid #F2DFE4" }}>
                <PenLine size={26} color="#B08A90" className="shrink-0" />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t.namePlaceholder}
                  autoFocus
                  className="flex-1 bg-transparent text-2xl outline-none min-w-0"
                  style={{ color: "#3A2E30" }}
                />
              </div>
              <div>
                <div className="flex items-center gap-3 px-6 py-5 rounded-3xl" style={{ background: "#FFFFFF", border: "2px solid #F2DFE4" }}>
                  <Hash size={26} color="#B08A90" className="shrink-0" />
                  <input
                    value={chartNumber}
                    onChange={(e) => setChartNumber(e.target.value)}
                    inputMode="numeric"
                    placeholder={t.chartPlaceholder}
                    className="flex-1 bg-transparent text-2xl outline-none min-w-0"
                    style={{ color: "#3A2E30" }}
                  />
                </div>
                <p className="text-sm mt-2 px-2" style={{ color: "#B08A90" }}>{t.chartHint}</p>
              </div>
              <NextButton
                onClick={() => setStep(step === "pickup-name" ? "pickup-meds" : "insurance")}
                disabled={!name.trim()}
              >
                {t.next} <ChevronRight size={26} />
              </NextButton>
              <BackButton onClick={reset} label={t.back} />
            </div>
          )}

          {step === "pickup-meds" && (
            <div className="flex flex-col gap-6">
              <StepTitle title={t.medsTitle} subtitle={t.medsSubtitle} />
              <div className="grid grid-cols-2 gap-3">
                {MED_IDS.map((id) => {
                  const sel = selectedMeds.includes(id);
                  return (
                    <button
                      key={id}
                      onClick={() => toggleMed(id)}
                      className="p-5 rounded-2xl flex items-center gap-3 text-left active:opacity-80"
                      style={{
                        background: sel ? "#DFF5F3" : "#FFFFFF",
                        border: sel ? "2px solid #0F8B8D" : "2px solid #F2DFE4",
                        color: sel ? "#0F8B8D" : "#3A2E30",
                      }}
                    >
                      <span
                        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: sel ? "#0F8B8D" : "#FFF8F7", border: sel ? "none" : "2px solid #F2DFE4" }}
                      >
                        {sel && <CheckCircle2 size={18} color="#FFFFFF" />}
                      </span>
                      <span className="text-lg font-medium leading-snug flex items-center gap-2">
                        <Pill size={18} color={sel ? "#0F8B8D" : "#B08A90"} className="shrink-0" />
                        {t.meds[id]}
                      </span>
                    </button>
                  );
                })}
              </div>
              <NextButton onClick={() => setStep("insurance")} disabled={selectedMeds.length === 0}>
                {t.next} <ChevronRight size={26} />
              </NextButton>
              <BackButton onClick={() => setStep("pickup-name")} label={t.back} />
            </div>
          )}

          {step === "insurance" && (
            <div className="flex flex-col gap-6">
              <StepTitle title={t.insuranceTitle} subtitle={t.insuranceSubtitle} />
              <div className="flex flex-col gap-4">
                {insuranceOptions.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => !busy && checkIn(opt.id)}
                      disabled={busy}
                      className="w-full p-7 rounded-3xl flex items-center gap-5 text-left active:opacity-80"
                      style={{ background: "#FFFFFF", border: "2px solid #F2DFE4", color: "#3A2E30", opacity: busy ? 0.5 : 1 }}
                    >
                      <Icon size={38} className="shrink-0" color="#0F8B8D" />
                      <div className="flex-1">
                        <div className="text-2xl font-bold mb-1" style={{ fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>{opt.label}</div>
                        <div className="text-base" style={{ color: "#8A7378" }}>{opt.desc}</div>
                      </div>
                      <ChevronRight size={30} className="shrink-0" color="#0F8B8D" />
                    </button>
                  );
                })}
              </div>
              {busy && <p className="text-center text-lg" style={{ color: "#8A7378" }}>{t.working}</p>}
              <ErrorBox message={errorMsg ? t.errorGeneric : ""} detail={errorDetail} staffLabel={t.errorForStaff} />
              <BackButton
                onClick={() => setStep(visitType === "pickup" ? "pickup-meds" : "consult-name")}
                label={t.back}
              />
            </div>
          )}

          {step === "done" && done && (
            <div className="flex flex-col items-center gap-6 text-center">
              <CheckCircle2 size={64} color="#0F8B8D" />
              <h2 className="text-4xl font-bold" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
                {t.doneTitle}
              </h2>
              <div className="px-14 py-6 rounded-3xl" style={{ background: "#FFFFFF", border: "2px solid #0F8B8D" }}>
                <div className="text-lg mb-1" style={{ color: "#8A7378" }}>
                  {done.visitType === "pickup" ? t.numberLabelPickup : t.numberLabelConsult}
                </div>
                <div className="text-6xl font-bold" style={{ color: "#0F8B8D", fontFamily: "'JetBrains Mono', monospace" }}>
                  {done.number}
                </div>
              </div>

              {done.insurance === "mynumber" && (
                <div className="p-5 rounded-3xl flex items-start gap-4 text-left w-full max-w-xl" style={{ background: "#DFF5F3", color: "#0F6B6D" }}>
                  <CreditCard size={26} className="shrink-0 mt-1" />
                  <div>
                    <div className="text-lg font-bold mb-0.5">{t.mynumberGuideTitle}</div>
                    <div className="text-base">
                      {t.mynumberGuideBody}
                      {done.visitType === "pickup" && ` ${t.mynumberThenSit}`}
                    </div>
                  </div>
                </div>
              )}

              {done.visitType === "consult" ? (
                <div className="p-6 rounded-3xl flex items-center gap-6 text-left w-full max-w-xl" style={{ background: "#FFFFFF", border: "2px solid #F2DFE4" }}>
                  <QrImage url={INTAKE_URL} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Smartphone size={22} color="#0F8B8D" className="shrink-0" />
                      <span className="text-xl font-bold" style={{ color: "#3A2E30" }}>{t.qrTitle}</span>
                    </div>
                    <p className="text-base" style={{ color: "#8A7378" }}>
                      {done.insurance === "mynumber" ? t.qrBody : t.qrBodyNoCard}
                    </p>
                  </div>
                </div>
              ) : (
                done.insurance !== "mynumber" && (
                  <p className="text-xl max-w-xl" style={{ color: "#8A7378" }}>{t.pickupWait}</p>
                )
              )}

              <button
                onClick={reset}
                className="px-10 py-4 rounded-2xl text-lg font-medium active:opacity-70"
                style={{ background: "#FFFFFF", border: "1.5px solid #F2DFE4", color: "#8A7378" }}
              >
                {t.backToTop}
              </button>
              <p className="text-sm" style={{ color: "#C9AEB3" }}>{t.autoReturn}</p>
            </div>
          )}
        </div>
      </main>
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

  return <StaffGate>{hash === "#staff" ? <StaffView /> : <Kiosk />}</StaffGate>;
}
