import { useState, useEffect, useCallback } from "react";
import { storageService, StoredSettings } from "@/lib/storage";

export function useStorage() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [settings, setSettings] = useState<StoredSettings | null>(null);

  useEffect(() => {
    const init = async () => {
      await storageService.initialize();
      setSettings(storageService.getSettings());
      setIsInitialized(true);
    };
    init();
  }, []);

  const updateSettings = useCallback(async (updates: Partial<StoredSettings>) => {
    await storageService.updateSettings(updates);
    setSettings(storageService.getSettings());
  }, []);

  return {
    isInitialized,
    settings,
    updateSettings,
    getConversations: storageService.getConversations.bind(storageService),
    addConversation: storageService.addConversation.bind(storageService),
    deleteConversation: storageService.deleteConversation.bind(storageService),
    getInstalledSkills: storageService.getInstalledSkills.bind(storageService),
    installSkill: storageService.installSkill.bind(storageService),
    uninstallSkill: storageService.uninstallSkill.bind(storageService),
    isSkillInstalled: storageService.isSkillInstalled.bind(storageService),
  };
}
