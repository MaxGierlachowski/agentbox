import { Suspense } from "react"
import { FullPageSpinner, Gate } from "@/components/gate"
import { Wizard } from "./wizard"

export const metadata = { title: "Set up your box" }

export default function OnboardingPage() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Gate requireOnboarded={false}>
        <Wizard />
      </Gate>
    </Suspense>
  )
}
