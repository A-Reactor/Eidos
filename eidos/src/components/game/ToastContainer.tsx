"use client";

type ToastTone = "system" | "success" | "warning" | "alice" | "kei" | "archive";

interface Toast {
  id: number;
  text: string;
  color?: string;
}

interface ToastContainerProps {
  toasts: Toast[];
}

interface ToastViewModel {
  actor: string;
  label: string;
  tone: ToastTone;
}

function resolveToastModel(toast: Toast): ToastViewModel {
  const text = toast.text;
  const color = toast.color?.toLowerCase() ?? "";

  if (color === "red" || color === "#dc503c" || /中断|早停|失败|超时|离线|没有回应|错误|不可用/.test(text)) {
    return { actor: "SYSTEM", label: "ATTENTION", tone: "warning" };
  }
  if (/ALICE/i.test(text)) {
    return { actor: "ALICE", label: "NARRATIVE PASS", tone: "alice" };
  }
  if (/KEI/i.test(text) || /token|审核|修正|整理/.test(text)) {
    return { actor: "KEI", label: "REVIEW / COST", tone: "kei" };
  }
  if (/图片|场景图|立绘|上传|绑定/.test(text)) {
    return { actor: "ASSETS", label: "IMAGE RESOURCE", tone: "archive" };
  }
  if (/情报|百科|NPC|线索|任务|物品|书签|回溯/.test(text)) {
    return { actor: "ARCHIVE", label: "WORLD MEMORY", tone: "archive" };
  }
  if (color === "#fbbf24" || color === "#f59e0b" || /已完成|已开启|已关闭|已写入|重新连接/.test(text)) {
    return { actor: "SYSTEM", label: "CONFIRMED", tone: "success" };
  }
  if (color === "#8b5cf6" || color === "#a855f7") {
    return { actor: "KEI", label: "STATE SHIFT", tone: "kei" };
  }

  return { actor: "SYSTEM", label: "CONTROL", tone: "system" };
}

export function ToastContainer({ toasts }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="eidos-toast-stack pointer-events-none fixed bottom-16 right-5 z-10 space-y-2">
      {toasts.slice(-4).map((t) => {
        const model = resolveToastModel(t);
        return (
          <div key={t.id} className="eidos-toast" data-tone={model.tone}>
            <div className="eidos-toast__rail" aria-hidden="true" />
            <div className="min-w-0">
              <div className="eidos-toast__meta">
                <span>{model.actor}</span>
                <span>{model.label}</span>
                <span>NOW</span>
              </div>
              <div className="eidos-toast__body">{t.text}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
