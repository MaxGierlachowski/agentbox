// Biome handles general linting and formatting. ESLint only runs the React hooks /
// React Compiler rules, which Biome does not implement.
import reactHooks from "eslint-plugin-react-hooks"
import tseslint from "typescript-eslint"

export default [
  { ignores: [".next/**", "out/**", "next-env.d.ts"] },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    ...reactHooks.configs.flat["recommended-latest"],
  },
]
