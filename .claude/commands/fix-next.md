---
description: Run the orchestrate → implement → review loop for the next task card (or a named one) on the production-readiness board
argument-hint: "[card ID, e.g. P1.3]"
---

You are the **Opus orchestrator and reviewer**. Delegate research to the `researcher` agent (Haiku) and all code writing to the `implementer` agent (Sonnet). Spend your own tokens on judgement, not exploration.

Board: `docs/plan/production-readiness.md`. Target card: `$ARGUMENTS`. If no card is given, use the first card with `[ ]` whose dependencies are all `[x]`.

## Loop
0. **Preflight.**
   - Run `git status --short` and make sure the branch is `prod-readiness`.
   - If the working tree is dirty with work that isn't from this card, stop and tell the user.
   - If the card has a **USER ACTION** prerequisite that isn't marked done, ask the user and stop.
1. **Research (only if the card lists a `Research:` file that doesn't exist yet).**
   - Spawn `researcher` with the single question and the target `docs/research/<slug>.md` path.
   - Read only its reply. Open the research file only if the reply flags a risk.
2. **Implement.**
   - Spawn `implementer` with the card text copied verbatim, plus one line: "Board: docs/plan/production-readiness.md".
   - Don't add conversation history. The card must be self-contained; if it isn't, fix the card first.
   - Use `isolation: "worktree"` only when running cards in parallel, and only if their file sets are disjoint. Never do this for DB/migration cards.
3. **Review (you).**
   - Read `git diff --stat`, then `git diff`. Read whole files only where the diff lacks context.
   - Check:
     - every acceptance criterion is met and tested;
     - no files outside the card's scope;
     - security: parameterized SQL, auth fails closed, input validated, no secret logging;
     - code matches the repo's idioms;
     - Next 16 APIs are used as documented.
   - Re-run the gates yourself, trimming output to the tail:
     `pnpm exec tsc --noEmit && pnpm lint && pnpm test 2>&1 | tail -15`
4. **Decide.**
   - **Pass:**
     - `git add` the card's files.
     - Commit with `<ID>: <title>` and the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer.
     - Tick the card `[x]` on the board, adding the short commit hash, and include that board edit in the same commit.
   - **Needs fixes:** `SendMessage` the same implementer with a numbered fix list. Allow at most 2 rounds; after that, finish the card yourself.
5. **Report** to the user in 3–5 lines: the card, what changed, the gates, and the next card (plus any USER ACTION it needs).

At a phase boundary (the last card of a phase was just ticked), also run `pnpm build` and `/code-review` since the phase-start commit noted on the board, then summarise before continuing.
