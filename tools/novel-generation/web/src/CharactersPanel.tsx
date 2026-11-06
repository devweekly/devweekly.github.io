import { useState } from "react";
import {
  Alert, Avatar, Badge, Button, Card, Col, Descriptions, Divider, Empty, Flex, Input,
  List, Row, Space, Spin, Statistic, Tabs, Tag, Timeline, Typography
} from "antd";
import { BookOutlined, ReloadOutlined, UserOutlined } from "@ant-design/icons";

const { Title, Text, Paragraph } = Typography;

export type Character = {
  characterId: string;
  name: string;
  aliases: string[];
  role: string;
  bio: string;
  voice: string;
  chaptersSeen: number;
  mentionTotal: number;
  firstChapter: number | null;
  lastChapter: number | null;
};

export type CharacterDetail = {
  character: Character & {
    personality: string[];
    desires: string[];
    contradictions: string[];
    arc: string[];
    source: string;
  };
  profile: null | {
    summary: string;
    stages: string[];
    traits: string[];
    contradictions: string[];
    arc: string[];
    observationCount: number;
    model: string;
    generatedAt: string;
  };
  timeline: Array<{
    beatId: string;
    chapterId: string;
    chapterOrdinal: number;
    volume: number;
    chapterTitle: string;
    chapterLabel: string;
    summary: string;
    actors: string[];
  }>;
  relations: Array<{
    fromName: string;
    toName: string;
    label: string;
    evidence: string;
    chapterOrdinal: number | null;
  }>;
};

export interface CharactersPanelProps {
  characters: Character[];
  query: string;
  onQueryChange: (value: string) => void;
  selected: string;
  onSelect: (name: string) => void;
  detail: CharacterDetail | null;
  /** 库中人物总数，不受搜索与 limit 影响。 */
  total: number;
  loading: boolean;
  onRefresh: () => void;
}

const formatDate = (value?: string | null): string =>
  value ? new Date(value).toLocaleString() : "尚未建立";

/** role 常是一整段人物定位，只取第一个句读前的短语做标签，全文另行展示。 */
const shortRole = (role: string): string => {
  const head = role.split(/[。：:，,；;\n]/u)[0]?.trim() ?? "";
  if (!head) return "人物";
  return head.length > 12 ? head.slice(0, 12) + "…" : head;
};

/** 各观察维度都是独立可检查项；用标签组呈现，避免长文本挤进 Descriptions 窄列。 */
const TagGroup = ({ items }: { items: string[] | undefined }): React.ReactNode => {
  const values = items ?? [];
  return values.length
    ? <Space size={[6, 6]} wrap>{values.map((item, index) => <Tag key={`${item}-${index}`}>{item}</Tag>)}</Space>
    : <Text type="secondary">暂无记录</Text>;
};

const SectionLabel = ({ children }: { children: React.ReactNode }): React.ReactNode => (
  <Text type="secondary" className="section-label">{children}</Text>
);

export default function CharactersPanel({
  characters, query, onQueryChange, selected, onSelect, detail, total, loading, onRefresh
}: CharactersPanelProps) {
  const [aliasExpanded, setAliasExpanded] = useState(false);
  const aliases = detail?.character.aliases ?? [];

  const dossier = detail ? (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <Row gutter={[24, 16]}>
        <Col xs={24} lg={12}>
          <SectionLabel>人物背景</SectionLabel>
          <Paragraph style={{ marginTop: 6, marginBottom: 0 }}>
            {detail.character.bio || "暂无人物背景"}
          </Paragraph>
        </Col>
        <Col xs={24} lg={12}>
          <SectionLabel>人物声音</SectionLabel>
          <Paragraph style={{ marginTop: 6, marginBottom: 0 }}>
            {detail.character.voice || "暂无人物声音"}
          </Paragraph>
        </Col>
      </Row>
      <Divider style={{ margin: 0 }} />
      <Descriptions column={1} layout="vertical" size="small">
        <Descriptions.Item label="性格"><TagGroup items={detail.character.personality} /></Descriptions.Item>
        <Descriptions.Item label="欲望 / 目标"><TagGroup items={detail.character.desires} /></Descriptions.Item>
        <Descriptions.Item label="内在矛盾"><TagGroup items={detail.character.contradictions} /></Descriptions.Item>
        <Descriptions.Item label="发展方向"><TagGroup items={detail.character.arc} /></Descriptions.Item>
      </Descriptions>
      <Text type="secondary" style={{ fontSize: 12 }}>
        这些是分析观察，不是人物必须兑现的设定；人物可以反复、误判或做出意料之外的选择。
      </Text>
    </Space>
  ) : null;

  const profile = detail ? (
    detail.profile ? (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Paragraph style={{ margin: 0 }}>{detail.profile.summary || "暂无综合画像"}</Paragraph>
        <Divider style={{ margin: 0 }} />
        <Descriptions column={1} layout="vertical" size="small">
          <Descriptions.Item label="阶段变化"><TagGroup items={detail.profile.stages} /></Descriptions.Item>
          <Descriptions.Item label="稳定特征"><TagGroup items={detail.profile.traits} /></Descriptions.Item>
          <Descriptions.Item label="内在矛盾"><TagGroup items={detail.profile.contradictions} /></Descriptions.Item>
          <Descriptions.Item label="人物弧光 / 可能走向"><TagGroup items={detail.profile.arc} /></Descriptions.Item>
        </Descriptions>
        <Text type="secondary" style={{ fontSize: 12 }}>
          基于 {detail.profile.observationCount} 条观察 · {detail.profile.model} · {formatDate(detail.profile.generatedAt)}
        </Text>
      </Space>
    ) : (
      <Alert
        type="info"
        showIcon
        message="尚无合并人物 Profile"
        description="当前展示人物基础资料与逐批分析观察；运行 analyze-profiles 后可生成综合档案。"
      />
    )
  ) : null;

  const relations = detail ? (
    detail.relations.length ? (
      <List
        size="small"
        dataSource={detail.relations}
        renderItem={relation => (
          <List.Item key={`${relation.fromName}-${relation.toName}-${relation.label}-${relation.chapterOrdinal}`}>
            <Space direction="vertical" size={4} style={{ width: "100%" }}>
              <Space size={8} wrap>
                <Text strong>{relation.fromName}</Text>
                <Tag color="blue">{relation.label || "关系"}</Tag>
                <Text strong>{relation.toName}</Text>
                {relation.chapterOrdinal != null
                  ? <Text type="secondary" style={{ fontSize: 12 }}>第 {relation.chapterOrdinal} 章</Text>
                  : null}
              </Space>
              {relation.evidence
                ? <Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ margin: 0, fontSize: 12 }}>{relation.evidence}</Paragraph>
                : null}
            </Space>
          </List.Item>
        )}
      />
    ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无明确关系记录" />
  ) : null;

  const timeline = detail ? (
    detail.timeline.length ? (
      <Timeline
        items={detail.timeline.map(event => ({
          key: event.beatId,
          children: (
            <Space direction="vertical" size={6} style={{ width: "100%" }}>
              <Space size={8} wrap>
                <Tag color="blue">第 {event.volume ?? "?"} 卷</Tag>
                <Text strong>{event.chapterTitle || event.chapterId}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>{event.chapterId}</Text>
              </Space>
              <Paragraph style={{ margin: 0 }}>{event.summary}</Paragraph>
              <Text type="secondary" style={{ fontSize: 12 }}>
                参与人物：{event.actors.join("、") || "未标注"}
              </Text>
            </Space>
          )
        }))}
      />
    ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="知识库中暂无明确关联到该人物的章级事件" />
  ) : null;

  return (
    <Row gutter={[16, 16]} align="top">
      <Col xs={24} md={9} xl={8}>
        <Card
          className="character-list-card"
          title={
            <Space size={8}>
              <span>人物</span>
              <Badge count={total} showZero overflowCount={9999} color="#405b78" />
            </Space>
          }
          extra={
            <Button type="text" size="small" icon={<ReloadOutlined />} onClick={onRefresh}>
              刷新
            </Button>
          }
          styles={{ body: { padding: 12, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 } }}
        >
          <Input.Search
            allowClear
            placeholder="搜索人物姓名或别名"
            value={query}
            onChange={event => onQueryChange(event.target.value)}
          />
          <Text type="secondary" className="character-count-hint">
            {query.trim()
              ? `匹配 ${characters.length} 人 / 共 ${total} 人`
              : `共 ${total} 人，按提及次数排序`}
          </Text>
          {!query.trim() && characters.length < total
            ? <Alert type="warning" showIcon message={`当前仅加载 ${characters.length} 人，库中共有 ${total} 人`} />
            : null}
          <div className="character-scroll">
            <List
              dataSource={characters}
              split={false}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="暂无人物数据，请先运行 analyze-story / analyze-profiles"
                  />
                )
              }}
              renderItem={item => {
                const isSelected = selected === item.name;
                return (
                  <List.Item key={item.characterId} style={{ border: 0, padding: 0, marginTop: 10 }}>
                    <Flex
                      gap={10}
                      align="flex-start"
                      className={isSelected ? "character-row character-row-selected" : "character-row"}
                      onClick={() => {
                        setAliasExpanded(false);
                        onSelect(item.name);
                      }}
                    >
                      <Avatar
                        size={36}
                        icon={<UserOutlined />}
                        style={{
                          flexShrink: 0,
                          background: isSelected ? "#405b78" : "#eef2f6",
                          color: isSelected ? "#fff" : "#657b91"
                        }}
                      />
                      <Flex vertical gap={4} style={{ flex: 1, minWidth: 0 }}>
                        <Flex justify="space-between" align="center" gap={8}>
                          <Text strong ellipsis style={{ fontSize: 14, margin: 0 }}>{item.name}</Text>
                          {item.role ? <Tag className="character-role-tag">{shortRole(item.role)}</Tag> : null}
                        </Flex>
                        <Paragraph
                          type="secondary"
                          ellipsis={{ rows: 2 }}
                          style={{ margin: 0, fontSize: 12, lineHeight: "18px" }}
                        >
                          {item.bio || item.role || "暂无人物简介"}
                        </Paragraph>
                        <Space size={14} style={{ fontSize: 12 }}>
                          <Text type="secondary"><BookOutlined /> {item.chaptersSeen} 章</Text>
                          <Text type="secondary">{item.mentionTotal.toLocaleString()} 次提及</Text>
                        </Space>
                      </Flex>
                    </Flex>
                  </List.Item>
                );
              }}
            />
          </div>
        </Card>
      </Col>

      <Col xs={24} md={15} xl={16}>
        <Spin spinning={loading}>
          {detail ? (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Card styles={{ body: { padding: 20 } }}>
                <Flex gap={16} align="center" wrap="wrap">
                  <Avatar size={56} icon={<UserOutlined />} style={{ flexShrink: 0, background: "#405b78" }} />
                  <Flex vertical gap={6} style={{ flex: 1, minWidth: 220 }}>
                    <Title level={3} style={{ margin: 0 }}>{detail.character.name}</Title>
                    <Space size={8} wrap>
                      <Tag color="blue">{shortRole(detail.character.role)}</Tag>
                      {detail.character.firstChapter != null && detail.character.lastChapter != null
                        ? <Text type="secondary">第 {detail.character.firstChapter} – {detail.character.lastChapter} 章</Text>
                        : null}
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        来源：{detail.character.source || "全书分析"}
                      </Text>
                    </Space>
                    {detail.character.role
                      ? <Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ margin: 0, maxWidth: 760 }}>{detail.character.role}</Paragraph>
                      : null}
                  </Flex>
                </Flex>
                <Divider style={{ margin: "16px 0" }} />
                <Row gutter={16}>
                  <Col span={8}>
                    <Statistic title="出场章节" value={detail.character.chaptersSeen} suffix="章" valueStyle={{ fontSize: 20 }} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="提及次数" value={detail.character.mentionTotal} valueStyle={{ fontSize: 20 }} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="别名 / 称谓" value={aliases.length} suffix="个" valueStyle={{ fontSize: 20 }} />
                  </Col>
                </Row>
              </Card>

              <Card size="small" title="别名与称谓" extra={<Text type="secondary">共 {aliases.length} 个</Text>}>
                {aliases.length ? (
                  <>
                    <Space size={[6, 6]} wrap>
                      {(aliasExpanded ? aliases : aliases.slice(0, 24)).map((alias, index) => (
                        <Tag key={`${alias}-${index}`}>{alias}</Tag>
                      ))}
                    </Space>
                    {aliases.length > 24 ? (
                      <div>
                        <Button
                          type="link"
                          size="small"
                          style={{ paddingInline: 0, marginTop: 6 }}
                          onClick={() => setAliasExpanded(!aliasExpanded)}
                        >
                          {aliasExpanded ? "收起" : `展开全部 ${aliases.length} 个`}
                        </Button>
                      </div>
                    ) : null}
                  </>
                ) : <Text type="secondary">暂无别名记录</Text>}
              </Card>

              <Card className="character-tabs" styles={{ body: { padding: 0 } }}>
                <Tabs
                  items={[
                    { key: "dossier", label: "人物档案", children: dossier },
                    { key: "profile", label: "合并 Profile", children: profile },
                    { key: "relations", label: `关联人物（${detail.relations.length}）`, children: relations },
                    { key: "timeline", label: `关联时间线（${detail.timeline.length}）`, children: timeline }
                  ]}
                />
              </Card>
            </Space>
          ) : (
            <Card>
              <Empty description="从左侧选择人物，查看人物档案、关系与事件时间线" />
            </Card>
          )}
        </Spin>
      </Col>
    </Row>
  );
}
