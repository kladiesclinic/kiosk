// 日本の祝日の自動取り込みと、クリニックの定例休診の自動生成。
// 祝日データは holidays-jp（内閣府の祝日CSV由来、前年・今年・翌年分）を利用。
// スタッフ管理画面（休診設定タブ）を開いたときに不足分がDBへ自動登録される。

import { toDateKey } from "./slots.js";

export async function fetchJapaneseHolidays() {
  const res = await fetch("https://holidays-jp.github.io/api/v1/date.json");
  if (!res.ok) throw new Error("holidays-jp fetch failed");
  const all = await res.json();
  return Object.entries(all).map(([date, name]) => ({ date, name }));
}

// 定例休診: 年末年始（12/31〜1/3）と、2月・8月の第一日曜（ビル休館日）
export function recurringClosedDates() {
  const out = [];
  const year = new Date().getFullYear();
  for (let y = year; y <= year + 2; y++) {
    out.push({ date: `${y}-12-31`, name: "年末年始" });
    ["01-01", "01-02", "01-03"].forEach((md) => out.push({ date: `${y}-${md}`, name: "年末年始" }));
    [1, 7].forEach((monthIndex) => { // 2月, 8月
      const firstDay = new Date(y, monthIndex, 1);
      const offset = (7 - firstDay.getDay()) % 7;
      out.push({ date: toDateKey(new Date(y, monthIndex, 1 + offset)), name: "ビル休館日" });
    });
  }
  return out;
}
