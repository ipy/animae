import type { Appraisal } from "../../src/events.ts";

/** Minimal appraisal payload for memory-writing tests. */
export function testAppraisal(partial: Pick<Appraisal, "type" | "intensity"> & Partial<Appraisal>): Appraisal {
  return {
    sincerity: 0.5,
    claims: [],
    search_terms: [],
    tags: [],
    input_class: "normal",
    ...partial,
  };
}
