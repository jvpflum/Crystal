import { invoke } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";

export interface StoredSettings {
  model: string;
  wakeWord: string;
  ttsVoice: string;
  theme: string;
  windowAlwaysOnTop: boolean;
}

export interface StoredConversation {
  id: string;
  title: string;
  messages: Array<{
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface StoredData {
  settings: StoredSettings;
  conversations: StoredConversation[];
  installedSkills: string[];
  customTemplates: string[];
}

const DEFAULT_SETTINGS: StoredSettings = {
  model: "gpt-oss:20b",
  wakeWord: "hey crystal",
  ttsVoice: "nova",
  theme: "glass-dark",
  windowAlwaysOnTop: false,
};

const DEFAULT_DATA: StoredData = {
  settings: DEFAULT_SETTINGS,
  conversations: [],
  installedSkills: ["github-assistant", "code-runner"],
  customTemplates: [],
};

class StorageService {
  private dataPath: string | null = null;
  private data: StoredData = { ...DEFAULT_DATA };
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const appDir = await appDataDir();
      this.dataPath = `${appDir}crystal-data.json`;
      await this.load();
      this.initialized = true;
    } catch (error) {
      console.error("Failed to initialize storage:", error);
      this.data = { ...DEFAULT_DATA };
      this.initialized = true;
    }
  }

  private async load(): Promise<void> {
    if (!this.dataPath) return;

    try {
      const content = await invoke<string>("read_file", { path: this.dataPath });
      this.data = JSON.parse(content);
    } catch {
      this.data = { ...DEFAULT_DATA };
      await this.save();
    }
  }

  private async save(): Promise<void> {
    if (!this.dataPath) return;

    try {
      await invoke("write_file", {
        path: this.dataPath,
        content: JSON.stringify(this.data, null, 2),
      });
    } catch (error) {
      console.error("Failed to save storage:", error);
    }
  }

  getSettings(): StoredSettings {
    return { ...this.data.settings };
  }

  async updateSettings(settings: Partial<StoredSettings>): Promise<void> {
    this.data.settings = { ...this.data.settings, ...settings };
    await this.save();
  }

  getConversations(): StoredConversation[] {
    return [...this.data.conversations];
  }

  async addConversation(conversation: StoredConversation): Promise<void> {
    this.data.conversations.push(conversation);
    await this.save();
  }

  async updateConversation(id: string, updates: Partial<StoredConversation>): Promise<void> {
    const index = this.data.conversations.findIndex((c) => c.id === id);
    if (index >= 0) {
      this.data.conversations[index] = { ...this.data.conversations[index], ...updates };
      await this.save();
    }
  }

  async deleteConversation(id: string): Promise<void> {
    this.data.conversations = this.data.conversations.filter((c) => c.id !== id);
    await this.save();
  }

  getInstalledSkills(): string[] {
    return [...this.data.installedSkills];
  }

  async installSkill(skillId: string): Promise<void> {
    if (!this.data.installedSkills.includes(skillId)) {
      this.data.installedSkills.push(skillId);
      await this.save();
    }
  }

  async uninstallSkill(skillId: string): Promise<void> {
    this.data.installedSkills = this.data.installedSkills.filter((s) => s !== skillId);
    await this.save();
  }

  isSkillInstalled(skillId: string): boolean {
    return this.data.installedSkills.includes(skillId);
  }

  getCustomTemplates(): string[] {
    return [...this.data.customTemplates];
  }

  async addCustomTemplate(templateJson: string): Promise<void> {
    this.data.customTemplates.push(templateJson);
    await this.save();
  }

  async removeCustomTemplate(index: number): Promise<void> {
    this.data.customTemplates.splice(index, 1);
    await this.save();
  }
}

export const storageService = new StorageService();
