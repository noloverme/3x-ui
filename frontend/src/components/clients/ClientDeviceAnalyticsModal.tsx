import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  Empty,
  Input,
  Modal,
  Segmented,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  theme,
  Tooltip,
  Typography,
} from 'antd';
import {
  ApartmentOutlined,
  CloseOutlined,
  DesktopOutlined,
  MobileOutlined,
  NodeIndexOutlined,
  ReloadOutlined,
  SearchOutlined,
  TableOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';

import { HttpUtil } from '@/utils';
import './ClientDeviceAnalyticsModal.css';

const { Text } = Typography;

export interface DeviceAnalyticsSubscription {
  subId: string;
  emails: string[];
  uuids: string[];
  deviceCount: number;
  deviceKeys: string[];
  sharedCount: number;
}

export interface DeviceAnalyticsDevice {
  key: string;
  fingerprint: string;
  deviceModel: string;
  deviceOs: string;
  osVersion: string;
  userAgent: string;
  ip: string;
  ips: string[];
  firstSeen: number;
  lastSeen: number;
  subIds: string[];
  emails: string[];
  isShared: boolean;
}

export interface DeviceAnalyticsData {
  stats: {
    totalSubscriptions: number;
    totalDevices: number;
    sharedDevices: number;
    totalIntersections: number;
  };
  subscriptions: DeviceAnalyticsSubscription[];
  devices: DeviceAnalyticsDevice[];
}

interface GraphNode {
  id: string;
  type: 'sub' | 'device';
  label: string;
  subLabel?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  isShared?: boolean;
  data: DeviceAnalyticsSubscription | DeviceAnalyticsDevice;
}

interface GraphLink {
  source: string;
  target: string;
}

interface ClientDeviceAnalyticsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function ClientDeviceAnalyticsModal({
  open,
  onClose,
}: ClientDeviceAnalyticsModalProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DeviceAnalyticsData | null>(null);
  const [viewMode, setViewMode] = useState<'graph' | 'table'>('graph');
  const [searchKey, setSearchKey] = useState('');
  const [onlyShared, setOnlyShared] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const selectedNodeRef = useRef<GraphNode | null>(null);

  useEffect(() => {
    selectedNodeRef.current = selectedNode;
  }, [selectedNode]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const draggedNodeRef = useRef<GraphNode | null>(null);
  const hoveredNodeRef = useRef<GraphNode | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const linksRef = useRef<GraphLink[]>([]);
  const animFrameIdRef = useRef<number | null>(null);

  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setLoading(true);
      setSelectedNode(null);
    }
  }

  const fetchAnalytics = useCallback(() => {
    setLoading(true);
    HttpUtil.get('/panel/api/clients/analytics/devices')
      .then((res: unknown) => {
        const msg = res as { success?: boolean; obj?: DeviceAnalyticsData };
        if (msg?.success && msg.obj) {
          setData(msg.obj);
        } else {
          setData(null);
        }
      })
      .catch(() => {
        setData(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!open) return;
    transformRef.current = { x: 0, y: 0, scale: 1 };
    let active = true;
    HttpUtil.get('/panel/api/clients/analytics/devices')
      .then((res: unknown) => {
        if (!active) return;
        const msg = res as { success?: boolean; obj?: DeviceAnalyticsData };
        if (msg?.success && msg.obj) {
          setData(msg.obj);
        } else {
          setData(null);
        }
      })
      .catch(() => {
        if (active) setData(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  // Filtered subscriptions and devices
  const { filteredSubs, filteredDevices } = useMemo(() => {
    if (!data) return { filteredSubs: [], filteredDevices: [] };

    const query = searchKey.trim().toLowerCase();

    const devMatches = (dev: DeviceAnalyticsDevice) => {
      if (onlyShared && !dev.isShared) return false;
      if (!query) return true;
      return (
        dev.fingerprint.toLowerCase().includes(query) ||
        dev.deviceModel.toLowerCase().includes(query) ||
        dev.deviceOs.toLowerCase().includes(query) ||
        dev.ip.toLowerCase().includes(query) ||
        dev.ips?.some((ip) => ip.toLowerCase().includes(query)) ||
        dev.emails?.some((e) => e.toLowerCase().includes(query)) ||
        dev.subIds?.some((s) => s.toLowerCase().includes(query))
      );
    };

    const devices = data.devices.filter(devMatches);
    const visibleSubIds = new Set<string>();
    devices.forEach((d) => d.subIds?.forEach((s) => visibleSubIds.add(s)));

    const subs = data.subscriptions.filter((sub) => {
      if (onlyShared && sub.sharedCount === 0) return false;
      if (!query) return true;
      return (
        visibleSubIds.has(sub.subId) ||
        sub.subId.toLowerCase().includes(query) ||
        sub.emails?.some((e) => e.toLowerCase().includes(query)) ||
        sub.uuids?.some((u) => u.toLowerCase().includes(query))
      );
    });

    return { filteredSubs: subs, filteredDevices: devices };
  }, [data, searchKey, onlyShared]);

  // Render canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const { x: panX, y: panY, scale } = transformRef.current;
    ctx.translate(panX, panY);
    ctx.scale(scale, scale);

    const nodes = nodesRef.current;
    const links = linksRef.current;
    const map = new Map<string, GraphNode>();
    nodes.forEach((n) => map.set(n.id, n));

    const activeHover = hoveredNodeRef.current;
    const activeSelected = selectedNodeRef.current;
    const activeTarget = activeHover || activeSelected;

    // Set of connected node IDs
    const connectedIds = new Set<string>();
    if (activeTarget) {
      connectedIds.add(activeTarget.id);
      links.forEach((l) => {
        if (l.source === activeTarget.id) connectedIds.add(l.target);
        if (l.target === activeTarget.id) connectedIds.add(l.source);
      });
    }

    // Draw Links
    for (const link of links) {
      const s = map.get(link.source);
      const t = map.get(link.target);
      if (!s || !t) continue;

      const isHighlighted = activeTarget && (s.id === activeTarget.id || t.id === activeTarget.id);
      const isDimmed = activeTarget && !isHighlighted;

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);

      if (isHighlighted) {
        ctx.strokeStyle = t.isShared ? '#ff7875' : '#4096ff';
        ctx.lineWidth = 2.5;
        ctx.globalAlpha = 1;
      } else if (isDimmed) {
        ctx.strokeStyle = '#434343';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.15;
      } else {
        ctx.strokeStyle = t.isShared ? 'rgba(255, 77, 79, 0.45)' : 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = t.isShared ? 1.8 : 1.2;
        ctx.globalAlpha = 0.8;
      }
      ctx.stroke();
    }

    ctx.globalAlpha = 1;

    // Draw Nodes
    for (const node of nodes) {
      const isHighlighted = !activeTarget || connectedIds.has(node.id);
      const isSelected = activeSelected?.id === node.id;
      const isHovered = activeHover?.id === node.id;

      ctx.save();
      ctx.globalAlpha = isHighlighted ? 1 : 0.25;

      // Glow halo for shared intersection nodes or selected
      if (node.isShared) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 77, 79, 0.25)';
        ctx.fill();
      }

      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Main circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.fill();
      ctx.strokeStyle = node.isShared ? '#ff4d4f' : 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = node.isShared ? 2 : 1;
      ctx.stroke();

      // Node label
      ctx.fillStyle = '#fff';
      ctx.font = node.type === 'sub' ? 'bold 11px sans-serif' : '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (node.type === 'sub') {
        ctx.fillText('SUB', node.x, node.y - 1);
      } else if (node.isShared) {
        const count = (node.data as DeviceAnalyticsDevice).subIds?.length || 2;
        ctx.fillText(`×${count}`, node.x, node.y);
      }

      // External label under the node
      ctx.font = '11px sans-serif';
      ctx.fillStyle = isHighlighted ? (node.isShared ? '#ff7875' : '#d9d9d9') : '#666';
      ctx.fillText(node.label, node.x, node.y + node.radius + 12);

      ctx.restore();
    }

    ctx.restore();
  }, []);

  // Build graph nodes & links whenever filtered data changes
  useEffect(() => {
    if (viewMode !== 'graph') return;

    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const nodeMap = new Map<string, GraphNode>();

    const width = 800;
    const height = 500;
    const centerX = width / 2;
    const centerY = height / 2;

    // Subscriptions
    const subCount = filteredSubs.length;
    filteredSubs.forEach((sub, i) => {
      const angle = (i / Math.max(subCount, 1)) * Math.PI * 2;
      const radius = 180 + (i % 2) * 40;
      const id = `sub-${sub.subId}`;
      const emailLabel = sub.emails?.[0] || sub.subId.slice(0, 8);
      const node: GraphNode = {
        id,
        type: 'sub',
        label: emailLabel,
        subLabel: `(${sub.deviceCount})`,
        x: centerX + Math.cos(angle) * radius + (Math.random() - 0.5) * 20,
        y: centerY + Math.sin(angle) * radius + (Math.random() - 0.5) * 20,
        vx: 0,
        vy: 0,
        radius: Math.min(28, Math.max(18, 14 + sub.deviceCount * 2)),
        color: '#1677ff',
        data: sub,
      };
      nodes.push(node);
      nodeMap.set(id, node);
    });

    // Devices
    filteredDevices.forEach((dev, i) => {
      const id = `dev-${dev.key}`;
      const isShared = dev.isShared;
      const label = dev.deviceModel || dev.fingerprint.slice(0, 8);
      const angle = (i / Math.max(filteredDevices.length, 1)) * Math.PI * 2;
      const initialRadius = isShared ? 70 : 260;

      const node: GraphNode = {
        id,
        type: 'device',
        label,
        subLabel: dev.fingerprint.slice(0, 6),
        x: centerX + Math.cos(angle) * initialRadius + (Math.random() - 0.5) * 30,
        y: centerY + Math.sin(angle) * initialRadius + (Math.random() - 0.5) * 30,
        vx: 0,
        vy: 0,
        radius: isShared ? 18 : 12,
        color: isShared ? '#ff4d4f' : '#52c41a',
        isShared,
        data: dev,
      };
      nodes.push(node);
      nodeMap.set(id, node);

      dev.subIds?.forEach((subId) => {
        const subNodeId = `sub-${subId}`;
        if (nodeMap.has(subNodeId)) {
          links.push({ source: subNodeId, target: id });
        }
      });
    });

    nodesRef.current = nodes;
    linksRef.current = links;

    // Simulation loop
    let stepCount = 0;
    const maxSteps = 300;

    function step() {
      const currentNodes = nodesRef.current;
      const currentLinks = linksRef.current;
      if (currentNodes.length === 0) return;

      // Repulsion between nodes
      for (let i = 0; i < currentNodes.length; i++) {
        for (let j = i + 1; j < currentNodes.length; j++) {
          const a = currentNodes[i];
          const b = currentNodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distSq = dx * dx + dy * dy || 1;
          const dist = Math.sqrt(distSq);
          const minDist = a.radius + b.radius + 30;

          if (dist < minDist * 3) {
            const force = (minDist * 40) / distSq;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            if (draggedNodeRef.current !== a) {
              a.vx -= fx;
              a.vy -= fy;
            }
            if (draggedNodeRef.current !== b) {
              b.vx += fx;
              b.vy += fy;
            }
          }
        }
      }

      // Link attraction
      const map = new Map<string, GraphNode>();
      currentNodes.forEach((n) => map.set(n.id, n));

      for (const link of currentLinks) {
        const source = map.get(link.source);
        const target = map.get(link.target);
        if (!source || !target) continue;

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const targetDist = 90;
        const force = (dist - targetDist) * 0.05;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (draggedNodeRef.current !== source) {
          source.vx += fx;
          source.vy += fy;
        }
        if (draggedNodeRef.current !== target) {
          target.vx -= fx;
          target.vy -= fy;
        }
      }

      // Center gravity & damping
      for (const node of currentNodes) {
        if (draggedNodeRef.current === node) continue;
        const dx = centerX - node.x;
        const dy = centerY - node.y;
        node.vx += dx * 0.002;
        node.vy += dy * 0.002;

        node.vx *= 0.85;
        node.vy *= 0.85;
        node.x += node.vx;
        node.y += node.vy;
      }

      renderCanvas();

      stepCount++;
      if (stepCount < maxSteps || draggedNodeRef.current) {
        animFrameIdRef.current = requestAnimationFrame(step);
      }
    }

    if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
    animFrameIdRef.current = requestAnimationFrame(step);

    return () => {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
    };
  }, [filteredSubs, filteredDevices, viewMode, renderCanvas]);

  // Re-render when selected node changes
  useEffect(() => {
    if (viewMode === 'graph') {
      renderCanvas();
    }
  }, [selectedNode, viewMode, renderCanvas]);

  // Pointer & interaction handlers
  function getCanvasCoords(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { x: panX, y: panY, scale } = transformRef.current;
    return {
      x: (e.clientX - rect.left - panX) / scale,
      y: (e.clientY - rect.top - panY) / scale,
    };
  }

  function findNodeAt(x: number, y: number): GraphNode | null {
    const nodes = nodesRef.current;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      const dx = node.x - x;
      const dy = node.y - y;
      if (dx * dx + dy * dy <= (node.radius + 6) * (node.radius + 6)) {
        return node;
      }
    }
    return null;
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const coords = getCanvasCoords(e);
    const hit = findNodeAt(coords.x, coords.y);
    if (hit) {
      draggedNodeRef.current = hit;
      setSelectedNode(hit);
    } else {
      isDraggingRef.current = true;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (draggedNodeRef.current) {
      const coords = getCanvasCoords(e);
      draggedNodeRef.current.x = coords.x;
      draggedNodeRef.current.y = coords.y;
      draggedNodeRef.current.vx = 0;
      draggedNodeRef.current.vy = 0;
      renderCanvas();
      return;
    }

    if (isDraggingRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      transformRef.current.x += dx;
      transformRef.current.y += dy;
      renderCanvas();
      return;
    }

    const coords = getCanvasCoords(e);
    const hit = findNodeAt(coords.x, coords.y);
    if (hoveredNodeRef.current !== hit) {
      hoveredNodeRef.current = hit;
      renderCanvas();
    }
  }

  function handleMouseUp() {
    isDraggingRef.current = false;
    draggedNodeRef.current = null;
  }

  function handleWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const { x: panX, y: panY, scale } = transformRef.current;
    const newScale = Math.min(3, Math.max(0.3, scale * zoomFactor));

    transformRef.current = {
      scale: newScale,
      x: mouseX - ((mouseX - panX) / scale) * newScale,
      y: mouseY - ((mouseY - panY) / scale) * newScale,
    };
    renderCanvas();
  }

  function resetZoom() {
    transformRef.current = { x: 0, y: 0, scale: 1 };
    renderCanvas();
  }

  function zoomIn() {
    transformRef.current.scale = Math.min(3, transformRef.current.scale * 1.2);
    renderCanvas();
  }

  function zoomOut() {
    transformRef.current.scale = Math.max(0.3, transformRef.current.scale / 1.2);
    renderCanvas();
  }

  const tableColumns = [
    {
      title: 'UUID / HWID',
      dataIndex: 'fingerprint',
      key: 'fingerprint',
      render: (fp: string, row: DeviceAnalyticsDevice) => (
        <Space direction="vertical" size={2}>
          <Space>
            <Text code copyable={{ text: row.key }}>
              {fp}
            </Text>
            {row.isShared && (
              <Badge
                count={`${row.subIds?.length || 2} ${t('pages.clients.sharedDevices')}`}
                style={{ backgroundColor: '#ff4d4f' }}
              />
            )}
          </Space>
        </Space>
      ),
    },
    {
      title: t('pages.clients.deviceModel') || 'Model / OS',
      dataIndex: 'deviceModel',
      key: 'deviceModel',
      render: (_: string, row: DeviceAnalyticsDevice) => (
        <Space size={6}>
          {row.deviceOs?.toLowerCase().includes('android') ||
          row.deviceOs?.toLowerCase().includes('ios') ? (
            <MobileOutlined aria-hidden />
          ) : (
            <DesktopOutlined aria-hidden />
          )}
          <span>
            {row.deviceModel || row.deviceOs || 'Unknown'} {row.osVersion && `(${row.osVersion})`}
          </span>
        </Space>
      ),
    },
    {
      title: 'IP',
      dataIndex: 'ip',
      key: 'ip',
      render: (ip: string, row: DeviceAnalyticsDevice) => (
        <Space wrap size={[4, 4]}>
          {row.ips?.length ? (
            row.ips.map((item) => (
              <Tag key={item} color="default">
                {item}
              </Tag>
            ))
          ) : ip ? (
            <Tag color="default">{ip}</Tag>
          ) : (
            <Text type="secondary">—</Text>
          )}
        </Space>
      ),
    },
    {
      title: t('pages.clients.subId') || 'Subscriptions',
      dataIndex: 'emails',
      key: 'emails',
      render: (emails: string[], row: DeviceAnalyticsDevice) => (
        <Space wrap size={[4, 4]}>
          {emails?.map((email) => (
            <Tag key={email} color={row.isShared ? 'red' : 'blue'}>
              {email}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: t('pages.clients.lastSeen') || 'Last Seen',
      dataIndex: 'lastSeen',
      key: 'lastSeen',
      render: (ts: number) => (ts ? new Date(ts).toLocaleString() : '—'),
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={1000}
      title={
        <Space>
          <ApartmentOutlined aria-hidden style={{ color: token.colorPrimary }} />
          <span>{t('pages.clients.deviceAnalyticsTitle')}</span>
        </Space>
      }
      footer={[
        <Button key="close" onClick={onClose}>
          {t('close')}
        </Button>,
      ]}
      className="device-analytics-modal"
    >
      {/* Overview Metric Cards */}
      <div className="device-analytics-stats">
        <div className="device-analytics-stat-card">
          <div className="device-analytics-stat-value" style={{ color: token.colorPrimary }}>
            {data?.stats?.totalSubscriptions ?? 0}
          </div>
          <div className="device-analytics-stat-label">{t('pages.clients.totalSubscriptions')}</div>
        </div>
        <div className="device-analytics-stat-card">
          <div className="device-analytics-stat-value" style={{ color: '#52c41a' }}>
            {data?.stats?.totalDevices ?? 0}
          </div>
          <div className="device-analytics-stat-label">{t('pages.clients.totalDevices')}</div>
        </div>
        <div
          className={`device-analytics-stat-card ${(data?.stats?.sharedDevices ?? 0) > 0 ? 'alert' : ''}`}
        >
          <div className="device-analytics-stat-value" style={{ color: '#ff4d4f' }}>
            {data?.stats?.sharedDevices ?? 0}
          </div>
          <div className="device-analytics-stat-label">{t('pages.clients.sharedDevices')}</div>
        </div>
      </div>

      {/* Toolbar Controls */}
      <div className="device-analytics-toolbar">
        <div className="device-analytics-toolbar-left">
          <Segmented
            value={viewMode}
            onChange={(val) => setViewMode(val as 'graph' | 'table')}
            options={[
              {
                label: t('pages.clients.viewGraph'),
                value: 'graph',
                icon: <NodeIndexOutlined aria-hidden />,
              },
              {
                label: t('pages.clients.viewTable'),
                value: 'table',
                icon: <TableOutlined aria-hidden />,
              },
            ]}
          />
          <Input
            value={searchKey}
            onChange={(e) => setSearchKey(e.target.value)}
            placeholder={t('pages.clients.searchPlaceholder')}
            aria-label={t('pages.clients.searchPlaceholder')}
            prefix={<SearchOutlined aria-hidden />}
            allowClear
            style={{ width: 220 }}
          />
          <Space>
            <Switch
              checked={onlyShared}
              onChange={setOnlyShared}
              size="small"
              aria-label={t('pages.clients.onlyIntersections')}
            />
            <Text style={{ fontSize: 13 }}>{t('pages.clients.onlyIntersections')}</Text>
          </Space>
        </div>

        <div className="device-analytics-toolbar-right">
          <Tooltip title={t('reload')}>
            <Button
              icon={<ReloadOutlined aria-hidden spin={loading} />}
              onClick={fetchAnalytics}
              loading={loading}
              aria-label={t('reload')}
            />
          </Tooltip>
        </div>
      </div>

      {/* Main Content: Graph or Table */}
      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <Spin size="large" />
        </div>
      ) : data?.devices?.length === 0 ? (
        <Empty description={t('pages.clients.noDevicesFound')} style={{ padding: '60px 0' }} />
      ) : viewMode === 'graph' ? (
        <div className="device-analytics-canvas-container">
          <canvas
            ref={canvasRef}
            className="device-analytics-canvas"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
          />

          {/* Graph Controls */}
          <div className="device-analytics-graph-controls">
            <Button
              size="small"
              aria-label="Zoom in"
              icon={<ZoomInOutlined aria-hidden />}
              onClick={zoomIn}
            />
            <Button
              size="small"
              aria-label="Zoom out"
              icon={<ZoomOutOutlined aria-hidden />}
              onClick={zoomOut}
            />
            <Button size="small" onClick={resetZoom}>
              1:1
            </Button>
          </div>

          {/* Legend */}
          <div className="device-analytics-legend">
            <div className="device-analytics-legend-item">
              <div className="device-analytics-legend-dot" style={{ backgroundColor: '#1677ff' }} />
              <span>{t('pages.clients.subId')}</span>
            </div>
            <div className="device-analytics-legend-item">
              <div className="device-analytics-legend-dot" style={{ backgroundColor: '#52c41a' }} />
              <span>{t('pages.clients.hwidDevice')}</span>
            </div>
            <div className="device-analytics-legend-item">
              <div className="device-analytics-legend-dot" style={{ backgroundColor: '#ff4d4f' }} />
              <span>{t('pages.clients.sharedDevices')}</span>
            </div>
          </div>

          {/* Inspector Card / Drawer for Selected Node */}
          {selectedNode && (
            <div className="device-analytics-details-drawer">
              <div className="device-analytics-details-header">
                <Text strong style={{ fontSize: 13 }}>
                  {selectedNode.type === 'sub'
                    ? t('pages.clients.subscriptionDetails')
                    : t('pages.clients.deviceDetails')}
                </Text>
                <Button
                  type="text"
                  size="small"
                  aria-label={t('close')}
                  icon={<CloseOutlined aria-hidden />}
                  onClick={() => setSelectedNode(null)}
                />
              </div>

              {selectedNode.type === 'sub' ? (
                <>
                  <div className="device-analytics-details-row">
                    <div className="device-analytics-details-label">{t('pages.clients.subId')}</div>
                    <div className="device-analytics-details-val">
                      <Text code copyable>
                        {(selectedNode.data as DeviceAnalyticsSubscription).subId}
                      </Text>
                    </div>
                  </div>
                  <div className="device-analytics-details-row">
                    <div className="device-analytics-details-label">{t('pages.clients.email')}</div>
                    <div className="device-analytics-details-val">
                      {(selectedNode.data as DeviceAnalyticsSubscription).emails?.map((e) => (
                        <Tag key={e} color="blue">
                          {e}
                        </Tag>
                      ))}
                    </div>
                  </div>
                  <div className="device-analytics-details-row">
                    <div className="device-analytics-details-label">
                      {t('pages.clients.totalDevices')}
                    </div>
                    <div className="device-analytics-details-val">
                      {(selectedNode.data as DeviceAnalyticsSubscription).deviceCount}
                    </div>
                  </div>
                  {(selectedNode.data as DeviceAnalyticsSubscription).sharedCount > 0 && (
                    <div className="device-analytics-details-row">
                      <div className="device-analytics-details-label">
                        {t('pages.clients.sharedDevices')}
                      </div>
                      <div className="device-analytics-details-val" style={{ color: '#ff4d4f' }}>
                        {(selectedNode.data as DeviceAnalyticsSubscription).sharedCount}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="device-analytics-details-row">
                    <div className="device-analytics-details-label">Fingerprint / Key</div>
                    <div className="device-analytics-details-val">
                      <Text
                        code
                        copyable={{ text: (selectedNode.data as DeviceAnalyticsDevice).key }}
                      >
                        {(selectedNode.data as DeviceAnalyticsDevice).fingerprint}
                      </Text>
                    </div>
                  </div>
                  <div className="device-analytics-details-row">
                    <div className="device-analytics-details-label">
                      {t('pages.clients.deviceModel') || 'Model & OS'}
                    </div>
                    <div className="device-analytics-details-val">
                      {(selectedNode.data as DeviceAnalyticsDevice).deviceModel || 'Unknown'}{' '}
                      {(selectedNode.data as DeviceAnalyticsDevice).deviceOs &&
                        `(${(selectedNode.data as DeviceAnalyticsDevice).deviceOs})`}
                    </div>
                  </div>
                  <div className="device-analytics-details-row">
                    <div className="device-analytics-details-label">IPs</div>
                    <div className="device-analytics-details-val">
                      {(selectedNode.data as DeviceAnalyticsDevice).ips?.length ? (
                        (selectedNode.data as DeviceAnalyticsDevice).ips.map((ip) => (
                          <Tag key={ip} color="default">
                            {ip}
                          </Tag>
                        ))
                      ) : (selectedNode.data as DeviceAnalyticsDevice).ip ? (
                        <Tag color="default">{(selectedNode.data as DeviceAnalyticsDevice).ip}</Tag>
                      ) : (
                        '—'
                      )}
                    </div>
                  </div>
                  <div className="device-analytics-details-row">
                    <div className="device-analytics-details-label">
                      {t('pages.clients.subId')} ({t('pages.clients.email')})
                    </div>
                    <div className="device-analytics-details-val">
                      {(selectedNode.data as DeviceAnalyticsDevice).emails?.map((e) => (
                        <Tag
                          key={e}
                          color={
                            (selectedNode.data as DeviceAnalyticsDevice).isShared ? 'red' : 'blue'
                          }
                        >
                          {e}
                        </Tag>
                      ))}
                    </div>
                  </div>
                  <div className="device-analytics-details-row">
                    <div className="device-analytics-details-label">
                      {t('pages.clients.lastSeen')}
                    </div>
                    <div className="device-analytics-details-val">
                      {(selectedNode.data as DeviceAnalyticsDevice).lastSeen
                        ? new Date(
                            (selectedNode.data as DeviceAnalyticsDevice).lastSeen,
                          ).toLocaleString()
                        : '—'}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <Table
          dataSource={filteredDevices}
          columns={tableColumns}
          rowKey="key"
          size="small"
          pagination={{ pageSize: 8, showSizeChanger: true }}
          style={{ marginTop: 8 }}
        />
      )}
    </Modal>
  );
}
