import React from "react";

// 予約管理・設定タブ（booking-app から移植）用のデザイントークンとプリミティブ。
// 受付機/受付一覧本体（StaffView）と同じ配色なので見た目は揃う。値は
// booking-app の components/ui.jsx と同一にして、移植コードを無改変で動かす。

export const T = {
  bg: "#FFF8F7",
  surface: "#FFFFFF",
  ink: "#3A2E30",
  muted: "#8A7378",
  faint: "#B08A90",
  teal: "#0F8B8D",
  tealDark: "#127D82",
  sage: "#6FC3C0",
  mint: "#DFF5F3",
  line: "#F2DFE4",
  pinkSoft: "#FBEEF0",
  alert: "#D64550",
  alertBg: "#FCE9EA",
};

export const FONTS = {
  heading: "'Zen Kaku Gothic New', sans-serif",
  body: "'Noto Sans JP', sans-serif",
  mono: "'JetBrains Mono', monospace",
};

export function StaticCard({ children, className = "" }) {
  return (
    <div className={`p-4 rounded-xl ${className}`} style={{ background: T.surface, border: `1px solid ${T.line}` }}>
      {children}
    </div>
  );
}

export function PrimaryButton({ children, onClick, disabled, full }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-5 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-opacity ${full ? "w-full" : ""}`}
      style={{ background: T.teal, color: "#FFFFFF", opacity: disabled ? 0.4 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
    >
      {children}
    </button>
  );
}

export function DangerButton({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-2 rounded-lg text-xs font-medium"
      style={{ background: T.alertBg, color: T.alert, opacity: disabled ? 0.4 : 1 }}
    >
      {children}
    </button>
  );
}

// min/max は日付の入力で使う（未来の日付を選べないようにする）
export function TextField({ value, onChange, placeholder, type = "text", label, required, min, max }) {
  return (
    <label className="block">
      {label && (
        <span className="block text-xs font-medium mb-1" style={{ color: T.muted }}>
          {label}
          {required && <span style={{ color: T.alert }}> *</span>}
        </span>
      )}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
        max={max}
        className="w-full p-2.5 rounded-lg text-sm outline-none"
        style={{ background: T.bg, border: `1px solid ${T.line}`, color: T.ink }}
      />
    </label>
  );
}

export function TextArea({ value, onChange, placeholder, rows = 3, label }) {
  return (
    <label className="block">
      {label && <span className="block text-xs font-medium mb-1" style={{ color: T.muted }}>{label}</span>}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full p-2.5 rounded-lg text-sm outline-none resize-none"
        style={{ background: T.bg, border: `1px solid ${T.line}`, color: T.ink }}
      />
    </label>
  );
}

export function Toast({ message }) {
  if (!message) return null;
  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg z-50"
      style={{ background: T.ink, color: "#FFFFFF" }}
    >
      {message}
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = React.useState("");
  const show = (message) => {
    setToast(message);
    setTimeout(() => setToast(""), 2600);
  };
  return [toast, show];
}
