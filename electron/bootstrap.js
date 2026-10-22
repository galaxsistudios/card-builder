// Electron's main process entry point. Registers ts-node so the actual entry (main.ts) - and
// everything it requires, including the reused src/scripts TypeScript modules - run straight from
// source, same as the rest of this project's ts-node based CLI scripts (no separate build step,
// and no risk of the compiled output tree changing any `__dirname`-relative paths those modules
// rely on, e.g. PSD_PATH/DATA_FILE).
require("ts-node/register");
require("./main.ts");
