import { ComingSoon } from "@/components/coming-soon"

export const metadata = { title: "Environment" }

export default function Page() {
  return (
    <ComingSoon
      title="Environment"
      phase="0.1"
      description="Host facts, warnings, Tailscale and firewall status."
    />
  )
}
