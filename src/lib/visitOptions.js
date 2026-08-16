// 受付機（kiosk-app）と同じ選択肢・表示ラベル・保存形式。
// medications は kiosk と同じ「日本語表示文字列の配列」（例: "トリキュラー ×2", "その他: ロキソニン"）で保存する。

export const RETURN_REASONS = [
  { id: "results", label: "検査結果を聞く", description: "前回の検査の結果を聞きに来た" },
  { id: "followup", label: "前回の診察の続き", description: "同じ症状・治療の続きで受診する" },
  { id: "new_symptom", label: "新しい症状の相談", description: "前回とは別の新しいご相談" },
];

export const RETURN_REASON_LABEL = Object.fromEntries(RETURN_REASONS.map((r) => [r.id, r.label]));

export const INSURANCE_OPTIONS = [
  { id: "mynumber", label: "マイナンバーカードを持っている", short: "マイナ保険証" },
  { id: "hokensho", label: "資格確認書を持っている", short: "資格確認書" },
  { id: "self_pay", label: "保険を使わない（自費）", short: "自費" },
  // 忘れた方は当日は全額自費。同じ月のうちなら差額をクリニックで返金するので、
  // もともとの自費（self_pay）とは会計後の扱いが違う。
  // 予約の時点では「忘れた」ではなく「持っていない」（再発行待ちなど）なので、
  // 保存する値は同じまま、予約画面だけ言い方を変える
  { id: "forgot", label: "どちらも忘れた", bookingLabel: "どちらも持っていない", short: "保険証忘れ" },
];

export const INSURANCE_LABEL = Object.fromEntries(INSURANCE_OPTIONS.map((o) => [o.id, o.short]));

// 受付機の薬リスト（i18n.js の MED_IDS / meds と同一）。qty=false は個数指定なし。
export const MED_OPTIONS = [
  { id: "triquilar", label: "トリキュラー", qty: true },
  { id: "marvelon", label: "マーベロン", qty: true },
  { id: "aldactone", label: "アルダクトン", qty: true },
  { id: "slinda", label: "スリンダ錠", qty: true },
  { id: "same_as_last", label: "前回と同じ処方箋", qty: false },
];

// 初診の「ご相談内容」（任意・複数選択可）。問診票の受診理由リストと同じ項目
// （「追加処方」は再診向けのため除外）。保存は日本語ラベルの配列。
export const CONCERN_OPTIONS = [
  { id: "oc", label: "低用量ピル" },
  { id: "minipill", label: "ミニピル" },
  { id: "ec", label: "アフターピル" },
  { id: "pain", label: "生理痛" },
  { id: "irregular", label: "生理不順" },
  { id: "acne", label: "ニキビ・肌荒れ" },
  { id: "pms", label: "PMS・気分の不調" },
  { id: "menopause", label: "更年期" },
  { id: "bleeding", label: "不正出血" },
  { id: "discharge", label: "おりもの・かゆみ" },
  { id: "std", label: "性感染症検査" },
  { id: "pap", label: "子宮頸がん検診" },
  { id: "cystitis", label: "膀胱炎" },
];

// WhatsApp番号を E.164（'+' + 国番号 + 番号）に正規化する。空文字なら null。
// 形式が判定できないものは null を返し、呼び出し側でエラー表示する。
//   "+81 90-1234-5678" → "+819012345678"
//   "090-1234-5678"    → "+819012345678"（先頭0の国内表記は日本の番号とみなす）
//   "44 7700 900123"   → "+447700900123"（+なしでも国番号から始まっていれば通す）
export function toE164(input) {
  const raw = (input || "").trim();
  if (!raw) return null;
  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const e164 = hasPlus
    ? `+${digits}`
    : digits.startsWith("0")
      ? `+81${digits.slice(1)}`
      : `+${digits}`;
  // DB側の制約（^\+[1-9][0-9]{7,14}$）と同じ条件で先に弾く
  return /^\+[1-9][0-9]{7,14}$/.test(e164) ? e164 : null;
}

// 問診票（kiosk と同じ公開ページを再利用）。?booking= に予約IDを渡すと
// intake_forms.booking_id に保存され、予約・受付機どちらの画面からも引ける。
const INTAKE_BASE = "https://kladiesclinic.github.io/kiosk";

// 予約時に「事前にご記入いただけます」と案内するのはフル問診票だけ。
//   初診 / 再診・新しい症状 → フル問診票
//   再診・前回の続き → 案内しない（3項目だけなので当日の受付で書いてもらう）
//   それ以外 → なし
export function intakeUrlFor({ visitKind, returnReason, bookingId, lang = "ja" }) {
  const query = `?booking=${encodeURIComponent(bookingId)}&lang=${lang === "en" ? "en" : "ja"}`;
  if (visitKind === "first") return `${INTAKE_BASE}/intake.html${query}`;
  if (visitKind === "return" && returnReason === "new_symptom") return `${INTAKE_BASE}/intake.html${query}`;
  return null;
}

// どの問診票が要るか（要らない＝検査結果・薬受け取り）
export function intakeKindFor({ visitType, visitKind, returnReason }) {
  if (visitType !== "consult") return null;
  if (visitKind === "first") return "full";
  if (visitKind === "return" && returnReason === "new_symptom") return "full";
  if (visitKind === "return" && returnReason === "followup") return "simple";
  return null;
}

// 受付済みの人を問診票へ送るURL（?checkin= と ?token= で受付行に確実に紐付く）
export function intakeUrlForCheckin({ visitType, visitKind, returnReason, checkinId, submitToken, lang = "ja" }) {
  const kind = intakeKindFor({ visitType, visitKind, returnReason });
  if (!kind) return null;
  const file = kind === "full" ? "intake.html" : "followup.html";
  const query =
    `?checkin=${encodeURIComponent(checkinId)}&token=${encodeURIComponent(submitToken)}` +
    `&lang=${lang === "en" ? "en" : "ja"}`;
  return `${INTAKE_BASE}/${file}${query}`;
}

// まだ受付していない人（初診など、氏名をこちらで聞いていない人）を問診票へ渡すURL。
// 問診票の冒頭（氏名・カナ・生年月日・保険）を入れた時点で問診票側が受付を作る。
export function intakeHandoffUrl({ visitType, visitKind, returnReason, lineUserId, insurance, lang = "ja" }) {
  if (intakeKindFor({ visitType, visitKind, returnReason }) !== "full") return null;
  const params = new URLSearchParams({
    selfcheckin: "1",
    visit: visitType,
    lang: lang === "en" ? "en" : "ja",
  });
  if (visitKind) params.set("kind", visitKind);
  if (returnReason) params.set("reason", returnReason);
  if (lineUserId) params.set("line", lineUserId);
  // 保険は受付画面で先に聞いているので、問診票では聞き直さない
  if (insurance) params.set("ins", insurance);
  return `${INTAKE_BASE}/intake.html?${params.toString()}`;
}
