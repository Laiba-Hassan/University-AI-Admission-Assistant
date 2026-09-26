import { Router } from "express";
import { z } from "zod";
import { staffCors } from "../cors.js";
import { withoutTenant } from "../db.js";

// Unauthenticated: a brand-new university has no tenant, no staff account and no widget key yet -- this is the
// self-serve "Create account" flow's landing spot before a platform admin approves or rejects the request (see
// the super-admin Tenants page: "Pending approval" queue, backed by this same access_requests table).
const Request = z.object({
  university_name: z.string().trim().min(1).max(200),
  contact_name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().max(40).optional(),
});

export const publicStaffRouter = Router();
publicStaffRouter.use(staffCors);

publicStaffRouter.post("/access-requests", async (req, res, next) => {
  const body = Request.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    await withoutTenant((tx) =>
      tx.query(
        `INSERT INTO access_requests (university_name, contact_name, email, phone) VALUES ($1, $2, $3, $4)`,
        [body.data.university_name, body.data.contact_name, body.data.email, body.data.phone ?? null],
      ));
    res.status(201).json({ status: "pending" });
  } catch (err) { next(err); }
});
