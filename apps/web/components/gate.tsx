"use client"

import { useQuery } from "@tanstack/react-query"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { CircleAlertIcon } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import { type ReactNode, useEffect } from "react"
import { setupStatusQuery } from "@/lib/api"
import { isUnauthorized } from "@/lib/errors"
import { samePath } from "@/lib/nav"
import { orpc } from "@/lib/orpc"

/** Console pages reachable before onboarding is finished (Hermes UI links to pairing). */
const OPEN_DURING_ONBOARDING = ["/devices/"]

export function FullPageSpinner() {
  return (
    <div className="flex min-h-svh items-center justify-center" role="status">
      <Spinner className="size-6 text-muted-foreground" />
      <span className="sr-only">Loading</span>
    </div>
  )
}

/**
 * Client-side navigation gate: unclaimed → /setup/, no session → /login/?next=…, onboarding
 * unfinished → /onboarding/. The server enforces auth on every call; this only routes.
 */
export function Gate({
  children,
  requireOnboarded = true,
}: {
  children: ReactNode
  /** Console pages send unfinished boxes to the wizard; the wizard itself does not. */
  requireOnboarded?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const setup = useQuery(setupStatusQuery)
  const claimed = setup.data?.claimed === true
  const me = useQuery({ ...orpc.auth.me.queryOptions(), enabled: claimed })
  const onboarding = useQuery({ ...orpc.onboarding.get.queryOptions(), enabled: me.isSuccess })

  const unclaimed = setup.data?.claimed === false
  const unauthorized = isUnauthorized(me.error) || isUnauthorized(onboarding.error)
  const needsOnboarding =
    requireOnboarded &&
    onboarding.data?.finishedAt === null &&
    !OPEN_DURING_ONBOARDING.some((p) => samePath(p, pathname))

  useEffect(() => {
    if (unclaimed) router.replace("/setup/")
    else if (unauthorized) {
      const next = `${window.location.pathname}${window.location.search}`
      router.replace(`/login/?next=${encodeURIComponent(next)}`)
    } else if (needsOnboarding) router.replace("/onboarding/")
  }, [unclaimed, unauthorized, needsOnboarding, router])

  const error =
    (setup.isError ? setup.error : null) ??
    (me.isError && !unauthorized ? me.error : null) ??
    (onboarding.isError && !unauthorized ? onboarding.error : null)
  if (error) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <Alert variant="destructive" className="max-w-md">
          <CircleAlertIcon />
          <AlertTitle>agentbox is not responding as expected</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{error.message}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void setup.refetch()
                void me.refetch()
                void onboarding.refetch()
              }}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!onboarding.isSuccess || unclaimed || unauthorized || needsOnboarding) {
    return <FullPageSpinner />
  }
  return children
}
