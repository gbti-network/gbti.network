---
status: published
visibility: public
title: 'Beam: Reflection AI’s First Open-Weight Model for Coding and Agents'
shortDescription: >-
  Beam is Reflection AI’s first open-weight model, combining 23.8 trillion tokens of pretraining
  with more than 100 million reinforcement-learning rollouts generated on 10,500 NVIDIA GB300 GPUs.
url: https://reflection.ai/blog/introducing-beam
category: llm
tags:
  - open-source-ai
  - language-models
  - ai-agents
  - coding
image: https://gbti.network/media/shares/gbtilabs/20261006162023-beam-reflection-ai-s-first-open-weight-model-for-7ff5955a.webp
imageSource: https://cdn.sanity.io/images/sp40emik/production/771cfe201a3d24d7a340c3372e6a1654ec1a6e42-1800x1013.png
id: 20261006162023-beam-reflection-ai-s-first-open-weight-model-for
createdAt: '2026-10-06T16:20:23.949Z'
type: share
author: gbtilabs
---

Reflection AI has introduced *Beam*, its first open-weight model. Beam is a sparse Mixture-of-Experts model with 501 billion total parameters and 23 billion active parameters, built primarily for coding, reasoning, and agentic workloads.

The model was pretrained on 23.8 trillion tokens drawn from web data, public sources, and proprietary licensed datasets. Reflection then carried out a large reinforcement-learning run using 10,500 NVIDIA GB300 GPUs over four weeks, generating more than 100 million rollouts. The company says this training improved Beam’s coding, terminal-use, reasoning, tool-use, and agentic capabilities while also focusing on inference efficiency.

According to Reflection’s published benchmarks, Beam is competitive with several larger open models on coding and reasoning tasks, though models such as Kimi K3 and newer GLM variants remain ahead on some raw capability measures. Reflection emphasizes Beam’s efficiency, reporting comparable reasoning performance to GLM-5.2 while using roughly three to four times less inference compute in its estimates.

Beam is currently undergoing final red-team testing and evaluation. Reflection says it plans to release the model weights under an Apache 2.0 license, along with a technical report, model card, documentation, and tooling for running, evaluating, and fine-tuning the model later in October 2026.

*Footnote*

1. Reflection AI, *Introducing Beam: Reflection’s 501B open-weight model*, October 5, 2026: https://reflection.ai/blog/introducing-beam
