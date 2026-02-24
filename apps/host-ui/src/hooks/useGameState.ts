import { useCallback, useEffect, useMemo, useState } from 'react';
import { GameStatePublic, ToastEvent } from '@chicken-vault/shared';
import { io, Socket } from 'socket.io-client';
import { api } from '../api/client';

interface UseGameStateResult {
  state: GameStatePublic | null;
  loading: boolean;
  error: string | null;
  toasts: ToastEvent[];
  clearToast: (id: string) => void;
  refresh: () => Promise<void>;
}

export function useGameState(): UseGameStateResult {
  const [state, setState] = useState<GameStatePublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastEvent[]>([]);

  const clearToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback((toast: ToastEvent) => {
    setToasts((prev) => [...prev, toast].slice(-5));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((entry) => entry.id !== toast.id));
    }, 6000);
  }, []);

  const refresh = useCallback(async () => {
    const next = await api.getState();
    setState(next);
  }, []);

  useEffect(() => {
    let socket: Socket | null = null;
    let mounted = true;

    async function boot(): Promise<void> {
      try {
        const initial = await api.getState();
        if (!mounted) {
          return;
        }
        setState(initial);
        setError(null);
      } catch (err) {
        if (!mounted) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load game state');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }

      socket = io('/', {
        transports: ['websocket']
      });

      socket.on('state:update', (incoming: GameStatePublic) => {
        setState(incoming);
      });

      socket.on('toast', (toast: ToastEvent) => {
        addToast(toast);
      });

      socket.on('connect_error', () => {
        addToast({
          id: `socket-${Date.now()}`,
          message: 'Realtime connection failed. Retrying...',
          level: 'warning',
          ts: new Date().toISOString()
        });
      });
    }

    void boot();

    return () => {
      mounted = false;
      socket?.close();
    };
  }, [addToast]);

  return useMemo(
    () => ({
      state,
      loading,
      error,
      toasts,
      clearToast,
      refresh
    }),
    [state, loading, error, toasts, clearToast, refresh]
  );
}
