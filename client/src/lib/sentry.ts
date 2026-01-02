import * as Sentry from "@sentry/react";

/**
 * Initialize Sentry for frontend error tracking
 * 
 * Environment variables required:
 * - VITE_SENTRY_DSN: Your Sentry project DSN
 * - VITE_SENTRY_ENVIRONMENT: Environment (development, production, test)
 */
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  
  if (!dsn) {
    console.warn("⚠️ VITE_SENTRY_DSN not configured. Error tracking disabled.");
    return;
  }

  const environment = import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE || "development";
  const tracesSampleRate = parseFloat(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || "0.1");
  const replaysSessionSampleRate = parseFloat(import.meta.env.VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE || "0.1");
  const replaysOnErrorSampleRate = parseFloat(import.meta.env.VITE_SENTRY_REPLAYS_ERROR_SAMPLE_RATE || "1.0");

  Sentry.init({
    dsn,
    environment,
    
    // Performance Monitoring
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    
    // Performance monitoring sample rate
    tracesSampleRate,
    
    // Session Replay
    replaysSessionSampleRate,
    replaysOnErrorSampleRate,
    
    // Filter out sensitive data
    beforeSend(event, hint) {
      // Remove sensitive data from breadcrumbs
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map(breadcrumb => {
          if (breadcrumb.data) {
            delete breadcrumb.data.password;
            delete breadcrumb.data.token;
            delete breadcrumb.data.apiKey;
          }
          return breadcrumb;
        });
      }
      
      // Filter out development errors
      if (environment === "development" && !import.meta.env.VITE_SENTRY_DEBUG) {
        return null;
      }
      
      return event;
    },
    
    // Ignore specific errors
    ignoreErrors: [
      // Browser extensions
      "top.GLOBALS",
      "chrome-extension://",
      "moz-extension://",
      
      // Random plugins/extensions
      "Can't find variable: ZiteReader",
      "jigsaw is not defined",
      "ComboSearch is not defined",
      
      // Facebook errors
      "fb_xd_fragment",
      
      // Network errors that are expected
      "NetworkError",
      "Failed to fetch",
      "Load failed",
      
      // ResizeObserver errors (harmless)
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      
      // Common user errors
      "Non-Error promise rejection captured",
    ],
    
    // Ignore specific URLs
    denyUrls: [
      // Browser extensions
      /extensions\//i,
      /^chrome:\/\//i,
      /^moz-extension:\/\//i,
    ],
    
    // Release tracking
    release: import.meta.env.VITE_SENTRY_RELEASE || `stylora@${import.meta.env.VITE_APP_VERSION}`,
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
 * Create error boundary component
 */
export const ErrorBoundary = Sentry.ErrorBoundary;

/**
 * Wrap component with error boundary
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryOptions?: Sentry.ErrorBoundaryProps
) {
  return Sentry.withErrorBoundary(Component, errorBoundaryOptions);
}

export default Sentry;
