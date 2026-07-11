export type NotificationItemState = {
  id: string;
  isRead: boolean;
};

export type NotificationPollingState<TNotification extends NotificationItemState = NotificationItemState> = {
  unreadCount: number;
  notifications: TNotification[];
};

export function getNotificationQueryScope(input: {
  tenantId: string;
  userId: string;
}) {
  return {
    tenantId: input.tenantId,
    userId: input.userId
  };
}

export function shouldPollNotifications(visibilityState: DocumentVisibilityState) {
  return visibilityState === "visible";
}

export function shouldRefreshInboxForNotificationPoll() {
  return false;
}

export function formatUnreadCount(count: number) {
  return count > 99 ? "99+" : String(Math.max(0, count));
}

export function countUnreadNotifications(state: NotificationPollingState) {
  return state.notifications.filter((notification) => !notification.isRead).length;
}

export function markNotificationReadInState<
  TNotification extends NotificationItemState,
  TState extends NotificationPollingState<TNotification>
>(state: TState, notificationId: string): TState {
  const notification = state.notifications.find((item) => item.id === notificationId);

  if (!notification || notification.isRead) {
    return state;
  }

  return {
    ...state,
    unreadCount: Math.max(0, state.unreadCount - 1),
    notifications: state.notifications.map((item) =>
      item.id === notificationId ? { ...item, isRead: true } : item
    )
  } as TState;
}
