"use client";

import { useTRPC } from "@repo/trpc/client";
import { Button } from "@repo/ui/components/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@repo/ui/components/input-group";
import {
  type ImperativePanelHandle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@repo/ui/components/resizable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  applyNodeChanges,
  Background,
  type Node,
  type NodeChange,
  Panel,
  type ProOptions,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowUpIcon, Loader2Icon, PanelLeftIcon } from "lucide-react";
import { motion } from "motion/react";
import Image from "next/image";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

type SidebarContextValue = {
  toggle: () => void;
  collapseSidebar: () => void;
  isCollapsed: boolean;
  isDragging: boolean;
  isInitialized: boolean;
  sidebarWidth: number;
  expandedSidebarWidth: number;
  focusedNodeId: string | null;
  setFocusedNodeId: (id: string | null) => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within CanvasPage");
  }
  return context;
}

// Pending instance tracking for optimistic drag-to-create
type PendingInstance = {
  tempId: string;
  snapshotId: string;
  snapshotName: string;
  position: { x: number; y: number } | null;
  status: "creating" | "created" | "failed";
  realInstanceId: string | null;
};

type PendingInstancesContextValue = {
  pending: PendingInstance[];
  startDrag: (snapshotId: string, snapshotName: string) => string;
  setDropPosition: (tempId: string, position: { x: number; y: number }) => void;
  cancelDrag: (tempId: string) => void;
  activeDragTempId: string | null;
};

const PendingInstancesContext =
  createContext<PendingInstancesContextValue | null>(null);

function usePendingInstances() {
  const context = useContext(PendingInstancesContext);
  if (!context) {
    throw new Error("usePendingInstances must be used within CanvasPage");
  }
  return context;
}

const STORAGE_KEY = "canvas-node-positions";

type PositionMap = Record<string, { x: number; y: number }>;

const proOptions: ProOptions = {
  hideAttribution: true,
};

// Instance IDs have format "morphvm_xyz123...", extract the unique part
function formatInstanceId(id: string): string {
  if (id.startsWith("morphvm_")) {
    return id.slice(8, 16); // Skip prefix, take next 8 chars
  }
  return id.slice(0, 8);
}

// Convert instance ID to webapp URL
// morphvm_abc123 -> https://webapp-morphvm-abc123.http.cloud.morph.so
function getInstanceWebappUrl(instanceId: string): string {
  const urlId = instanceId.replace(/_/g, "-");
  return `https://webapp-${urlId}.http.cloud.morph.so`;
}

type InstanceNodeData = {
  label: string;
  status: string;
  isPending: boolean;
  instanceId?: string;
  isFocused?: boolean;
};

function getStatusColor(status: string, isPending: boolean): string {
  if (isPending || status === "creating") {
    return "animate-pulse bg-yellow-500";
  }
  if (status === "ready") {
    return "bg-green-500";
  }
  return "bg-gray-400";
}

const InstanceNode = memo(function InstanceNodeComponent({
  data,
  selected,
}: {
  data: InstanceNodeData;
  selected?: boolean;
}) {
  const { label, status, isPending, instanceId, isFocused } = data;
  const { zoom } = useViewport();

  // Scale border and radius inversely with zoom so they appear constant visually
  const borderWidth = 1 / zoom;
  const borderRadius = 12 / zoom; // 12px
  const outlineWidth = 5 / zoom;

  // Determine box-shadow: focused (40%) takes priority over selected (20%)
  const getBoxShadow = () => {
    if (isFocused) {
      return `0 0 0 ${outlineWidth}px color-mix(in srgb, var(--primary) 40%, transparent)`;
    }
    if (selected) {
      return `0 0 0 ${outlineWidth}px color-mix(in srgb, var(--primary) 20%, transparent)`;
    }
    return "none";
  };

  return (
    <div
      className="flex flex-col overflow-hidden bg-background"
      style={{
        border: `${borderWidth}px solid var(--border)`,
        borderRadius: `${borderRadius}px`,
        boxShadow: getBoxShadow(),
      }}
    >
      <div className="flex items-center justify-between border-b px-2 py-1">
        <span className="font-mono text-xs">{label}</span>
        <span
          className={`size-2 rounded-full ${getStatusColor(status, isPending)}`}
        />
      </div>
      {instanceId && !isPending ? (
        <div className="relative">
          <iframe
            className="h-[1000px] w-[1600px] border-0"
            src={getInstanceWebappUrl(instanceId)}
            title={label}
          />
          {/* Overlay to prevent iframe interaction during drag - removed when focused */}
          {!isFocused && <div className="absolute inset-0" />}
        </div>
      ) : (
        <div className="flex h-[1000px] w-[1600px] items-center justify-center bg-muted">
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
});

const nodeTypes = {
  instance: InstanceNode,
};

function loadPositions(): PositionMap {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function savePositions(positions: PositionMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
}

function Flow() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data } = useQuery(trpc.morph.instances.list.queryOptions({}));
  const instances = data?.instances ?? [];
  const reactFlowInstance = useReactFlow();

  const { mutate: stopInstance } = useMutation({
    ...trpc.morph.instance.stop.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: trpc.morph.instances.list.queryKey({}),
      });
    },
  });

  const { pending, setDropPosition } = usePendingInstances();
  const {
    toggle,
    collapseSidebar,
    focusedNodeId,
    setFocusedNodeId,
    expandedSidebarWidth,
  } = useSidebar();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [fitViewOnMount, setFitViewOnMount] = useState(true);
  const lastPaneClickTime = useRef(0);
  const savedViewport = useRef<Viewport | null>(null);
  const prevFocusedNodeId = useRef<string | null>(null);
  const prevSidebarWidth = useRef(expandedSidebarWidth);
  const sidebarRafId = useRef<number | null>(null);

  // Use ref to access latest expandedSidebarWidth without recreating callback
  const expandedSidebarWidthRef = useRef(expandedSidebarWidth);
  expandedSidebarWidthRef.current = expandedSidebarWidth;

  // Disable fitView after initial mount to prevent conflicts with manual viewport control
  useEffect(() => {
    setFitViewOnMount(false);
  }, []);

  // Center on the focused node (reusable for initial focus and resize events)
  // predictFinalSize: true for initial focus (sidebar is animating), false for resize events
  const centerOnFocusedNode = useCallback(
    (
      nodeId: string,
      options: { animate: boolean; predictFinalSize: boolean }
    ) => {
      const targetNode = reactFlowInstance.getNode(nodeId);
      if (!targetNode) {
        return;
      }

      const nodeWidth = targetNode.measured?.width ?? 1600;
      const nodeHeight = targetNode.measured?.height ?? 1028;
      const nodeCenterX = targetNode.position.x + nodeWidth / 2;
      const nodeCenterY = targetNode.position.y + nodeHeight / 2;

      // Calculate zoom to fit node with padding
      // Padding factor: 0.05 = 5% padding on each side (node fills 90% of viewport)
      const paddingFactor = 0.05;
      const canvasEl = document.querySelector(".react-flow");
      const canvasHeight = canvasEl?.clientHeight ?? 600;

      let canvasWidth: number;
      let offsetX = 0;

      // Use ref to get latest sidebar width without dependency
      const sidebarWidth = expandedSidebarWidthRef.current;

      if (options.predictFinalSize) {
        // Initial focus: sidebar is about to expand, predict final canvas size
        canvasWidth = (canvasEl?.clientWidth ?? 800) - sidebarWidth;
        // Calculate offset to account for sidebar shifting the visual center
        const nodeWidthWithPadding = nodeWidth * (1 + paddingFactor * 2);
        const predictedZoom = Math.min(
          canvasWidth / nodeWidthWithPadding,
          canvasHeight / (nodeHeight * (1 + paddingFactor * 2)),
          5
        );
        offsetX = sidebarWidth / predictedZoom / 2;
      } else {
        // Resize event: use current canvas size as-is (already correctly sized)
        canvasWidth = canvasEl?.clientWidth ?? 800;
      }

      const nodeWidthWithPadding = nodeWidth * (1 + paddingFactor * 2);
      const nodeHeightWithPadding = nodeHeight * (1 + paddingFactor * 2);

      const zoomToFitWidth = canvasWidth / nodeWidthWithPadding;
      const zoomToFitHeight = canvasHeight / nodeHeightWithPadding;
      const targetZoom = Math.min(zoomToFitWidth, zoomToFitHeight, 2);

      if (options.animate) {
        reactFlowInstance.setCenter(nodeCenterX + offsetX, nodeCenterY, {
          zoom: targetZoom,
          duration: 200,
          ease: (t: number) => t,
          interpolate: "linear",
        });
      } else {
        reactFlowInstance.setCenter(nodeCenterX + offsetX, nodeCenterY, {
          zoom: targetZoom,
        });
      }
    },
    [reactFlowInstance]
  );

  // Re-center focused node on window resize (debounced - wait until resize stops)
  useEffect(() => {
    if (!focusedNodeId) {
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const handleResize = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      // Debounce: wait 50ms after last resize event before updating
      timeoutId = setTimeout(() => {
        centerOnFocusedNode(focusedNodeId, {
          animate: false,
          predictFinalSize: false,
        });
      }, 50);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [focusedNodeId, centerOnFocusedNode]);

  // Re-center focused node when sidebar is resized (throttled with RAF)
  useEffect(() => {
    if (!focusedNodeId) {
      return;
    }

    // Only re-center if sidebar width actually changed
    if (prevSidebarWidth.current !== expandedSidebarWidth) {
      if (sidebarRafId.current) {
        cancelAnimationFrame(sidebarRafId.current);
      }
      sidebarRafId.current = requestAnimationFrame(() => {
        centerOnFocusedNode(focusedNodeId, {
          animate: false,
          predictFinalSize: false,
        });
      });
    }
    prevSidebarWidth.current = expandedSidebarWidth;
  }, [focusedNodeId, expandedSidebarWidth, centerOnFocusedNode]);

  // Reconcile nodes when instances or pending instances change
  useEffect(() => {
    const positions = loadPositions();
    const instanceIds = new Set(instances.map((i) => i.id));

    // Remove positions for deleted instances
    const cleanedPositions: PositionMap = {};
    for (const id of Object.keys(positions)) {
      if (instanceIds.has(id)) {
        cleanedPositions[id] = positions[id]!;
      }
    }
    if (
      Object.keys(cleanedPositions).length !== Object.keys(positions).length
    ) {
      savePositions(cleanedPositions);
    }

    // Build nodes from real instances
    const realNodes: Node[] = instances.map((instance, index) => {
      const savedPos = cleanedPositions[instance.id];
      return {
        id: instance.id,
        type: "instance",
        position: savedPos ?? {
          x: (index % 4) * 320,
          y: Math.floor(index / 4) * 260,
        },
        data: {
          label: formatInstanceId(instance.id),
          status: instance.status,
          isPending: false,
          instanceId: instance.id,
          isFocused: focusedNodeId === instance.id,
        },
      };
    });

    // Add optimistic nodes for pending instances that have been dropped
    // but exclude those whose real instance has appeared
    const realInstanceIds = new Set(instances.map((i) => i.id));
    const pendingNodes: Node[] = pending
      .filter(
        (p) =>
          p.position !== null &&
          (p.realInstanceId === null || !realInstanceIds.has(p.realInstanceId))
      )
      .map((p) => ({
        id: p.tempId,
        type: "instance",
        position: p.position!,
        data: {
          // Show instance ID once we have it, otherwise snapshot name
          label: p.realInstanceId
            ? formatInstanceId(p.realInstanceId)
            : p.snapshotName,
          status: p.status === "creating" ? "creating" : "ready",
          isPending: true,
          instanceId: p.realInstanceId ?? undefined,
          isFocused: focusedNodeId === p.tempId,
        },
      }));

    setNodes([...realNodes, ...pendingNodes]);
  }, [instances, pending, focusedNodeId]);

  // Restore viewport when exiting focus mode
  useEffect(() => {
    const wasFocused = prevFocusedNodeId.current !== null;
    const isNowUnfocused = focusedNodeId === null;
    const storedViewport = savedViewport.current;

    if (wasFocused && isNowUnfocused && storedViewport) {
      // Directly restore the saved viewport (no center calculations needed)
      // The saved viewport was captured with sidebar collapsed, and after
      // this animation the sidebar will be collapsed again
      reactFlowInstance.setViewport(storedViewport, {
        duration: 200,
        ease: (t: number) => t,
        interpolate: "linear",
      });

      savedViewport.current = null;
    }
    prevFocusedNodeId.current = focusedNodeId;
  }, [focusedNodeId, reactFlowInstance]);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      // Stop instances for removed nodes (only real instances, not pending)
      for (const change of changes) {
        if (change.type === "remove" && !change.id.startsWith("pending-")) {
          stopInstance({ instanceId: change.id });
        }
      }

      setNodes((nds) => {
        const updated = applyNodeChanges(changes, nds);

        // Persist position changes (only for real instances)
        const hasPositionChange = changes.some(
          (c) => c.type === "position" && c.position
        );
        if (hasPositionChange) {
          const positions: PositionMap = {};
          for (const node of updated) {
            if (!node.id.startsWith("pending-")) {
              positions[node.id] = node.position;
            }
          }
          savePositions(positions);
        }

        return updated;
      });
    },
    [stopInstance]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const tempId = event.dataTransfer.getData("application/pending-instance");
      if (!tempId) {
        return;
      }

      // Convert screen position to flow position
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      setDropPosition(tempId, position);
    },
    [reactFlowInstance, setDropPosition]
  );

  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      // Save current viewport before focusing
      savedViewport.current = reactFlowInstance.getViewport();
      setFocusedNodeId(node.id);

      // Animate to center on the node (use requestAnimationFrame to ensure state is updated)
      requestAnimationFrame(() => {
        centerOnFocusedNode(node.id, { animate: true, predictFinalSize: true });
      });
    },
    [setFocusedNodeId, reactFlowInstance, centerOnFocusedNode]
  );

  const onPaneClick = useCallback(() => {
    const now = Date.now();
    // Detect double-click (two clicks within 300ms)
    if (now - lastPaneClickTime.current < 300 && focusedNodeId) {
      setFocusedNodeId(null);
      collapseSidebar();
    }
    lastPaneClickTime.current = now;
  }, [focusedNodeId, setFocusedNodeId, collapseSidebar]);

  const isFocused = focusedNodeId !== null;

  return (
    <ReactFlow
      className="h-full w-full rounded-xl border-[0.5px] border-border"
      fitView={fitViewOnMount}
      maxZoom={2}
      minZoom={0.1}
      nodes={nodes}
      nodesDraggable={!isFocused}
      nodeTypes={nodeTypes}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onNodeDoubleClick={onNodeDoubleClick}
      onNodesChange={onNodesChange}
      onPaneClick={onPaneClick}
      panOnDrag={!isFocused}
      proOptions={proOptions}
      style={{ backgroundColor: "var(--secondary)" }}
      zoomOnDoubleClick={false}
      zoomOnPinch={!isFocused}
      zoomOnScroll={!isFocused}
    >
      <Background />
      <Panel
        className="!mt-2 !ml-2 flex items-center justify-center rounded-md border bg-background p-1"
        position="top-left"
      >
        <Button
          className="h-5 w-5 rounded-xs"
          onClick={toggle}
          size="icon"
          variant="ghost"
        >
          <PanelLeftIcon className="!size-3.5" />
        </Button>
      </Panel>
    </ReactFlow>
  );
}

function DraggableSnapshot({
  snapshot,
}: {
  snapshot: { id: string; metadata?: Record<string, string> };
}) {
  const { startDrag, cancelDrag, activeDragTempId } = usePendingInstances();
  const tempIdRef = useRef<string | null>(null);

  const handleDragStart = (event: React.DragEvent) => {
    const name = snapshot.metadata?.name ?? snapshot.id.slice(0, 8);
    const tempId = startDrag(snapshot.id, name);
    tempIdRef.current = tempId;
    event.dataTransfer.setData("application/pending-instance", tempId);
    event.dataTransfer.effectAllowed = "copy";
  };

  const handleDragEnd = (event: React.DragEvent) => {
    // If dropped outside valid target (dropEffect is none), cancel
    if (event.dataTransfer.dropEffect === "none" && tempIdRef.current) {
      cancelDrag(tempIdRef.current);
    }
    tempIdRef.current = null;
  };

  // Handle escape key to cancel drag
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && tempIdRef.current) {
        cancelDrag(tempIdRef.current);
        tempIdRef.current = null;
      }
    };

    if (activeDragTempId && tempIdRef.current === activeDragTempId) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [activeDragTempId, cancelDrag]);

  return (
    <button
      className="size-6 shrink-0 cursor-grab rounded bg-muted active:cursor-grabbing"
      draggable
      onDragEnd={handleDragEnd}
      onDragStart={handleDragStart}
      title={snapshot.metadata?.name ?? snapshot.id.slice(0, 8)}
      type="button"
    >
      <Image
        alt={snapshot.metadata?.name ?? "Snapshot"}
        className="pointer-events-none size-6 rounded"
        draggable={false}
        height={24}
        src="/placeholder-icon.webp"
        width={24}
      />
    </button>
  );
}

function Composer() {
  const { isCollapsed, isDragging, isInitialized, sidebarWidth } = useSidebar();
  const trpc = useTRPC();
  const { data: snapshotsData } = useQuery(
    trpc.morph.snapshots.list.queryOptions()
  );

  // Filter for pinned snapshots
  const pinnedSnapshots = (snapshotsData?.snapshots ?? []).filter(
    (s) => s.metadata?.pinned === "true"
  );

  return (
    <motion.div
      animate={{
        left: isCollapsed ? "50%" : 8,
        x: isCollapsed ? "-50%" : 0,
        width: isCollapsed ? 480 : sidebarWidth - 8,
        bottom: isCollapsed ? 16 : 8,
      }}
      className="absolute z-10"
      initial={false}
      transition={
        isInitialized && !isDragging
          ? { duration: 0.2, ease: "easeInOut" }
          : { duration: 0 }
      }
    >
      <InputGroup className="min-h-9 rounded-lg bg-background">
        <InputGroupAddon
          align="inline-start"
          className="items-start self-stretch"
        >
          {pinnedSnapshots[0] ? (
            <DraggableSnapshot snapshot={pinnedSnapshots[0]} />
          ) : (
            <Image
              alt="App"
              className="size-6 shrink-0 rounded opacity-50"
              height={24}
              src="/placeholder-icon.webp"
              width={24}
            />
          )}
        </InputGroupAddon>
        <InputGroupTextarea
          className="min-h-0 px-2.5 py-1.5 text-sm"
          placeholder="Send message..."
          rows={1}
        />
        <InputGroupAddon align="inline-end" className="items-end self-stretch">
          <InputGroupButton size="icon-xs" variant="default">
            <ArrowUpIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </motion.div>
  );
}

function CanvasSidebar() {
  const { focusedNodeId } = useSidebar();

  return (
    <div className="flex h-full flex-col p-2 pr-0">
      <h2 className="font-medium text-xs">Canvas</h2>
      {focusedNodeId && (
        <div className="mt-4">
          <p className="text-muted-foreground text-xs">Focused Instance</p>
          <p className="font-mono text-sm">{formatInstanceId(focusedNodeId)}</p>
        </div>
      )}
    </div>
  );
}

function PendingInstancesProvider({ children }: { children: React.ReactNode }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingInstance[]>([]);
  const [activeDragTempId, setActiveDragTempId] = useState<string | null>(null);
  const pendingIdCounter = useRef(0);

  const { mutateAsync: startInstance } = useMutation(
    trpc.morph.instance.start.mutationOptions()
  );

  const { mutate: stopInstance } = useMutation(
    trpc.morph.instance.stop.mutationOptions()
  );

  const startDrag = useCallback(
    (snapshotId: string, snapshotName: string) => {
      const tempId = `pending-${Date.now()}-${pendingIdCounter.current++}`;
      setActiveDragTempId(tempId);

      const newPending: PendingInstance = {
        tempId,
        snapshotId,
        snapshotName,
        position: null,
        status: "creating",
        realInstanceId: null,
      };

      setPending((prev) => [...prev, newPending]);

      // Start instance creation immediately (don't await)
      startInstance({ snapshotId, metadata: { name: snapshotName } })
        .then((result) => {
          // Store real instance ID and save position if already dropped
          setPending((prev) => {
            const item = prev.find((p) => p.tempId === tempId);
            if (item?.position) {
              // Save position for the real instance
              const positions = loadPositions();
              positions[result.instanceId] = item.position;
              savePositions(positions);
            }
            return prev.map((p) =>
              p.tempId === tempId
                ? {
                    ...p,
                    status: "created" as const,
                    realInstanceId: result.instanceId,
                  }
                : p
            );
          });

          // Instance created - invalidate query to fetch the new instance
          queryClient.invalidateQueries({
            queryKey: trpc.morph.instances.list.queryKey({}),
          });

          // Remove pending after a delay to allow reconciliation
          setTimeout(() => {
            setPending((prev) => prev.filter((p) => p.tempId !== tempId));
          }, 2000);
        })
        .catch(() => {
          // Instance creation failed - remove optimistic node
          setPending((prev) => prev.filter((p) => p.tempId !== tempId));
        });

      return tempId;
    },
    [startInstance, queryClient, trpc.morph.instances.list]
  );

  const setDropPosition = useCallback(
    (tempId: string, position: { x: number; y: number }) => {
      setActiveDragTempId(null);
      setPending((prev) => {
        const item = prev.find((p) => p.tempId === tempId);

        // If instance already created, save position immediately
        if (item?.realInstanceId) {
          const positions = loadPositions();
          positions[item.realInstanceId] = position;
          savePositions(positions);
        }

        return prev.map((p) => (p.tempId === tempId ? { ...p, position } : p));
      });
    },
    []
  );

  const cancelDrag = useCallback(
    (tempId: string) => {
      setActiveDragTempId(null);

      setPending((prev) => {
        const item = prev.find((p) => p.tempId === tempId);

        // If instance was created, stop it
        if (item?.realInstanceId) {
          stopInstance({ instanceId: item.realInstanceId });
        }
        // Note: if still creating, we can't stop it yet - the mutation will complete
        // and the instance will be orphaned (but will eventually timeout via TTL)

        return prev.filter((p) => p.tempId !== tempId);
      });
    },
    [stopInstance]
  );

  return (
    <PendingInstancesContext.Provider
      value={{
        pending,
        startDrag,
        setDropPosition,
        cancelDrag,
        activeDragTempId,
      }}
    >
      {children}
    </PendingInstancesContext.Provider>
  );
}

export default function CanvasPage() {
  const sidebarRef = useRef<ImperativePanelHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(0);
  const [expandedSidebarWidth, setExpandedSidebarWidth] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);
  const [focusedNodeId, setFocusedNodeIdState] = useState<string | null>(null);

  const toggle = useCallback(() => {
    const panel = sidebarRef.current;
    if (panel) {
      if (panel.isCollapsed()) {
        panel.expand();
      } else {
        // Clear focus when collapsing sidebar
        setFocusedNodeIdState(null);
        panel.collapse();
      }
    }
  }, []);

  const setFocusedNodeId = useCallback((id: string | null) => {
    setFocusedNodeIdState(id);
    // Expand sidebar when entering focus mode
    if (id !== null && sidebarRef.current?.isCollapsed()) {
      sidebarRef.current.expand();
    }
  }, []);

  const collapseSidebar = useCallback(() => {
    sidebarRef.current?.collapse();
  }, []);

  const handleResize = useCallback(
    (size: number) => {
      if (containerRef.current) {
        const width = (size / 100) * containerRef.current.offsetWidth;
        setSidebarWidth(width);
        // Track expanded width when sidebar is open (size > 5% means not collapsed)
        if (size > 5) {
          setExpandedSidebarWidth(width);
        }
      }
    },
    [isCollapsed]
  );

  useEffect(() => {
    if (containerRef.current && sidebarRef.current) {
      const size = sidebarRef.current.getSize();
      const width = (size / 100) * containerRef.current.offsetWidth;
      setSidebarWidth(width);
      // Initialize expanded width (default 20% if not set)
      const expandedSize = size > 5 ? size : 20;
      setExpandedSidebarWidth(
        (expandedSize / 100) * containerRef.current.offsetWidth
      );
      // Delay initialization to allow the panel to settle
      requestAnimationFrame(() => setIsInitialized(true));
    }
  }, []);

  return (
    <SidebarContext.Provider
      value={{
        toggle,
        collapseSidebar,
        isCollapsed,
        isDragging,
        isInitialized,
        sidebarWidth,
        expandedSidebarWidth,
        focusedNodeId,
        setFocusedNodeId,
      }}
    >
      <PendingInstancesProvider>
        <div className="relative h-full w-full" ref={containerRef}>
          <ResizablePanelGroup
            autoSaveId="canvas-sidebar"
            className="h-full w-full"
            direction="horizontal"
          >
            <ResizablePanel
              className={
                isInitialized && !isDragging
                  ? "transition-[flex] duration-200 ease-linear"
                  : ""
              }
              collapsible
              defaultSize={20}
              maxSize={40}
              minSize={15}
              onCollapse={() => setIsCollapsed(true)}
              onExpand={() => setIsCollapsed(false)}
              onResize={handleResize}
              ref={sidebarRef}
            >
              <CanvasSidebar />
            </ResizablePanel>
            <ResizableHandle
              className="!bg-transparent w-2"
              onDragging={setIsDragging}
            />
            <ResizablePanel defaultSize={80}>
              <main className="relative h-full flex-1 bg-background p-2 pl-0">
                <ReactFlowProvider>
                  <Flow />
                </ReactFlowProvider>
              </main>
            </ResizablePanel>
          </ResizablePanelGroup>
          <Composer />
        </div>
      </PendingInstancesProvider>
    </SidebarContext.Provider>
  );
}
