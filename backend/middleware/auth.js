import jwt from "jsonwebtoken";

/**
 * Express middleware — verifies the JWT access token from the
 * Authorization: Bearer <token> header.
 * On success: attaches req.userId and calls next().
 * On failure: responds with 401.
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    req.userId = payload.sub;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired", code: "TOKEN_EXPIRED" });
    }
    return res.status(401).json({ error: "Invalid token" });
  }
}
