import { useEffect, useId, useRef, useState } from 'react';
import { ApiRequestError, deleteScene, describeError } from '../api/client';

interface Props {
  id: string;
  name: string;
  /** Called after the API deleted the template. */
  onDeleted: (id: string) => void;
  onClose: () => void;
}

const IN_USE = 'This template is being rendered. Try again when the render finishes.';

/** Confirmation for deleting a generated template (native modal <dialog>, like ExportDialog). */
export function DeleteTemplateDialog({ id, name, onDeleted, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteScene(id);
    } catch (e) {
      // 404: already gone on the server, treat as deleted.
      if (!(e instanceof ApiRequestError && e.status === 404)) {
        setError(e instanceof ApiRequestError && e.status === 409 ? IN_USE : describeError(e));
        setBusy(false);
        return;
      }
    }
    onDeleted(id);
    ref.current?.close();
  };

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) ref.current?.close();
      }}
    >
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <h2 id={titleId} className="dialog-title">
          Delete "{name}"?
        </h2>
        <p className="hint">This can't be undone.</p>
        {error ? (
          <p className="error-box" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => ref.current?.close()}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
