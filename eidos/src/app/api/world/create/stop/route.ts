// ============================================================
// Eidos · 世界创建中止 API
// POST /api/world/create/stop
// ============================================================
// 客户端调用此端点中止正在进行的流式世界生成。
// 流式连接保持打开，服务端优雅停止 → 发送 {type:"done", world, truncated:true}
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { abortWorldGeneration } from "@/lib/ai/world-generator";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { generationId }: { generationId: string } = body;

    if (!generationId) {
      return NextResponse.json(
        { error: "缺少 generationId" },
        { status: 400 }
      );
    }

    const stopped = abortWorldGeneration(generationId);

    return NextResponse.json({
      success: stopped,
      message: stopped ? "已发出停止信号" : "未找到对应的生成任务（可能已完成）",
    });
  } catch {
    return NextResponse.json(
      { error: "请求格式错误" },
      { status: 400 }
    );
  }
}
