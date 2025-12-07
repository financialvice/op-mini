"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";

const BRIDGE_URL =
  process.env.NEXT_PUBLIC_TERMINAL_BRIDGE_URL ?? "ws://localhost:8787";

// Marker that signals setup is complete - must match terminal-bridge
const INIT_COMPLETE_MARKER = "@@INIT_COMPLETE@@";

type FileToWrite = {
  path: string;
  content: string;
  mode?: string;
};

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [fitAddon, setFitAddon] = useState<FitAddon | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Phase 1: Create terminal instance
  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "monospace",
      fontSize: 14,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    setTerminal(term);
    setFitAddon(fit);

    return () => {
      term.dispose();
    };
  }, []);

  // Phase 2: Open terminal and connect WebSocket once terminal and container are ready
  useEffect(() => {
    if (!(terminal && fitAddon && containerRef.current)) {
      return;
    }

    // Wait for container to have dimensions
    const container = containerRef.current;
    if (container.clientWidth === 0 || container.clientHeight === 0) {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (
          entry &&
          entry.contentRect.width > 0 &&
          entry.contentRect.height > 0
        ) {
          observer.disconnect();
          openTerminal();
        }
      });
      observer.observe(container);
      return () => observer.disconnect();
    }

    openTerminal();

    function openTerminal() {
      if (!(terminal && fitAddon && containerRef.current)) {
        return;
      }

      terminal.open(containerRef.current);

      // Delay fit() to ensure DOM is ready
      requestAnimationFrame(() => {
        fitAddon.fit();
      });

      const envParam =
        env && Object.keys(env).length > 0
          ? `&env=${encodeURIComponent(JSON.stringify(env))}`
          : "";
      const filesParam =
        files && files.length > 0
          ? `&files=${encodeURIComponent(JSON.stringify(files))}`
          : "";
      const ws = new WebSocket(
        `${BRIDGE_URL}/terminal?provider=${provider}&machineId=${machineId}${envParam}${filesParam}`
      );

      // Buffer for accumulating data until we see the init marker
      let buffer = "";
      let initComplete = false;

      ws.onmessage = (event) => {
        const data = event.data as string;

        if (initComplete) {
          // Already initialized, write directly to terminal
          terminal.write(data);
          return;
        }

        // Still waiting for init - accumulate in buffer
        buffer += data;

        // Check if buffer contains the init complete marker
        const markerIndex = buffer.indexOf(INIT_COMPLETE_MARKER);
        if (markerIndex !== -1) {
          // Found the marker! Discard everything up to and including it
          initComplete = true;
          setIsInitialized(true);

          // The clear command follows the marker, so we just start fresh
          // Any data after the marker (post-clear) should be written
          const afterMarker = buffer.slice(
            markerIndex + INIT_COMPLETE_MARKER.length
          );

          // Clear terminal and write any remaining data
          terminal.clear();
          if (afterMarker.length > 0) {
            terminal.write(afterMarker);
          }
        }
      };

      ws.onclose = () => {
        terminal.write("\r\n[Disconnected]\r\n");
      };

      ws.onerror = () => {
        terminal.write("\r\n[Connection error]\r\n");
      };

      terminal.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      const handleResize = () => {
        requestAnimationFrame(() => {
          fitAddon.fit();
        });
      };
      window.addEventListener("resize", handleResize);

      return () => {
        window.removeEventListener("resize", handleResize);
        ws.close();
      };
    }
  }, [terminal, fitAddon, machineId, provider, env, files]);

  return (
    <div className="relative h-full w-full">
      {/* Loading overlay - shown until init is complete */}
      {!isInitialized && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black">
          <div className="text-center text-gray-400">
            <div className="mb-2 text-lg">Initializing terminal...</div>
            <div className="text-sm">Setting up environment</div>
          </div>
        </div>
      )}
      <div
        className={`h-full w-full ${isInitialized ? "" : "invisible"}`}
        ref={containerRef}
      />
    </div>
  );
}
