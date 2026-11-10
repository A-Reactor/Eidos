import { useEffect } from 'react';

export function useFileDropGuard() {
  useEffect(() => {
    const preventFileNavigation = (event: DragEvent) => {
      const transfer = event.dataTransfer;
      if (!transfer) return;
      const hasFiles = Array.from(transfer.types ?? []).includes('Files')
        || Array.from(transfer.items ?? []).some(item => item.kind === 'file')
        || (transfer.files?.length ?? 0) > 0;
      // A WebView may navigate to a dropped file. Cancel that default even if a
      // child stops propagation, while letting import handlers receive the event.
      if (hasFiles) event.preventDefault();
    };
    window.addEventListener('dragover', preventFileNavigation, true);
    window.addEventListener('drop', preventFileNavigation, true);
    return () => {
      window.removeEventListener('dragover', preventFileNavigation, true);
      window.removeEventListener('drop', preventFileNavigation, true);
    };
  }, []);
}
