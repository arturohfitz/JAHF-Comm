import { Activity, Database, MessageSquare, ShieldCheck } from "lucide-react";
import { APP_NAME } from "@jahf-comm/shared";

import { Button } from "@/components/ui/button";

const foundationItems = [
  {
    label: "Tenant Isolation",
    detail: "Database schema is organized around tenant-scoped records.",
    icon: ShieldCheck
  },
  {
    label: "Conversation Core",
    detail: "Contacts, conversations, messages, and support tickets are modeled.",
    icon: MessageSquare
  },
  {
    label: "Operational Data",
    detail: "Payments, AI suggestions, and audit logs have durable boundaries.",
    icon: Database
  },
  {
    label: "Worker Ready",
    detail: "Redis and BullMQ dependencies are in place for background jobs.",
    icon: Activity
  }
];

export default function Home() {
  return (
    <main className="min-h-screen bg-background">
      <section className="border-b bg-secondary text-secondary-foreground">
        <div className="mx-auto flex min-h-[52vh] max-w-6xl flex-col justify-end px-6 py-10 sm:px-8">
          <p className="text-sm font-medium uppercase tracking-wide text-accent">
            Technical foundation
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold sm:text-6xl">
            {APP_NAME}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-secondary-foreground/78 sm:text-lg">
            A clean starting point for multi-tenant WhatsApp operations, CRM
            statuses, support tracking, payments tracking, reports, and AI
            suggestions.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button>Open dashboard</Button>
            <Button variant="outline">View reports</Button>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-6 py-8 sm:grid-cols-2 sm:px-8 lg:grid-cols-4">
        {foundationItems.map((item) => {
          const Icon = item.icon;

          return (
            <article
              className="rounded-md border bg-card p-5 text-card-foreground"
              key={item.label}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Icon aria-hidden="true" className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-base font-semibold">{item.label}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {item.detail}
              </p>
            </article>
          );
        })}
      </section>
    </main>
  );
}
