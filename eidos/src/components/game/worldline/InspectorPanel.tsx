"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { plainDocumentText } from '@/lib/game/documents/inline-links';
import { NodeDocumentLinks } from '../DocumentLinks';

// ============================================================
// InspectorPanel — 右侧面板
// - 有选中节点: 显示节点详情 (Player Input / AI Response / Summary / World Impacts)
// - 有展开天但无选中节点: 显示该天日记
// - 都没有: 空状态提示
// 底部：回档 + 删除操作（仅节点选中时显示）
// ============================================================

import { PresentedRecordText } from "../PresentedRecordText";
import type { WorldLineNode, DiaryEntry } from "@/lib/game/types";
import { NodeActions } from "./NodeActions";

interface InspectorPanelProps {
  restrictedRewind?: boolean;
  isCurrent?: boolean;
  node: WorldLineNode | null;
  onBacktrack: (nodeId: string) => void | Promise<void>;
  onDelete: (nodeId: string) => void | Promise<void>;
  onClose: () => void;
  /** 当前展开的天（用于在未选中节点时显示日记） */
  expandedDay?: number | null;
  /** expandedDay 对应的日记条目 */
  dayDiary?: DiaryEntry | null;
}

export function InspectorPanel({
  node,
  onBacktrack,
  onDelete,
  onClose,
  expandedDay,
  restrictedRewind = false,
  isCurrent = false,
}: InspectorPanelProps) {
  const ui = useInterfaceText();

  // ============================================================
  // 空状态：无选中节点、无展开天
  // ============================================================
  if (!node && !expandedDay) {
    return (
      <div className="eidos-worldline-rail eidos-worldline-inspector eidos-worldline-inspector--empty">
        <div><span className="eidos-archive-eyebrow">{ui("节点详情")}</span><h3>{ui("选择一段经历")}</h3><p>{ui("点击图中的步骤查看行动与原文。")}<br />{ui("查看节点不会改变当前进度。")}</p></div>
      </div>
    );
  }

  // ============================================================
  // 日记模式：有展开天但无选中节点
  // ============================================================
  if (!node && expandedDay) {
    return <aside className="eidos-worldline-rail eidos-worldline-inspector eidos-worldline-day-detail">
      <button className="eidos-focus eidos-archive-text-action" onClick={onClose}>{ui("关闭")}</button>
      <h3>{ui("第")}{expandedDay}{ui("天")}</h3><p>{ui("选择一个行动查看原文，或返回回看按时间浏览。")}</p>
    </aside>;
  }

  // ============================================================
  // 节点详情模式
  // ============================================================
  if (!node) return null; // unreachable




  return (
    <div className="eidos-worldline-rail eidos-worldline-inspector">
      {/* Header */}
      <div className="eidos-worldline-detail-header">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="eidos-archive-eyebrow">{ui("节点详情")}{isCurrent && <span className="eidos-worldline-current-badge">{ui("当前进度")}</span>}</div>
            <h3>
              {ui("第")}{node.stepNumber}{ui("步")}{node.dayNumber > 0 && (
                <span className="eidos-worldline-detail-day">
                  {ui("· 第")}{node.dayNumber}{ui("天")}</span>
              )}
            </h3>
          </div>
        <button
          onClick={onClose}
          aria-label={ui("关闭节点详情")}
          className="eidos-focus eidos-worldline-detail-close"
        >
          &times;
        </button>
        </div>
      </div>

      {/* Content */}
      <div className="eidos-worldline-detail-content">
        {/* Player Input */}
        <Section label={ui("玩家行动")}>
          <p className="eidos-worldline-player-action">
            {plainDocumentText(node.playerInput || ui("（游戏开始）"))}
          </p>
        </Section>

        {/* Render the complete read text; the inspector provides scrolling. */}
        <Section label={ui("已读原文")}>
          <div className="eidos-worldline-prose">
            {<PresentedRecordText nodeId={node.id} node={node} />}
          </div>

        </Section>

        <NodeDocumentLinks inputs={node.inputDocuments} outputs={node.outputDocuments} />
        {/* Meta */}
        <Section label={ui("场景")}>
          <p className="eidos-worldline-scene-meta">
            {node.sceneName || "—"}
            {node.gameTime && (
              <span className="ml-2">
                {ui("第")}{node.gameTime.day}{ui("天")}{" "}
                {String(node.gameTime.hour).padStart(2, "0")}:
                {String(node.gameTime.minute).padStart(2, "0")}
              </span>
            )}
          </p>
        </Section>
      </div>

      {/* Actions */}
      <NodeActions key={node.id} node={node} onBacktrack={onBacktrack} onDelete={onDelete} restrictedRewind={restrictedRewind} />
    </div>
  );
}

// ============================================================
// Section — 详情段落的标题
// ============================================================

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="eidos-worldline-detail-section">
      <h4>
        {label}
      </h4>
      {children}
    </section>
  );
}
