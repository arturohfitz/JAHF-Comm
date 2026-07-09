import { createHash, randomBytes } from "node:crypto";

import { MembershipRole, prisma } from "@jahf-comm/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const sessionCookieName = "jahf_comm_session";
const sessionDurationMs = 7 * 24 * 60 * 60 * 1000;

export type CurrentSession = {
  user: {
    id: string;
    email: string;
    name: string | null;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  membership: {
    id: string;
    role: MembershipRole;
  };
};

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
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

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDurationMs);

  await prisma.authSession.create({
    data: {
      userId,
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
      expiresAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          memberships: {
            orderBy: { createdAt: "asc" },
            take: 1,
            select: {
              id: true,
              role: true,
              tenant: {
                select: {
                  id: true,
                  name: true,
                  slug: true
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

  const membership = session.user.memberships[0];

  if (!membership) {
    return null;
  }

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name
    },
    tenant: membership.tenant,
    membership: {
      id: membership.id,
      role: membership.role
    }
  };
}

export async function getCurrentUser() {
  return (await getCurrentSession())?.user ?? null;
}

export async function getCurrentTenant() {
  return (await getCurrentSession())?.tenant ?? null;
}

export async function requireAuth(): Promise<CurrentSession> {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}

export async function requireRole(
  allowedRoles: readonly MembershipRole[]
): Promise<CurrentSession> {
  const session = await requireAuth();

  if (!allowedRoles.includes(session.membership.role)) {
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

export function canManageSettings(role: MembershipRole) {
  return role === MembershipRole.OWNER || role === MembershipRole.ADMIN;
}

export function canOperateInbox(role: MembershipRole) {
  return (
    role === MembershipRole.OWNER ||
    role === MembershipRole.ADMIN ||
    role === MembershipRole.AGENT
  );
}
