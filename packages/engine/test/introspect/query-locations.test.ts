import { describe, expect, test } from "bun:test";
import { createCatalog } from "../../src/authored/catalog.ts";
import { createIntrospect } from "../../src/introspect/service.ts";
import { buildTestKernel, minimalAuthored } from "../helpers/fake-kernel.ts";

describe("world/locations queries", () => {
  function setup() {
    const authored = minimalAuthored({
      locations: {
        cafe: {
          id: "cafe",
          name: "Cafe",
          summary: "Warm and loud.",
          tags: [],
          connects: [{ to: "street", label: "front door", minutes: 3 }],
          vars: { open: true },
        },
        street: { id: "street", name: "Street", summary: "", tags: [], connects: [], vars: {} },
      },
    });
    const k = buildTestKernel(authored);
    Object.assign(k, { catalog: createCatalog(() => authored, () => k.timeline.state().generated) });
    return createIntrospect(k);
  }

  test("a location reads its prose and exits from the definition and its variables and clock from the world", () => {
    expect(setup().query("debug", "world/locations/cafe")).toEqual({
      id: "cafe",
      name: "Cafe",
      summary: "Warm and loud.",
      connects: [{ to: "street", label: "front door", minutes: 3 }],
      vars: { open: true },
      lastSimulated: { day: 1, minute: 480 },
    });
  });

  test("the list names every location with its variables only", () => {
    expect(setup().query("debug", "world/locations")).toEqual([
      { id: "cafe", name: "Cafe", vars: { open: true } },
      { id: "street", name: "Street", vars: {} },
    ]);
  });

  test("an unknown location is undefined", () => {
    expect(setup().query("debug", "world/locations/nowhere")).toBeUndefined();
  });
});
