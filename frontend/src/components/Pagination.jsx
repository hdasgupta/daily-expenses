import React from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

export default function Pagination({
  page,
  total,
  pageSize,
  setPage,
  setPageSize,
  search,
  setSearch,
  sortColumn,
  sortDirection,
  setSort,
  sortOptions = [],
  startCount = 2,
  endCount = 2,
  midCount = 3,
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);

  // Generates starting pages, middle pages (covering current or center), and ending pages
  const getPageItems = () => {
    const maxVisibleThreshold = startCount + midCount + endCount + 2;

    // If total pages is small enough to fit all pages without ellipsis
    if (pages <= maxVisibleThreshold) {
      return Array.from({ length: pages }, (_, i) => i + 1);
    }

    const startPages = Array.from({ length: startCount }, (_, i) => i + 1);
    const endPages = Array.from({ length: endCount }, (_, i) => pages - endCount + 1 + i);

    let midPages = [];
    // If current page is among visible starting or ending pages, middle pages sit at the natural center
    if (startPages.includes(current) || endPages.includes(current)) {
      const mid = Math.floor((1 + pages) / 2);
      const halfMid = Math.floor(midCount / 2);
      const midStart = mid - halfMid;
      midPages = Array.from({ length: midCount }, (_, i) => midStart + i);
    } else {
      // Otherwise choose middle pages so that current page is covered
      const halfMid = Math.floor(midCount / 2);
      let midStart = current - halfMid;
      midPages = Array.from({ length: midCount }, (_, i) => midStart + i);

      // Keep middle pages within bounds between startPages and endPages
      if (midPages[0] <= startPages[startPages.length - 1]) {
        const shift = startPages[startPages.length - 1] + 1 - midPages[0];
        midPages = midPages.map((p) => p + shift);
      }
      if (midPages[midPages.length - 1] >= endPages[0]) {
        const shift = midPages[midPages.length - 1] - (endPages[0] - 1);
        midPages = midPages.map((p) => p - shift);
      }
    }

    const items = [];

    // 1. Few starting pages
    items.push(...startPages);

    // 2. Gap between start pages and middle pages
    if (midPages[0] > startPages[startPages.length - 1] + 1) {
      if (midPages[0] === startPages[startPages.length - 1] + 2) {
        items.push(startPages[startPages.length - 1] + 1);
      } else {
        items.push({ type: "ellipsis", key: "start-ellipsis" });
      }
    }

    // 3. Few middle pages
    for (const p of midPages) {
      if (p > startPages[startPages.length - 1] && p < endPages[0]) {
        items.push(p);
      }
    }

    // 4. Gap between middle pages and end pages
    const lastMid = midPages[midPages.length - 1];
    if (endPages[0] > lastMid + 1) {
      if (endPages[0] === lastMid + 2) {
        items.push(lastMid + 1);
      } else {
        items.push({ type: "ellipsis", key: "end-ellipsis" });
      }
    }

    // 5. Few ending pages
    items.push(...endPages);

    return items;
  };

  const pageItems = getPageItems();

  return (
    <div className="pagination">
      <div className="pagination-left">
        <button
          className="page-button"
          disabled={current <= 1}
          onClick={() => setPage(current - 1)}
          title="Previous"
        >
          <ChevronLeft size={16} /> Prev
        </button>
        {pageItems.map((item, index) => {
          if (typeof item === "object" && item?.type === "ellipsis") {
            return (
              <span
                key={item.key || `ellipsis-${index}`}
                className="page-ellipsis"
                aria-hidden="true"
              >
                …
              </span>
            );
          }
          return (
            <button
              key={item}
              className={`page-button ${item === current ? "active" : ""}`}
              onClick={() => setPage(item)}
              aria-current={item === current ? "page" : undefined}
            >
              {item}
            </button>
          );
        })}
        <button
          className="page-button"
          disabled={current >= pages}
          onClick={() => setPage(current + 1)}
          title="Next"
        >
          Next <ChevronRight size={16} />
        </button>
      </div>
      <div className="pagination-controls">
        <label>
          Items/page
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            <option value="5">5</option>
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
          </select>
        </label>
        {sortOptions.length ? (
          <label>
            Sort
            <select
              value={sortColumn || ""}
              onChange={(e) => {
                setSort(e.target.value || null);
                setPage(1);
              }}
            >
              <option value="">Default</option>
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {sortColumn ? (
          <button
            className="page-button sort-direction"
            onClick={() => {
              setSort(sortColumn);
              setPage(1);
            }}
          >
            {sortDirection === "asc" ? "↑" : "↓"}
          </button>
        ) : null}
        <label className="search-box">
          <Search size={15} />
          <input
            placeholder="Search"
            value={search || ""}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
    </div>
  );
}
