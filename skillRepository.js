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
  "python", "html", "css", "javascript", "typescript", "server", "dashboard", "artifact", "file"
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
