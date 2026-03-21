import "dotenv/config";
import dns from "dns";
dns.setDefaultResultOrder("ipv4first");
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";

import authRouter from "./routes/auth.js";
import placesRouter from "./routes/places.js";
import collectionsRouter from "./routes/collections.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.set("trust proxy", 1);

// ─── Security Middleware ───────────────────────────────────────────────────────

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        // MapLibre GL JS loaded from unpkg CDN
        "script-src": ["'self'", "unpkg.com"],
        "worker-src": ["blob:"], // Required for MapLibre GL JS web workers
        "img-src": ["'self'", "data:", "blob:", "*.maptiler.com"],
        "connect-src": [
          "'self'",
          "api.maptiler.com",
          "*.maptiler.com",
        ],
        "style-src": ["'self'", "'unsafe-inline'", "unpkg.com", "fonts.googleapis.com", "api.maptiler.com"],
        "font-src": ["'self'", "fonts.gstatic.com", "fonts.googleapis.com"],
      },
    },
  })
);

const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:5500",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked: ${origin}`));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ─── General Middleware ────────────────────────────────────────────────────────

app.use(express.json({ limit: "10kb" })); // Prevent oversized payloads
app.use(cookieParser());

// ─── Rate Limiting ─────────────────────────────────────────────────────────────

// Global limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

// Strict limiter for auth endpoints (prevents brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many auth attempts, please try again later." },
});

app.use(globalLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use("/api/auth", authLimiter, authRouter);
app.use("/api/places", placesRouter);
app.use("/api/collections", collectionsRouter);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", env: process.env.NODE_ENV });
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ─── Error Handler ────────────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  console.error("[Error]", err);
  const status = err.status || 500;
  const message =
    process.env.NODE_ENV === "production" && status === 500
      ? "Internal server error"
      : err.message || "Internal server error";
  res.status(status).json({ error: message });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✓ Mapetite API running on http://localhost:${PORT}`);
  console.log(`  Environment: ${process.env.NODE_ENV || "development"}`);
});
