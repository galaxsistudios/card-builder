const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");
const prettierConfig = require("eslint-config-prettier");

// Enforces the structural parts of CODING_STANDARDS.md that Prettier can't express:
// blank line before `return` (unless it opens its block) and blank line after a
// closing `}` of if/else/for/while/switch (unless it's immediately followed by
// else/catch/finally or it's the last statement in its block).
const paddingRules = [
	"error",
	{ blankLine: "always", prev: "*", next: "return" },
	{ blankLine: "always", prev: "block-like", next: "*" },
	{ blankLine: "any", prev: "block-like", next: ["break", "continue"] },
];

// `multiline-comment-style` skips JSDoc-style blocks, so flag those separately - CODING_STANDARDS.md
// asks for a condensed `//` comment instead of a `/** ... */` block.
const noJsdocBlocks = {
	meta: { type: "suggestion", schema: [] },
	create(context) {
		return {
			Program() {
				for (const comment of context.sourceCode.getAllComments()) {
					if (comment.type === "Block" && comment.value.startsWith("*")) {
						context.report({
							loc: comment.loc,
							message:
								"Use `//` comments instead of a `/** ... */` block (see CODING_STANDARDS.md).",
						});
					}
				}
			},
		};
	},
};

module.exports = [
	{
		ignores: [
			"node_modules/**",
			"dist/**",
			"output/**",
			"renderer/node_modules/**",
			"renderer/dist/**",
			"renderer/.angular/**",
		],
	},
	{
		files: ["**/*.ts", "**/*.js"],
		languageOptions: {
			parser: tsParser,
			sourceType: "module",
		},
		plugins: {
			"@typescript-eslint": tsPlugin,
			local: { rules: { "no-jsdoc-blocks": noJsdocBlocks } },
		},
		rules: {
			"padding-line-between-statements": paddingRules,
			"multiline-comment-style": ["warn", "separate-lines"],
			"local/no-jsdoc-blocks": "warn",
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", caughtErrors: "none" },
			],
		},
	},
	prettierConfig,
];
