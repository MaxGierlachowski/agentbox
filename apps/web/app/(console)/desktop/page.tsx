import { PageHeader } from "@workspace/ui/composites/page-header"
import { BrowserFrame } from "@/components/browser-frame"

export const metadata = { title: "Browser" }

// `/browser/` itself belongs to the KasmVNC client; this page embeds it.
export default function DesktopPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Browser"
        description="The box's Chrome. Logins here are shared with your agents."
      />
      <BrowserFrame className="min-h-[28rem] flex-1" />
    </div>
  )
}
