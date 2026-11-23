import { Bar, Column, Pie } from "@ant-design/charts";
import { Card, Col, Empty, Row } from "antd";
import type { ReactNode } from "react";
import type { AnalyticsBreakdown, RequestAnalytics, TechnicalDebtAnalytics } from "./types";

type ChartRow = { label: string; count: number };
type Props =
  | { mode: "requests"; data: RequestAnalytics }
  | { mode: "debt"; data: TechnicalDebtAnalytics };

const statusLabels: Record<string, string> = {
  draft: "Draft",
  requestor_revision: "Requestor Changes",
  discussion_review: "Discussion & Review",
  waiting_requestor: "Awaiting Requestor Response",
  decision_meeting: "Decision Meeting",
  approved_pending_close: "Approved · Pending Closure",
  rejected_pending_close: "Rejected · Pending Closure",
  closed: "Closed",
  open: "Open",
  in_progress: "In Progress",
  deferred: "Deferred",
  resolved: "Resolved",
  cancelled: "Cancelled"
};

const typeLabels: Record<string, string> = {
  architecture_review: "Architecture Review",
  solution_assessment: "Solution Assessment",
  change_assessment: "Change Assessment",
  risk_assessment: "Risk Assessment",
  technical_debt: "Technical Debt",
  other: "Other"
};

const priorityLabels: Record<string, string> = {
  high: "High",
  normal: "Normal",
  low: "Low"
};

const severityLabels: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low"
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
      {hasData ? children : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No data" />}
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
      { provider, series: "Linked Resources", count: row.count },
      { provider, series: "Linked Work Items", count: row.requestCount }
    ];
  });

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={12}>
        <ChartPanel title="Work Item Status" hasData={hasValues(status)}>
          <Pie data={status} angleField="count" colorField="label" innerRadius={0.62} height={260} />
        </ChartPanel>
      </Col>
      <Col xs={24} lg={12}>
        <ChartPanel title="Work Item Types" hasData={hasValues(types)}>
          <BreakdownBar data={types} />
        </ChartPanel>
      </Col>
      <Col xs={24} lg={12}>
        <ChartPanel title="Priority Distribution" hasData={hasValues(priorities)}>
          <BreakdownColumn data={priorities} />
        </ChartPanel>
      </Col>
      <Col xs={24} lg={12}>
        <ChartPanel title="Work Item Age" hasData={hasValues(aging)}>
          <BreakdownColumn data={aging} />
        </ChartPanel>
      </Col>
      <Col xs={24} lg={12}>
        <ChartPanel title="External Resource Links" hasData={external.some(row => row.count > 0)}>
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
        <ChartPanel title="Technical Debt Status" hasData={hasValues(status)}>
          <BreakdownBar data={status} />
        </ChartPanel>
      </Col>
      <Col xs={24} lg={12}>
        <ChartPanel title="Severity Distribution" hasData={hasValues(severity)}>
          <BreakdownColumn data={severity} />
        </ChartPanel>
      </Col>
      <Col xs={24} lg={12}>
        <ChartPanel title="Priority Distribution" hasData={hasValues(priorities)}>
          <BreakdownColumn data={priorities} />
        </ChartPanel>
      </Col>
      <Col xs={24} lg={12}>
        <ChartPanel title="Technical Debt Age" hasData={hasValues(aging)}>
          <BreakdownColumn data={aging} />
        </ChartPanel>
      </Col>
      <Col xs={24} lg={12}>
        <ChartPanel title="Originating Work Items" hasData={hasValues(origins)}>
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
