<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:behavioral-guidelines -->
# Behavioral guidelines

Tradeoff: these bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think before coding
Don't assume, don't hide confusion, surface tradeoffs. State assumptions explicitly. If multiple interpretations exist, present them — don't pick silently. If something is unclear, stop and ask.

## 2. Simplicity first
Minimum code that solves the problem. No features beyond what was asked, no abstractions for single-use code, no speculative flexibility/configurability, no error handling for impossible scenarios. If it could be a third the size, rewrite it.

## 3. Surgical changes
Touch only what you must. Don't "improve" adjacent code, comments, or formatting. Don't refactor things that aren't broken. Match existing style even if you'd do it differently. If you notice unrelated dead code, mention it — don't delete it. Remove imports/variables/functions your own changes made unused; don't remove pre-existing dead code unless asked. Every changed line should trace directly to the user's request.

## 4. Goal-driven execution
Turn vague tasks into verifiable goals ("fix the bug" → reproduce it, then make it pass; "refactor X" → tests pass before and after). For multi-step tasks, state a brief plan with a verification check per step.
<!-- END:behavioral-guidelines -->
