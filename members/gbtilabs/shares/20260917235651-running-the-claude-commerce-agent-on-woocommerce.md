---
status: published
visibility: public
title: Running the Claude Commerce Agent on WooCommerce
shortDescription: >-
  Anthropic quietly released its experimental and open-source Claude Commerce Agent.  We decided to
  dive in and get YOU set up to tinker with the WooCommerce Claude Commerce Agent store and merchant
  exp
url: https://developer.woocommerce.com/2026/09/16/wc-claude-commerce-agent/
category: open-source
tags:
  - wordpress
  - woocommerce
  - mcp
  - python
  - agents
  - ecommerce
image: https://gbti.network/media/shares/gbtilabs/20260917235651-running-the-claude-commerce-agent-on-woocommerce-c9f44820.webp
imageSource: https://developer.woocommerce.com/wp-content/uploads/sites/2/2026/09/Introducing-the-WooCommerce-Claude-Commerce-Agent-thumbnail-1789415571.png
id: 20260917235651-running-the-claude-commerce-agent-on-woocommerce
createdAt: '2026-09-17T23:56:51.105Z'
type: share
author: gbtilabs
---

WooCommerce has released an experimental, open-source *Claude Commerce Agent* based on Anthropic’s new commerce-agent framework. It gives WooCommerce stores two AI assistants: a *shopper agent* that can find products, compare them, build carts, answer policy questions, and track qualifying orders, and a *merchant agent* that can analyze sales/stock issues and propose changes like pricing, restocking, or rewritten product copy.

### Current limitations

* *No true undo for merchant-side changes.* If the merchant agent changes something like a product price, stock level, or listing copy, there is no built-in rollback that restores the previous state. To reverse it, you have to ask the agent to create and approve a new change that puts the old value back. WooCommerce notes that this reversal can itself be refused or restore the wrong value.

* *No durable activity history.* The conversation itself acts as the main record of what the agent changed. If the service restarts, that history is lost. In WooCommerce, changes also appear as actions performed by the API user rather than being clearly labeled as agent actions, except for orders created through the shopper bridge.

* *No built-in authentication.* The reference implementation does not include its own access-control layer. Anyone who can reach the service could potentially use it, and the merchant-side service may hold a WooCommerce REST key with broad write access. WooCommerce specifically recommends putting your own authentication in front of it.

* *Designed mainly for smaller stores.* Some merchant-side reporting is based on scans limited to 400 recent orders and 250 products. On larger or high-volume stores, that means inventory alerts, sales summaries, or product-level conclusions may be incomplete or inaccurate.

* *It does not understand site traffic or conversion behavior.* WooCommerce core does not record visitor sessions in the way the agent needs, so the agent cannot natively answer questions about traffic, conversion rates, abandoned visits, or how shoppers move through the storefront.

* *Marketing campaign support is limited.* The merchant agent can read campaign information from supported marketing extensions, but it cannot currently create or draft campaigns through those integrations.

* *Product discovery still depends on keyword search.* Claude can reason over the products returned to it, but the initial retrieval is not true semantic search. If a product is poorly named, uses unusual terminology, or simply does not appear in the keyword results, the agent cannot reason about it. WooCommerce identifies this as an especially important limitation for larger catalogs.

* *It requires additional infrastructure outside WordPress.* The Claude Commerce Agent runs as a separate self-hosted Python service beside WooCommerce rather than entirely inside WordPress. That means developers must host and maintain the service in addition to the store itself.

* *Claude usage adds operating cost.* Because the agent communicates with Anthropic's models through the API, usage creates ongoing Claude API costs. WooCommerce notes that the merchant side uses a larger model, so its usage can be more expensive than the shopper-facing side.

* *The shopper experience is currently more like a second storefront than a native chat widget.* The shopper agent runs as its own frontend experience. Customers interact with that interface to search, compare, and build a cart, then return to the normal WooCommerce site for checkout. WooCommerce specifically warns merchants to consider the possible conversion impact of sending shoppers into a separate frontend experience.
