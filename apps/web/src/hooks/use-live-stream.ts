'use client';

import { useEffect, useRef } from 'react';
import { streamUrl } from '@/lib/api';

/**
 * Subscribe to a backend SSE topic (dashboard | admin | analytics | session:<id>).
 * `onEvent(type, data)` fires for every pushed event — this is what makes the
 * dashboards live instead of static. Reconnects automatically via EventSource.
 */
export function useLiveStream(topic: string | null, onEvent: (type: string, data: any) => void) {
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    if (!topic) return;
    const es = new EventSource(streamUrl(topic), { withCredentials: true });

    // Known event types pushed by the backend event bus.
    const types = [
      'session_created', 'session_updated', 'session_ended', 'session_event',
      'metrics', 'recording_status', 'message', 'transcript', 'ai_insight',
      'event', 'config_updated',
    ];
    const handlers = types.map((t) => {
      const h = (e: MessageEvent) => {
        try {
          cb.current(t, JSON.parse(e.data));
        } catch {
          /* ignore */
        }
      };
      es.addEventListener(t, h);
      return [t, h] as const;
    });

    es.onerror = () => {
      /* EventSource auto-reconnects; nothing to do */
    };

    return () => {
      handlers.forEach(([t, h]) => es.removeEventListener(t, h));
      es.close();
    };
  }, [topic]);
}
