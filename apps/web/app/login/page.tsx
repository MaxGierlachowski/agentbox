import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

export const metadata = { title: "Sign in" }

export default function LoginPage() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Sign in to agentbox</CardTitle>
          <CardDescription>
            agentbox has no passwords. Use one of these two ways in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="font-medium">Through your tailnet (recommended)</p>
            <p className="text-muted-foreground">
              Open <code className="font-mono">https://&lt;node&gt;.&lt;tailnet&gt;.ts.net</code>.
              Your Tailscale login signs you in if it is on the allow list.
            </p>
          </div>
          <div>
            <p className="font-medium">Through an SSH tunnel</p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
              {"ssh -L 7777:127.0.0.1:7777 <vm>\nagentbox login-link"}
            </pre>
            <p className="text-muted-foreground">
              Open the printed link within 5 minutes. It works once.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
