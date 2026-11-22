"use client"

import { RepoPicker, SshKeyCard } from "@/components/ssh-and-repos"
import { StepLayout } from "../step-layout"

export function ReposStep() {
  return (
    <StepLayout
      title="SSH & repos"
      description="Give the box its own SSH key and clone the repositories your agents should work on. Clones run in the background; you don't have to wait."
    >
      <SshKeyCard />
      <RepoPicker />
    </StepLayout>
  )
}
