const SKILL_SOURCES = [
  {
    id: "stackoverflow-2025",
    title: "Stack Overflow Developer Survey 2025",
    url: "https://survey.stackoverflow.co/2025/"
  },
  {
    id: "github-octoverse-2025",
    title: "GitHub Octoverse 2025",
    url: "https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/"
  },
  {
    id: "github-fastest-growing-tools",
    title: "GitHub Octoverse fastest-growing tools",
    url: "https://github.blog/news-insights/octoverse/what-the-fastest-growing-tools-reveal-about-how-software-is-being-built/"
  },
  {
    id: "cncf-2025",
    title: "CNCF Annual Cloud Native Survey 2025",
    url: "https://www.linuxfoundation.org/research/cncf-2025-annual-survey"
  }
];

const SKILL_REPOSITORY = [
  {
    id: "html-css-responsive-ui",
    name: "Responsive HTML, CSS, and UI Craft",
    category: "frontend",
    horizon: "evergreen",
    demand: "high",
    tags: ["html", "css", "responsive", "website", "landing page", "layout", "accessibility", "animations"],
    aliases: ["static site", "single page website", "frontend basics", "web page"],
    summary: "Builds polished, accessible, responsive web pages with semantic HTML, modern CSS, and careful interaction states.",
    capabilities: [
      "Semantic document structure",
      "Responsive layouts with grid, flexbox, and stable sizing",
      "Accessible forms, buttons, navigation, and color contrast",
      "Lightweight animations and micro-interactions"
    ],
    applications: ["portfolios", "landing pages", "dashboards", "marketing pages", "documentation pages"],
    bestFor: ["Create a website without a framework", "Convert visual ideas into a runnable page", "Improve layout and mobile behavior"],
    avoidWhen: ["The project needs complex app state or server-rendered routing"],
    instructions: [
      "Prefer one complete index.html when the user asks for a simple site.",
      "Use stable responsive constraints, not viewport-scaled typography.",
      "Include all necessary CSS and JavaScript unless the user asks for separated files."
    ],
    artifactTemplates: ["index.html", "styles.css", "script.js"],
    sources: ["stackoverflow-2025", "github-octoverse-2025"]
  },
  {
    id: "typescript-application-architecture",
    name: "TypeScript Application Architecture",
    category: "frontend",
    horizon: "present-future",
    demand: "very high",
    tags: ["typescript", "javascript", "types", "architecture", "frontend", "node", "refactor"],
    aliases: ["ts", "typed javascript", "type safety"],
    summary: "Uses TypeScript to make JavaScript applications safer, easier to refactor, and easier for AI/code tools to reason about.",
    capabilities: [
      "Type modeling for domain data and API contracts",
      "Reusable utility types and discriminated unions",
      "Safer refactors and clearer module boundaries",
      "Typed component props, hooks, services, and API clients"
    ],
    applications: ["large frontends", "Node services", "SDKs", "shared packages", "AI-generated code hardening"],
    bestFor: ["Any medium-to-large JavaScript app", "Projects with API data", "Requests mentioning maintainability or type safety"],
    avoidWhen: ["A tiny one-off static page is all that is needed"],
    instructions: [
      "Define explicit interfaces for user-facing data.",
      "Avoid over-engineering with generic types unless they remove real duplication.",
      "Keep examples compatible with modern TypeScript and common build tools."
    ],
    artifactTemplates: ["types.ts", "api.ts", "component.tsx"],
    sources: ["github-octoverse-2025", "github-fastest-growing-tools", "stackoverflow-2025"]
  },
  {
    id: "react-product-ui",
    name: "React Product UI",
    category: "frontend",
    horizon: "present",
    demand: "very high",
    tags: ["react", "jsx", "tsx", "component", "ui", "state", "hooks", "spa"],
    aliases: ["reactjs", "react app", "component based UI"],
    summary: "Creates component-based product interfaces with predictable state, reusable components, and polished interaction design.",
    capabilities: [
      "Composable components and props",
      "Local state, effects, memoization, and custom hooks",
      "Accessible interactive UI elements",
      "Integration with APIs, forms, and client-side routing"
    ],
    applications: ["SaaS apps", "admin tools", "interactive dashboards", "client portals", "design system components"],
    bestFor: ["Interactive app UI", "Reusable product components", "Complex client-side state"],
    avoidWhen: ["The user only needs a plain document or no JavaScript"],
    instructions: [
      "Prefer function components and hooks.",
      "Keep component boundaries small and purposeful.",
      "Use accessible native controls before custom widgets."
    ],
    artifactTemplates: ["App.tsx", "components/*.tsx", "styles.css"],
    sources: ["stackoverflow-2025", "github-octoverse-2025"]
  },
  {
    id: "nextjs-fullstack",
    name: "Next.js Full-Stack Web Apps",
    category: "fullstack",
    horizon: "present-future",
    demand: "high",
    tags: ["next.js", "nextjs", "react", "server components", "routing", "fullstack", "seo", "ssr"],
    aliases: ["app router", "next app", "vercel"],
    summary: "Builds React applications with routing, server rendering, API routes, metadata, caching, and deployment-friendly structure.",
    capabilities: [
      "App Router layouts, pages, loading, and error states",
      "Server and client component separation",
      "Route handlers and form actions",
      "SEO metadata, image optimization, and data fetching patterns"
    ],
    applications: ["product sites", "content platforms", "dashboards", "commerce", "authenticated web apps"],
    bestFor: ["SEO-sensitive React apps", "Full-stack React project scaffolds", "Hybrid static and dynamic pages"],
    avoidWhen: ["A simple static HTML page is enough"],
    instructions: [
      "Mark client components explicitly only when browser state or effects are needed.",
      "Keep server-side data access out of client components.",
      "Provide complete file paths for App Router projects."
    ],
    artifactTemplates: ["app/page.tsx", "app/layout.tsx", "app/api/*/route.ts"],
    sources: ["stackoverflow-2025", "github-octoverse-2025"]
  },
  {
    id: "node-express-api",
    name: "Node.js and Express APIs",
    category: "backend",
    horizon: "evergreen",
    demand: "high",
    tags: ["node", "node.js", "express", "api", "backend", "middleware", "rest"],
    aliases: ["expressjs", "javascript backend"],
    summary: "Creates practical backend services with routing, middleware, validation, auth boundaries, and clean error handling.",
    capabilities: [
      "REST endpoints and route organization",
      "Middleware for CORS, auth, validation, and logging",
      "Async error handling and request timeouts",
      "Integration with databases and third-party APIs"
    ],
    applications: ["API servers", "proxies", "webhook handlers", "BFF layers", "AI service wrappers"],
    bestFor: ["JavaScript backend work", "Existing Express servers", "Quick API prototypes"],
    avoidWhen: ["The project is already Python, Java, Go, or serverless-first"],
    instructions: [
      "Validate request bodies before using them.",
      "Keep API keys server-side.",
      "Return consistent JSON errors and status codes."
    ],
    artifactTemplates: ["server.js", "routes/*.js", "middleware/*.js"],
    sources: ["stackoverflow-2025", "github-octoverse-2025"]
  },
  {
    id: "python-fastapi-services",
    name: "Python FastAPI Services",
    category: "backend",
    horizon: "present-future",
    demand: "high",
    tags: ["python", "fastapi", "api", "pydantic", "backend", "async", "ml"],
    aliases: ["python api", "pydantic api"],
    summary: "Builds typed Python APIs with FastAPI, request models, dependency injection, async handlers, and OpenAPI docs.",
    capabilities: [
      "Pydantic validation and response models",
      "Async endpoints and dependency injection",
      "OpenAPI documentation and testing",
      "Good fit for AI, data, and automation services"
    ],
    applications: ["AI APIs", "data services", "automation endpoints", "internal tools", "microservices"],
    bestFor: ["Python-centric teams", "AI or data-heavy services", "Typed request/response APIs"],
    avoidWhen: ["The existing project is Node-only and consistency matters more"],
    instructions: [
      "Use explicit Pydantic models for inputs and outputs.",
      "Separate routers, services, and persistence as the API grows.",
      "Include uvicorn run instructions when scaffolding a standalone app."
    ],
    artifactTemplates: ["main.py", "routers/*.py", "schemas.py"],
    sources: ["github-fastest-growing-tools", "stackoverflow-2025"]
  },
  {
    id: "sql-postgres-data-modeling",
    name: "SQL and PostgreSQL Data Modeling",
    category: "data",
    horizon: "evergreen",
    demand: "high",
    tags: ["sql", "postgres", "postgresql", "database", "schema", "query", "migration"],
    aliases: ["relational database", "db schema", "database design"],
    summary: "Designs relational schemas, indexes, constraints, migrations, and query patterns for durable application data.",
    capabilities: [
      "Normalized and pragmatic schema design",
      "Indexes, constraints, joins, and transactions",
      "Migration planning and seed data",
      "Query performance and reporting views"
    ],
    applications: ["SaaS products", "analytics", "transactional systems", "auditable records", "admin tools"],
    bestFor: ["Persistent structured data", "Reporting and relational integrity", "Backend data modeling"],
    avoidWhen: ["The data is purely ephemeral or document-shaped with no relations"],
    instructions: [
      "Name tables and columns consistently.",
      "Include indexes for common lookup paths.",
      "Prefer constraints over application-only integrity."
    ],
    artifactTemplates: ["schema.sql", "migration.sql", "seed.sql"],
    sources: ["stackoverflow-2025"]
  },
  {
    id: "rest-api-design",
    name: "REST API Design and Contracts",
    category: "backend",
    horizon: "evergreen",
    demand: "high",
    tags: ["rest", "api design", "openapi", "http", "json", "contract", "endpoints"],
    aliases: ["api contract", "endpoint design", "http api"],
    summary: "Designs clear HTTP APIs with resource modeling, validation, pagination, idempotency, and consistent errors.",
    capabilities: [
      "Resource naming and HTTP method semantics",
      "Request validation and response schemas",
      "Pagination, filtering, sorting, and versioning",
      "Error envelopes and status code consistency"
    ],
    applications: ["public APIs", "internal APIs", "frontend-backend contracts", "integrations"],
    bestFor: ["Any backend feature exposed over HTTP", "Frontend/backend collaboration", "API documentation"],
    avoidWhen: ["A streaming protocol or event-driven interface is explicitly needed"],
    instructions: [
      "Use nouns for resources and verbs for actions only when appropriate.",
      "Document request and response examples.",
      "Make retries and idempotency explicit for writes."
    ],
    artifactTemplates: ["openapi.yaml", "routes.js", "api.md"],
    sources: ["stackoverflow-2025"]
  },
  {
    id: "auth-security-basics",
    name: "Authentication and Web Security Basics",
    category: "security",
    horizon: "evergreen",
    demand: "high",
    tags: ["auth", "authentication", "security", "jwt", "oauth", "sessions", "csrf", "xss"],
    aliases: ["login", "authorization", "secure app"],
    summary: "Applies practical security patterns for login, authorization, secrets, validation, and common web vulnerabilities.",
    capabilities: [
      "Session and token handling",
      "Role-based authorization checks",
      "Input validation and output escaping",
      "Secret handling, CORS, CSRF, and XSS prevention"
    ],
    applications: ["login flows", "admin access", "API protection", "multi-user apps", "secure forms"],
    bestFor: ["Any user account or protected data feature", "Backend endpoints", "Sensitive workflows"],
    avoidWhen: ["The request is a static public-only page"],
    instructions: [
      "Never put secrets in frontend code.",
      "Enforce authorization on the server, not only in UI.",
      "Call out assumptions and residual security risk."
    ],
    artifactTemplates: ["auth.js", "middleware/auth.js", "security-notes.md"],
    sources: ["stackoverflow-2025"]
  },
  {
    id: "testing-playwright-vitest",
    name: "Testing with Playwright and Vitest",
    category: "quality",
    horizon: "present",
    demand: "high",
    tags: ["testing", "test", "playwright", "vitest", "unit", "e2e", "qa"],
    aliases: ["frontend tests", "end-to-end tests", "unit tests"],
    summary: "Adds targeted tests for user flows, components, utilities, APIs, and regressions without bloating the suite.",
    capabilities: [
      "Unit and integration tests",
      "Browser flow tests and assertions",
      "Mocking API responses and edge cases",
      "Regression tests for bug fixes"
    ],
    applications: ["frontend apps", "API logic", "critical workflows", "bug reproduction", "CI pipelines"],
    bestFor: ["Behavioral changes", "Shared utilities", "Forms and navigation", "Confidence before deploy"],
    avoidWhen: ["The user explicitly asks for prototype-only code and no tests"],
    instructions: [
      "Scale tests to risk and blast radius.",
      "Prefer behavior assertions over implementation details.",
      "Include setup commands when adding a new test tool."
    ],
    artifactTemplates: ["*.test.ts", "*.spec.ts", "playwright.config.ts"],
    sources: ["stackoverflow-2025", "github-octoverse-2025"]
  },
  {
    id: "docker-containerization",
    name: "Docker and Containerization",
    category: "devops",
    horizon: "present",
    demand: "high",
    tags: ["docker", "container", "compose", "dockerfile", "deployment", "devops"],
    aliases: ["docker compose", "containerize", "containerization"],
    summary: "Packages applications into reproducible containers with development and production-friendly configuration.",
    capabilities: [
      "Dockerfiles with small, layered images",
      "Docker Compose for local services",
      "Environment variables and secrets boundaries",
      "Health checks and production runtime concerns"
    ],
    applications: ["local dev stacks", "deployment packages", "worker services", "database-backed apps"],
    bestFor: ["Consistent setup across machines", "Multi-service local environments", "Deployment preparation"],
    avoidWhen: ["A static page can be hosted directly without a runtime"],
    instructions: [
      "Use .dockerignore and avoid copying secrets.",
      "Keep development and production commands explicit.",
      "Expose only necessary ports."
    ],
    artifactTemplates: ["Dockerfile", "docker-compose.yml", ".dockerignore"],
    sources: ["stackoverflow-2025", "cncf-2025"]
  },
  {
    id: "kubernetes-cloud-native",
    name: "Kubernetes and Cloud-Native Operations",
    category: "devops",
    horizon: "present-future",
    demand: "high",
    tags: ["kubernetes", "k8s", "cloud native", "helm", "deployment", "scaling", "observability"],
    aliases: ["k8s deployment", "cloud native"],
    summary: "Designs cloud-native deployment manifests, service boundaries, health checks, scaling, and operations guidance.",
    capabilities: [
      "Deployments, services, config maps, and secrets",
      "Health probes, resource limits, and autoscaling",
      "Helm chart structure and environment overlays",
      "Observability and rollout safety"
    ],
    applications: ["production workloads", "AI inference platforms", "microservices", "multi-environment deployments"],
    bestFor: ["Production cloud-native deployment", "Scaling or reliability requirements", "Container orchestration"],
    avoidWhen: ["A small app can deploy simpler on a PaaS or static host"],
    instructions: [
      "Start with simple manifests before Helm unless reuse demands it.",
      "Set readiness and liveness probes for services.",
      "Separate secrets from config and avoid hardcoded credentials."
    ],
    artifactTemplates: ["deployment.yaml", "service.yaml", "values.yaml"],
    sources: ["cncf-2025"]
  },
  {
    id: "github-actions-cicd",
    name: "GitHub Actions CI/CD",
    category: "devops",
    horizon: "present",
    demand: "high",
    tags: ["ci", "cd", "github actions", "workflow", "automation", "deploy", "testing"],
    aliases: ["ci/cd", "pipeline", "workflow yaml"],
    summary: "Automates tests, builds, linting, previews, releases, and deployments with maintainable GitHub Actions workflows.",
    capabilities: [
      "Test and build pipelines",
      "Dependency caching and matrix builds",
      "Preview deployments and release automation",
      "Secret-safe environment configuration"
    ],
    applications: ["web apps", "libraries", "container builds", "deployment pipelines", "quality gates"],
    bestFor: ["Projects needing repeatable checks or deploys", "Team collaboration", "Release safety"],
    avoidWhen: ["No repository automation is desired"],
    instructions: [
      "Keep workflow permissions minimal.",
      "Cache dependencies carefully by lockfile.",
      "Fail fast on lint, type checks, and tests."
    ],
    artifactTemplates: [".github/workflows/ci.yml", ".github/workflows/deploy.yml"],
    sources: ["github-octoverse-2025"]
  },
  {
    id: "ai-rag-apps",
    name: "AI App and RAG Integration",
    category: "ai",
    horizon: "future-facing",
    demand: "very high",
    tags: ["ai", "llm", "rag", "embeddings", "agents", "vector", "retrieval", "prompting"],
    aliases: ["llm app", "ai agent", "retrieval augmented generation", "vector search"],
    summary: "Builds AI features that retrieve relevant knowledge, ground model output, manage prompts, and expose useful agent workflows.",
    capabilities: [
      "Prompt and system instruction design",
      "Retrieval pipelines and context ranking",
      "Tool calling and agent workflow boundaries",
      "Evaluation, safety, citations, and fallback behavior"
    ],
    applications: ["knowledge assistants", "coding copilots", "document search", "support bots", "automation agents"],
    bestFor: ["Requests about LLM tools or knowledge bases", "AI assistants that need external context", "Document-grounded answers"],
    avoidWhen: ["A deterministic form or CRUD feature is enough"],
    instructions: [
      "Keep retrieved context concise and attributable.",
      "Separate model instructions from user-provided content.",
      "Include failure modes when retrieval is empty or low confidence."
    ],
    artifactTemplates: ["retriever.ts", "prompt.md", "evals/*.json"],
    sources: ["github-octoverse-2025", "github-fastest-growing-tools", "stackoverflow-2025"]
  },
  {
    id: "accessibility-inclusive-design",
    name: "Accessibility and Inclusive Design",
    category: "frontend",
    horizon: "evergreen",
    demand: "high",
    tags: ["accessibility", "a11y", "aria", "keyboard", "screen reader", "contrast", "forms"],
    aliases: ["wcag", "inclusive design"],
    summary: "Improves UI so it works with keyboard navigation, screen readers, readable contrast, and robust semantic structure.",
    capabilities: [
      "Semantic controls and landmarks",
      "Keyboard focus and focus-visible states",
      "Form labels, validation messages, and ARIA only when needed",
      "Contrast, motion sensitivity, and readable content structure"
    ],
    applications: ["public websites", "SaaS apps", "forms", "dashboards", "modals and panels"],
    bestFor: ["Any UI implementation or review", "Forms and interactive controls", "Production-facing pages"],
    avoidWhen: ["No user-facing UI is involved"],
    instructions: [
      "Prefer native HTML controls over custom ARIA widgets.",
      "Ensure every interactive element has an accessible name.",
      "Check keyboard operation for panels, modals, and previews."
    ],
    artifactTemplates: ["accessibility-checklist.md", "component.html", "component.tsx"],
    sources: ["stackoverflow-2025"]
  },
  {
    id: "performance-seo-web-vitals",
    name: "Web Performance, SEO, and Core Web Vitals",
    category: "frontend",
    horizon: "present",
    demand: "high",
    tags: ["performance", "seo", "web vitals", "lighthouse", "image optimization", "bundle"],
    aliases: ["page speed", "search optimization", "core web vitals"],
    summary: "Optimizes pages for load speed, rendering stability, crawlability, metadata, image handling, and user-perceived responsiveness.",
    capabilities: [
      "Critical CSS and asset loading strategy",
      "Image sizing, lazy loading, and responsive media",
      "Metadata, headings, structured content, and canonical URLs",
      "Bundle splitting and interaction responsiveness"
    ],
    applications: ["landing pages", "content sites", "commerce", "SEO pages", "marketing pages"],
    bestFor: ["Slow pages", "SEO-sensitive projects", "Public website builds"],
    avoidWhen: ["Internal tools where speed is acceptable and SEO irrelevant"],
    instructions: [
      "Reserve stable dimensions for media and fixed-format UI.",
      "Use semantic headings and metadata.",
      "Avoid unnecessary client JavaScript for static content."
    ],
    artifactTemplates: ["index.html", "next.config.js", "performance-notes.md"],
    sources: ["stackoverflow-2025"]
  },
  {
    id: "data-visualization-dashboards",
    name: "Data Visualization and Dashboards",
    category: "data",
    horizon: "present",
    demand: "high",
    tags: ["dashboard", "charts", "data visualization", "analytics", "d3", "recharts", "tables"],
    aliases: ["charts", "analytics UI", "reporting"],
    summary: "Creates clear charts, tables, filters, and dashboard layouts that help users scan, compare, and act on data.",
    capabilities: [
      "Chart type selection and data encoding",
      "Dashboard layout and responsive panels",
      "Filtering, sorting, and drill-down interactions",
      "Accessible labels, legends, and empty states"
    ],
    applications: ["analytics dashboards", "admin panels", "reports", "monitoring", "business intelligence UI"],
    bestFor: ["Data-heavy interfaces", "Charts or tables", "Operational product views"],
    avoidWhen: ["The user needs raw data transformation only"],
    instructions: [
      "Match chart type to the comparison task.",
      "Prefer restrained operational layouts for SaaS/admin dashboards.",
      "Handle loading, empty, and error states."
    ],
    artifactTemplates: ["Dashboard.tsx", "chart-data.ts", "styles.css"],
    sources: ["stackoverflow-2025"]
  },
  {
    id: "tailwind-design-systems",
    name: "Tailwind CSS and Design Systems",
    category: "frontend",
    horizon: "present",
    demand: "high",
    tags: ["tailwind", "tailwindcss", "design system", "tokens", "component library", "ui kit", "shadcn"],
    aliases: ["utility css", "tailwind ui", "design tokens"],
    summary: "Creates consistent, reusable interface systems with utility-first styling, tokens, variants, and polished component states.",
    capabilities: [
      "Design tokens for color, spacing, type, and elevation",
      "Reusable button, input, card, modal, and navigation variants",
      "Responsive utility composition without style drift",
      "Accessible states for focus, hover, loading, disabled, and errors"
    ],
    applications: ["SaaS apps", "admin panels", "component libraries", "design refreshes", "rapid frontend builds"],
    bestFor: ["Projects already using Tailwind", "Reusable UI systems", "Consistent product surfaces"],
    avoidWhen: ["The project has a mature non-Tailwind design system that should stay consistent"],
    instructions: [
      "Use existing tokens and component conventions before adding new ones.",
      "Keep utility strings readable and extract variants when repetition becomes meaningful.",
      "Verify responsive behavior for dense UI surfaces."
    ],
    artifactTemplates: ["tailwind.config.js", "components/ui/*.tsx", "styles.css"],
    sources: ["github-octoverse-2025", "stackoverflow-2025"]
  },
  {
    id: "vue-nuxt-product-ui",
    name: "Vue and Nuxt Product UI",
    category: "frontend",
    horizon: "present",
    demand: "high",
    tags: ["vue", "vue.js", "nuxt", "pinia", "composition api", "frontend", "spa"],
    aliases: ["vue3", "nuxt app", "vue app"],
    summary: "Builds Vue and Nuxt interfaces with composables, reactive state, routing, server rendering, and maintainable component boundaries.",
    capabilities: [
      "Vue 3 Composition API components and composables",
      "Nuxt pages, layouts, route middleware, and data fetching",
      "Pinia stores and client/server state boundaries",
      "Accessible forms, lists, dialogs, and navigation"
    ],
    applications: ["product dashboards", "content apps", "admin tools", "interactive websites", "server-rendered frontends"],
    bestFor: ["Existing Vue or Nuxt projects", "Component-driven frontend work", "SSR-friendly Vue apps"],
    avoidWhen: ["The project is already strongly React or Angular and consistency matters more"],
    instructions: [
      "Prefer script setup and Composition API in modern Vue files.",
      "Keep reusable logic in composables when it is shared across components.",
      "Separate server-only Nuxt code from browser-only state."
    ],
    artifactTemplates: ["pages/*.vue", "components/*.vue", "stores/*.ts"],
    sources: ["stackoverflow-2025", "github-octoverse-2025"]
  },
  {
    id: "sveltekit-web-apps",
    name: "SvelteKit Web Apps",
    category: "frontend",
    horizon: "present-future",
    demand: "medium-high",
    tags: ["svelte", "sveltekit", "frontend", "routing", "forms", "stores", "ssr"],
    aliases: ["svelte app", "kit app"],
    summary: "Creates compact SvelteKit applications with file-based routing, server actions, stores, and progressive enhancement.",
    capabilities: [
      "Svelte components, stores, transitions, and reactive statements",
      "SvelteKit routes, load functions, actions, and layouts",
      "Progressive forms and server/client data separation",
      "Small-bundle interactive interfaces"
    ],
    applications: ["fast websites", "interactive tools", "content products", "forms", "lightweight dashboards"],
    bestFor: ["Svelte or SvelteKit codebases", "Highly interactive small apps", "Performance-sensitive frontend work"],
    avoidWhen: ["The existing app has a different established framework"],
    instructions: [
      "Use SvelteKit load functions for route data.",
      "Prefer enhanced forms when server actions are involved.",
      "Keep component state local unless a store is clearly shared."
    ],
    artifactTemplates: ["src/routes/+page.svelte", "src/routes/+page.server.ts", "src/lib/*.svelte"],
    sources: ["github-fastest-growing-tools", "stackoverflow-2025"]
  },
  {
    id: "mobile-pwa-apps",
    name: "Mobile-First and PWA App Experience",
    category: "frontend",
    horizon: "present-future",
    demand: "high",
    tags: ["mobile", "pwa", "offline", "service worker", "responsive", "installable", "touch"],
    aliases: ["progressive web app", "mobile app experience", "offline app"],
    summary: "Turns web apps into mobile-friendly, installable experiences with offline behavior, touch ergonomics, and resilient loading states.",
    capabilities: [
      "Mobile-first layouts and touch-safe controls",
      "Service worker caching and offline fallbacks",
      "Web app manifest and installability basics",
      "Network-aware loading, retry, and sync patterns"
    ],
    applications: ["mobile web apps", "field tools", "offline-capable dashboards", "installable portals", "responsive products"],
    bestFor: ["Apps used heavily on phones", "Offline or unreliable network needs", "Installable web experiences"],
    avoidWhen: ["A native-only mobile application is explicitly required"],
    instructions: [
      "Design primary workflows for small screens before expanding to desktop.",
      "Keep offline behavior explicit and easy to test.",
      "Avoid caching sensitive data without a clear privacy boundary."
    ],
    artifactTemplates: ["manifest.webmanifest", "service-worker.js", "offline.html"],
    sources: ["stackoverflow-2025", "github-octoverse-2025"]
  },
  {
    id: "graphql-api-integration",
    name: "GraphQL API Design and Integration",
    category: "backend",
    horizon: "present",
    demand: "medium-high",
    tags: ["graphql", "schema", "resolver", "apollo", "relay", "api", "queries", "mutations"],
    aliases: ["gql", "graphql api", "apollo server"],
    summary: "Designs GraphQL schemas, resolvers, client queries, mutations, pagination, and data-loader patterns for flexible API access.",
    capabilities: [
      "Schema modeling and typed resolver boundaries",
      "Queries, mutations, pagination, and filtering",
      "N+1 avoidance with batching and data loaders",
      "Client integration, caching, and generated types"
    ],
    applications: ["frontend-heavy products", "multi-client APIs", "data-rich apps", "mobile/web shared backends"],
    bestFor: ["Apps that need flexible data selection", "Existing GraphQL stacks", "Typed frontend-backend contracts"],
    avoidWhen: ["Simple REST endpoints would be clearer and cheaper to maintain"],
    instructions: [
      "Keep schema names domain-oriented and stable.",
      "Guard resolver authorization at the field or resource boundary.",
      "Document pagination and error behavior."
    ],
    artifactTemplates: ["schema.graphql", "resolvers.ts", "graphql-client.ts"],
    sources: ["stackoverflow-2025", "github-octoverse-2025"]
  },
  {
    id: "orm-prisma-database-workflows",
    name: "ORM, Prisma, and Database Workflows",
    category: "data",
    horizon: "present",
    demand: "high",
    tags: ["prisma", "orm", "database", "migration", "schema", "drizzle", "sequelize", "typeorm"],
    aliases: ["database orm", "prisma schema", "db migrations"],
    summary: "Implements application data access with ORM models, migrations, relations, seed data, and query patterns that stay maintainable.",
    capabilities: [
      "ORM schema modeling and relation mapping",
      "Migration planning and rollback-aware changes",
      "Repository/service data access boundaries",
      "Seed data, indexes, constraints, and generated clients"
    ],
    applications: ["CRUD apps", "SaaS products", "admin panels", "API backends", "multi-tenant systems"],
    bestFor: ["Database-backed application features", "Existing Prisma or ORM projects", "Schema changes with app code"],
    avoidWhen: ["Raw SQL is required for complex analytics or database-specific tuning"],
    instructions: [
      "Preserve existing migration history and naming conventions.",
      "Model constraints in the database as well as application code.",
      "Keep generated files out of manual edits."
    ],
    artifactTemplates: ["prisma/schema.prisma", "migrations/*.sql", "seed.ts"],
    sources: ["stackoverflow-2025", "github-octoverse-2025"]
  },
  {
    id: "nosql-document-databases",
    name: "NoSQL and Document Database Modeling",
    category: "data",
    horizon: "present",
    demand: "high",
    tags: ["nosql", "mongodb", "firestore", "dynamodb", "document database", "collections", "indexes"],
    aliases: ["mongo", "document store", "cloud firestore"],
    summary: "Models document-oriented and key-value data with access patterns, indexes, denormalization, and consistency tradeoffs in mind.",
    capabilities: [
      "Collection and document shape design",
      "Access-pattern-first indexing",
      "Denormalization and consistency planning",
      "TTL, partition key, and transaction tradeoff guidance"
    ],
    applications: ["real-time apps", "content systems", "event stores", "serverless apps", "high-scale lookup workloads"],
    bestFor: ["Document-shaped data", "Firestore, MongoDB, or DynamoDB projects", "Flexible schema requirements"],
    avoidWhen: ["Strong relational integrity and joins are central to the product"],
    instructions: [
      "Start from read and write access patterns before choosing document shape.",
      "Call out consistency and duplication tradeoffs.",
      "Include indexes for the common query paths."
    ],
    artifactTemplates: ["schema-notes.md", "indexes.json", "models.ts"],
    sources: ["stackoverflow-2025", "github-octoverse-2025"]
  },
  {
    id: "realtime-websockets-streaming",
    name: "Real-Time WebSockets and Streaming",
    category: "backend",
    horizon: "present-future",
    demand: "high",
    tags: ["websocket", "websockets", "realtime", "streaming", "sse", "socket.io", "events"],
    aliases: ["real time", "server sent events", "live updates"],
    summary: "Builds live app experiences with WebSockets, Server-Sent Events, streaming responses, presence, and event-driven UI updates.",
    capabilities: [
      "WebSocket and SSE endpoint design",
      "Connection lifecycle, reconnection, and heartbeat handling",
      "Room, presence, and pub/sub event patterns",
      "Streaming UI updates and backpressure awareness"
    ],
    applications: ["chat apps", "live dashboards", "collaboration tools", "notifications", "AI streaming responses"],
    bestFor: ["Live updates", "Chat or collaborative apps", "Streaming model output"],
    avoidWhen: ["Polling is simpler and latency requirements are loose"],
    instructions: [
      "Plan reconnection and stale connection cleanup.",
      "Authenticate connections before joining rooms or streams.",
      "Use SSE for one-way server streams when it is enough."
    ],
    artifactTemplates: ["socket-server.js", "stream.ts", "realtime-client.ts"],
    sources: ["stackoverflow-2025", "github-octoverse-2025"]
  },
  {
    id: "observability-reliability",
    name: "Observability and Reliability Engineering",
    category: "devops",
    horizon: "present-future",
    demand: "high",
    tags: ["observability", "logging", "metrics", "tracing", "slo", "monitoring", "reliability"],
    aliases: ["opentelemetry", "logs", "alerts"],
    summary: "Adds practical logging, metrics, traces, alerts, and reliability checks so production systems are easier to understand and recover.",
    capabilities: [
      "Structured logging and request correlation",
      "Metrics, dashboards, alerts, and SLO signals",
      "Distributed tracing and OpenTelemetry basics",
      "Incident-oriented health checks and runbooks"
    ],
    applications: ["production APIs", "microservices", "AI services", "cloud deployments", "critical user workflows"],
    bestFor: ["Systems with uptime or debugging pain", "Backend and deployment work", "Production readiness reviews"],
    avoidWhen: ["A throwaway prototype is enough and production risk is low"],
    instructions: [
      "Instrument important user journeys and service boundaries.",
      "Avoid logging secrets or sensitive payloads.",
      "Prefer actionable alerts over noisy signal dumps."
    ],
    artifactTemplates: ["logger.ts", "otel.ts", "runbook.md"],
    sources: ["cncf-2025", "stackoverflow-2025"]
  },
  {
    id: "python-data-automation",
    name: "Python Data Automation and Scripting",
    category: "automation",
    horizon: "present",
    demand: "high",
    tags: ["python", "automation", "scripting", "pandas", "etl", "csv", "excel", "data cleaning"],
    aliases: ["python script", "data wrangling", "spreadsheet automation"],
    summary: "Automates data cleanup, file processing, reporting, scraping-adjacent workflows, and repeatable scripts with pragmatic Python.",
    capabilities: [
      "CSV, Excel, JSON, and text file processing",
      "Pandas transformations and validation checks",
      "CLI scripts with arguments and clear output",
      "Repeatable reports and scheduled data jobs"
    ],
    applications: ["data cleanup", "report generation", "business automation", "ETL jobs", "one-off operational scripts"],
    bestFor: ["Messy files or repeated manual work", "Spreadsheet-adjacent automation", "Python-first data tasks"],
    avoidWhen: ["A database query or frontend change directly solves the problem"],
    instructions: [
      "Use structured parsers for files instead of fragile string splitting.",
      "Validate input assumptions and handle missing data explicitly.",
      "Write scripts so they can be rerun safely."
    ],
    artifactTemplates: ["script.py", "requirements.txt", "README.md"],
    sources: ["stackoverflow-2025", "github-fastest-growing-tools"]
  },
  {
    id: "ai-evaluation-prompt-ops",
    name: "AI Evaluation and Prompt Operations",
    category: "ai",
    horizon: "future-facing",
    demand: "very high",
    tags: ["ai", "llm", "prompt", "evaluation", "evals", "guardrails", "agents", "model testing"],
    aliases: ["prompt engineering", "llm evals", "ai quality"],
    summary: "Improves AI systems with prompt versioning, evaluations, test sets, guardrails, model comparison, and measurable quality loops.",
    capabilities: [
      "Prompt structure, versioning, and regression tests",
      "Golden datasets and rubric-based evaluation",
      "Model comparison and failure-mode analysis",
      "Guardrails for safety, formatting, grounding, and tool use"
    ],
    applications: ["AI assistants", "agent workflows", "RAG systems", "support bots", "content generation tools"],
    bestFor: ["AI features that need reliability", "Prompt rewrites", "Model or agent quality reviews"],
    avoidWhen: ["The task is deterministic and does not involve model behavior"],
    instructions: [
      "Define success criteria before tuning prompts.",
      "Separate system instructions, retrieved context, and user content.",
      "Track representative failures and add them to evals."
    ],
    artifactTemplates: ["prompt.md", "evals.jsonl", "quality-report.md"],
    sources: ["github-octoverse-2025", "github-fastest-growing-tools", "stackoverflow-2025"]
  },
  {
    id: "angular-enterprise-frontend",
    name: "Angular Enterprise Frontend",
    category: "frontend",
    horizon: "present",
    demand: "high",
    tags: ["angular", "typescript", "rxjs", "enterprise", "frontend", "forms", "spa"],
    aliases: ["angular app", "angular ui", "rxjs app"],
    summary: "Builds structured Angular applications with typed components, services, routing, forms, RxJS streams, and maintainable module boundaries.",
    capabilities: [
      "Standalone components, routing, guards, and lazy loading",
      "Reactive forms with validation and clear error states",
      "Service-driven state and RxJS stream composition",
      "Enterprise UI patterns for tables, filters, dialogs, and workflows"
    ],
    applications: ["enterprise dashboards", "admin portals", "internal tools", "regulated product UIs", "large TypeScript frontends"],
    bestFor: ["Existing Angular apps", "Complex form-heavy interfaces", "Enterprise frontend modernization"],
    avoidWhen: ["A small lightweight UI would be easier in plain HTML or a smaller framework"],
    instructions: [
      "Prefer standalone components for new Angular work when the project already supports them.",
      "Keep observable chains readable and unsubscribe through framework-supported patterns.",
      "Treat form validation and loading states as first-class UI behavior."
    ],
    artifactTemplates: ["app.component.ts", "feature.component.ts", "feature.service.ts"],
    sources: ["stackoverflow-2025", "github-octoverse-2025"]
  },
  {
    id: "go-microservices-backend",
    name: "Go Microservices and APIs",
    category: "backend",
    horizon: "present-future",
    demand: "high",
    tags: ["go", "golang", "microservices", "api", "grpc", "backend", "concurrency"],
    aliases: ["golang api", "go service", "grpc service"],
    summary: "Creates fast, maintainable Go services with clear packages, HTTP or gRPC APIs, concurrency patterns, and production-minded error handling.",
    capabilities: [
      "HTTP handlers, routers, middleware, and JSON APIs",
      "gRPC services and protobuf contracts",
      "Goroutines, channels, context propagation, and cancellation",
      "Structured errors, logging, testing, and dependency boundaries"
    ],
    applications: ["microservices", "API backends", "workers", "infrastructure tools", "high-throughput services"],
    bestFor: ["Performance-sensitive services", "Cloud-native backends", "Existing Go projects"],
    avoidWhen: ["The project needs rapid UI-centric iteration and has no Go runtime"],
    instructions: [
      "Keep package boundaries simple and domain-oriented.",
      "Pass context through request-scoped work.",
      "Handle cancellation, timeouts, and errors explicitly."
    ],
    artifactTemplates: ["main.go", "internal/*/*.go", "proto/*.proto"],
    sources: ["stackoverflow-2025", "cncf-2025", "github-octoverse-2025"]
  },
  {
    id: "java-spring-boot-services",
    name: "Java Spring Boot Services",
    category: "backend",
    horizon: "evergreen",
    demand: "high",
    tags: ["java", "spring", "spring boot", "jpa", "backend", "api", "microservices"],
    aliases: ["springboot", "java api", "spring service"],
    summary: "Builds Java backend services with Spring Boot controllers, dependency injection, persistence, validation, security, and reliable project structure.",
    capabilities: [
      "REST controllers, DTOs, validation, and exception handlers",
      "Spring services, repositories, JPA entities, and transactions",
      "Configuration profiles, tests, and build setup",
      "Security, auth boundaries, and operational health endpoints"
    ],
    applications: ["enterprise APIs", "transactional systems", "microservices", "admin backends", "regulated workflows"],
    bestFor: ["Existing Java/Spring codebases", "Enterprise backend features", "Strongly structured service layers"],
    avoidWhen: ["A tiny prototype needs a lighter runtime"],
    instructions: [
      "Use DTOs at API boundaries instead of exposing entities directly.",
      "Keep transactional logic in services.",
      "Add validation and exception handling near the controller boundary."
    ],
    artifactTemplates: ["Controller.java", "Service.java", "Repository.java"],
    sources: ["stackoverflow-2025", "github-octoverse-2025"]
  },
  {
    id: "dotnet-csharp-apis",
    name: ".NET and C# APIs",
    category: "backend",
    horizon: "present",
    demand: "high",
    tags: [".net", "dotnet", "c#", "csharp", "asp.net", "api", "backend"],
    aliases: ["asp.net core", "c# api", "dotnet service"],
    summary: "Creates .NET APIs and services with minimal APIs or controllers, typed models, dependency injection, EF Core, and production-ready configuration.",
    capabilities: [
      "ASP.NET Core routing, controllers, and minimal APIs",
      "Dependency injection, options, middleware, and filters",
      "Entity Framework Core models, migrations, and queries",
      "Authentication, authorization, logging, and health checks"
    ],
    applications: ["enterprise APIs", "internal services", "Windows-friendly stacks", "SaaS backends", "integration services"],
    bestFor: ["Existing .NET projects", "C# backend features", "Teams standardizing on Microsoft ecosystems"],
    avoidWhen: ["The codebase has no .NET runtime and consistency favors another stack"],
    instructions: [
      "Use typed request and response models.",
      "Keep EF Core migrations deliberate and reviewable.",
      "Use configuration providers instead of hardcoded environment-specific values."
    ],
    artifactTemplates: ["Program.cs", "Controllers/*.cs", "Data/*.cs"],
    sources: ["stackoverflow-2025", "github-octoverse-2025"]
  },
  {
    id: "rust-systems-wasm",
    name: "Rust Systems and WebAssembly",
    category: "systems",
    horizon: "future-facing",
    demand: "medium-high",
    tags: ["rust", "wasm", "webassembly", "systems", "performance", "cli", "memory safety"],
    aliases: ["rustlang", "rust cli", "wasm module"],
    summary: "Builds memory-safe systems code, command-line tools, high-performance modules, and WebAssembly integrations with Rust.",
    capabilities: [
      "Rust project structure, crates, traits, and error handling",
      "CLI tooling with argument parsing and structured output",
      "WebAssembly modules and browser or Node integration",
      "Performance-aware code without sacrificing safety"
    ],
    applications: ["CLIs", "performance-sensitive modules", "WASM widgets", "systems tooling", "data processing"],
    bestFor: ["Performance and safety requirements", "Rust codebases", "WASM-enabled web features"],
    avoidWhen: ["A simpler scripting language solves the task clearly"],
    instructions: [
      "Favor clear ownership and error types over clever lifetime gymnastics.",
      "Keep unsafe code out unless there is a compelling reason.",
      "Document build and run commands for Rust or WASM artifacts."
    ],
    artifactTemplates: ["Cargo.toml", "src/main.rs", "src/lib.rs"],
    sources: ["stackoverflow-2025", "github-octoverse-2025"]
  },
  {
    id: "laravel-php-apps",
    name: "Laravel and Modern PHP Apps",
    category: "backend",
    horizon: "present",
    demand: "medium-high",
    tags: ["laravel", "php", "eloquent", "blade", "api", "mvc", "backend"],
    aliases: ["modern php", "laravel app", "php mvc"],
    summary: "Builds modern PHP applications with Laravel routing, controllers, Eloquent models, migrations, queues, validation, and Blade or API workflows.",
    capabilities: [
      "Routes, controllers, requests, policies, and middleware",
      "Eloquent models, relationships, migrations, and seeders",
      "Blade views, API resources, queues, mail, and jobs",
      "Validation, authorization, and environment configuration"
    ],
    applications: ["business apps", "CMS-style tools", "API backends", "admin panels", "server-rendered products"],
    bestFor: ["Existing Laravel projects", "PHP apps that need modernization", "CRUD-heavy business workflows"],
    avoidWhen: ["The project is intentionally framework-free or already on another backend stack"],
    instructions: [
      "Use form request validation for user inputs.",
      "Keep business logic out of Blade templates.",
      "Prefer migrations and seeders over manual database setup."
    ],
    artifactTemplates: ["routes/web.php", "app/Http/Controllers/*.php", "database/migrations/*.php"],
    sources: ["stackoverflow-2025", "github-octoverse-2025"]
  },
  {
    id: "terraform-infrastructure-as-code",
    name: "Terraform and Infrastructure as Code",
    category: "devops",
    horizon: "present-future",
    demand: "high",
    tags: ["terraform", "iac", "infrastructure as code", "cloud", "modules", "deployment", "devops"],
    aliases: ["tf", "infra as code", "cloud infrastructure"],
    summary: "Defines cloud infrastructure with Terraform modules, variables, state boundaries, environments, and reviewable deployment plans.",
    capabilities: [
      "Terraform resources, modules, variables, outputs, and providers",
      "Environment structure and remote state planning",
      "Secrets, IAM, networking, and dependency boundaries",
      "Plan/apply workflow, drift awareness, and documentation"
    ],
    applications: ["cloud deployments", "platform foundations", "CI/CD infrastructure", "managed services", "multi-environment apps"],
    bestFor: ["Repeatable cloud setup", "Infrastructure reviews", "Teams needing auditable changes"],
    avoidWhen: ["A simple one-click host configuration is enough and IaC would add ceremony"],
    instructions: [
      "Keep modules small and purpose-specific.",
      "Never hardcode secrets in Terraform files.",
      "Call out state, provider, and environment assumptions."
    ],
    artifactTemplates: ["main.tf", "variables.tf", "outputs.tf"],
    sources: ["cncf-2025", "stackoverflow-2025"]
  },
  {
    id: "cloud-architecture-managed-services",
    name: "Cloud Architecture and Managed Services",
    category: "devops",
    horizon: "present-future",
    demand: "high",
    tags: ["cloud", "aws", "azure", "gcp", "architecture", "managed services", "scaling"],
    aliases: ["cloud architecture", "aws architecture", "azure architecture", "gcp architecture"],
    summary: "Designs pragmatic cloud architectures using managed compute, storage, databases, networking, security boundaries, and scaling tradeoffs.",
    capabilities: [
      "Cloud service selection and deployment topology",
      "Networking, IAM, secrets, storage, and database boundaries",
      "Cost, latency, availability, and scaling tradeoff analysis",
      "Migration and production readiness planning"
    ],
    applications: ["SaaS platforms", "AI backends", "data platforms", "migration plans", "production deployments"],
    bestFor: ["Cloud deployment planning", "Architecture reviews", "Managed-service selection"],
    avoidWhen: ["A local-only app or static site has no cloud architecture need"],
    instructions: [
      "Prefer managed services when they reduce operational burden without hiding critical constraints.",
      "Document assumptions about traffic, regions, data sensitivity, and budget.",
      "Keep architecture recommendations tied to the current app shape."
    ],
    artifactTemplates: ["architecture.md", "deployment-plan.md", "infra-diagram.md"],
    sources: ["cncf-2025", "stackoverflow-2025"]
  },
  {
    id: "appsec-secure-code-review",
    name: "Application Security and Secure Code Review",
    category: "security",
    horizon: "evergreen",
    demand: "high",
    tags: ["appsec", "security", "secure code review", "owasp", "vulnerability", "threat model", "secrets"],
    aliases: ["security review", "threat modeling", "vulnerability review"],
    summary: "Reviews and hardens application code against common vulnerabilities, unsafe data flows, weak authorization, secret exposure, and injection risks.",
    capabilities: [
      "Threat modeling for user flows and data boundaries",
      "Injection, auth, access control, XSS, CSRF, and SSRF review",
      "Secret handling, dependency risk, and secure configuration",
      "Practical remediation plans with residual risk notes"
    ],
    applications: ["protected APIs", "multi-user apps", "payment or admin workflows", "deployment reviews", "security bug fixes"],
    bestFor: ["Security-sensitive changes", "Code reviews", "Authentication and authorization features"],
    avoidWhen: ["The request is purely aesthetic and has no data or execution boundary"],
    instructions: [
      "Lead with concrete exploitable risks and affected files.",
      "Distinguish must-fix vulnerabilities from defense-in-depth improvements.",
      "Avoid exposing secrets while explaining security findings."
    ],
    artifactTemplates: ["security-review.md", "threat-model.md", "remediation-plan.md"],
    sources: ["stackoverflow-2025"]
  },
  {
    id: "data-engineering-pipelines",
    name: "Data Engineering Pipelines",
    category: "data",
    horizon: "present-future",
    demand: "high",
    tags: ["data engineering", "etl", "elt", "pipeline", "warehouse", "airflow", "dbt", "spark"],
    aliases: ["data pipeline", "analytics engineering", "warehouse pipeline"],
    summary: "Builds reliable data pipelines with extraction, transformation, validation, orchestration, warehouse modeling, and monitoring.",
    capabilities: [
      "ETL and ELT workflow design",
      "Batch jobs, scheduling, orchestration, and retries",
      "Warehouse models, transformations, and data quality checks",
      "Pipeline observability, lineage, and backfill planning"
    ],
    applications: ["analytics platforms", "reporting systems", "business intelligence", "event processing", "data migrations"],
    bestFor: ["Data movement and transformation", "Analytics workflows", "Operational reporting pipelines"],
    avoidWhen: ["The task is a single frontend chart with already-prepared data"],
    instructions: [
      "Define source, destination, freshness, and quality expectations.",
      "Make jobs idempotent or document backfill behavior.",
      "Validate data before it reaches user-facing reports."
    ],
    artifactTemplates: ["pipeline.py", "models/*.sql", "data-quality.md"],
    sources: ["stackoverflow-2025", "github-octoverse-2025"]
  },
  {
    id: "mlops-model-deployment",
    name: "MLOps and Model Deployment",
    category: "ai",
    horizon: "future-facing",
    demand: "high",
    tags: ["mlops", "machine learning", "model deployment", "inference", "monitoring", "ml", "ai"],
    aliases: ["model serving", "ml deployment", "inference service"],
    summary: "Deploys and operates machine learning models with inference APIs, experiment tracking, monitoring, versioning, and rollback-aware release flows.",
    capabilities: [
      "Model packaging and inference API design",
      "Experiment tracking and artifact versioning",
      "Latency, drift, quality, and cost monitoring",
      "Batch and online inference deployment tradeoffs"
    ],
    applications: ["prediction APIs", "AI services", "recommendation systems", "model-backed products", "analytics automation"],
    bestFor: ["Models that need production deployment", "Inference service design", "ML reliability and monitoring"],
    avoidWhen: ["The user only needs exploratory analysis or a one-off notebook"],
    instructions: [
      "Separate training, evaluation, and serving concerns.",
      "Track model version, data assumptions, and rollout criteria.",
      "Plan monitoring for quality drift and operational failures."
    ],
    artifactTemplates: ["serve.py", "model-card.md", "deployment.yaml"],
    sources: ["github-fastest-growing-tools", "cncf-2025", "stackoverflow-2025"]
  },
  {
    id: "browser-automation-scraping",
    name: "Browser Automation and Web Scraping",
    category: "automation",
    horizon: "present",
    demand: "medium-high",
    tags: ["browser automation", "scraping", "playwright", "puppeteer", "crawler", "automation", "testing"],
    aliases: ["web scraping", "browser bot", "crawler"],
    summary: "Automates browser workflows and data extraction with resilient selectors, pagination handling, waits, exports, and respectful scraping constraints.",
    capabilities: [
      "Playwright and Puppeteer navigation, clicks, forms, and screenshots",
      "Robust selectors, waits, retries, and pagination loops",
      "HTML parsing, data extraction, and CSV or JSON export",
      "Rate limiting, login boundaries, and robots-aware constraints"
    ],
    applications: ["workflow automation", "QA scripts", "data extraction", "site monitoring", "visual checks"],
    bestFor: ["Repetitive browser tasks", "Scraping public pages", "End-to-end workflow automation"],
    avoidWhen: ["The target site forbids automation or an official API is available and sufficient"],
    instructions: [
      "Use official APIs before scraping when practical.",
      "Prefer stable semantic selectors over brittle visual positions.",
      "Respect rate limits, access rules, and sensitive account boundaries."
    ],
    artifactTemplates: ["scrape.js", "automation.spec.ts", "output.csv"],
    sources: ["stackoverflow-2025", "github-octoverse-2025"]
  },
  {
    id: "game-canvas-threejs",
    name: "Game UI, Canvas, and Three.js",
    category: "frontend",
    horizon: "present",
    demand: "medium",
    tags: ["game", "canvas", "three.js", "webgl", "animation", "physics", "interactive"],
    aliases: ["browser game", "threejs", "canvas game"],
    summary: "Creates interactive browser games and simulations with canvas or Three.js scenes, game loops, input handling, assets, and responsive controls.",
    capabilities: [
      "Game loop, input, collision, scoring, and state transitions",
      "Canvas rendering and sprite-style 2D interfaces",
      "Three.js scenes, cameras, lights, materials, and controls",
      "Responsive HUDs, restart states, and visual verification"
    ],
    applications: ["browser games", "3D demos", "interactive simulations", "visual tools", "playable prototypes"],
    bestFor: ["Games or immersive interactive experiences", "3D web scenes", "Canvas-based tools"],
    avoidWhen: ["The user needs a conventional product UI or static page"],
    instructions: [
      "Use a proven game, physics, or 3D library for established mechanics when appropriate.",
      "Keep the primary play area stable and responsive.",
      "Verify canvas or WebGL output is nonblank and correctly framed."
    ],
    artifactTemplates: ["game.js", "index.html", "scene.ts"],
    sources: ["github-octoverse-2025", "stackoverflow-2025"]
  },
  {
    id: "serverless-edge-functions",
    name: "Serverless and Edge Functions",
    category: "backend",
    horizon: "future-facing",
    demand: "medium-high",
    tags: ["serverless", "edge", "lambda", "functions", "workers", "api routes"],
    aliases: ["cloud functions", "edge runtime", "lambda"],
    summary: "Builds small backend endpoints and automation tasks with scalable function runtimes and simple deployment models.",
    capabilities: [
      "Function handlers and API routes",
      "Stateless execution and cold-start awareness",
      "Webhook and scheduled job patterns",
      "Environment variable and secret boundaries"
    ],
    applications: ["webhooks", "forms", "API adapters", "scheduled jobs", "edge personalization"],
    bestFor: ["Small isolated backend tasks", "Jamstack apps", "Scale-to-zero workloads"],
    avoidWhen: ["Long-running processes or persistent connections are needed"],
    instructions: [
      "Keep functions stateless and bounded in runtime.",
      "Document provider-specific constraints.",
      "Avoid storing secrets in client bundles."
    ],
    artifactTemplates: ["api/route.ts", "functions/*.js", "worker.ts"],
    sources: ["github-octoverse-2025", "stackoverflow-2025"]
  },
  {
    id: "web-components-standards",
    name: "Web Components and Browser Standards",
    category: "frontend",
    horizon: "evergreen",
    demand: "medium",
    tags: ["web components", "custom elements", "shadow dom", "vanilla js", "standards"],
    aliases: ["custom elements", "browser native components"],
    summary: "Uses browser-native component APIs for reusable widgets that can work across frameworks or in framework-free projects.",
    capabilities: [
      "Custom elements and lifecycle callbacks",
      "Shadow DOM encapsulation",
      "Template and slot composition",
      "Framework-agnostic component delivery"
    ],
    applications: ["design systems", "embeddable widgets", "cross-framework components", "legacy integration"],
    bestFor: ["Reusable widgets across stacks", "Framework-independent UI", "Embedding in existing pages"],
    avoidWhen: ["The host app already has a strong React/Vue/Svelte component system and no cross-framework need"],
    instructions: [
      "Keep public attributes and events documented.",
      "Avoid overusing Shadow DOM when global styles are required.",
      "Expose accessible names and keyboard behavior."
    ],
    artifactTemplates: ["my-widget.js", "index.html", "styles.css"],
    sources: ["github-octoverse-2025"]
  },
  {
    id: "legacy-lamp-jquery",
    name: "Legacy LAMP, PHP, and jQuery Maintenance",
    category: "historical",
    horizon: "historically-useful",
    demand: "medium",
    tags: ["php", "jquery", "lamp", "legacy", "mysql", "wordpress", "maintenance"],
    aliases: ["legacy web", "old website", "classic php"],
    summary: "Maintains historically common web stacks, modernizes safely, and avoids breaking older production sites.",
    capabilities: [
      "PHP and MySQL maintenance patterns",
      "jQuery event handling and DOM updates",
      "Progressive modernization plans",
      "Security patches for older forms and admin flows"
    ],
    applications: ["legacy websites", "CMS maintenance", "small business sites", "migration planning"],
    bestFor: ["Existing PHP/jQuery/LAMP codebases", "Legacy bug fixes", "Incremental modernization"],
    avoidWhen: ["A greenfield app can use a modern framework"],
    instructions: [
      "Preserve behavior before refactoring.",
      "Patch security issues first.",
      "Recommend modernization in small, testable steps."
    ],
    artifactTemplates: ["index.php", "script.js", "migration-plan.md"],
    sources: ["stackoverflow-2025"]
  }
];

const CODING_INTENT_WORDS = [
  "build", "create", "make", "code", "implement", "fix", "debug", "website", "app", "api", "backend",
  "frontend", "component", "database", "deploy", "test", "docker", "kubernetes", "react", "node",
  "python", "html", "css", "javascript", "typescript", "server", "dashboard", "artifact", "file",
  "tailwind", "vue", "nuxt", "svelte", "sveltekit", "pwa", "mobile", "graphql", "prisma", "orm",
  "mongodb", "firestore", "dynamodb", "websocket", "streaming", "observability", "automation",
  "pandas", "prompt", "evals", "angular", "rxjs", "golang", "grpc", "java", "spring", "dotnet",
  "c#", "rust", "wasm", "laravel", "terraform", "iac", "cloud", "aws", "azure", "gcp",
  "appsec", "security", "etl", "elt", "pipeline", "warehouse", "mlops", "ml", "scraping",
  "puppeteer", "game", "canvas", "three.js"
];

function normalize(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsTerm(text, term) {
  const normalizedTerm = normalize(term);
  if (!normalizedTerm) return false;
  if (normalizedTerm.includes(" ")) return text.includes(normalizedTerm);
  return new RegExp(`(^|\\s)${escapeRegExp(normalizedTerm)}(?=\\s|$)`).test(text);
}

function hasCodingIntent(query) {
  const q = normalize(query);
  return CODING_INTENT_WORDS.some(word => containsTerm(q, word));
}

function scoreSkill(skill, query) {
  const q = normalize(query);
  const haystackParts = [
    skill.name,
    skill.category,
    skill.horizon,
    skill.summary,
    ...(skill.tags || []),
    ...(skill.aliases || []),
    ...(skill.capabilities || []),
    ...(skill.applications || []),
    ...(skill.bestFor || [])
  ].map(normalize);

  let score = 0;
  const exactBoosts = [...(skill.tags || []), ...(skill.aliases || [])];
  for (const term of exactBoosts) {
    const t = normalize(term);
    if (t && containsTerm(q, t)) score += Math.min(8, Math.max(3, t.split(" ").length * 2));
  }

  const tokens = q.split(/\s+/).filter(t => t.length > 2);
  for (const token of tokens) {
    for (const part of haystackParts) {
      if (part.includes(token)) {
        score += 1;
        break;
      }
    }
  }

  if (skill.demand === "very high") score += 1.5;
  if (skill.demand === "high") score += 1;
  if (skill.horizon === "future-facing" || skill.horizon === "present-future") score += 0.75;

  return score;
}

function selectSkills(query, options = {}) {
  if (!hasCodingIntent(query)) return [];
  const limit = Math.max(1, Math.min(Number(options.limit) || 4, 8));
  const scored = SKILL_REPOSITORY
    .map(skill => ({ ...skill, score: scoreSkill(skill, query) }))
    .filter(skill => skill.score >= (Number(options.minScore) || 4))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return scored.slice(0, limit);
}

function buildSkillContext(skills) {
  if (!skills || !skills.length) return "";
  const sourceMap = new Map(SKILL_SOURCES.map(source => [source.id, source]));
  const lines = [
    "SKILL SET REPOSITORY CONTEXT",
    "Use these selected skill sets as optional working guidance. Choose the parts that match the user's request; ignore anything irrelevant.",
    "When producing code artifacts, output each file in this exact format so the UI can render it as an artifact:",
    "### filename.ext",
    "```language",
    "<complete file content>",
    "```",
    "Keep the filename on the heading line by itself and include complete, downloadable file contents inside the fence.",
    "Prefer complete, runnable files over fragments when the user asks to build or scaffold something.",
    ""
  ];

  skills.forEach((skill, index) => {
    const sources = (skill.sources || [])
      .map(id => sourceMap.get(id))
      .filter(Boolean)
      .map(source => `${source.title}: ${source.url}`)
      .join("; ");
    lines.push(`${index + 1}. ${skill.name} [${skill.category}; ${skill.horizon}; demand: ${skill.demand}]`);
    lines.push(`Summary: ${skill.summary}`);
    lines.push(`Capabilities: ${(skill.capabilities || []).join("; ")}`);
    lines.push(`Best for: ${(skill.bestFor || []).join("; ")}`);
    lines.push(`Implementation guidance: ${(skill.instructions || []).join(" ")}`);
    lines.push(`Typical artifacts: ${(skill.artifactTemplates || []).join(", ")}`);
    if (sources) lines.push(`Research sources: ${sources}`);
    lines.push("");
  });

  return lines.join("\n");
}

function publicSkill(skill) {
  const { score, ...rest } = skill;
  return rest;
}

module.exports = {
  SKILL_REPOSITORY,
  SKILL_SOURCES,
  selectSkills,
  buildSkillContext,
  publicSkill
};
