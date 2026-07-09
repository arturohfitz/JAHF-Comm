"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare } from "lucide-react";

import { mainNavigation } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex min-h-screen w-full flex-col border-r bg-secondary text-secondary-foreground md:w-72">
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <MessageSquare aria-hidden="true" className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-none">JAHF Comm</p>
          <p className="mt-1 text-xs text-secondary-foreground/65">
            CRM conversacional
          </p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        {mainNavigation.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              className={cn(
                "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-secondary-foreground/74 transition-colors hover:bg-white/10 hover:text-secondary-foreground",
                active && "bg-primary text-primary-foreground hover:bg-primary"
              )}
              href={item.href}
              key={item.href}
            >
              <Icon aria-hidden="true" className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-4 text-xs leading-5 text-secondary-foreground/65">
        Sesion demo temporal. El login real se implementara despues.
      </div>
    </aside>
  );
}
