import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "node_modules/**", "src/generated/**", "public/sw.js", "playwright-report/**", "test-results/**", "next-env.d.ts"]),
  {
    rules: {
      // Private images are served by authorised API routes; next/image optimisation would cache them publicly.
      "@next/next/no-img-element": "off",
    },
  },
]);
