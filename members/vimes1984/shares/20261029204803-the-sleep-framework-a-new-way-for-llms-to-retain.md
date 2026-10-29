---
status: published
visibility: public
title: 'The sleep framework: A new way for LLMs to retain knowledge in continual learnin'
shortDescription: >-
  A new continual-learning framework turns temporary context into longer-term model knowledge
  through offline consolidation and synthetic “dreaming.”
url: >-
  https://research.google/blog/the-sleep-framework-a-new-way-for-llms-to-retain-knowledge-in-continual-learning/
category: llm
tags:
  - artificial-intelligence
  - continual-learning
  - llms
  - ai-research
image: https://gbti.network/media/shares/vimes1984/20261029204803-the-sleep-framework-a-new-way-for-llms-to-retain-5bc700a6.webp
imageSource: https://storage.googleapis.com/gweb-research2023-media/images/HO_previewImage1.width-800.format-jpeg.jpg
id: 20261029204803-the-sleep-framework-a-new-way-for-llms-to-retain
createdAt: '2026-10-29T20:48:03.291Z'
type: share
author: vimes1984
---

Google Research is experimenting with giving language models something resembling a sleep cycle: models operate normally during a “wake” phase, then periodically consolidate short-term information into longer-term parametric memory.[^1]

The work targets catastrophic forgetting, a longstanding continual-learning problem where acquiring new knowledge can degrade previously learned capabilities.[^2] During the proposed sleep phase, the model expands selected memory capacity, distills useful information into it, and generates synthetic “dreams” for further self-improvement.[^3]

Google reports results across factual learning, translation, reasoning, and extremely long-context tasks. The full research goes much deeper into how consolidation and dreaming work, and what would have to change for deployed LLMs to continually learn rather than remain largely frozen after training.

[^1]: [Google Research, *The sleep framework: A new way for LLMs to retain knowledge in continual learning*, October 27, 2026](https://research.google/blog/the-sleep-framework-a-new-way-for-llms-to-retain-knowledge-in-continual-learning/)
[^2]: [ACM Computing Surveys, *Continual Learning of Large Language Models: A Comprehensive Survey*, November 20, 2025](https://doi.org/10.1145/3735633)
[^3]: [Ali Behrouz, Farnoosh Hashemi and Vahab Mirrokni, *Language Models Need Sleep: Learning to Self-Modify and Consolidate Memories*](https://arxiv.org/abs/2606.03979)
