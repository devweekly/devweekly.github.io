import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Input, List, Select, Space, Spin, Tag, Typography, message } from "antd";

type Evidence = { runId: string; quote: string; source: string };
type Compass = { content: string; history: Array<{ version: string; chars: number; updatedAt: string }> };
type Memory = {
  memoryId: string; memoryType: "narrative" | "creative" | "operational";
  content: string; scope: string; evidence: Evidence[]; occurrences: number;
  status: "candidate" | "active" | "superseded" | "rejected";
  createdAt: string; updatedAt: string; lastSeenAt: string;
};
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? response.statusText);
  return body as T;
}
const statusLabel: Record<Memory["status"], string> = {
  candidate: "待观察", active: "可检索", superseded: "已替代", rejected: "已淘汰"
};
const typeLabel: Record<Memory["memoryType"], string> = {
  narrative: "叙事经验", creative: "创意线索", operational: "流程经验"
};

export default function StoryMemoryPanel({ worldId }: { worldId: string }) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [compass, setCompass] = useState<Compass>({ content: "", history: [] });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { content: string; scope: string }>>({});
  const [filter, setFilter] = useState("all");
  const refresh = useCallback(async () => {
    if (!worldId) return;
    setLoading(true);
    try {
      const [data, compassData] = await Promise.all([
        api<{ memories: Memory[] }>(`/api/worlds/${worldId}/story-memories?status=${filter}`),
        api<Compass>(`/api/worlds/${worldId}/story-memory/compass`)
      ]);
      setMemories(data.memories);
      setCompass(compassData);
      setDrafts(Object.fromEntries(data.memories.map(item => [item.memoryId, { content: item.content, scope: item.scope }])));
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }, [worldId, filter]);
  useEffect(() => { void refresh(); }, [refresh]);

  const update = async (memory: Memory, changes: Partial<Pick<Memory, "status">> & { content?: string; scope?: string }) => {
    setSaving(memory.memoryId);
    try {
      await api(`/api/worlds/${worldId}/story-memories/${memory.memoryId}`, { method: "PATCH", body: JSON.stringify(changes) });
      message.success("记忆已更新");
      await refresh();
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(""); }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        message="记忆是可修订的创作经验，不是剧情事实或写作规则"
        description="只有跨独立故事单元重复得到证据支持的候选记忆才会自动进入写作检索。原始引用始终保留；当前人物状态、事件和伏笔仍以 Story State 与故事图谱为准。"
      />
      <Card title="Creative Compass" extra={<Tag>{compass.history.length} 个历史版本</Tag>}>
        {compass.content.trim()
          ? <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 12 }}>{compass.content}</Typography.Paragraph>
          : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未形成创作方向摘要；完整故事单元自然收束后会自动整理。" />}
        {compass.history.length > 0 && (
          <>
            <Typography.Text type="secondary">历史版本（仅供追溯，不参与写作检索）</Typography.Text>
            <List
              size="small"
              dataSource={compass.history}
              rowKey="version"
              renderItem={item => <List.Item>
                <Space direction="vertical" size={0}>
                  <Typography.Text code>{item.version}</Typography.Text>
                  <Typography.Text type="secondary">{item.chars} 字 · {new Date(item.updatedAt).toLocaleString()}</Typography.Text>
                </Space>
              </List.Item>}
            />
          </>
        )}
      </Card>
      <Card title="Story Memory" extra={<Space><Select value={filter} style={{ width: 130 }} onChange={setFilter} options={[{value:"all",label:"全部状态"},{value:"candidate",label:"待观察"},{value:"active",label:"可检索"},{value:"superseded",label:"已替代"},{value:"rejected",label:"已淘汰"}]} /><Button onClick={() => void refresh()}>刷新</Button></Space>}>
        <Spin spinning={loading}>
          {memories.length === 0 ? <Empty description="还没有可用的长期记忆；故事单元自然收束后会自动整理，宁缺毋滥。" /> : (
            <List
              dataSource={memories}
              rowKey="memoryId"
              itemLayout="vertical"
              renderItem={item => {
                const draft = drafts[item.memoryId] ?? { content: item.content, scope: item.scope };
                return (
                  <List.Item>
                    <Card size="small" style={{ width: "100%" }} title={<Space wrap><Tag color={item.status === "active" ? "success" : "default"}>{statusLabel[item.status]}</Tag><Tag>{typeLabel[item.memoryType]}</Tag><Tag>{item.occurrences} 个独立故事单元证据</Tag></Space>} extra={<Typography.Text type="secondary">{item.memoryId.slice(0,8)}</Typography.Text>}>
                      <Space direction="vertical" style={{ width: "100%" }}>
                        <Input.TextArea value={draft.content} autoSize={{ minRows: 2, maxRows: 5 }} maxLength={600} onChange={event => setDrafts(current => ({...current,[item.memoryId]:{...draft,content:event.target.value}}))} />
                        <Input value={draft.scope} maxLength={120} placeholder="适用范围" onChange={event => setDrafts(current => ({...current,[item.memoryId]:{...draft,scope:event.target.value}}))} />
                        <Space wrap>
                          <Button type="primary" loading={saving === item.memoryId} onClick={() => void update(item, {content:draft.content,scope:draft.scope})}>保存修订</Button>
                          {item.status !== "rejected" && <Button danger loading={saving === item.memoryId} onClick={() => void update(item,{status:"rejected"})}>淘汰</Button>}
                          {item.status !== "superseded" && <Button loading={saving === item.memoryId} onClick={() => void update(item,{status:"superseded"})}>标记已替代</Button>}
                          {item.status === "rejected" || item.status === "superseded" ? <Button loading={saving === item.memoryId} disabled={item.occurrences < 2} onClick={() => void update(item,{status:"active"})}>恢复检索</Button> : null}
                        </Space>
                        <Typography.Text type="secondary">证据来源</Typography.Text>
                        {item.evidence.map((evidence,index) => (
                          <Card key={evidence.runId + evidence.source} size="small" type="inner">
                            <Typography.Text code>{evidence.source}</Typography.Text>
                            <Typography.Paragraph style={{ marginTop: 8, marginBottom: 4 }}>{evidence.quote}</Typography.Paragraph>
                            <Typography.Text type="secondary">故事执行 {evidence.runId.slice(0,8)}</Typography.Text>
                          </Card>
                        ))}
                      </Space>
                    </Card>
                  </List.Item>
                );
              }}
            />
          )}
        </Spin>
      </Card>
    </Space>
  );
}
