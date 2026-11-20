import { describe, expect, it } from "vitest";
import { installModelPin } from "../lib/model-pin.js";
import { createEvents } from "./helpers/fakes.js";

/**
 * Build a child agent double with a recording model seam.
 * @param {string} id - child identity.
 * @param {object} [options] - seam overrides.
 * @param {boolean} [options.withModel] - whether the agent exposes a model seam.
 * @returns {object} child agent double.
 */
function childAgent(id, { withModel = true } = {}) {
  const selections = [];
  return {
    id,
    selections,
    ...(withModel
      ? { model: { select: (selection) => selections.push(selection) } }
      : {})
  };
}

describe("installModelPin", () => {
  it("pins the reserved child to the settled route", () => {
    const events = createEvents();
    const pin = installModelPin({ events });
    const child = childAgent("child-1");

    pin.register("child-1", { provider: "codex", model: "gpt-6.2-sol", reasoningEffort: "high" });
    events.emit("agent/created", { agent: child });

    expect(child.selections).toEqual([
      { provider: "codex", model: "gpt-6.2-sol", reasoningEffort: "high" }
    ]);
  });

  it("pins a route that resolved no effort without adding one", () => {
    const events = createEvents();
    const pin = installModelPin({ events });
    const child = childAgent("child-1");

    pin.register("child-1", { provider: "p", model: "m" });
    events.emit("agent/created", { agent: child });

    expect(child.selections).toEqual([{ provider: "p", model: "m" }]);
    expect(Object.hasOwn(child.selections[0], "reasoningEffort")).toBe(false);
  });

  it("leaves a child that was never reserved untouched", () => {
    const events = createEvents();
    installModelPin({ events });
    const child = childAgent("someone-else");

    events.emit("agent/created", { agent: child });

    expect(child.selections).toEqual([]);
  });

  it("consumes a reservation once so a later child with the same id is untouched", () => {
    const events = createEvents();
    const pin = installModelPin({ events });
    const first = childAgent("child-1");
    const second = childAgent("child-1");

    pin.register("child-1", { provider: "p", model: "m" });
    events.emit("agent/created", { agent: first });
    events.emit("agent/created", { agent: second });

    expect(first.selections).toHaveLength(1);
    expect(second.selections).toHaveLength(0);
  });

  it("keeps concurrent reservations apart by identity", () => {
    const events = createEvents();
    const pin = installModelPin({ events });
    const a = childAgent("child-a");
    const b = childAgent("child-b");

    pin.register("child-a", { provider: "p", model: "model-a" });
    pin.register("child-b", { provider: "p", model: "model-b" });
    events.emit("agent/created", { agent: b });
    events.emit("agent/created", { agent: a });

    expect(a.selections).toEqual([{ provider: "p", model: "model-a" }]);
    expect(b.selections).toEqual([{ provider: "p", model: "model-b" }]);
  });

  it("reports an applied pin and then forgets it", () => {
    const events = createEvents();
    const pin = installModelPin({ events });
    const child = childAgent("child-1");

    pin.register("child-1", { provider: "p", model: "m" });
    events.emit("agent/created", { agent: child });

    expect(pin.settle("child-1")).toBe(true);
    // A second settle must not report the earlier child as pinned.
    expect(pin.settle("child-1")).toBe(false);
  });

  it("reports no pin when the reservation never produced a child", () => {
    const events = createEvents();
    const pin = installModelPin({ events });
    const child = childAgent("child-1");

    pin.register("child-1", { provider: "p", model: "m" });
    expect(pin.settle("child-1")).toBe(false);

    // A late event must not consume a reservation that was already settled.
    events.emit("agent/created", { agent: child });
    expect(child.selections).toEqual([]);
  });

  it("fails loud when the child cannot take the selection", () => {
    const events = createEvents();
    const pin = installModelPin({ events });
    const child = childAgent("child-1", { withModel: false });

    pin.register("child-1", { provider: "p", model: "m" });

    // Silently leaving the child on the caller route is the divergence the pin exists to remove.
    expect(() => events.emit("agent/created", { agent: child }))
      .toThrow("exposed no `agent.model.select` seam");
    expect(pin.settle("child-1")).toBe(false);
  });

  it("stops pinning after disposal", () => {
    const events = createEvents();
    const pin = installModelPin({ events });
    const child = childAgent("child-1");

    pin.register("child-1", { provider: "p", model: "m" });
    pin.dispose();
    events.emit("agent/created", { agent: child });

    expect(child.selections).toEqual([]);
  });
});
