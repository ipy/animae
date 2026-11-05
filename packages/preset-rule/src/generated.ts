/** Generated from YAML by scripts/gen-bundle.ts — do not edit by hand. */
import type { PresetBundle } from "@animae/engine";

export const generatedBundle = {
  id: "@animae/preset-rule",
  extends: [
    "@animae/preset-base",
  ],
  policies: [
    {
      name: "policies/rule.yaml",
      doc: {
        choices: {
          enabled: true,
          count: 3,
        },
        appraise: {
          commands: {
            comfort: "care",
            gift: "gift",
            insult: "insult",
            threaten: "boundary_push",
            greet: "smalltalk",
          },
        },
        memory: {
          writing: {
            importanceByEventType: {
              care: 0.5,
              praise: 0.4,
              gift: 0.6,
              request: 0.4,
              promise_kept: 0.7,
              disclosure: 0.7,
              smalltalk: 0.2,
              lie_exposed: 0.9,
              insincere_speech: 0.6,
              boundary_push: 0.8,
              insult: 0.8,
              apology: 0.6,
              promise_broken: 0.9,
              shared_experience: 0.6,
              meta_probe: 0.3,
              other: 0.3,
            },
            valenceByEventType: {
              care: 0.5,
              praise: 0.5,
              gift: 0.6,
              request: 0,
              promise_kept: 0.6,
              disclosure: 0.4,
              smalltalk: 0.1,
              lie_exposed: -0.7,
              insincere_speech: -0.4,
              boundary_push: -0.6,
              insult: -0.8,
              apology: 0.3,
              promise_broken: -0.7,
              shared_experience: 0.6,
              meta_probe: -0.2,
              other: 0,
            },
          },
        },
        offscreen: {
          narrateTemplate: "$t:rule.offscreen.quiet",
        },
        scene: {
          autonomous: {
            rules: [
              {
                id: "idle",
                when: "true",
                pool: [
                  {
                    text: "$t:rule.autonomous.idle_1",
                  },
                  {
                    text: "$t:rule.autonomous.idle_2",
                  },
                  {
                    text: "$t:rule.autonomous.idle_3",
                  },
                ],
              },
            ],
          },
        },
      },
    },
  ],
  displayStrings: {
    en: {
      "rule.offscreen.quiet": "Nothing of note happens in {{location.name}}.",
      "rule.autonomous.idle_1": "Did you hear that?",
      "rule.autonomous.idle_2": "Let's keep our voices down.",
      "rule.autonomous.idle_3": "It has been a long day.",
    },
  },
} as PresetBundle;
