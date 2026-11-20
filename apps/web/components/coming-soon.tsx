import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { PageHeader } from "@workspace/ui/composites/page-header"
import { ConstructionIcon } from "lucide-react"

export function ComingSoon({
  title,
  phase,
  description,
}: {
  title: string
  phase: string
  description: string
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ConstructionIcon />
          </EmptyMedia>
          <EmptyTitle>Arrives in v{phase}</EmptyTitle>
          <EmptyDescription>See docs/implementation-plan.md, section 20.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </>
  )
}
