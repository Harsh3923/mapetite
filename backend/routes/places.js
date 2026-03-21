import { Router } from "express";
import { body, param, validationResult } from "express-validator";
import prisma from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// All routes require authentication
router.use(requireAuth);

// ─── GET /api/places ──────────────────────────────────────────────────────────
// Returns all saved places for the authenticated user

router.get("/", async (req, res, next) => {
  try {
    const places = await prisma.savedPlace.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
      include: { collection: { select: { id: true, name: true, color: true } } },
    });
    res.json({ places });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/places ─────────────────────────────────────────────────────────
// Save a new place

router.post(
  "/",
  [
    body("name").trim().notEmpty().withMessage("Name is required"),
    body("address").trim().notEmpty().withMessage("Address is required"),
    body("latitude").isFloat({ min: -90, max: 90 }).withMessage("Valid latitude required"),
    body("longitude").isFloat({ min: -180, max: 180 }).withMessage("Valid longitude required"),
    body("mapboxPlaceId").trim().notEmpty().withMessage("Mapbox place ID is required"),
    body("category").optional().trim(),
    body("notes").optional().trim().isLength({ max: 500 }).withMessage("Notes max 500 chars"),
    body("collectionId").optional().trim(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const { name, address, category, latitude, longitude, mapboxPlaceId, notes, collectionId } = req.body;

      // Verify collection belongs to this user if provided
      if (collectionId) {
        const col = await prisma.collection.findFirst({ where: { id: collectionId, userId: req.userId } });
        if (!col) return res.status(400).json({ error: "Invalid collection" });
      }

      const place = await prisma.savedPlace.create({
        data: {
          userId: req.userId,
          name,
          address,
          category: category || null,
          latitude,
          longitude,
          mapboxPlaceId,
          notes: notes || null,
          collectionId: collectionId || null,
        },
        include: { collection: { select: { id: true, name: true, color: true } } },
      });

      res.status(201).json({ place });
    } catch (err) {
      // Prisma unique constraint violation (P2002) — already saved
      if (err.code === "P2002") {
        return res.status(409).json({ error: "You've already saved this place" });
      }
      next(err);
    }
  }
);

// ─── PATCH /api/places/:id ────────────────────────────────────────────────────
// Update notes and/or move to a collection

router.patch(
  "/:id",
  [
    param("id").notEmpty(),
    body("notes").optional().trim().isLength({ max: 500 }).withMessage("Notes max 500 chars"),
    body("collectionId").optional({ nullable: true }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const { id } = req.params;
      const { notes, collectionId } = req.body;

      // Verify ownership before updating
      const existing = await prisma.savedPlace.findFirst({
        where: { id, userId: req.userId },
      });

      if (!existing) {
        return res.status(404).json({ error: "Place not found" });
      }

      // Validate collectionId belongs to this user if provided
      if (collectionId) {
        const col = await prisma.collection.findFirst({ where: { id: collectionId, userId: req.userId } });
        if (!col) return res.status(400).json({ error: "Invalid collection" });
      }

      const data = {};
      if (notes !== undefined) data.notes = notes;
      // collectionId can be set to null (remove from collection) or a valid id
      if ("collectionId" in req.body) data.collectionId = collectionId || null;

      const place = await prisma.savedPlace.update({
        where: { id },
        data,
        include: { collection: { select: { id: true, name: true, color: true } } },
      });

      res.json({ place });
    } catch (err) {
      next(err);
    }
  }
);

// ─── DELETE /api/places/:id ───────────────────────────────────────────────────
// Remove a saved place

router.delete(
  "/:id",
  [param("id").notEmpty()],
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Delete only if it belongs to this user (prevents unauthorized deletion)
      const deleted = await prisma.savedPlace.deleteMany({
        where: { id, userId: req.userId },
      });

      if (deleted.count === 0) {
        return res.status(404).json({ error: "Place not found" });
      }

      res.json({ message: "Place removed" });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
