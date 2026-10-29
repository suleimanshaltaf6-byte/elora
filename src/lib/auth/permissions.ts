import { getSession } from "./session";

export type Role = "customer" | "support" | "catalog_manager" | "order_manager" | "admin";

const PERMISSIONS: Record<Role, readonly string[]> = {
  customer: [],
  support: ["orders:read", "support:write"],
  catalog_manager: ["products:write", "inventory:write", "banners:write"],
  order_manager: ["orders:read", "orders:write", "refunds:write"],
  admin: ["*"],
};

const ROLES = new Set<Role>(Object.keys(PERMISSIONS) as Role[]);

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export function can(role: Role, permission: string): boolean {
  const granted = PERMISSIONS[role];
  return Boolean(granted && (granted.includes("*") || granted.includes(permission)));
}

export async function requirePermission(req: Request, permission: string) {
  const session = await getSession(req);
  if (!session) throw new HttpError(401, "Sign in required");

  const role: unknown = session.user.role;
  if (typeof role !== "string" || !ROLES.has(role as Role) || !can(role as Role, permission)) {
    throw new HttpError(403, "Not permitted");
  }
  return session;
}