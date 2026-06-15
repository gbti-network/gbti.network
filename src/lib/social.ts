import {
  siX,
  siBluesky,
  siYoutube,
  siGithub,
  siDevdotto,
  siDailydotdev,
  siDiscord,
  siReddit,
  siMastodon,
} from 'simple-icons';

// LinkedIn was removed from simple-icons (legal); use the standard mark.
const LINKEDIN_PATH =
  'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z';

/** GBTI social links — real URLs from the live site, with simple-icons SVG paths. */
export const SOCIAL_LINKS = [
  { label: 'X', href: 'https://x.com/gbti_network', path: siX.path },
  { label: 'Bluesky', href: 'https://bsky.app/profile/gbti.bsky.social', path: siBluesky.path },
  { label: 'YouTube', href: 'https://www.youtube.com/@gbti_network', path: siYoutube.path },
  { label: 'GitHub', href: 'https://github.com/gbti-network', path: siGithub.path },
  { label: 'Dev.to', href: 'https://dev.to/gbti', path: siDevdotto.path },
  { label: 'Daily.dev', href: 'https://dly.to/zfCriM6JfRF', path: siDailydotdev.path },
  { label: 'Discord', href: '/membership/', path: siDiscord.path },
  { label: 'Reddit', href: 'https://www.reddit.com/r/GBTI_network', path: siReddit.path },
  { label: 'Mastodon', href: 'https://mastodon.social/@gbti', path: siMastodon.path },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/company/gbti-network/posts', path: LINKEDIN_PATH },
];

export const GITHUB_ICON_PATH = siGithub.path;

/** Map a profile social key (content-schemas.md) to a simple-icons path, for member/profile rows. */
export const ICON_PATHS: Record<string, string> = {
  github: siGithub.path,
  x: siX.path,
  bluesky: siBluesky.path,
  youtube: siYoutube.path,
  devto: siDevdotto.path,
  reddit: siReddit.path,
  mastodon: siMastodon.path,
  linkedin: LINKEDIN_PATH,
  discord: siDiscord.path,
};
