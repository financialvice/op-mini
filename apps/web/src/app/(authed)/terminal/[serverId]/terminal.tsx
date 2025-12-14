"use client";

import { flavors } from "@catppuccin/palette";
import {
  FitAddon,
  type ITheme,
  init as initGhostty,
  Terminal,
} from "ghostty-web";
import { useEffect, useRef, useState } from "react";

const frappe = flavors.frappe.colors;
const theme: ITheme = {
  background: frappe.base.hex,
  foreground: frappe.text.hex,
  cursor: frappe.rosewater.hex,
  cursorAccent: frappe.base.hex,
  selectionBackground: frappe.surface2.hex,
  black: frappe.surface1.hex,
  red: frappe.red.hex,
  green: frappe.green.hex,
  yellow: frappe.yellow.hex,
  blue: frappe.blue.hex,
  magenta: frappe.pink.hex,
  cyan: frappe.teal.hex,
  white: frappe.subtext1.hex,
  brightBlack: frappe.surface2.hex,
  brightRed: frappe.red.hex,
  brightGreen: frappe.green.hex,
  brightYellow: frappe.yellow.hex,
  brightBlue: frappe.blue.hex,
  brightMagenta: frappe.pink.hex,
  brightCyan: frappe.teal.hex,
  brightWhite: frappe.text.hex,
};

const BRIDGE_URL =
  process.env.NEXT_PUBLIC_TERMINAL_BRIDGE_URL ?? "ws://localhost:8787";
const INIT_COMPLETE_MARKER = "@@INIT_COMPLETE@@";

type FileToWrite = {
  path: string;
  content: string;
  mode?: string;
};

/** Wait for container to have dimensions before calling callback */
function waitForDimensions(
  container: HTMLDivElement,
  callback: () => void
): () => void {
  if (container.clientWidth > 0 && container.clientHeight > 0) {
    callback();
    // biome-ignore lint/suspicious/noEmptyBlockStatements: noop cleanup
    return () => {};
  }

  const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
      observer.disconnect();
      callback();
    }
  });
  observer.observe(container);
  return () => observer.disconnect();
}

export function TerminalComponent({
  machineId,
  provider,
  env,
  files,
}: {
  machineId: string;
  provider: string;
  env?: Record<string, string>;
  files?: FileToWrite[];
}) {
  const loadingRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);
  const [ghosttyReady, setGhosttyReady] = useState(false);

  // Separate terminal state from opening (fixes Next.js xterm dimensions bug)
  const [loadingTerm, setLoadingTerm] = useState<Terminal | null>(null);
  const [loadingFit, setLoadingFit] = useState<FitAddon | null>(null);
  const [mainTerm, setMainTerm] = useState<Terminal | null>(null);
  const [mainFit, setMainFit] = useState<FitAddon | null>(null);

  // Initialize ghostty-web WASM module
  useEffect(() => {
    initGhostty().then(() => setGhosttyReady(true));
  }, []);

  // Create loading terminal
  useEffect(() => {
    if (!ghosttyReady || isReady) {
      return;
    }

    const term = new Terminal({
      cursorBlink: false,
      fontFamily: "monospace",
      fontSize: 14,
      disableStdin: true,
      theme,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    setLoadingTerm(term);
    setLoadingFit(fit);

    return () => term.dispose();
  }, [ghosttyReady, isReady]);

  // Open loading terminal and animate
  useEffect(() => {
    if (!(loadingTerm && loadingFit) || isReady || !loadingRef.current) {
      return;
    }

    let interval: ReturnType<typeof setInterval>;
    const cleanup = waitForDimensions(loadingRef.current, () => {
      loadingTerm.open(loadingRef.current!);
      loadingFit.fit();

      // Hide textarea caret and terminal cursor for loading screen
      if (loadingTerm.textarea) {
        loadingTerm.textarea.style.caretColor = "transparent";
      }
      loadingTerm.write("\x1b[?25l"); // Hide cursor escape sequence

      const prompt = "root@operator:~# ";
      let dots = 1;
      const write = () => {
        loadingTerm.write(`\r${prompt}initializing${".".repeat(dots)}   `);
      };
      write();
      interval = setInterval(() => {
        dots = dots >= 3 ? 1 : dots + 1;
        write();
      }, 400);
    });

    return () => {
      cleanup();
      clearInterval(interval);
    };
  }, [loadingTerm, loadingFit, isReady]);

  // Create main terminal
  useEffect(() => {
    if (!ghosttyReady) {
      return;
    }

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "monospace",
      fontSize: 14,
      theme,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    setMainTerm(term);
    setMainFit(fit);

    return () => term.dispose();
  }, [ghosttyReady]);

  // Focus terminal when it becomes ready/visible
  useEffect(() => {
    if (isReady && mainTerm) {
      mainTerm.focus();
    }
  }, [isReady, mainTerm]);

  // Open main terminal and connect WebSocket
  useEffect(() => {
    if (!(mainTerm && mainFit && mainRef.current)) {
      return;
    }

    let ws: WebSocket;
    let resizeHandler: () => void;

    let keydownHandler: ((event: KeyboardEvent) => void) | null = null;

    const cleanup = waitForDimensions(mainRef.current, () => {
      mainTerm.open(mainRef.current!);
      mainFit.fit();

      // Hide the textarea caret (ghostty creates internal textarea for input)
      if (mainTerm.textarea) {
        mainTerm.textarea.style.caretColor = "transparent";
      }

      // Intercept browser shortcuts before ghostty-web's InputHandler captures them
      // InputHandler listens on the parent element, so we must intercept there
      keydownHandler = (event: KeyboardEvent) => {
        // Let Cmd+key combinations pass through to browser (except Cmd+C/V)
        if (event.metaKey) {
          const key = event.key.toLowerCase();
          if (key !== "c" && key !== "v") {
            // Stop propagation so InputHandler never sees this event
            event.stopPropagation();
            // Don't preventDefault - let browser handle Cmd+R, Cmd+T, etc.
          }
        }
      };
      mainRef.current!.addEventListener("keydown", keydownHandler, {
        capture: true,
      });

      const { cols, rows } = mainTerm;
      const params = new URLSearchParams({
        provider,
        machineId,
        cols: String(cols),
        rows: String(rows),
      });
      if (env && Object.keys(env).length > 0) {
        params.set("env", JSON.stringify(env));
      }
      if (files && files.length > 0) {
        params.set("files", JSON.stringify(files));
      }

      ws = new WebSocket(`${BRIDGE_URL}/terminal?${params}`);

      let buffer = "";
      let initComplete = false;

      ws.onmessage = (e) => {
        const data = e.data as string;
        if (initComplete) {
          mainTerm.write(data);
        } else {
          buffer += data;
          if (buffer.includes(INIT_COMPLETE_MARKER)) {
            initComplete = true;
            setIsReady(true);
          }
        }
      };

      ws.onclose = () => mainTerm.write("\r\n[Disconnected]\r\n");
      ws.onerror = () => mainTerm.write("\r\n[Connection error]\r\n");

      mainTerm.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      resizeHandler = () => {
        mainFit.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "resize",
              cols: mainTerm.cols,
              rows: mainTerm.rows,
            })
          );
        }
      };
      window.addEventListener("resize", resizeHandler);
    });

    return () => {
      cleanup();
      ws?.close();
      if (resizeHandler) {
        window.removeEventListener("resize", resizeHandler);
      }
      if (keydownHandler && mainRef.current) {
        mainRef.current.removeEventListener("keydown", keydownHandler, {
          capture: true,
        });
      }
    };
  }, [mainTerm, mainFit, machineId, provider, env, files]);

  return (
    <div className="relative h-full w-full">
      <div
        className={`absolute inset-0 ${isReady ? "hidden" : ""}`}
        ref={loadingRef}
      />
      <div
        className={`h-full w-full ${isReady ? "" : "invisible"}`}
        ref={mainRef}
      />
    </div>
  );
}
