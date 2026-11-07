import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Input, List, Space, Spin, Tag, Typography, message } from "antd";
import { ArchiveOutlined, ReloadOutlined, SaveOutlined } from "@ant-design/icons";

const { Text, Paragraph } = Typography;
type ActiveReference = { name: string; chars: number; updatedAt: string };
type HistoryReference = { name: string; version: string; chars: number; updatedAt: string };
type ResponseData = { active: ActiveReference[]; history: HistoryReference[] };

export default function StyleReferencesPanel({ worldId }: { worldId: string }) {
  const [data, setData] = useState<ResponseData>({ active: [], history: [] });
  const [name, setName] = useState("style-reference.md");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/worlds/${encodeURIComponent(worldId)}/style-references`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "读取 Style Reference 失败");
      setData(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }, [worldId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async () => {
    if (!name.trim() || !content.trim()) { setError("请填写文件名和样本文本。"); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/worlds/${encodeURIComponent(worldId)}/style-references`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), content })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "保存失败");
      setData({ active: body.active, history: body.history });
      message.success(body.result.action === "unchanged" ? "内容没有变化" : body.result.action === "updated" ? "已更新，旧版本已归档" : "已添加认可样本");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };

  const loadVersion = async (item: HistoryReference) => {
    setError("");
    try {
      const response = await fetch(`/api/worlds/${encodeURIComponent(worldId)}/style-references/${encodeURIComponent(item.name)}/history/${encodeURIComponent(item.version)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "读取历史版本失败");
      setName(item.name); setContent(body.content);
      message.info("历史版本已载入编辑框；点击“保存样本”即可恢复为活动版本");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const archive = async (filename: string) => {
    setError("");
    try {
      const response = await fetch(`/api/worlds/${encodeURIComponent(worldId)}/style-references/${encodeURIComponent(filename)}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "归档失败");
      setData({ active: body.active, history: body.history });
      message.success("已归档；历史版本仍保留");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="认可的 Style Reference 样本" extra={<Button icon={<ReloadOutlined />} onClick={() => void refresh()}>刷新</Button>}>
        <Paragraph type="secondary">
          只有活动样本会进入逐章风格回归。更新前自动归档旧版本；移除样本也只归档，不会删除历史内容。
          这些样本用于观察和参考，不是模仿模板或写作硬约束。
        </Paragraph>
        {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
        <Spin spinning={loading}>
          {data.active.length ? (
            <List
              dataSource={data.active}
              renderItem={item => (
                <List.Item
                  actions={[<Button key="archive" danger type="text" icon={<ArchiveOutlined />} onClick={() => void archive(item.name)}>归档</Button>]}
                >
                  <List.Item.Meta
                    title={<Text strong>{item.name}</Text>}
                    description={<Text type="secondary">{item.chars.toLocaleString()} 字符 · 更新于 {new Date(item.updatedAt).toLocaleString()}</Text>}
                  />
                </List.Item>
              )}
            />
          ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有认可样本" />}
        </Spin>
      </Card>
      <Card title="添加或更新样本">
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <Input value={name} onChange={event => setName(event.target.value)} placeholder="文件名，例如 dialogue.md" />
          <Input.TextArea value={content} onChange={event => setContent(event.target.value)} rows={12} maxLength={200000} showCount placeholder="粘贴你认可的小说原文片段。建议按叙述、对白或动作场景分别保存。" />
          <Space>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>保存样本</Button>
            <Button onClick={() => { setName("style-reference.md"); setContent(""); }}>清空</Button>
          </Space>
        </Space>
      </Card>
      <Card title={<Space>历史版本 <Tag>{data.history.length}</Tag></Space>}>
        {data.history.length ? (
          <List
            dataSource={data.history}
            renderItem={item => (
              <List.Item actions={[<Button key="restore" type="link" onClick={() => void loadVersion(item)}>查看 / 恢复</Button>]}>
                <List.Item.Meta
                  title={<Text>{item.name}</Text>}
                  description={<Text type="secondary">{item.version} · {item.chars.toLocaleString()} 字符 · {new Date(item.updatedAt).toLocaleString()}</Text>}
                />
              </List.Item>
            )}
          />
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无归档版本" />}
      </Card>
    </Space>
  );
}
