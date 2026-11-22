import { Bar, Column, Pie } from "@ant-design/charts";
import { Card, Col, Empty, Row } from "antd";
import type { ReactNode } from "react";
import type { AnalyticsBreakdown, RequestAnalytics, TechnicalDebtAnalytics } from "./types";

type ChartRow = { label: string; count: number };
type Props =
  | { mode: "requests"; data: RequestAnalytics }
  | { mode: "debt"; data: TechnicalDebtAnalytics };

const statusLabels: Record<string, string> = {
  draft: "草稿",
  requestor_revision: "申请人修改",
  discussion_review: "讨论与评审",
  waiting_requestor: "等待申请人答复",
  decision_meeting: "决定会议",
  approved_pending_close: "批准待关闭",
  rejected_pending_close: "拒绝待关闭",
  closed: "已关闭",
  open: "待处理",
  in_progress: "处理中",
  deferred: "已延期",
  resolved: "已解决",
  cancelled: "已取消"
};

const typeLabels: Record<string, string> = {
  architecture_review: "架构评审",
  solution_assessment: "方案评估",
  change_assessment: "变更评估",
  risk_assessment: "风险评估",
  technical_debt: "技术债务",
  other: "其他"
};

const priorityLabels: Record<string, string> = {
  high: "高",
  normal: "普通",
  low: "低"
};

const severityLabels: Record<string, string> = {
  critical: "严重",
  high: "高",
  medium: "中",
  low: "低"
};

const providerLabels: Record<string, string> = {
  jira: "Jira",
  confluence: "Confluence",
  github: "GitHub",
  leanix: "LeanIX"
};

function toChartRows(rows: AnalyticsBreakdown[], labels: Record<string, string> = {}): ChartRow[] {
  return rows.map(row => ({
    label: row.label || labels[row.key] || row.key,
    count: row.count
  }));
}

function hasValues(rows: ChartRow[]) {
  return rows.some(row => row.count > 0);
}

function ChartPanel({ title, hasData, children }: { title: string; hasData: boolean; children: ReactNode }) {
  return (
    <Card title={title} className="panel-card analytics-chart-card">
      {hasData ? children : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />}
    </Card>
  );
}

function BreakdownBar({ data, height = 250 }: { data: ChartRow[]; height?: number }) {
  return <Bar data={data} xField="count" yField="label" height={height} />;
}

function BreakdownColumn({ data, height = 250 }: { data: ChartRow[]; height?: number }) {
  return <Column data={data} xField="label" yField="count" height={height} />;
}

function RequestCharts({ data }: { data: RequestAnalytics }) {
  const status = toChartRows(data.byStatus, statusLabels);
  const types = toChartRows(data.byType, typeLabels);
  const priorities = toChartRows(data.byPriority, priorityLabels);
  const aging = toChartRows(data.aging);
  const external = data.externalSystems.flatMap(row => {
    const provider = providerLabels[row.key] || row.key;
    return [
      { provider, series: "关联资源", count: row.count },
      { provider, series: "关联事项", count: row.requestCount }
    ];
  });

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={12}>
        <ChartPanel title="事项状态分布" hasData={hasValues(status)}>
          <Pie data={status} angleField="count" colorField="label" innerRadius={0.62} height={260} />
        </ChartPanel>
      </Col>
      <Col xs={24} lg={12}>
        <ChartPanel title="事项类型" hasData={hasValues(types)}>
          <BreakdownBar data={types} />
        </ChartPanel>
      </Col>
      <Col xs={24} lg={12}>
        <ChartPanel title="优先级分布" hasData={hasValues(priorities)}>
          <BreakdownColumn data={priorities} />
        </ChartPanel>
      </Col>
      <Col xs={24} lg={12}>
        <ChartPanel title="事项存续时长" hasData={hasValues(aging)}>
          <BreakdownColumn data={aging} />
        </ChartPanel>
      </Col>
      <Col xs={24} lg={12}>
        <ChartPanel title="外部资源关联" hasData={external.some(row => row.count > 0)}>
          <Column data={external} xField="provider" yField="count" colorField="series" group height={270} />
        </ChartPanel>
      </Col>
    </Row>
  );
}

function DebtCharts({ data }: { data: TechnicalDebtAnalytics }) {
  const status = toChartRows(data.byStatus, statusLabels);
  const severity = toChartRows(data.bySeverity, severityLabels);
  const priorities = toChartRows(data.byPriority, priorityLabels);
  const aging = toChartRows(data.aging);
  const origins = data.byOriginRequest.map(row => ({ label: row.code, count: row.debt_count }));

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={12}>
        <ChartPanel title="技术债务状态" hasData={hasValues(status)}>
          <BreakdownBar data={status} />
        </ChartPanel>
      </Col>
      <Col xs={24} lg={12}>
        <ChartPanel title="严重程度分布" hasData={hasValues(severity)}>
          <BreakdownColumn data={severity} />
        </ChartPanel>
      </Col>
      <Col xs={24} lg={12}>
        <ChartPanel title="优先级分布" hasData={hasValues(priorities)}>
          <BreakdownColumn data={priorities} />
        </ChartPanel>
      </Col>
      <Col xs={24} lg={12}>
        <ChartPanel title="技术债务存续时长" hasData={hasValues(aging)}>
          <BreakdownColumn data={aging} />
        </ChartPanel>
      </Col>
      <Col xs={24} lg={12}>
        <ChartPanel title="来源事项" hasData={hasValues(origins)}>
          <BreakdownBar data={origins} />
        </ChartPanel>
      </Col>
    </Row>
  );
}

export default function AnalyticsCharts(props: Props) {
  return props.mode === "requests"
    ? <RequestCharts data={props.data} />
    : <DebtCharts data={props.data} />;
}
