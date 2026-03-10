import { useEffect } from "react";
import { register, unregister, ShortcutEvent } from "@tauri-apps/plugin-global-shortcut";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useGlobalShortcut(shortcut: string, callback: () => void) {
  useEffect(() => {
    let isRegistered = false;

    const registerShortcut = async () => {
      try {
        await register(shortcut, async (event: ShortcutEvent) => {
          if (event.state === "Pressed") {
            callback();
          }
        });
        isRegistered = true;
        if (import.meta.env.DEV) console.log(`Global shortcut registered: ${shortcut}`);
      } catch (error) {
        console.error(`Failed to register global shortcut: ${error}`);
      }
    };

    registerShortcut();

    return () => {
      if (isRegistered) {
        unregister(shortcut).catch(console.error);
      }
    };
  }, [shortcut, callback]);
}

export function useToggleWindowShortcut() {
  useGlobalShortcut("CommandOrControl+Space", async () => {
    const window = getCurrentWindow();
    const isVisible = await window.isVisible();
    
    if (isVisible) {
      await window.hide();
    } else {
      await window.show();
      await window.setFocus();
    }
  });
}

export function useActivateVoiceShortcut(onActivate: () => void) {
  useGlobalShortcut("CommandOrControl+Shift+M", onActivate);
}
