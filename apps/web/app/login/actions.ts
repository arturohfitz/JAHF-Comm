"use server";

import { verifyPassword } from "@jahf-comm/shared/passwords";
import { prisma } from "@jahf-comm/db";
import { redirect } from "next/navigation";

import { createSession, destroyCurrentSession } from "@/lib/auth";

function readFormString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

export async function loginAction(formData: FormData) {
  const email = readFormString(formData, "email").toLowerCase();
  const password = readFormString(formData, "password");

  if (!email || !password) {
    redirect("/login?error=missing");
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      passwordHash: true,
      memberships: {
        take: 1,
        select: {
          id: true
        }
      }
    }
  });
  const validPassword = await verifyPassword(password, user?.passwordHash);

  if (!user || !validPassword || user.memberships.length === 0) {
    redirect("/login?error=invalid");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() }
  });
  await createSession(user.id);

  redirect("/dashboard");
}

export async function logoutAction() {
  await destroyCurrentSession();
  redirect("/login");
}
