const requiredVariables = [
  "DATABASE_URL",
  "REDIS_URL",
  "SESSION_SECRET",
  "WEBHOOK_SECRET",
  "APP_URL"
];

const missing = requiredVariables.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(
    `Missing required production environment variables: ${missing.join(", ")}`
  );
  process.exit(1);
}

if (process.env.NODE_ENV !== "production") {
  console.error("NODE_ENV must be production for production checks.");
  process.exit(1);
}

if (process.env.EVOLUTION_ALLOW_DEMO_FALLBACK === "true") {
  console.error("EVOLUTION_ALLOW_DEMO_FALLBACK must not be true in production.");
  process.exit(1);
}

if (process.env.DEMO_ADMIN_PASSWORD === "change-this-password") {
  console.error("Do not use the local demo admin password in production.");
  process.exit(1);
}

console.log("Production environment variables are present.");
