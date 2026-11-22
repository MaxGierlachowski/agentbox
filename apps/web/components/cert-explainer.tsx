"use client"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { ChevronDownIcon, ShieldAlertIcon } from "lucide-react"

/** Why the browser warned about the certificate, and how to check it is really this box. */
export function CertExplainer() {
  return (
    <Collapsible className="rounded-xl border bg-card/60 text-sm">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ShieldAlertIcon className="size-4 text-muted-foreground" aria-hidden />
        Did your browser warn about the certificate?
        <ChevronDownIcon
          className="ml-auto size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 px-4 pb-4 text-muted-foreground">
        <p>
          On your local network agentbox uses a self-signed certificate, so the browser cannot check
          it against a public authority. The connection is still encrypted.
        </p>
        <p>
          To make sure you reached your box and not something else, open the certificate details
          (the icon left of the address) and compare its <strong>SHA-256 fingerprint</strong> with
          the one <code className="font-mono text-xs">sudo agentbox up</code> printed in the
          console. If they differ, stop here.
        </p>
        <p>
          Prefer no warning at all? Use the SSH tunnel the console shows and open{" "}
          <code className="font-mono text-xs">http://localhost:8080/setup/</code>.
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}
