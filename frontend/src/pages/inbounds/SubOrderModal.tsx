import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Modal, Radio, Space, Tag, Tooltip, Typography, message } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CheckCircleOutlined,
  ClearOutlined,
  OrderedListOutlined,
} from '@ant-design/icons';

import { HttpUtil } from '@/utils';
import type { DBInbound } from '@/models/dbinbound';

const { Text } = Typography;

interface SubOrderModalProps {
  open: boolean;
  dbInbounds: DBInbound[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export default function SubOrderModal({ open, dbInbounds, onClose, onSaved }: SubOrderModalProps) {
  const { t } = useTranslation();
  const [messageApi, messageContextHolder] = message.useMessage();
  const [saving, setSaving] = useState(false);

  // orderedIds stores inbounds chosen in order by user clicks: [id1, id2, id3...]
  const [orderedIds, setOrderedIds] = useState<number[]>(() =>
    [...dbInbounds]
      .filter((ib) => (ib.subSortIndex ?? 1) !== 1)
      .sort((a, b) => (a.subSortIndex ?? 1) - (b.subSortIndex ?? 1))
      .map((ib) => ib.id),
  );
  // mode: 'chosenFirst' (selected 1, 2, 3... unchosen at end 100) or 'literal' (unchosen 1, selected 2, 3, 4...)
  const [mode, setMode] = useState<'chosenFirst' | 'literal'>('chosenFirst');

  // Map for fast lookup of an inbound's rank in orderedIds (1-indexed)
  const rankMap = useMemo(() => {
    const map = new Map<number, number>();
    orderedIds.forEach((id, idx) => {
      map.set(id, idx + 1);
    });
    return map;
  }, [orderedIds]);

  const toggleInbound = (id: number) => {
    setOrderedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((i) => i !== id);
      }
      return [...prev, id];
    });
  };

  const moveUp = (index: number) => {
    if (index <= 0) return;
    setOrderedIds((prev) => {
      const next = [...prev];
      const temp = next[index - 1];
      next[index - 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const moveDown = (index: number) => {
    if (index >= orderedIds.length - 1) return;
    setOrderedIds((prev) => {
      const next = [...prev];
      const temp = next[index + 1];
      next[index + 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const handleSelectAll = () => {
    setOrderedIds(dbInbounds.map((ib) => ib.id));
  };

  const handleClear = () => {
    setOrderedIds([]);
  };

  // Compute final subSortIndex for an inbound
  const computeFinalIndex = (id: number): number => {
    const rank = rankMap.get(id);
    if (rank !== undefined) {
      return mode === 'literal' ? rank + 1 : rank;
    }
    // Unselected
    return mode === 'literal' ? 1 : 100;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let changedCount = 0;
      for (const ib of dbInbounds) {
        const targetIndex = computeFinalIndex(ib.id);
        const currentIndex = ib.subSortIndex ?? 1;
        if (targetIndex !== currentIndex) {
          changedCount++;
          const res = await HttpUtil.post(`/panel/api/inbounds/${ib.id}/subSortIndex`, {
            subSortIndex: targetIndex,
          });
          if (!res?.success) {
            messageApi.error(`Ошибка при сохранении для порта ${ib.port}`);
          }
        }
      }
      messageApi.success(
        changedCount > 0
          ? `Порядок в подписке успешно сохранён (${changedCount} обновлено)`
          : 'Порядок в подписке не изменился',
      );
      await onSaved();
      onClose();
    } catch (_err: unknown) {
      messageApi.error('Не удалось сохранить порядок в подписке');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={
        <Space>
          <OrderedListOutlined />
          <span>Порядок протоколов в подписке</span>
        </Space>
      }
      onCancel={onClose}
      width={720}
      footer={[
        <Button key="cancel" onClick={onClose} disabled={saving}>
          {t('cancel')}
        </Button>,
        <Button key="save" type="primary" loading={saving} onClick={handleSave}>
          {t('save')}
        </Button>,
      ]}
    >
      {messageContextHolder}

      <Alert
        type="info"
        showIcon
        className="mb-12"
        message="Настройка порядка выдачи ссылок в подписке"
        description="Кликайте по входящим по очереди, чтобы задать порядок их появления в клиентских приложениях. При клике присваивается следующий номер по порядку."
      />

      <div style={{ marginBottom: 12 }}>
        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space>
            <Button size="small" icon={<CheckCircleOutlined />} onClick={handleSelectAll}>
              Выбрать все
            </Button>
            <Button size="small" icon={<ClearOutlined />} onClick={handleClear}>
              Сбросить все (по умолчанию)
            </Button>
          </Space>
          <Radio.Group
            size="small"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            optionType="button"
            buttonStyle="solid"
          >
            <Tooltip title="Выбранные получат номера 1, 2, 3... и появятся первыми; невыбранные пойдут в конец (100)">
              <Radio.Button value="chosenFirst">Выбранные первыми (1, 2, 3...)</Radio.Button>
            </Tooltip>
            <Tooltip title="Невыбранные останутся со значением 1, выбранные получат 2, 3, 4...">
              <Radio.Button value="literal">Невыбранные = 1</Radio.Button>
            </Tooltip>
          </Radio.Group>
        </Space>
      </div>

      <div style={{ maxHeight: '52vh', overflowY: 'auto', paddingRight: 4 }}>
        <Space direction="vertical" style={{ width: '100%' }} size={6}>
          {dbInbounds.map((ib) => {
            const isSelected = rankMap.has(ib.id);
            const rank = rankMap.get(ib.id);
            const finalIndex = computeFinalIndex(ib.id);
            const indexInSelected = isSelected ? orderedIds.indexOf(ib.id) : -1;

            return (
              <Card
                key={ib.id}
                size="small"
                hoverable
                onClick={() => toggleInbound(ib.id)}
                style={{
                  cursor: 'pointer',
                  borderColor: isSelected ? '#1677ff' : undefined,
                  backgroundColor: isSelected ? 'rgba(22, 119, 255, 0.05)' : undefined,
                }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Space align="center" style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ minWidth: 38, textAlign: 'center' }}>
                      {isSelected ? (
                        <Tag
                          color="blue"
                          style={{ fontSize: 13, fontWeight: 'bold', padding: '1px 8px' }}
                        >
                          #{rank}
                        </Tag>
                      ) : (
                        <Tag style={{ fontSize: 12, padding: '1px 6px', opacity: 0.6 }}>
                          {mode === 'literal' ? '1' : '—'}
                        </Tag>
                      )}
                    </div>
                    <Tag color="purple">{ib.protocol}</Tag>
                    <Text strong style={{ minWidth: 60 }}>
                      :{ib.port}
                    </Text>
                    {ib.remark ? (
                      <Text type="secondary" ellipsis style={{ maxWidth: 220 }}>
                        {ib.remark}
                      </Text>
                    ) : null}
                  </Space>

                  <Space size={4} onClick={(e) => e.stopPropagation()}>
                    <Tag color={isSelected ? 'geekblue' : 'default'} style={{ fontSize: 11 }}>
                      Индекс: {finalIndex}
                    </Tag>
                    {isSelected && (
                      <>
                        <Button
                          size="small"
                          type="text"
                          icon={<ArrowUpOutlined />}
                          disabled={indexInSelected === 0}
                          onClick={() => moveUp(indexInSelected)}
                          title="Выше"
                        />
                        <Button
                          size="small"
                          type="text"
                          icon={<ArrowDownOutlined />}
                          disabled={indexInSelected === orderedIds.length - 1}
                          onClick={() => moveDown(indexInSelected)}
                          title="Ниже"
                        />
                      </>
                    )}
                  </Space>
                </div>
              </Card>
            );
          })}
        </Space>
      </div>
    </Modal>
  );
}
