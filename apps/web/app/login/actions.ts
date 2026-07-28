"use server";

import { verifyPassword } from "@jahf-comm/shared/passwords";
import { prisma } from "@jahf-comm/db";
import { redirect } from "next/navigation";

import { createSession, destroyCurrentSession } from "@/lib/auth";
import { sendMail } from "@/lib/email";

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

function getPasswordRecoveryAdminEmail() {
  return (
    process.env.PASSWORD_RECOVERY_ADMIN_EMAIL?.trim() ||
    "arturoh.fitz@gmail.com"
  );
}

function getPublicAppUrl() {
  return (
    process.env.APP_PUBLIC_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    "http://localhost:3000"
  );
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

type RecoveryMembership = {
  role: string;
  tenant: {
    name: string;
    slug: string;
  };
};

export async function requestPasswordRecoveryAction(formData: FormData) {
  const email = readFormString(formData, "recoveryEmail").toLowerCase();

  if (!email || !isValidEmail(email)) {
    redirect("/login?recovery=missing");
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      lastLoginAt: true,
      memberships: {
        select: {
          role: true,
          tenant: {
            select: {
              name: true,
              slug: true
            }
          }
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });
  const memberships =
    user?.memberships
      .map((membership: RecoveryMembership) => {
        return `- ${membership.role} en ${membership.tenant.name} (${membership.tenant.slug})`;
      })
      .join("\n") || "- No se encontro usuario con membresia activa.";
  const requestedAt = new Date().toISOString();

  try {
    await sendMail({
      to: getPasswordRecoveryAdminEmail(),
      subject: "Solicitud de recuperacion de contrasena - JAHF Comm",
      text: [
        "Se solicito ayuda para recuperar acceso a JAHF Comm.",
        "",
        `Correo solicitado: ${email}`,
        `Usuario encontrado: ${user ? "si" : "no"}`,
        `Nombre: ${user?.name ?? "No disponible"}`,
        `Ultimo acceso: ${user?.lastLoginAt?.toISOString() ?? "No disponible"}`,
        `Fecha de solicitud: ${requestedAt}`,
        `URL: ${getPublicAppUrl()}/login`,
        "",
        "Membresias:",
        memberships,
        "",
        "Por seguridad este flujo no envia contrasenas ni crea un cambio automatico.",
        "El administrador maestro debe verificar la solicitud y restablecer el acceso de forma controlada."
      ].join("\n")
    });
  } catch {
    console.error("Password recovery email could not be sent.");
    redirect("/login?recovery=error");
  }

  redirect("/login?recovery=sent");
}
