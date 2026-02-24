import { ToastEvent } from '@chicken-vault/shared';

interface ToastStackProps {
  toasts: ToastEvent[];
  onDismiss: (id: string) => void;
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps): JSX.Element {
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          className={`toast-item toast-${toast.level}`}
          onClick={() => onDismiss(toast.id)}
          type="button"
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}
