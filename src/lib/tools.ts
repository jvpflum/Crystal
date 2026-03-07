import { invoke } from "@tauri-apps/api/core";

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  category: "filesystem" | "shell" | "web" | "memory";
  enabled: boolean;
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

export async function executeShell(command: string, cwd?: string): Promise<ToolResult> {
  try {
    const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
      command,
      cwd: cwd || ".",
    });
    
    return {
      success: result.code === 0,
      output: result.stdout || result.stderr,
      error: result.code !== 0 ? result.stderr : undefined,
    };
  } catch (error) {
    return {
      success: false,
      output: "",
      error: error instanceof Error ? error.message : "Command execution failed",
    };
  }
}

export async function readFile(path: string): Promise<ToolResult> {
  try {
    const content = await invoke<string>("read_file", { path });
    return {
      success: true,
      output: content,
    };
  } catch (error) {
    return {
      success: false,
      output: "",
      error: error instanceof Error ? error.message : "Failed to read file",
    };
  }
}

export async function writeFile(path: string, content: string): Promise<ToolResult> {
  try {
    await invoke("write_file", { path, content });
    const verifyExists = await invoke<string>("read_file", { path }).catch(() => null);
    return {
      success: true,
      output: `File written successfully: ${path}${verifyExists !== null ? " (verified)" : ""}`,
    };
  } catch (error) {
    return {
      success: false,
      output: "",
      error: error instanceof Error ? error.message : "Failed to write file",
    };
  }
}

export async function listDirectory(path: string): Promise<ToolResult> {
  try {
    const entries = await invoke<string[]>("list_directory", { path });
    return {
      success: true,
      output: entries.join("\n"),
    };
  } catch (error) {
    return {
      success: false,
      output: "",
      error: error instanceof Error ? error.message : "Failed to list directory",
    };
  }
}

export async function webSearch(query: string): Promise<ToolResult> {
  try {
    const response = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`);
    const data = await response.json();
    return {
      success: true,
      output: JSON.stringify(data.RelatedTopics?.slice(0, 5) || [], null, 2),
    };
  } catch (error) {
    return {
      success: false,
      output: "",
      error: error instanceof Error ? error.message : "Search failed",
    };
  }
}

export async function webFetch(url: string): Promise<ToolResult> {
  try {
    const response = await fetch(url);
    const text = await response.text();
    return {
      success: true,
      output: text.slice(0, 10000),
    };
  } catch (error) {
    return {
      success: false,
      output: "",
      error: error instanceof Error ? error.message : "Fetch failed",
    };
  }
}

export const availableTools: Tool[] = [
  {
    name: "shell",
    description: "Execute shell commands",
    category: "shell",
    enabled: true,
    execute: async (params) => executeShell(params.command as string, params.cwd as string | undefined),
  },
  {
    name: "read_file",
    description: "Read contents of a file",
    category: "filesystem",
    enabled: true,
    execute: async (params) => readFile(params.path as string),
  },
  {
    name: "write_file",
    description: "Write content to a file",
    category: "filesystem",
    enabled: true,
    execute: async (params) => writeFile(params.path as string, params.content as string),
  },
  {
    name: "list_directory",
    description: "List files in a directory",
    category: "filesystem",
    enabled: true,
    execute: async (params) => listDirectory(params.path as string),
  },
  {
    name: "web_search",
    description: "Search the web for information",
    category: "web",
    enabled: true,
    execute: async (params) => webSearch(params.query as string),
  },
  {
    name: "web_fetch",
    description: "Fetch content from a URL",
    category: "web",
    enabled: true,
    execute: async (params) => webFetch(params.url as string),
  },
];

export function getToolByName(name: string): Tool | undefined {
  return availableTools.find((t) => t.name === name);
}

export function getEnabledTools(): Tool[] {
  return availableTools.filter((t) => t.enabled);
}
