import { Suspense } from "react"
import { FullPageSpinner } from "@/components/gate"
import { LoginForm } from "./login-form"

export const metadata = { title: "Sign in" }

export default function LoginPage() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <LoginForm />
    </Suspense>
  )
}
