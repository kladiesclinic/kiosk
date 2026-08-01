import React, { useEffect, useState } from "react";
import { HeartPulse, Mail, Lock, Eye, EyeOff, ChevronRight, ShieldCheck } from "lucide-react";
import { supabase } from "./supabase.js";

// 受付機はクリニックのiPadに置く端末で、起動時に一度だけスタッフが
// ログインして「設定」する想定。ログイン済みならそのまま受付画面を出す。
// （RLS上、予約・受付データの読み書きにはスタッフアカウントが必要）
export default function StaffGate({ children }) {
  const [session, setSession] = useState(null);
  const [staffOk, setStaffOk] = useState(null); // null=確認中 / true / false
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setStaffOk(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("staff_profiles")
      .select("id")
      .eq("id", session.user.id)
      .single()
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err || !data) {
          // 実在アカウントだがスタッフ登録がない → セッションは保持しない
          setStaffOk(false);
          supabase.auth.signOut();
        } else {
          setStaffOk(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const handleLogin = async () => {
    setError("");
    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) {
      setError(
        signInError.message === "Invalid login credentials"
          ? "メールアドレスまたはパスワードが正しくありません。"
          : `ログインエラー：${signInError.message}`
      );
    }
  };

  useEffect(() => {
    if (staffOk === false) setError("このアカウントはスタッフとして登録されていません。");
  }, [staffOk]);

  if (loading || (session && staffOk === null)) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#FFF8F7" }}>
        <span style={{ color: "#B08A90" }}>読み込み中...</span>
      </div>
    );
  }

  if (session && staffOk) return children;

  const valid = email.trim() && password.length >= 8;
  return (
    <div className="min-h-screen flex flex-col items-center justify-center py-10 px-4" style={{ background: "#FFF8F7", fontFamily: "'Noto Sans JP', sans-serif" }}>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "#0F8B8D" }}>
            <HeartPulse size={22} color="#DFF5F3" />
          </div>
          <div className="text-center">
            <span className="text-xl font-bold tracking-tight block" style={{ color: "#3A2E30", fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
              ケイクリ 受付機
            </span>
            <span className="text-xs" style={{ color: "#B08A90" }}>端末設定（スタッフ用ログイン）</span>
          </div>
        </div>

        <div className="rounded-2xl p-6 flex flex-col gap-4" style={{ background: "#FFFFFF", border: "1px solid #F2DFE4" }}>
          <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl" style={{ background: "#FFF8F7", border: "1.5px solid #F2DFE4" }}>
            <Mail size={16} color="#B08A90" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="メールアドレス"
              className="flex-1 bg-transparent text-sm outline-none min-w-0"
              style={{ color: "#3A2E30" }}
            />
          </div>
          <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl" style={{ background: "#FFF8F7", border: "1.5px solid #F2DFE4" }}>
            <Lock size={16} color="#B08A90" />
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="パスワード"
              className="flex-1 bg-transparent text-sm outline-none min-w-0"
              style={{ color: "#3A2E30" }}
            />
            <button type="button" onClick={() => setShowPw((v) => !v)} style={{ color: "#B08A90" }}>
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {error && <p className="text-xs -mt-1" style={{ color: "#D64550" }}>{error}</p>}

          <button
            onClick={handleLogin}
            disabled={!valid || submitting}
            className="w-full py-3.5 rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 transition-opacity"
            style={{ background: "#0F8B8D", color: "#FFFFFF", opacity: !valid || submitting ? 0.45 : 1 }}
          >
            {submitting ? "ログイン中..." : <>この端末を受付機にする <ChevronRight size={16} /></>}
          </button>

          <div className="p-3 rounded-lg text-xs flex gap-2" style={{ background: "#FFF8F7", color: "#8A7378" }}>
            <ShieldCheck size={14} className="shrink-0 mt-0.5" color="#6FC3C0" />
            <span>ログインすると、この端末は患者様向けの来院受付画面になります。患者様がこの画面をご覧の場合は、お手数ですが受付スタッフにお声がけください。</span>
          </div>
        </div>
      </div>
    </div>
  );
}
