# Coding Standards

These rules apply to all TypeScript/JavaScript source in `src/`, `scripts/`, `electron/`, and
`renderer/src/`.

## Formatting (enforced by Prettier)

- Indent with tabs, not spaces.
- Run `npm run format` to apply formatting, `npm run format:check` to verify it in CI.

Config lives in [.prettierrc.json](.prettierrc.json). Files/directories excluded from formatting
(build output, binary assets, data dumps) are listed in [.prettierignore](.prettierignore).

## Structural style (enforced by ESLint)

- Leave a blank line before a `return` statement, unless it's the first statement in its
  enclosing block.
- Leave a blank line after the closing `}` of an `if`/`else if`/`else`/`for`/`while`/`switch`
  block when more code follows in the same enclosing block. Skip the blank line when that `}` is
  immediately followed by `else`/`else if`/`catch`/`finally`, or by the enclosing block's own
  closing `}`.

Run `npm run lint` to check, `npm run lint:fix` to auto-fix. Config lives in
[eslint.config.js](eslint.config.js).

## Comments (not mechanically enforced — use judgment in review)

- Prefer a single-line `//` comment over a multi-line `/** ... */` block.
- Condense a comment down to the one sentence that captures the *why* (not a restatement of what
  the code already says).
- Only keep a multi-line block when a single sentence would genuinely lose a necessary invariant
  (e.g. a multi-step priority/precedence rule).

ESLint warns on any remaining `/** ... */` block (via the local `no-jsdoc-blocks` rule in
[eslint.config.js](eslint.config.js), since `multiline-comment-style` ignores JSDoc-style blocks), but converting it to a well-condensed single sentence is a judgment
call `--fix` can't make safely — do that by hand.

## Types

- Remove unused imports, variables, and functions (`@typescript-eslint/no-unused-vars` is an error;
  prefix an intentionally unused parameter with `_`).
- Don't use `any` (`@typescript-eslint/no-explicit-any` is an error); use a real type or `unknown`.
