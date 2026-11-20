/** Module boundaries from docs/implementation-plan.md, section 5. */
module.exports = {
  forbidden: [
    {
      name: "web-only-uses-contract-spec-ui",
      comment: "The UI bundle must never pull in server code.",
      severity: "error",
      from: { path: "^apps/web" },
      to: { path: "^packages/(infra|engine|providers)|^apps/agentbox" },
    },
    {
      name: "infra-knows-no-providers",
      severity: "error",
      from: { path: "^packages/infra" },
      to: { path: "^packages/(engine|providers)|^apps/" },
    },
    {
      name: "engine-stays-generic",
      severity: "error",
      from: { path: "^packages/engine" },
      to: { path: "^packages/providers|^apps/" },
    },
    {
      name: "packages-do-not-import-apps",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(\\.next|out|dist|\\.build)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "default"] },
  },
}
