window.__LANDING_LEXICON__ = {
  "defaultLocale": "en",
  "locales": {
    "en": {
      "meta": {
        "title": "ClaudeChrome | Embed Agent Intelligence Into the Browser",
        "description": "ClaudeChrome is a browser extension that embeds Claude Code, Codex, and Shell sessions into Chrome, giving agents native page context for web capture, JavaScript execution, visual style adaptation, knowledge-base ingestion, email summarization, and other long-running interactive tasks."
      },
      "header": {
        "brand": {
          "name": "ClaudeChrome",
          "tagline": "General-purpose intelligent browser interaction",
          "ariaLabel": "ClaudeChrome home"
        },
        "navToggleAriaLabel": "Toggle navigation",
        "navAriaLabel": "Primary navigation",
        "navItems": [
          {
            "label": "Intro",
            "subLabel": "overview"
          },
          {
            "label": "Product",
            "subLabel": "side panel"
          },
          {
            "label": "Use Cases",
            "subLabel": "workflows"
          },
          {
            "label": "Workflows",
            "subLabel": "daily loops"
          },
          {
            "label": "Demos",
            "subLabel": "recordings"
          },
          {
            "label": "FAQ",
            "subLabel": "questions"
          }
        ],
        "languageSwitchLabel": "中文",
        "repoLink": {
          "label": "GitHub",
          "subLabel": "Repo"
        }
      },
      "hero": {
        "brand": {
          "name": "ClaudeChrome",
          "logoAlt": "ClaudeChrome logo",
          "tagline": "A browser-native agent extension for Chrome today, with support for more major browsers and additional agent CLIs ahead."
        },
        "eyebrow": {
          "primary": "ClaudeChrome",
          "secondary": "Embed agent intelligence into the browser"
        },
        "title": "Native browser context awareness for agents.",
        "body": "ClaudeChrome is a browser extension that embeds Claude Code, Codex, and Shell sessions into Chrome, giving agents native page context for web capture, JavaScript execution, visual style adaptation, knowledge-base ingestion, email summarization, and other long-running interactive tasks.",
        "actions": {
          "primary": "See the demos first",
          "secondary": "Explore the product value"
        },
        "copyBlocks": [
          {
            "title": "Not built for one narrow use case or demo.",
            "body": "You no longer need a separate browser agent plugin for every task. The agent CLI you already configure locally can handle browser-native work as naturally as it runs on your own machine."
          },
          {
            "title": "The browser-native foundation for agent capabilities.",
            "body": "Web capture, forum understanding with JS execution, style adaptation, Tapestry ingestion, selected-text actions, and continuous visual interaction all sit on the same browser-native foundation. The use cases are diverse; the general capabilities are ready to be explored."
          }
        ],
        "commandLabel": {
          "title": "Fast local setup",
          "subtitle": ""
        },
        "commandTerminal": {
          "tablistAriaLabel": "ClaudeChrome command groups",
          "copyButtonAriaLabel": "Copy active command",
          "copyLabel": "Copy",
          "copiedLabel": "Copied",
          "tabs": [
            {
              "key": "setup",
              "label": "setup",
              "clipboard": "npm run setup",
              "display": "npm run setup"
            },
            {
              "key": "build",
              "label": "build",
              "clipboard": "npm run build && npm run build:host",
              "display": "npm run build && npm run build:host"
            },
            {
              "key": "host",
              "label": "host",
              "clipboard": "cd native-host && npm run start",
              "display": "cd native-host && npm run start"
            }
          ]
        },
        "metrics": [
          {
            "title": "Browser-native intelligence",
            "subtitle": "Keep agents inside the live page context",
            "body": "Sessions work from the real tab instead of from copied notes, screenshots, or detached terminal summaries."
          },
          {
            "title": "Crawling and JS",
            "subtitle": "Move across pages and interact while fully executing user intent",
            "body": "It can crawl pages, read forum threads, and execute JavaScript according to the user's goal."
          },
          {
            "title": "Native style adaptation",
            "subtitle": "Use existing sites as design references",
            "body": "ClaudeChrome can inspect a live surface and help derive native styling more accurately than manual stylesheet copying."
          },
          {
            "title": "Knowledge ingestion",
            "subtitle": "Move page content straight into downstream systems",
            "body": "The Tapestry demo shows that browser-native workflows can plug directly into knowledge bases and content-processing pipelines."
          }
        ]
      },
      "stage": {
        "eyebrow": {
          "primary": "Live operator view",
          "secondary": "One extension, many browser-native agent tasks"
        },
        "title": "One live browser surface, many kinds of agent work.",
        "body": "ClaudeChrome appears as a side-panel extension, but its real capability comes from the runtime behind it: agent sessions stay attached to the live tab so web capture, JavaScript execution, visual style translation, content ingestion, and interaction all happen in the same browser context.",
        "browserFrameAriaLabel": "Illustration: ClaudeChrome side panel investigating a checkout flow",
        "browserAddress": "https://app.example.dev/checkout",
        "browserState": "investigating live flow",
        "pageRibbon": "What the framework can handle in the browser today",
        "pageCards": [
          {
            "label": "Crawling",
            "title": "Move across pages while keeping the same task context",
            "body": "Useful for long-reading sites, forum threads, and commercial surfaces where scrolling and transitions matter."
          },
          {
            "label": "Forum actions",
            "title": "Inspect content and execute JavaScript on live threads",
            "body": "The framework can stay inside a forum page and respond directly to page-specific operator instructions."
          },
          {
            "label": "Style mimicry",
            "title": "Use the live site as the design reference surface",
            "body": "Native adaptation becomes easier when the agent can inspect the page it is trying to echo."
          },
          {
            "label": "Knowledge intake",
            "title": "Push page content and selected text into downstream systems",
            "body": "Browser-native agent work can become part of larger ingestion and knowledge workflows, not only a debugging loop."
          }
        ],
        "statusPill": "Framework active",
        "toolbarActions": [
          "+ Workspace",
          "+ Claude",
          "+ Codex"
        ],
        "workspaces": [
          {
            "title": "Forum intelligence",
            "subtitle": "2 panes · crawl + JS"
          },
          {
            "title": "Style adaptation",
            "subtitle": "1 pane · native design pass"
          }
        ],
        "panes": [
          {
            "badge": "Claude",
            "binding": "Bound to forum thread · #42",
            "command": "browser__evaluate_js",
            "output": "Thread content captured and JavaScript executed without leaving the active page."
          },
          {
            "badge": "Codex",
            "binding": "Bound to reference site",
            "command": "browser__get_page_html",
            "output": "Live structure and styling cues captured for native adaptation work."
          }
        ],
        "notes": [
          {
            "label": "Framework",
            "title": "One browser runtime can support many agent behaviors.",
            "body": "The demos differ on the surface, but they all rely on the same live-tab attachment model underneath."
          },
          {
            "label": "Breadth",
            "title": "The same foundation supports crawling, style work, ingestion, and interaction loops.",
            "body": "ClaudeChrome should be understood as a general browser-native agent framework, not only as a debugger for broken pages."
          },
          {
            "label": "Operator control",
            "title": "Humans still choose the page, the task, and the moment to act.",
            "body": "The browser stays visible, the operator keeps the context, and the agent works beside that reality instead of replacing it."
          }
        ]
      },
      "useCases": {
        "eyebrow": {
          "primary": "Real-world use cases",
          "secondary": "Real problems, solved in the browser"
        },
        "title": "What the framework already proves.",
        "body": "These demos show that ClaudeChrome is not just an extension built for one purpose. It is a general browser-native agent framework.",
        "cards": [
          {
            "index": "01",
            "label": "Commercial crawling",
            "title": "Traverse real sites while keeping context across scrolling and navigation.",
            "body": "Treat the browser as a constantly changing task surface, not a read-only snapshot."
          },
          {
            "index": "02",
            "label": "Forum summaries",
            "title": "Read community threads and stay grounded in the current page.",
            "body": "Work directly on forum pages without moving thread content into the terminal first."
          },
          {
            "index": "03",
            "label": "JavaScript execution",
            "title": "Let the agent execute dynamic instructions inside the current page.",
            "body": "The same session can both capture content and execute JavaScript inside the page."
          },
          {
            "index": "04",
            "label": "Native style adaptation",
            "title": "Study a live site and turn its language into native design work.",
            "body": "Useful for design and interface generation tasks, and markedly better than natural-language description or stylesheet excerpts."
          },
          {
            "index": "05",
            "label": "Knowledge ingestion",
            "title": "Capture page content and selected text into downstream systems.",
            "body": "Agent sessions in the browser can connect directly to knowledge-base pipelines."
          },
          {
            "index": "06",
            "label": "Interactive environments",
            "title": "Sustain longer visual interaction loops when the page behaves like an app or game.",
            "body": "Handle continuous visual interaction, not just read-and-report tasks."
          }
        ]
      },
      "visualReserve": {
        "eyebrow": {
          "primary": "Proof-ready media",
          "secondary": "Reserve visual slots for product proof, not generic decoration"
        },
        "title": "Make future screenshots tell real product stories.",
        "body": "These slots are reserved so the page can absorb authentic product media later: real UI captures, operator walkthroughs, and `.cast` recordings anchored in practical workflows.",
        "shots": [
          {
            "badge": "Hero screenshot",
            "title": "Full browser window with the side panel in action",
            "body": "Show the product in the exact setting where it matters: a real app page, a real pane, and a visible investigation context.",
            "pathLabel": "Suggested path",
            "path": "src/ui/assets/claudechrome-hero.png"
          },
          {
            "badge": "Use-case screenshot",
            "title": "Pane workflow around a real issue",
            "body": "Capture a high-value scenario such as checkout debugging, SSO reproduction, or onboarding validation.",
            "pathLabel": "Suggested path",
            "path": "src/ui/assets/claudechrome-workflow.png"
          },
          {
            "badge": "Before / after proof",
            "title": "Visual story of a problem, investigation, and fix",
            "body": "Use this slot for a compact, buyer-friendly proof asset instead of a system architecture diagram.",
            "pathLabel": "Suggested path",
            "path": "src/ui/assets/claudechrome-proof.png"
          }
        ]
      },
      "workflows": {
        "eyebrow": {
          "primary": "Common workflows",
          "secondary": "Compose capabilities into reusable systems"
        },
        "title": "Design browser-native workflows by combining capabilities, not by collecting isolated tricks.",
        "body": "Unlike the use-case section above, this layer is about workflow design itself: how teams combine grounding, capture, execution, adaptation, and handoff into reusable operating patterns.",
        "cards": [
          {
            "label": "Capability composition",
            "title": "Treat grounding, reading, acting, and extraction as modular building blocks.",
            "body": "A workflow can begin with page awareness, add selective capture, branch into action, and finish with export or handoff without leaving the same bound session."
          },
          {
            "label": "Workflow compilation",
            "title": "Compile recurring browser tasks into stable operator-ready flows.",
            "body": "Instead of prompting from scratch every time, teams can shape repeated investigation, capture, or execution patterns into durable multi-step workflows."
          },
          {
            "label": "Human checkpoints",
            "title": "Keep operator decisions as explicit gates inside longer browser flows.",
            "body": "People still decide when to inspect, intervene, approve, or redirect, while the agent carries the routine work between those checkpoints."
          },
          {
            "label": "Concept design",
            "title": "Design workflows around combined capabilities before choosing a concrete target page.",
            "body": "The same runtime primitives can be composed at the concept level first, then applied to community threads, SaaS dashboards, internal tools, or interactive surfaces."
          },
          {
            "label": "Cross-system handoff",
            "title": "Move from browser context to downstream tools as one compiled pipeline.",
            "body": "Knowledge ingestion, notes, exports, and later-stage actions can be planned as continuation steps of the same workflow rather than as separate disconnected tools."
          },
          {
            "label": "Runtime orchestration",
            "title": "Use one browser-attached runtime to host multiple panes, roles, or phases of work.",
            "body": "A single workflow can split into observation, execution, summarization, and review roles while staying anchored to the same live surface."
          }
        ]
      },
      "demos": {
        "eyebrow": {
          "primary": "See it in action",
          "secondary": "Real workflows, recorded live"
        },
        "title": "Real browser-aware use cases.",
        "body": "These six demos cover the product's most important real capabilities: web capture, JavaScript execution, native style adaptation, direct Tapestry integration, selected-text actions, and continuous visual interaction inside browser games.",
        "cards": [
          {
            "shellTitle": "2048 gameplay",
            "label": "2048 demo",
            "title": "Drive continuous visual interaction inside a live game tab.",
            "body": "This demo focuses on ClaudeChrome's ability to stay in a long-running interaction loop with visual elements inside a 2048 game, rather than stopping at one-shot inspection steps.",
            "lines": [
              "Track board state visually",
              "Drive repeated moves",
              "Keep the interaction loop alive"
            ],
            "media": {
              "src": "./assets/demo/promo_mp4/demo%202048_promo.mp4",
              "type": "video/mp4",
              "ariaLabel": "ClaudeChrome demo video showing a 2048 workflow"
            }
          },
          {
            "shellTitle": "Amazon product-detail capture",
            "label": "Amazon demo",
            "title": "Crawl a real commercial page across transitions and scrolling.",
            "body": "This demo primarily showcases ClaudeChrome's web crawling capabilities, including interaction with page transitions and scrolling while the session stays attached to the active browser tab.",
            "lines": [
              "Traverse page transitions",
              "Scroll while keeping context",
              "Continue crawling in one session"
            ],
            "media": {
              "src": "./assets/demo/promo_mp4/demo%20amazon_promo.mp4",
              "type": "video/mp4",
              "ariaLabel": "ClaudeChrome demo video showing an Amazon investigation workflow"
            }
          },
          {
            "shellTitle": "Forum topic summary (LINUX DO)",
            "label": "LINUX DO demo",
            "title": "Crawl forum content and execute JavaScript on demand.",
            "body": "This demo shows how ClaudeChrome summarizes LINUX DO community content and executes JavaScript commands based on user instructions.",
            "lines": [
              "Capture forum topic content",
              "Execute JS from user instructions",
              "Stay attached to the active page"
            ],
            "media": {
              "src": "./assets/demo/promo_mp4/demo%20linuxdo_promo.mp4",
              "type": "video/mp4",
              "ariaLabel": "ClaudeChrome demo video showing a LINUX DO workflow"
            }
          },
          {
            "shellTitle": "OpenClaw showcase style adaptation",
            "label": "OpenClaw demo",
            "title": "Mimic an existing site to build matching native styles.",
            "body": "This demo highlights ClaudeChrome's browser extension capabilities: it can inspect and mimic existing websites to design similar styles natively, which is more convenient and more accurate than manually copying stylesheets.",
            "lines": [
              "Inspect the live site surface",
              "Derive native styling cues",
              "Avoid manual stylesheet copying"
            ],
            "media": {
              "src": "./assets/demo/promo_mp4/demo%20openclaw_promo.mp4",
              "type": "video/mp4",
              "ariaLabel": "ClaudeChrome demo video showing an OpenClaw workflow"
            }
          },
          {
            "shellTitle": "Knowledge-base ingestion and text selection",
            "label": "Tapestry & text selection demo",
            "title": "Send page content straight into Tapestry and act on selected text.",
            "body": "This demo focuses on the integration with the earlier Tapestry project: page content is ingested directly into the knowledge base without calling Tapestry's built-in crawlers, and the same flow also shows actions triggered from selected text on the page.",
            "lines": [
              "Ingest page content directly",
              "Skip built-in crawlers",
              "Act on selected text"
            ],
            "media": {
              "src": "./assets/demo/promo_mp4/demo%20tapestry%20%26%20texts%20selection_promo.mp4",
              "type": "video/mp4",
              "ariaLabel": "ClaudeChrome demo video showing a Tapestry text selection workflow"
            }
          },
          {
            "shellTitle": "Forum topic summary (V2EX)",
            "label": "V2EX demo",
            "title": "Run forum crawling and JavaScript commands on a V2EX page.",
            "body": "This demo shows ClaudeChrome capturing forum content on V2EX and executing JavaScript commands based on user requests.",
            "lines": [
              "Crawl the V2EX thread",
              "Execute JS on request",
              "Keep the session on the same page"
            ],
            "media": {
              "src": "./assets/demo/promo_mp4/demo%20v2ex_promo.mp4",
              "type": "video/mp4",
              "ariaLabel": "ClaudeChrome demo video showing a V2EX workflow"
            }
          }
        ]
      },
      "teams": {
        "eyebrow": {
          "primary": "Who benefits most",
          "secondary": "Built for the people closest to the browser"
        },
        "title": "Who this framework is really for.",
        "body": "ClaudeChrome is most valuable for people who want agents to work from the real browser surface, not from a secondhand narration of it.",
        "cards": [
          {
            "label": "Agent-tool builders",
            "title": "Use the browser itself as a runtime surface for richer agent behavior.",
            "body": "ClaudeChrome is useful if you are designing systems where the browser should become part of the agent’s working environment."
          },
          {
            "label": "Frontend and design teams",
            "title": "Reference live interfaces before adapting them into native work.",
            "body": "OpenClaw-style workflows benefit from having the agent inspect the real site instead of inferring style from memory or copied CSS fragments."
          },
          {
            "label": "Knowledge and research teams",
            "title": "Capture live page content directly into downstream knowledge systems.",
            "body": "Tapestry-style ingestion becomes simpler when page content and selected text can flow out of the browser without an extra crawl step."
          },
          {
            "label": "Community and ops teams",
            "title": "Read forum content and execute page-side instructions on the same surface.",
            "body": "The forum demos show that the framework also fits community workflows, not just product sites."
          },
          {
            "label": "QA and workflow owners",
            "title": "Keep browser tasks, evidence, and actions in one operator surface.",
            "body": "Validation still matters here, but it becomes one member of a larger family of browser-native agent tasks."
          },
          {
            "label": "Power users and solo builders",
            "title": "Compose multi-pane browser agent workflows without tool sprawl.",
            "body": "If one person needs crawling, page understanding, interaction, and synthesis in one loop, ClaudeChrome gives that loop a coherent surface."
          }
        ]
      },
      "faq": {
        "eyebrow": {
          "primary": "Operator FAQ",
          "secondary": "Start with what users are most likely to ask"
        },
        "title": "What people will ask before they try it.",
        "items": [
          {
            "question": "Is ClaudeChrome only a web debugging tool?",
            "answer": "No. Debugging is one visible use case, but the framework is broader: the demos already show crawling, JavaScript execution, native style adaptation, Tapestry ingestion, selected-text actions, and continuous interaction in a game."
          },
          {
            "question": "Why put agent intelligence inside the browser instead of next to it?",
            "answer": "Because the hard part is not simply opening both tools. The value comes from grounding the agent in the live page so reading, acting, and reasoning all happen against the same browser reality."
          },
          {
            "question": "Is Chrome the final target platform?",
            "answer": "Chrome is the current implementation target, but the product direction is broader: ClaudeChrome is meant to become a general framework for bringing agent intelligence into mainstream browsers."
          },
          {
            "question": "What kinds of tasks does the framework already support?",
            "answer": "Today the demos cover commercial-site crawling, forum intelligence, JavaScript execution, style mimicry, direct knowledge-base ingestion, selected-text actions, and longer interactive loops in a game surface."
          }
        ]
      },
      "finalCta": {
        "eyebrow": {
          "primary": "Get started",
          "secondary": "Open source, runs locally, up in minutes"
        },
        "title": "Real use creates more value than demos or descriptions ever will.",
        "body": "If you believe agent capabilities should reach the browser through native context, ClaudeChrome is worth trying.",
        "primaryButtonLabel": "Review the use cases",
        "repoButtonLabel": "Open the GitHub repo"
      },
      "footer": {
        "tagline": "ClaudeChrome · A browser-native framework that brings general-purpose agent capabilities into Chrome, covering web capture, JavaScript execution, style adaptation, knowledge ingestion, and interactive workflows.",
        "links": [
          {
            "label": "Intro"
          },
          {
            "label": "Product"
          },
          {
            "label": "Use Cases"
          },
          {
            "label": "Workflows"
          },
          {
            "label": "Demos"
          },
          {
            "label": "LINUX DO",
            "href": "https://linux.do",
            "external": true
          }
        ],
        "repoLabel": "GitHub Repo"
      }
    },
    "zh-CN": {
      "meta": {
        "title": "ClaudeChrome | 将智能体能力嵌入浏览器",
        "description": "ClaudeChrome 的形式是一个浏览器扩展：它把 Claude Code、Codex 和 Shell 会话植入 Chrome，使智能体立足于原生页面上下文完成网页抓取、JavaScript 执行、视觉风格拟合、知识库摄取、邮件总结等长链路交互任务。"
      },
      "header": {
        "brand": {
          "name": "ClaudeChrome",
          "tagline": "实现通用智能浏览器交互体验",
          "ariaLabel": "ClaudeChrome 首页"
        },
        "navToggleAriaLabel": "切换导航",
        "navAriaLabel": "主导航",
        "navItems": [
          {
            "label": "简介",
            "subLabel": "overview"
          },
          {
            "label": "产品",
            "subLabel": "side panel"
          },
          {
            "label": "使用场景",
            "subLabel": "workflows"
          },
          {
            "label": "工作流",
            "subLabel": "daily loops"
          },
          {
            "label": "演示",
            "subLabel": "recordings"
          },
          {
            "label": "常见问题",
            "subLabel": "questions"
          }
        ],
        "languageSwitchLabel": "EN",
        "repoLink": {
          "label": "GitHub",
          "subLabel": "Repo"
        }
      },
      "hero": {
        "brand": {
          "name": "ClaudeChrome",
          "logoAlt": "ClaudeChrome logo",
          "tagline": "面向 Chrome 的浏览器原生智能体扩展，未来会支持更多主流浏览器和其他 Agent CLI。"
        },
        "eyebrow": {
          "primary": "ClaudeChrome",
          "secondary": "将智能体能力嵌入浏览器"
        },
        "title": "智能体的原生浏览器上下文感知",
        "body": "ClaudeChrome 的形式是一个浏览器扩展：它把 Claude Code、Codex 和 Shell 会话植入 Chrome，使智能体立足于原生页面上下文完成网页抓取、JavaScript 执行、视觉风格拟合、知识库摄取、邮件总结等长链路交互任务。",
        "actions": {
          "primary": "先看演示",
          "secondary": "了解项目价值"
        },
        "copyBlocks": [
          {
            "title": "它不是为单一目的和演示设计。",
            "body": "从此告别各种浏览器 Agent 插件，你本地配置的 Agent CLI 即可完成一切浏览器内任务，就像在本地运行一样。"
          },
          {
            "title": "它是浏览器原生的智能体能力底座。",
            "body": "网页爬取、论坛理解与 JS 执行、风格拟合、Tapestry 摄取、选中文本动作，以及持续的视觉交互。多样化的应用场景，只待通用能力发掘。"
          }
        ],
        "commandLabel": {
          "title": "快速本地安装",
          "subtitle": ""
        },
        "commandTerminal": {
          "tablistAriaLabel": "ClaudeChrome command groups",
          "copyButtonAriaLabel": "Copy active command",
          "copyLabel": "复制",
          "copiedLabel": "Copied",
          "tabs": [
            {
              "key": "setup",
              "label": "setup",
              "clipboard": "npm run setup",
              "display": "npm run setup"
            },
            {
              "key": "build",
              "label": "build",
              "clipboard": "npm run build && npm run build:host",
              "display": "npm run build && npm run build:host"
            },
            {
              "key": "host",
              "label": "host",
              "clipboard": "cd native-host && npm run start",
              "display": "cd native-host && npm run start"
            }
          ]
        },
        "metrics": [
          {
            "title": "浏览器原生智能体",
            "subtitle": "让会话直接立足于真实页面上下文",
            "body": "智能体工作基于真实标签页，而不是基于截图、复制文本或终端里的转述。"
          },
          {
            "title": "爬取与 JS",
            "subtitle": "跨页面移动和交互，充分执行用户侧意图",
            "body": "既能爬页面，也能读论坛线程，还能根据用户目的执行 JavaScript。"
          },
          {
            "title": "原生风格拟合",
            "subtitle": "把现有网站作为设计参考面",
            "body": "当智能体能够直接检查真实页面时，做原生风格设计会比手动抄样式表更准确。"
          },
          {
            "title": "知识摄取",
            "subtitle": "把页面内容直接送进下游系统",
            "body": "Tapestry 演示说明，浏览器原生工作流可以直接接入知识库和内容处理链路。"
          }
        ]
      },
      "stage": {
        "eyebrow": {
          "primary": "实时操作视图",
          "secondary": "一个扩展，承载多种浏览器原生智能体任务"
        },
        "title": "同一个浏览器表面，可以承载很多种智能体工作。",
        "body": "ClaudeChrome 的视觉形态是浏览器侧边栏扩展，真正的能力来自它背后的运行框架：将智能体会话附着在真实标签页上，让网页爬取、JavaScript 执行、设计风格转录、内容摄取与交互都在同一个浏览器上下文里完成。",
        "browserFrameAriaLabel": "示意图：ClaudeChrome 侧边栏正在调查结账流程",
        "browserAddress": "https://app.example.dev/checkout",
        "browserState": "调查实时流程",
        "pageRibbon": "这个框架现在已经能处理的浏览器任务",
        "pageCards": [
          {
            "label": "网页爬取",
            "title": "在页面跳转和滚动中持续保留任务上下文",
            "body": "适合商品页、长内容页面、论坛线程，以及任何需要跨视图移动的浏览器任务。"
          },
          {
            "label": "论坛动作",
            "title": "读取帖子内容，并在页面内部执行 JS 指令",
            "body": "论坛演示说明，同一会话既能理解内容，也能根据用户要求直接在页面上操作。"
          },
          {
            "label": "风格拟合",
            "title": "直接把真实网站作为原生设计参考面",
            "body": "当智能体可以直接看见目标网站，原生界面设计的参考过程就会更自然、更准确。"
          },
          {
            "label": "知识摄取",
            "title": "把页面内容和选中文本送进下游系统",
            "body": "浏览器里的智能体流程不必停留在阅读层面，还可以成为更大知识工作流的一部分。"
          }
        ],
        "statusPill": "框架在线",
        "toolbarActions": [
          "+ 工作区",
          "+ Claude",
          "+ Codex"
        ],
        "workspaces": [
          {
            "title": "论坛智能",
            "subtitle": "2 个面板 · 爬取 + JS"
          },
          {
            "title": "风格拟合",
            "subtitle": "1 个面板 · 原生设计任务"
          }
        ],
        "panes": [
          {
            "badge": "Claude",
            "binding": "绑定到论坛线程 · #42",
            "command": "browser__evaluate_js",
            "output": "论坛内容已抓取，JavaScript 已在当前帖子页面内执行。"
          },
          {
            "badge": "Codex",
            "binding": "绑定到参考站点",
            "command": "browser__get_page_html",
            "output": "已捕获页面结构与风格线索，可直接用于原生界面拟合。"
          }
        ],
        "notes": [
          {
            "label": "框架",
            "title": "同一套浏览器运行时可以承载很多种智能体行为。",
            "body": "不同演示看起来像不同产品，但它们底层都依赖同一个“附着在真实标签页”的会话模型。"
          },
          {
            "label": "广度",
            "title": "它覆盖的不只是调试，而是一整类浏览器原生任务。",
            "body": "网页爬取、论坛理解、风格拟合、知识摄取、交互循环，都可以建立在同一套框架之上。"
          },
          {
            "label": "控制权",
            "title": "人仍然决定页面、任务和何时执行动作。",
            "body": "浏览器保持可见，操作者保留上下文，智能体是在这个真实表面旁边工作，而不是替代它。"
          }
        ]
      },
      "useCases": {
        "eyebrow": {
          "primary": "真实使用场景",
          "secondary": "真实问题，在浏览器中解决"
        },
        "title": "这个框架已经证明了什么。",
        "body": "从这些演示可以看到，ClaudeChrome 的价值并不只是面向单一目的设计的扩展，而是浏览器原生的通用智能体框架。",
        "cards": [
          {
            "index": "01",
            "label": "商业站点爬取",
            "title": "在滚动与跳转中持续爬取真实站点。",
            "body": "把浏览器视为一个持续变化的任务表面，而不是只读快照。"
          },
          {
            "index": "02",
            "label": "论坛总结",
            "title": "在社区帖子里读取内容、保持上下文。",
            "body": "直接面向论坛页面工作，而不需要把线程内容先搬到终端里。"
          },
          {
            "index": "03",
            "label": "JavaScript 执行",
            "title": "让智能体在当前页面内按要求执行动态指令。",
            "body": "同一个会话既能爬取内容，也能执行页面内部的 JavaScript。"
          },
          {
            "index": "04",
            "label": "原生风格拟合",
            "title": "参考真实网站，把设计翻译成原生界面工作。",
            "body": "适合设计与界面生成类任务，显著优于自然语言描述或样式表摘抄。"
          },
          {
            "index": "05",
            "label": "知识摄取",
            "title": "把页面内容和选中文本直接纳入知识工作流。",
            "body": "浏览器里的智能体会话可以直接接入知识库处理链路。"
          },
          {
            "index": "06",
            "label": "交互型环境",
            "title": "在游戏或类应用页面中维持长时间交互循环。",
            "body": "处理持续性的视觉交互，而不只是“读取后汇报”。"
          }
        ]
      },
      "visualReserve": {
        "eyebrow": {
          "primary": "Proof-ready media",
          "secondary": "Reserve visual slots for product proof, not generic decoration"
        },
        "title": "Make future screenshots tell real product stories.",
        "body": "These slots are reserved so the page can absorb authentic product media later: real UI captures, operator walkthroughs, and `.cast` recordings anchored in practical workflows.",
        "shots": [
          {
            "badge": "Hero screenshot",
            "title": "Full browser window with the side panel in action",
            "body": "Show the product in the exact setting where it matters: a real app page, a real pane, and a visible investigation context.",
            "pathLabel": "Suggested path",
            "path": "src/ui/assets/claudechrome-hero.png"
          },
          {
            "badge": "Use-case screenshot",
            "title": "Pane workflow around a real issue",
            "body": "Capture a high-value scenario such as checkout debugging, SSO reproduction, or onboarding validation.",
            "pathLabel": "Suggested path",
            "path": "src/ui/assets/claudechrome-workflow.png"
          },
          {
            "badge": "Before / after proof",
            "title": "Visual story of a problem, investigation, and fix",
            "body": "Use this slot for a compact, buyer-friendly proof asset instead of a system architecture diagram.",
            "pathLabel": "Suggested path",
            "path": "src/ui/assets/claudechrome-proof.png"
          }
        ]
      },
      "workflows": {
        "eyebrow": {
          "primary": "常见工作流",
          "secondary": "把能力编排成可复用工作流"
        },
        "title": "把浏览器原生能力组合成工作流，而不是堆叠零散技巧。",
        "body": "和前面的“真实使用场景”不同，这一层更关注工作流设计本身：团队如何把附着、读取、执行、拟合、摄取与交接编排成可复用模式。",
        "cards": [
          {
            "label": "能力组合",
            "title": "把附着、读取、执行、抽取视为可拼装的基础模块。",
            "body": "一个工作流可以从页面感知开始，接入内容抽取，再延伸到执行与导出，全程不脱离同一个绑定会话。"
          },
          {
            "label": "工作流编译",
            "title": "把重复出现的浏览器任务编译成可稳定复用的流程。",
            "body": "与其每次从零提示，不如把常见调查、抓取或操作任务沉淀成固定的多步工作流。"
          },
          {
            "label": "人工检查点",
            "title": "把人的判断保留为长链路浏览器流程中的明确关口。",
            "body": "智能体负责推进重复步骤，操作者负责检查、批准、介入和改道，两者在同一个流程中协同。"
          },
          {
            "label": "概念设计",
            "title": "先按组合能力设计工作流，再落到具体页面和场景。",
            "body": "同一套运行时原语可以先在概念层完成编排，再应用到论坛、SaaS 面板、内部系统或交互页面。"
          },
          {
            "label": "跨系统交接",
            "title": "把浏览器上下文与下游工具连接成同一条已编排管线。",
            "body": "知识库摄取、记录、导出与后续动作都可以被设计为同一工作流的连续阶段，而不是分散的独立工具。"
          },
          {
            "label": "运行时编排",
            "title": "在一个浏览器附着运行时里容纳多个面板、角色或阶段。",
            "body": "同一条工作流可以拆分为观察、执行、总结、复核等分工，同时始终锚定在同一实时页面。"
          }
        ]
      },
      "demos": {
        "eyebrow": {
          "primary": "实际演示",
          "secondary": "真实工作流，实时录制"
        },
        "title": "真正的浏览器感知使用场景。",
        "body": "这六段演示覆盖了产品最关键的真实能力：网页爬取、JavaScript 执行、原生风格拟合、直接接入 Tapestry、选中文本动作，以及在页面游戏里的持续视觉交互。",
        "cards": [
          {
            "shellTitle": "2048 游戏操作",
            "label": "2048 演示",
            "title": "在实时游戏标签页里持续驱动复杂视觉交互。",
            "body": "这个演示聚焦 ClaudeChrome 在 2048 游戏环境中的持续交互能力：它不会停在一次性读取，而是能围绕视觉元素持续进行长链路操作。",
            "lines": [
              "视觉跟踪棋盘状态",
              "持续执行多步操作",
              "保持交互循环不断开"
            ],
            "media": {
              "src": "./assets/demo/promo_mp4/demo%202048_promo.mp4",
              "type": "video/mp4",
              "ariaLabel": "ClaudeChrome 演示视频：2048 工作流"
            }
          },
          {
            "shellTitle": "Amazon 商品详情收集",
            "label": "Amazon 演示",
            "title": "在真实商业页面中跨跳转与滚动完成爬取。",
            "body": "这个演示主要展示 ClaudeChrome 的网页爬取能力，包括处理页面跳转和滚动交互的能力，同时会话始终保持绑定在当前浏览器标签页上。",
            "lines": [
              "跨页面跳转继续爬取",
              "滚动时保持上下文连续",
              "在同一会话中完成调查"
            ],
            "media": {
              "src": "./assets/demo/promo_mp4/demo%20amazon_promo.mp4",
              "type": "video/mp4",
              "ariaLabel": "ClaudeChrome 演示视频：Amazon 调查工作流"
            }
          },
          {
            "shellTitle": "论坛话题总结 (LINUX DO)",
            "label": "LINUX DO 演示",
            "title": "爬取论坛内容，并按用户指令执行 JavaScript。",
            "body": "这个演示展示了 ClaudeChrome 如何总结 LINUX DO 社区内容，并根据用户指令执行 JavaScript 命令。",
            "lines": [
              "爬取论坛话题内容",
              "按指令执行 JS",
              "保持会话附着在当前帖子"
            ],
            "media": {
              "src": "./assets/demo/promo_mp4/demo%20linuxdo_promo.mp4",
              "type": "video/mp4",
              "ariaLabel": "ClaudeChrome 演示视频：LINUX DO 工作流"
            }
          },
          {
            "shellTitle": "OpenClaw 展示页风格拟合",
            "label": "OpenClaw 演示",
            "title": "拟合现有网站风格，直接做出接近原站的原生设计。",
            "body": "这个演示突出 ClaudeChrome 的浏览器扩展能力：它可以模仿现有网站来原生设计相似风格，比传统的手动拷贝样式表更方便，也更准确。",
            "lines": [
              "检查页面现有风格",
              "提取原生设计线索",
              "避免手动复制样式表"
            ],
            "media": {
              "src": "./assets/demo/promo_mp4/demo%20openclaw_promo.mp4",
              "type": "video/mp4",
              "ariaLabel": "ClaudeChrome 演示视频：OpenClaw 工作流"
            }
          },
          {
            "shellTitle": "知识库摄取与文本选中",
            "label": "Tapestry & 文本选择演示",
            "title": "直接把页面内容送进 Tapestry，并围绕选中文本执行动作。",
            "body": "这个演示聚焦于与之前 Tapestry 项目的集成：不调用 Tapestry 自带爬虫，也能把页面内容直接写入知识库，同时展示基于页面选中文本触发动作的能力。",
            "lines": [
              "直接摄取页面内容",
              "跳过内置爬虫",
              "围绕选中文本执行动作"
            ],
            "media": {
              "src": "./assets/demo/promo_mp4/demo%20tapestry%20%26%20texts%20selection_promo.mp4",
              "type": "video/mp4",
              "ariaLabel": "ClaudeChrome 演示视频：Tapestry 文本选择工作流"
            }
          },
          {
            "shellTitle": "论坛话题总结 (V2EX)",
            "label": "V2EX 演示",
            "title": "在 V2EX 页面中执行论坛爬取与 JavaScript 指令。",
            "body": "这个演示展示了 ClaudeChrome 在 V2EX 页面中爬取论坛内容，并根据用户要求执行 JavaScript 命令的能力。",
            "lines": [
              "爬取 V2EX 帖子内容",
              "按请求执行 JS",
              "让会话始终停留在同一页面"
            ],
            "media": {
              "src": "./assets/demo/promo_mp4/demo%20v2ex_promo.mp4",
              "type": "video/mp4",
              "ariaLabel": "ClaudeChrome 演示视频：V2EX 工作流"
            }
          }
        ]
      },
      "teams": {
        "eyebrow": {
          "primary": "最受益的用户",
          "secondary": "为最贴近浏览器的人而生"
        },
        "title": "这套框架真正适合谁。",
        "body": "凡是希望智能体直接工作在真实浏览器表面，而不是工作在浏览器的转述版本上的人，都会从 ClaudeChrome 中受益。",
        "cards": [
          {
            "label": "智能体工具构建者",
            "title": "把浏览器本身当成更丰富的智能体运行表面。",
            "body": "如果你在设计一类需要浏览器上下文的智能体系统，ClaudeChrome 可以成为实际的工作底座。"
          },
          {
            "label": "前端与设计团队",
            "title": "先观察真实界面，再做原生风格适配。",
            "body": "像 OpenClaw 这样的任务，直接参考真实页面，比记忆或摘抄 CSS 更自然。"
          },
          {
            "label": "知识与研究团队",
            "title": "把页面内容直接纳入下游知识系统。",
            "body": "Tapestry 路径说明，浏览器里的智能体工作流可以直接成为知识摄取的一环。"
          },
          {
            "label": "社区与运营团队",
            "title": "在论坛页面中读取内容并执行页面侧动作。",
            "body": "论坛演示说明，这套框架同样适合社区场景，而不只是产品站点。"
          },
          {
            "label": "QA 与流程负责人",
            "title": "把浏览器任务、证据和动作留在同一个操作表面。",
            "body": "验证仍然重要，但在这里它只是更大浏览器原生任务集合中的一种。"
          },
          {
            "label": "独立开发者与高阶用户",
            "title": "在一个工作面里组织多种浏览器智能体任务。",
            "body": "如果你需要把爬取、理解、执行和整合放进同一条工作链，ClaudeChrome 会更有价值。"
          }
        ]
      },
      "faq": {
        "eyebrow": {
          "primary": "常见问题",
          "secondary": "先回答用户可能最关心的问题"
        },
        "title": "在真正尝试之前，大家最会问什么。",
        "items": [
          {
            "question": "ClaudeChrome 只是一个网页调试工具吗？",
            "answer": "不是。调试只是最容易被看见的一层价值。从演示可以看到，它同样覆盖网页爬取、JavaScript 执行、原生风格拟合、Tapestry 摄取、选中文本动作和持续交互。"
          },
          {
            "question": "为什么要把智能体能力放进浏览器，而不是放在浏览器旁边？",
            "answer": "关键不只是同时打开两个工具，而是让智能体真正立足于当前页面。这样读取、执行和推理都围绕同一个浏览器现实展开。"
          },
          {
            "question": "Chrome 会是最终平台边界吗？",
            "answer": "Chrome 是当前实现落点，但产品方向更大：ClaudeChrome 旨在逐步扩展成一套面向主流浏览器的智能体框架。"
          },
          {
            "question": "这套框架今天已经适合什么任务？",
            "answer": "目前演示已经覆盖商业站点爬取、论坛理解、JavaScript 执行、原生风格拟合、知识库摄取、选中文本动作和游戏中的持续视觉交互。"
          }
        ]
      },
      "finalCta": {
        "eyebrow": {
          "primary": "立即开始",
          "secondary": "开源、本地运行、几分钟即可上手"
        },
        "title": "真实使用，远比演示和陈述更能创造实际价值。",
        "body": "如果你认同“智能体能力应该借由原生上下文引入浏览器”，那 ClaudeChrome 值得你体验。",
        "primaryButtonLabel": "查看使用场景",
        "repoButtonLabel": "Open the GitHub repo"
      },
      "footer": {
        "tagline": "ClaudeChrome · 一套把通用智能体能力引入 Chrome 的浏览器原生框架，覆盖网页爬取、JavaScript 执行、风格拟合、知识摄取与交互工作流。",
        "links": [
          {
            "label": "简介"
          },
          {
            "label": "产品"
          },
          {
            "label": "使用场景"
          },
          {
            "label": "工作流"
          },
          {
            "label": "演示"
          },
          {
            "label": "LINUX DO",
            "href": "https://linux.do",
            "external": true
          }
        ],
        "repoLabel": "GitHub Repo"
      }
    }
  }
};
