/**
 * The lint the community directory runs, run locally.
 *
 * Obsidian's submission review lints every plugin with
 * `eslint-plugin-obsidianmd` and publishes the result on the plugin's review
 * page. Reproducing it here is the difference between fixing what the report
 * said and fixing what the linter actually finds: the report names rules and
 * line numbers, not the code that has to change, and it only regenerates on
 * submission.
 *
 * Scoped to `src/`, which is what ships. `tests/` is deliberately excluded:
 * the harness models Obsidian's own DOM helpers against jsdom, so the rules
 * that push code towards `createEl` and `instanceOf` would be telling the
 * stub to call the thing it exists to provide.
 */
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  // Everything that is not shipped source. `npm run lint` passes `src` on
  // the command line as well, so a stray `npx eslint .` behaves the same.
  globalIgnores([
    "main.js",
    "node_modules/",
    "docs/",
    ".scratch/",
    "tests/",
    "*.config.ts",
    "*.config.mjs",
  ]),
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*"],
        },
      },
    },
  },
]);
