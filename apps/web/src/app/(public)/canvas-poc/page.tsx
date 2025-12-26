"use client";

import { db, id } from "@repo/db";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  type Connection,
  type Edge,
  type EdgeChange,
  Handle,
  type Node,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

// =============================================================================
// Custom Node Types
// =============================================================================

type NoteNodeData = {
  label?: string;
  text?: string;
  color?: "yellow" | "blue" | "green" | "pink" | "purple";
  size?: number;
  rotation?: number;
};

const noteColors = {
  yellow: "bg-yellow-100 border-yellow-300",
  blue: "bg-blue-100 border-blue-300",
  green: "bg-green-100 border-green-300",
  pink: "bg-pink-100 border-pink-300",
  purple: "bg-purple-100 border-purple-300",
};

// Default note size (square)
const NOTE_DEFAULT_SIZE = 60;

const NoteNode = memo(function NoteNodeInner({
  data,
}: NodeProps<Node<NoteNodeData>>) {
  const color = data.color ?? "yellow";
  const size = data.size ?? NOTE_DEFAULT_SIZE;
  const rotation = data.rotation ?? 0;
  const isLarge = size > 100;
  return (
    <div
      className={`flex flex-col rounded-lg border-2 shadow-md ${noteColors[color]} overflow-hidden ${isLarge ? "items-start justify-start p-3" : "items-center justify-center"} transition-transform duration-200`}
      style={{ width: size, height: size, transform: `rotate(${rotation}deg)` }}
    >
      {data.label && (
        <div
          className={`font-semibold text-gray-800 ${isLarge ? "mb-1 text-sm" : "truncate px-1 text-xs"}`}
        >
          {data.label}
        </div>
      )}
      {data.text && (
        <div
          className={`text-gray-700 ${isLarge ? "whitespace-pre-wrap text-xs" : "truncate px-1 text-xs"}`}
        >
          {data.text}
        </div>
      )}
      <Handle className="!bg-gray-400" position={Position.Top} type="target" />
      <Handle
        className="!bg-gray-400"
        position={Position.Bottom}
        type="source"
      />
    </div>
  );
});

type PreviewNodeData = {
  label?: string;
  url?: string;
  width?: number;
  height?: number;
};

const PreviewNode = memo(function PreviewNodeInner({
  data,
}: NodeProps<Node<PreviewNodeData>>) {
  const width = data.width ?? 400;
  const height = data.height ?? 300;
  return (
    <div className="overflow-hidden rounded-lg border border-gray-300 bg-white shadow-lg">
      {data.label && (
        <div className="border-b bg-gray-100 px-3 py-1.5 font-medium text-gray-700 text-xs">
          {data.label}
        </div>
      )}
      {data.url ? (
        <iframe
          className="border-0"
          src={data.url}
          style={{ width, height }}
          title={data.label ?? "Preview"}
        />
      ) : (
        <div
          className="flex items-center justify-center bg-gray-50 text-gray-400"
          style={{ width, height }}
        >
          No URL provided
        </div>
      )}
      <Handle className="!bg-blue-400" position={Position.Top} type="target" />
      <Handle
        className="!bg-blue-400"
        position={Position.Bottom}
        type="source"
      />
    </div>
  );
});

const nodeTypes = {
  note: NoteNode,
  preview: PreviewNode,
};

// Canvas state - in-memory, controlled by CLI
type CanvasState = {
  nodes: Node[];
  edges: Edge[];
};

// Available node types for validation
const VALID_NODE_TYPES = ["note", "preview"] as const;
type ValidNodeType = (typeof VALID_NODE_TYPES)[number];

// Helper to create actionable error responses
function err(message: string, hint?: string, example?: string) {
  return {
    error: true,
    message,
    ...(hint && { hint }),
    ...(example && { example }),
  };
}

// The $ API that CLI expressions can use
function createCanvasAPI(
  state: CanvasState,
  setState: (fn: (s: CanvasState) => CanvasState) => void,
  reactFlow: ReturnType<typeof useReactFlow>
) {
  const $ = {
    // List available node types with spatial info
    types: () => ({
      available: [...VALID_NODE_TYPES],
      note: {
        description:
          "A colored square note - great for pixel art, diagrams, markers",
        defaultSize: { width: 60, height: 60 },
        dataFields: {
          label: "string - Title (truncated to fit)",
          text: "string - Body text (truncated to fit)",
          color: "yellow | blue | green | pink | purple",
          size: "number - Width & height in px (default: 60)",
        },
        example: `$.create("note", { pos: [0, 0], data: { color: "blue" } })`,
        layoutTip:
          "For grids/text, space nodes 70px apart (60px node + 10px gap)",
      },
      preview: {
        description: "An iframe for embedding websites",
        defaultSize: { width: 400, height: 300 },
        dataFields: {
          label: "string - Title bar label",
          url: "string - URL to display",
          width: "number - Width in pixels (default: 400)",
          height: "number - Height in pixels (default: 300)",
        },
        example: `$.create("preview", { pos: [0, 0], data: { label: "My Site", url: "https://example.com" } })`,
        layoutTip: "Space previews 420px apart horizontally, 320px vertically",
      },
    }),

    // Query all elements
    all: () =>
      state.nodes.map((n) => ({ id: n.id, type: n.type, data: n.data })),

    // Find by selector
    find: (selector: string | ((n: Node) => boolean)) => {
      if (typeof selector === "function") {
        return state.nodes
          .filter(selector)
          .map((n) => ({ id: n.id, type: n.type }));
      }
      const results = state.nodes.filter(
        (n) => n.type === selector || n.id === selector
      );
      if (results.length === 0) {
        return err(
          `No nodes found matching "${selector}"`,
          "Use $.all() to see all nodes, or $.types() to see available types",
          `$.find("note") or $.find("${state.nodes[0]?.id ?? "node-id"}")`
        );
      }
      return results.map((n) => ({ id: n.id, type: n.type }));
    },

    // Get by ID (jQuery-style)
    get: (nodeId: string) => {
      if (!nodeId || typeof nodeId !== "string") {
        return err(
          "Node ID is required",
          "Pass a valid node ID string",
          `$.get("my-node-id")`
        );
      }
      const node = state.nodes.find((n) => n.id === nodeId);
      if (!node) {
        const available = state.nodes.slice(0, 5).map((n) => n.id);
        return err(
          `Node "${nodeId}" not found`,
          available.length > 0
            ? `Available nodes: ${available.join(", ")}${state.nodes.length > 5 ? "..." : ""}`
            : "Canvas is empty. Create a node first with $.create()",
          `$.get("${available[0] ?? "existing-node-id"}")`
        );
      }
      return {
        id: node.id,
        type: node.type,
        position: node.position,
        data: node.data,
        move: (x: number, y: number) => {
          if (typeof x !== "number" || typeof y !== "number") {
            return err(
              "x and y must be numbers",
              undefined,
              `$.get("${nodeId}").move(100, 200)`
            );
          }
          setState((s) => ({
            ...s,
            nodes: s.nodes.map((n) =>
              n.id === nodeId ? { ...n, position: { x, y } } : n
            ),
          }));
          return { success: true, id: nodeId, position: { x, y } };
        },
        resize: (width: number, height: number) => {
          if (typeof width !== "number" || typeof height !== "number") {
            return err(
              "width and height must be numbers",
              undefined,
              `$.get("${nodeId}").resize(300, 200)`
            );
          }
          setState((s) => ({
            ...s,
            nodes: s.nodes.map((n) =>
              n.id === nodeId
                ? { ...n, width, height, style: { width, height } }
                : n
            ),
          }));
          return { success: true, id: nodeId, size: { width, height } };
        },
        set: (data: Record<string, unknown>) => {
          if (!data || typeof data !== "object") {
            return err(
              "data must be an object",
              undefined,
              `$.get("${nodeId}").set({ label: "New Label" })`
            );
          }
          setState((s) => ({
            ...s,
            nodes: s.nodes.map((n) =>
              n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
            ),
          }));
          return { success: true, id: nodeId, data };
        },
        delete: () => {
          setState((s) => ({
            ...s,
            nodes: s.nodes.filter((n) => n.id !== nodeId),
            edges: s.edges.filter(
              (e) => e.source !== nodeId && e.target !== nodeId
            ),
          }));
          return { success: true, deleted: nodeId };
        },
      };
    },

    // Create a node
    create: (
      type: string,
      options: {
        id?: string;
        pos?: [number, number];
        size?: [number, number];
        data?: Record<string, unknown>;
      } = {}
    ) => {
      // Validate type
      if (!type || typeof type !== "string") {
        return err(
          "Node type is required",
          `Available types: ${VALID_NODE_TYPES.join(", ")}`,
          `$.create("note", { pos: [0, 0], data: { label: "My Note" } })`
        );
      }
      if (!VALID_NODE_TYPES.includes(type as ValidNodeType)) {
        return err(
          `Invalid node type "${type}"`,
          `Available types: ${VALID_NODE_TYPES.join(", ")}. Use $.types() for details.`,
          `$.create("note", { pos: [0, 0], data: { label: "My Note" } })`
        );
      }

      // Validate pos
      if (
        options.pos &&
        (!Array.isArray(options.pos) || options.pos.length !== 2)
      ) {
        return err(
          "pos must be [x, y] array",
          undefined,
          `$.create("${type}", { pos: [100, 200] })`
        );
      }

      const nodeId = options.id ?? id();
      const node: Node = {
        id: nodeId,
        type,
        position: { x: options.pos?.[0] ?? 0, y: options.pos?.[1] ?? 0 },
        data: { ...options.data },
        ...(options.size && {
          width: options.size[0],
          height: options.size[1],
          style: { width: options.size[0], height: options.size[1] },
        }),
      };
      setState((s) => ({ ...s, nodes: [...s.nodes, node] }));
      return { success: true, id: nodeId, type, position: node.position };
    },

    // Connect two nodes
    connect: (sourceId: string, targetId: string) => {
      if (!(sourceId && targetId)) {
        return err(
          "Both sourceId and targetId are required",
          undefined,
          `$.connect("node1", "node2")`
        );
      }
      const sourceExists = state.nodes.some((n) => n.id === sourceId);
      const targetExists = state.nodes.some((n) => n.id === targetId);
      if (!(sourceExists && targetExists)) {
        const missing: string[] = [];
        if (!sourceExists) {
          missing.push(`source "${sourceId}"`);
        }
        if (!targetExists) {
          missing.push(`target "${targetId}"`);
        }
        return err(
          `Node(s) not found: ${missing.join(", ")}`,
          "Use $.all() to see available nodes"
        );
      }
      const edgeId = `${sourceId}-${targetId}`;
      const edge: Edge = { id: edgeId, source: sourceId, target: targetId };
      setState((s) => ({ ...s, edges: [...s.edges, edge] }));
      return { success: true, id: edgeId, source: sourceId, target: targetId };
    },

    // Clear canvas
    clear: () => {
      setState(() => ({ nodes: [], edges: [] }));
      return { success: true, cleared: true, message: "Canvas cleared" };
    },

    // Get canvas summary
    summary: () => ({
      nodeCount: state.nodes.length,
      edgeCount: state.edges.length,
      types: [...new Set(state.nodes.map((n) => n.type))],
      nodes: state.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        pos: [n.position.x, n.position.y],
        data: n.data,
      })),
    }),

    // Viewport controls (duration in ms for animations)
    viewport: {
      get: () => reactFlow.getViewport(),
      set: (x: number, y: number, zoom: number, duration?: number) => {
        if (
          typeof x !== "number" ||
          typeof y !== "number" ||
          typeof zoom !== "number"
        ) {
          return err(
            "x, y, and zoom must be numbers",
            undefined,
            "$.viewport.set(0, 0, 1)"
          );
        }
        reactFlow.setViewport({ x, y, zoom }, { duration });
        return { success: true, x, y, zoom };
      },
      fitAll: (duration?: number) => {
        reactFlow.fitView({ duration, padding: 0.2 });
        return { success: true, fitted: true };
      },
      fitNodes: (nodeIds: string[], duration?: number) => {
        if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
          return err(
            "nodeIds must be a non-empty array",
            undefined,
            `$.viewport.fitNodes(["id1", "id2"])`
          );
        }
        const nodes = nodeIds
          .map((nid) => reactFlow.getNode(nid))
          .filter((n): n is NonNullable<typeof n> => n !== null);
        if (nodes.length === 0) {
          return err("No matching nodes found");
        }
        reactFlow.fitView({ nodes, duration, padding: 0.2 });
        return { success: true, fitted: nodeIds.length };
      },
      center: (
        nodeId: string,
        options?: { zoom?: number; duration?: number }
      ) => {
        if (!nodeId) {
          return err(
            "nodeId is required",
            undefined,
            `$.viewport.center("my-node-id")`
          );
        }
        const node = state.nodes.find((n) => n.id === nodeId);
        if (!node) {
          const available = state.nodes.slice(0, 3).map((n) => n.id);
          return err(
            `Node "${nodeId}" not found`,
            available.length > 0
              ? `Try: ${available.join(", ")}`
              : "Canvas is empty"
          );
        }
        const zoom = options?.zoom ?? 1;
        const duration = options?.duration;
        const nodeWidth = node.width ?? node.measured?.width ?? 150;
        const nodeHeight = node.height ?? node.measured?.height ?? 40;
        const centerX = node.position.x + nodeWidth / 2;
        const centerY = node.position.y + nodeHeight / 2;
        reactFlow.setCenter(centerX, centerY, { zoom, duration });
        return { success: true, centered: nodeId };
      },
    },

    // Wait for render then execute callback
    afterRender: (fn: () => unknown) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fn();
        });
      });
      return { scheduled: true };
    },

    // Help
    help: () => ({
      message: "Canvas API Reference",
      commands: {
        "$.types()": "List available node types with examples",
        "$.create(type, options)": "Create a node (types: note, preview)",
        "$.get(id)":
          "Get node by ID, then .move(), .resize(), .set(), .delete()",
        "$.find(selector)": "Find nodes by type or predicate",
        "$.all()": "List all nodes",
        "$.connect(from, to)": "Connect two nodes",
        "$.clear()": "Clear the canvas",
        "$.summary()": "Get canvas overview",
        "$.viewport.center(id, {duration})": "Animate to node",
        "$.viewport.fitAll(duration)": "Fit all nodes in view",
        "$.viewport.fitNodes(ids[], duration)": "Fit specific nodes in view",
        "$.afterRender(fn)": "Wait for DOM render, then call fn",
      },
    }),
  };

  return $;
}

// =============================================================================
// Debug Panel - shows command flow in real-time
// =============================================================================

type CommandLogEntry = {
  id: string;
  expression: string;
  status: "pending" | "completed" | "error";
  result?: unknown;
  error?: string;
  createdAt: Date;
  processedAt?: Date;
};

function DebugPanel({ commands }: { commands: CommandLogEntry[] }) {
  const [isOpen, setIsOpen] = useState(true);
  const [filter, setFilter] = useState<
    "all" | "pending" | "completed" | "error"
  >("all");

  const filtered = useMemo(() => {
    if (filter === "all") {
      return commands;
    }
    return commands.filter((c) => c.status === filter);
  }, [commands, filter]);

  const _statusColors = {
    pending: "bg-yellow-100 text-yellow-800 border-yellow-300",
    completed: "bg-green-100 text-green-800 border-green-300",
    error: "bg-red-100 text-red-800 border-red-300",
  };

  const statusDots = {
    pending: "bg-yellow-500 animate-pulse",
    completed: "bg-green-500",
    error: "bg-red-500",
  };

  return (
    <div className="absolute top-4 right-4 z-50 w-96 font-mono text-xs">
      {/* Header */}
      <button
        className="flex w-full items-center justify-between rounded-t-lg border border-gray-300 bg-gray-800 px-3 py-2 text-white"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <span className="flex items-center gap-2">
          <span className="text-gray-400">⚡</span>
          <span>Command Log</span>
          <span className="rounded bg-gray-700 px-1.5 py-0.5 text-gray-300">
            {commands.length}
          </span>
        </span>
        <span>{isOpen ? "▼" : "▲"}</span>
      </button>

      {isOpen && (
        <div className="max-h-80 overflow-y-auto rounded-b-lg border border-gray-300 border-t-0 bg-white shadow-lg">
          {/* Filter tabs */}
          <div className="flex border-gray-200 border-b bg-gray-50 p-1">
            {(["all", "pending", "completed", "error"] as const).map((f) => (
              <button
                className={`rounded px-2 py-1 ${filter === f ? "bg-gray-200" : "hover:bg-gray-100"}`}
                key={f}
                onClick={() => setFilter(f)}
                type="button"
              >
                {f}
              </button>
            ))}
          </div>

          {/* Command list */}
          {filtered.length === 0 ? (
            <div className="p-4 text-center text-gray-400">
              {commands.length === 0
                ? "No commands yet. Run 'operator canvas eval \"$.summary()\"' to start."
                : `No ${filter} commands`}
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filtered.map((cmd) => (
                <div className="p-2 hover:bg-gray-50" key={cmd.id}>
                  {/* Status + Expression */}
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${statusDots[cmd.status]}`}
                      title={cmd.status}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate text-gray-800"
                        title={cmd.expression}
                      >
                        {cmd.expression}
                      </div>
                      {/* Timing */}
                      <div className="mt-0.5 flex gap-2 text-gray-400">
                        <span>{cmd.createdAt.toLocaleTimeString()}</span>
                        {cmd.processedAt && (
                          <span>
                            →{" "}
                            {cmd.processedAt.getTime() -
                              cmd.createdAt.getTime()}
                            ms
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Result or Error */}
                  {cmd.status === "completed" && cmd.result !== undefined && (
                    <div className="mt-1 ml-4 max-h-20 overflow-auto rounded bg-gray-100 p-1.5 text-gray-600">
                      {JSON.stringify(cmd.result, null, 2).slice(0, 200)}
                      {JSON.stringify(cmd.result).length > 200 && "..."}
                    </div>
                  )}
                  {cmd.status === "error" && cmd.error && (
                    <div className="mt-1 ml-4 rounded bg-red-50 p-1.5 text-red-600">
                      {cmd.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CanvasFlow() {
  const reactFlow = useReactFlow();
  const [state, setState] = useState<CanvasState>({ nodes: [], edges: [] });
  const stateRef = useRef(state);
  stateRef.current = state;

  // Command log for debug panel
  const [commandLog, setCommandLog] = useState<CommandLogEntry[]>([]);

  // Subscribe to pending commands from InstantDB
  const { data } = db._client.useQuery({
    canvasCommands: {
      $: { where: { status: "pending" } },
    },
  });

  const pendingCommands = data?.canvasCommands ?? [];

  // Track pending commands in log
  useEffect(() => {
    for (const cmd of pendingCommands) {
      setCommandLog((prev) => {
        // Don't add if already exists
        if (prev.some((c) => c.id === cmd.id)) {
          return prev;
        }
        const entry: CommandLogEntry = {
          id: cmd.id,
          expression: cmd.expression,
          status: "pending",
          createdAt: cmd.createdAt,
        };
        return [entry, ...prev].slice(0, 50); // Keep last 50
      });
    }
  }, [pendingCommands]);

  // Process a single command and return result
  const processCommand = useCallback(
    (expression: string) => {
      const $ = createCanvasAPI(stateRef.current, setState, reactFlow);
      try {
        const fn = new Function("$", `return (${expression})`);
        return { result: fn($) as unknown, error: undefined };
      } catch (e) {
        return {
          result: undefined,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
    [reactFlow]
  );

  // Process pending commands
  useEffect(() => {
    for (const cmd of pendingCommands) {
      const processedAt = new Date();
      const { result, error } = processCommand(cmd.expression);
      const status = error ? "error" : "completed";

      // Update command log
      setCommandLog((prev) =>
        prev.map((c) =>
          c.id === cmd.id ? { ...c, status, result, error, processedAt } : c
        )
      );

      // Update command status in InstantDB
      db._client.transact(
        db._client.tx.canvasCommands[cmd.id]!.update({
          status,
          result: error ? undefined : result,
          error,
        })
      );
    }
  }, [pendingCommands, processCommand]);

  const onNodesChange = useCallback((changes: NodeChange<Node>[]) => {
    setState((s) => ({ ...s, nodes: applyNodeChanges(changes, s.nodes) }));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    setState((s) => ({ ...s, edges: applyEdgeChanges(changes, s.edges) }));
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    setState((s) => ({ ...s, edges: addEdge(connection, s.edges) }));
  }, []);

  return (
    <>
      <ReactFlow
        edges={state.edges}
        fitView
        nodes={state.nodes}
        nodeTypes={nodeTypes}
        onConnect={onConnect}
        onEdgesChange={onEdgesChange}
        onNodesChange={onNodesChange}
        style={{ width: "100%", height: "100%" }}
      >
        <Background />
      </ReactFlow>
      <DebugPanel commands={commandLog} />
    </>
  );
}

export default function CanvasPocPage() {
  return (
    <div className="h-screen w-screen">
      <ReactFlowProvider>
        <CanvasFlow />
      </ReactFlowProvider>
    </div>
  );
}
