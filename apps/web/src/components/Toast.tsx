import { useEffect } from 'react';

interface Props {
  message: string;
  actionLabel: string;
  onAction: () => void;
  onDismiss: () => void;
}

/** Non-blocking; announced separately through the app's live region, so it is not a live region itself. */
export function Toast({ message, actionLabel, onAction, onDismiss }: Props) {
  useEffect(() => {
    const t = window.setTimeout(onDismiss, 10_000);
    return () => window.clearTimeout(t);
  }, [message, onDismiss]);
  return (
    <div className="toast">
      <span>{message}</span>
      <button type="button" className="btn primary" onClick={onAction}>
        {actionLabel}
      </button>
      <button type="button" className="btn" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
