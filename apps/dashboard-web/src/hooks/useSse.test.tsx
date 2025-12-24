import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { useSse } from "./useSse";

type Listener = (event: MessageEvent) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  withCredentials: boolean;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners: Record<string, Listener[]> = {};

  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = Boolean(init?.withCredentials);
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== listener);
  }

  close() {
    this.listeners = {};
  }

  emit(type: string, data: unknown, id?: string) {
    const event = {
      data: typeof data === "string" ? data : JSON.stringify(data),
      lastEventId: id ?? "",
    } as MessageEvent;
    (this.listeners[type] ?? []).forEach((listener) => listener(event));
  }
}

describe("useSse", () => {
  const original = global.EventSource;

  beforeEach(() => {
    MockEventSource.instances = [];
    // @ts-expect-error test shim
    global.EventSource = MockEventSource;
  });

  afterEach(() => {
    global.EventSource = original;
  });

  it("collects events and tracks last event id", () => {
    const { result } = renderHook(() => useSse("/stream"));
    const source = MockEventSource.instances[0];

    act(() => {
      source.onopen?.();
      source.emit("can_frame", { id: "0x1", direction: "rx" }, "5");
    });

    expect(result.current.connected).toBe(true);
    expect(result.current.lastEventId).toBe("5");
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].type).toBe("can_frame");
    expect(result.current.events[0].data).toEqual({ id: "0x1", direction: "rx" });
  });

  it("counts stream resets and clears events", () => {
    const { result } = renderHook(() => useSse("/stream"));
    const source = MockEventSource.instances[0];

    act(() => {
      source.emit("stream_reset", {});
      source.emit("presence", { online: true });
    });

    expect(result.current.streamResets).toBe(1);
    expect(result.current.events.length).toBe(2);

    act(() => {
      result.current.clearEvents();
    });

    expect(result.current.streamResets).toBe(0);
    expect(result.current.events.length).toBe(0);
  });
});
