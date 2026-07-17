// SOW-124: the Worker's diagnostic logger. It reuses the shared devlog core (redaction + formatting) and is
// ALWAYS enabled: a Worker log line only reaches `wrangler tail` and the Cloudflare dashboard, both of which
// require the account owner (a superadmin), so access control is the gate here (there is no per-request UI
// toggle server-side). Redaction is still enforced by the core, so no token or secret ever reaches a log line.
// Call it at genuine diagnostic points (the central catch, an auth-verify failure, a syndication outcome), NOT
// on every request, so `[observability]` retention stays cheap.
import { createDevlog } from '../../membership/devlog-core.mjs';

export const wlog = createDevlog({ enabled: true, sink: console });
