---
name: 8-Ball Coach nesting trap
description: Critical layout rule for adding metadata to drill/clearance entries in engine/index.ts
---

## The trap

Drill entries end with `diagram: { balls: [...] } },`. When adding new top-level fields (objective, setup, successCriteria, scenarioPurpose) you must close `diagram` FIRST, then add the fields:

```ts
// WRONG — fields end up on diagram, not the drill:
  ] objective: "...", setup: "..." } },

// CORRECT — ] } closes balls+diagram, then fields are on the drill spread:
  ] }, objective: "...", setup: "..." },
```

**Why:** The pattern `{ ...execDrill(...), diagram: { balls: [...] } }` has two layers of `{}`. Adding properties after `]` but before `}` puts them inside `diagram`, not the drill object. TypeScript won't always catch this at compile time if the extra properties aren't typed on `TrainingDiagram`.

**How to apply:** Whenever editing an exec/decision drill entry to add top-level metadata, always write `] }` (closing both balls array and diagram object) before the new comma-separated fields, and end with a single `},` (closing the drill array element).

The same rule applies to `diagram: { playerGroup: ..., balls: [...] }` — close the diagram with `] }` before adding drill-level fields.
