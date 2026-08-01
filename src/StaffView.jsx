import React, { useEffect, useState } from "react";
import {
  ClipboardList,
  RefreshCw,
  Printer,
  X,
  PackageCheck,
  Stethoscope,
  CheckCircle2,
  Undo2,
  FileText,
  ExternalLink,
} from "lucide-react";
import { supabase } from "./supabase.js";

const FONT_IMPORT = `
@import url('https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700&family=Noto+Sans+JP:wght@400;500;700&family=JetBrains+Mono:wght@500;600&display=swap');
`;

// 印刷時は選択中の問診票（.print-area）だけを出す
const PRINT_CSS = `
@media print {
  body { background: #FFFFFF !important; }
  .staff-screen { display: none !important; }
  .print-area { display: block !important; }
}
`;

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

const INSURANCE_LABEL = { mynumber: "マイナ保険証", self_pay: "自費" };

export default function StaffView() {
  const [checkins, setCheckins] = useState([]);
  const [forms, setForms] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selectedForm, setSelectedForm] = useState(null);
  const [loadError, setLoadError] = useState("");

  const load = async () => {
    const today = todayKey();
    const [cRes, fRes] = await Promise.all([
      supabase.from("reception_checkins").select("*").eq("date_key", today).order("checkin_number", { ascending: true }),
      supabase.from("intake_forms").select("*").eq("date_key", today).order("created_at", { ascending: false }),
    ]);
    if (cRes.error || fRes.error) {
      setLoadError((cRes.error || fRes.error).message);
      return;
    }
    setLoadError("");
    setCheckins(cRes.data || []);
    setForms(fRes.data || []);
    setLastUpdated(new Date());
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  // 受付行に対応する問診票を名前（空白除去の部分一致）で探す
  const formFor = (name) => {
    const n = normalizeName(name);
    if (!n) return null;
    return (
      forms.find((f) => {
        const fn = normalizeName(f.patient_name);
        return fn === n || fn.includes(n) || n.includes(fn);
      }) || null
    );
  };

  const toggleStatus = async (row) => {
    const next = row.status === "waiting" ? "done" : "waiting";
    const { error } = await supabase.from("reception_checkins").update({ status: next }).eq("id", row.id);
    if (!error) load();
  };

  const waiting = checkins.filter((c) => c.status === "waiting");

  return (
    <div style={{ fontFamily: "'Noto Sans JP', sans-serif" }}>
      <style>{FONT_IMPORT}</style>
      <style>{PRINT_CSS}</style>

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
                {todayKey()}　待ち {waiting.length}件
                {lastUpdated && `最終更新 ${hhmm(lastUpdated.toISOString())}（10秒ごとに自動更新）`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
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

        <main className="p-6 flex flex-col gap-8 max-w-5xl mx-auto">
          {loadError && (
            <div className="p-4 rounded-xl text-sm" style={{ background: "#FCE9EA", color: "#B03A44" }}>
              読み込みエラー: {loadError}
            </div>
          )}

          {/* 受付リスト */}
          <section>
            <h2 className="text-lg font-bold mb-3" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
              本日の受付
            </h2>
            {checkins.length === 0 ? (
              <p className="text-sm" style={{ color: "#B08A90" }}>まだ受付はありません。</p>
            ) : (
              <div className="rounded-2xl overflow-hidden" style={{ background: "#FFFFFF", border: "1px solid #F2DFE4" }}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ color: "#3A2E30", minWidth: 760 }}>
                    <thead>
                      <tr className="text-left text-xs" style={{ color: "#B08A90", background: "#FFF8F7" }}>
                        <th className="px-4 py-2.5 font-medium">番号</th>
                        <th className="px-3 py-2.5 font-medium">時刻</th>
                        <th className="px-3 py-2.5 font-medium">お名前</th>
                        <th className="px-3 py-2.5 font-medium">種別</th>
                        <th className="px-3 py-2.5 font-medium">お薬</th>
                        <th className="px-3 py-2.5 font-medium">保険</th>
                        <th className="px-3 py-2.5 font-medium">診察番号</th>
                        <th className="px-3 py-2.5 font-medium">問診票</th>
                        <th className="px-3 py-2.5 font-medium">状態</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checkins.map((c) => {
                        const f = c.visit_type === "consult" ? formFor(c.patient_name) : null;
                        const isDone = c.status === "done";
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
                            <td className="px-3 py-3 text-xs" style={{ color: "#8A7378" }}>
                              {(c.medications || []).join("、") || "—"}
                            </td>
                            <td className="px-3 py-3 text-xs">{INSURANCE_LABEL[c.insurance] || "—"}</td>
                            <td className="px-3 py-3 text-xs" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{c.chart_number || "—"}</td>
                            <td className="px-3 py-3">
                              {c.visit_type === "consult" ? (
                                f ? (
                                  <button
                                    onClick={() => setSelectedForm(f)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium active:opacity-70"
                                    style={{ background: "#0F8B8D", color: "#FFFFFF" }}
                                  >
                                    <FileText size={12} />
                                    表示
                                  </button>
                                ) : (
                                  <span className="text-xs" style={{ color: "#C9AEB3" }}>未提出</span>
                                )
                              ) : (
                                <span className="text-xs" style={{ color: "#C9AEB3" }}>—</span>
                              )}
                            </td>
                            <td className="px-3 py-3">
                              <button
                                onClick={() => toggleStatus(c)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium active:opacity-70"
                                style={
                                  isDone
                                    ? { background: "#FFF8F7", border: "1px solid #F2DFE4", color: "#8A7378" }
                                    : { background: "#DFF5F3", color: "#0F8B8D" }
                                }
                              >
                                {isDone ? <Undo2 size={12} /> : <CheckCircle2 size={12} />}
                                {isDone ? "待ちに戻す" : "対応済みにする"}
                              </button>
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
              本日の問診票
            </h2>
            {forms.length === 0 ? (
              <p className="text-sm" style={{ color: "#B08A90" }}>まだ問診票の提出はありません。</p>
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
                        <div className="text-sm font-medium truncate" style={{ color: "#3A2E30" }}>{f.patient_name}</div>
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
        </main>

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
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium active:opacity-70"
                    style={{ background: "#0F8B8D", color: "#FFFFFF" }}
                  >
                    <Printer size={15} />
                    印刷
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

      {/* 印刷専用レイアウト（画面には出さない） */}
      {selectedForm && (
        <div className="print-area" style={{ display: "none", color: "#000000", fontSize: 11 }}>
          <div style={{ borderBottom: "2px solid #000000", paddingBottom: 6, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <strong style={{ fontSize: 14 }}>問診票 ／ Questionnaire</strong>
            <span style={{ fontSize: 10 }}>
              {selectedForm.patient_name}
              {selectedForm.date_of_birth ? `（${selectedForm.date_of_birth}）` : ""}　{selectedForm.date_key} {hhmm(selectedForm.created_at)} 受信
            </span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
            <tbody>
              {(selectedForm.answers || []).map((row, i) => (
                <tr key={i}>
                  <td style={{ border: "1px solid #999999", padding: "3px 6px", width: "45%", color: "#333333" }}>{row.label}</td>
                  <td style={{ border: "1px solid #999999", padding: "3px 6px", fontWeight: 600 }}>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
