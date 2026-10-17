---
title: 'MadTicket: Tickets for Events Across Spain'
slug: madticket
shortDescription: >-
  An event ticketing platform for Spain. Buyers find concerts, parties, festivals and shows by city;
  organisers sell with Stripe checkout and QR tickets, or list an event sold elsewhere for free.
categories:
  - business
tags:
  - ticketing
  - events
  - spain
  - stripe
  - nextjs
  - postgres
pricing: freemium
pricingUrl: https://madticket.es/for-promoters#precios
requires: Nothing to install
icon: ./images/madticket-icon.png
featuredImage: ./images/madticket-cover.webp
bannerPreset: ink
gallery:
  - src: ./images/madticket-organisers.webp
    caption: 'The organiser page: publish an event, sell through Stripe and control the door.'
  - src: ./images/madticket-pricing.webp
    caption: No monthly fee. A commission applies per ticket sold.
links:
  - type: homepage
    url: https://madticket.es
    label: Website
  - type: documentation
    url: https://madticket.es/for-promoters
    label: For organisers
  - type: download
    url: https://apps.apple.com/app/id6817014212
    label: iOS app
  - type: support
    url: https://madticket.es/soporte
    label: Support
status: published
visibility: public
publishedAt: '2026-10-17T07:15:28.042Z'
type: project
author: michelmany
---

MadTicket sells tickets to concerts, parties, festivals and shows across Spain, and gives the organisers who run those events the tools to sell them.

## Buying a ticket
 Buyers browse by city, Madrid, Barcelona, Valencia, Sevilla and Bilbao, or by category, and search by artist, event or venue. Checkout takes a card or Apple Pay, and any organiser discount applies on its own. Tickets carry a QR code, live in "Mis entradas" and can be added to Apple Wallet. When an event is sold on the organiser's own site, MadTicket says so and links there instead. There is an iPhone app; the Android version is listed as coming soon.

## Publishing an event
 An organiser picks one of two routes.

**A free listing** puts the event in the MadTicket agenda with a button through to the organiser's own sales page. It costs nothing and carries no commission. It buys no advertising and promises no number of visits.

**Selling through MadTicket** runs the checkout: Stripe for payment, a unique QR code on every ticket, and billing details from the organiser before it can be switched on.
 Either way the event is reviewed before it appears. The review checks the city, the date, the purchase link, the organiser, whether it duplicates an existing listing, and whether the texts and images are the organiser's to use. An organiser who finds their own event already listed by somebody else can ask to take it over.

## Prices, coupons and affiliates

- Ticket types with their own price, capacity and visibility: General, VIP, early bird, whatever the event   needs.
- Coupons with a percentage off, a usage limit and an expiry date, optionally restricted to certain ticket   types.
- Combo discounts, such as two VIP plus one General.
- An affiliate programme: links with a fixed or percentage commission, limits and expiry per link, and   tracking of how many tickets each one sold.
- Second dates for an event, with courtesy tickets for people who came to the first.
- Refunds through Stripe, which warn first if the ticket was already scanned or the event has ended.

## Running the event in Backoffice
 MadTicket Backoffice is a native app with a responsive web version. It shows revenue, commission and settlement together, and tickets sold against capacity as they go. Orders can be searched, filtered and worked through from a phone on the night. The whole order list exports to PDF or CSV, grouped or filtered by ticket type, with the buyer name, email, reference, amount and date.

## Scanning at the door
 MadTicket Scan is native on iOS, with a web scanner for Android, and a QR can be scanned from any mobile browser. Validation is instant and shows the buyer's name. A ticket presented twice is blocked, and the screen gives the date and time it was first scanned. Nothing is printed and no extra hardware is needed.

## What it costs an organiser
 There is no monthly fee and publishing costs nothing. A commission applies per ticket sold, set by the organiser's plan, and the rest reaches them through Stripe. Settlement is requested once the event has finished. The rates themselves are not published on the site.

## Search across two languages
 A catalogue that mixes Spanish and Portuguese breaks keyword search: a search for "torneo deportivo" returns nothing for an event called "Torneio de Pádel". MadTicket closes that gap with embeddings. Events are embedded and stored in Postgres with pgvector, keyword search still runs first, and a search by meaning using cosine distance runs only when keywords return fewer than three events. Event pages show similar events from the vectors already stored, in a single query. A LinkedIn post on 16 October 2026 covers how it was built and measured, including the four models compared and why a fixed similarity threshold did not work.

## Getting in touch
 Thank you for reading this far. MadTicket is listed on the GBTI Network, a co-op where developers publish what they build and talk about how it was built. The author profile, linked from the byline at the top of this page, carries the rest of the work and is the place to take this further.
