---
status: published
visibility: public
title: 'Tailcat: An open-source CLI for Tailscale’s WireGuard®, NAT traversal, and DERP'
shortDescription: >-
  Tailcat connects clients and servers using Tailscale’s WireGuard®, NAT traversal, and DERP data
  plane, with no Tailscale control plane or accounts.
url: https://tailscale.com/blog/tailcat
category: open-source
image: >-
  https://cdn.sanity.io/images/w77i7m8x/production/eba95bf72cac81675e8f0bd6fc62e757eac2dac4-2304x1188.png
id: 20260831172148-tailcat-an-open-source-cli-for-tailscale-s-wireg
createdAt: '2026-08-31T17:21:48.104Z'
type: share
author: atwellpub
---

Tailscale just open-sourced **Tailcat**, a lightweight way to use the useful parts of Tailscale’s networking stack without the Tailscale control plane. You still get WireGuard encryption, NAT traversal, and DERP fallback, but without accounts, logins, admin controls, or permanently joining a machine to a tailnet. It is essentially a secure, netcat-style pipe between machines.

The interesting use cases are ephemeral VMs, homelabs, AI agents, Raspberry Pis, remote SSH, file transfers, port forwarding, IoT, P2P games, and distributed compute. It is especially useful when you want two machines to talk securely without reconfiguring the host network or enrolling either side into a larger managed network. Repo: https://github.com/tailscale/tailcat
