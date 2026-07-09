import { prisma } from "@jahf-comm/db";

export type DemoSession = {
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  user: {
    id: string;
    email: string;
    name: string | null;
  };
};

// Temporal: solo para desarrollo local hasta implementar autenticacion real.
export async function getDemoSession(): Promise<DemoSession> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: "jahf-demo" },
    select: {
      id: true,
      name: true,
      slug: true
    }
  });

  if (!tenant) {
    throw new Error("Demo tenant not found. Run pnpm db:seed first.");
  }

  const membership = await prisma.membership.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "asc" },
    select: {
      user: {
        select: {
          id: true,
          email: true,
          name: true
        }
      }
    }
  });

  if (!membership) {
    throw new Error("Demo admin user not found. Run pnpm db:seed first.");
  }

  return {
    tenant,
    user: membership.user
  };
}
