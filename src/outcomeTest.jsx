// 開発用: オンライン診療の「診察」列（完了／未完了／理由）の見た目と動きの確認。
// 保存はせず、画面の中だけで状態を持つ（Supabase は呼ばない）。 /outcome-test.html で開く
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { ConsultOutcomeCell } from "./StaffView.jsx";

const ROWS = [
  { reserveId: 1, time: "11:00", name: "テスト 一郎", status: 2, at: "2026-11-17T11:00:00+09:00" },
  { reserveId: 2, time: "11:20", name: "テスト 二子", status: 3, at: "2026-11-17T11:20:00+09:00" },
  { reserveId: 3, time: "14:30", name: "テスト 三子（当日順番待ち）", status: 5, at: "2026-11-17T14:30:00+09:00" },
  { reserveId: 4, time: "15:10", name: "テスト 四子", status: 2, at: "2026-11-17T15:10:00+09:00" },
  { reserveId: 5, time: "16:30", name: "テスト 五子", status: 5, at: "2026-11-17T16:30:00+09:00" },
];
const INIT = {
  2: { reserve_id: 2, outcome: "done", updated_by_name: "受付A", updated_at: "2026-11-17T11:35:00+09:00" },
  4: { reserve_id: 4, outcome: "not_done", reason: "患者さんが入室しなかった。15:25 に電話したが出ず", updated_by_name: "受付B", updated_at: "2026-11-17T15:30:00+09:00" },
  5: { reserve_id: 5, outcome: "not_done", reason: null, updated_by_name: "受付B", updated_at: "2026-11-17T18:35:00+09:00" },
};

function App() {
  const [recs, setRecs] = useState(INIT);
  const [edit, setEdit] = useState(null);
  const [log, setLog] = useState([]);
  const onSave = (row, outcome, reason) => {
    setRecs((m) => ({ ...m, [row.reserveId]: { reserve_id: row.reserveId, outcome, reason: outcome === "not_done" ? reason.trim() || null : null, updated_by_name: "テスト", updated_at: new Date().toISOString() } }));
    setEdit(null);
    setLog((l) => [...l, `save ${row.reserveId} ${outcome} ${reason || ""}`]);
  };
  const onClear = (row) => {
    setRecs((m) => { const c = { ...m }; delete c[row.reserveId]; return c; });
    setLog((l) => [...l, `clear ${row.reserveId}`]);
  };
  return (
    <div style={{ padding: 16, background: "#FFF8F7", minHeight: "100vh" }}>
      <div className="rounded-2xl overflow-hidden" style={{ background: "#FFFFFF", border: "1px solid #F2DFE4", maxWidth: 900 }}>
        <table className="w-full text-sm" style={{ color: "#3A2E30" }}>
          <thead>
            <tr className="text-left text-xs" style={{ color: "#B08A90", background: "#FFF8F7" }}>
              <th className="px-3 py-2.5 font-medium">時間</th>
              <th className="px-2 py-2.5 font-medium">お名前</th>
              <th className="px-2 py-2.5 font-medium">診察</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.reserveId} style={{ borderTop: "1px solid #FAEEF0" }} data-row={row.reserveId}>
                <td className="px-3 py-3 font-bold align-top" style={{ color: "#0F8B8D" }}>{row.time}</td>
                <td className="px-2 py-3 align-top">{row.name}</td>
                <td className="px-2 py-3 align-top">
                  <ConsultOutcomeCell row={row} rec={recs[row.reserveId]} edit={edit} saving={null} onSave={onSave} onClear={onClear} onEdit={setEdit} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <pre id="log" style={{ fontSize: 11, color: "#8A7378", marginTop: 12 }}>{log.join("\n")}</pre>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
