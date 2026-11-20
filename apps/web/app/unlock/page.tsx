import { UnlockForm } from "./unlock-form"

export const metadata = { title: "Unlock" }

export default function UnlockPage() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <UnlockForm />
    </div>
  )
}
