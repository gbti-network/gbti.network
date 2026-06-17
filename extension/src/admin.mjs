// SOW-036: the extension's Admin page bootstrap. Mounts <gbti-admin> (role-gated moderation/admin tools, SOW-006
// AD1) over the background-worker messaging bridge; the page never sees the token. <gbti-admin> self-gates on the
// signed-in role (it shows a "moderators and above" notice otherwise), so reaching this page from the avatar menu
// is harmless for a plain member. Reached from the avatar menu's "Admin tools" entry (shown only for moderator+).
import { mountPageClient } from './page-client.mjs';
import { initShell } from './shell.mjs';

mountPageClient();

// SOW-036: mount the shared member-hub shell (top bar + left rail). Admin is not a rail destination (reached via
// the account menu), so no rail item is highlighted.
initShell({ active: null });
