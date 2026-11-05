/** Generated from YAML by scripts/gen-bundle.ts — do not edit by hand. */
import type { PresetBundle } from "@animae/engine";

export const generatedBundle = {
  id: "@animae/preset-dnd",
  extends: [
    "@animae/preset-base",
  ],
  policies: [
    {
      name: "policies/dnd.yaml",
      doc: {
        schema: {
          extend: {
            traits: {
              abilities: {
                type: "object",
                fields: {
                  STR: {
                    type: "integer",
                    min: 1,
                    max: 30,
                  },
                  DEX: {
                    type: "integer",
                    min: 1,
                    max: 30,
                  },
                  CON: {
                    type: "integer",
                    min: 1,
                    max: 30,
                  },
                  INT: {
                    type: "integer",
                    min: 1,
                    max: 30,
                  },
                  WIS: {
                    type: "integer",
                    min: 1,
                    max: 30,
                  },
                  CHA: {
                    type: "integer",
                    min: 1,
                    max: 30,
                  },
                },
              },
              level: {
                type: "integer",
                min: 1,
                max: 20,
              },
              proficiencies: {
                type: "array",
                items: {
                  type: "string",
                },
              },
            },
          },
        },
        x: {
          approaches: [
            "persuasion",
            "deception",
            "intimidation",
            "performance",
            "insight",
            "investigation",
            "perception",
          ],
          abilities: [
            "STR",
            "DEX",
            "CON",
            "INT",
            "WIS",
            "CHA",
          ],
          skills: {
            acrobatics: "DEX",
            animal_handling: "WIS",
            arcana: "INT",
            athletics: "STR",
            deception: "CHA",
            history: "INT",
            insight: "WIS",
            intimidation: "CHA",
            investigation: "INT",
            medicine: "WIS",
            nature: "INT",
            perception: "WIS",
            performance: "CHA",
            persuasion: "CHA",
            religion: "INT",
            sleight_of_hand: "DEX",
            stealth: "DEX",
            survival: "WIS",
          },
        },
        rules: {
          custom: [
            {
              id: "dnd_intimidation_extra",
              fn: "dndIntimidationExtra",
              stage: "adjudicate",
              when: "event.approach == \"intimidation\" && check != null && check.success",
            },
          ],
        },
        checks: [
          {
            id: "dnd_persuasion",
            when: "event.approach == \"persuasion\"",
            skill: "persuasion",
            expr: "\"1d20+\" + string(abilityMod(actor.traits.abilities.CHA) + (\"persuasion\" in actor.traits.proficiencies ? profBonus(actor.traits.level) : 0))",
            dc: "maxInt(15, self.traits.abilities.INT)",
            advantage: "tiers.affinity in [\"close\", \"devoted\"]",
            disadvantage: "tiers.affinity in [\"distant\", \"cool\"]",
            onFailure: {
              setType: "smalltalk",
            },
          },
          {
            id: "dnd_deception",
            when: "event.approach == \"deception\"",
            skill: "deception",
            expr: "\"1d20+\" + string(abilityMod(actor.traits.abilities.CHA) + (\"deception\" in actor.traits.proficiencies ? profBonus(actor.traits.level) : 0))",
            dc: "maxInt(15, self.traits.abilities.INT)",
            advantage: "tiers.affinity in [\"close\", \"devoted\"]",
            disadvantage: "tiers.affinity in [\"distant\", \"cool\"]",
            onSuccess: {
              addTags: [
                "deceived",
              ],
            },
            onFailure: {
              setType: "insincere_speech",
            },
          },
          {
            id: "dnd_intimidation",
            when: "event.approach == \"intimidation\"",
            skill: "intimidation",
            expr: "\"1d20+\" + string(abilityMod(actor.traits.abilities.CHA) + (\"intimidation\" in actor.traits.proficiencies ? profBonus(actor.traits.level) : 0))",
            dc: "maxInt(15, self.traits.abilities.INT)",
            advantage: "tiers.affinity in [\"close\", \"devoted\"]",
            disadvantage: "tiers.affinity in [\"distant\", \"cool\"]",
            onFailure: {
              setType: "insincere_speech",
            },
          },
          {
            id: "dnd_performance",
            when: "event.approach == \"performance\"",
            skill: "performance",
            expr: "\"1d20+\" + string(abilityMod(actor.traits.abilities.CHA) + (\"performance\" in actor.traits.proficiencies ? profBonus(actor.traits.level) : 0))",
            dc: "maxInt(15, self.traits.abilities.INT)",
            advantage: "tiers.affinity in [\"close\", \"devoted\"]",
            disadvantage: "tiers.affinity in [\"distant\", \"cool\"]",
            onFailure: {
              setType: "smalltalk",
            },
          },
          {
            id: "dnd_insight",
            when: "event.approach == \"insight\" && \"lie\" in event.tags",
            skill: "insight",
            expr: "\"1d20+\" + string(abilityMod(actor.traits.abilities.WIS) + (\"insight\" in actor.traits.proficiencies ? profBonus(actor.traits.level) : 0))",
            dc: "8 + abilityMod(self.traits.abilities.CHA) + (\"deception\" in self.traits.proficiencies ? profBonus(self.traits.level) : 0)",
            onSuccess: {
              emit: [
                {
                  kind: "info_arrival",
                  text: {
                    i18n: {
                      key: "dnd.check.insight_lie",
                    },
                  },
                  tags: [
                    "insight",
                    "deception",
                  ],
                },
              ],
            },
          },
          {
            id: "dnd_investigation",
            when: "event.approach == \"investigation\"",
            skill: "investigation",
            expr: "\"1d20+\" + string(abilityMod(actor.traits.abilities.INT) + (\"investigation\" in actor.traits.proficiencies ? profBonus(actor.traits.level) : 0))",
            dc: "maxInt(15, self.traits.abilities.INT)",
            onSuccess: {
              emit: [
                {
                  kind: "info_arrival",
                  text: {
                    i18n: {
                      key: "dnd.check.investigation_found",
                    },
                  },
                  tags: [
                    "investigation",
                    "exploration",
                  ],
                },
              ],
            },
          },
          {
            id: "dnd_perception",
            when: "event.approach == \"perception\"",
            skill: "perception",
            expr: "\"1d20+\" + string(abilityMod(actor.traits.abilities.WIS) + (\"perception\" in actor.traits.proficiencies ? profBonus(actor.traits.level) : 0))",
            dc: "maxInt(15, self.traits.abilities.INT)",
            onSuccess: {
              emit: [
                {
                  kind: "info_arrival",
                  text: {
                    i18n: {
                      key: "dnd.check.perception_unusual",
                    },
                  },
                  tags: [
                    "perception",
                    "exploration",
                  ],
                },
              ],
            },
          },
        ],
      },
    },
  ],
  knowledge: {
    "exploration/example-clue.md": "---\nname: dnd-example-hidden-clue\ndescription: Example knowledge unlocked by a successful Investigation check (preset-dnd template).\nscope: location:example-room\ninject: when\nwhen: \"check.success && event.approach == \\\"investigation\\\"\"\ntags: [exploration, investigation, example]\npriority: 1\n---\nThe loose brick behind the tapestry hides a rusted key marked with a lighthouse sigil.\n",
  },
  displayStrings: {
    en: {
      "dnd.check.insight_lie": "They seem to be lying.",
      "dnd.check.investigation_found": "The investigation turns up something.",
      "dnd.check.perception_unusual": "You notice something unusual.",
    },
    fr: {
      "dnd.check.insight_lie": "Ils ou elles mentent.",
      "dnd.check.investigation_found": "L'enquête aboutit à une découverte.",
      "dnd.check.perception_unusual": "Vous remarquez quelque chose d'inhabituel.",
    },
  },
} as PresetBundle;
