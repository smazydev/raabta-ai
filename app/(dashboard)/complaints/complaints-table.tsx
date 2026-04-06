"use client";

import * as React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  addComplaintNoteAction,
  assignComplaintAction,
  updateComplaintStatusAction,
} from "./actions";

type Row = {
  id: string;
  reference: string;
  category: string;
  priority: string;
  status: string;
  summary: string | null;
  sla_due_at: string | null;
  assigned_team: string | null;
  conversation_id: string | null;
  call_id: string | null;
  created_at: string;
  customer: { full_name: string; account_number: string | null } | null;
};

export function ComplaintsTable({ rows }: { rows: Row[] }) {
  const [open, setOpen] = React.useState<Row | null>(null);
  const [note, setNote] = React.useState("");
  const [team, setTeam] = React.useState("");

  return (
    <>
      <div className="rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.reference}</TableCell>
                <TableCell className="text-sm">{r.customer?.full_name}</TableCell>
                <TableCell className="text-xs">{r.category}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {r.priority}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="text-[10px] uppercase">
                    {r.status.replace("_", " ")}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setOpen(r)}>
                    Open
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Sheet open={!!open} onOpenChange={() => setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto border-border bg-card sm:max-w-lg">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono">{open.reference}</SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Summary</p>
                  <p>{open.summary}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={async () => {
                      try {
                        await updateComplaintStatusAction(open.id, "escalated");
                        toast.success("Escalated");
                        setOpen(null);
                        window.location.reload();
                      } catch {
                        toast.error("Failed");
                      }
                    }}
                  >
                    Escalate
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      try {
                        await updateComplaintStatusAction(open.id, "resolved");
                        toast.success("Resolved");
                        setOpen(null);
                        window.location.reload();
                      } catch {
                        toast.error("Failed");
                      }
                    }}
                  >
                    Resolve
                  </Button>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Assign team</p>
                  <div className="mt-1 flex gap-2">
                    <Input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="e.g. Cards" />
                    <Button
                      size="sm"
                      onClick={async () => {
                        try {
                          await assignComplaintAction(open.id, team || "Operations");
                          toast.success("Assigned");
                          window.location.reload();
                        } catch {
                          toast.error("Failed");
                        }
                      }}
                    >
                      Save
                    </Button>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Linkages</p>
                  <p className="font-mono text-xs">
                    Conversation: {open.conversation_id ?? "—"}
                  </p>
                  <p className="font-mono text-xs">Call: {open.call_id ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Add note</p>
                  <textarea
                    className="mt-1 min-h-[80px] w-full rounded-lg border border-input bg-transparent p-2 text-sm"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <Button
                    className="mt-2"
                    size="sm"
                    onClick={async () => {
                      if (!note.trim()) return;
                      try {
                        await addComplaintNoteAction(open.id, note);
                        setNote("");
                        toast.success("Note added");
                        window.location.reload();
                      } catch {
                        toast.error("Failed");
                      }
                    }}
                  >
                    Add note
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
