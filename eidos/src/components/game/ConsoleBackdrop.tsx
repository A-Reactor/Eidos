"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


interface ConsoleBackdropProps {
  open: boolean;
  onClose: () => void;
}

export function ConsoleBackdrop({ open, onClose }: ConsoleBackdropProps) {
  const ui = useInterfaceText();
  if (!open) return null;

  return (
    <button
      type="button"
      aria-label={ui("返回对话主界面")}
      onClick={onClose}
      className="eidos-console-backdrop absolute inset-0 z-20 cursor-default"
    />
  );
}
