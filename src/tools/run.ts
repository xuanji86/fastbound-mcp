/**
 * Shared execution helpers for write tools. The write guard decides WHETHER to send;
 * these helpers send the plan and format the result. Centralising this keeps every
 * write tool's success path identical (and surfaces X-FastBound-* side effects).
 */
import type { ApiResponse } from "../client.js";
import { fastBoundHeaderNotes } from "../client.js";
import { okResult } from "../result.js";
import {
  withWriteGuard,
  type GuardOptions,
  type GuardedRun,
  type WriteArgs,
  type WritePlan,
  type ToolContext,
} from "../writeGuard.js";

/** Send a built plan via the matching HTTP verb. */
export function runPlan(ctx: ToolContext, audit: string, plan: WritePlan): Promise<ApiResponse<unknown>> {
  switch (plan.method) {
    case "POST":
      return ctx.client.post(plan.path, plan.body, audit);
    case "PUT":
      return ctx.client.put(plan.path, plan.body, audit);
    case "DELETE":
      return ctx.client.del(plan.path, audit);
  }
}

/** The standard write success path: send plan, return OK with side-effect notes. */
export const defaultWriteRun: GuardedRun<WriteArgs> = async (_args, ctx, audit, plan) => {
  const res = await runPlan(ctx, audit, plan);
  return okResult(plan.summary, res.data, fastBoundHeaderNotes(res.headers));
};

/** Build a guarded tool handler; most tools only need a describe() and the default run. */
export function writeHandler<A extends WriteArgs>(opts: GuardOptions<A>, run?: GuardedRun<A>) {
  return withWriteGuard<A>(opts, run ?? (defaultWriteRun as unknown as GuardedRun<A>));
}

/** Drop the control args (auditUser/confirm) so the rest can be used as a request body. */
export function stripControl<T extends WriteArgs>(args: T): Record<string, unknown> {
  const { auditUser, confirm, ...rest } = args as WriteArgs & Record<string, unknown>;
  return rest;
}

/** Like stripControl but also removes named path-only keys (e.g. id, idType). */
export function bodyWithout<T extends WriteArgs>(args: T, omit: string[]): Record<string, unknown> {
  const rest = stripControl(args);
  for (const key of omit) delete rest[key];
  return rest;
}
