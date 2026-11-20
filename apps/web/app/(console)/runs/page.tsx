import { Suspense } from "react"
import { RunsView } from "./runs-view"

export const metadata = { title: "Runs" }

// Detail pages use ?id= instead of a dynamic segment: the UI is a static export.
export default function RunsPage() {
  return (
    <Suspense>
      <RunsView />
    </Suspense>
  )
}
