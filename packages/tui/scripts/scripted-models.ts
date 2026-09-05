import { createScriptedModel, type ModelPort } from "@animae/engine";

export type TurnScript = {
  match?: string;
  appraise?: Record<string, unknown>;
  render?: Record<string, unknown>;
};

export function createDemoScriptedModels(scripts: TurnScript[]): { s1: ModelPort; s2: ModelPort } {
  const handler = (req: { label?: string; segments?: { user?: string } }) => {
    const user = req.segments?.user ?? "";
    const script = scripts.find((s) => s.match && user.includes(s.match)) ?? scripts[0];
    if (req.label === "appraise") {
      return (
        script?.appraise ?? {
          type: "chat",
          intensity: 0.5,
          sincerity: 0.9,
          claims: [],
          search_terms: [],
          tags: [],
          input_class: "normal",
        }
      );
    }
    return (
      script?.render ?? {
        text: "Demo reply.",
        cues: [],
        intent_realized: "talk",
      }
    );
  };
  return {
    s1: createScriptedModel("demo/s1", handler),
    s2: createScriptedModel("demo/s2", handler),
  };
}
