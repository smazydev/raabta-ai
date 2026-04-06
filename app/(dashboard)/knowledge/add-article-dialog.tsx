"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createKnowledgeArticleAction } from "./actions";

export function AddArticleDialog({
  knowledgeBases = [],
}: {
  knowledgeBases?: { id: string; name: string }[];
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setPending(true);
    try {
      await createKnowledgeArticleAction(fd);
      toast.success("Article added");
      form.reset();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add article");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} className="shrink-0">
        <Plus className="mr-2 h-4 w-4" />
        Add article
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[min(90vh,36rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add article</DialogTitle>
            <DialogDescription>
              Tenant-scoped document for knowledge orchestration — wire to agents and embeddings after save.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-4 pt-1">
            <div className="space-y-2">
              <label htmlFor="kb-modal-title" className="text-sm font-medium">
                Title
              </label>
              <Input
                id="kb-modal-title"
                name="title"
                required
                placeholder="e.g. ATM daily withdrawal limit"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="kb-modal-body" className="text-sm font-medium">
                Body
              </label>
              <textarea
                id="kb-modal-body"
                name="body"
                required
                rows={6}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Full article text (English is fine—the bot translates for chat languages)."
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="kb-modal-tags" className="text-sm font-medium">
                Tags (comma-separated)
              </label>
              <Input id="kb-modal-tags" name="tags" placeholder="cards, atm, limits" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="kb-modal-source" className="text-sm font-medium">
                  Source label
                </label>
                <Input id="kb-modal-source" name="source" placeholder="internal_policy" />
              </div>
              <div className="space-y-2">
                <label htmlFor="kb-modal-dept" className="text-sm font-medium">
                  Department / team
                </label>
                <Input id="kb-modal-dept" name="department_team" placeholder="HR, IT, Compliance…" />
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="kb-modal-scope" className="text-sm font-medium">
                Access scope
              </label>
              <select
                id="kb-modal-scope"
                name="access_scope"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                defaultValue="tenant_wide"
              >
                <option value="tenant_wide">Tenant-wide</option>
                <option value="hr_only">HR-only</option>
                <option value="it_only">IT-only</option>
                <option value="branch_staff">Branch staff</option>
              </select>
            </div>
            {knowledgeBases.length > 0 ? (
              <div className="space-y-2">
                <label htmlFor="kb-modal-base" className="text-sm font-medium">
                  Knowledge base (optional)
                </label>
                <select
                  id="kb-modal-base"
                  name="knowledge_base_id"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  defaultValue=""
                >
                  <option value="">— Unassigned —</option>
                  {knowledgeBases.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save article"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
