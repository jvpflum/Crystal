export interface Skill {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  category: string;
  tags: string[];
  stars: number;
  downloads: number;
  icon: string;
  installed: boolean;
  repository?: string;
}

export interface SkillCategory {
  id: string;
  name: string;
  icon: string;
  count: number;
}

const FEATURED_SKILLS: Skill[] = [
  {
    id: "gmail-manager",
    name: "Gmail Manager",
    description: "Read, compose, and manage Gmail emails with natural language",
    author: "openclaw",
    version: "1.2.0",
    category: "productivity",
    tags: ["email", "gmail", "communication"],
    stars: 842,
    downloads: 15200,
    icon: "📧",
    installed: false,
    repository: "https://github.com/openclaw/gmail-skill",
  },
  {
    id: "calendar-sync",
    name: "Calendar Sync",
    description: "Manage Google Calendar, schedule meetings, and set reminders",
    author: "openclaw",
    version: "2.0.1",
    category: "productivity",
    tags: ["calendar", "scheduling", "reminders"],
    stars: 723,
    downloads: 12800,
    icon: "📅",
    installed: false,
  },
  {
    id: "github-assistant",
    name: "GitHub Assistant",
    description: "Create PRs, manage issues, review code, and automate workflows",
    author: "devtools",
    version: "3.1.0",
    category: "development",
    tags: ["github", "git", "code-review", "automation"],
    stars: 1250,
    downloads: 28400,
    icon: "🐙",
    installed: true,
  },
  {
    id: "notion-integration",
    name: "Notion Integration",
    description: "Create pages, manage databases, and organize your Notion workspace",
    author: "productivity-hub",
    version: "1.5.2",
    category: "productivity",
    tags: ["notion", "notes", "databases"],
    stars: 567,
    downloads: 9800,
    icon: "📝",
    installed: false,
  },
  {
    id: "slack-connector",
    name: "Slack Connector",
    description: "Send messages, manage channels, and automate Slack workflows",
    author: "openclaw",
    version: "2.3.0",
    category: "communication",
    tags: ["slack", "messaging", "teams"],
    stars: 445,
    downloads: 7600,
    icon: "💬",
    installed: false,
  },
  {
    id: "code-runner",
    name: "Code Runner",
    description: "Execute Python, JavaScript, and shell scripts safely",
    author: "devtools",
    version: "1.8.0",
    category: "development",
    tags: ["code", "execution", "python", "javascript"],
    stars: 892,
    downloads: 19500,
    icon: "▶️",
    installed: true,
  },
  {
    id: "web-scraper",
    name: "Web Scraper",
    description: "Extract data from websites with intelligent parsing",
    author: "data-tools",
    version: "2.1.0",
    category: "data",
    tags: ["scraping", "web", "data-extraction"],
    stars: 634,
    downloads: 11200,
    icon: "🕷️",
    installed: false,
  },
  {
    id: "file-organizer",
    name: "File Organizer",
    description: "Automatically organize files based on content and patterns",
    author: "productivity-hub",
    version: "1.3.0",
    category: "utilities",
    tags: ["files", "organization", "automation"],
    stars: 389,
    downloads: 6400,
    icon: "📁",
    installed: false,
  },
  {
    id: "image-generator",
    name: "Image Generator",
    description: "Generate images using local Stable Diffusion models",
    author: "creative-ai",
    version: "1.0.0",
    category: "creative",
    tags: ["images", "ai", "stable-diffusion"],
    stars: 1100,
    downloads: 22000,
    icon: "🎨",
    installed: false,
  },
  {
    id: "pdf-processor",
    name: "PDF Processor",
    description: "Extract text, merge, split, and analyze PDF documents",
    author: "doc-tools",
    version: "1.4.0",
    category: "utilities",
    tags: ["pdf", "documents", "extraction"],
    stars: 456,
    downloads: 8900,
    icon: "📄",
    installed: false,
  },
];

const CATEGORIES: SkillCategory[] = [
  { id: "all", name: "All", icon: "🏠", count: FEATURED_SKILLS.length },
  { id: "productivity", name: "Productivity", icon: "⚡", count: 3 },
  { id: "development", name: "Development", icon: "💻", count: 2 },
  { id: "communication", name: "Communication", icon: "💬", count: 1 },
  { id: "data", name: "Data", icon: "📊", count: 1 },
  { id: "utilities", name: "Utilities", icon: "🔧", count: 2 },
  { id: "creative", name: "Creative", icon: "🎨", count: 1 },
];

class MarketplaceService {
  private installedSkills: Set<string> = new Set(["github-assistant", "code-runner"]);
  private skills: Skill[] = FEATURED_SKILLS;

  async getSkills(category?: string, search?: string): Promise<Skill[]> {
    let filtered = this.skills.map(s => ({
      ...s,
      installed: this.installedSkills.has(s.id)
    }));

    if (category && category !== "all") {
      filtered = filtered.filter(s => s.category === category);
    }

    if (search) {
      const query = search.toLowerCase();
      filtered = filtered.filter(s =>
        s.name.toLowerCase().includes(query) ||
        s.description.toLowerCase().includes(query) ||
        s.tags.some(t => t.includes(query))
      );
    }

    return filtered;
  }

  async getCategories(): Promise<SkillCategory[]> {
    return CATEGORIES;
  }

  async getInstalledSkills(): Promise<Skill[]> {
    return this.skills.filter(s => this.installedSkills.has(s.id));
  }

  async installSkill(skillId: string): Promise<boolean> {
    this.installedSkills.add(skillId);
    return true;
  }

  async uninstallSkill(skillId: string): Promise<boolean> {
    this.installedSkills.delete(skillId);
    return true;
  }

  async getSkillDetails(skillId: string): Promise<Skill | null> {
    return this.skills.find(s => s.id === skillId) || null;
  }

  isInstalled(skillId: string): boolean {
    return this.installedSkills.has(skillId);
  }
}

export const marketplaceService = new MarketplaceService();
