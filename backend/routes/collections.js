import { Router } from "express";
import { body, param, validationResult } from "express-validator";
import prisma from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth);

const VALID_COLORS = [
  "#FF8C00", "#E63946", "#06D6A0", "#118AB2", "#8338EC",
  "#FB5607", "#FF006E", "#3A86FF", "#FFBE0B", "#2EC4B6",
];

// ─── GET /api/collections ─────────────────────────────────────────────────────
// Returns all collections for the authenticated user, with place count

router.get("/", async (req, res, next) => {
  try {
    const collections = await prisma.collection.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { places: true } } },
    });
    res.json({ collections });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/collections ────────────────────────────────────────────────────
// Create a new collection

router.post(
  "/",
  [
    body("name").trim().notEmpty().withMessage("Name is required").isLength({ max: 40 }),
    body("color")
      .optional()
      .isIn(VALID_COLORS)
      .withMessage("Invalid color"),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const { name, color } = req.body;

      const collection = await prisma.collection.create({
        data: {
          userId: req.userId,
          name,
          color: color || "#FF8C00",
        },
        include: { _count: { select: { places: true } } },
      });

      res.status(201).json({ collection });
    } catch (err) {
      next(err);
    }
  }
);

// ─── PATCH /api/collections/:id ───────────────────────────────────────────────
// Rename or recolor a collection

router.patch(
  "/:id",
  [
    param("id").notEmpty(),
    body("name").optional().trim().notEmpty().isLength({ max: 40 }),
    body("color").optional().isIn(VALID_COLORS).withMessage("Invalid color"),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const { id } = req.params;
      const { name, color } = req.body;

      const existing = await prisma.collection.findFirst({
        where: { id, userId: req.userId },
      });
      if (!existing) return res.status(404).json({ error: "Collection not found" });

      const collection = await prisma.collection.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(color !== undefined && { color }),
        },
        include: { _count: { select: { places: true } } },
      });

      res.json({ collection });
    } catch (err) {
      next(err);
    }
  }
);

// ─── DELETE /api/collections/:id ──────────────────────────────────────────────
// Delete a collection (places' collectionId becomes null via SetNull)

router.delete("/:id", [param("id").notEmpty()], async (req, res, next) => {
  try {
    const { id } = req.params;

    const deleted = await prisma.collection.deleteMany({
      where: { id, userId: req.userId },
    });

    if (deleted.count === 0) {
      return res.status(404).json({ error: "Collection not found" });
    }

    res.json({ message: "Collection deleted" });
  } catch (err) {
    next(err);
  }
});

export default router;
