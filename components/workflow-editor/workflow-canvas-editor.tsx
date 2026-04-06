"use client";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeTypes,
  type OnNodesDelete,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Handle, Position } from "@xyflow/react";

type WfNodeData = { wfNode: WorkflowNode };

type CanvasNodeProps = { data: unknown; selected?: boolean };
import { cn } from "@/lib/utils";
import {
  type WorkflowDefinition,
  type WorkflowNode,
  resolveLinearExecutionOrder,
} from "@/lib/orchestration/workflow-definition";

const nodeTypes = {
  wfTrigger: TriggerCanvasNode,
  wfStep: StepCanvasNode,
} as NodeTypes;

function TriggerCanvasNode({ data, selected }: CanvasNodeProps) {
  const wf = (data as WfNodeData).wfNode;
  return (
    <div
      className={cn(
        "min-w-[180px] rounded-lg border-2 border-emerald-600/80 bg-card px-3 py-2.5 shadow-md",
        Boolean(selected) && "ring-2 ring-primary ring-offset-2 ring-offset-background"
      )}
    >
      <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Trigger</div>
      <div className="mt-0.5 text-sm font-semibold">{wf.name ?? "Start"}</div>
      <div className="text-[11px] text-muted-foreground">Manual start</div>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !bg-emerald-500" />
    </div>
  );
}

const stepAccent: Record<string, string> = {
  internal: "hsl(217 91% 60%)",
  http_request: "hsl(280 70% 55%)",
  noop: "hsl(215 16% 47%)",
};

function StepCanvasNode({ data, selected }: CanvasNodeProps) {
  const wf = (data as WfNodeData).wfNode;
  const accent = stepAccent[wf.type] ?? stepAccent.noop;
  const subtitle =
    wf.type === "internal"
      ? wf.config.internal_key
      : wf.type === "http_request"
        ? `${wf.config.method} ${wf.config.path_template?.slice(0, 24) ?? ""}${(wf.config.path_template?.length ?? 0) > 24 ? "…" : ""}`
        : "No-op";
  return (
    <div
      className={cn(
        "min-w-[200px] rounded-lg border border-border bg-card px-3 py-2.5 shadow-md",
        Boolean(selected) && "ring-2 ring-primary ring-offset-2 ring-offset-background"
      )}
      style={{ borderLeftWidth: 4, borderLeftColor: accent }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !bg-muted-foreground"
      />
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {wf.type.replace("_", " ")}
      </div>
      <div className="mt-0.5 truncate text-sm font-semibold">{wf.name ?? wf.id}</div>
      <div className="truncate font-mono text-[11px] text-muted-foreground">{subtitle}</div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !bg-muted-foreground"
      />
    </div>
  );
}

function layoutFallback(def: WorkflowDefinition): WorkflowNode[] {
  const trigger = def.nodes.filter((n) => n.type === "trigger_manual");
  const rest = def.nodes.filter((n) => n.type !== "trigger_manual");
  return [...trigger, ...rest];
}

function defToFlow(def: WorkflowDefinition): { nodes: Node[]; edges: Edge[] } {
  const y = 140;
  const dx = 300;
  let ordered: WorkflowNode[] = [];
  try {
    const exec = resolveLinearExecutionOrder(def);
    const trig = def.nodes.find((n) => n.type === "trigger_manual");
    ordered = trig ? [trig, ...exec] : layoutFallback(def);
  } catch {
    ordered = layoutFallback(def);
  }
  const indexById = new Map(ordered.map((n, i) => [n.id, i]));

  const nodes: Node[] = def.nodes.map((wf) => {
    const i = indexById.get(wf.id) ?? 0;
    const pos = wf.position ?? { x: 48 + i * dx, y };
    const wfWithPos = { ...wf, position: pos } as WorkflowNode;
    return {
      id: wf.id,
      type: wf.type === "trigger_manual" ? "wfTrigger" : "wfStep",
      position: pos,
      data: { wfNode: wfWithPos },
      deletable: wf.type !== "trigger_manual",
    };
  });

  const edges: Edge[] = def.edges.map((e, idx) => ({
    id: `e-${e.source}-${e.target}-${idx}`,
    source: e.source,
    target: e.target,
    animated: true,
    style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
  }));

  return { nodes, edges };
}

export function flowNodesToDefinition(nodes: Node[], edges: Edge[]): WorkflowDefinition {
  const wfNodes: WorkflowNode[] = nodes.map((n) => {
    const wf = { ...(n.data as { wfNode: WorkflowNode }).wfNode };
    wf.position = { x: n.position.x, y: n.position.y };
    return wf;
  });
  const wfEdges = edges.map((e) => ({
    source: e.source,
    target: e.target,
  }));
  return { nodes: wfNodes, edges: wfEdges };
}

function findTailNodeId(nodes: Node[], edges: Edge[]): string | null {
  const trigger = nodes.find((n) => (n.data as { wfNode: WorkflowNode }).wfNode.type === "trigger_manual");
  if (!trigger) return nodes[0]?.id ?? null;
  let cur = trigger.id;
  for (let guard = 0; guard < 256; guard++) {
    const e = edges.find((x) => x.source === cur);
    if (!e) return cur;
    cur = e.target;
  }
  return cur;
}

export type WorkflowCanvasEditorProps = {
  definition: WorkflowDefinition;
  onChange: (def: WorkflowDefinition) => void;
  readOnly?: boolean;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
};

export function WorkflowCanvasEditor({
  definition,
  onChange,
  readOnly,
  selectedNodeId,
  onSelectNode,
}: WorkflowCanvasEditorProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);
  const skipNextDefSync = React.useRef(false);
  const defJson = React.useMemo(() => JSON.stringify(definition), [definition]);
  const nodesRef = React.useRef(nodes);
  const edgesRef = React.useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  React.useEffect(() => {
    if (skipNextDefSync.current) {
      skipNextDefSync.current = false;
      return;
    }
    const { nodes: n, edges: e } = defToFlow(definition);
    setNodes(n);
    setEdges(e);
  }, [defJson, definition, setNodes, setEdges]);

  const pushDefinition = React.useCallback(
    (n: Node[], e: Edge[]) => {
      skipNextDefSync.current = true;
      onChange(flowNodesToDefinition(n, e));
    },
    [onChange]
  );

  const onEdgesChangeWrapped = React.useCallback(
    (changes: EdgeChange[]) => {
      if (readOnly) return;
      setEdges((eds) => {
        const next = applyEdgeChanges(changes, eds);
        pushDefinition(nodesRef.current, next);
        return next;
      });
    },
    [readOnly, pushDefinition, setEdges]
  );

  const onConnect = React.useCallback(
    (params: Connection) => {
      if (readOnly || !params.source || !params.target) return;
      setEdges((eds) => {
        const next = eds.filter((x) => x.source !== params.source && x.target !== params.target);
        const withNew = addEdge(
          {
            ...params,
            animated: true,
            style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
          },
          next
        );
        pushDefinition(nodesRef.current, withNew);
        return withNew;
      });
    },
    [readOnly, pushDefinition, setEdges]
  );

  const onNodesDelete: OnNodesDelete<Node> = React.useCallback(
    (deleted) => {
      if (readOnly) return;
      const ids = new Set(deleted.map((d) => d.id));
      const eds = edgesRef.current;
      let nextEdges = eds.filter((e) => !ids.has(e.source) && !ids.has(e.target));
      for (const d of deleted) {
        const inc = eds.find((e) => e.target === d.id);
        const out = eds.find((e) => e.source === d.id);
        if (inc && out && !ids.has(inc.source) && !ids.has(out.target)) {
          nextEdges = [
            ...nextEdges,
            {
              id: `e-${inc.source}-${out.target}-re`,
              source: inc.source,
              target: out.target,
              animated: true,
              style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
            },
          ];
        }
      }
      const nextNodes = nodesRef.current.filter((n) => !ids.has(n.id));
      setNodes(nextNodes);
      setEdges(nextEdges);
      pushDefinition(nextNodes, nextEdges);
      onSelectNode(null);
    },
    [readOnly, onSelectNode, pushDefinition, setEdges, setNodes]
  );

  const onNodeDragStop = React.useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (readOnly) return;
      setNodes((nds) => {
        const next = nds.map((n) => (n.id === node.id ? { ...n, position: node.position } : n));
        pushDefinition(next, edgesRef.current);
        return next;
      });
    },
    [readOnly, pushDefinition, setNodes]
  );

  const displayNodes = React.useMemo(
    () => nodes.map((n) => ({ ...n, selected: selectedNodeId === n.id })),
    [nodes, selectedNodeId]
  );

  return (
    <div className="h-[min(560px,70vh)] min-h-[420px] w-full rounded-xl border border-border bg-muted/20">
      <ReactFlow
        nodes={displayNodes}
        edges={edges}
        onNodesChange={readOnly ? undefined : onNodesChange}
        onEdgesChange={readOnly ? undefined : onEdgesChangeWrapped}
        onConnect={onConnect}
        onNodesDelete={onNodesDelete}
        onNodeDragStop={onNodeDragStop}
        nodeTypes={nodeTypes}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable
        deleteKeyCode={readOnly ? null : "Backspace"}
        onNodeClick={(_, n) => onSelectNode(n.id)}
        onPaneClick={() => onSelectNode(null)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        className="rounded-xl"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="!bg-muted/30" />
        <Controls className="!border-border !bg-card !shadow-md" />
        <MiniMap className="!border-border !bg-card" zoomable pannable />
      </ReactFlow>
    </div>
  );
}

/** Append a step at the end of the linear chain (after the current tail). */
export function appendStepToDefinition(def: WorkflowDefinition, newNode: WorkflowNode): WorkflowDefinition {
  const { nodes: rfNodes, edges: rfEdges } = defToFlow(def);
  const tailId = findTailNodeId(rfNodes, rfEdges);
  const tailWf = tailId ? def.nodes.find((n) => n.id === tailId) : undefined;
  const pos = tailWf?.position
    ? { x: tailWf.position.x + 300, y: tailWf.position.y }
    : { x: 48 + def.nodes.length * 300, y: 140 };
  const nodeWithPos = { ...newNode, position: pos } as WorkflowNode;
  if (!tailId) {
    const trig = def.nodes.find((n) => n.type === "trigger_manual");
    if (trig) {
      return {
        nodes: [...def.nodes, nodeWithPos],
        edges: [...def.edges, { source: trig.id, target: newNode.id }],
      };
    }
    return { nodes: [...def.nodes, nodeWithPos], edges: def.edges };
  }
  return {
    nodes: [...def.nodes, nodeWithPos],
    edges: [...def.edges, { source: tailId, target: newNode.id }],
  };
}
