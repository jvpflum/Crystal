import { executeShell, readFile, writeFile } from "./tools";
import { openclawClient } from "./openclaw";

export interface TemplateStep {
  id: string;
  type: "llm" | "tool" | "condition" | "wait";
  name: string;
  config: Record<string, unknown>;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: "productivity" | "development" | "communication" | "custom";
  steps: TemplateStep[];
  variables: Record<string, string>;
  isBuiltIn: boolean;
}

export interface TemplateRun {
  templateId: string;
  status: "running" | "completed" | "failed" | "paused";
  currentStep: number;
  results: Record<string, unknown>;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

const BUILT_IN_TEMPLATES: Template[] = [
  {
    id: "morning-briefing",
    name: "Morning Briefing",
    description: "Get weather, calendar events, and top news",
    icon: "☀️",
    category: "productivity",
    isBuiltIn: true,
    variables: {
      location: "auto",
    },
    steps: [
      {
        id: "weather",
        type: "llm",
        name: "Get Weather Summary",
        config: {
          prompt: "Give me a brief weather summary for today. Keep it to 2-3 sentences.",
        },
      },
      {
        id: "tasks",
        type: "tool",
        name: "List Today's Tasks",
        config: {
          tool: "shell",
          command: "echo 'Tasks feature coming soon'",
        },
      },
      {
        id: "summary",
        type: "llm",
        name: "Create Briefing",
        config: {
          prompt: "Based on the weather and tasks, give me a motivating morning briefing in 3-4 sentences.",
        },
      },
    ],
  },
  {
    id: "git-status",
    name: "Git Status Report",
    description: "Check git status, recent commits, and branch info",
    icon: "📊",
    category: "development",
    isBuiltIn: true,
    variables: {
      repoPath: ".",
    },
    steps: [
      {
        id: "status",
        type: "tool",
        name: "Get Git Status",
        config: {
          tool: "shell",
          command: "git status --short",
        },
      },
      {
        id: "branch",
        type: "tool",
        name: "Get Current Branch",
        config: {
          tool: "shell",
          command: "git branch --show-current",
        },
      },
      {
        id: "commits",
        type: "tool",
        name: "Recent Commits",
        config: {
          tool: "shell",
          command: "git log --oneline -5",
        },
      },
      {
        id: "summary",
        type: "llm",
        name: "Summarize",
        config: {
          prompt: "Summarize the git status, current branch, and recent commits in a brief report.",
        },
      },
    ],
  },
  {
    id: "code-review-prep",
    name: "Code Review Prep",
    description: "Prepare a summary of changes for code review",
    icon: "🔍",
    category: "development",
    isBuiltIn: true,
    variables: {
      baseBranch: "main",
    },
    steps: [
      {
        id: "diff",
        type: "tool",
        name: "Get Diff Stats",
        config: {
          tool: "shell",
          command: "git diff --stat main",
        },
      },
      {
        id: "files",
        type: "tool",
        name: "Changed Files",
        config: {
          tool: "shell",
          command: "git diff --name-only main",
        },
      },
      {
        id: "analysis",
        type: "llm",
        name: "Analyze Changes",
        config: {
          prompt: "Based on the diff stats and changed files, provide a brief summary of what was changed and any areas that might need careful review.",
        },
      },
    ],
  },
  {
    id: "project-setup",
    name: "Quick Project Setup",
    description: "Initialize a new project with common files",
    icon: "🚀",
    category: "development",
    isBuiltIn: true,
    variables: {
      projectName: "my-project",
      projectType: "node",
    },
    steps: [
      {
        id: "init",
        type: "tool",
        name: "Create Directory",
        config: {
          tool: "shell",
          command: "mkdir -p {{projectName}}",
        },
      },
      {
        id: "git",
        type: "tool",
        name: "Initialize Git",
        config: {
          tool: "shell",
          command: "cd {{projectName}} && git init",
        },
      },
      {
        id: "readme",
        type: "llm",
        name: "Generate README",
        config: {
          prompt: "Generate a brief README.md for a new {{projectType}} project called {{projectName}}.",
        },
      },
    ],
  },
  {
    id: "daily-standup",
    name: "Daily Standup",
    description: "Generate standup notes from git activity",
    icon: "📝",
    category: "productivity",
    isBuiltIn: true,
    variables: {},
    steps: [
      {
        id: "yesterday",
        type: "tool",
        name: "Yesterday's Commits",
        config: {
          tool: "shell",
          command: "git log --since='yesterday' --oneline --author=$(git config user.email)",
        },
      },
      {
        id: "wip",
        type: "tool",
        name: "Work in Progress",
        config: {
          tool: "shell",
          command: "git status --short",
        },
      },
      {
        id: "standup",
        type: "llm",
        name: "Generate Standup",
        config: {
          prompt: "Based on yesterday's commits and current work in progress, generate a brief standup update with: 1) What I did yesterday, 2) What I'm working on today, 3) Any blockers (say none if unclear).",
        },
      },
    ],
  },
];

class TemplateService {
  private templates: Template[] = [...BUILT_IN_TEMPLATES];
  private customTemplates: Template[] = [];
  private currentRun: TemplateRun | null = null;
  private onProgress: ((step: number, total: number, output: string) => void) | null = null;

  getTemplates(): Template[] {
    return [...this.templates, ...this.customTemplates];
  }

  getTemplate(id: string): Template | undefined {
    return this.getTemplates().find((t) => t.id === id);
  }

  getBuiltInTemplates(): Template[] {
    return this.templates;
  }

  getCustomTemplates(): Template[] {
    return this.customTemplates;
  }

  onProgressCallback(callback: (step: number, total: number, output: string) => void) {
    this.onProgress = callback;
  }

  async runTemplate(
    templateId: string,
    variables: Record<string, string> = {}
  ): Promise<{ success: boolean; output: string; results: Record<string, unknown> }> {
    const template = this.getTemplate(templateId);
    if (!template) {
      return { success: false, output: "Template not found", results: {} };
    }

    const mergedVars = { ...template.variables, ...variables };
    const results: Record<string, unknown> = {};
    let finalOutput = "";

    this.currentRun = {
      templateId,
      status: "running",
      currentStep: 0,
      results: {},
      startedAt: new Date(),
    };

    try {
      for (let i = 0; i < template.steps.length; i++) {
        const step = template.steps[i];
        this.currentRun.currentStep = i;

        if (this.onProgress) {
          this.onProgress(i + 1, template.steps.length, `Running: ${step.name}`);
        }

        const stepResult = await this.executeStep(step, mergedVars, results);
        results[step.id] = stepResult;
        finalOutput = stepResult;
      }

      this.currentRun.status = "completed";
      this.currentRun.completedAt = new Date();
      this.currentRun.results = results;

      return { success: true, output: finalOutput, results };
    } catch (error) {
      this.currentRun.status = "failed";
      this.currentRun.error = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        output: this.currentRun.error,
        results,
      };
    }
  }

  private async executeStep(
    step: TemplateStep,
    variables: Record<string, string>,
    previousResults: Record<string, unknown>
  ): Promise<string> {
    const interpolate = (text: string): string => {
      let result = text;
      for (const [key, value] of Object.entries(variables)) {
        result = result.replace(new RegExp(`{{${key}}}`, "g"), value);
      }
      for (const [key, value] of Object.entries(previousResults)) {
        result = result.replace(new RegExp(`{{${key}}}`, "g"), String(value));
      }
      return result;
    };

    switch (step.type) {
      case "tool": {
        const toolName = step.config.tool as string;
        const command = interpolate(step.config.command as string);

        if (toolName === "shell") {
          const result = await executeShell(command);
          return result.success ? result.output : `Error: ${result.error}`;
        } else if (toolName === "read_file") {
          const result = await readFile(command);
          return result.success ? result.output : `Error: ${result.error}`;
        } else if (toolName === "write_file") {
          const content = interpolate(step.config.content as string);
          const result = await writeFile(command, content);
          return result.success ? result.output : `Error: ${result.error}`;
        }
        return "Unknown tool";
      }

      case "llm": {
        const prompt = interpolate(step.config.prompt as string);
        const context = Object.entries(previousResults)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n");

        const fullPrompt = context
          ? `Context:\n${context}\n\nTask: ${prompt}`
          : prompt;

        const response = await openclawClient.openclawChat(fullPrompt);
        return response;
      }

      case "wait": {
        const ms = step.config.duration as number;
        await new Promise((resolve) => setTimeout(resolve, ms));
        return `Waited ${ms}ms`;
      }

      case "condition": {
        return "Condition evaluation not implemented";
      }

      default:
        return "Unknown step type";
    }
  }

  getCurrentRun(): TemplateRun | null {
    return this.currentRun;
  }

  addCustomTemplate(template: Omit<Template, "isBuiltIn">): void {
    this.customTemplates.push({ ...template, isBuiltIn: false });
  }

  removeCustomTemplate(id: string): void {
    this.customTemplates = this.customTemplates.filter((t) => t.id !== id);
  }
}

export const templateService = new TemplateService();
