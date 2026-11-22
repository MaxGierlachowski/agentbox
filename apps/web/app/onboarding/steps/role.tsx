"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import type { RoleId } from "@workspace/contract"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Field, FieldDescription, FieldLabel } from "@workspace/ui/components/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"
import {
  ChartColumnIcon,
  CheckIcon,
  ClipboardListIcon,
  CodeXmlIcon,
  LifeBuoyIcon,
  type LucideIcon,
  PaletteIcon,
  RocketIcon,
  ServerCogIcon,
  SparklesIcon,
} from "lucide-react"
import { useState } from "react"
import { orpc } from "@/lib/orpc"
import { useWizard } from "../context"
import { StepLayout } from "../step-layout"

const ROLES: { id: RoleId; title: string; text: string; icon: LucideIcon }[] = [
  { id: "developer", title: "Developer", text: "Code, reviews, CI, repos", icon: CodeXmlIcon },
  {
    id: "manager",
    title: "Manager / PM",
    text: "Tickets, meetings, status",
    icon: ClipboardListIcon,
  },
  {
    id: "founder-ops",
    title: "Founder / Ops",
    text: "Inbox, calendar, the business",
    icon: RocketIcon,
  },
  { id: "data", title: "Data", text: "SQL, notebooks, metrics", icon: ChartColumnIcon },
  { id: "devops", title: "DevOps / SRE", text: "Alerts, deploys, infra", icon: ServerCogIcon },
  { id: "support", title: "Support", text: "Tickets, replies, macros", icon: LifeBuoyIcon },
  {
    id: "designer-marketer",
    title: "Designer / Marketer",
    text: "Copy, design, launches",
    icon: PaletteIcon,
  },
  { id: "custom", title: "Something else", text: "Start from the basics", icon: SparklesIcon },
]

const LANGUAGES = [
  "English",
  "German",
  "French",
  "Spanish",
  "Italian",
  "Dutch",
  "Polish",
  "Portuguese",
  "Japanese",
  "Chinese",
]

function timezones(current: string): string[] {
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []
  return all.includes(current) ? all : [current, ...all]
}

export function RoleStep() {
  const w = useWizard()
  const ai = useQuery(orpc.ai.status.queryOptions())
  const [roles, setRoles] = useState<RoleId[]>(w.state.roles)
  const [about, setAbout] = useState(w.state.about)
  const [timezone, setTimezone] = useState(
    () => w.state.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  )
  const [language, setLanguage] = useState(w.state.language || "English")
  const [refineChoice, setRefine] = useState<boolean | null>(null)
  const refine = refineChoice ?? ai.data?.hermes.ready === true
  const suggest = useMutation(orpc.catalog.suggest.mutationOptions())

  const toggle = (id: RoleId) =>
    setRoles((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]))

  async function onContinue() {
    const changed =
      roles.join() !== w.state.roles.join() ||
      about !== w.state.about ||
      w.state.selection.skills.length + w.state.selection.mcps.length === 0
    if (!changed) {
      await w.advance({ timezone, language })
      return
    }
    const s = await suggest.mutateAsync({ roles, about: about || undefined, refine })
    await w.advance({
      roles,
      about,
      timezone,
      language,
      selection: s.selection,
      firstTask: s.firstTask,
      firstTaskAlternatives: s.firstTaskAlternatives,
      suggestedSites: s.suggestedSites,
    })
  }

  return (
    <StepLayout
      title="Who are you?"
      description="Pick what describes your work. Your toolkit, SOUL and first task are suggested from it."
      onContinue={onContinue}
      continueDisabled={roles.length === 0}
      pending={suggest.isPending}
      hint={
        suggest.isPending
          ? refine
            ? "Your AI is tailoring the suggestions…"
            : "Putting your toolkit together…"
          : roles.length === 0
            ? "Pick at least one role."
            : `${roles.length} selected`
      }
    >
      <fieldset>
        <legend className="sr-only">Roles</legend>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
          {ROLES.map((r) => {
            const on = roles.includes(r.id)
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(r.id)}
                className={cn(
                  "group relative flex flex-col items-start gap-2 rounded-xl border bg-card p-3.5 text-left outline-none transition-all hover:border-foreground/20 focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-4",
                  on && "border-primary/60 bg-primary/[0.03] ring-1 ring-primary/40",
                )}
              >
                <span
                  className={cn(
                    "flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors",
                    on && "bg-primary text-primary-foreground",
                  )}
                >
                  <r.icon className="size-4.5" aria-hidden />
                </span>
                <span>
                  <span className="block font-medium text-sm">{r.title}</span>
                  <span className="block text-muted-foreground text-xs">{r.text}</span>
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-3 right-3 flex size-5 items-center justify-center rounded-full border bg-background text-primary-foreground transition-all",
                    on ? "border-primary bg-primary" : "opacity-0 group-hover:opacity-100",
                  )}
                >
                  <CheckIcon className="size-3" />
                </span>
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="grid gap-5 rounded-xl border bg-card p-4 sm:p-5 lg:grid-cols-2">
        <Field className="lg:col-span-2">
          <FieldLabel htmlFor="about">Describe your work in a sentence (optional)</FieldLabel>
          <Textarea
            id="about"
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            maxLength={2000}
            placeholder="e.g. Solo founder of a small SaaS; I review PRs, answer support mail and watch Sentry."
            className="min-h-20"
          />
          <FieldDescription>Hermes reads this. Mention the tools you use.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger id="timezone" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {timezones(timezone).map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz.replaceAll("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="language">Language</FieldLabel>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger id="language" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...new Set([language, ...LANGUAGES])].map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field orientation="horizontal" className="lg:col-span-2">
          <Checkbox
            id="refine"
            checked={refine}
            disabled={!ai.data?.hermes.ready}
            onCheckedChange={(v) => setRefine(v === true)}
          />
          <FieldLabel htmlFor="refine" className="font-normal">
            Let my AI refine the suggestions from my description
            {!ai.data?.hermes.ready ? (
              <span className="text-muted-foreground"> (needs a Hermes model)</span>
            ) : null}
          </FieldLabel>
        </Field>
      </div>
    </StepLayout>
  )
}
