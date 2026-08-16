import React, { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown, ListChecks, Clock3, CalendarOff } from "lucide-react";
import { supabase } from "./supabase.js";
import { T, FONTS, StaticCard, PrimaryButton, DangerButton, TextField, TextArea, Toast, useToast } from "./ui-admin.jsx";
import { toDateKey, formatDateLabel, DAY_LABELS, buildSlotTimes, slotMinutesFor } from "./lib/slots.js";
import { fetchJapaneseHolidays, recurringClosedDates } from "./lib/holidays.js";
import { RETURN_REASONS, INSURANCE_OPTIONS } from "./lib/visitOptions.js";

// booking-app の staff_admin.jsx から移植した「予約の編集・代理予約」と
// 「メニュー / 診療時間・枠 / 休診設定」。データは kiosk の supabase（is_staff の RLS）を使う。
// 受付一覧本体(StaffView)から呼び出す。認証は StaffGate が保証する。

export const settingsFromRow = (row) => ({
  slotMinutes: row.slot_minutes,
  pickupSlotMinutes: row.pickup_slot_minutes,
  slotCapacity: row.slot_capacity,
  bookingWindowDays: row.booking_window_days,
  weeklyHours: row.weekly_hours,
  holidaySyncExcluded: row.holiday_sync_excluded || [],
});

// 予約番号: RPC と同じ、紛らわしい文字を除いた32文字・8桁
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const genRef = () =>
  [...crypto.getRandomValues(new Uint8Array(8))].map((b) => REF_ALPHABET[b % 32]).join("");
const genId = () =>
  "vb_" + [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

// ── 予約の編集・代理予約フォーム ─────────────────────────
export function BookingEditor({ menus, settings, holidays, initial, onDone, onCancel, showToast }) {
  const isNew = !initial;
  const [menuId, setMenuId] = useState(initial?.menu_id || menus[0]?.id || "");
  const [dateKey, setDateKey] = useState(initial?.date || toDateKey(new Date()));
  const [time, setTime] = useState(initial?.time || "");
  const [name, setName] = useState(initial?.patient_name || "");
  const [kana, setKana] = useState(initial?.patient_kana || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [birthdate, setBirthdate] = useState(initial?.birthdate || "");
  const [returnReason, setReturnReason] = useState(initial?.return_reason || "");
  const [insurance, setInsurance] = useState(initial?.insurance || "");
  const [note, setNote] = useState(initial?.note || "");
  const [saving, setSaving] = useState(false);

  const menuKind = menus.find((m) => m.id === menuId)?.kind || "other";

  const times = useMemo(() => {
    if (!settings || !dateKey) return [];
    const [y, m, d] = dateKey.split("-").map(Number);
    // 患者さんが見るのと同じ刻みで出す（薬の受け取りは診察と別）
    return buildSlotTimes(settings, new Date(y, m - 1, d), holidays?.has?.(dateKey),
      slotMinutesFor(settings, menuKind === "pickup"));
  }, [settings, dateKey, holidays, menuKind]);

  const save = async () => {
    if (!name.trim() || !menuId || !dateKey || !time) return;
    setSaving(true);

    // 定員チェック: 診察（pickup以外）のみ。薬の受け取りは無制限。
    if (menuKind !== "pickup") {
      const { count, error: countError } = await supabase
        .from("visit_bookings")
        .select("id, visit_menus!inner(kind)", { count: "exact", head: true })
        .eq("date", dateKey)
        .eq("time", time)
        .eq("status", "booked")
        .neq("visit_menus.kind", "pickup")
        .neq("id", initial?.id || "");
      if (countError) {
        setSaving(false);
        showToast("空き状況の確認に失敗しました");
        return;
      }
      if (count >= settings.slotCapacity) {
        setSaving(false);
        showToast(`この枠は満枠です（診察の定員${settings.slotCapacity}名）`);
        return;
      }
    }

    const row = {
      menu_id: menuId,
      date: dateKey,
      time,
      patient_name: name.trim(),
      patient_kana: kana.trim() || null,
      phone: phone.trim() || null,
      birthdate: birthdate || null,
      visit_kind: menuKind === "first" || menuKind === "return" ? menuKind : null,
      return_reason: menuKind === "return" && returnReason ? returnReason : null,
      insurance: insurance || null,
      note: note.trim() || null,
    };

    let error;
    if (isNew) {
      ({ error } = await supabase
        .from("visit_bookings")
        .insert({ id: genId(), booking_ref: genRef(), channel: "staff", status: "booked", ...row }));
      // booking_ref 衝突（ほぼ起きない）は一度だけリトライ
      if (error?.code === "23505") {
        ({ error } = await supabase
          .from("visit_bookings")
          .insert({ id: genId(), booking_ref: genRef(), channel: "staff", status: "booked", ...row }));
      }
    } else {
      ({ error } = await supabase.from("visit_bookings").update(row).eq("id", initial.id));
    }
    setSaving(false);
    if (error) {
      showToast("保存に失敗しました");
    } else {
      showToast(isNew ? "予約を登録しました" : "予約を更新しました");
      onDone();
    }
  };

  const inputStyle = { background: T.bg, border: `1px solid ${T.line}`, color: T.ink };

  return (
    <StaticCard className="mt-3">
      <div className="text-xs font-bold mb-3" style={{ color: T.muted }}>
        {isNew ? "予約を新規登録（電話・窓口受付）" : `予約を編集（${initial.booking_ref}）`}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <label className="block">
          <span className="block text-xs font-medium mb-1" style={{ color: T.muted }}>メニュー</span>
          <select value={menuId} onChange={(e) => setMenuId(e.target.value)} className="w-full p-2.5 rounded-lg text-sm outline-none" style={inputStyle}>
            {menus.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium mb-1" style={{ color: T.muted }}>日付</span>
          <input type="date" value={dateKey} onChange={(e) => { if (e.target.value) { setDateKey(e.target.value); setTime(""); } }} className="w-full p-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
        </label>
        <label className="block">
          <span className="block text-xs font-medium mb-1" style={{ color: T.muted }}>時間</span>
          <select value={time} onChange={(e) => setTime(e.target.value)} className="w-full p-2.5 rounded-lg text-sm outline-none" style={inputStyle}>
            <option value="">選択してください</option>
            {times.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>
      {times.length === 0 && (
        <p className="text-[11px] mb-3" style={{ color: T.alert }}>この日は休診曜日のため受付枠がありません。</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField label="お名前" required value={name} onChange={setName} placeholder="山田 花子" />
        <TextField label="フリガナ" value={kana} onChange={setKana} placeholder="ヤマダ ハナコ" />
        <TextField label="電話番号" type="tel" value={phone} onChange={setPhone} placeholder="090-1234-5678" />
        <TextField label="生年月日" type="date" value={birthdate} onChange={setBirthdate} />
        {menuKind === "return" && (
          <label className="block">
            <span className="block text-xs font-medium mb-1" style={{ color: T.muted }}>再診の内容</span>
            <select value={returnReason} onChange={(e) => setReturnReason(e.target.value)} className="w-full p-2.5 rounded-lg text-sm outline-none" style={inputStyle}>
              <option value="">未選択</option>
              {RETURN_REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
        )}
        <label className="block">
          <span className="block text-xs font-medium mb-1" style={{ color: T.muted }}>保険</span>
          <select value={insurance} onChange={(e) => setInsurance(e.target.value)} className="w-full p-2.5 rounded-lg text-sm outline-none" style={inputStyle}>
            <option value="">当日確認</option>
            {INSURANCE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.short}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-3">
        <TextArea label="メモ（ご要望・症状など）" value={note} onChange={setNote} rows={2} />
      </div>
      <div className="flex gap-2 mt-4">
        <PrimaryButton onClick={save} disabled={!name.trim() || !time || saving}>
          {saving ? "保存中..." : isNew ? "登録する" : "更新する"}
        </PrimaryButton>
        <button className="text-xs px-3" style={{ color: T.muted }} onClick={onCancel}>やめる</button>
      </div>
    </StaticCard>
  );
}

// ── メニュー管理 ─────────────────────────────────────────
function MenusTab({ showToast }) {
  const [menus, setMenus] = useState(null);
  const [draft, setDraft] = useState(null); // {id?, name, description, durationMin}
  const [deletingId, setDeletingId] = useState(null);

  const load = () => {
    supabase.from("visit_menus").select("*").order("sort_order")
      .then(({ data, error }) => setMenus(error ? [] : data));
  };
  useEffect(load, []);

  const save = async () => {
    if (!draft.name.trim()) return;
    const row = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      duration_min: Number(draft.durationMin) || 10,
    };
    const { error } = draft.id
      ? await supabase.from("visit_menus").update(row).eq("id", draft.id)
      : await supabase.from("visit_menus").insert({ id: `m_${Date.now()}`, sort_order: (menus?.length || 0) + 1, ...row });
    if (error) showToast("保存に失敗しました");
    else {
      showToast("メニューを保存しました");
      setDraft(null);
      load();
    }
  };

  const toggleActive = async (menu) => {
    const { error } = await supabase.from("visit_menus").update({ is_active: !menu.is_active }).eq("id", menu.id);
    if (!error) load();
  };

  const remove = async (menu) => {
    const { error } = await supabase.from("visit_menus").delete().eq("id", menu.id);
    setDeletingId(null);
    if (error) {
      // FK違反 = このメニューを使った予約が存在する
      showToast(error.code === "23503"
        ? "このメニューで登録された予約があるため削除できません。「非公開」にしてください。"
        : "削除に失敗しました");
    } else {
      showToast("メニューを削除しました");
      load();
    }
  };

  // 並び替え: 配列上で入れ替えて sort_order を 1..n で振り直す
  const move = async (index, dir) => {
    const next = [...menus];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setMenus(next);
    await Promise.all(next.map((m, i) => supabase.from("visit_menus").update({ sort_order: i + 1 }).eq("id", m.id)));
    load();
  };

  return (
    <div>
      {menus === null ? (
        <p className="text-sm" style={{ color: T.muted }}>読み込み中...</p>
      ) : (
        <div className="space-y-2">
          {menus.map((m, i) => (
            <StaticCard key={m.id}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col">
                    <button onClick={() => move(i, -1)} disabled={i === 0} style={{ opacity: i === 0 ? 0.25 : 1 }}>
                      <ArrowUp size={14} color={T.muted} />
                    </button>
                    <button onClick={() => move(i, 1)} disabled={i === menus.length - 1} style={{ opacity: i === menus.length - 1 ? 0.25 : 1 }}>
                      <ArrowDown size={14} color={T.muted} />
                    </button>
                  </div>
                  <div>
                    <div className="text-sm font-bold" style={{ color: m.is_active ? T.ink : T.faint }}>
                      {m.name}
                      <span className="text-[10px] font-normal ml-2" style={{ color: T.faint, fontFamily: FONTS.mono }}>
                        {m.duration_min}分目安
                      </span>
                    </div>
                    {m.description && <div className="text-[11px] mt-0.5" style={{ color: T.muted }}>{m.description}</div>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    className="text-xs font-medium px-2.5 py-1 rounded-lg"
                    style={{ background: m.is_active ? T.mint : T.pinkSoft, color: m.is_active ? T.tealDark : T.faint }}
                    onClick={() => toggleActive(m)}
                  >
                    {m.is_active ? "公開中" : "非公開"}
                  </button>
                  <button
                    className="text-xs font-medium"
                    style={{ color: T.tealDark }}
                    onClick={() => setDraft({ id: m.id, name: m.name, description: m.description || "", durationMin: m.duration_min })}
                  >
                    編集
                  </button>
                  <button onClick={() => setDeletingId(deletingId === m.id ? null : m.id)}>
                    <Trash2 size={14} color={T.alert} />
                  </button>
                </div>
              </div>
              {deletingId === m.id && (
                <div className="mt-2 p-2.5 rounded-lg flex items-center gap-2 flex-wrap" style={{ background: T.alertBg }}>
                  <span className="text-xs font-medium" style={{ color: T.alert }}>「{m.name}」を削除しますか？</span>
                  <DangerButton onClick={() => remove(m)}>削除する</DangerButton>
                  <button className="text-xs" style={{ color: T.muted }} onClick={() => setDeletingId(null)}>やめる</button>
                </div>
              )}
            </StaticCard>
          ))}
        </div>
      )}

      {draft ? (
        <StaticCard className="mt-4">
          <div className="text-xs font-bold mb-3" style={{ color: T.muted }}>{draft.id ? "メニューを編集" : "メニューを追加"}</div>
          <div className="space-y-3">
            <TextField label="名前" required value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} placeholder="例）初診" />
            <TextField label="説明" value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} placeholder="例）当院の受診が初めての方" />
            <TextField label="所要時間の目安（分）" type="number" value={String(draft.durationMin)} onChange={(v) => setDraft({ ...draft, durationMin: v })} />
          </div>
          <div className="flex gap-2 mt-4">
            <PrimaryButton onClick={save} disabled={!draft.name.trim()}>保存する</PrimaryButton>
            <button className="text-xs" style={{ color: T.muted }} onClick={() => setDraft(null)}>やめる</button>
          </div>
        </StaticCard>
      ) : (
        <div className="mt-4">
          <PrimaryButton onClick={() => setDraft({ name: "", description: "", durationMin: 10 })}>
            <Plus size={15} /> メニューを追加
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}

// ── 診療時間・枠設定 ─────────────────────────────────────
function HoursTab({ showToast }) {
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    supabase.from("visit_settings").select("*").eq("id", "default").single()
      .then(({ data, error }) => { if (!error && data) setSettings(settingsFromRow(data)); });
  }, []);

  const setDay = (dayIndex, patch) => {
    const weeklyHours = settings.weeklyHours.map((h, i) => {
      if (i !== dayIndex) return h;
      if (patch === null) return null;
      return { startTime: "09:30", endTime: "17:30", breakStart: "", breakEnd: "", ...(h || {}), ...patch };
    });
    setSettings({ ...settings, weeklyHours });
  };

  const save = async () => {
    const { error } = await supabase
      .from("visit_settings")
      .update({
        slot_minutes: Number(settings.slotMinutes),
        pickup_slot_minutes: Number(settings.pickupSlotMinutes),
        slot_capacity: Number(settings.slotCapacity),
        booking_window_days: Number(settings.bookingWindowDays),
        weekly_hours: settings.weeklyHours,
        updated_at: new Date().toISOString(),
      })
      .eq("id", "default");
    showToast(error ? "保存に失敗しました" : "設定を保存しました");
  };

  if (!settings) return <p className="text-sm" style={{ color: T.muted }}>読み込み中...</p>;

  const timeInput = (value, onChange) => (
    <input
      type="time"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      className="p-1.5 rounded-lg text-xs outline-none"
      style={{ background: T.bg, border: `1px solid ${T.line}`, color: T.ink }}
    />
  );

  return (
    <div className="space-y-4">
      <StaticCard>
        <div className="text-xs font-bold mb-3" style={{ color: T.muted }}>予約枠</div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-[11px] mb-1" style={{ color: T.muted }}>枠の長さ（診察）</span>
            <select
              value={settings.slotMinutes}
              onChange={(e) => setSettings({ ...settings, slotMinutes: Number(e.target.value) })}
              className="w-full p-2 rounded-lg text-sm outline-none"
              style={{ background: T.bg, border: `1px solid ${T.line}` }}
            >
              {[10, 15, 20, 30, 60].map((m) => <option key={m} value={m}>{m}分</option>)}
            </select>
          </label>
          {/* 受け取りは渡すだけなので、診察の枠を長くしてもここは短いままにできる */}
          <label className="block">
            <span className="block text-[11px] mb-1" style={{ color: T.muted }}>枠の長さ（お薬の受け取り）</span>
            <select
              value={settings.pickupSlotMinutes}
              onChange={(e) => setSettings({ ...settings, pickupSlotMinutes: Number(e.target.value) })}
              className="w-full p-2 rounded-lg text-sm outline-none"
              style={{ background: T.bg, border: `1px solid ${T.line}` }}
            >
              {[10, 15, 20, 30, 60].map((m) => <option key={m} value={m}>{m}分</option>)}
            </select>
          </label>
          <TextField label="枠の定員" type="number" value={String(settings.slotCapacity)} onChange={(v) => setSettings({ ...settings, slotCapacity: v })} />
          <TextField label="受付期間（日）" type="number" value={String(settings.bookingWindowDays)} onChange={(v) => setSettings({ ...settings, bookingWindowDays: v })} />
        </div>
        <p className="text-[11px] mt-2" style={{ color: T.faint }}>
          ※ 定員は診察（初診・再診）のみに適用されます。「お薬のお受け取り」は同時刻でも無制限に受け付けます。
          <br />
          ※ 枠は終了時刻の10分前が最終開始になります（終了18:30 → 最終枠18:20）。当日の予約は各枠の15分前で締切です。
        </p>
      </StaticCard>

      <StaticCard>
        <div className="text-xs font-bold mb-3" style={{ color: T.muted }}>曜日ごとの受付時間</div>
        <div className="space-y-2.5">
          {settings.weeklyHours.map((hours, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 py-1.5" style={{ borderBottom: i < 6 ? `1px solid ${T.line}` : "none" }}>
              <span className="w-6 text-sm font-bold" style={{ color: i === 0 ? T.alert : i === 6 ? "#4A7FB5" : T.ink }}>
                {DAY_LABELS[i]}
              </span>
              <button
                className="text-[11px] font-medium px-2 py-1 rounded-lg"
                style={{ background: hours ? T.mint : T.pinkSoft, color: hours ? T.tealDark : T.faint }}
                onClick={() => setDay(i, hours ? null : {})}
              >
                {hours ? "受付する" : "休診"}
              </button>
              {hours && (
                <>
                  {timeInput(hours.startTime, (v) => setDay(i, { startTime: v }))}
                  <span className="text-xs" style={{ color: T.faint }}>–</span>
                  {timeInput(hours.endTime, (v) => setDay(i, { endTime: v }))}
                  <span className="text-[10px] ml-1" style={{ color: T.faint }}>休憩</span>
                  {timeInput(hours.breakStart, (v) => setDay(i, { breakStart: v }))}
                  <span className="text-xs" style={{ color: T.faint }}>–</span>
                  {timeInput(hours.breakEnd, (v) => setDay(i, { breakEnd: v }))}
                </>
              )}
            </div>
          ))}
        </div>
      </StaticCard>

      <PrimaryButton onClick={save}>設定を保存する</PrimaryButton>
    </div>
  );
}

// ── 休診日・枠クローズ ───────────────────────────────────
function ClosedTab({ showToast }) {
  const [closedDates, setClosedDates] = useState(null);
  const [newDate, setNewDate] = useState("");
  // 追加する休診日で薬の受け取りも休みにするか（既定=全休）
  const [pickupAlsoClosed, setPickupAlsoClosed] = useState(true);
  const [holidayDates, setHolidayDates] = useState(null);
  const [newHoliday, setNewHoliday] = useState("");
  const [slotDate, setSlotDate] = useState(toDateKey(new Date()));
  const [closedSlots, setClosedSlots] = useState(new Set());
  const [settings, setSettings] = useState(null);

  // 一覧は {date, name} の配列で持つ
  const loadAll = async () => {
    const [closedRes, holidayRes, settingsRes] = await Promise.all([
      supabase.from("visit_closed_dates").select("date, name, pickup_closed").order("date"),
      supabase.from("visit_holiday_dates").select("date, name").order("date"),
      supabase.from("visit_settings").select("*").eq("id", "default").single(),
    ]);
    const closed = closedRes.error ? [] : closedRes.data;
    const holidays = holidayRes.error ? [] : holidayRes.data;
    setClosedDates(closed);
    setHolidayDates(holidays);
    if (!settingsRes.error && settingsRes.data) setSettings(settingsFromRow(settingsRes.data));
    return { closed, holidays, excluded: settingsRes.data?.holiday_sync_excluded || [] };
  };

  useEffect(() => {
    // 読み込み後、日本の祝日（holidays-jp）と定例休診（年末年始・第一日曜のビル休館日）を自動同期。
    // スタッフが手動削除した日付は excluded に入っているので復活させない。
    loadAll().then(async ({ closed, holidays, excluded }) => {
      try {
        const today = toDateKey(new Date());
        const apiHolidays = await fetchJapaneseHolidays();
        const holidaySet = new Set(holidays.map((r) => r.date));
        const closedSet = new Set(closed.map((r) => r.date));
        const newHolidays = apiHolidays.filter((h) => h.date >= today && !holidaySet.has(h.date) && !excluded.includes(h.date));
        const newClosed = recurringClosedDates().filter((c) => c.date >= today && !closedSet.has(c.date) && !excluded.includes(c.date));
        if (newHolidays.length) await supabase.from("visit_holiday_dates").insert(newHolidays);
        if (newClosed.length) await supabase.from("visit_closed_dates").insert(newClosed);
        if (newHolidays.length || newClosed.length) {
          showToast(`カレンダーを自動更新しました（祝日${newHolidays.length}件・定例休診${newClosed.length}件）`);
          loadAll();
        }
      } catch (e) {
        console.warn("holiday auto-sync failed", e);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 手動削除した日付を自動同期の対象外として settings に記録する
  const updateExcluded = async (next) => {
    await supabase.from("visit_settings").update({ holiday_sync_excluded: next }).eq("id", "default");
    setSettings((s) => (s ? { ...s, holidaySyncExcluded: next } : s));
  };

  const addHoliday = async () => {
    if (!newHoliday) return;
    const { error } = await supabase.from("visit_holiday_dates").insert({ date: newHoliday });
    if (error) showToast("追加できませんでした（既に登録済み？）");
    else {
      const excluded = settings?.holidaySyncExcluded || [];
      if (excluded.includes(newHoliday)) await updateExcluded(excluded.filter((d) => d !== newHoliday));
      setNewHoliday("");
      showToast("祝日を追加しました");
      loadAll();
    }
  };

  const removeHoliday = async (date) => {
    const { error } = await supabase.from("visit_holiday_dates").delete().eq("date", date);
    if (!error) {
      await updateExcluded([...(settings?.holidaySyncExcluded || []), date]);
      showToast("削除しました（自動同期でも復活しません）");
      loadAll();
    }
  };

  useEffect(() => {
    if (!slotDate) return;
    supabase.from("visit_closed_slots").select("time").eq("date", slotDate)
      .then(({ data, error }) => setClosedSlots(new Set(error ? [] : data.map((r) => r.time))));
  }, [slotDate]);

  const addClosedDate = async () => {
    if (!newDate) return;
    const { error } = await supabase.from("visit_closed_dates").insert({ date: newDate, pickup_closed: pickupAlsoClosed });
    if (error) showToast("追加できませんでした（既に登録済み？）");
    else {
      const excluded = settings?.holidaySyncExcluded || [];
      if (excluded.includes(newDate)) await updateExcluded(excluded.filter((d) => d !== newDate));
      setNewDate("");
      showToast("休診日を追加しました");
      loadAll();
    }
  };

  const removeClosedDate = async (date) => {
    const { error } = await supabase.from("visit_closed_dates").delete().eq("date", date);
    if (!error) {
      await updateExcluded([...(settings?.holidaySyncExcluded || []), date]);
      showToast("削除しました（自動同期でも復活しません）");
      loadAll();
    }
  };

  const toggleSlot = async (time) => {
    if (closedSlots.has(time)) {
      const { error } = await supabase.from("visit_closed_slots").delete().eq("date", slotDate).eq("time", time);
      if (!error) setClosedSlots((prev) => { const next = new Set(prev); next.delete(time); return next; });
    } else {
      const { error } = await supabase.from("visit_closed_slots").insert({ date: slotDate, time });
      if (!error) setClosedSlots((prev) => new Set(prev).add(time));
    }
  };

  const slotTimes = useMemo(() => {
    if (!settings || !slotDate) return [];
    const [y, m, d] = slotDate.split("-").map(Number);
    // 停止した枠は診察にも受け取りにも効くので、細かいほうの刻みで並べる。
    // 粗いほうだけ出すと、受け取りの 11:10 のような枠を止められなくなる
    const step = Math.min(settings.slotMinutes, settings.pickupSlotMinutes || settings.slotMinutes);
    return buildSlotTimes(settings, new Date(y, m - 1, d),
      (holidayDates || []).some((r) => r.date === slotDate), step);
  }, [settings, slotDate, holidayDates]);

  return (
    <div className="space-y-4">
      <StaticCard>
        <div className="text-xs font-bold mb-1" style={{ color: T.muted }}>祝日（日曜と同じ受付時間）</div>
        <p className="text-[11px] mb-3" style={{ color: T.faint }}>
          日本の祝日は自動で登録されます（この画面を開いたときに更新）。登録した日は 11:00〜12:30 / 14:30〜17:30最終受付（日曜と同じ）になります。
          年末年始（12/31〜1/3）と2月・8月の第一日曜（ビル休館日）は下の「臨時休診日」に自動登録されます。削除した日付は自動同期でも復活しません。
        </p>
        <div className="flex gap-2">
          <input
            type="date"
            value={newHoliday}
            onChange={(e) => setNewHoliday(e.target.value)}
            className="flex-1 p-2 rounded-lg text-sm outline-none"
            style={{ background: T.bg, border: `1px solid ${T.line}` }}
          />
          <PrimaryButton onClick={addHoliday} disabled={!newHoliday}><Plus size={14} /> 追加</PrimaryButton>
        </div>
        {holidayDates === null ? null : (() => {
          const today = toDateKey(new Date());
          const future = holidayDates.filter((r) => r.date >= today);
          return future.length === 0 ? (
            <p className="text-xs mt-3" style={{ color: T.faint }}>登録された祝日はありません</p>
          ) : (
            <div className="mt-3 space-y-1.5 max-h-64 overflow-y-auto">
              {future.map((r) => (
                <div key={r.date} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: T.bg }}>
                  <span className="text-sm" style={{ fontFamily: FONTS.mono }}>
                    {formatDateLabel(r.date)}
                    {r.name && <span className="text-[11px] ml-2" style={{ color: T.muted, fontFamily: FONTS.body }}>{r.name}</span>}
                  </span>
                  <button onClick={() => removeHoliday(r.date)}><Trash2 size={14} color={T.alert} /></button>
                </div>
              ))}
            </div>
          );
        })()}
      </StaticCard>

      <StaticCard>
        <div className="text-xs font-bold mb-3" style={{ color: T.muted }}>臨時休診日</div>
        <div className="flex gap-2">
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="flex-1 p-2 rounded-lg text-sm outline-none"
            style={{ background: T.bg, border: `1px solid ${T.line}` }}
          />
          <PrimaryButton onClick={addClosedDate} disabled={!newDate}><Plus size={14} /> 追加</PrimaryButton>
        </div>
        {/* 医師不在でも受付が開いている日は「診察のみ休診」にすると薬受け取りだけ予約できる */}
        <label className="flex items-center gap-2 mt-2 text-xs cursor-pointer select-none" style={{ color: T.muted }}>
          <input type="checkbox" checked={pickupAlsoClosed} onChange={(e) => setPickupAlsoClosed(e.target.checked)} />
          薬の受け取りも休みにする（外すと「診察のみ休診」になり、薬受け取りは予約できます）
        </label>
        {closedDates === null ? null : (() => {
          const today = toDateKey(new Date());
          const future = closedDates.filter((r) => r.date >= today);
          return future.length === 0 ? (
            <p className="text-xs mt-3" style={{ color: T.faint }}>登録された休診日はありません</p>
          ) : (
            <div className="mt-3 space-y-1.5 max-h-64 overflow-y-auto">
              {future.map((r) => (
                <div key={r.date} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: T.bg }}>
                  <span className="text-sm" style={{ fontFamily: FONTS.mono }}>
                    {formatDateLabel(r.date)}
                    {r.name && <span className="text-[11px] ml-2" style={{ color: T.muted, fontFamily: FONTS.body }}>{r.name}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    {/* クリックで全休⇔診察のみ休診を切り替え */}
                    <button
                      onClick={async () => {
                        const next = r.pickup_closed === false;
                        const { error } = await supabase.from("visit_closed_dates").update({ pickup_closed: next }).eq("date", r.date);
                        if (error) showToast("切り替えできませんでした");
                        else loadAll();
                      }}
                      className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                      style={
                        r.pickup_closed === false
                          ? { background: T.mint, color: T.tealDark }
                          : { background: T.alertBg, color: T.alert }
                      }
                    >
                      {r.pickup_closed === false ? "薬受取OK" : "全休"}
                    </button>
                    <button onClick={() => removeClosedDate(r.date)}><Trash2 size={14} color={T.alert} /></button>
                  </span>
                </div>
              ))}
            </div>
          );
        })()}
      </StaticCard>

      <StaticCard>
        <div className="text-xs font-bold mb-1" style={{ color: T.muted }}>枠ごとの受付停止</div>
        <p className="text-[11px] mb-3" style={{ color: T.faint }}>日付を選び、停止したい枠をタップしてください（赤 = 停止中）。</p>
        <input
          type="date"
          value={slotDate}
          onChange={(e) => e.target.value && setSlotDate(e.target.value)}
          className="p-2 rounded-lg text-sm outline-none mb-3"
          style={{ background: T.bg, border: `1px solid ${T.line}` }}
        />
        {slotTimes.length === 0 ? (
          <p className="text-xs" style={{ color: T.faint }}>この日は受付時間がありません（休診曜日）</p>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {slotTimes.map((time) => {
              const closed = closedSlots.has(time);
              return (
                <button
                  key={time}
                  onClick={() => toggleSlot(time)}
                  className="py-2 rounded-lg text-xs font-bold"
                  style={{
                    fontFamily: FONTS.mono,
                    background: closed ? T.alertBg : T.surface,
                    border: `1.5px solid ${closed ? T.alert : T.line}`,
                    color: closed ? T.alert : T.ink,
                  }}
                >
                  {time}
                </button>
              );
            })}
          </div>
        )}
      </StaticCard>
    </div>
  );
}

// ── 設定（メニュー / 診療時間・枠 / 休診設定）をまとめるサブタブ ──
const SETTINGS_TABS = [
  { id: "menus", label: "メニュー", icon: ListChecks },
  { id: "hours", label: "診療時間・枠", icon: Clock3 },
  { id: "closed", label: "休診設定", icon: CalendarOff },
];

export function SettingsTabs() {
  const [sub, setSub] = useState("menus");
  const [toast, showToast] = useToast();
  return (
    <div>
      <div className="flex gap-2 mb-4 overflow-x-auto">
        {SETTINGS_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSub(id)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 transition-all"
            style={{
              background: sub === id ? T.teal : T.surface,
              color: sub === id ? "#FFFFFF" : T.muted,
              border: `1px solid ${sub === id ? T.teal : T.line}`,
            }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {sub === "menus" && <MenusTab showToast={showToast} />}
      {sub === "hours" && <HoursTab showToast={showToast} />}
      {sub === "closed" && <ClosedTab showToast={showToast} />}
      <Toast message={toast} />
    </div>
  );
}
