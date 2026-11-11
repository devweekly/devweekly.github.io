// Workbench 主界面：看板、长期主线、人物、故事图谱、文风样本与运行记录。
// 本组件只做导航与数据展示；各面板的细节逻辑在各自的 *Panel 组件里，
// API 响应结构由 src/server.ts 定义，两边的字段保持一一对应。
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert, App as AntApp, Button, Card, Col, Descriptions, Empty, Layout, List, Menu,
  Row, Select, Space, Spin, Statistic, Tag, Typography
} from "antd";
import {
  ApartmentOutlined, BookOutlined, DashboardOutlined, FileTextOutlined,
  HistoryOutlined, PlayCircleOutlined, ReloadOutlined, UserOutlined, BulbOutlined
} from "@ant-design/icons";
import CharactersPanel, { type Character, type CharacterDetail } from "./CharactersPanel";
import GraphExplorer from "./GraphExplorer";
import StyleReferencesPanel from "./StyleReferencesPanel";
import ChapterStudio from "./ChapterStudio";
import StoryMemoryPanel from "./StoryMemoryPanel";
import { DASHBOARD_POLL_INTERVAL_MS, RECENT_RUNS_DISPLAY_LIMIT } from "./constants";

const { Header, Sider, Content } = Layout;
const { Title, Text, Paragraph } = Typography;

// ── API 数据形状（与 server.ts 的响应字段对应） ───────────────

type World = { id: string; title: string; hasStoryPlan: boolean };

type Plan = {
  schemaVersion: 1; worldId: string; status: "draft" | "active"; updatedAt: string;
  corePremise: string; centralConflict: string; protagonistLongTermGoal: string;
  stakes: string[]; endDirection: string;
  majorMilestones: Array<{ id: string; title: string; purpose: string; turningPoint: string; consequence: string; status: string }>;
  longTermThreads: Array<{ id: string; title: string; goal: string; stakes: string; currentPressure: string; nextPossibilities: string[]; status: string }>;
  revealPlan: string[]; constraints: string[]; openQuestions: string[]; revisionNotes: string[];
};

type Version = { id: string; status: string; createdAt: string; baseUpdatedAt: string | null; plan: Plan; runId: string };

type Run = { id: string; status: string; createdAt: string; error?: string; candidateId?: string };

type Dashboard = {
  storyPlan: Plan | null;
  counts: { running: number; completedRuns: number; failedRuns: number };
  recentRuns: Run[];
  planVersions: Version[];
};

// ── 基础助手 ────────────────────────────────────────────────

/** 统一的 JSON API 调用；非 2xx 时把后端 error 字段抛成异常。 */
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? response.statusText);
  return body as T;
}

const date = (value?: string | null) => (value ? new Date(value).toLocaleString() : "尚未建立");

// ── 看板与导航 ──────────────────────────────────────────────

export default function Workbench() {
  const { message } = AntApp.useApp();

  const [worlds, setWorlds] = useState<World[]>([]);
  const [worldId, setWorldId] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [active, setActive] = useState("chapter");

  // 人物页独立维护状态：查询词、选中项与详情缓存互不阻塞看板轮询。
  const [characters, setCharacters] = useState<Character[]>([]);
  const [characterQuery, setCharacterQuery] = useState("");
  const [selectedCharacter, setSelectedCharacter] = useState("");
  const [characterDetail, setCharacterDetail] = useState<CharacterDetail | null>(null);
  const [characterLoading, setCharacterLoading] = useState(false);
  const [characterTotal, setCharacterTotal] = useState(0);
  const characterRequest = useRef(0);

  const currentWorld = worlds.find(x => x.id === worldId);
  const plan = dashboard?.storyPlan;

  /** 拉取看板数据；轮询与手动刷新共用同一个入口。 */
  const refresh = useCallback(async (id = worldId) => {
    if (!id) return;
    setLoading(true);
    try {
      setDashboard(await api<Dashboard>(`/api/worlds/${id}/dashboard`));
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [worldId, message]);

  /** 人物列表按查询词拉取；当前选中项被过滤掉时清空选择，避免详情页悬挂。 */
  const refreshCharacters = useCallback(async (id = worldId, q = characterQuery) => {
    if (!id) return;
    const requestId = ++characterRequest.current;
    try {
      const data = await api<{ characters: Character[]; total: number }>(
        `/api/worlds/${id}/characters?q=${encodeURIComponent(q)}`
      );
      if (requestId !== characterRequest.current) return;
      setCharacters(data.characters);
      setCharacterTotal(data.total ?? data.characters.length);
      if (selectedCharacter && !data.characters.some(x => x.name === selectedCharacter)) {
        setSelectedCharacter("");
      }
    } catch (e) {
      if (requestId === characterRequest.current) message.error(e instanceof Error ? e.message : String(e));
    }
  }, [worldId, characterQuery, selectedCharacter, message]);

  // 首次进入：加载世界列表并默认选中第一个世界。
  useEffect(() => {
    void api<{ worlds: World[] }>("/api/worlds")
      .then(({ worlds: items }) => {
        setWorlds(items);
        if (items.length) setWorldId(items[0]!.id);
      })
      .catch(e => message.error(String(e)));
  }, []);

  // 切换世界：立即刷新看板，并重置人物页的选择状态，防止跨世界串数据。
  useEffect(() => {
    if (worldId) {
      void refresh(worldId);
      setSelectedCharacter("");
      setCharacterDetail(null);
    }
  }, [worldId, refresh]);

  // 看板定时轮询，保持运行状态实时可见。
  useEffect(() => {
    if (!worldId) return;
    const timer = setInterval(() => void refresh(worldId), DASHBOARD_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [worldId, refresh]);

  // 人物页激活或查询词变化时重新拉取列表。
  useEffect(() => {
    if (worldId && active === "characters") void refreshCharacters(worldId, characterQuery);
  }, [worldId, active, characterQuery, refreshCharacters]);

  // 选中人物后异步加载详情；组件卸载或换人时丢弃迟到响应。
  useEffect(() => {
    if (!worldId || !selectedCharacter) {
      setCharacterDetail(null);
      return;
    }
    let cancelled = false;
    setCharacterLoading(true);
    api<CharacterDetail>(`/api/worlds/${worldId}/characters/${encodeURIComponent(selectedCharacter)}`)
      .then(data => { if (!cancelled) setCharacterDetail(data); })
      .catch(e => { if (!cancelled) message.error(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setCharacterLoading(false); });
    return () => { cancelled = true; };
  }, [worldId, selectedCharacter, message]);

  /** 触发主线规划生成：任务在服务端异步执行，这里只负责启动并立即反馈。 */
  const generate = async () => {
    if (!worldId) return;
    setGenerating(true);
    try {
      await api(`/api/worlds/${worldId}/story-plan/generate`, { method: "POST", body: JSON.stringify({}) });
      message.success("主线规划任务已启动；生成结果会自动生效，无需等待审核。");
      await refresh();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  // 侧边导航；key 与下方 body 的分支一一对应。
  const nav = [
    { key: "chapter", icon: <PlayCircleOutlined />, label: "续写章节" },
    { key: "overview", icon: <DashboardOutlined />, label: "工作台" },
    { key: "story-plan", icon: <BookOutlined />, label: "长期主线" },
    { key: "characters", icon: <UserOutlined />, label: "人物" },
    { key: "graph", icon: <ApartmentOutlined />, label: "故事图谱" },
    { key: "style-references", icon: <FileTextOutlined />, label: "文风样本" },
    { key: "story-memory", icon: <BulbOutlined />, label: "创作记忆" },
    { key: "versions", icon: <HistoryOutlined />, label: "规划版本" },
    { key: "runs", icon: <PlayCircleOutlined />, label: "运行记录" }
  ];

  /** 长期主线页：总览描述 + 左右两列（关键节点 / 剧情线）。 */
  function StoryPlanBody() {
    return (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Card
          title="长期主线"
          extra={
            <Button type="primary" icon={<PlayCircleOutlined />} loading={generating} onClick={generate}>
              生成并应用新版本
            </Button>
          }
        >
          {plan ? (
            <>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="核心构想">{plan.corePremise}</Descriptions.Item>
                <Descriptions.Item label="核心矛盾">{plan.centralConflict}</Descriptions.Item>
                <Descriptions.Item label="主角长期目标">{plan.protagonistLongTermGoal}</Descriptions.Item>
                <Descriptions.Item label="失败代价">{plan.stakes.join("；") || "未限定"}</Descriptions.Item>
                <Descriptions.Item label="最终方向">{plan.endDirection}</Descriptions.Item>
                <Descriptions.Item label="更新时间">{date(plan.updatedAt)}</Descriptions.Item>
              </Descriptions>
              <Tag color="success">当前生效</Tag>
            </>
          ) : (
            <Empty description="尚未建立长期主线规划" />
          )}
        </Card>
        {plan && (
          <Row gutter={[16, 16]}>
            <Col xs={24} xl={12}>
              <Card title="重大剧情节点">
                <List
                  dataSource={plan.majorMilestones}
                  locale={{ emptyText: "暂无节点" }}
                  renderItem={item => (
                    <List.Item>
                      <List.Item.Meta
                        title={<Space>{item.title}<Tag>{item.status}</Tag></Space>}
                        description={
                          <>
                            <Paragraph>{item.purpose}</Paragraph>
                            {item.turningPoint && <Text type="secondary">转折：{item.turningPoint}</Text>}
                            {item.consequence && <Paragraph type="secondary">后果：{item.consequence}</Paragraph>}
                          </>
                        }
                      />
                    </List.Item>
                  )}
                />
              </Card>
            </Col>
            <Col xs={24} xl={12}>
              <Card title="长期剧情线">
                <List
                  dataSource={plan.longTermThreads}
                  locale={{ emptyText: "暂无剧情线" }}
                  renderItem={item => (
                    <List.Item>
                      <List.Item.Meta
                        title={<Space>{item.title}<Tag>{item.status}</Tag></Space>}
                        description={
                          <>
                            <Paragraph>目标：{item.goal}</Paragraph>
                            <Paragraph>当前压力：{item.currentPressure}</Paragraph>
                            <Text type="secondary">后续可能：{item.nextPossibilities.join("；")}</Text>
                          </>
                        }
                      />
                    </List.Item>
                  )}
                />
              </Card>
            </Col>
          </Row>
        )}
      </Space>
    );
  }

  /** 规划版本页：事后检查用，不是审批队列。 */
  function VersionsBody() {
    return (
      <Card
        title="规划版本记录"
        extra={<Text type="secondary">生成即生效；此处用于事后检查，不构成审批队列。</Text>}
      >
        <List
          dataSource={dashboard?.planVersions ?? []}
          locale={{ emptyText: "暂无版本记录" }}
          renderItem={version => (
            <List.Item>
              <List.Item.Meta
                title={
                  <Space>
                    <Tag color={version.status === "applied" ? "success" : "default"}>{version.status}</Tag>
                    <Text code>{version.id.slice(0, 8)}</Text>
                  </Space>
                }
                description={
                  <>
                    {date(version.createdAt)} · 基于版本：{version.baseUpdatedAt ?? "首次建立"}
                    {version.plan?.corePremise && <Paragraph>{version.plan.corePremise}</Paragraph>}
                  </>
                }
              />
            </List.Item>
          )}
        />
      </Card>
    );
  }

  /** 运行状态标签配色统一取法：失败红、成功绿、排队/运行中蓝。 */
  function runStatusColor(status: string): string {
    return status === "failed" ? "error" : status === "completed" ? "success" : "processing";
  }

  /** 运行记录页：含失败原因。 */
  function RunsBody() {
    return (
      <Card title="运行记录">
        <List
          dataSource={dashboard?.recentRuns ?? []}
          locale={{ emptyText: "暂无运行记录" }}
          renderItem={run => (
            <List.Item>
              <List.Item.Meta
                title={
                  <Space>
                    <Text code>{run.id.slice(0, 8)}</Text>
                    <Tag color={runStatusColor(run.status)}>{run.status}</Tag>
                  </Space>
                }
                description={
                  <>
                    {date(run.createdAt)}
                    {run.error && <Paragraph type="danger">{run.error}</Paragraph>}
                  </>
                }
              />
            </List.Item>
          )}
        />
      </Card>
    );
  }

  /** 工作台首页：统计卡片 + 自主运行说明 + 主线摘要与最近运行。 */
  function OverviewBody() {
    return (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Row gutter={16}>
          <Col xs={24} md={8}><Card><Statistic title="正在运行" value={dashboard?.counts.running ?? 0} /></Card></Col>
          <Col xs={24} md={8}><Card><Statistic title="已完成任务" value={dashboard?.counts.completedRuns ?? 0} /></Card></Col>
          <Col xs={24} md={8}><Card><Statistic title="运行失败" value={dashboard?.counts.failedRuns ?? 0} /></Card></Col>
        </Row>
        <Alert
          type="success"
          showIcon
          message="默认自主运行"
          description="主线规划生成后自动生效，章节工作流继续自动完成质量检查、有限修复和故事状态提交。工作台提供运行可见性与事后检查，不把人工点击设为常规流程的前置条件。"
        />
        <Card
          title="当前主线"
          extra={<Button type="link" onClick={() => setActive("story-plan")}>查看详情</Button>}
        >
          {plan ? (
            <>
              <Title level={4}>{plan.corePremise}</Title>
              <Paragraph>{plan.centralConflict}</Paragraph>
              <Text type="secondary">最后更新：{date(plan.updatedAt)}</Text>
            </>
          ) : (
            <Empty description="尚无正式主线规划" />
          )}
        </Card>
        <Card title="最近运行">
          <List
            dataSource={(dashboard?.recentRuns ?? []).slice(0, RECENT_RUNS_DISPLAY_LIMIT)}
            locale={{ emptyText: "暂无运行记录" }}
            renderItem={run => (
              <List.Item>
                <List.Item.Meta
                  title={
                    <Space>
                      <Text code>{run.id.slice(0, 8)}</Text>
                      <Tag color={runStatusColor(run.status)}>{run.status}</Tag>
                    </Space>
                  }
                  description={date(run.createdAt)}
                />
              </List.Item>
            )}
          />
        </Card>
      </Space>
    );
  }

  /** 当前激活页对应的正文；子面板组件各自管理自己的内部状态。 */
  function body() {
    if (active === "chapter") return <ChapterStudio worldId={worldId} />;
    if (active === "style-references") return <StyleReferencesPanel worldId={worldId} />;
    if (active === "story-memory") return <StoryMemoryPanel worldId={worldId} />;
    if (active === "graph") return <GraphExplorer worldId={worldId} />;
    if (active === "characters") {
      return (
        <CharactersPanel
          worldId={worldId}
          characters={characters}
          query={characterQuery}
          onQueryChange={setCharacterQuery}
          selected={selectedCharacter}
          onSelect={setSelectedCharacter}
          detail={characterDetail}
          total={characterTotal}
          loading={characterLoading}
          onRefresh={() => void refreshCharacters()}
        />
      );
    }
    if (active === "story-plan") return <StoryPlanBody />;
    if (active === "versions") return <VersionsBody />;
    if (active === "runs") return <RunsBody />;
    return <OverviewBody />;
  }

  /** 顶栏副标题随页面切换，说明当前区块观察的是什么。 */
  function pageHint(): string {
    if (active === "chapter") return "一键生成下一章；规划、正文、自动修订与状态更新由系统完成";
    if (active === "characters") return "人物档案、人物关系与正文事件时间线";
    if (active === "story-memory") return "从完整故事单元中提炼的长期创作经验及其原始证据";
    if (active === "graph") return "原著故事结构与续写动态关系的交互式浏览";
    if (active === "style-references") return "管理认可样本及历史版本；只有活动样本进入风格回归";
    return "自主创作、运行观察与版本追溯";
  }

  return (
    <Layout className="app-shell">
      <Sider width={230} theme="light" breakpoint="lg" collapsedWidth="0">
        <div className="brand"><BookOutlined /> Novel Workbench</div>
        <Menu mode="inline" selectedKeys={[active]} items={nav} onClick={e => setActive(e.key)} />
      </Sider>
      <Layout>
        <Header className="topbar">
          <Space>
            <Text strong>{currentWorld?.title ?? "Novel Generation"}</Text>
            <Select
              value={worldId || undefined}
              placeholder="选择 World"
              style={{ width: 220 }}
              options={worlds.map(w => ({ value: w.id, label: w.title }))}
              onChange={setWorldId}
            />
          </Space>
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => { void refresh(); if (active === "characters") void refreshCharacters(); }}
            >
              刷新
            </Button>
            <Tag color="success">Local</Tag>
          </Space>
        </Header>
        <Content className="main-content">
          <div className="page-heading">
            <div>
              <Title level={2}>{nav.find(x => x.key === active)?.label as string}</Title>
              <Text type="secondary">{pageHint()}</Text>
            </div>
          </div>
          {worlds.length === 0 ? (
            <Alert
              type="warning"
              showIcon
              message="没有可用的 World"
              description="请先在 worlds/ 下创建包含 world-bible.md 的世界目录。"
            />
          ) : (
            <Spin spinning={loading && active !== "characters"}>{body()}</Spin>
          )}
        </Content>
      </Layout>
    </Layout>
  );
}
