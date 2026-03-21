import { PrismaClient } from "@prisma/client";

// Singleton pattern — reuse the same Prisma client across the app
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
});

export default prisma;
