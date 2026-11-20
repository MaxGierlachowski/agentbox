import { ComingSoon } from "@/components/coming-soon"

export const metadata = { title: "Settings" }

export default function Page() {
  return (
    <ComingSoon
      title="Settings"
      phase="0.1"
      description="Sessions, allowed Tailscale logins, theme."
    />
  )
}
