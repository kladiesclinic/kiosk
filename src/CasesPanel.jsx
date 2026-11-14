import React, { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import JSZip from "jszip";
import { Plus, X, Camera, Download, Trash2, ArrowUp, ArrowDown, Star, Copy } from "lucide-react";
import { supabase } from "./supabase.js";

// 口コミ・症例写真（ビフォーアフター）の管理タブ。
// 行を作る → 患者さんにQR/URL（booking-app の /case?tk=）を渡す → 患者さんがスマホで口コミ・写真・同意・署名を提出
// → ここで確認・ビフォーアフターの組み合わせ・施術記録（広告ガイドラインの併記事項）・承認・ZIPダウンロード。
// DB は booking-app/supabase/079_case_submissions.sql。写真は非公開バケット case-photos（署名URLで表示）。

export const CASE_URL = "https://keicuri-booking.vercel.app/case";
const BUCKET = "case-photos";

const STATUS = {
  invited: { label: "未提出", bg: "#F3EFEF", fg: "#8A7378" },
  submitted: { label: "未確認", bg: "#FCE9EA", fg: "#B03A44" },
  approved: { label: "使用OK", bg: "#DFF5F3", fg: "#127D82" },
  rejected: { label: "使用しない", bg: "#F3EFEF", fg: "#8A7378" },
  published: { label: "掲載済み", bg: "#E6EEFB", fg: "#2D5AA8" },
  archived: { label: "取り下げ", bg: "#F3EFEF", fg: "#8A7378" },
};
const FILTERS = [
  { id: "todo", label: "未確認", match: (s) => s === "submitted" },
  { id: "invited", label: "未提出", match: (s) => s === "invited" },
  { id: "ok", label: "使用OK・掲載済み", match: (s) => s === "approved" || s === "published" },
  { id: "all", label: "すべて", match: () => true },
];

const C = {
  ink: "#3A2E30", muted: "#8A7378", faint: "#B08A90", line: "#F2DFE4", bg: "#FFF8F7",
  teal: "#0F8B8D", tealDark: "#127D82", alert: "#D64550", alertBg: "#FCE9EA",
};
const card = { background: "#FFFFFF", border: `1px solid ${C.line}`, borderRadius: 16 };
const input = { background: C.bg, border: `1.5px solid ${C.line}`, color: C.ink };
const heading = { color: C.ink, fontFamily: "'Zen Kaku Gothic New', sans-serif" };

const fmtDate = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};
const ymd = (ts) => {
  const d = new Date(ts || Date.now());
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
};

// 長辺2000pxのJPEGに縮小（canvasを通すのでEXIF・位置情報は残らない）。患者さん用ページと同じ処理
async function shrinkImage(file, maxSide = 2000) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  let src = bitmap;
  if (!src) {
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  const scale = Math.min(1, maxSide / Math.max(src.width, src.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(src.width * scale);
  canvas.height = Math.round(src.height * scale);
  canvas.getContext("2d").drawImage(src, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
}

function ConsentBadges({ row }) {
  const items = [
    (row.consent_hp || row.consent_sns || row.consent_ads) && "媒体使用OK",
    row.status !== "invited" && (row.face_visible_ok ? "顔出し可" : "顔NG"),
  ].filter(Boolean);
  return (
    <span className="inline-flex gap-1 flex-wrap">
      {items.map((t) => (
        <span key={t} className="text-[10px] font-bold px-1.5 py-0.5 rounded"
          style={t === "顔NG" ? { background: C.alertBg, color: "#B03A44" } : { background: C.bg, color: C.tealDark, border: `1px solid ${C.line}` }}>
          {t}
        </span>
      ))}
    </span>
  );
}

function StatusPill({ status }) {
  const s = STATUS[status] || STATUS.invited;
  return <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: s.bg, color: s.fg }}>{s.label}</span>;
}

function QrModal({ row, onClose }) {
  const url = `${CASE_URL}?tk=${row.token}`;
  const [dataUrl, setDataUrl] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    QRCode.toDataURL(url, { width: 520, margin: 1, color: { dark: "#3A2E30", light: "#FFFFFF" } }).then(setDataUrl).catch(() => {});
  }, [url]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(58,46,48,.45)" }} onClick={onClose}>
      <div className="p-6 text-center max-w-sm w-full" style={card} onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-bold mb-1" style={heading}>{row.patient_name ? `${row.patient_name} 様` : "Google口コミ 申請フォーム"}</div>
        <div className="text-xs mb-4" style={{ color: C.faint }}>スマホのカメラで読み取ってもらってください（90日有効・1回だけ提出できます）</div>
        {dataUrl ? <img src={dataUrl} alt="提出フォームのQRコード" width={260} height={260} className="mx-auto rounded-xl" /> : <div style={{ width: 260, height: 260 }} className="mx-auto" />}
        <div className="mt-4 flex gap-2 justify-center">
          <button
            onClick={() => navigator.clipboard?.writeText(url).then(() => setCopied(true))}
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl text-sm font-medium"
            style={{ background: "#FFFFFF", border: `1.5px solid ${C.line}`, color: C.tealDark }}
          >
            <Copy size={14} /> {copied ? "コピーしました" : "URLをコピー"}
          </button>
          <button onClick={onClose} className="h-10 px-4 rounded-xl text-sm font-bold" style={{ background: C.teal, color: "#FFFFFF" }}>閉じる</button>
        </div>
      </div>
    </div>
  );
}

// 1件分の info.txt（掲載時の併記事項の控え。患者の氏名・連絡先は入れない）
function infoText(row, photos) {
  const r = photos.filter((p) => p.kind === "review").length;
  const b = photos.filter((p) => p.kind === "before").length;
  const a = photos.filter((p) => p.kind === "after").length;
  return [
    `症例ID: ${row.id}`,
    `施術: ${row.treatment || "（未記入）"}`,
    `期間・回数: ${row.treatment_period || "（未記入）"}`,
    `費用: ${row.cost || "（未記入）"}`,
    `リスク・副作用: ${row.risks || "（未記入）"}`,
    "",
    `媒体（Instagramなど）での使用: ${row.consent_hp || row.consent_sns || row.consent_ads ? "同意あり" : "同意なし"}`,
    `顔が写った写真の使用: ${row.face_visible_ok ? "可" : "不可（顔が分からないよう加工・トリミングすること）"}`,
    `同意日: ${fmtDate(row.signed_at)}`,
    `写真: Google口コミのスクショ${r}枚 / ビフォー${b}枚 / アフター${a}枚`,
    "",
    "※ 医療広告ガイドライン: ビフォーアフター写真には施術内容・費用・リスク/副作用を必ず併記すること。",
    "",
    row.review_text ? `【口コミ】${row.rating ? `（満足度 ${row.rating}/5）` : ""}\n${row.review_text}` : "【口コミ】なし",
  ].join("\n");
}

async function addCaseToZip(zip, row, photos) {
  const folder = zip.folder(`${ymd(row.signed_at || row.created_at)}_${(row.treatment || "case").replace(/[\\/:*?"<>|\s]+/g, "_")}_${row.id.slice(0, 8)}`);
  folder.file("info.txt", infoText(row, photos));
  const counters = { review: 0, before: 0, after: 0 };
  for (const p of photos) {
    const { data, error } = await supabase.storage.from(BUCKET).download(p.storage_path);
    if (error) throw error;
    counters[p.kind] += 1;
    folder.file(`${p.kind === "review" ? "google_review" : p.kind}_${counters[p.kind]}${p.taken_on ? `_${p.taken_on}` : ""}.jpg`, data);
  }
}

async function saveZip(zip, name) {
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function DetailModal({ row: initial, myName, onClose, onChanged }) {
  const [row, setRow] = useState(initial);
  const [photos, setPhotos] = useState([]);
  const [urls, setUrls] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dirty, setDirty] = useState(false);
  const [uploadKind, setUploadKind] = useState("before");
  const fileRef = useRef(null);

  const loadPhotos = async () => {
    const { data, error } = await supabase.from("case_photos").select("*").eq("submission_id", row.id).order("kind").order("sort");
    if (error) return setErr(error.message);
    setPhotos(data || []);
    const missing = (data || []).map((p) => p.storage_path).filter((p) => !urls[p]);
    if (missing.length) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(missing, 3600);
      setUrls((prev) => ({ ...prev, ...Object.fromEntries((signed || []).map((s) => [s.path, s.signedUrl])) }));
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadPhotos(); }, [row.id]);

  const setField = (k, v) => { setRow((r) => ({ ...r, [k]: v })); setDirty(true); };

  const save = async (patch = {}) => {
    setBusy(true);
    setErr("");
    const fields = {
      patient_name: row.patient_name || null,
      chart_no: row.chart_no || null,
      treatment: row.treatment || null,
      treatment_period: row.treatment_period || null,
      cost: row.cost || null,
      risks: row.risks || null,
      staff_note: row.staff_note || null,
      ...patch,
    };
    const { data, error } = await supabase.from("case_submissions").update(fields).eq("id", row.id).select("*").single();
    setBusy(false);
    if (error) { setErr(`保存できませんでした: ${error.message}`); return false; }
    setRow(data);
    setDirty(false);
    onChanged();
    return true;
  };

  const setStatus = async (status) => {
    if ((status === "approved" || status === "published") && photos.some((p) => p.kind !== "review") && (!row.treatment || !row.cost || !row.risks)) {
      setErr("写真を使う場合は、施術・費用・リスク/副作用を記入してください（医療広告ガイドラインの併記事項）。");
      return;
    }
    const { data: auth } = await supabase.auth.getUser();
    await save({ status, reviewed_by: auth?.user?.id || null, reviewed_at: new Date().toISOString() });
  };

  const updatePhoto = async (p, patch) => {
    const { error } = await supabase.from("case_photos").update(patch).eq("id", p.id);
    if (error) return setErr(error.message);
    loadPhotos();
  };
  const move = async (p, dir) => {
    const same = photos.filter((x) => x.kind === p.kind);
    const i = same.findIndex((x) => x.id === p.id);
    const j = i + dir;
    if (j < 0 || j >= same.length) return;
    const other = same[j];
    // sort が重複していても入れ替わるよう、位置で振り直す
    await Promise.all(same.map((x, k) => {
      const pos = x.id === p.id ? j : x.id === other.id ? i : k;
      return supabase.from("case_photos").update({ sort: pos }).eq("id", x.id);
    }));
    loadPhotos();
  };
  const removePhoto = async (p) => {
    if (!window.confirm("この写真を削除します。元に戻せません。よろしいですか？")) return;
    const { error } = await supabase.storage.from(BUCKET).remove([p.storage_path]);
    if (error) return setErr(error.message);
    await supabase.from("case_photos").delete().eq("id", p.id);
    loadPhotos();
  };

  const upload = async (files) => {
    setBusy(true);
    setErr("");
    try {
      let sort = photos.filter((p) => p.kind === uploadKind).length;
      for (const f of Array.from(files || [])) {
        if (!f.type.startsWith("image/")) continue;
        const blob = await shrinkImage(f);
        const path = `${row.token}/${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
        if (upErr) throw upErr;
        const { error: insErr } = await supabase.from("case_photos")
          .insert({ submission_id: row.id, storage_path: path, kind: uploadKind, uploaded_by: "staff", sort: sort++ });
        if (insErr) throw insErr;
      }
      await loadPhotos();
      onChanged();
    } catch (e) {
      setErr(`アップロードできませんでした: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setBusy(true);
    try {
      const zip = new JSZip();
      await addCaseToZip(zip, row, photos);
      await saveZip(zip, `case_${ymd(row.signed_at || row.created_at)}_${row.id.slice(0, 8)}.zip`);
    } catch (e) {
      setErr(`ダウンロードできませんでした: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("この症例（写真・口コミ・同意記録すべて）を削除します。元に戻せません。よろしいですか？")) return;
    setBusy(true);
    if (photos.length) await supabase.storage.from(BUCKET).remove(photos.map((p) => p.storage_path));
    const { error } = await supabase.from("case_submissions").delete().eq("id", row.id);
    setBusy(false);
    if (error) return setErr(error.message);
    onChanged();
    onClose();
  };

  const field = (k, label, ph, wide) => (
    <label className={wide ? "col-span-2" : ""}>
      <div className="text-[11px] mb-1" style={{ color: C.muted }}>{label}</div>
      <input value={row[k] || ""} onChange={(e) => setField(k, e.target.value)} placeholder={ph}
        className="w-full h-10 px-3 rounded-lg text-sm outline-none" style={input} />
    </label>
  );

  const column = (kind, title) => {
    const list = photos.filter((p) => p.kind === kind);
    return (
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold mb-2" style={{ color: C.tealDark }}>{title}（{list.length}）</div>
        <div className="flex flex-col gap-3">
          {list.length === 0 && <div className="text-xs p-6 rounded-xl text-center" style={{ background: C.bg, color: C.faint }}>写真なし</div>}
          {list.map((p, i) => (
            <div key={p.id} className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
              {urls[p.storage_path]
                ? <a href={urls[p.storage_path]} target="_blank" rel="noreferrer"><img src={urls[p.storage_path]} alt="" className="w-full block" style={{ maxHeight: 320, objectFit: "contain", background: "#F7F2F2" }} /></a>
                : <div style={{ height: 200, background: "#F7F2F2" }} />}
              <div className="flex items-center gap-1.5 p-2 flex-wrap text-xs" style={{ color: C.muted }}>
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: C.bg }}>{p.uploaded_by === "patient" ? "患者さん" : "スタッフ"}</span>
                <input type="date" value={p.taken_on || ""} onChange={(e) => updatePhoto(p, { taken_on: e.target.value || null })}
                  className="h-8 px-2 rounded-lg text-xs outline-none" style={input} title="撮影日" />
                {kind !== "review" && (
                  <button onClick={() => updatePhoto(p, { kind: kind === "before" ? "after" : "before" })}
                    className="h-8 px-2 rounded-lg font-medium" style={{ border: `1px solid ${C.line}`, color: C.tealDark }}>
                    {kind === "before" ? "→ アフターへ" : "← ビフォーへ"}
                  </button>
                )}
                <button onClick={() => move(p, -1)} disabled={i === 0} className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ border: `1px solid ${C.line}`, opacity: i === 0 ? 0.3 : 1 }} aria-label="上へ"><ArrowUp size={14} /></button>
                <button onClick={() => move(p, 1)} disabled={i === list.length - 1} className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ border: `1px solid ${C.line}`, opacity: i === list.length - 1 ? 0.3 : 1 }} aria-label="下へ"><ArrowDown size={14} /></button>
                <button onClick={() => removePhoto(p)} className="h-8 w-8 rounded-lg flex items-center justify-center ml-auto" style={{ color: C.alert }} aria-label="削除"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto" style={{ background: "rgba(58,46,48,.45)" }}>
      <div className="w-full max-w-4xl p-5 my-4" style={card}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-bold" style={heading}>{row.patient_name || "（名前なし）"}</h3>
              <StatusPill status={row.status} />
            </div>
            <div className="text-xs flex items-center gap-2 flex-wrap" style={{ color: C.faint }}>
              作成 {fmtDate(row.created_at)}{row.signed_at && ` ／ 提出 ${fmtDate(row.signed_at)}（署名: ${row.signature_name}）`}
              <ConsentBadges row={row} />
            </div>
          </div>
          <button onClick={() => { if (!dirty || window.confirm("保存していない変更があります。閉じますか？")) onClose(); }} aria-label="閉じる"><X size={22} color={C.muted} /></button>
        </div>

        {err && <div className="p-3 rounded-xl text-sm mb-3" style={{ background: C.alertBg, color: "#B03A44" }}>{err}</div>}

        {(row.packing_no || row.card_last4) && (
          <div className="flex gap-3 flex-wrap mb-4">
            <div className="px-3 py-2 rounded-xl text-sm" style={{ background: C.bg, border: `1px solid ${C.line}` }}>
              <span className="text-[11px] mr-2" style={{ color: C.muted }}>梱包票</span>
              <b style={{ fontFamily: "monospace", letterSpacing: 1 }}>#{row.packing_no || "—"}</b>
            </div>
            <div className="px-3 py-2 rounded-xl text-sm" style={{ background: C.bg, border: `1px solid ${C.line}` }}>
              <span className="text-[11px] mr-2" style={{ color: C.muted }}>カード下4桁</span>
              <b style={{ fontFamily: "monospace", letterSpacing: 2 }}>{row.card_last4 || "—"}</b>
            </div>
          </div>
        )}

        {/* Google口コミのスクリーンショット */}
        <div className="mb-4" style={{ maxWidth: 420 }}>{column("review", "Google口コミのスクリーンショット")}</div>

        {/* ビフォー / アフター並べて表示 */}
        <div className="flex gap-4 mb-3">
          {column("before", "ビフォー")}
          {column("after", "アフター")}
        </div>
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <select value={uploadKind} onChange={(e) => setUploadKind(e.target.value)} className="h-10 px-2 rounded-lg text-sm" style={input}>
            <option value="review">口コミのスクショに</option>
            <option value="before">ビフォーに</option>
            <option value="after">アフターに</option>
          </select>
          <button onClick={() => fileRef.current?.click()} disabled={busy}
            className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl text-sm font-medium" style={{ background: "#FFFFFF", border: `1.5px solid ${C.line}`, color: C.tealDark }}>
            <Camera size={15} /> 写真を追加（院内撮影）
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        </div>

        {/* 施術の記録（広告ガイドラインの併記事項） */}
        <div className="text-sm font-bold mb-2" style={heading}>施術の記録（掲載時に併記）</div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          {field("patient_name", "お名前（院内用・掲載しない）", "")}
          {field("chart_no", "カルテ番号", "")}
          {field("treatment", "施術内容", "例: ピーリング（ニキビ治療）")}
          {field("treatment_period", "期間・回数", "例: 2週間おきに5回")}
          {field("cost", "費用", "例: 1回 8,800円（税込）×5回")}
          {field("risks", "リスク・副作用", "例: 赤み・乾燥・ヒリつきが出ることがあります", true)}
        </div>
        <label className="block mb-4">
          <div className="text-[11px] mb-1" style={{ color: C.muted }}>スタッフメモ</div>
          <textarea value={row.staff_note || ""} onChange={(e) => setField("staff_note", e.target.value)} rows={2}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={input} />
        </label>

        {/* 口コミ */}
        {row.review_text && <div className="text-sm font-bold mb-2 flex items-center gap-2" style={heading}>
          口コミ本文
          {row.rating ? <span className="inline-flex">{[1, 2, 3, 4, 5].map((n) => <Star key={n} size={14} color={C.teal} fill={n <= row.rating ? C.teal : "none"} />)}</span> : null}
        </div>}
        {row.review_text ? (
          <div className="p-3 rounded-xl text-sm whitespace-pre-wrap mb-4" style={{ background: C.bg, color: C.ink }}>{row.review_text}</div>
        ) : null}

        {row.consent_text_snapshot && (
          <details className="mb-4">
            <summary className="text-xs cursor-pointer" style={{ color: C.muted }}>同意の内容（提出時の文面）</summary>
            <pre className="text-[11px] whitespace-pre-wrap p-3 rounded-xl mt-2" style={{ background: C.bg, color: C.muted, fontFamily: "inherit" }}>{row.consent_text_snapshot}</pre>
          </details>
        )}

        <div className="flex items-center gap-2 flex-wrap pt-3" style={{ borderTop: `1px solid ${C.line}` }}>
          <button onClick={() => save()} disabled={busy || !dirty} className="h-10 px-4 rounded-xl text-sm font-bold"
            style={{ background: C.teal, color: "#FFFFFF", opacity: busy || !dirty ? 0.4 : 1 }}>保存</button>
          {row.status !== "invited" && (
            <>
              <button onClick={() => setStatus("approved")} disabled={busy} className="h-10 px-3 rounded-xl text-sm font-medium" style={{ border: `1.5px solid ${C.line}`, color: C.tealDark }}>使用OK</button>
              <button onClick={() => setStatus("published")} disabled={busy} className="h-10 px-3 rounded-xl text-sm font-medium" style={{ border: `1.5px solid ${C.line}`, color: "#2D5AA8" }}>掲載済みにする</button>
              <button onClick={() => setStatus("rejected")} disabled={busy} className="h-10 px-3 rounded-xl text-sm font-medium" style={{ border: `1.5px solid ${C.line}`, color: C.muted }}>使用しない</button>
              <button onClick={() => setStatus("archived")} disabled={busy} className="h-10 px-3 rounded-xl text-sm font-medium" style={{ border: `1.5px solid ${C.line}`, color: C.muted }} title="同意の撤回など">取り下げ</button>
            </>
          )}
          <button onClick={download} disabled={busy || photos.length === 0}
            className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl text-sm font-medium ml-auto" style={{ border: `1.5px solid ${C.line}`, color: C.tealDark }}>
            <Download size={15} /> ZIPでダウンロード
          </button>
          <button onClick={remove} disabled={busy} className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ color: C.alert }} aria-label="症例を削除"><Trash2 size={16} /></button>
        </div>
        {myName && <div className="text-[10px] mt-2" style={{ color: C.faint }}>操作者: {myName}</div>}
      </div>
    </div>
  );
}

export default function CasesPanel({ myName, onCountChange }) {
  const [rows, setRows] = useState(null);
  const [counts, setCounts] = useState({});
  const [thumbs, setThumbs] = useState({});
  const [filter, setFilter] = useState("todo");
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTreatment, setNewTreatment] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = async () => {
    const { data, error } = await supabase.from("case_submissions").select("*").order("created_at", { ascending: false }).limit(300);
    if (error) return setErr(error.message);
    setErr("");
    setRows(data || []);
    onCountChange?.((data || []).filter((r) => r.status === "submitted").length);
    const ids = (data || []).map((r) => r.id);
    if (!ids.length) return;
    const { data: ph } = await supabase.from("case_photos").select("submission_id, storage_path, kind, sort").in("submission_id", ids).order("sort");
    const cnt = {};
    const first = {};
    for (const p of ph || []) {
      cnt[p.submission_id] = cnt[p.submission_id] || { review: 0, before: 0, after: 0 };
      cnt[p.submission_id][p.kind] += 1;
      // 一覧のサムネイルはビフォーを優先（無ければ最初の1枚）
      if (!first[p.submission_id] || (first[p.submission_id].kind !== "before" && p.kind === "before")) first[p.submission_id] = p;
    }
    setCounts(cnt);
    const paths = Object.values(first).map((p) => p.storage_path);
    if (paths.length) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
      const byPath = Object.fromEntries((signed || []).map((s) => [s.path, s.signedUrl]));
      setThumbs(Object.fromEntries(Object.entries(first).map(([id, p]) => [id, byPath[p.storage_path]])));
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter) || FILTERS[3];
    const s = q.trim();
    return (rows || []).filter((r) => f.match(r.status) && (!s || `${r.patient_name || ""} ${r.treatment || ""} ${r.chart_no || ""} ${r.packing_no || ""}`.includes(s.replace(/^#/, ""))));
  }, [rows, filter, q]);

  const createRow = async () => {
    if (busy) return;
    setBusy(true);
    const { data, error } = await supabase.from("case_submissions")
      .insert({ patient_name: newName.trim() || null, treatment: newTreatment.trim() || null })
      .select("*").single();
    setBusy(false);
    if (error) return setErr(error.message);
    setCreating(false);
    setNewName("");
    setNewTreatment("");
    setQr(data);
    load();
  };

  const downloadAllOk = async () => {
    const targets = (rows || []).filter((r) => r.status === "approved");
    if (!targets.length) return;
    setBusy(true);
    try {
      const zip = new JSZip();
      const { data: ph, error } = await supabase.from("case_photos").select("*").in("submission_id", targets.map((r) => r.id)).order("kind").order("sort");
      if (error) throw error;
      for (const r of targets) await addCaseToZip(zip, r, (ph || []).filter((p) => p.submission_id === r.id));
      await saveZip(zip, `cases_使用OK_${ymd()}.zip`);
    } catch (e) {
      setErr(`ダウンロードできませんでした: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const approvedCount = (rows || []).filter((r) => r.status === "approved").length;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold mb-1" style={heading}>Google口コミ・症例写真の申請</h2>
          <p className="text-xs" style={{ color: C.faint }}>
            Google口コミを投稿した患者さんにQRを渡すと、スマホから口コミのスクリーンショット（必須）・ビフォーアフター写真・媒体での使用への同意を申請できます。届いたものを確認して「使用OK」にしてください。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={downloadAllOk} disabled={busy || approvedCount === 0}
            className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl text-sm font-medium"
            style={{ background: "#FFFFFF", border: `1.5px solid ${C.line}`, color: C.tealDark, opacity: approvedCount === 0 ? 0.4 : 1 }}>
            <Download size={14} /> 使用OKをまとめてZIP（{approvedCount}）
          </button>
          <button onClick={() => setCreating((v) => !v)}
            className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl text-sm font-bold" style={{ background: C.teal, color: "#FFFFFF" }}>
            <Plus size={14} /> 新規QR発行
          </button>
        </div>
      </div>

      {err && <div className="p-3 rounded-xl text-sm" style={{ background: C.alertBg, color: "#B03A44" }}>{err}</div>}

      {creating && (
        <div className="p-4 flex items-end gap-3 flex-wrap" style={{ ...card, background: C.bg }}>
          <label>
            <div className="text-[11px] mb-1" style={{ color: C.muted }}>お名前（院内用）</div>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} className="h-10 px-3 rounded-lg text-sm outline-none" style={{ ...input, background: "#FFFFFF" }} placeholder="山田 花子" />
          </label>
          <label>
            <div className="text-[11px] mb-1" style={{ color: C.muted }}>施術内容</div>
            <input value={newTreatment} onChange={(e) => setNewTreatment(e.target.value)} className="h-10 px-3 rounded-lg text-sm outline-none" style={{ ...input, background: "#FFFFFF", width: 240 }} placeholder="例: ピーリング（ニキビ治療）" />
          </label>
          <button onClick={createRow} disabled={busy} className="h-10 px-4 rounded-xl text-sm font-bold" style={{ background: C.teal, color: "#FFFFFF" }}>QRを作る</button>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-xl overflow-hidden" style={{ border: `1.5px solid ${C.line}`, background: "#FFFFFF" }}>
          {FILTERS.map((f) => {
            const n = (rows || []).filter((r) => f.match(r.status)).length;
            return (
              <button key={f.id} onClick={() => setFilter(f.id)} className="px-4 py-2 text-sm font-bold"
                style={filter === f.id ? { background: C.teal, color: "#FFFFFF" } : { color: C.muted }}>
                {f.label} {n}
              </button>
            );
          })}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="名前・施術・カルテ番号・梱包票で検索"
          className="h-10 px-3 rounded-xl text-sm outline-none" style={{ background: "#FFFFFF", border: `1.5px solid ${C.line}`, color: C.ink, width: 240 }} />
      </div>

      <div style={card} className="overflow-hidden">
        {rows === null ? (
          <div className="p-6 text-sm text-center" style={{ color: C.faint }}>読み込み中…</div>
        ) : shown.length === 0 ? (
          <div className="p-6 text-sm text-center" style={{ color: C.faint }}>該当するものはありません</div>
        ) : shown.map((r) => (
          <div key={r.id} className="flex items-center gap-3 p-3" style={{ borderBottom: `1px solid ${C.line}` }}>
            <button onClick={() => setDetail(r)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
              <div className="w-14 h-14 rounded-lg overflow-hidden shrink-0 flex items-center justify-center" style={{ background: C.bg }}>
                {thumbs[r.id] ? <img src={thumbs[r.id]} alt="" className="w-full h-full object-cover" /> : <Camera size={18} color={C.faint} />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold" style={{ color: C.ink }}>{r.patient_name || "（名前なし）"}</span>
                  <StatusPill status={r.status} />
                  <ConsentBadges row={r} />
                </div>
                <div className="text-xs truncate" style={{ color: C.muted }}>
                  {r.packing_no && `#${r.packing_no}　`}
                  {r.treatment || "施術未記入"}
                  {counts[r.id] && `　スクショ${counts[r.id].review}・ビフォー${counts[r.id].before}・アフター${counts[r.id].after}`}
                  {`　${fmtDate(r.signed_at || r.created_at)}`}
                </div>
              </div>
            </button>
            {r.status === "invited" && (
              <button onClick={() => setQr(r)} className="h-9 px-3 rounded-xl text-xs font-medium shrink-0" style={{ border: `1.5px solid ${C.line}`, color: C.tealDark }}>QRを表示</button>
            )}
          </div>
        ))}
      </div>

      {qr && <QrModal row={qr} onClose={() => setQr(null)} />}
      {detail && <DetailModal row={detail} myName={myName} onClose={() => setDetail(null)} onChanged={load} />}
    </section>
  );
}
