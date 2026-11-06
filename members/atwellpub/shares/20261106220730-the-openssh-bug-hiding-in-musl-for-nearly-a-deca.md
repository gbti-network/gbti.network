---
status: published
visibility: public
title: The OpenSSH Bug Hiding in musl for Nearly a Decade
shortDescription: >-
  SSHHole.com traces how decisions across Unix, musl, Alpine Linux, and OpenSSH quietly combined
  into an authentication bypass years later.
url: https://sshhole.com/
category: security
tags:
  - ssh-hole
  - musl-linux
  - openssh
id: 20261106220730-the-openssh-bug-hiding-in-musl-for-nearly-a-deca
createdAt: '2026-11-06T22:07:30.249Z'
type: share
author: atwellpub
---

Özgün Kültekin of Wakefield uncovered SSHHole, a password-authentication bypass affecting certain Linux systems running OpenSSH against musl libc without PAM.[^1]

The unusual part is its history. Kültekin traces the failure through several decisions made across different projects over decades, eventually producing a condition where an account intended to reject password authentication can instead accept one.[^1] OpenSSH independently confirmed the issue, credited Kültekin, and released 10.6p2 on November 5 with a workaround.[^2]

The OpenSSH team also used the release to discuss a broader change in security research: AI-assisted bug discovery is becoming fast enough that the project now favors quicker security releases over longer batching cycles.[^2] The original write-up reconstructs the chain in detail and includes tools for checking affected systems.

[^1]: [Özgün Kültekin, *SSHHole*](https://sshhole.com/)
[^2]: [OpenSSH, *OpenSSH 10.6p2 Release Notes*, November 5, 2026](https://www.openssh.org/releasenotes.html#10.6p2)
[^3]: [GitHub Advisory Database, *CVE-2026-123158*](https://github.com/advisories/GHSA-4fcc-vm97-gx3x)
