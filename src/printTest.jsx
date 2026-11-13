// 1日の予定表の印刷テストページ（開発用・ビルドには含まれない）。
// http://localhost:5175/print-test.html で開く。
// 最悪ケースのデータで ScheduleSheet を組み、左に素のDOM・右に captureElement()
// （＝実際にPDFへ載る画像）を並べる。字の下が欠けていないか・あふれた枠が
// 直下の空き枠へ食い込んでいるかを目視で確かめる。
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ScheduleSheet,
  captureElement,
  scheduleColumnSpans,
  SCHEDULE_MODES,
  SCHEDULE_VISIT_COL,
  SCHEDULE_ONLINE_COL,
  SCHEDULE_BODY_PX,
} from "./StaffView.jsx";

let seq = 0;
const visit = (time, over = {}) => ({
  key: `t:${seq++}`, kind: "visit", pickup: false, time,
  name: "山田 花子", kana: "ヤマダ ハナコ", dob: "1994-05-01", chart: "123456",
  menu: "", detail: "", reason: "おりもの・かゆみ", insurance: "マイナ",
  alert: "", visitKind: "再診", ...over,
});
const online = (time, over = {}) => ({
  key: `t:${seq++}`, kind: "online", time,
  name: "宮本 知美", kana: "", dob: "1979-02-01", chart: "E-114985",
  menu: "", detail: "", reason: "その他（避妊目的でピルを使いたい・以前の処方の続き）",
  insurance: "", alert: "", visitKind: "再診", ...over,
});
const zoom = (time, over = {}) => online(time, {
  zoom: true, tag: "Zoom", kana: "", chart: "",
  name: "Shiena Mae Beckwith", dob: "1994-08-15",
  reason: "当院で処方されたことのある低用量ピル（Birth control pills）の続きを希望",
  visitKind: "", ...over,
});

// 11:00〜18:00 の20分刻み（実際の枠割りと同じ22枠）
const slotTimes = [];
for (let m = 11 * 60; m <= 18 * 60; m += 20) {
  slotTimes.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
}
const emptyRows = () => slotTimes.map((t) => ({ time: t, closed: false, visits: [], onlines: [] }));

// ケース1: 2026-11-13 相当＋あふれ。11:00 のオンラインに3人（長いローマ字名2人）→
// 11:20 が空きなので食い込むはず。休診枠・枠外時刻・MAP・長い名前の…切りも混ぜる
const case1 = emptyRows();
const put = (rows, time, e) => rows.find((r) => r.time === time)[e.kind === "online" ? "onlines" : "visits"].push(e);
put(case1, "11:00", online("11:00"));
put(case1, "11:00", zoom("11:00"));
put(case1, "11:00", zoom("11:00", { alert: "要注意", name: "Alexandra Konstantinopoulou Vandermeulen" }));
put(case1, "11:40", online("11:40", { name: "近野　雅子", reason: "その他（生理周期を安定させたい）", chart: "" }));
put(case1, "12:20", visit("12:20", { name: "Jana Miller", kana: "", insurance: "自費", chart: "", visitKind: "初診", reason: "おりもの・かゆみ" }));
put(case1, "14:40", visit("14:40", { name: "トレボルマルティネス・アマヤ", kana: "", insurance: "資格確認", chart: "134297" }));
put(case1, "14:40", online("14:40", { name: "下道 彩花", reason: "再診 生理痛がつらい", chart: "E-114986" }));
put(case1, "15:00", visit("15:00", { name: "菅原 瑞希", visitKind: "初診", insurance: "マイナ", chart: "", alert: "MAP", reason: "アフターピル（72時間以内）を希望・緊急" }));
put(case1, "15:20", visit("15:20", { name: "大野 彰子", reason: "新しい症状について相談したい（長い自由記述がここに入る場合の折り返し確認用）" }));
put(case1, "16:00", online("16:00", { name: "山東 里緒", reason: "その他（処方いただいた薬が体に合わない気がする）", chart: "E-114782" }));
// 枠外時刻（16:30の薬の受け取り）は実アプリと同じく 16:20 の枠に入り、時刻が頭に出る
put(case1, "16:20", visit("16:30", { name: "受取 太郎", pickup: true, kana: "ウケトリ タロウ", reason: "", menu: "薬の受け取り", insurance: "", visitKind: "" }));
case1.find((r) => r.time === "13:00")?.visits; // 13:00台は予約なし（空きが見えること）
["12:00", "12:40"].forEach((t) => { case1.find((r) => r.time === t).closed = true; });
put(case1, "17:00", visit("17:00", { name: "山崎 あや", kana: "ヤマサキ アヤ", visitKind: "初診", insurance: "資格確認", chart: "", reason: "ニキビ・肌荒れ" }));
put(case1, "17:40", visit("17:40", { name: "柱田 あかね", visitKind: "初診", insurance: "マイナ", chart: "", reason: "生理痛　その他　茶血と腹痛" }));
put(case1, "18:00", visit("18:00", { name: "Samantha Hiscock", kana: "", visitKind: "初診", insurance: "資格確認", chart: "", reason: "ミニピル（プロゲステロン単体）を希望" }));

// ケース2: 最大件数 — 全22枠に来院2人＋オンライン2人（compactへ落ちる日）。
// 長いカナ名・3桁の受付番号・%連結の既知事故も混ぜる
const case2 = emptyRows();
case2.forEach((r, i) => {
  r.visits.push(visit(r.time, { name: `患者${String(i + 1).padStart(2, "0")} 花子`, kana: "コンスタンティノプルヴァンデルミューレン", chart: String(100000 + i) }));
  r.visits.push(visit(r.time, { name: "Alexandra Konstantinopoulou Vandermeulen", kana: "", insurance: "資格確認", visitKind: "初診" }));
  r.onlines.push(online(r.time, { name: `会員${String(i + 1).padStart(2, "0")} 太郎`, chart: `E-11${4000 + i}` }));
  r.onlines.push(zoom(r.time));
});

// ケース3: 食い込みの境界 — 空きが1枠しかない所に大量、直下が closed で借りられない所
const case3 = emptyRows();
put(case3, "11:00", online("11:00"));
put(case3, "11:00", zoom("11:00"));
put(case3, "11:00", zoom("11:00", { name: "Maria Gonzalez Fernandez de la Cruz", alert: "要注意" }));
put(case3, "11:00", online("11:00", { name: "追加 四人目" }));
put(case3, "11:20", online("11:20", { name: "枠 使用中" })); // 11:00は11:20を借りられない
put(case3, "14:00", visit("14:00", { name: "来院 混雑", reason: "直下が休診なので借りられないケース" }));
put(case3, "14:00", visit("14:00", { name: "来院 混雑2", alert: "MAP", reason: "アフターピル（72時間以内）" }));
put(case3, "14:00", visit("14:00", { name: "来院 混雑3", visitKind: "初診" }));
case3.find((r) => r.time === "14:20").closed = true;

// ページ割り（scheduleLayout と同じ考え方の簡易版: 1ページ前提でモードだけ選ぶ）
const pickMode = (rows) => {
  const rowH = Math.floor(SCHEDULE_BODY_PX / rows.length);
  for (const mode of SCHEDULE_MODES) {
    if (
      scheduleColumnSpans(rows, "visits", SCHEDULE_VISIT_COL, mode, rowH).fits &&
      scheduleColumnSpans(rows, "onlines", SCHEDULE_ONLINE_COL, mode, rowH).fits
    ) return mode;
  }
  return SCHEDULE_MODES[SCHEDULE_MODES.length - 1];
};

const CASES = [
  ["ケース1: 11/13相当＋11:00あふれ（直下の空き枠へ食い込み・休診枠・枠外時刻）", case1],
  ["ケース2: 最大件数（全22枠×4人・compact落ち・長いカナ名）", case2],
  ["ケース3: 境界（直下が使用中/休診で借りられない・1枠4人）", case3],
];

function Pair({ title, rows }) {
  const ref = useRef(null);
  const [img, setImg] = useState("");
  const mode = pickMode(rows);
  useEffect(() => {
    let alive = true;
    (async () => {
      await document.fonts.ready;
      const canvas = await captureElement(ref.current);
      if (alive) setImg(canvas.toDataURL("image/png"));
    })();
    return () => { alive = false; };
  }, []);
  const counts = rows.reduce(
    (n, r) => ({ v: n.v + r.visits.length, o: n.o + r.onlines.length, z: n.z + r.onlines.filter((e) => e.zoom).length }),
    { v: 0, o: 0, z: 0 }
  );
  return (
    <>
      <h2>{title}（組み方: {mode.compact ? "compact" : `maxLines=${mode.maxLines}/nameLines=${mode.nameLines}`}）　左=素のDOM／右=PDFに載る画像</h2>
      <div className="pair">
        <div ref={ref}>
          <ScheduleSheet
            rows={rows} dateKey="2026-11-13" page={1} pageCount={1}
            visitCount={counts.v} onlineCount={counts.o} zoomCount={counts.z}
            note="" mode={mode}
          />
        </div>
        <div>{img ? <img src={img} alt="captured" /> : <div style={{ width: 794, padding: 20 }}>画像化中...</div>}</div>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <>
    {CASES.map(([t, rows]) => <Pair key={t} title={t} rows={rows} />)}
  </>
);
