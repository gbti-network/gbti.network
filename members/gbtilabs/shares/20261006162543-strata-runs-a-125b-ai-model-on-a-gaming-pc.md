---
status: published
visibility: public
title: Strata Runs a 125B AI Model on a Gaming PC
shortDescription: >-
  Strata combines GPU, system RAM, CPU, and SSD storage to make Qwen3.8-Flash-Next practical on
  consumer gaming PCs while keeping prompts and outputs local.
url: https://github.com/Niko1221/Strata
category: llm
tags:
  - qwen3.8-flash-next
  - strata
  - openai
  - anthropic
image: https://gbti.network/media/shares/gbtilabs/20261006162543-strata-runs-a-125b-ai-model-on-a-gaming-pc-8c72354c.webp
imageSource: https://opengraph.githubassets.com/859c9d90572cb90bf69b5e012ab9653d22c0731cf472997c9e4f5e175d00e0ac/Niko1221/Strata
id: 20261006162543-strata-runs-a-125b-ai-model-on-a-gaming-pc
createdAt: '2026-10-06T16:25:43.692Z'
type: share
author: gbtilabs
---

Strata is a free and open-source project designed to run Qwen3.8-Flash-Next, a 125-billion-parameter AI model, on ordinary gaming PCs. It supports Windows and Linux with compatible NVIDIA or AMD graphics cards starting at 12 GB of VRAM, at least 32 GB of system RAM, and roughly 80 GB of free storage.

Instead of requiring the entire model to fit on the graphics card, Strata distributes the workload across the computer. Frequently used experts remain on the GPU, the full expert set is held in system RAM, the CPU handles additional work, and the SSD stores supporting data. The project also uses speculative decoding, where a smaller model proposes upcoming tokens for the larger model to verify.

Strata exposes OpenAI-compatible, Anthropic-compatible, and Responses API endpoints, allowing it to work with coding tools and other applications that already support those interfaces. It also includes a browser interface for chat and system monitoring, configurable reasoning effort, optional image input, multi-GPU support, and local network access.

The project reports 53 to 94 output tokens per second across several quantizations on an RTX 5070 with 12 GB of VRAM, and 44 to 60 tokens per second on an RX 9070 XT with 16 GB. Strata is released under the MIT License, while the included models and some components retain their own licenses.

*Footnote*

1. Niko1221, *Strata*, GitHub: https://github.com/Niko1221/Strata
