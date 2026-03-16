# Project Agent Rules

These rules are mandatory for all future work in this repository.

## Quality

- Always add or update unit tests for every code change that can be covered by tests.
- Do not consider a task complete until the relevant tests have been run or a concrete testing blocker has been documented.
- Prioritize user-visible correctness and regression safety over speed.

## Commits

- Use atomic commits only.
- Each commit must contain one coherent change set with a clear purpose.
- Keep using conventional commit prefixes such as `feat:`, `fix:`, `chore:`, and `ci:`.

## Product Requirements

- The application must be multilingual. New user-facing text should be added in a way that supports localization instead of hardcoded single-language UI.
- Maintain `CHANGELOG.md` for user-visible changes.
- No AI slop. Preserve intentional, product-specific UI and UX. Avoid generic generated layouts, copy, and interactions.
