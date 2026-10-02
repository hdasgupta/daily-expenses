from pathlib import Path
p=Path('/mnt/data/work-step7/frontend/src/pages/DashboardDetail.jsx')
s=p.read_text()
start=s.index('function buildMergedSummaryRows')
end=s.index('\nfunction readReportKey()', start)
new=r'''function buildMergedCells(rows, columns) {
  return (rows || []).map((row, rowIndex) => {
    const cells = columns.map((column, columnIndex) => {
      const samePrefix = rowIndex > 0 && columns.slice(0, columnIndex + 1).every((key) => rows[rowIndex - 1]?.[key] === row[key]);
      if (samePrefix) return { hidden: true, rowSpan: 0 };
      let rowSpan = 1;
      while (rowIndex + rowSpan < rows.length) {
        const candidate = rows[rowIndex + rowSpan];
        if (!columns.slice(0, columnIndex + 1).every((key) => candidate?.[key] === row[key])) break;
        rowSpan += 1;
      }
      return { hidden: false, rowSpan };
    });
    return { row, rowIndex, cells };
  });
}

function buildPivotSummary(rows, groupBy) {
  const groups = groupBy || [];
  if (groups.length <= 1) return null;

  // For 2 groups: first dimension stays in rows, second becomes columns.
  // For 3+ groups: all but the last dimension stay in rows, last becomes columns.
  const rowColumns = groups.slice(0, -1);
  const columnColumn = groups[groups.length - 1];
  const columnValues = [];
  const columnKeys = new Map();
  const rowMap = new Map();

  (rows || []).forEach((row) => {
    const columnValue = row[columnColumn];
    const columnKey = String(columnValue ?? "__null__");
    if (!columnKeys.has(columnKey)) {
      columnKeys.set(columnKey, columnValues.length);
      columnValues.push({ key: columnKey, value: columnValue });
    }
    const rowKey = rowColumns.map((column) => String(row[column] ?? "__null__")).join("\u001f");
    if (!rowMap.has(rowKey)) {
      rowMap.set(rowKey, {
        values: rowColumns.reduce((acc, column) => ({ ...acc, [column]: row[column] }), {}),
        cells: {},
        total: 0,
      });
    }
    const target = rowMap.get(rowKey);
    target.cells[columnKey] = { total: Number(row.total || 0), row };
    target.total += Number(row.total || 0);
  });

  return {
    rowColumns,
    columnColumn,
    columnValues,
    rows: Array.from(rowMap.values()),
  };
}
'''
s=s[:start]+new+s[end:]
# replace table body region
old_start=s.index('            {data.rows?.length ? (')
old_end=s.index('            ) : null}', old_start)+len('            ) : null}')
new_table=r'''            {data.rows?.length ? (
              <div className="table-scroll">
                {data.groupBy?.length > 1 ? (
                  <PivotSummaryTable
                    data={data}
                    report={report}
                    navigate={navigate}
                  />
                ) : (
                  <table className="data-table dashboard-summary-table">
                    <thead>
                      <tr>
                        {(data.groupBy || []).map((column) => <th key={column}>{column}</th>)}
                        <th className="number-cell">Sum of expenses</th>
                      </tr>
                    </thead>
                    <tbody>
                      {buildMergedCells(data.rows, data.groupBy || []).map(({ row, rowIndex, cells }) => (
                        <tr key={`${rowIndex}-${rowLabel(row, data.groupBy || [])}`}>
                          {(data.groupBy || []).map((column, columnIndex) => {
                            const cell = cells[columnIndex];
                            if (cell.hidden) return null;
                            return (
                              <td key={column} rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined} className={cell.rowSpan > 1 ? "dashboard-summary-merged-cell" : undefined}>
                                {prettyValue(row[column], column)}
                              </td>
                            );
                          })}
                          <td className="number-cell">
                            <button type="button" className="table-link-button" onClick={() => openDrilldown(navigate, report.key, data.groupBy, row)}>
                              {money(row.total)}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : null}'''
s=s[:old_start]+new_table+s[old_end:]
# insert component before buildChartModel
marker='\nfunction buildChartModel(data) {'
idx=s.index(marker)
component=r'''
function PivotSummaryTable({ data, report, navigate }) {
  const pivot = buildPivotSummary(data.rows, data.groupBy);
  if (!pivot) return null;
  const merged = buildMergedCells(pivot.rows.map((item) => item.values), pivot.rowColumns);

  return (
    <table className="data-table dashboard-summary-table dashboard-pivot-table">
      <thead>
        <tr>
          {pivot.rowColumns.map((column) => <th key={column}>{column}</th>)}
          {pivot.columnValues.map(({ key, value }) => <th key={key} className="number-cell">{prettyValue(value, pivot.columnColumn)}</th>)}
          <th className="number-cell">Total</th>
        </tr>
      </thead>
      <tbody>
        {pivot.rows.map((pivotRow, rowIndex) => {
          const cells = merged[rowIndex].cells;
          return (
            <tr key={`${rowIndex}-${pivot.rowColumns.map((c) => pivotRow.values[c]).join("-")}`}>
              {pivot.rowColumns.map((column, columnIndex) => {
                const cell = cells[columnIndex];
                if (cell.hidden) return null;
                return (
                  <td key={column} rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined} className={cell.rowSpan > 1 ? "dashboard-summary-merged-cell" : undefined}>
                    {prettyValue(pivotRow.values[column], column)}
                  </td>
                );
              })}
              {pivot.columnValues.map(({ key }) => {
                const entry = pivotRow.cells[key];
                return (
                  <td key={key} className="number-cell">
                    {entry ? (
                      <button type="button" className="table-link-button" onClick={() => openDrilldown(navigate, report.key, data.groupBy, entry.row)}>
                        {money(entry.total)}
                      </button>
                    ) : "—"}
                  </td>
                );
              })}
              <td className="number-cell"><strong>{money(pivotRow.total)}</strong></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
'''
s=s[:idx]+component+s[idx:]
s=s.replace('barSize={40}', 'barSize={100}')
p.write_text(s)
