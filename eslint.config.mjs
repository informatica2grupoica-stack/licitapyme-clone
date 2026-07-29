import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Scripts sueltos (npx tsx scripts/...) — nunca se importan desde la app ni se empaquetan,
    // son diagnósticos/migraciones de una sola vez donde `any` en filas de DB es aceptable.
    "scripts/**",
  ]),
]);

export default eslintConfig;
