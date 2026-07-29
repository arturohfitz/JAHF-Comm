"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

import {
  formatUnreadCount,
  markNotificationReadInState,
  shouldPollNotifications
} from "@/lib/notification-polling";

type NotificationItem = {
  id: string;
  title: string;
  description: string | null;
  isRead: boolean;
  createdAt: string;
  href: string | null;
};

type NotificationResponse = {
  unreadCount: number;
  notifications: NotificationItem[];
};

async function loadNotifications() {
  const response = await fetch("/api/notifications", {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("No fue posible cargar notificaciones.");
  }

  return (await response.json()) as NotificationResponse;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationResponse>({
    unreadCount: 0,
    notifications: []
  });
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  function refresh() {
    void loadNotifications()
      .then((nextData) => {
        setData(nextData);
        setFailed(false);
      })
      .catch(() => {
        setFailed(true);
      });
  }

  useEffect(() => {
    refresh();

    const interval = window.setInterval(() => {
      if (shouldPollNotifications(document.visibilityState)) {
        refresh();
      }
    }, 30_000);

    return () => window.clearInterval(interval);
  }, []);

  function markAsRead(notificationId: string) {
    startTransition(() => {
      void fetch(`/api/notifications/${notificationId}/read`, {
        method: "POST"
      }).then(() => {
        setData((current) => markNotificationReadInState(current, notificationId));
        refresh();
      });
    });
  }

  return (
    <div className="relative">
      <button
        aria-label="Notificaciones"
        className="relative flex h-10 w-10 items-center justify-center rounded-md border bg-background transition-colors hover:bg-muted"
        onClick={() => setOpen((current) => !current)}
        title="Notificaciones"
        type="button"
      >
        <Bell aria-hidden="true" className="h-4 w-4" />
        {data.unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
            {formatUnreadCount(data.unreadCount)}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-md border bg-card p-3 text-card-foreground shadow-lg">
          <div className="flex items-center justify-between gap-3 border-b pb-2">
            <h2 className="text-sm font-semibold">Notificaciones</h2>
            <span className="text-xs text-muted-foreground">
              {data.unreadCount} sin leer
            </span>
          </div>

          {failed ? (
            <p className="py-4 text-sm text-muted-foreground">
              No fue posible cargar las notificaciones.
            </p>
          ) : data.notifications.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No hay notificaciones recientes.
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {data.notifications.map((notification) => (
                <article
                  className="border-b py-3 last:border-b-0"
                  key={notification.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{notification.title}</p>
                      {notification.description ? (
                        <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">
                          {notification.description}
                        </p>
                      ) : null}
                    </div>
                    {!notification.isRead ? (
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    {notification.href ? (
                      <Link
                        className="text-xs font-medium text-primary hover:underline"
                        href={notification.href}
                        onClick={() => setOpen(false)}
                      >
                        Abrir conversacion
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Sin enlace
                      </span>
                    )}
                    {!notification.isRead ? (
                      <button
                        className="text-xs font-medium text-muted-foreground hover:text-foreground"
                        disabled={isPending}
                        onClick={() => markAsRead(notification.id)}
                        type="button"
                      >
                        Marcar leida
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
