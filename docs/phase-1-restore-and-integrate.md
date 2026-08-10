# Phase 1 — Restore and Integrate 8-Ball Coach

This project phase restores the existing 8-Ball Coach adaptive-training
prototype from the supplied source snapshot into the current application.

## Scope

- Preserve the existing adaptive coaching engine and its behaviour.
- Restore the mobile-first dark pool-themed UI.
- Use `8-Ball Coach` as the product name.
- Keep the shared 10-skill model and the execution/decision distinction.
- Add a modular foundation for `blackball` and `international` rulesets.
- Add browser `localStorage` persistence behind a small adapter.
- Keep drills, decision scenarios, clearance flows, assessment, training,
  summaries, progress, and the drill library functional.
- Add deterministic engine tests for the recovered behaviour.

## Explicitly deferred

- Match and frame logging.
- Frame-impact analysis from match history.
- Database or cloud persistence.
- Authentication.
- Paid services.
- Full foul/legal-shot modelling.
- Major visual redesign.
- The broader A–X product test matrix.

## Source-preservation rules

- Do not replace the prototype with a random drill picker.
- Keep raw execution evidence separate from root-cause diagnosis.
- Keep decisions, execution, and outcomes separate.
- Keep shared physical skills shared across rulesets.
- Preserve scenario-specific options, rationale, risk, clearances, routes,
  adaptations, error chains, maintenance, calibration, and session generation.
- Commit the restored milestone to GitHub with a clear message after it runs.

The detailed phase handover is retained in the attached project materials and
this file is the source-controlled implementation brief for the milestone.