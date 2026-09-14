// sow-244: the ONE copy of the Chrome Web Store listing URL. The store is the only supported install (owner,
// 2026-08-16: "no one is using unpacked but me; lets offer no backward support for unpacked anywhere").
//
// A plain .mjs so both sides can import it: the site (src/lib/extension.ts) and the packager
// (extension/package.mjs), which writes it into public/extension/latest.json. The packager used to hardcode an
// empty string there with a comment waiting on a store submission that happened on 2026-07-20, so every build
// re-blanked the field; scripts/check-extension.mjs now fails when the two disagree.
export const WEB_STORE_URL = 'https://chromewebstore.google.com/detail/gbti-network-extension/iffjdmifgnjgkdjoodapjciddibmifka';
