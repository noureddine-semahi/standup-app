import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { computeUsageState, hasUsesRemaining, remainingUses, ASSISTANT_FREE_CAP } from "@/lib/assistant/usage";
import { ASSISTANT_TOOLS } from "@/lib/assistant/tools";
import {
  addGoalAction,
  updateGoalStatusAction,
  rescheduleGoalAction,
  moveGoalToBacklogAction,
} from "@/lib/assistant/serverActions";

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

type GoalContext = { id: string; title: string; status: string };

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { message: "The assistant isn't configured yet — no Anthropic API key is set on the server." },
      { status: 503 }
    );
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    return NextResponse.json({ message: "Not signed in." }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ message: "Server misconfigured (missing Supabase env vars)." }, { status: 500 });
  }

  // Request-scoped client, authenticated as the calling user via their own
  // access token — this project has no service-role key, so this is the
  // only way a server route can act as a specific user while still going
  // through RLS exactly like the browser client does.
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return NextResponse.json({ message: "Not signed in." }, { status: 401 });
  }
  const userId = userData.user.id;

  let body: { message?: string; todayISO?: string; tomorrowISO?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }

  const userMessage = (body.message ?? "").trim();
  const todayISO = body.todayISO;
  const tomorrowISO = body.tomorrowISO;
  if (!userMessage || !todayISO || !tomorrowISO) {
    return NextResponse.json({ message: "Missing message or date context." }, { status: 400 });
  }

  // --- Usage cap: checked and (if needed) reset before any paid API call ---
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("assistant_uses_this_period, assistant_period_reset_at")
    .eq("id", userId)
    .single();
  if (profileErr) {
    return NextResponse.json({ message: profileErr.message }, { status: 500 });
  }

  const usage = computeUsageState(profile, new Date());
  if (usage.didReset) {
    await supabase
      .from("profiles")
      .update({ assistant_uses_this_period: usage.uses, assistant_period_reset_at: usage.resetAt })
      .eq("id", userId);
  }

  if (!hasUsesRemaining(usage.uses)) {
    return NextResponse.json(
      {
        message: `You've used all ${ASSISTANT_FREE_CAP} free assistant actions for this period. It resets ${new Date(usage.resetAt).toLocaleDateString()}.`,
        remaining: 0,
      },
      { status: 429 }
    );
  }

  // --- Context the model needs to resolve "my workout" etc. to a real goal id ---
  const { data: todayPlan } = await supabase.from("daily_plans").select("id").eq("user_id", userId).eq("plan_date", todayISO).maybeSingle();
  const { data: tomorrowPlan } = await supabase.from("daily_plans").select("id").eq("user_id", userId).eq("plan_date", tomorrowISO).maybeSingle();

  const [todayGoalsRes, tomorrowGoalsRes] = await Promise.all([
    todayPlan
      ? supabase.from("goals").select("id, title, status").eq("plan_id", todayPlan.id)
      : Promise.resolve({ data: [] as GoalContext[] }),
    tomorrowPlan
      ? supabase.from("goals").select("id, title, status").eq("plan_id", tomorrowPlan.id)
      : Promise.resolve({ data: [] as GoalContext[] }),
  ]);

  const todayGoals = (todayGoalsRes.data ?? []) as GoalContext[];
  const tomorrowGoals = (tomorrowGoalsRes.data ?? []) as GoalContext[];

  const systemPrompt = [
    `Today's date is ${todayISO}. Tomorrow is ${tomorrowISO}.`,
    `Today's goals: ${todayGoals.length === 0 ? "(none)" : JSON.stringify(todayGoals)}`,
    `Tomorrow's goals: ${tomorrowGoals.length === 0 ? "(none)" : JSON.stringify(tomorrowGoals)}`,
    `You help the user quickly add goals or act on existing ones by calling exactly one tool per request.`,
    `If the user's request to update/reschedule/move a goal doesn't clearly match exactly one goal from the lists above, don't guess — reply with plain text asking which goal they mean, and don't call a tool.`,
    `If marking a goal "blocked" and the user hasn't given a reason, ask for one in plain text instead of calling the tool.`,
    `Keep any plain-text reply short — one or two sentences.`,
  ].join("\n");

  // --- Call Claude directly via fetch — a single endpoint, not worth a new SDK dependency ---
  let anthropicRes: Response;
  try {
    anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        tools: ASSISTANT_TOOLS,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
  } catch (e: any) {
    return NextResponse.json({ message: `Couldn't reach the assistant: ${e?.message ?? "network error"}` }, { status: 502 });
  }

  if (!anthropicRes.ok) {
    const errBody = await anthropicRes.text().catch(() => "");
    return NextResponse.json({ message: `Assistant request failed (${anthropicRes.status}): ${errBody}` }, { status: 502 });
  }

  const claudeData = await anthropicRes.json();
  const content: any[] = claudeData.content ?? [];
  const toolUse = content.find((block) => block.type === "tool_use");
  const textBlocks = content.filter((block) => block.type === "text").map((block) => block.text);

  if (!toolUse) {
    // The model asked a clarifying question or just responded in text —
    // no action taken, so no usage counted against the cap.
    return NextResponse.json({
      message: textBlocks.join(" ") || "I didn't understand that — could you rephrase?",
      remaining: remainingUses(usage.uses),
    });
  }

  // --- Execute the chosen action, then count it against the cap ---
  try {
    let resultMessage = "";

    if (toolUse.name === "add_goal") {
      const result = await addGoalAction(supabase, userId, {
        title: toolUse.input.title,
        details: toolUse.input.details,
        priority: toolUse.input.priority,
        dateISO: toolUse.input.date_iso ?? null,
      });
      resultMessage =
        result.kind === "backlog"
          ? `Added "${result.goal.title}" to your Backlog.`
          : `Added "${result.goal.title}" to ${result.dateISO}.`;
    } else if (toolUse.name === "update_goal_status") {
      const result = await updateGoalStatusAction(
        supabase,
        userId,
        toolUse.input.goal_id,
        toolUse.input.status,
        toolUse.input.blocked_reason
      );
      resultMessage = `Marked "${result.title}" as ${result.status.replace("_", " ")}.`;
    } else if (toolUse.name === "reschedule_goal") {
      const result = await rescheduleGoalAction(
        supabase,
        userId,
        toolUse.input.goal_id,
        toolUse.input.to_date_iso,
        todayISO,
        toolUse.input.reason
      );
      resultMessage = `Rescheduled "${result.title}" to ${result.toDateISO}.`;
    } else if (toolUse.name === "move_goal_to_backlog") {
      const result = await moveGoalToBacklogAction(supabase, userId, toolUse.input.goal_id);
      resultMessage = `Moved "${result.title}" to your Backlog.`;
    } else {
      return NextResponse.json({ message: "Unknown action." }, { status: 400 });
    }

    const newUses = usage.uses + 1;
    await supabase.from("profiles").update({ assistant_uses_this_period: newUses }).eq("id", userId);

    return NextResponse.json({ message: resultMessage, actionTaken: toolUse.name, remaining: remainingUses(newUses) });
  } catch (e: any) {
    return NextResponse.json({ message: e?.message ?? "Something went wrong applying that.", remaining: remainingUses(usage.uses) }, { status: 500 });
  }
}
