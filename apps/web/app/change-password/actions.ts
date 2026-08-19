"use server";

import { hashPassword, verifyPassword } from "@jahf-comm/shared/passwords";
import { prisma } from "@jahf-comm/db";
import { redirect } from "next/navigation";

import { getCurrentSession } from "@/lib/auth";

function readFormString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value : "";
}

export async function changePasswordAction(formData: FormData) {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const currentPassword = readFormString(formData, "currentPassword");
  const nextPassword = readFormString(formData, "nextPassword");
  const confirmPassword = readFormString(formData, "confirmPassword");

  if (!currentPassword || !nextPassword || !confirmPassword) {
    redirect("/change-password?error=missing");
  }

  if (nextPassword.length < 12) {
    redirect("/change-password?error=short");
  }

  if (nextPassword !== confirmPassword) {
    redirect("/change-password?error=mismatch");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true }
  });
  const validPassword = await verifyPassword(currentPassword, user?.passwordHash);

  if (!validPassword) {
    redirect("/change-password?error=current");
  }

  const passwordHash = await hashPassword(nextPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: session.user.id },
      data: {
        passwordHash,
        mustChangePassword: false
      }
    }),
    prisma.authSession.deleteMany({
      where: {
        userId: session.user.id,
        id: { not: session.id }
      }
    })
  ]);

  if (session.isPlatformAdmin && !session.tenant) {
    redirect("/platform");
  }

  if (!session.tenant) {
    redirect("/select-tenant");
  }

  if (!session.isPlatformAdmin && !session.tenant.onboardingCompletedAt) {
    redirect("/onboarding");
  }

  redirect("/dashboard");
}
