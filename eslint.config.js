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
		},
		rules: {
			"padding-line-between-statements": paddingRules,
			"multiline-comment-style": ["warn", "separate-lines"],
		},
	},
	prettierConfig,
];
