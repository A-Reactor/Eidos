"use client";

// ============================================================
// Eidos · 场景背景图层
// ============================================================
// 显示 玩家上传或已有的场景背景
// 从程序化占位 crossfade 过渡到 场景图
// ============================================================

import { useState, useEffect, useRef } from "react";

interface Props {
  /** 场景图片 URL（null 时显示占位） */
  imageUrl: string | null;
  /** 是否正在从占位过渡到 场景图 */
  transitioning: boolean;
  /** 占位内容（可选，默认显示暗色背景） */
  placeholder?: React.ReactNode;
}

export function BackgroundLayer({
  imageUrl,
  transitioning,
  placeholder,
}: Props) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showImage, setShowImage] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // 当新的 imageUrl 到达时，预加载图片
  useEffect(() => {
    if (!imageUrl) {
      setImageLoaded(false);
      setShowImage(false);
      return;
    }

    setImageLoaded(false);
    const img = new Image();
    img.onload = () => {
      setImageLoaded(true);
      // 短暂延迟后开始 crossfade（让图片先渲染一帧）
      requestAnimationFrame(() => {
        setShowImage(true);
      });
    };
    img.onerror = () => {
      // 图片加载失败，保持占位
      console.warn("[BackgroundLayer] failed to load scene image:", imageUrl);
      setImageLoaded(false);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  return (
    <div className="relative w-full h-full">
      {/* 占位层：始终渲染，在 场景图加载后淡出 */}
      <div
        className={`absolute inset-0 transition-opacity duration-500 ${
          showImage && imageLoaded ? "opacity-0" : "opacity-100"
        }`}
      >
        {placeholder ?? <div className="eidos-scene-placeholder h-full w-full" />}
      </div>

      {/* 场景图层：加载完成后淡入 */}
      {imageUrl && (
        <div
          className={`absolute inset-0 transition-opacity duration-500 ${
            showImage && imageLoaded ? "opacity-100" : "opacity-0"
          }`}
        >
          <img
            ref={imgRef}
            src={imageUrl}
            alt=""
            className="w-full h-full object-cover"
            style={{ imageRendering: "pixelated" }}
            draggable={false}
          />
        </div>
      )}
    </div>
  );
}
