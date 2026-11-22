"use client"

import { BrowserFrame } from "@/components/browser-frame"
import { SiteChecklist } from "@/components/site-checklist"
import { useWizard } from "../context"
import { StepLayout } from "../step-layout"

export function BrowserStep() {
  const w = useWizard()
  return (
    <StepLayout
      title="Browser logins"
      description="This is the box's own Chrome. Sign in once here and your agents can use those sites too. Logins stay on the box."
      continueLabel="Done"
    >
      <div className="grid gap-4 xl:grid-cols-[1fr_16rem]">
        <BrowserFrame className="h-[55svh] min-h-80 xl:h-[62svh]" />
        <aside className="space-y-3 rounded-xl border bg-card p-4" aria-labelledby="sites-title">
          <h2 id="sites-title" className="font-medium text-sm">
            Suggested sign-ins
          </h2>
          <SiteChecklist sites={w.state.suggestedSites} />
        </aside>
      </div>
    </StepLayout>
  )
}
