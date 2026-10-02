import React from "react";
import {
  BarChart3,
  Calendar,
  CalendarDays,
  CalendarRange,
  ChartNoAxesColumn,
  ChevronRight,
  Layers3,
  RefreshCw,
  Users,
} from "lucide-react";

const reports = [
  { key: "daily", label: "Daily report", icon: Calendar, help: "7 days · grouped by date" },
  { key: "weekly", label: "Weekly Report", icon: CalendarRange, help: "4 weeks · grouped by week" },
  { key: "monthly", label: "Monthly Report", icon: CalendarDays, help: "3 months · grouped by month" },
  { key: "yearly", label: "Yearly Report", icon: ChartNoAxesColumn, help: "2 years · grouped by year" },
  { key: "daily-category", label: "Daily report by Category", icon: Layers3, help: "7 days · date + category" },
  { key: "weekly-category", label: "Weekly report by Category", icon: Layers3, help: "4 weeks · week + category" },
  { key: "monthly-category", label: "Monthly report by Category", icon: Layers3, help: "3 months · month + category" },
  { key: "yearly-category", label: "Yearly report by Category", icon: Layers3, help: "2 years · year + category" },
  { key: "daily-survivor", label: "Daily report by Survivor", icon: Users, help: "7 days · date + survivor" },
  { key: "weekly-survivor", label: "Weekly report by Survivor", icon: Users, help: "4 weeks · week + survivor" },
  { key: "monthly-survivor", label: "Monthly report by Survivor", icon: Users, help: "3 months · month + survivor" },
  { key: "yearly-survivor", label: "Yearly report by Survivor", icon: Users, help: "2 years · year + survivor" },
  { key: "daily-survivor-category", label: "Daily report Survivor vs Category", icon: BarChart3, help: "7 days · date + survivor + category" },
  { key: "weekly-survivor-category", label: "Weekly report Survivor vs Category", icon: BarChart3, help: "4 weeks · week + survivor + category" },
  { key: "monthly-survivor-category", label: "Monthly report Survivor vs Category", icon: BarChart3, help: "3 months · month + survivor + category" },
  { key: "yearly-survivor-category", label: "Yearly report Survivor vs Category", icon: BarChart3, help: "2 years · year + survivor + category" },
];

export function getDashboardReports() {
  return reports;
}

export default function Dashboard({ navigate }) {
  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Dashboard</h1>
          <p>Select a predefined report to open its detailed dashboard.</p>
        </div>
        <button className="secondary" type="button" onClick={() => window.location.reload()}>
          <RefreshCw size={17} /> Refresh
        </button>
      </div>

      <div className="dashboard-report-list">
        {reports.map((report) => {
          const Icon = report.icon;
          return (
            <button
              className="card dashboard-report-link"
              key={report.key}
              type="button"
              onClick={() => navigate(`/dashboard/report/${report.key}`)}
            >
              <span className="dashboard-report-icon"><Icon size={21} /></span>
              <span className="dashboard-report-copy">
                <strong>{report.label}</strong>
                <small>{report.help}</small>
              </span>
              <ChevronRight size={19} />
            </button>
          );
        })}
      </div>
    </section>
  );
}
