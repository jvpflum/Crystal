import { useEffect, useCallback, useRef } from "react";
import { register, unregister, ShortcutEvent } from "@tauri-apps/plugin-global-shortcut";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useGlobalShortcut(shortcut: string, callback: () => void) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    let disposed = false;

    const registerShortcut = async () => {
      try {
        await register(shortcut, async (event: ShortcutEvent) => {
          if (event.state === "Pressed") {
            callbackRef.current();
          }
        });
        if (disposed) {
          unregister(shortcut).catch(console.error);
          return;
        }
        if (import.meta.env.DEV) console.log(`Global shortcut registered: ${shortcut}`);
      } catch (error) {
        console.error(`Failed to register global shortcut: ${error}`);
      }
    };

    registerShortcut();

    return () => {
      disposed = true;
      unregister(shortcut).catch(console.error);
    };
  }, [shortcut]);
}

export function useToggleWindowShortcut() {
  const toggle = useCallback(async () => {
    try {
      const window = getCurrentWindow();
      const isVisible = await window.isVisible();
      if (isVisible) {
        await window.hide();
      } else {
        await window.show();
        await window.setFocus();
      }
    } catch (err) {
      console.error("[useToggleWindowShortcut]", err);
    }
  }, []);

  useGlobalShortcut("CommandOrControl+Space", toggle);
}

export function useActivateVoiceShortcut(onActivate: () => void) {
  useGlobalShortcut("CommandOrControl+Shift+M", onActivate);
}
