// 枠計算まわりの純関数。visit_settings.weekly_hours（7要素、index 0=日曜、
// null=休診曜日）から1日分の枠を生成し、休診日・クローズ枠・予約数を引いて
// 残数付きのグリッドにする。日付・時刻はすべて JST の壁時計文字列で扱う。

const pad = (n) => String(n).padStart(2, "0");

export function toDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function timeToMinutes(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(min) {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

export const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

export function formatDateLabel(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return `${m}月${d}日(${DAY_LABELS[day]})`;
}

// 当日の予約は枠の開始15分前まで
export const BOOKING_CUTOFF_MINUTES = 15;

// その曜日の営業時間から枠の開始時刻一覧を作る（休憩帯は除外）。
// isHoliday=true の日は日曜（index 0）の時間を適用する（祝日運用）。
// minutes を渡すとその刻みで作る（薬の受け取りだけ診察と別の刻みにするため）。
export function buildSlotTimes(settings, date, isHoliday = false, minutes) {
  const hours = settings?.weeklyHours?.[isHoliday ? 0 : date.getDay()];
  if (!hours || !hours.startTime || !hours.endTime) return [];
  const step = minutes || settings.slotMinutes;
  const start = timeToMinutes(hours.startTime);
  const end = timeToMinutes(hours.endTime);
  const hasBreak = hours.breakStart && hours.breakEnd;
  const breakStart = hasBreak ? timeToMinutes(hours.breakStart) : null;
  const breakEnd = hasBreak ? timeToMinutes(hours.breakEnd) : null;
  const times = [];
  for (let t = start; t + step <= end; t += step) {
    if (hasBreak && t >= breakStart && t < breakEnd) continue;
    times.push(minutesToTime(t));
  }
  return times;
}

// 薬の受け取りは定員無制限で、渡すだけなら数分で終わる。診察の枠を長くしても
// こちらまで選べる時刻が減らないように、刻みを分けて持っている。
export function slotMinutesFor(settings, isPickup) {
  return (isPickup ? settings?.pickupSlotMinutes : settings?.slotMinutes) || settings?.slotMinutes;
}

// 1日分の枠グリッド: [{ time, remaining }]。休診日は []。
// counts は get_visit_slot_counts の結果（診察のみの件数）を "dateKey|time" → booked にした Map。
// unlimited=true（薬の受け取り）は定員に関係なく常に空きあり扱い。
export function buildSlotGrid({ settings, date, closedDates, closedSlots, counts, holidays, unlimited }) {
  const dateKey = toDateKey(date);
  if (closedDates?.has?.(dateKey)) return [];
  const now = new Date();
  const isToday = dateKey === toDateKey(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return buildSlotTimes(settings, date, holidays?.has?.(dateKey), slotMinutesFor(settings, unlimited))
    .filter((time) => !isToday || timeToMinutes(time) >= nowMinutes + BOOKING_CUTOFF_MINUTES)
    .filter((time) => !closedSlots?.has?.(`${dateKey}|${time}`))
    .map((time) => {
      if (unlimited) return { time, remaining: Infinity };
      const booked = counts?.get?.(`${dateKey}|${time}`) || 0;
      return { time, remaining: Math.max(0, settings.slotCapacity - booked) };
    });
}
