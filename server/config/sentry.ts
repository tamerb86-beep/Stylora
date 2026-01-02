import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

/**
 * Initialize Sentry for backend error tracking
 * 
 * Environment variables required:
 * - SENTRY_DSN: Your Sentry project DSN
 * - NODE_ENV: Environment (development, production, test)
 * - SENTRY_TRACES_SAMPLE_RATE: Performance monitoring sample rate (0.0 to 1.0)
 * - SENTRY_PROFILES_SAMPLE_RATE: Profiling sample rate (0.0 to 1.0)
 */
export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  
  if (!dsn) {
    console.warn("⚠️ SENTRY_DSN not configured. Error tracking disabled.");
    return;
  }

  const environment = process.env.NODE_ENV || "development";
  const tracesSampleRate = parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1");
  const profilesSampleRate = parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE || "0.1");

  Sentry.init({
    dsn,
    environment,
    
    // Performance Monitoring
    tracesSampleRate,
    profilesSampleRate,
    
    integrations: [
      // Enable profiling
      nodeProfilingIntegration(),
      
      // HTTP integration for tracking requests
      new Sentry.Integrations.Http({ tracing: true }),
      
      // Express integration (if using Express)
      new Sentry.Integrations.Express(),
    ],
    
    // Filter out sensitive data
    beforeSend(event, hint) {
      // Remove sensitive headers
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      
      // Filter out health check errors
      if (event.request?.url?.includes("/health")) {
        return null;
      }
      
      return event;
    },
    
    // Ignore specific errors
    ignoreErrors: [
      // Browser errors
      "ResizeObserver loop limit exceeded",
      "Non-Error promise rejection captured",
      
      // Network errors
      "Network request failed",
      "Failed to fetch",
      
      // Common user errors
      "Unauthorized",
      "Not Found",
    ],
    
    // Release tracking
    release: process.env.SENTRY_RELEASE || `stylora@${process.env.npm_package_version}`,
    
    // Server name
    serverName: process.env.RAILWAY_SERVICE_NAME || "stylora-backend",
  });

  console.log(`✅ Sentry initialized for ${environment} environment`);
}

/**
 * Capture an exception and send to Sentry
 */
export function captureException(error: Error, context?: Record<string, any>) {
  if (context) {
    Sentry.setContext("additional", context);
  }
  Sentry.captureException(error);
}

/**
 * Capture a message and send to Sentry
 */
export function captureMessage(message: string, level: Sentry.SeverityLevel = "info") {
  Sentry.captureMessage(message, level);
}

/**
 * Set user context for error tracking
 */
export function setUserContext(user: { id: string; email?: string; username?: string }) {
  Sentry.setUser(user);
}

/**
 * Clear user context (e.g., on logout)
 */
export function clearUserContext() {
  Sentry.setUser(null);
}

/**
 * Add breadcrumb for debugging
 */
export function addBreadcrumb(message: string, category: string, data?: Record<string, any>) {
  Sentry.addBreadcrumb({
    message,
    category,
    data,
    level: "info",
  });
}

/**
 * Express error handler middleware
 * Add this AFTER all routes and BEFORE any other error handlers
 */
export const sentryErrorHandler = Sentry.Handlers.errorHandler();

/**
 * Express request handler middleware
 * Add this BEFORE all routes
 */
export const sentryRequestHandler = Sentry.Handlers.requestHandler();

/**
 * Express tracing handler middleware
 * Add this BEFORE all routes
 */
export const sentryTracingHandler = Sentry.Handlers.tracingHandler();

export default Sentry;
