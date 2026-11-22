import { Suspense } from "react"
import { DevicesView } from "./devices-view"

export const metadata = { title: "Devices" }

export default function DevicesPage() {
  return (
    <Suspense>
      <DevicesView />
    </Suspense>
  )
}
