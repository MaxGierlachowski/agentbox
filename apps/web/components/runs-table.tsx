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
          <TableHead>Status</TableHead>
          <TableHead>Actor</TableHead>
          <TableHead className="text-right">Started</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id}>
            <TableCell>
              <Link
                href={`/runs/?id=${run.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {run.title}
              </Link>
              <span className="ml-2 font-mono text-muted-foreground text-xs">{run.kind}</span>
            </TableCell>
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
