/// <reference types="vitest" />
import { describe, expect, it } from "vitest";
import { StreamManager } from "./streams";

describe("StreamManager", () => {
  it("replays events since Last-Event-ID", () => {
    const manager = new StreamManager();
    const events: number[] = [];
    manager.publish("dongle:1", "log", {
      type: "log",
      level: "info",
      message: "first",
      ts: new Date().toISOString(),
    });
    manager.publish("dongle:1", "log", {
      type: "log",
      level: "info",
      message: "second",
      ts: new Date().toISOString(),
    });

    manager.subscribe("dongle:1", 1, (evt) => events.push(evt.id));

    expect(events).toEqual([2]);
  });

  it("emits stream_reset when history is unavailable", () => {
    const manager = new StreamManager();
    const types: string[] = [];
    manager.publish("dongle:2", "log", {
      type: "log",
      level: "info",
      message: "only",
      ts: new Date().toISOString(),
    });

    manager.subscribe("dongle:2", 999, (evt) => types.push(evt.type));

    expect(types[0]).toBe("stream_reset");
  });
});
