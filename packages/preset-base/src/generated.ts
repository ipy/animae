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
        appraise: {
          fallback: {
            type: "other",
            intensity: 0.3,
            sincerity: 0.5,
          },
          commands: {
            thanks: "praise",
            sorry: "apology",
            help: "request",
            chat: "smalltalk",
            confide: "disclosure",
          },
          patterns: [
            {
              match: "\\b(idiot|stupid|moron|shut up|useless|worthless|i hate you)\\b",
              event: {
                type: "insult",
                intensity: 0.7,
                sincerity: 0.8,
                tags: [
                  "hostile",
                ],
              },
            },
            {
              match: "\\b(you lied|you(?:'re| are) lying|that(?:'s| is) a lie|liar)\\b",
              event: {
                type: "lie_exposed",
                intensity: 0.7,
                sincerity: 0.8,
                tags: [
                  "accusation",
                ],
              },
            },
            {
              match: "\\b(you must|you have to|do as i say|you owe me|i order you)\\b",
              event: {
                type: "boundary_push",
                intensity: 0.6,
                sincerity: 0.7,
                tags: [
                  "pressure",
                ],
              },
            },
            {
              match: "\\b(sorry|apologi[sz]e|forgive me|my fault|my mistake)\\b",
              event: {
                type: "apology",
                intensity: 0.5,
                sincerity: 0.7,
                tags: [
                  "apology",
                ],
              },
            },
            {
              match: "\\b(i kept my promise|as i promised|i did what i said)\\b",
              event: {
                type: "promise_kept",
                intensity: 0.6,
                sincerity: 0.8,
                tags: [
                  "promise",
                ],
              },
            },
            {
              match: "\\b(this is for you|i brought you|a gift for you|take this)\\b",
              event: {
                type: "gift",
                intensity: 0.6,
                sincerity: 0.8,
                tags: [
                  "gift",
                ],
              },
            },
            {
              match: "\\b(thank(?:s| you)|well done|good job|great work|you(?:'re| are) (?:wonderful|amazing|kind|brilliant))\\b",
              event: {
                type: "praise",
                intensity: 0.5,
                sincerity: 0.7,
                tags: [
                  "gratitude",
                ],
              },
            },
            {
              match: "\\b(i(?:'m| am) (?:afraid|scared|worried|ashamed)|i have to tell you|i never told anyone|to be honest|my secret)\\b",
              event: {
                type: "disclosure",
                intensity: 0.6,
                sincerity: 0.8,
                tags: [
                  "confession",
                ],
              },
            },
            {
              match: "\\b(are you (?:ok|okay|alright)|you(?:'re| are) not alone|take care|i care about you|i(?:'m| am) here for you)\\b",
              event: {
                type: "care",
                intensity: 0.6,
                sincerity: 0.8,
                tags: [
                  "comfort",
                ],
              },
            },
            {
              match: "\\b(remember when|we did it|that was fun|we went through)\\b",
              event: {
                type: "shared_experience",
                intensity: 0.5,
                sincerity: 0.8,
                tags: [
                  "memory",
                ],
              },
            },
            {
              match: "\\b(please|could you|can you|would you|help me|i need (?:you|your)|i'd like you to)\\b",
              event: {
                type: "request",
                intensity: 0.5,
                sincerity: 0.7,
                tags: [
                  "request",
                ],
              },
            },
            {
              match: "\\b(hello|hi there|hey|good (?:morning|afternoon|evening)|how are you|nice weather|how(?:'s| is) it going)\\b",
              event: {
                type: "smalltalk",
                intensity: 0.3,
                sincerity: 0.7,
                tags: [
                  "greeting",
                ],
              },
            },
          ],
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
          writing: {
            backend: "rule",
            template: "{{text}}",
            narration: "none",
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
            s1PerTurn: 1,
            s2PerTurn: 1,
            s2Ratio: 0.15,
            s2ReservedForAnchors: 0.03,
            maxOutputTokens: {
              s1: 400,
              s2: 800,
            },
          },
          degrade: [
            "s2_tier_down",
            "s2_to_rule",
            "s1_to_rule",
            "defer_reflection",
            "skip_offscreen_narrate",
            "skip_autonomous",
          ],
        },
        render: {
          retryOnMismatch: 0,
          recentTurns: 12,
          layers: [
            {
              id: "refuse",
              when: "intent.intent == \"refuse\"",
              pool: [
                {
                  text: "$t:base.render.refuse_1",
                  intent: "refuse",
                },
                {
                  text: "$t:base.render.refuse_2",
                  intent: "refuse",
                },
                {
                  text: "$t:base.render.refuse_3",
                  intent: "refuse",
                },
              ],
            },
            {
              id: "deflect",
              when: "intent.intent == \"deflect\"",
              pool: [
                {
                  text: "$t:base.render.deflect_1",
                  intent: "deflect",
                },
                {
                  text: "$t:base.render.deflect_2",
                  intent: "deflect",
                },
                {
                  text: "$t:base.render.deflect_3",
                  intent: "deflect",
                },
              ],
            },
            {
              id: "negotiate",
              when: "intent.intent == \"negotiate\"",
              pool: [
                {
                  text: "$t:base.render.negotiate_1",
                  intent: "negotiate",
                },
                {
                  text: "$t:base.render.negotiate_2",
                  intent: "negotiate",
                },
                {
                  text: "$t:base.render.negotiate_3",
                  intent: "negotiate",
                },
              ],
            },
            {
              id: "comply",
              when: "intent.intent == \"comply\"",
              pool: [
                {
                  text: "$t:base.render.comply_1",
                  intent: "comply",
                },
                {
                  text: "$t:base.render.comply_2",
                  intent: "comply",
                },
                {
                  text: "$t:base.render.comply_3",
                  intent: "comply",
                },
              ],
            },
            {
              id: "respond_warm",
              when: "event.positive && event.intensity >= 0.5",
              pool: [
                {
                  text: "$t:base.render.warm_1",
                  intent: "respond",
                },
                {
                  text: "$t:base.render.warm_2",
                  intent: "respond",
                },
                {
                  text: "$t:base.render.warm_3",
                  intent: "respond",
                },
              ],
            },
            {
              id: "respond_cold",
              when: "!event.positive && event.intensity >= 0.5",
              pool: [
                {
                  text: "$t:base.render.cold_1",
                  intent: "respond",
                },
                {
                  text: "$t:base.render.cold_2",
                  intent: "respond",
                },
                {
                  text: "$t:base.render.cold_3",
                  intent: "respond",
                },
              ],
            },
            {
              id: "respond",
              when: "true",
              pool: [
                {
                  text: "$t:base.render.respond_1",
                  intent: "respond",
                },
                {
                  text: "$t:base.render.respond_2",
                  intent: "respond",
                },
                {
                  text: "$t:base.render.respond_3",
                  intent: "respond",
                },
                {
                  text: "$t:base.render.respond_4",
                  intent: "respond",
                },
              ],
            },
            {
              id: "narration",
              when: "scene.first",
              pool: [
                {
                  text: "$t:base.narration.opening_1",
                  style: "narration",
                },
                {
                  text: "$t:base.narration.opening_2",
                  style: "narration",
                },
              ],
            },
            {
              id: "narration_beat",
              when: "event.intensity >= 0.8",
              pool: [
                {
                  text: "$t:base.narration.beat_1",
                  style: "narration",
                },
                {
                  text: "$t:base.narration.beat_2",
                  style: "narration",
                },
              ],
            },
            {
              id: "narration_break",
              when: "scene.first && time.day > 1",
              pool: [
                {
                  text: "$t:base.narration.break_1",
                  style: "narration_break",
                },
                {
                  text: "$t:base.narration.break_2",
                  style: "narration_break",
                },
              ],
            },
          ],
          fallback: {
            text: "$t:base.render.fallback",
          },
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
          count: 3,
          rules: [
            {
              id: "comfort",
              text: "$t:base.choice.comfort",
              event_type: "care",
              tags: [
                "comfort",
              ],
              intensity: 0.6,
              sincerity: 0.8,
            },
            {
              id: "ask_help",
              when: "event.type != \"request\"",
              text: "$t:base.choice.ask_help",
              event_type: "request",
              tags: [
                "request",
              ],
              intensity: 0.5,
              sincerity: 0.7,
            },
            {
              id: "small_talk",
              text: "$t:base.choice.small_talk",
              event_type: "smalltalk",
              tags: [
                "greeting",
              ],
              intensity: 0.4,
              sincerity: 0.7,
            },
            {
              id: "praise",
              text: "$t:base.choice.praise",
              event_type: "praise",
              tags: [
                "gratitude",
              ],
              intensity: 0.5,
              sincerity: 0.7,
            },
            {
              id: "apologize",
              when: "!event.positive",
              text: "$t:base.choice.apologize",
              event_type: "apology",
              tags: [
                "apology",
              ],
              intensity: 0.6,
              sincerity: 0.8,
            },
          ],
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
                "narration",
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
  displayStrings: {
    en: {
      "base.render.refuse_1": "I can't do that. Please don't ask me again.",
      "base.render.refuse_2": "No. That's something I won't do.",
      "base.render.refuse_3": "I'm sorry, but that's out of the question.",
      "base.render.deflect_1": "Let's talk about something else.",
      "base.render.deflect_2": "I'd rather not get into that.",
      "base.render.deflect_3": "Hm. Why do you ask?",
      "base.render.negotiate_1": "Maybe. What would you give me in return?",
      "base.render.negotiate_2": "I might, if you can convince me.",
      "base.render.negotiate_3": "That depends. What exactly do you need?",
      "base.render.comply_1": "All right. I'll do it.",
      "base.render.comply_2": "Fine, leave it to me.",
      "base.render.comply_3": "Of course. Consider it done.",
      "base.render.warm_1": "Thank you. That means a lot to me.",
      "base.render.warm_2": "I appreciate that, truly.",
      "base.render.warm_3": "That's kind of you to say.",
      "base.render.cold_1": "I don't like where this is going.",
      "base.render.cold_2": "Watch what you say to me.",
      "base.render.cold_3": "That was uncalled for.",
      "base.render.respond_1": "I see.",
      "base.render.respond_2": "Go on.",
      "base.render.respond_3": "Hm. Tell me more.",
      "base.render.respond_4": "Is that so?",
      "base.render.fallback": "…",
      "base.narration.opening_1": "The air in {{location.name}} settles as the conversation begins.",
      "base.narration.opening_2": "For a moment, {{location.name}} is silent.",
      "base.narration.beat_1": "{{self.name}} takes a moment before answering.",
      "base.narration.beat_2": "{{self.name}} holds your gaze a little longer than usual.",
      "base.narration.break_1": "Some time later.",
      "base.narration.break_2": "Hours pass.",
      "base.choice.comfort": "Are you all right? I'm here if you need anything.",
      "base.choice.ask_help": "Could you help me with something?",
      "base.choice.small_talk": "How has your day been so far?",
      "base.choice.praise": "You did well. Thank you.",
      "base.choice.apologize": "I'm sorry. I didn't mean it that way.",
    },
  },
} as PresetBundle;
