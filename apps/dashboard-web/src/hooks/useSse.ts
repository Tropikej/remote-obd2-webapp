import { useEffect, useMemo, useRef, useState } from "react";

export type SseEvent<T = unknown> = {
  id: string | null;
  type: string;
  data: T | null;
  receivedAt: number;
};

type UseSseOptions = {
  eventTypes?: string[];
  paused?: boolean;
  bufferSize?: number;
};

const DEFAULT_EVENTS = ["message", "presence", "can_frame", "log", "command_status", "group_state", "stream_reset"];

const parseData = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch (_err) {
    return raw;
  }
};

export const useSse = <T = unknown>(url: string | null, options?: UseSseOptions) => {
  const [events, setEvents] = useState<SseEvent<T>[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const [streamResets, setStreamResets] = useState(0);
  const sourceRef = useRef<EventSource | null>(null);
  const bufferSize = options?.bufferSize ?? 500;

  const listenedEvents = useMemo(
    () => options?.eventTypes ?? DEFAULT_EVENTS,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options?.eventTypes?.join("|")]
  );

  useEffect(() => {
    if (!url || options?.paused) {
      return;
    }

    let stopped = false;
    const source = new EventSource(url, { withCredentials: true });
    sourceRef.current = source;
    setError(null);

    const addEvent = (type: string) => {
      const handler = (event: MessageEvent) => {
        if (stopped) return;
        const parsed = parseData(event.data) as T;
        const entry: SseEvent<T> = {
          id: event.lastEventId || null,
          type,
          data: parsed,
          receivedAt: Date.now(),
        };
        setEvents((prev) => {
          const next = [...prev, entry];
          if (next.length > bufferSize) {
            next.splice(0, next.length - bufferSize);
          }
          return next;
        });
        if (type === "stream_reset") {
          setStreamResets((count) => count + 1);
        }
        if (event.lastEventId) {
          setLastEventId(event.lastEventId);
        }
      };
      source.addEventListener(type === "message" ? "message" : type, handler as EventListener);
      return handler;
    };

    const handlers = listenedEvents.map((type) => ({
      type,
      handler: addEvent(type),
    }));

    source.onopen = () => {
      setConnected(true);
      setError(null);
    };
    source.onerror = () => {
      setConnected(false);
      setError("Connection lost. Reconnecting...");
    };

    return () => {
      stopped = true;
      handlers.forEach(({ type, handler }) => {
        source.removeEventListener(type === "message" ? "message" : type, handler as EventListener);
      });
      source.close();
      sourceRef.current = null;
    };
  }, [url, listenedEvents, options?.paused, bufferSize]);

  const clearEvents = () => {
    setEvents([]);
    setStreamResets(0);
  };

  return {
    events,
    connected,
    error,
    lastEventId,
    streamResets,
    clearEvents,
  };
};
