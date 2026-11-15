// 出走社活動接龍：後端 API（Supabase Edge Function）
//
// 每個請求都要帶 LINE 的 ID token。先向 LINE 驗證「這真的是本人」，
// 再用 service role 讀寫資料庫。網頁本身只能讀公開資料（活動、暱稱名單）。
//
// 呼叫方式：POST /functions/v1/api  body: { action, idToken, ...參數 }

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// LINE Login channel ID（公開值；LIFF ID 的前半段）
const LINE_CHANNEL_ID = Deno.env.get("LINE_CHANNEL_ID") ?? "2012620335";

// 官方帳號（Messaging API）的金鑰：存在 Supabase Edge Function Secrets，不放在程式碼裡
const LINE_MESSAGING_TOKEN = Deno.env.get("LINE_MESSAGING_TOKEN") ?? "";
const LIFF_URL = "https://liff.line.me/2012620335-Hk2HkkYY";

// 允許呼叫這個 API 的網站
const ALLOWED_ORIGINS = [
  "https://alicenoted-coder.github.io",
  "http://localhost:8000",
];

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const CATEGORIES = ["host", "select", "member", "social"];

class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
    "Vary": "Origin",
  };
}

// 向 LINE 驗證 ID token，回傳 LINE 的使用者識別碼與顯示名稱
async function verifyLine(idToken: unknown): Promise<{ userId: string; name: string | null }> {
  if (typeof idToken !== "string" || !idToken) throw new ApiError(401, "missing_token");
  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: LINE_CHANNEL_ID }),
  });
  if (!res.ok) throw new ApiError(401, "invalid_token");
  const p = await res.json();
  if (!p.sub) throw new ApiError(401, "invalid_token");
  return { userId: p.sub, name: p.name ?? null };
}

type Member = { id: string; nickname: string; is_admin: boolean; line_display_name: string | null };

async function findMember(lineUserId: string): Promise<Member | null> {
  const { data, error } = await db
    .from("members")
    .select("id, nickname, is_admin, line_display_name")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function requireMember(m: Member | null): Member {
  if (!m) throw new ApiError(403, "no_nickname");
  return m;
}

function requireAdmin(m: Member | null): Member {
  const member = requireMember(m);
  if (!member.is_admin) throw new ApiError(403, "not_admin");
  return member;
}

function cleanNickname(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length < 1 || [...s].length > 12) throw new ApiError(400, "bad_nickname");
  return s;
}

// 只接受活動表單裡允許的欄位，並檢查內容
function cleanActivity(a: Record<string, unknown>) {
  const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const int = (v: unknown) => Number.isInteger(Number(v)) ? Number(v) : NaN;
  const out = {
    category: str(a.category),
    title: str(a.title),
    host_name: str(a.host_name),
    event_date: str(a.event_date),
    time_text: str(a.time_text, 50) || null,
    place: str(a.place) || null,
    price: int(a.price ?? 0),
    price_note: str(a.price_note) || null,
    capacity: int(a.capacity),
    threshold: int(a.threshold),
    description: str(a.description, 2000) || null,
  };
  if (!CATEGORIES.includes(out.category)) throw new ApiError(400, "bad_category");
  if (!out.title || !out.host_name) throw new ApiError(400, "missing_fields");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.event_date)) throw new ApiError(400, "bad_date");
  if (!(out.price >= 0)) throw new ApiError(400, "bad_price");
  if (!(out.capacity >= 1) || !(out.threshold >= 1)) throw new ApiError(400, "bad_numbers");
  if (out.threshold > out.capacity) throw new ApiError(400, "threshold_over_capacity");
  return out;
}

async function mySignupIds(memberId: string): Promise<string[]> {
  const { data, error } = await db
    .from("signups")
    .select("activity_id")
    .eq("member_id", memberId)
    .is("cancelled_at", null);
  if (error) throw error;
  return data.map((r) => r.activity_id);
}

// 活動剛好成團時，用官方帳號通知所有管理員（管理員要先加官方帳號好友）。
// 通知失敗不影響接龍本身，只記錄在 log。
async function notifyAdminsReached(activityId: string) {
  if (!LINE_MESSAGING_TOKEN) {
    console.warn("LINE_MESSAGING_TOKEN not set; skip admin notification");
    return;
  }
  try {
    const { data: a } = await db
      .from("activities")
      .select("title, event_date, time_text, capacity, threshold")
      .eq("id", activityId)
      .single();
    const { count } = await db
      .from("signups")
      .select("id", { count: "exact", head: true })
      .eq("activity_id", activityId)
      .is("cancelled_at", null);
    const { data: admins } = await db.from("members").select("line_user_id").eq("is_admin", true);
    if (!a || !admins?.length) return;

    const d = new Date(a.event_date + "T00:00:00Z");
    const week = "日一二三四五六"[d.getUTCDay()];
    const when = `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${week}）${a.time_text ? " " + a.time_text : ""}`;
    const text =
      `🎉【成團】${a.title}\n` +
      `${when}・目前 ${count}／${a.capacity} 人（門檻 ${a.threshold} 人）\n` +
      `記得到 LINE 社群公告付款方式\n${LIFF_URL}`;

    const res = await fetch("https://api.line.me/v2/bot/message/multicast", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_MESSAGING_TOKEN}` },
      body: JSON.stringify({
        to: admins.map((m) => m.line_user_id),
        messages: [{ type: "text", text }],
      }),
    });
    if (!res.ok) console.error("LINE multicast failed", res.status, await res.text());
  } catch (e) {
    console.error("notifyAdminsReached error", e);
  }
}

async function handle(body: Record<string, unknown>) {
  const line = await verifyLine(body.idToken);
  let member = await findMember(line.userId);

  // 順手更新 LINE 顯示名稱（只給管理員辨識用）
  if (member && line.name && member.line_display_name !== line.name) {
    await db.from("members").update({ line_display_name: line.name }).eq("id", member.id);
  }

  switch (body.action) {
    case "me": {
      if (!member) return { member: null, mySignups: [] };
      return {
        member: { nickname: member.nickname, is_admin: member.is_admin },
        mySignups: await mySignupIds(member.id),
      };
    }

    case "set_nickname": {
      const nickname = cleanNickname(body.nickname);
      const q = member
        ? db.from("members").update({ nickname }).eq("id", member.id)
        : db.from("members").insert({ line_user_id: line.userId, line_display_name: line.name, nickname });
      const { error } = await q;
      if (error) {
        if (error.code === "23505") throw new ApiError(409, "nickname_taken");
        throw error;
      }
      member = await findMember(line.userId);
      return { member: { nickname: member!.nickname, is_admin: member!.is_admin } };
    }

    case "join": {
      const m = requireMember(member);
      const { data, error } = await db.rpc("join_activity", {
        p_activity: String(body.activityId ?? ""),
        p_member: m.id,
      });
      if (error) throw error;
      if (data === "reached") await notifyAdminsReached(String(body.activityId));
      return { result: data }; // ok / reached / full / already_joined / not_found
    }

    // ---------- 管理員 ----------
    case "admin_save_activity": {
      const m = requireAdmin(member);
      const a = cleanActivity((body.activity ?? {}) as Record<string, unknown>);
      const id = typeof body.id === "string" && body.id ? body.id : null;
      const { error } = id
        ? await db.from("activities").update(a).eq("id", id)
        : await db.from("activities").insert({ ...a, created_by: m.id });
      if (error) throw error;
      return { ok: true };
    }

    case "admin_delete_activity": {
      requireAdmin(member);
      const { error } = await db.from("activities").delete().eq("id", String(body.id ?? ""));
      if (error) throw error;
      return { ok: true };
    }

    case "admin_roster": {
      requireAdmin(member);
      const { data, error } = await db
        .from("signups")
        .select("id, created_at, members(nickname, line_display_name)")
        .eq("activity_id", String(body.activityId ?? ""))
        .is("cancelled_at", null)
        .order("created_at");
      if (error) throw error;
      return {
        roster: data.map((r: any) => ({
          id: r.id,
          created_at: r.created_at,
          nickname: r.members?.nickname,
          line_name: r.members?.line_display_name,
        })),
      };
    }

    case "admin_remove_signup": {
      requireAdmin(member);
      const { error } = await db
        .from("signups")
        .update({ cancelled_at: new Date().toISOString() })
        .eq("id", String(body.signupId ?? ""))
        .is("cancelled_at", null);
      if (error) throw error;
      return { ok: true };
    }

    default:
      throw new ApiError(400, "unknown_action");
  }
}

Deno.serve(async (req) => {
  const headers = { ...corsHeaders(req.headers.get("Origin")), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers });

  try {
    const body = await req.json();
    const result = await handle(body ?? {});
    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (e) {
    if (e instanceof ApiError) {
      return new Response(JSON.stringify({ error: e.code }), { status: e.status, headers });
    }
    console.error(e);
    return new Response(JSON.stringify({ error: "server_error" }), { status: 500, headers });
  }
});
