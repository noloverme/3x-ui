import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Modal, Select, Space, Tag, Typography, message } from 'antd';
import {
  CheckCircleOutlined,
  CheckSquareOutlined,
  ClearOutlined,
  UsergroupAddOutlined,
} from '@ant-design/icons';

import { HttpUtil } from '@/utils';
import type { ClientRecord, InboundOption } from '@/hooks/useClients';
import { formatInboundLabel } from '@/lib/inbounds/label';
import type { BulkAttachResult } from '@/schemas/client';

const { Text } = Typography;

const MULTI_USER_PROTOCOLS = new Set([
  'vmess',
  'vless',
  'trojan',
  'hysteria',
  'shadowsocks',
  'wireguard',
  'mtproto',
  'amneziawg',
  'tuic',
]);

interface BulkAttachInboundsModalProps {
  open: boolean;
  selectedEmails?: string[];
  clients?: ClientRecord[];
  inbounds: InboundOption[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (emails: string[], inboundIds: number[]) => Promise<BulkAttachResult | null>;
}

export default function BulkAttachInboundsModal({
  open,
  selectedEmails = [],
  clients = [],
  inbounds = [],
  onOpenChange,
  onSubmit,
}: BulkAttachInboundsModalProps) {
  const { t } = useTranslation();
  const [messageApi, messageContextHolder] = message.useMessage();
  const [submitting, setSubmitting] = useState(false);

  // Target inbounds
  const [targetIds, setTargetIds] = useState<number[]>([]);
  // Target client emails
  const [targetEmails, setTargetEmails] = useState<string[]>([]);
  // Full client list (fetches /panel/api/clients/list if needed)
  const [fetchedClients, setFetchedClients] = useState<ClientRecord[]>([]);

  // Synchronize selection when modal opens
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTargetIds([]);
      setTargetEmails([...selectedEmails]);
    }
  }

  // Load all clients from API on open so users see the entire client database
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    HttpUtil.get('/panel/api/clients/list', undefined, { silent: true })
      .then((res) => {
        if (cancelled) return;
        if (Array.isArray(res?.obj)) {
          setFetchedClients(res.obj as ClientRecord[]);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Combined client list
  const combinedClients = useMemo(() => {
    const map = new Map<string, ClientRecord>();
    for (const c of clients) {
      if (c?.email) map.set(c.email.toLowerCase(), c);
    }
    for (const c of fetchedClients) {
      if (c?.email && !map.has(c.email.toLowerCase())) {
        map.set(c.email.toLowerCase(), c);
      }
    }
    return Array.from(map.values());
  }, [clients, fetchedClients]);

  // Client select options
  const clientOptions = useMemo(() => {
    return combinedClients.map((c) => ({
      value: c.email,
      label: c.group ? `${c.email} (${c.group})` : c.email,
    }));
  }, [combinedClients]);

  // Inbound select options
  const targetOptions = useMemo(() => {
    return (inbounds || [])
      .filter((ib) => MULTI_USER_PROTOCOLS.has((ib.protocol || '').toLowerCase()))
      .map((ib) => {
        const proto = (ib.protocol || '').toUpperCase();
        const portStr = ib.port ? `:${ib.port}` : '';
        const remark = formatInboundLabel(ib.tag, ib.remark);
        return {
          value: ib.id,
          label: `[${proto}${portStr}] ${remark}`.trim(),
          protocol: proto,
          port: ib.port,
          remark,
        };
      });
  }, [inbounds]);

  // Selection helpers
  const selectAllClients = () => {
    setTargetEmails(clientOptions.map((c) => c.value));
  };
  const clearClients = () => {
    setTargetEmails([]);
  };

  const selectAllInbounds = () => {
    setTargetIds(targetOptions.map((ib) => ib.value));
  };
  const clearInbounds = () => {
    setTargetIds([]);
  };

  const selectAllEverything = () => {
    selectAllClients();
    selectAllInbounds();
  };

  async function submit() {
    if (targetEmails.length === 0 || targetIds.length === 0) return;
    setSubmitting(true);
    try {
      const result = await onSubmit(targetEmails, targetIds);
      if (!result) return;
      const attached = result.attached?.length ?? 0;
      const skipped = result.skipped?.length ?? 0;
      const errors = result.errors?.length ?? 0;
      if (errors > 0) {
        messageApi.warning(
          `Прикреплено: ${attached}, пропущено (уже были): ${skipped}, ошибок: ${errors}`,
        );
      } else {
        messageApi.success(`Успешно прикреплено: ${attached}, пропущено (уже были): ${skipped}`);
      }
      onOpenChange(false);
    } catch (_err: unknown) {
      messageApi.error('Не удалось привязать протоколы к клиентам');
    } finally {
      setSubmitting(false);
    }
  }

  const isAllSelected =
    clientOptions.length > 0 &&
    targetOptions.length > 0 &&
    targetEmails.length === clientOptions.length &&
    targetIds.length === targetOptions.length;

  return (
    <>
      {messageContextHolder}
      <Modal
        open={open}
        title={
          <Space>
            <UsergroupAddOutlined />
            <span>Привязка протоколов (соединений) к клиентам</span>
          </Space>
        }
        okText={`Привязать (${targetEmails.length} клиентов к ${targetIds.length} протоколам)`}
        cancelText={t('cancel')}
        okButtonProps={{
          disabled: targetEmails.length === 0 || targetIds.length === 0,
          loading: submitting,
        }}
        onCancel={() => onOpenChange(false)}
        onOk={submit}
        width={680}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          className="mb-12"
          message="Массовое добавление протоколов к клиентам"
          description="Выберите клиентов и протоколы (входящие соединения). Выбранные протоколы добавятся к клиентам с сохранением учетных данных и лимитов. Если у клиента протокол уже был — он будет пропущен без дублирования."
        />

        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            icon={<CheckSquareOutlined />}
            type={isAllSelected ? 'primary' : 'default'}
            onClick={selectAllEverything}
          >
            Выбрать всё (все клиенты и протоколы)
          </Button>
        </div>

        {/* Section 1: Clients */}
        <Card
          size="small"
          title={
            <Space>
              <Text strong>Клиенты</Text>
              <Tag color="blue">
                {targetEmails.length} / {clientOptions.length}
              </Tag>
            </Space>
          }
          extra={
            <Space size={4}>
              <Button size="small" icon={<CheckCircleOutlined />} onClick={selectAllClients}>
                Выбрать всех
              </Button>
              <Button size="small" icon={<ClearOutlined />} onClick={clearClients}>
                Очистить
              </Button>
            </Space>
          }
          style={{ marginBottom: 16 }}
        >
          <Select
            mode="multiple"
            style={{ width: '100%' }}
            value={targetEmails}
            onChange={setTargetEmails}
            options={clientOptions}
            placeholder="Выберите клиентов из списка..."
            showSearch={{ optionFilterProp: 'label' }}
            maxTagCount="responsive"
            allowClear
          />
        </Card>

        {/* Section 2: Inbounds / Protocols */}
        <Card
          size="small"
          title={
            <Space>
              <Text strong>Протоколы (соединения)</Text>
              <Tag color="purple">
                {targetIds.length} / {targetOptions.length}
              </Tag>
            </Space>
          }
          extra={
            <Space size={4}>
              <Button size="small" icon={<CheckCircleOutlined />} onClick={selectAllInbounds}>
                Выбрать все
              </Button>
              <Button size="small" icon={<ClearOutlined />} onClick={clearInbounds}>
                Очистить
              </Button>
            </Space>
          }
        >
          {targetOptions.length === 0 ? (
            <Alert type="warning" showIcon message={t('pages.clients.attachToInboundsNoTargets')} />
          ) : (
            <Select
              mode="multiple"
              style={{ width: '100%' }}
              value={targetIds}
              onChange={setTargetIds}
              options={targetOptions}
              placeholder="Выберите протоколы (входящие)..."
              showSearch={{ optionFilterProp: 'label' }}
              maxTagCount="responsive"
              allowClear
            />
          )}
        </Card>
      </Modal>
    </>
  );
}
