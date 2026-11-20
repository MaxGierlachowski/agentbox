"use client"

import type { RunSummary } from "@workspace/contract"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { StatusBadge } from "@workspace/ui/composites/status-badge"
import { formatDistanceToNow } from "date-fns"
import Link from "next/link"

export function RunsTable({ runs }: { runs: RunSummary[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Run</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Actor</TableHead>
          <TableHead className="text-right">Started</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id}>
            <TableCell className="font-mono text-xs">
              <Link href={`/runs/?id=${run.id}`} className="underline-offset-4 hover:underline">
                {run.id.slice(0, 8)}
              </Link>
            </TableCell>
            <TableCell>{run.kind}</TableCell>
            <TableCell>
              <StatusBadge status={run.status} />
            </TableCell>
            <TableCell className="text-muted-foreground">{run.actor}</TableCell>
            <TableCell className="text-right text-muted-foreground">
              {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
