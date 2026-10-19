import { getRequest } from "@tanstack/react-start/server";

type RequestWithWaitUntil = Request & { waitUntil?: (promise: Promise<unknown>) => void };

/**
 * Run work after the response has been sent, so the caller never waits on it.
 *
 * On serverless hosts (Vercel), Nitro attaches the platform's `waitUntil` to
 * the incoming request; registering the promise there keeps the function alive
 * until the work finishes. In local Node development there is no `waitUntil`,
 * and the long-lived process simply lets the promise complete.
 *
 * Work passed here must be safe to lose: anything that must eventually happen
 * needs its own backstop (see the community chat screening sweep).
 */
export function runAfterResponse(
  label: string,
  task: () => Promise<unknown>,
  /** Pass the handler's request where one is in hand (API routes). */
  incoming?: Request,
) {
  const promise = task().catch((error: unknown) => {
    console.error(`[background:${label}]`, error);
  });
  let request = incoming as RequestWithWaitUntil | undefined;
  if (!request) {
    try {
      request = getRequest() as RequestWithWaitUntil | undefined;
    } catch {
      request = undefined;
    }
  }
  if (typeof request?.waitUntil === "function") request.waitUntil(promise);
}
