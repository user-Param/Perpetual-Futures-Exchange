import { Router, Request, Response } from "express";
import { z } from "zod";
import { authRequired } from "../middleware/auth";
import { getUserById, loginUser, registerUser } from "../services/authService";

export const authRouter = Router();

const credsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(128),
  name: z.string().min(1).max(128).optional(),
});

authRouter.post("/register", async (req: Request, res: Response) => {
  const parsed = credsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  const { email, password, name } = parsed.data;
  if (!name) {
    res.status(400).json({ error: "name_required" });
    return;
  }
  try {
    const result = await registerUser({ email, password, name });
    res.status(201).json(result);
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    res.status(err.status ?? 500).json({ error: err.message ?? "internal_error" });
  }
});

authRouter.post("/login", async (req: Request, res: Response) => {
  const parsed = credsSchema
    .pick({ email: true, password: true })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    const result = await loginUser(parsed.data);
    res.json(result);
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    res.status(err.status ?? 500).json({ error: err.message ?? "internal_error" });
  }
});

authRouter.get("/me", authRequired, async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const user = await getUserById(req.user.userId);
  if (!user) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(user);
});

authRouter.post("/logout", authRequired, (_req: Request, res: Response) => {
  // With stateless JWT, logout is client-side. Endpoint provided for completeness.
  res.json({ ok: true });
});
