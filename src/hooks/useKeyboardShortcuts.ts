import { useEffect } from "react";
import { useAppStore, type AppView } from "@/stores/appStore";

const NUM_KEY_VIEWS: AppView[] = [
  "home",
  "conversation",
  "agents",
  "tools",
  "models",
  "sessions",
  "memory",
  "settings",
  "activity",
];

export function useKeyboardShortcuts() {
  const setView = useAppStore((s) => s.setView);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.shiftKey && e.key.toUpperCase() === "D") {
        e.preventDefault();
        setView("doctor");
        return;
      }

      if (ctrl && e.shiftKey && e.key.toUpperCase() === "S") {
        e.preventDefault();
        setView("security");
        return;
      }

      if (ctrl && e.key === ",") {
        e.preventDefault();
        setView("settings");
        return;
      }

      if (ctrl && e.key.toUpperCase() === "N" && !e.shiftKey) {
        e.preventDefault();
        setView("conversation");
        return;
      }

      if (ctrl && !e.shiftKey) {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= 9) {
          e.preventDefault();
          setView(NUM_KEY_VIEWS[num - 1]);
          return;
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [setView]);
}
