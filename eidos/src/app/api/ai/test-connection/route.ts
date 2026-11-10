import { NextRequest, NextResponse } from "next/server";
import { callAi, parseJSON } from "@/lib/ai/client";
import type { AiModelRole } from "@/lib/ai/providers/types";

const ROLES = new Set(["alice", "kei", "uzq"]);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const role = body?.role;
    if (!ROLES.has(role)) {
      return NextResponse.json({ ok: false, error: "Invalid role" }, { status: 400 });
    }
    const startedAt = Date.now();
    const result = await callAi({
      role: role as AiModelRole,
      systemPrompt: "Return a JSON object exactly like {\"ok\":true}.",
      userMessage: "Test the current Eidos model connection.",
      temperature: 0,
      maxTokens: 64,
      jsonMode: true,
      timeoutMs: 20000,
      // A lost response may already be billed; a connection check must not silently submit it again.
      noRetry: true,
      signal: request.signal,
      settingsOverride: body?.settings ?? null,
      callType: "settings_test_connection",
    });
    const parsed = parseJSON<{ ok?: boolean }>(result.content, {});
    if (parsed.ok !== true) {
      return NextResponse.json({ ok: false, error: "Unexpected model response." }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      role,
      elapsedMs: result.elapsedMs || Date.now() - startedAt,
      usage: result.usage,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return NextResponse.json({ ok: false, code: 'response_timeout', error: 'Connection test timed out after 20s.' }, { status: 504 });
    }
    if (request.signal.aborted) return NextResponse.json({ ok: false, code: 'request_cancelled', error: 'Connection test cancelled.' }, { status: 499 });
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
