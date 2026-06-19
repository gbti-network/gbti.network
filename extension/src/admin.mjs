// SOW-036: the extension's Admin page bootstrap. Mounts <gbti-admin> (role-gated moderation/admin tools, SOW-006
// AD1) over the background-worker messaging bridge; the page never sees the token. <gbti-admin> self-gates on the
// signed-in role (it shows a "moderators and above" notice otherwise), so reaching this page from the avatar menu
// is harmless for a plain member. Reached from the avatar menu's "Admin tools" entry (shown only for moderator+).
import { mountPageClient } from './page-client.mjs';
import { initShell } from './shell.mjs';

mountPageClient();

// SOW-052: mount the shell with the WorkBench rail; Admin is its "Admin tools" section (role-gated in the rail).
initShell({ active: 'admin', nav: 'workbench' });
