import assert from "node:assert/strict";
import test from "node:test";

import {
  countUnreadNotifications,
  formatUnreadCount,
  getNotificationQueryScope,
  markNotificationReadInState,
  shouldRefreshInboxForNotificationPoll,
  shouldPollNotifications
} from "../lib/notification-polling";

test("consulta solo notificaciones del usuario autenticado", () => {
  assert.deepEqual(
    getNotificationQueryScope({ tenantId: "tenant-1", userId: "user-1" }),
    { tenantId: "tenant-1", userId: "user-1" }
  );
});

test("polling se pausa cuando la pestana esta oculta", () => {
  assert.equal(shouldPollNotifications("visible"), true);
  assert.equal(shouldPollNotifications("hidden"), false);
});

test("no ejecuta refresh completo del Inbox", () => {
  assert.equal(shouldRefreshInboxForNotificationPoll(), false);
});

test("una alerta nueva incrementa el contador", () => {
  assert.equal(
    countUnreadNotifications({
      unreadCount: 0,
      notifications: [
        { id: "first", isRead: false },
        { id: "second", isRead: true }
      ]
    }),
    1
  );
  assert.equal(formatUnreadCount(101), "99+");
});

test("marcar como leida reduce el contador", () => {
  const nextState = markNotificationReadInState(
    {
      unreadCount: 2,
      notifications: [
        { id: "first", isRead: false, title: "Primera" },
        { id: "second", isRead: false, title: "Segunda" }
      ]
    },
    "first"
  );

  assert.equal(nextState.unreadCount, 1);
  assert.equal(nextState.notifications[0]?.isRead, true);
  assert.equal(nextState.notifications[0]?.title, "Primera");
});

test("marcar una notificacion inexistente no modifica el estado local", () => {
  const state = {
    unreadCount: 1,
    notifications: [{ id: "first", isRead: false }]
  };

  assert.equal(markNotificationReadInState(state, "missing"), state);
});
