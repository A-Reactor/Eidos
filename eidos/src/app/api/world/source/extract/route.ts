/** Old drafts retain their source materials, but must use the versioned task pipeline. */
export async function POST(): Promise<Response> {
  return Response.json({ code: 'source_pipeline_retired', error: '旧版资料建档已退役，请用原始资料重新梳理文本。已创建的世界仍可游玩。' }, { status: 410 });
}
