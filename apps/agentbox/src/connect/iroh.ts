// iroh-fetch picks its native addon with a dynamic require; scripts/compile.ts rewrites that to
// a static require of the target platform's addon so it is embedded in the binary.
export { createIrohFetch } from "iroh-fetch"
