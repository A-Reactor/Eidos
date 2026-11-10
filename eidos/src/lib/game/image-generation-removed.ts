/** Old clients must not restart an image model or spend AI tokens. */
export function imageGenerationRemoved() {
  return Response.json({ error: "AI 生图功能已移除，请在图像资源库上传图片。", code: "IMAGE_GENERATION_REMOVED" }, { status: 410 });
}
