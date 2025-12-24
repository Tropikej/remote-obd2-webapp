import { ConsoleEvent, StreamResetEvent } from "@dashboard/shared";

type Listener = (event: StreamEvent) => void;

type StreamEvent = {
  id: number;
  type: ConsoleEvent["type"];
  data: ConsoleEvent;
  ts: number;
};

type StreamState = {
  nextId: number;
  buffer: StreamEvent[];
  listeners: Set<Listener>;
  frameTimestamps: number[];
  sampleFactor: number;
};

const BUFFER_MAX_EVENTS = 10000;
const BUFFER_MAX_AGE_MS = 60 * 1000;
const FRAME_RATE_WINDOW_MS = 2000;
const FRAME_RATE_THRESHOLD = 200; // events per second

export class StreamManager {
  private streams = new Map<string, StreamState>();

  private ensure(key: string): StreamState {
    let state = this.streams.get(key);
    if (!state) {
      state = {
        nextId: 1,
        buffer: [],
        listeners: new Set(),
        frameTimestamps: [],
        sampleFactor: 1,
      };
      this.streams.set(key, state);
    }
    return state;
  }

  private prune(state: StreamState) {
    const cutoff = Date.now() - BUFFER_MAX_AGE_MS;
    while (state.buffer.length > 0) {
      if (state.buffer.length > BUFFER_MAX_EVENTS) {
        state.buffer.shift();
        continue;
      }
      if (state.buffer[0].ts < cutoff) {
        state.buffer.shift();
        continue;
      }
      break;
    }
  }

  private toEvent(state: StreamState, type: ConsoleEvent["type"], data: ConsoleEvent): StreamEvent {
    return { id: state.nextId++, type, data, ts: Date.now() };
  }

  private maybeAdjustSampling(state: StreamState) {
    const now = Date.now();
    state.frameTimestamps = state.frameTimestamps.filter((ts) => now - ts <= FRAME_RATE_WINDOW_MS);
    const rate = state.frameTimestamps.length / (FRAME_RATE_WINDOW_MS / 1000);
    const desiredFactor =
      rate > FRAME_RATE_THRESHOLD ? Math.ceil(rate / FRAME_RATE_THRESHOLD) : 1;
    if (desiredFactor !== state.sampleFactor) {
      state.sampleFactor = desiredFactor;
      const level = desiredFactor === 1 ? "info" : "warn";
      const message =
        desiredFactor === 1
          ? "Sampling disabled; rate below threshold."
          : `Sampling enabled at 1 in ${desiredFactor} frames due to high rate (${rate.toFixed(1)} fps).`;
      return this.toEvent(state, "log", {
        type: "log",
        level,
        message,
        ts: new Date().toISOString(),
        code: "SAMPLING_CHANGE",
      });
    }
    return null;
  }

  publish(streamKey: string, type: ConsoleEvent["type"], data: ConsoleEvent) {
    const state = this.ensure(streamKey);
    if (type === "can_frame") {
      state.frameTimestamps.push(Date.now());
      const samplingChange = this.maybeAdjustSampling(state);
      if (samplingChange) {
        this.push(state, samplingChange);
      }
      if (state.sampleFactor > 1) {
        const count = state.frameTimestamps.length;
        if (count % state.sampleFactor !== 0) {
          return;
        }
      }
    }
    const event = this.toEvent(state, type, data);
    this.push(state, event);
  }

  private push(state: StreamState, event: StreamEvent) {
    state.buffer.push(event);
    this.prune(state);
    for (const listener of state.listeners) {
      listener(event);
    }
  }

  private emitReset(state: StreamState): StreamEvent {
    const reset: StreamResetEvent = {
      type: "stream_reset",
      reason: "history_unavailable",
      ts: new Date().toISOString(),
    };
    const event = this.toEvent(state, reset.type, reset);
    this.push(state, event);
    return event;
  }

  subscribe(
    streamKey: string,
    lastEventId: number | null,
    listener: Listener
  ): { unsubscribe: () => void } {
    const state = this.ensure(streamKey);
    const hasLast = lastEventId !== null && !Number.isNaN(lastEventId);
    if (hasLast) {
      const idx = state.buffer.findIndex((evt) => evt.id === lastEventId);
      if (idx >= 0) {
        const toReplay = state.buffer.slice(idx + 1);
        toReplay.forEach((evt) => listener(evt));
      } else {
        const reset = this.emitReset(state);
        listener(reset);
      }
    }
    state.listeners.add(listener);
    return {
      unsubscribe: () => {
        state.listeners.delete(listener);
      },
    };
  }
}

export const streamManager = new StreamManager();
