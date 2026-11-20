"use client"

import { useQuery } from "@tanstack/react-query"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { CircleAlertIcon } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import { type ReactNode, useEffect } from "react"
import { orpc } from "@/lib/orpc"

const isUnauthorized = (error: unknown) =>
  typeof error === "object" && error !== null && "status" in error && error.status === 401

/**
 * Client-side navigation gates. The server enforces auth and sealing on every call; this only
 * sends the user to the right page instead of showing errors.
 */
export function Gate({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const me = useQuery(orpc.auth.me.queryOptions())
  const seal = useQuery({ ...orpc.secrets.status.queryOptions(), enabled: me.isSuccess })

  const unauthorized = isUnauthorized(me.error)
  const sealed = seal.data?.sealed === true

  useEffect(() => {
    if (unauthorized) router.replace("/login/")
    else if (sealed && pathname !== "/unlock/") router.replace("/unlock/")
  }, [unauthorized, sealed, pathname, router])

  const error =
    (me.isError && !unauthorized ? me.error : null) ?? (seal.isError ? seal.error : null)
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
                void me.refetch()
                void seal.refetch()
              }}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (me.isPending || unauthorized || (me.isSuccess && seal.isPending) || sealed) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    )
  }
  return children
}
