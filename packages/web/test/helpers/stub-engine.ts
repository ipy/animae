import type { Engine } from "@animae/engine";

export function galleryStub() {
  return {
    generatorAvailable: () => false,
    ratings: () => [],
    list: async () => [],
    get: async () => undefined,
    unlock: async () => {
      throw new Error("gallery stub");
    },
    capture: async () => ({ item: "cap-stub", job: "job-stub" }),
    render: async () => ({ job: "job-stub" }),
    cancel: async () => false,
    remove: async () => {},
    pin: async () => {},
    image: async () => undefined,
    jobs: () => [],
    subscribe: () => () => {},
  };
}

export function baseStubEngine(): Engine {
  return {
    world: { now: () => ({ day: 1, minute: 0 }) },
    query: () => ({}),
    timeline: { current: () => ({ name: "main" }) },
    scene: { start: async () => "s", end: async () => {}, turn: async function* () {} },
    mods: () => null,
    on: () => () => {},
    gallery: galleryStub(),
  } as unknown as Engine;
}
