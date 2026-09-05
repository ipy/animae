---
name: dnd-example-hidden-clue
description: Example knowledge unlocked by a successful Investigation check (preset-dnd template).
scope: location:example-room
inject: when
when: "check.success && event.approach == \"investigation\""
tags: [exploration, investigation, example]
priority: 1
---
The loose brick behind the tapestry hides a rusted key marked with a lighthouse sigil.
