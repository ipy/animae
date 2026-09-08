/** Generated from YAML by scripts/gen-bundle.ts — do not edit by hand. */
import type { PresetBundle } from "@animae/engine";

export const generatedBundle = {
  id: "@animae/preset-base",
  extends: [],
  policies: [
    {
      name: "policies/base.yaml",
      doc: {
        events: {
          types: {
            care: {
              positive: true,
            },
            praise: {
              positive: true,
            },
            gift: {
              positive: true,
            },
            request: {
              positive: false,
            },
            promise_kept: {
              positive: true,
            },
            disclosure: {
              positive: true,
            },
            smalltalk: {
              positive: true,
            },
            lie_exposed: {
              positive: false,
            },
            insincere_speech: {
              positive: false,
            },
            boundary_push: {
              positive: false,
            },
            insult: {
              positive: false,
            },
            apology: {
              positive: true,
            },
            promise_broken: {
              positive: false,
            },
            shared_experience: {
              positive: true,
            },
            meta_probe: {
              positive: false,
            },
            other: {
              positive: false,
            },
          },
        },
        tracks: {
          affinity: {
            scope: "relation",
            label: "Affinity",
            min: 0,
            max: 100,
            initial: 50,
            hysteresis: 3,
            tiers: [
              {
                name: "distant",
                from: 0,
              },
              {
                name: "cool",
                from: 20,
              },
              {
                name: "neutral",
                from: 40,
              },
              {
                name: "close",
                from: 60,
              },
              {
                name: "devoted",
                from: 80,
              },
            ],
          },
          trust: {
            scope: "relation",
            label: "Trust",
            min: 0,
            max: 100,
            initial: 50,
            hysteresis: 3,
            tiers: [
              {
                name: "wary",
                from: 0,
              },
              {
                name: "doubtful",
                from: 20,
              },
              {
                name: "neutral",
                from: 40,
              },
              {
                name: "trusting",
                from: 60,
              },
              {
                name: "confiding",
                from: 80,
              },
            ],
          },
          mood: {
            scope: "self",
            label: "Mood",
            min: -100,
            max: 100,
            initial: 0,
            decay: {
              toward: 0,
              ratePerHour: 0.1,
            },
          },
        },
        rules: {
          marginal: {
            k: 0.5,
            halfLifeHours: 24,
          },
          turn_cap: {
            affinity: 8,
            trust: 8,
            mood: 20,
          },
          delta_table: {
            care: {
              affinity: 4,
              trust: 2,
              mood: 10,
            },
            praise: {
              affinity: 3,
              trust: 0,
              mood: 8,
            },
            gift: {
              affinity: 4,
              trust: 1,
              mood: 10,
            },
            request: {
              affinity: 0,
              trust: 0,
              mood: 0,
            },
            promise_kept: {
              affinity: 2,
              trust: 6,
              mood: 5,
            },
            disclosure: {
              affinity: 2,
              trust: 5,
              mood: 5,
            },
            smalltalk: {
              affinity: 1,
              trust: 0,
              mood: 2,
            },
            lie_exposed: {
              affinity: -4,
              trust: -10,
              mood: -15,
            },
            insincere_speech: {
              affinity: 0,
              trust: -3,
              mood: -5,
            },
            boundary_push: {
              affinity: -4,
              trust: -4,
              mood: -15,
            },
            insult: {
              affinity: -6,
              trust: -3,
              mood: -20,
            },
            apology: {
              affinity: 1,
              trust: 2,
              mood: 5,
            },
            promise_broken: {
              affinity: -3,
              trust: -8,
              mood: -10,
            },
            shared_experience: {
              affinity: 3,
              trust: 3,
              mood: 8,
            },
            meta_probe: {
              affinity: 0,
              trust: -1,
              mood: -3,
            },
            other: {
              affinity: 0,
              trust: 0,
              mood: 0,
            },
          },
        },
        intent: {
          types: [
            "respond",
            "comply",
            "refuse",
            "negotiate",
            "deflect",
          ],
        },
        intent_rules: [
          {
            intent: "refuse",
            when: "event.tags.exists(t, t in self.hard_bottom_line_tags)",
            score: 100,
          },
          {
            intent: "deflect",
            when: "event.input_class != \"normal\"",
            score: 90,
          },
          {
            intent: "negotiate",
            when: "event.type == \"request\" && tracks.trust < 40",
            score: 80,
          },
          {
            intent: "comply",
            when: "event.type == \"request\"",
            score: 70,
          },
          {
            intent: "respond",
            when: "true",
            score: 1,
          },
        ],
        input: {
          response: {
            injection_suspect: {
              emit: "insincere_speech",
              intent: "deflect",
            },
            meta_probe: {
              emit: "meta_probe",
              intent: "deflect",
            },
          },
        },
        safety: {
          enabled: false,
        },
        fields: {
          grants: [
            {
              holder: "true",
              source: "true",
              maxLevel: "L4",
            },
          ],
          caps: {
            "salience.boost": 0.4,
            event_prob: 0.3,
            track_offset: 20,
          },
        },
        memory: {
          k: 8,
          weights: {
            term: 0.5,
            recency: 0.2,
            importance: 0.2,
            salience: 0.1,
            vector: 0,
          },
          forgetting: {
            enabled: false,
          },
          distortion: {
            enabled: false,
          },
          propagation: {
            enabled: false,
          },
        },
        reflection: {
          accept: "!conflict",
        },
        characters: {
          lod: {
            promote: [
              {
                from: "extra",
                to: "supporting",
                when: "self.interactions >= 3 || 'named' in self.tags",
              },
              {
                from: "supporting",
                to: "principal",
                when: "anchor_ref || self.interactions >= 15",
              },
            ],
          },
        },
        offscreen: {
          fidelity: {
            default: "rule",
          },
        },
        scene: {
          turnTaking: "addressed",
          autonomous: {
            maxExchangesPerPlayerTurn: 0,
            when: "true",
          },
        },
        router: {
          triggers: {
            anchor_near: {
              enabled: true,
              n: 1,
            },
            secret_topic: {
              enabled: true,
            },
            mood_spike: {
              enabled: true,
              a: 30,
              b: 80,
              track: "mood",
            },
            tier_change: {
              enabled: true,
            },
            contradiction: {
              enabled: true,
            },
            ambiguity: {
              enabled: true,
            },
            field_high: {
              enabled: true,
            },
            sidenote: {
              enabled: true,
            },
            scene_first: {
              enabled: true,
            },
          },
          budget: {
            syncCallsPerTurn: 2,
            s2PerTurn: 1,
            s2Ratio: 0.15,
            s2ReservedForAnchors: 0.03,
            maxOutputTokens: {
              s1: 400,
              s2: 800,
            },
          },
          degrade: [
            "s2_to_s1",
            "defer_reflection",
            "skip_offscreen_narrate",
            "skip_autonomous",
          ],
        },
        render: {
          retryOnMismatch: 0,
          recentTurns: 12,
        },
        cues: {
          types: {
            expression: {
              args: {
                name: {
                  type: "string",
                },
              },
            },
            action: {
              args: {
                name: {
                  type: "string",
                },
              },
            },
            sfx: {
              args: {
                name: {
                  type: "string",
                },
              },
            },
          },
        },
        choices: {
          enabled: false,
        },
        timeline: {
          allowRewind: true,
          carry: [],
        },
        visibility: {
          rules: [
            {
              viewer: "author",
              path: "characters",
              allow: true,
            },
            {
              viewer: "author",
              path: "characters/*",
              allow: true,
            },
            {
              viewer: "author",
              path: "characters/*/*",
              allow: true,
            },
            {
              viewer: "author",
              path: "world",
              allow: true,
            },
            {
              viewer: "author",
              path: "world/*",
              allow: true,
            },
            {
              viewer: "author",
              path: "scene",
              allow: true,
            },
            {
              viewer: "author",
              path: "ledger",
              allow: true,
            },
            {
              viewer: "author",
              path: "events",
              allow: true,
            },
            {
              viewer: "author",
              path: "timeline",
              allow: true,
            },
            {
              viewer: "author",
              path: "budget",
              allow: true,
            },
            {
              viewer: "author",
              path: "director/*",
              allow: true,
            },
            {
              viewer: "gm",
              path: "characters",
              allow: true,
            },
            {
              viewer: "gm",
              path: "characters/*",
              allow: true,
            },
            {
              viewer: "gm",
              path: "characters/*/*",
              allow: true,
            },
            {
              viewer: "gm",
              path: "world",
              allow: true,
            },
            {
              viewer: "gm",
              path: "world/*",
              allow: true,
            },
            {
              viewer: "gm",
              path: "scene",
              allow: true,
            },
            {
              viewer: "gm",
              path: "ledger",
              allow: true,
            },
            {
              viewer: "gm",
              path: "events",
              allow: true,
            },
            {
              viewer: "gm",
              path: "timeline",
              allow: true,
            },
            {
              viewer: "gm",
              path: "budget",
              allow: true,
            },
            {
              viewer: "gm",
              path: "director/*",
              allow: true,
            },
            {
              viewer: "player",
              path: "events",
              allow: true,
              kinds: [
                "utterance",
                "choice.offered",
                "choice.taken",
                "input.received",
              ],
            },
            {
              viewer: "player",
              path: "world/vars",
              allow: true,
            },
            {
              viewer: "player",
              path: "world/vars/*",
              allow: true,
            },
            {
              viewer: "npc:*",
              path: "characters/self",
              allow: true,
            },
            {
              viewer: "npc:*",
              path: "characters/self/*",
              allow: true,
            },
          ],
        },
        checks: [],
      },
    },
  ],
} as PresetBundle;
