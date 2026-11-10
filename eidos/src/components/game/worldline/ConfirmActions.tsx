"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


// ============================================================
// ConfirmActions — 内联二次确认按钮组
// ============================================================
// 沿用项目现有模式（WorldSelectScreen / HistoryScreen）：
// 首次点击 → 显示"确认XXX"+"取消"
// 点击确认 → 执行 action
// 点击取消 → 恢复初始状态
// ============================================================

interface ConfirmActionsProps {
  /** 按钮标签（如"回档到此处"、"删除节点及后代"） */
  label: string;
  /** 确认标签（如"确认回档"、"确认删除"） */
  confirmLabel: string;
  /** 按钮颜色主题 */
  variant: "amber" | "red";
  /** 确认后执行 */
  onConfirm: () => void;
}

export function ConfirmActions({
  label,
  variant,
}: ConfirmActionsProps) {
  // 状态由父组件管理，通过 key 重置
  // 这里使用内部状态简化，但暴露 confirmId 模式给父组件

  return (
    <div className="flex items-center gap-2" data-confirm-actions>
      <button
        type="button"
        data-confirm-trigger
        className="eidos-focus eidos-worldline-action"
        data-kind={variant === "red" ? "delete" : "restore"}
      >
        <span>{label}</span>
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}

/**
 * 展开的确认状态（替代 ConfirmActions 的默认状态）。
 * 内联展开：确认按钮 + 取消按钮。
 */
export function ConfirmActionsExpanded({
  confirmLabel,
  variant,
  onConfirm,
  onCancel,
}: {
  confirmLabel: string;
  variant: "amber" | "red";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ui = useInterfaceText();
  return (
    <div className="grid grid-cols-[1fr_auto] gap-1.5">
      <button
        type="button"
        onClick={onConfirm}
        className="eidos-focus eidos-worldline-action"
        data-kind={variant === "red" ? "delete" : "restore"}
        data-confirming="true"
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="eidos-focus eidos-archive-button"
      >
        {ui("取消")}</button>
    </div>
  );
}
