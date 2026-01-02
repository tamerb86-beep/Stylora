/**
 * Simple email/password authentication system
 * Uses bcrypt for password hashing and JWT for sessions
 */

import { SignJWT, jwtVerify } from "jose";
import { COOKIE_NAME, THIRTY_DAYS_MS, REFRESH_TOKEN_COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Request, Response, Express } from "express";
import { parse as parseCookieHeader } from "cookie";
import * as db from "../db";
import { ENV } from "./env";
import { getSessionCookieOptions } from "./cookies";
import bcrypt from "bcrypt";
import { users, tenants } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
  email?: string;
  impersonatedTenantId?: string | null;
};

const SALT_ROUNDS = 10;

/**
 * Simple authentication service
 */
class AuthService {
  private getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }

  /**
   * Hash password using bcrypt
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  /**
   * Verify password against hash
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Create a session token
   */
  async createSessionToken(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {}
  ): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? THIRTY_DAYS_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const secretKey = this.getSessionSecret();

    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name,
      email: payload.email,
      impersonatedTenantId: payload.impersonatedTenantId ?? null,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expirationSeconds)
      .sign(secretKey);
  }

  /**
   * Verify a session token
   */
  async verifySession(
    cookieValue: string | undefined | null
  ): Promise<SessionPayload | null> {
    if (!cookieValue) {
      return null;
    }

    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"],
      });
      const { openId, appId, name, email, impersonatedTenantId } = payload as Record<string, unknown>;

      if (
        !isNonEmptyString(openId) ||
        !isNonEmptyString(appId) ||
        !isNonEmptyString(name)
      ) {
        return null;
      }

      return {
        openId,
        appId,
        name,
        email: typeof email === 'string' ? email : undefined,
        impersonatedTenantId: typeof impersonatedTenantId === 'string' ? impersonatedTenantId : null,
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }

  /**
   * Parse cookies from request
   */
  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) {
      return new Map<string, string>();
    }

    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }

  /**
   * Authenticate a request
   */
  async authenticateRequest(req: Request) {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);

    if (!session) {
      return null;
    }

    const sessionUserId = session.openId;
    const signedInAt = new Date();
    let user = await db.getUserByOpenId(sessionUserId);

    // Handle impersonation: if platform owner is impersonating a tenant
    if (session.impersonatedTenantId && session.openId === ENV.ownerOpenId) {
      if (user) {
        user = { ...user, tenantId: session.impersonatedTenantId };
      }
    }

    if (!user) {
      return null;
    }

    // Update last signed in
    await db.upsertUser({
      openId: user.openId,
      tenantId: user.tenantId,
      role: user.role,
      lastSignedIn: signedInAt,
    });

    return { 
      user, 
      impersonatedTenantId: session.impersonatedTenantId ?? null 
    };
  }
}

export const authService = new AuthService();

// Export authenticateRequest for backward compatibility
export const authenticateRequest = (req: Request) => authService.authenticateRequest(req);

/**
 * Register authentication routes
 */
export function registerAuthRoutes(app: Express) {
  // Login endpoint - email/password
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({ error: "E-post og passord er påkrevd" });
        return;
      }

      // Get user from database
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        res.status(500).json({ error: "Database ikke tilgjengelig" });
        return;
      }

      const [user] = await dbInstance
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (!user) {
        res.status(401).json({ error: "Ugyldig e-post eller passord" });
        return;
      }

      // Check password
      if (!user.passwordHash) {
        res.status(401).json({ error: "Ugyldig e-post eller passord" });
        return;
      }

      const isValidPassword = await authService.verifyPassword(password, user.passwordHash);
      if (!isValidPassword) {
        res.status(401).json({ error: "Ugyldig e-post eller passord" });
        return;
      }

      // Check if user is active
      if (!user.isActive) {
        res.status(403).json({ error: "Kontoen er deaktivert" });
        return;
      }

      // Create session token (30 days)
      const sessionToken = await authService.createSessionToken({
        openId: user.openId,
        appId: ENV.appId,
        name: user.name || email,
        email: user.email || undefined,
      }, {
        expiresInMs: THIRTY_DAYS_MS,
      });

      // Create refresh token (90 days)
      const { createRefreshToken } = await import("./refresh-tokens");
      const refreshToken = await createRefreshToken(
        user.id,
        user.tenantId,
        req.ip,
        req.headers["user-agent"]
      );

      // Set cookies
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: THIRTY_DAYS_MS });
      res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, { ...cookieOptions, maxAge: 90 * 24 * 60 * 60 * 1000 }); // 90 days

      res.json({ 
        success: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          tenantId: user.tenantId,
        }
      });
    } catch (error) {
      console.error("[Auth] Login failed", error);
      res.status(500).json({ error: "Innlogging feilet" });
    }
  });

  // Demo login endpoint - auto-login to demo account
  app.post("/api/auth/demo-login", async (req: Request, res: Response) => {
    try {
      const DEMO_EMAIL = "demo@stylora.no";
      
      // Get demo user from database
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        res.status(500).json({ error: "Database ikke tilgjengelig" });
        return;
      }

      const [user] = await dbInstance
        .select()
        .from(users)
        .where(eq(users.email, DEMO_EMAIL))
        .limit(1);

      if (!user) {
        res.status(404).json({ error: "Demo-konto ikke funnet" });
        return;
      }

      // Create session token
      const sessionToken = await authService.createSessionToken({
        openId: user.openId,
        appId: ENV.appId,
        name: user.name || "Demo User",
        email: user.email || undefined,
      }, {
        expiresInMs: ONE_YEAR_MS,
      });

      // Set cookie
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.json({ 
        success: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          tenantId: user.tenantId,
        }
      });
    } catch (error) {
      console.error("[Auth] Demo login failed", error);
      res.status(500).json({ error: "Demo-innlogging feilet" });
    }
  });

  // Register endpoint
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password, name, salonName, phone } = req.body;

      if (!email || !password) {
        res.status(400).json({ error: "E-post og passord er påkrevd" });
        return;
      }

      if (password.length < 6) {
        res.status(400).json({ error: "Passordet må være minst 6 tegn" });
        return;
      }

      const dbInstance = await db.getDb();
      if (!dbInstance) {
        res.status(500).json({ error: "Database ikke tilgjengelig" });
        return;
      }

      // Check if email already exists
      const [existingUser] = await dbInstance
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existingUser) {
        res.status(400).json({ error: "E-postadressen er allerede registrert" });
        return;
      }

      // Create tenant
      const tenantId = `tenant-${nanoid(12)}`;
      const subdomain = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '') + '-' + nanoid(6);
      
      await dbInstance.insert(tenants).values({
        id: tenantId,
        name: salonName || `${name || email.split('@')[0]}'s Salong`,
        subdomain,
        email,
        phone: phone || null,
        status: 'trial',
        trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days trial
        emailVerified: true, // Auto-verify for simplicity
        emailVerifiedAt: new Date(),
        onboardingCompleted: false,
        onboardingStep: 'welcome',
      });

      // Hash password and create user
      const passwordHash = await authService.hashPassword(password);
      const openId = `user-${nanoid(16)}`;

      await dbInstance.insert(users).values({
        tenantId,
        openId,
        email,
        name: name || email.split('@')[0],
        phone: phone || null,
        passwordHash,
        role: 'owner',
        loginMethod: 'email',
        isActive: true,
        commissionType: 'percentage',
        commissionRate: '50.00',
        uiMode: 'advanced',
        onboardingCompleted: false,
      });

      // Get the created user
      const [newUser] = await dbInstance
        .select()
        .from(users)
        .where(eq(users.openId, openId))
        .limit(1);

      // Create session token
      const sessionToken = await authService.createSessionToken({
        openId,
        appId: ENV.appId,
        name: name || email.split('@')[0],
        email,
      }, {
        expiresInMs: ONE_YEAR_MS,
      });

      // Set cookie
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.json({ 
        success: true,
        message: "Registrering vellykket!",
        user: {
          id: newUser?.id,
          name: newUser?.name,
          email: newUser?.email,
          role: newUser?.role,
          tenantId: newUser?.tenantId,
        }
      });
    } catch (error) {
      console.error("[Auth] Registration failed", error);
      res.status(500).json({ error: "Registrering feilet" });
    }
  });

  // Forgot password endpoint
  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        res.status(400).json({ error: "E-post er påkrevd" });
        return;
      }
      
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        res.status(500).json({ error: "Database ikke tilgjengelig" });
        return;
      }
      
      // Check if user exists
      const [user] = await dbInstance
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      
      // Always return success to prevent email enumeration
      // In production, you would send an email here
      if (user) {
        console.log(`[Auth] Password reset requested for ${email}`);
        // TODO: Send password reset email
      }
      
      res.json({ 
        success: true, 
        message: "Hvis e-postadressen finnes i systemet, vil du motta en e-post med instruksjoner." 
      });
    } catch (error) {
      console.error("[Auth] Forgot password error:", error);
      res.status(500).json({ error: "Noe gikk galt" });
    }
  });

  // Logout endpoint
  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    try {
      // Revoke refresh token if present
      const cookies = parseCookieHeader(req.headers.cookie || "");
      const refreshToken = cookies[REFRESH_TOKEN_COOKIE_NAME];
      
      if (refreshToken) {
        const { revokeRefreshToken } = await import("./refresh-tokens");
        await revokeRefreshToken(refreshToken, "User logout");
      }

      // Clear cookies
      const cookieOptions = getSessionCookieOptions(req);
      res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      
      res.json({ success: true });
    } catch (error) {
      console.error("[Auth] Logout failed", error);
      // Still clear cookies even if revocation fails
      const cookieOptions = getSessionCookieOptions(req);
      res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      res.json({ success: true });
    }
  });

  // Get current user endpoint
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const result = await authService.authenticateRequest(req);
      
      if (!result) {
        res.status(401).json({ error: "Ikke autentisert" });
        return;
      }

      res.json({
        user: {
          id: result.user.id,
          openId: result.user.openId,
          name: result.user.name,
          email: result.user.email,
          role: result.user.role,
          tenantId: result.user.tenantId,
        }
      });
    } catch (error) {
      console.error("[Auth] Get user failed", error);
      res.status(500).json({ error: "Kunne ikke hente bruker" });
    }
  });
}
