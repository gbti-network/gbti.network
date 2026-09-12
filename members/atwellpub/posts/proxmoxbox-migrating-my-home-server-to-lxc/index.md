---
title: I've Migrated My Home Server to Proxmox.
slug: proxmoxbox-migrating-my-home-server-to-lxc
status: published
visibility: public
publicStub: false
excerpt: >-
  A closet home server running a radio station and a camera system moves off Windows and WSL onto
  Proxmox VE, with each app in its own unprivileged LXC container and no open ports anywhere.
categories:
  - devops
  - tooling
tags:
  - proxmox
  - lxc
  - tailscale
  - self-hosting
  - home-server
  - wsl
  - retropie
  - security
  - windows
  - linux
layout: journal
coverImage: ./images/proxmox-cover.webp
featured: false
publishedAt: '2026-09-12T14:40:48.000Z'
updatedAt: '2026-09-12T20:57:38.289Z'
type: post
author: atwellpub
encryptedBody: members/atwellpub/_enc/post-proxmoxbox-migrating-my-home-server-to-lxc-body.enc
---

Before the migration, the hardware specs of my home server read: 12gb DDR4 ram, 100gb SSD, 1TB external HD, and an i7-7700 CPU. Modest but for years it's served me well from my office closet.

Until recently I've been running a copy of [Windows Tiny 10](https://archive.org/details/tiny-10-NTDEV) on it while leveraging its Windows Subsystem for Linux (WSL) to run a copy of <a href="https://savepoint.fm" rel="noopener" target="_blank">SavePoint Station Manager</a> for a community radio project (as well as several other Node based servers).

100GB is a good amount of space for my main SSD, but unfortunately the Windows OS takes up too much of it.   

I also consider Windows a great desktop operating system, but I'm finding the home server experience I am after is more of a headless/remote one like the VPS I rent on Cloudways.  

So I've made the decision to ditch Windows, and on the recommendation of a colleague, installed **[Proxmox](https://www.proxmox.com/en/)** as my new home server OS.  
  

## Part 1: Proxmox and the "ProxMoxBox"

Proxmox is a Linux-based platform for running and managing servers. It is built on Debian Linux and gives you one web dashboard where you can create virtual machines and lightweight Linux containers.

Instead of treating the computer like a normal desktop PC, Proxmox is designed to divide its resources between different services. Each application can run in its own separate environment, which helps keep one app from interfering with another.

For me, this is much cleaner than piling every self-hosted application into WSL under Windows. Each service can have its own container, making it easier to install, start, stop, back up, move, upgrade, or even break something without taking the rest of the server down with it.

Proxmox can run full virtual machines, but many self-hosted Linux applications can use much lighter *LXC* containers instead. It can also connect multiple Proxmox servers into a cluster, allowing you to manage several physical machines from the same interface. The computers still keep their own hardware and resources, but they become much easier to manage together.

This is where Proxmox feels very different from Windows. Windows is mainly built around using a computer directly, while Proxmox is built around managing servers, applications, virtual machines, and containers remotely. For the kind of home server I want to run, that makes Proxmox a much better fit.

## Part 2: What LXC is, and how it differs from a virtual machine

I used the word LXC earlier, which for me was a brand new term when I started my ProxMox journey. It stands for "Linux Container", plainly.

![pasted-20260911-203944](./images/pasted-20260911-203944.webp "Borrowed meme from: https://www.reddit.com/r/ProgrammerHumor/comments/qq8l3h/dont_shame_me_plz/")

One of the first questions my AI agent proposed to me during my first home server application setup was, "Do you want to install this application as a virtual machine or a LXC?" while simultaneously advising that I choose LXC.

When asking why it recommended an LXC over a virtual machine, I was informed that an LXC container and a virtual machine require different resource commitments. The VM required an upfront delegation of resources that subsequent LXC containers would share resources from. If I delegated 50% machine resources to VM One, then I would have 50% resources for VM two. They would not share the resources. While rather if I only created VM One, and then created several LXC containers within that VM, these sub containers would share.

Without a distinct need to create multiple VMs on one computer, I would be better off with just one and then all my sub-linux containers would share the whole of that machines resources (which would be better for my purpouse).

A virtual machine emulates a computer. It boots its own kernel, runs its own device drivers through
QEMU, and holds its own memory. When you give a VM 4 GB, that 4 GB is allocated to it and the host cannot
use it for anything else, whether the VM is busy or idle.

An LXC container shares the host's kernel. There is no guest kernel to boot, no QEMU, no virtio device state. What you get instead is a set of isolated namespaces and cgroup limits around a normal Linux process tree.   

In practice a bare Debian container idles at something like 30 to 60 MB of RAM before you run anything, where the same services in a VM cost 200 to 400 MB just to exist. A container starts in under a second. A VM takes 15 to 30 seconds to boot.

## Part 3: Using Tailscale with Poxmox

Converting Windows to Poxmox was the first part of my home server migration.

![pasted-20260911-173457](./images/pasted-20260911-173457.png){full}

The second part of the home network setup was making my server applications accessible inside my home network (as well as outside of it).

To solve this, we have used a service called **<a href="https://tailscale.com/" rel="noopener" target="_blank">Tailscale</a>.**

Let's give an example...

At home I have two Nest Cameras (Google) and instead of paying the 5USD a month to store and access doorbell+driveway footage from Google's cloud, **I built my own surveillance storage that stores the footage on a spare USB HD.** 

With **Tailscale**, I can type `http://homesurveillance` into a browser on any device connected to my Tailscale network and reach the server as though I were still at home.

![aha-starlight-survailence-1](./images/aha-starlight-survailence-1.webp "Yes these are two of my cameras! I converted them to the style of Aha's Take on Me to help depersonalize them."){full}

Access to these host endpoints are controlled by policies I define, so only approved devices and users can connect.  

Under the hood, Tailscale creates an encrypted WireGuard connection between my devices and gives each one a stable private address and hostname. On an iPhone, the Tailscale app uses iOS's built-in VPN interface to route that private traffic securely back to the home server.  

The best part about the TailScale solution has been their extremely generous free tier offering that covers nearly all personal usage. I already have several devices connected and host addresses for almost 8 different home server applications (this number seems to keepgrowing as I add more containers to my PoxMoxBox.

## The final migration; ProxMox in use:

Since starting this small article, the ProxMox server is not only completely setup. I've added a second machine to it, 8gb more ram, an addition 1tb SSD, a Zotec 1060 with 6gb virtual memory, and I've reformatted two external hard drives from NFTS to EXT4 so they are compatable with the Linux machines.   

The only thing left to do now is share some screenshots of my servers and let you know how I am using it to improve my personal computing experience:

![chrome_GCXZ6LAnhV](./images/chrome_gcxz6lanhv.png)

So what are we running?   

I've created a members-only breakdown of the current contents of my home server, with links to the open-source software that helps me run these apps.   

Happy to discuss any of these applications or my setup in the comments or on Discord. Thanks for reading, and good luck with your home server build 🙌
