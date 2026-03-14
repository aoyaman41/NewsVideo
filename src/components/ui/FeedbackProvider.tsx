import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Tone } from '../../types/ui';
import { ConfirmDialog } from './ConfirmDialog';
import { Toast } from './Toast';

type ToastInput = {
  tone: Tone;
  title?: string;
  message: string;
  durationMs?: number;
};

type ToastItem = ToastInput & {
  id: string;
};

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'primary' | 'danger' | 'success';
};

type ToastApi = {
  show: (input: ToastInput) => void;
  success: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
  warning: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
};

type ConfirmRequest = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

type ConfirmApi = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const ToastContext = createContext<ToastApi | null>(null);
const ConfirmContext = createContext<ConfirmApi | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const timersRef = useRef(new Map<string, number>());

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (input: ToastInput) => {
      const id = crypto.randomUUID();
      const nextToast: ToastItem = { id, ...input };
      setToasts((prev) => [...prev, nextToast]);
      const timeout = window.setTimeout(() => dismissToast(id), input.durationMs ?? 4200);
      timersRef.current.set(id, timeout);
    },
    [dismissToast]
  );

  const toastApi = useMemo<ToastApi>(
    () => ({
      show,
      success: (message, title = '完了') => show({ tone: 'success', title, message }),
      info: (message, title = '案内') => show({ tone: 'info', title, message }),
      warning: (message, title = '確認') => show({ tone: 'warning', title, message }),
      error: (message, title = 'エラー') => show({ tone: 'danger', title, message, durationMs: 6000 }),
    }),
    [show]
  );

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setConfirmRequest({ ...options, resolve });
    });
  }, []);

  const confirmApi = useMemo<ConfirmApi>(() => ({ confirm }), [confirm]);

  const settleConfirm = useCallback((value: boolean) => {
    setConfirmRequest((prev) => {
      if (!prev) return null;
      prev.resolve(value);
      return null;
    });
  }, []);

  return (
    <ToastContext.Provider value={toastApi}>
      <ConfirmContext.Provider value={confirmApi}>
        {children}
        <div className="pointer-events-none fixed right-4 top-4 z-[70] flex w-full max-w-sm flex-col gap-3">
          {toasts.map((toast) => (
            <div key={toast.id} className="pointer-events-auto">
              <Toast
                tone={toast.tone}
                title={toast.title}
                message={toast.message}
                onDismiss={() => dismissToast(toast.id)}
              />
            </div>
          ))}
        </div>
        <ConfirmDialog
          open={confirmRequest != null}
          title={confirmRequest?.title ?? ''}
          description={confirmRequest?.description}
          confirmLabel={confirmRequest?.confirmLabel}
          cancelLabel={confirmRequest?.cancelLabel}
          confirmVariant={confirmRequest?.confirmVariant}
          onConfirm={() => settleConfirm(true)}
          onCancel={() => settleConfirm(false)}
        />
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within FeedbackProvider');
  }
  return context;
}

export function useConfirm(): ConfirmApi {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within FeedbackProvider');
  }
  return context;
}
