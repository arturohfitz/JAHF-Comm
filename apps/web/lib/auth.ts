import { createHmac, randomBytes } from "node:crypto";

import {
  AuditAction,
  MembershipRole,
  PlatformRole,
  prisma
} from "@jahf-comm/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const sessionCookieName = "jahf_comm_session";
const sessionDurationMs = 7 * 24 * 60 * 60 * 1000;
const developmentSessionSecret = "development-session-secret";

export type CurrentSession = {
  id: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    platformRole: PlatformRole;
    mustChangePassword: boolean;
  };
  platformRole: PlatformRole;
  isPlatformAdmin: boolean;
  isPlatformTenantAccess: boolean;
  tenant: {
    id: string;
    name: string;
    slug: string;
    onboardingCompletedAt: Date | null;
  } | null;
  activeTenant: CurrentSession["tenant"];
  membership: {
    id: string;
    role: MembershipRole;
  } | null;
  effectiveRole: MembershipRole | null;
};

export type TenantSession = CurrentSession & {
  tenant: NonNullable<CurrentSession["tenant"]>;
  activeTenant: NonNullable<CurrentSession["activeTenant"]>;
  effectiveRole: MembershipRole;
};

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV !== "production") {
    return developmentSessionSecret;
  }

  throw new Error("SESSION_SECRET is required in production.");
}

function hashSessionToken(token: string) {
  return createHmac("sha256", getSessionSecret())
    .update(token)
    .digest("base64url");
}

function getCookieOptions(expires: Date) {
  return {
    expires,
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production"
  };
}

export async function createSession(userId: string, activeTenantId?: string | null) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDurationMs);

  await prisma.authSession.create({
    data: {
      userId,
      activeTenantId: activeTenantId ?? null,
      tokenHash: hashSessionToken(token),
      expiresAt
    }
  });

  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, token, getCookieOptions(expiresAt));
}

export async function destroyCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;

  if (token) {
    await prisma.authSession.deleteMany({
      where: {
        tokenHash: hashSessionToken(token)
      }
    });
  }

  cookieStore.delete(sessionCookieName);
}

async function getCurrentTokenHash() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;

  return token ? hashSessionToken(token) : null;
}

export async function getCurrentSession(): Promise<CurrentSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;

  if (!token) {
    return null;
  }

  const session = await prisma.authSession.findUnique({
    where: {
      tokenHash: hashSessionToken(token)
    },
    select: {
      id: true,
      activeTenantId: true,
      expiresAt: true,
      activeTenant: {
        select: {
          id: true,
          name: true,
          slug: true,
          onboardingCompletedAt: true
        }
      },
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          platformRole: true,
          mustChangePassword: true,
          memberships: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              role: true,
              tenant: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  onboardingCompletedAt: true
                }
              }
            }
          }
        }
      }
    }
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt <= new Date()) {
    await prisma.authSession.delete({ where: { id: session.id } }).catch(() => null);
    return null;
  }

  const isPlatformAdmin = session.user.platformRole === PlatformRole.SUPER_ADMIN;

  if (isPlatformAdmin) {
    return {
      id: session.id,
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        platformRole: session.user.platformRole,
        mustChangePassword: session.user.mustChangePassword
      },
      platformRole: session.user.platformRole,
      isPlatformAdmin: true,
      isPlatformTenantAccess: Boolean(session.activeTenant),
      tenant: session.activeTenant,
      activeTenant: session.activeTenant,
      membership: null,
      effectiveRole: session.activeTenant ? MembershipRole.OWNER : null
    };
  }

  let membership = session.user.memberships.find(
    (item) => item.tenant.id === session.activeTenantId
  );

  if (!membership && !session.activeTenantId && session.user.memberships.length === 1) {
    membership = session.user.memberships[0];
    await prisma.authSession.update({
      where: { id: session.id },
      data: { activeTenantId: membership.tenant.id }
    });
  }

  if (!membership && session.activeTenantId) {
    await prisma.authSession.update({
      where: { id: session.id },
      data: { activeTenantId: null }
    });
  }

  if (!membership) {
    if (session.user.memberships.length === 0) {
      return null;
    }

    return {
      id: session.id,
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        platformRole: session.user.platformRole,
        mustChangePassword: session.user.mustChangePassword
      },
      platformRole: session.user.platformRole,
      isPlatformAdmin: false,
      isPlatformTenantAccess: false,
      tenant: null,
      activeTenant: null,
      membership: null,
      effectiveRole: null
    };
  }

  if (membership.tenant.onboardingCompletedAt === null) {
    return {
      id: session.id,
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        platformRole: session.user.platformRole,
        mustChangePassword: session.user.mustChangePassword
      },
      platformRole: session.user.platformRole,
      isPlatformAdmin: false,
      isPlatformTenantAccess: false,
      tenant: membership.tenant,
      activeTenant: membership.tenant,
      membership: {
        id: membership.id,
        role: membership.role
      },
      effectiveRole: membership.role
    };
  }

  return {
    id: session.id,
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      platformRole: session.user.platformRole,
      mustChangePassword: session.user.mustChangePassword
    },
    platformRole: session.user.platformRole,
    isPlatformAdmin: false,
    isPlatformTenantAccess: false,
    tenant: membership.tenant,
    activeTenant: membership.tenant,
    membership: {
      id: membership.id,
      role: membership.role
    },
    effectiveRole: membership.role
  };
}

export async function getCurrentMemberships() {
  const session = await getCurrentSession();

  if (!session) {
    return [];
  }

  return prisma.membership.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      tenant: {
        select: {
          id: true,
          name: true,
          slug: true,
          onboardingCompletedAt: true
        }
      }
    }
  });
}

export async function setActiveTenantForSession(tenantId: string) {
  const tokenHash = await getCurrentTokenHash();

  if (!tokenHash) {
    redirect("/login");
  }

  const session = await prisma.authSession.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      user: {
        select: {
          id: true,
          platformRole: true,
          memberships: {
            where: { tenantId },
            select: { id: true }
          }
        }
      }
    }
  });

  if (!session) {
    redirect("/login");
  }

  const isPlatformAdmin = session.user.platformRole === PlatformRole.SUPER_ADMIN;
  const hasMembership = session.user.memberships.length > 0;

  if (!isPlatformAdmin && !hasMembership) {
    throw new Error("No tienes acceso a este tenant.");
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true }
  });

  if (!tenant) {
    throw new Error("Tenant no encontrado.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.authSession.update({
      where: { id: session.id },
      data: { activeTenantId: tenantId }
    });

    if (isPlatformAdmin) {
      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId: session.user.id,
          action: AuditAction.UPDATE,
          entityType: "PlatformTenantAccess",
          entityId: tenantId,
          after: {
            source: "platform-admin",
            action: "ENTER_TENANT"
          }
        }
      });
    }
  });
}

export async function clearActiveTenantForSession() {
  const tokenHash = await getCurrentTokenHash();

  if (!tokenHash) {
    redirect("/login");
  }

  const session = await prisma.authSession.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      activeTenantId: true,
      user: {
        select: {
          id: true,
          platformRole: true
        }
      }
    }
  });

  if (!session) {
    redirect("/login");
  }

  await prisma.$transaction(async (tx) => {
    await tx.authSession.update({
      where: { id: session.id },
      data: { activeTenantId: null }
    });

    if (
      session.user.platformRole === PlatformRole.SUPER_ADMIN &&
      session.activeTenantId
    ) {
      await tx.auditLog.create({
        data: {
          tenantId: session.activeTenantId,
          actorUserId: session.user.id,
          action: AuditAction.UPDATE,
          entityType: "PlatformTenantAccess",
          entityId: session.activeTenantId,
          after: {
            source: "platform-admin",
            action: "EXIT_TENANT"
          }
        }
      });
    }
  });
}

export async function requirePlatformAdmin(): Promise<CurrentSession> {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  if (session.user.mustChangePassword) {
    redirect("/change-password");
  }

  if (!session.isPlatformAdmin) {
    throw new Error("No tienes permiso de administrador maestro.");
  }

  return session;
}

function assertTenantSession(session: CurrentSession): asserts session is TenantSession {
  if (!session.tenant || !session.activeTenant || !session.effectiveRole) {
    if (session.isPlatformAdmin) {
      redirect("/platform");
    }

    redirect("/select-tenant");
  }
}

function assertOnboardingReady(session: TenantSession) {
  if (
    !session.isPlatformAdmin &&
    session.tenant.onboardingCompletedAt === null
  ) {
    redirect("/onboarding");
  }
}

export async function getCurrentUser() {
  return (await getCurrentSession())?.user ?? null;
}

export async function getCurrentTenant() {
  return (await getCurrentSession())?.tenant ?? null;
}

export async function requireAuth(): Promise<TenantSession> {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  if (session.user.mustChangePassword) {
    redirect("/change-password");
  }

  assertTenantSession(session);
  assertOnboardingReady(session);

  return session;
}

export async function requireRole(
  allowedRoles: readonly MembershipRole[]
): Promise<TenantSession> {
  const session = await requireAuth();

  if (!allowedRoles.includes(session.effectiveRole)) {
    throw new Error("No tienes permiso para realizar esta accion.");
  }

  return session;
}

export async function requireTenantAccess(tenantId: string) {
  const session = await requireAuth();

  if (session.tenant.id !== tenantId) {
    throw new Error("No tienes acceso a este tenant.");
  }

  return session;
}

export function canManageSettings(role: MembershipRole | null) {
  return role === MembershipRole.OWNER || role === MembershipRole.ADMIN;
}

export function canOperateInbox(role: MembershipRole | null) {
  return (
    role === MembershipRole.OWNER ||
    role === MembershipRole.ADMIN ||
    role === MembershipRole.AGENT
  );
}
