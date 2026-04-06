"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function KnowledgeSearch({ initialQ }: { initialQ: string }) {
  const router = useRouter();
  const [q, setQ] = React.useState(initialQ);

  return (
    <form
      className="flex max-w-xl gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`/knowledge?q=${encodeURIComponent(q)}`);
      }}
    >
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search policies, Raast, cards…" />
      <Button type="submit">Search</Button>
    </form>
  );
}
