---
title: 'Crystal Ball: An Inevitable Future For Agency-driven Web Property Management & Service Provision'
slug: crystal-ball-for-the-next-digital-agency
status: published
visibility: public
excerpt: >-
  As AI lowers execution barriers, agencies may find new recurring value in governing the systems,
  integrations, permissions, and expertise clients use themselves.
categories:
  - devops
  - frameworks
tags:
  - whitepaper
  - agencies
  - predictions
  - clients
  - models
layout: journal
coverImage: ./images/crystal-ball.webp
featured: false
publishedAt: '2026-10-24T20:49:39.765Z'
updatedAt: '2026-10-27T02:45:37.664Z'
type: post
author: atwellpub
---

```audio Listen to the podcast version
style: card
length: 22 minutes
src: /media/podcasts/how-ai-agents-replace-web-dashboards.ogg
src: /media/podcasts/how-ai-agents-replace-web-dashboards.mp3
```

*A Strategic Vision for the Next Generation of Digital Agencies;*  First published on *<a href="https://docs.google.com/document/d/1UeDXC09Q68NtVx0vdGMvvznqC0CdVwStX1g3lUprY50/edit?usp=sharing" rel="nofollow noopener" target="_blank"><em>Google Docs</em></a>* and then shared on *<a href="https://lnkd.in/p/ehjs9Ez5" rel="noopener" target="_blank"><em>LinkedIn</em></a>*.  *The podcast version above was generated through Notebook LLM to help better introduce the paper to readers before a deeper technical dive. If you are pressed on time, I advise starting above and then later visiting the paper in full.*

## Executive Summary

The experience is fundamentally project-driven and client-driven. The agency manages the client's entire project through an integrated project management system, providing a centralized environment for coordinating work, managing resources, tracking progress, and maintaining the ongoing client relationship.

Within this environment, clients have access to a conversational interface resembling a chat-based experience or command-line terminal, through which they can interact with their project and its connected systems. This interface is highly empowered by an extensive MCP architecture provisioned, configured, and managed by the agency. The agency determines which capabilities, integrations, and permissions are available to each client, enabling them to interact with and operate their digital infrastructure through a unified experience.

Traditional CMS administration interfaces remain accessible alongside these capabilities, allowing clients and developers to perform specialized tasks, make visual edits, and interact directly with the underlying systems when appropriate.

The agency's responsibility evolves from performing individual development tasks to configuring, securing, maintaining, and expanding the client's AI-enabled infrastructure.

**The agency becomes the architect, operator, and steward of the client's digital operating environment.**

## 1. The Client Operating Environment

The client enters their digital environment through a unified application managed by the agency provider. The experience is fundamentally project-driven and permissions-based, with access to tools, integrations, administrative functions, and AI capabilities determined by each user's role within the client's organization.

The environment provides several primary interfaces operating at the same level:

- **Integration and MCP Management:** A centralized interface for viewing and managing connected applications, integrations, and MCP servers. Clients can distinguish between capabilities made available by the agency and those currently enabled within their environment. Access to individual integrations and their capabilities can be managed according to user permissions.
- **CMS Management:** A dedicated section for managing the installed content management system, its configuration, plugins, extensions, and related settings. This section also provides direct access to the traditional CMS administration experience.
- **Agent-Based Interface:** A conversational or command-line-like interface through which authorized users can interact with their website and connected systems. The agent uses the MCP architecture configured and maintained by the agency to retrieve information, execute operations, and directly manipulate the website within the user's permitted scope.
- **Project Management:** A centralized system for coordinating work between the agency and client, including project requirements, tasks, communications, milestones, and ongoing service activities.
- **User and Permission Management:** Administrative controls for assigning roles, managing organizational users, and determining which interfaces, integrations, MCP capabilities, and agent operations are available to each user.

Permissions extend beyond conventional CMS roles. Individual users within the same client organization may have substantially different experiences based on their responsibilities and authorization levels.

For example, a marketing manager may have access to Google Analytics, Google Search Console, SEO integrations, and content generation tools, while an ecommerce manager may have additional access to WooCommerce, subscription management, and shipping integrations. Other users may have access to only a limited selection of capabilities.

Some users may have no operational agent permissions whatsoever. Their experience could be limited to a conversational knowledge base tailored to the client's website, documentation, policies, products, and internal resources. These users could ask questions and retrieve relevant information without possessing the ability to modify content, change configurations, or execute operations against connected systems.

The agency maintains overarching control of the capabilities made available to each client environment, while authorized client administrators manage access within the boundaries established by the agency.

Rather than requiring every user to navigate a collection of independent administration interfaces, the platform provides a unified, role-appropriate experience. Each user can access the management tools, traditional CMS interfaces, and agent-based capabilities necessary for their responsibilities, without being exposed to functionality outside their authorized scope.

## 2. MCP as the Integration and Capability Layer

The Model Context Protocol provides a standardized framework for connecting AI agents to tools, services, and business data.

Within the proposed SaaS environment, MCP integrations are presented as configurable modules that can be enabled, disabled, and managed at the client level.

The agency assists with their installation, authentication, configuration, permissions, and ongoing maintenance.

For narrative, we are imagining a scenario where WordPress is the underlying CMS. The follow items show opportunities where MCP servers can be modularized, permissioned, and served to client. 

### 2.1 Content Management

- WordPress CMS management.
- Content creation, editing, publishing, and scheduling.
- Media library management.
- Custom post types and custom fields.
- Taxonomy and category management.
- Internal linking and link management.
- User administration and permissions.
- Content revision history.

### 2.2 Search Engine Optimization

- Rank Math integrations.
- Yoast SEO integrations.
- Metadata and schema management.
- Keyword and content analysis.
- On-page optimization.
- Technical SEO diagnostics.
- Redirect management.
- Internal linking recommendations.

### 2.3 Analytics and Search Intelligence

- Google Analytics 4.
- Google Search Console.
- Traffic and conversion reporting.
- Search performance monitoring.
- Attribution and campaign analysis.
- Automated performance summaries.
- Opportunity identification and forecasting.

### 2.4 Generative Engine Optimization

- OpenGEO and comparable GEO tooling.
- AI search visibility monitoring.
- Brand mention and citation analysis.
- Content recommendations for generative search.
- AI discovery and referral reporting.
- Competitive visibility analysis.

### 2.5 WooCommerce and Commerce Operations

- WooCommerce product and catalog management.
- Inventory and pricing management.
- Order management.
- WooCommerce Subscriptions.
- Shipping and fulfillment integrations.
- Product taxonomy management.
- Customer and transaction reporting.
- Promotional and merchandising operations.

### 2.6 Theme Management and Visual Editing

- WordPress block editor and Gutenberg integrations.
- Full Site Editing capabilities.
- Block theme management.
- Template and pattern management.
- Global styles and design systems.
- Front-end visual editing.
- Layout and component management.
- Controlled theme and presentation changes.

The objective is to allow a client to request presentation changes conversationally while retaining the ability to inspect and modify the result through a graphical interface.

### 2.7 Content Generation and Editorial Management

- Multiple language model providers.
- Model selection and routing.
- Content drafting and revision.
- Editorial planning.
- Brand voice and tone management.
- Writing persona configuration.
- Audience-specific messaging.
- Content quality and compliance review.
- Approval and publication workflows.

Brand instructions, editorial standards, and established personas become persistent organizational resources rather than instructions that must be recreated for each individual task.

### 2.8 Image Generation and Graphic Editing

- Google image generation models, including Nano Banana.
- OpenAI image generation, including DALL-E where supported.
- Midjourney integrations where supported.
- Basic image editing and transformation.
- Cropping, resizing, and compositing.
- Background manipulation.
- Brand asset and template management.
- Media optimization and publishing.

These capabilities enable clients to generate, edit, approve, and publish visual assets within the same operating environment.

The modules described above represent desired platform capabilities. Individual services may require custom MCP servers, API integrations, or alternative tool adapters depending on provider support.

## 3. Frontier Model Integration and Management

The current artificial intelligence landscape is increasingly defined by the capabilities of frontier models developed by leading providers, including Anthropic's Claude, OpenAI's GPT models and ChatGPT, Google's Gemini, xAI's Grok, Moonshot AI's Kimi, and DeepSeek.

These models are rapidly advancing in their ability to reason, write and execute code, interact with software tools, and perform increasingly complex operational tasks. Software development and code execution have emerged as particularly important applications, while reliable content creation, editorial management, and broader business workflow automation continue to improve.

For the immediate projected future, this proposal assumes that frontier models will remain central to delivering reliable, capable agentic experiences. Although open-source, open-weight, and self-hosted models may become increasingly competitive alternatives, the platform should initially prioritize rapid access to leading external model providers without becoming dependent on any single vendor.

The agency-managed project environment should therefore provide a model-agnostic execution layer, allowing agencies to quickly enable, configure, replace, and manage different frontier models across their clients' projects.

Importantly, different models may be better suited to different operational requirements. A model selected for software development and technical troubleshooting may not be the preferred model for editorial writing, research, image generation, or routine administrative tasks.

**The platform should support explicit model-to-capability associations, allowing particular models to be assigned to specific tools, integrations, MCP services, and operational workflows.**

These associations may be administered at the agency level, delegated to authorized client administrators, or configured automatically according to established rules and performance requirements.

For example:

- **Software Development:** Assigning selected coding-capable models to development, debugging, and technical maintenance operations.
- **Content Generation:** Assigning preferred language models to content drafting, rewriting, editorial review, and publishing workflows.
- **Research and Analytics:** Selecting models suited to information retrieval, analytical reasoning, and business reporting.
- **Image Generation:** Connecting dedicated image generation models to the client's creative production tools.
- **Commerce Operations:** Assigning models to WooCommerce-related tasks based on reliability, cost, and operational permissions.
- **Knowledge Base Interaction:** Using cost-efficient models for information retrieval and conversational assistance where advanced reasoning or execution capabilities are unnecessary.

These assignments should remain configurable as model capabilities, pricing, and availability evolve. The system should support agency-defined defaults, client-specific overrides where permitted, model-specific permissions, usage limits, and fallback routing when a preferred model becomes unavailable.

**The agency should ultimately control not only which MCP capabilities are available within a client environment, but also which AI models power those capabilities and under what circumstances they may be used.**

The long-term value of the agency-managed AI harness lies not in dependence on any particular frontier model, but in providing a persistent, governed, and extensible framework through which agencies can apply evolving AI capabilities to their clients' projects.

## 4. Permissions as a Primary Service Capability

Permission management is one of the most important elements of the proposed operating environment, particularly as agencies begin managing projects that involve multiple client stakeholders, team members, and increasingly capable AI agents.

While controlling what individual agents and AI models can access or modify is an important consideration, the primary function of permission management is to govern the experience and operational authority of the human users accessing the client environment.

Different members of a client's organization will have different responsibilities, and the platform should provide granular control over the tools, integrations, project management functions, and agentic capabilities available to each individual.

For example:

- **Content Management:** A team member responsible for maintaining website content may have permission to create, edit, and publish posts or pages, but no authority to modify the website's design, develop new interface elements, or alter existing components.
- **Content Strategy:** A team member responsible for content strategy may require access to the CMS, Google Search Console, SEO integrations, and higher-level project management tools, including the ability to create and organize Kanban tasks within their assigned project categories.
- **Development and Design:** A technical team member may have access to theme management, Gutenberg editing, custom development tools, and staging environments, while production deployments remain restricted or require additional approval.
- **Knowledge Base Access:** A team member may have access to a conversational interface exclusively for educational discovery, documentation retrieval, and answering questions from authorized private or public-facing knowledge bases, without any ability to modify staging or production content.
- **Project Administration:** Authorized client administrators may manage organizational users, assign responsibilities, configure available integrations, and oversee project activity within the permissions established by the agency.

Permissions should also distinguish between staging and production environments. A user may be authorized to experiment, develop, or implement changes in staging without possessing the authority to deploy those changes to production.

The same principles extend to the AI agents operating on behalf of these users.

An agent should not automatically inherit unrestricted access to every integration or MCP capability provisioned within the client environment. Its available operations should reflect both the permissions assigned to the human user and any additional restrictions established for the model, agent, or connected service.

For example, a content strategist may be permitted to use an agent to analyze Google Search Console data and prepare content recommendations, while being prohibited from using that same agent to modify theme files or publish changes directly to production.

Permission levels could include:

- **Read:** Access and analyze authorized information, including project documentation, knowledge bases, and connected systems.
- **Propose:** Generate recommendations, drafts, or suggested changes without implementing them.
- **Write:** Create or modify authorized content, configurations, or project resources.
- **Publish or Deploy:** Make approved changes available in the designated staging or production environment.
- **Administer:** Manage users, integrations, permissions, project configurations, and other administrative functions within an authorized scope.

These permissions should be configurable across individual users, organizational roles, project management functions, MCP integrations, agent capabilities, and deployment environments.

The agency maintains overarching governance of the client environment, while designated client administrators may be granted the authority to manage their own teams and operational permissions.

The platform should also support authentication, credential management, activity logging, approval workflows, and reversible changes where technically feasible.

Ultimately, permission management must treat human users and AI agents as interconnected but distinct participants in the same operating environment. The system should prioritize clearly defined human responsibilities and organizational authority, while ensuring that AI agents operate strictly within the permissions and capabilities made available to them.

## 5. The Agency as a Capability Provisioning Partner

The value exchange between clients and web development agencies is rapidly changing as artificial intelligence assumes an increasing share of the organizational, technical, and executional work traditionally performed by service providers.

Tasks that once required specialized expertise, substantial development time, or direct agency involvement are increasingly accessible through agent-assisted workflows. However, this does not eliminate the need for web development agencies or the value they provide.

Clients will continue to rely on agencies for technical guidance, infrastructure setup, maintenance, specialized development, and operational management. At the same time, they will increasingly want to determine which responsibilities they retain internally and which activities can be performed independently through their own agentic experiences.

**The agency-client relationship must therefore evolve toward providing the infrastructure, operational knowledge, and technical capabilities that enable clients to accomplish more independently.**

Rather than relying exclusively on individual development engagements, agencies can provision and maintain a persistent operating environment, introducing new capabilities as client requirements evolve.

A new client might initially receive:

- WordPress CMS integration.
- Analytics, Search Console, and SEO integrations.
- Content generation and editorial persona management.

As the relationship develops, the agency might introduce:

- WooCommerce and subscription management.
- GEO monitoring and automated content optimization.
- AI-assisted visual design and image generation.
- CRM, marketing, and custom MCP integrations.

Each additional integration expands what the client and their authorized agents can accomplish independently.

The agency's role increasingly centers on configuring, maintaining, and expanding these capabilities, while helping clients establish effective workflows and determine where human expertise remains necessary.

These activities create new opportunities for monetization through infrastructure management, integration services, training, specialized toolkits, and ongoing technical support.

**The agency's value is increasingly measured by the capabilities, infrastructure, and operational knowledge it makes available to clients, rather than the hours it spends executing individual tasks.**

## 6. Revenue Model Summarized

As outlined in the previous section, the installation, configuration, maintenance, and management of client operating environments and their connected capabilities establish a new foundation for recurring agency revenue.

This infrastructure-driven relationship can be complemented by traditional Do It For Me (DIFM) services, allowing agencies to offer both self-service capabilities and specialized professional execution.

The resulting revenue model can be divided into two primary categories.

### Scalable Infrastructure and Managed Service Retainers

- **Platform Management:** Provisioning, maintaining, and supporting client operating environments, including project management systems, CMS integrations, and AI harness configurations.
- **MCP and Model Management:** Installation, configuration, monitoring, and maintenance of connected integrations, AI models, permissions, and operational workflows.
- **Infrastructure and Usage:** Managed hosting arrangements, AI model consumption, and third-party service access, including applicable usage fees and commercial revenue-sharing opportunities.
- **Ongoing Optimization:** Recurring SEO, GEO, analytics, reputation monitoring, and content performance management.
- **Training and Enablement:** Helping client teams adopt, configure, and effectively operate their available agentic capabilities.

### Traditional and Agent-Assisted Professional Services

- **Design and Development:** Manual design rounds, custom development, technical troubleshooting, and implementation of specialized functionality.
- **Agency-Executed Agentic Work:** Receiving client instructions or prompts and working directly with the client's AI agents to execute tasks on their behalf.
- **SEO, GEO, and Reputation Strategy:** Developing and executing response strategies informed by search performance, generative engine visibility, and reputation monitoring.
- **Content Marketing:** Advising on and executing content strategy, editorial planning, creative production, and marketing campaigns.
- **Specialized Consulting:** Providing technical expertise, operational guidance, and strategic recommendations beyond the client's available self-service capabilities.

**The commercial opportunity lies in combining scalable infrastructure revenue with the continued value of agency expertise and execution.**

Clients gain the tools and permissions to manage more of their digital operations independently, while retaining access to experienced professionals who can advise, implement, and execute on their behalf.

For agencies, this creates an opportunity to expand recurring revenue through managed infrastructure and capability provisioning, while continuing to monetize the technical knowledge, creative expertise, and strategic services that distinguish their businesses.

## 7. Agent Action Management, Quality Assurance, and Reversibility

One of the more significant architectural challenges yet to be resolved is how agent-executed operations can be reliably inspected, quality assured, quality controlled, and reversed when necessary.

Unlike traditional content revision management, agentic operations may involve changes across multiple interconnected systems, including CMS configurations, theme components, ecommerce operations, external services, and infrastructure.

**The proposed platform should therefore include a centralized Agent Action Management Engine through which all agent-initiated operations are routed, recorded, validated, and managed.**

This engine would establish a consistent framework for:

- **Action Tracking:** Recording what was requested, which agent and tools were involved, and what changes were executed.
- **Quality Assurance:** Validating proposed actions before execution and verifying their results against expected outcomes.
- **Approval and Control:** Supporting human review, staging environments, and authorization requirements before consequential changes are applied.
- **Reversibility:** Maintaining the ability to roll back changes where technically possible, or provide appropriate recovery and corrective workflows when direct reversal is unavailable.
- **Execution History:** Preserving an auditable record of agent activity across the client's project and connected systems.

While the underlying technologies required to support these capabilities are reasonably established, their application to generalized agentic execution requires careful architecture.

Unlike traditional revision control, the appropriate validation, quality assurance, and reversal mechanisms may differ substantially according to the operation being performed. Modifying a Gutenberg component, changing a product price, publishing content, or executing an external API request each introduces different requirements.

**The action management system must therefore provide a common operational framework while allowing individual MCP integrations and capabilities to define their own validation, execution, and recovery procedures.**

However, a fully developed action management engine may not be necessary for initial implementation. In the interest of establishing functional agentic execution pipelines, the platform could initially rely on a journal-based or log-based system that records agent instructions, executed actions, affected resources, and resulting changes.

This history could provide sufficient context for an agent to revisit previous operations and respond to explicit revision or corrective instructions, even considerably later in the project's lifecycle.

**The ability of frontier models to interpret previous actions and intelligently execute corrective work should not be underestimated. Reversing an operation may not always require a mechanically precise rollback. In many cases, an agent could interpret the recorded history, inspect the current state, and execute a new series of changes that effectively restores the desired outcome.**

While this approach cannot guarantee reversal of every operation, particularly those involving irreversible external transactions, it could provide a practical foundation for early implementations.

A more sophisticated action management engine, with operation-specific validation, automated rollback, and stronger quality controls, could then be developed as the platform matures and its execution requirements become better understood.

## 8. Foundational Pillars for Architecture and Implementation

The rapidly declining technical barriers to software development, systems integration, and agent-assisted engineering are placing increasing pressure on the fragmented applications and administration interfaces that have historically defined web property management.

As the cost and complexity of developing interconnected systems continue to decline, consolidating these capabilities into a unified client and agency management experience becomes not only probable, but imperative.

**This consolidation should occur at the management and experience layer, while preserving modularity, portability, and independence across the underlying technologies.**

The preceding sections establish the functional, operational, and commercial requirements of this proposed system. While these architectural considerations are not exhaustive, the following pillars provide a strong foundation for early development and future improvements.

### 8.1 Unified Project and Systems Management

The client project should serve as the central organizational unit, bringing together project management, CMS administration, connected applications, agentic interfaces, organizational knowledge, and operational history.

These capabilities should remain accessible through a common, permissions-based environment, with persistent project context supporting continuity between client-directed work, agentic execution, and agency service provision.

### 8.2 CMS, MCP Modularity

WordPress provides a natural example for this model. Its mature CMS, extensive plugin ecosystem, and collaborative efforts toward AI-ready integration make it a strong candidate for modularity at both the CMS and MCP levels.

The platform should similarly accommodate alternative CMS frameworks and custom applications through modular integrations, while maintaining a unified agency and client management experience.

Agencies who build custom CMS will also require MCP modules to serve their custom CMS systems.

### 8.3 AI Model Independence and Capability Assignment

The platform must accommodate competing frontier models, emerging self-hosted alternatives, and specialized generative technologies.

Model-to-capability associations should allow agencies to designate preferred models for particular tools, MCP integrations, and operational workflows, with appropriate client-level overrides, usage restrictions, and fallback configurations.

This ensures that the platform remains adaptable as model capabilities, pricing, and availability evolve.

### 8.4 Human and Agent Permissions, Security, and Governance

The platform must support granular organizational permissions, with human authority governing access to project management, CMS functions, connected applications, and agentic capabilities.

Permissions should accommodate different organizational responsibilities, including knowledge-base-only access, restricted editing capabilities, and separate staging and production authority.

Agent permissions should operate within these human-defined boundaries, supported by secure authentication, credential management, and isolated client environments.

### 8.5 Agent Action Management and Operational Reliability

Agent-initiated operations should be managed through a common action management framework capable of supporting execution tracking, quality assurance, approvals, and recovery.

Early implementations may rely on comprehensive execution journals and agent-assisted corrective workflows, while more advanced validation and reversal mechanisms mature over time.

As established in Section 7, individual integrations must also accommodate operation-specific requirements for validation, execution, and recovery.

### 8.6 Hosting and Infrastructure Modularity

Hosting infrastructure should remain modular, supporting container-based deployment across established cloud providers, managed hosting partners, and appropriate self-hosted environments.

The platform should accommodate provisioning, monitoring, migration, and scaling across participating infrastructure providers without introducing unnecessary vendor dependencies.

This flexibility should also preserve opportunities for agency reseller relationships, infrastructure partnerships, and alternative commercial hosting arrangements.

### 8.7 Client Ownership and Operational Portability

Clients should retain ownership of their websites, applications, data, accounts, and digital assets.

The platform should support exportable project configurations, revocable access, and reasonable portability between agencies, hosting environments, CMS frameworks, and connected service providers.

Changes in agency relationships or infrastructure should not unnecessarily require clients to reconstruct their digital operating environment.

### 8.8 Economic and Operational Sustainability

Infrastructure consumption, AI model usage, integration maintenance, and human service provision must remain measurable and commercially manageable.

The platform should support project-level cost monitoring, recurring service arrangements, consumption-based billing, and professional service delivery while preserving sustainable economics for agencies and platform operators.

### Architectural Direction

These pillars establish an initial architectural foundation without prescribing every technical decision or implementation detail.

**The guiding principle is to consolidate the client and agency management experience while maintaining modularity, portability, human authority, and operational accountability across the systems powering it.**

This provides a foundation for early implementation while allowing the platform to evolve alongside the technologies, commercial relationships, and client requirements it is designed to support.

## 9. Strategic Conclusion

The future of agency service provision is not the disappearance of agencies or the elimination of development labor. It is the transformation of agencies into providers of persistent, AI-enabled digital infrastructure.

As artificial intelligence continues to reduce the technical barriers to software development and execution, the fragmented systems historically used to manage web properties will increasingly consolidate into unified, project-driven operating environments.

These environments will combine project management, CMS administration, agentic execution, and connected services through modular infrastructure governed by human permissions and agency expertise.

For clients, this represents greater independence, operational efficiency, and direct access to capabilities previously requiring specialized technical assistance.

For agencies, it introduces a new commercial opportunity centered on infrastructure provisioning, capability management, technical guidance, and ongoing professional services.

**The central prediction is that the agency-client relationship will evolve from purchasing individual development tasks toward maintaining an ongoing relationship through a shared digital operating environment.**

The agencies that recognize and adapt to this transition will be positioned to deliver greater value through the systems they build, the capabilities they enable, and the expertise they contribute.

Who will build? Who will go to market? Who will win?
