/** 缓存键组成 */
export interface ImageCacheKey {
  worldId: string;
  sceneId: string;
  weather: string;
  timeOfDay: string;
  /** 审视区域（非审视的普通场景图为 undefined） */
  regionId?: string;
}

export interface ExamineState {
  active: boolean;
  regionId: string | null;
  regionName: string | null;
  detailImageUrl: string | null;
  /** 当前缩放级别 (1.0 → 3.0) */
  zoomLevel: number;
}

/** Compatibility fields from older saves. Generation stays disabled when loading. */
export interface MidoriSettings {
  enabled: boolean;
  model: "pixel-art-xl";
  /** 是否启用像素艺术风格（false=原生出图） */
  pixelate: boolean;
  /** 场景切换时自动生图 */
  autoGenerate: boolean;
}

export const DEFAULT_MIDORI_SETTINGS: MidoriSettings = {
  enabled: false,
  model: "pixel-art-xl",
  pixelate: true,
  autoGenerate: false,
};

export interface GallerySceneImage {
  sceneId: string;
  weather: string;
  timeOfDay: string;
  url: string;
  fileSize: number;
  lastModified: number;
  /** Exact path within this world's generated directory; never reconstruct it from labels. */
  relativePath?: string;
}

export interface GalleryDetailImage {
  sceneId: string;
  regionId: string;
  url: string;
  fileSize: number;
  lastModified: number;
  relativePath?: string;
}

export interface GalleryCharacterImage {
  name: string;
  emotion?: string;
  url: string;
  fileSize: number;
  lastModified: number;
  relativePath?: string;
}

export interface GalleryListResponse {
  sceneImages: GallerySceneImage[];
  detailImages: GalleryDetailImage[];
  /** 独立插图文件；详情图片也在客户端合并到插图资源目录。 */
  illustrations: GallerySceneImage[];
  npcImages?: GalleryCharacterImage[];
  regionImages?: GalleryDetailImage[];
}
